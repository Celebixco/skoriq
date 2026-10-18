"""Capture recent finished SofaScore matches for the configured leagues without database writes."""

import argparse
import json
import os
import tempfile
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Protocol
from uuid import uuid4

MAX_SAFE_INTEGER = 9_007_199_254_740_991
MAX_EVENTS_PER_TOURNAMENT = 30
MAX_EVENTS_TOTAL = 180
MAX_EVENT_PAGES = 5
MAX_GOALS = 30
REQUEST_TIMEOUT_SECONDS = 15
REQUEST_DELAY_SECONDS = 0.7
STALE_WINDOW = timedelta(days=60)
OLDEST_EVENT = datetime(2020, 1, 1, tzinfo=timezone.utc)
ALLOWED_STATUS_TYPES = {"finished", "ended", "canceled", "cancelled", "postponed"}
MAX_SEASON_PROBES = 3
# The chrome124 TLS profile and the api.sofascore.com host are rejected by the
# provider edge; the current chrome profile on www.sofascore.com passes from
# residential networks. Datacenter addresses may block more profiles, so the
# transport walks this ordered list until one answers, then stays sticky.
API_BASE = "https://www.sofascore.com/api/v1"
IMPERSONATE_CANDIDATES = ("chrome", "chrome131", "chrome124", "safari")


class ProviderResponse(Protocol):
    status_code: int

    def json(self) -> Any: ...


Transport = Callable[..., ProviderResponse]


@dataclass(frozen=True)
class LeagueScope:
    tournament_id: int
    season_id: int
    label: str


class CaptureFailure(ValueError):
    """A controlled category without provider bodies or connection diagnostics."""


def positive_id(value: Any) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not 0 < value <= MAX_SAFE_INTEGER:
        raise ValueError("Provider identifiers must be positive safe integers.")
    return value


def positive_argument(value: str) -> int:
    try:
        return positive_id(int(value))
    except ValueError as error:
        raise argparse.ArgumentTypeError(str(error)) from None


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, default=Path(__file__).with_name("sofascore_catalog.json"))
    parser.add_argument("--output", type=Path, help="New JSON capture file; existing files are never overwritten.")
    parser.add_argument("--limit-tournaments", type=positive_argument, default=None,
                        help="Optional smoke-test limit on the number of leagues to fetch.")
    parser.add_argument("--tournament-id", type=positive_argument, default=None,
                        help="Fetch a single league by SofaScore tournament id.")
    parser.add_argument("--window", choices=["last", "next"], default="last",
                        help="Capture recently finished matches (last) or upcoming fixtures (next).")
    parser.add_argument("--pages", type=positive_argument, default=1,
                        help="Number of 30-event pages to merge for a historical backfill (1-5).")
    return parser.parse_args(argv)


def select_leagues(catalog: Any, limit: int | None = None, tournament_id: int | None = None) -> list[LeagueScope]:
    if isinstance(catalog, dict):
        catalog = catalog.get("leagues")
    if not isinstance(catalog, list):
        raise ValueError("Catalog must contain a league list.")
    selected: list[LeagueScope] = []
    seen: set[int] = set()
    for league in catalog:
        if not isinstance(league, dict):
            raise ValueError("Catalog league entries must be objects.")
        try:
            tournament_id_value = positive_id(league.get("sofascore_tournament_id"))
            season_id = positive_id(league.get("season_id"))
        except ValueError:
            continue
        if tournament_id is not None and tournament_id_value != tournament_id:
            continue
        if tournament_id_value in seen:
            continue
        seen.add(tournament_id_value)
        label = str(league.get("league_name") or tournament_id_value)
        selected.append(LeagueScope(tournament_id_value, season_id, label))
        if limit is not None and len(selected) == limit:
            break
    if not selected:
        raise ValueError("Catalog did not contain any usable leagues.")
    return selected


def score_field(container: Any, key: str) -> int | None:
    if not isinstance(container, dict):
        return None
    value = container.get(key)
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= MAX_GOALS:
        raise CaptureFailure("invalid_score")
    return value


