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
MAX_GOALS = 30
REQUEST_TIMEOUT_SECONDS = 15
REQUEST_DELAY_SECONDS = 0.7
STALE_WINDOW = timedelta(days=60)
OLDEST_EVENT = datetime(2020, 1, 1, tzinfo=timezone.utc)
ALLOWED_STATUS_TYPES = {"finished", "ended"}
MAX_SEASON_PROBES = 3
# The chrome124 TLS profile and the api.sofascore.com host are rejected by the
# provider edge; the current chrome profile on www.sofascore.com passes.
API_BASE = "https://www.sofascore.com/api/v1"
IMPERSONATE = "chrome"


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


def validate_event(event: Any, now: datetime) -> dict[str, Any]:
    if not isinstance(event, dict):
        raise CaptureFailure("invalid_event")
    status = event.get("status")
    status_type = status.get("type") if isinstance(status, dict) else None
    if status_type not in ALLOWED_STATUS_TYPES:
        raise CaptureFailure("not_finished")
    identifier = positive_id(event.get("id"))
    started = event.get("startTimestamp")
    if isinstance(started, bool) or not isinstance(started, int):
        raise CaptureFailure("invalid_start")
    start_instant = datetime.fromtimestamp(started, tz=timezone.utc)
    if start_instant < OLDEST_EVENT or start_instant > now + timedelta(days=2):
        raise CaptureFailure("invalid_start")
    home_team = event.get("homeTeam")
    away_team = event.get("awayTeam")
    home_team_id = positive_id(home_team.get("id") if isinstance(home_team, dict) else None)
    away_team_id = positive_id(away_team.get("id") if isinstance(away_team, dict) else None)
    if home_team_id == away_team_id:
        raise CaptureFailure("invalid_event")
    home_score_current = score_field(event.get("homeScore"), "current")
    away_score_current = score_field(event.get("awayScore"), "current")
    if home_score_current is None or away_score_current is None:
        raise CaptureFailure("missing_score")
    home_halftime = score_field(event.get("homeScore"), "period1")
    away_halftime = score_field(event.get("awayScore"), "period1")
    round_info = event.get("roundInfo")
    round_number = round_info.get("round") if isinstance(round_info, dict) else None
    if round_number is not None and (isinstance(round_number, bool) or not isinstance(round_number, int)
                                     or not 0 < round_number <= 200):
        round_number = None
    captured: dict[str, Any] = {
        "sofascore_id": identifier,
        "start_timestamp": started,
        "status_type": "finished",
        "round": round_number,
        "home_team_id": home_team_id,
        "away_team_id": away_team_id,
        "home_score": home_score_current,
        "away_score": away_score_current,
    }
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


def events_endpoint(tournament_id: int, season_id: int) -> str:
    return f"{API_BASE}/unique-tournament/{tournament_id}/season/{season_id}/events/last/0"


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


def extract_finished_events(payload: Any, now: datetime) -> list[dict[str, Any]]:
    if not isinstance(payload, dict) or not isinstance(payload.get("events"), list):
        raise CaptureFailure("partial_response")
    finished: list[dict[str, Any]] = []
    for event in payload["events"]:
        try:
            finished.append(validate_event(event, now))
        except CaptureFailure:
            continue
    finished.sort(key=lambda item: item["start_timestamp"], reverse=True)
    return finished[:MAX_EVENTS_PER_TOURNAMENT]


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
              now: Callable[[], datetime] = utc_now,
              sleep: Callable[[float], None] = time.sleep) -> dict[str, Any]:
    if limit_tournaments is not None:
        positive_id(limit_tournaments)
    if tournament_id is not None:
        positive_id(tournament_id)
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
        payload, reason, status = fetch_payload(transport, events_endpoint(league.tournament_id, season_id), sleep, attempted)
        if status in (403, 429):
            stopped_status = status
        if reason is None:
            try:
                events = extract_finished_events(payload, snapshot_instant)
            except CaptureFailure as error:
                reason = str(error)
                events = []
        else:
            events = []
        latest = events[0]["start_timestamp"] if events else None
        stale = latest is None or snapshot_instant - datetime.fromtimestamp(latest, tz=timezone.utc) > STALE_WINDOW
        if reason is None and stale and stopped_status is None:
            detected = detect_current_season(transport, league, sleep, attempted, snapshot_instant)
            if detected is not None:
                season_id, events = detected
                season_detected = True
                latest = events[0]["start_timestamp"] if events else None
                stale = latest is None
        if reason is not None:
            failures.append({"tournamentId": league.tournament_id, "seasonId": season_id,
                             "status": status, "reason": reason})
            continue
        if stale:
            failures.append({"tournamentId": league.tournament_id, "seasonId": season_id,
                             "status": 200, "reason": "no_recent_events"})
        fresh_events: list[dict[str, Any]] = []
        for event in events:
            if event["sofascore_id"] in seen_events:
                continue
            seen_events.add(event["sofascore_id"])
            fresh_events.append(event)
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


def main(argv: list[str] | None = None) -> int:
    options = parse_args(argv)
    output = options.output or default_output_path()
    try:
        from curl_cffi import requests
    except ImportError:
        print(json.dumps({"error": "curl_cffi is required; install it with pip install curl_cffi."}))
        return 2
    try:
        with requests.Session() as session:
            def transport(url: str, *, timeout: int) -> ProviderResponse:
                return session.get(url, timeout=timeout, impersonate=IMPERSONATE, allow_redirects=False,
                                   headers={"Accept": "application/json", "Referer": "https://www.sofascore.com/"})
            summary = run_fetch(options.catalog, output, transport=transport,
                                limit_tournaments=options.limit_tournaments,
                                tournament_id=options.tournament_id)
    except ValueError as error:
        print(json.dumps({"error": str(error)}))
        return 2
    except OSError:
        print(json.dumps({"error": "Capture output could not be published; no existing file was overwritten."}))
        return 2
    print(json.dumps(summary, ensure_ascii=False, allow_nan=False))
    if not summary["fetched_leagues"]:
        return 1
    return 0 if not summary["failures"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