def validate_event(event: Any, now: datetime, window: str = "last") -> dict[str, Any]:
    if not isinstance(event, dict):
        raise CaptureFailure("invalid_event")
    status = event.get("status")
    status_type = status.get("type") if isinstance(status, dict) else None
    if window == "last":
        if status_type not in ALLOWED_STATUS_TYPES:
            raise CaptureFailure("not_finished")
        if status_type in {"canceled", "cancelled"}:
            captured_status = "cancelled"
        elif status_type == "postponed":
            captured_status = "postponed"
        else:
            captured_status = "finished"
    else:
        if status_type != "notstarted":
            raise CaptureFailure("not_scheduled")
        captured_status = "notstarted"
    identifier = positive_id(event.get("id"))
    started = event.get("startTimestamp")
    if isinstance(started, bool) or not isinstance(started, int):
        raise CaptureFailure("invalid_start")
    start_instant = datetime.fromtimestamp(started, tz=timezone.utc)
    if start_instant < OLDEST_EVENT or start_instant > now + timedelta(days=2 if window == "last" else 120):
        raise CaptureFailure("invalid_start")
    home_team = event.get("homeTeam")
    away_team = event.get("awayTeam")
    home_team_id = positive_id(home_team.get("id") if isinstance(home_team, dict) else None)
    away_team_id = positive_id(away_team.get("id") if isinstance(away_team, dict) else None)
    if home_team_id == away_team_id:
        raise CaptureFailure("invalid_event")
    round_info = event.get("roundInfo")
    round_number = round_info.get("round") if isinstance(round_info, dict) else None
    if round_number is not None and (isinstance(round_number, bool) or not isinstance(round_number, int)
                                     or not 0 < round_number <= 200):
        round_number = None
    captured: dict[str, Any] = {
        "sofascore_id": identifier,
        "start_timestamp": started,
        "status_type": captured_status,
        "round": round_number,
        "home_team_id": home_team_id,
        "away_team_id": away_team_id,
    }
    if window == "last" and captured_status == "finished":
        home_score_current = score_field(event.get("homeScore"), "current")
        away_score_current = score_field(event.get("awayScore"), "current")
        if home_score_current is None or away_score_current is None:
            raise CaptureFailure("missing_score")
        home_halftime = score_field(event.get("homeScore"), "period1")
        away_halftime = score_field(event.get("awayScore"), "period1")
        captured["home_score"] = home_score_current
        captured["away_score"] = away_score_current
        if home_halftime is not None:
            captured["home_score_halftime"] = home_halftime
        if away_halftime is not None:
            captured["away_score_halftime"] = away_halftime
    return captured


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def utc_timestamp(instant: datetime) -> str:
    if instant.tzinfo is None:
        raise ValueError("Fetch timestamps must include a timezone.")
    return instant.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def validate_output(catalog_path: Path, output_path: Path) -> None:
    if catalog_path.resolve() == output_path.resolve():
        raise ValueError("Output must not be the input catalog.")
    if output_path.exists() or output_path.is_symlink():
        raise ValueError("Output already exists; choose a new capture file.")
    if output_path.suffix.lower() != ".json":
        raise ValueError("Output must be a JSON file.")


def write_capture(output_path: Path, capture: dict[str, Any]) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=".recent-matches-", suffix=".tmp", dir=output_path.parent)
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            json.dump(capture, stream, ensure_ascii=False, indent=2, allow_nan=False)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        # Publishing a hard link is atomic and refuses an existing target, unlike replace().
        os.link(temporary_path, output_path)
    finally:
        temporary_path.unlink(missing_ok=True)


def default_output_path() -> Path:
    stamp = utc_now().strftime("%Y%m%dT%H%M%S%fZ")
    return Path(__file__).resolve().parents[1] / ".provider-runs" / "sofascore" / f"recent-matches-{stamp}-{uuid4().hex[:8]}.json"


def events_endpoint(tournament_id: int, season_id: int, window: str = "last", page: int = 0) -> str:
    return f"{API_BASE}/unique-tournament/{tournament_id}/season/{season_id}/events/{window}/{page}"


def seasons_endpoint(tournament_id: int) -> str:
    return f"{API_BASE}/unique-tournament/{tournament_id}/seasons"


def fetch_payload(transport: Transport, endpoint: str, sleep: Callable[[float], None], attempted: list[int]) -> tuple[Any, str | None, int | None]:
    if attempted[0]:
        sleep(REQUEST_DELAY_SECONDS)
    attempted[0] += 1
    try:
        response = transport(endpoint, timeout=REQUEST_TIMEOUT_SECONDS)
    except Exception:
        # Transport libraries have different exceptions; never expose their diagnostic text.
        return None, "transport_error", None
    status = response.status_code
    if status != 200:
        return None, f"http_{status}" if isinstance(status, int) else "invalid_response", status
    try:
        return response.json(), None, status
    except (ValueError, TypeError):
        return None, "non_json", status


def extract_finished_events(payload: Any, now: datetime, window: str = "last") -> list[dict[str, Any]]:
    if not isinstance(payload, dict) or not isinstance(payload.get("events"), list):
        raise CaptureFailure("partial_response")
    captured: list[dict[str, Any]] = []
    for event in payload["events"]:
        try:
            captured.append(validate_event(event, now, window))
        except CaptureFailure:
            continue
    captured.sort(key=lambda item: item["start_timestamp"], reverse=window == "last")
    return captured[:MAX_EVENTS_PER_TOURNAMENT]


def detect_current_season(transport: Transport, league: LeagueScope, sleep: Callable[[float], None],
                          attempted: list[int], now: datetime) -> tuple[int, list[dict[str, Any]]] | None:
    payload, reason, status = fetch_payload(transport, seasons_endpoint(league.tournament_id), sleep, attempted)
    if reason or not isinstance(payload, dict) or not isinstance(payload.get("seasons"), list):
        return None
    probes = 0
    for season in payload["seasons"]:
        if not isinstance(season, dict):
            continue
        try:
            season_id = positive_id(season.get("id"))
        except ValueError:
            continue
        if season_id == league.season_id:
            continue
        probes += 1
        if probes > MAX_SEASON_PROBES:
            break
        payload, reason, _ = fetch_payload(transport, events_endpoint(league.tournament_id, season_id), sleep, attempted)
        if reason or payload is None:
            continue
        try:
            events = extract_finished_events(payload, now)
        except CaptureFailure:
            continue
        if events and now - datetime.fromtimestamp(events[0]["start_timestamp"], tz=timezone.utc) <= STALE_WINDOW:
            return season_id, events
    return None


def run_fetch(catalog_path: Path, output_path: Path, *, transport: Transport,
              limit_tournaments: int | None = None,
              tournament_id: int | None = None,
              window: str = "last",
              pages: int = 1,
              now: Callable[[], datetime] = utc_now,
              sleep: Callable[[float], None] = time.sleep) -> dict[str, Any]:
    if limit_tournaments is not None:
        positive_id(limit_tournaments)
    if tournament_id is not None:
        positive_id(tournament_id)
    if not 1 <= pages <= MAX_EVENT_PAGES:
        raise ValueError(f"--pages must be between 1 and {MAX_EVENT_PAGES}.")
    catalog_path, output_path = Path(catalog_path), Path(output_path)
    validate_output(catalog_path, output_path)
    try:
        catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise ValueError("Catalog cannot be read as JSON.") from error
    leagues = select_leagues(catalog, limit_tournaments, tournament_id)
    snapshot_instant = now()
    tournaments: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []
    seen_events: set[int] = set()
    attempted = [0]
    stopped_status: int | None = None
    events_total = 0
    for league in leagues:
        if stopped_status is not None:
            failures.append({"tournamentId": league.tournament_id, "status": None,
                             "reason": f"skipped_after_http_{stopped_status}"})
            continue
        season_id = league.season_id
        season_detected = False
        page_limit = pages if window == "last" else 1

        def fetch_pages(target_season: int) -> tuple[list[dict[str, Any]], str | None, int | None]:
            merged: list[dict[str, Any]] = []
            for page in range(page_limit):
                endpoint = events_endpoint(league.tournament_id, target_season, window, page)
                payload, page_reason, page_status = fetch_payload(transport, endpoint, sleep, attempted)
                if page_status in (403, 429):
                    return merged, page_reason, page_status
                if page_reason is not None:
                    return merged, page_reason, page_status
                try:
                    page_events = extract_finished_events(payload, snapshot_instant, window)
                except CaptureFailure as error:
                    return merged, str(error), page_status
                if not page_events:
                    break
                merged.extend(page_events)
                if len(page_events) < MAX_EVENTS_PER_TOURNAMENT:
                    break
            return merged, None, 200

        events, reason, status = fetch_pages(season_id)
        if status in (403, 429):
            stopped_status = status
        if window == "last":
            latest = max((event["start_timestamp"] for event in events), default=None)
            stale = latest is None or snapshot_instant - datetime.fromtimestamp(latest, tz=timezone.utc) > STALE_WINDOW
            if reason is None and stale and stopped_status is None:
                detected = detect_current_season(transport, league, sleep, attempted, snapshot_instant)
                if detected is not None:
                    season_id, _ = detected
                    season_detected = True
                    events, reason, status = fetch_pages(season_id)
                    if status in (403, 429):
                        stopped_status = status
        if reason is not None and not events:
            failures.append({"tournamentId": league.tournament_id, "seasonId": season_id,
                             "status": status, "reason": reason})
            continue
        if reason is not None:
            failures.append({"tournamentId": league.tournament_id, "seasonId": season_id,
                             "status": status, "reason": f"partial_pages:{reason}"})
        if window == "last":
            latest = max((event["start_timestamp"] for event in events), default=None)
            if latest is None or snapshot_instant - datetime.fromtimestamp(latest, tz=timezone.utc) > STALE_WINDOW:
                failures.append({"tournamentId": league.tournament_id, "seasonId": season_id,
                                 "status": 200, "reason": "no_recent_events"})
        events.sort(key=lambda item: item["start_timestamp"], reverse=window == "last")
        fresh_events: list[dict[str, Any]] = []
        for event in events:
            if event["sofascore_id"] in seen_events:
                continue
            seen_events.add(event["sofascore_id"])
            fresh_events.append(event)
        fresh_events = fresh_events[:MAX_EVENTS_TOTAL]
        events_total += len(fresh_events)
        tournaments.append({
            "sofascore_tournament_id": league.tournament_id,
            "season_id": season_id,
            "season_detected": season_detected,
            "league_name": league.label,
            "events": fresh_events,
        })
    fetched = [tournament for tournament in tournaments if tournament["events"]]
    capture = {
        "source": "sofascore",
        "capturedAt": utc_timestamp(snapshot_instant),
        "tournaments": tournaments,
    }
    if fetched:
        write_capture(output_path, capture)
    return {
        "requested_leagues": len(leagues),
        "fetched_leagues": len(fetched),
        "events_total": events_total,
        "attempted_requests": attempted[0],
        "failures": failures,
        "output": str(output_path) if fetched else None,
    }


class ImpersonationTransport:
    """Tries impersonation profiles in order and sticks to the first that works."""

    def __init__(self, session: Any, candidates: tuple[str, ...] = IMPERSONATE_CANDIDATES):
        if not candidates:
            raise ValueError("At least one impersonation candidate is required.")
        self.session = session
        self.candidates = candidates
        self.index = 0
        self.active = candidates[0]

    def __call__(self, url: str, *, timeout: int) -> ProviderResponse:
        last: ProviderResponse | None = None
        for index in range(self.index, len(self.candidates)):
            impersonate = self.candidates[index]
            response = self.session.get(url, timeout=timeout, impersonate=impersonate, allow_redirects=False,
                                        headers={"Accept": "application/json", "Referer": "https://www.sofascore.com/"})
            if response.status_code != 403:
                self.index = index
                self.active = impersonate
                return response
            last = response
        assert last is not None
        self.active = self.candidates[-1]
        return last


def main(argv: list[str] | None = None) -> int:
    options = parse_args(argv)
    output = options.output or default_output_path()
    try:
        from curl_cffi import requests
    except ImportError:
        print(json.dumps({"error": "curl_cffi is required; install it with pip install curl_cffi."}))
        return 2
    transport: ImpersonationTransport | None = None
    try:
        with requests.Session() as session:
            transport = ImpersonationTransport(session)
            summary = run_fetch(options.catalog, output, transport=transport,
                                limit_tournaments=options.limit_tournaments,
                                tournament_id=options.tournament_id,
                                window=options.window,
                                pages=options.pages)
    except ValueError as error:
        print(json.dumps({"error": str(error)}))
        return 2
    except OSError:
        print(json.dumps({"error": "Capture output could not be published; no existing file was overwritten."}))
        return 2
    if transport is not None:
        summary["impersonate"] = transport.active
    print(json.dumps(summary, ensure_ascii=False, allow_nan=False))
    if not summary["fetched_leagues"]:
        return 1
    return 0 if not summary["failures"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
