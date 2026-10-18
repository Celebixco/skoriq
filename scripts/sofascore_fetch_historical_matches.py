"""Capture previous-season SofaScore matches for H2H and historical depth."""

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parent))

from sofascore_fetch_recent_matches import (  # noqa: E402
    API_BASE,
    ImpersonationTransport,
    MAX_EVENT_PAGES,
    CaptureFailure,
    events_endpoint,
    fetch_payload,
    positive_argument,
    select_leagues,
    seasons_endpoint,
    utc_now,
    utc_timestamp,
    validate_event,
    write_capture,
)

MAX_SEASONS = 5
MAX_ROUNDS = 60
DEFAULT_CATALOG = Path(__file__).resolve().parent / "sofascore_catalog.json"


def rounds_endpoint(tournament_id: int, season_id: int, round_number: int) -> str:
    return f"{API_BASE}/unique-tournament/{tournament_id}/season/{season_id}/events/round/{round_number}"


def season_count_argument(value: str) -> int:
    count = positive_argument(value)
    if count > MAX_SEASONS:
        raise argparse.ArgumentTypeError(f"Season count must be between 1 and {MAX_SEASONS}.")
    return count


def page_count_argument(value: str) -> int:
    pages = positive_argument(value)
    if pages > MAX_EVENT_PAGES:
        raise argparse.ArgumentTypeError(f"Page count must be between 1 and {MAX_EVENT_PAGES}.")
    return pages


def round_count_argument(value: str) -> int:
    try:
        rounds = int(value)
    except (TypeError, ValueError):
        raise argparse.ArgumentTypeError("Round count must be a non-negative integer.") from None
    if not 0 <= rounds <= MAX_ROUNDS:
        raise argparse.ArgumentTypeError(f"Round count must be between 0 and {MAX_ROUNDS}.")
    return rounds


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    parser.add_argument("--output", type=Path, required=True, help="New JSON capture file; existing files are never overwritten.")
    parser.add_argument("--seasons", type=season_count_argument, default=2, help=f"Previous seasons per league (1-{MAX_SEASONS}).")
    parser.add_argument("--pages", type=page_count_argument, default=2, help=f"Event pages per season (1-{MAX_EVENT_PAGES}).")
    parser.add_argument("--rounds", type=round_count_argument, default=0, help=f"Fetch full seasons by round instead of pages (1-{MAX_ROUNDS}).")
    parser.add_argument("--tournament-id", type=positive_argument)
    parser.add_argument("--limit", type=positive_argument)
    return parser.parse_args(argv)


def read_catalog(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise ValueError("SofaScore catalog cannot be read as JSON.") from error


def season_year(season: dict[str, Any], season_id: int) -> int | None:
    raw = season.get("year")
    if isinstance(raw, int) and not isinstance(raw, bool) and 1900 <= raw <= 2200:
        return raw
    if isinstance(raw, str):
        match = re.fullmatch(r"\s*(\d{2})/(\d{2})\s*", raw)
        if match:
            start = int(match.group(1))
            return 1900 + start if start >= 70 else 2000 + start
    name = season.get("name")
    if isinstance(name, str):
        match = re.search(r"\b(20\d{2})/(\d{2})\b", name)
        if match:
            return int(match.group(1))
        match = re.search(r"\b(\d{2})/(\d{2})\b", name)
        if match:
            start = int(match.group(1))
            return 1900 + start if start >= 70 else 2000 + start
    return None


def previous_seasons(payload: Any, current_season_id: int, limit: int) -> list[dict[str, Any]]:
    if not isinstance(payload, dict) or not isinstance(payload.get("seasons"), list):
        raise CaptureFailure("seasons_unavailable")
    seasons: list[dict[str, Any]] = []
    current_year: int | None = None
    for raw in payload["seasons"]:
        if not isinstance(raw, dict):
            continue
        try:
            season_id = int(raw.get("id"))
        except (TypeError, ValueError):
            continue
        if season_id <= 0:
            continue
        year = season_year(raw, season_id)
        name = raw.get("name")
        if not isinstance(name, str) or not name.strip():
            name = f"{year}/{year + 1}" if year is not None else f"Season {season_id}"
        entry = {"season_id": season_id, "season_name": name.strip(), "year": year}
        seasons.append(entry)
        if season_id == current_season_id:
            current_year = year
    previous = [season for season in seasons if season["season_id"] != current_season_id]
    if current_year is not None:
        previous = [season for season in previous if season["year"] is None or season["year"] < current_year]
    else:
        previous = [season for season in previous if season["season_id"] < current_season_id]
    previous.sort(key=lambda season: (season["year"] if season["year"] is not None else 0, season["season_id"]), reverse=True)
    return previous[:limit]


def fetch_previous_seasons(transport: Any, league: Any, seasons: int, pages: int,
                           now: datetime, sleep: Callable[[float], None], attempted: list[int],
                           rounds: int = 0) -> tuple[list[dict[str, Any]], str | None]:
    payload, reason, _ = fetch_payload(transport, seasons_endpoint(league.tournament_id), sleep, attempted)
    if reason is not None:
        return [], reason
    try:
        candidates = previous_seasons(payload, league.season_id, seasons)
    except CaptureFailure as error:
        return [], str(error)
    if not candidates:
        return [], "no_previous_seasons"
    tournaments: list[dict[str, Any]] = []
    for season in candidates:
        events: list[dict[str, Any]] = []
        seen: set[int] = set()
        if rounds > 0:
            for round_number in range(1, rounds + 1):
                payload, reason, status = fetch_payload(
                    transport, rounds_endpoint(league.tournament_id, season["season_id"], round_number), sleep, attempted
                )
                if status in (400, 404):
                    break
                if reason is not None:
                    return tournaments, reason if not events else None
                raw_events = payload.get("events") if isinstance(payload, dict) else None
                if not isinstance(raw_events, list) or not raw_events:
                    break
                for raw in raw_events:
                    try:
                        event = validate_event(raw, now, "last")
                    except CaptureFailure:
                        continue
                    if event["sofascore_id"] in seen:
                        continue
                    seen.add(event["sofascore_id"])
                    events.append(event)
        else:
            for page in range(pages):
                payload, reason, status = fetch_payload(
                    transport, events_endpoint(league.tournament_id, season["season_id"], "last", page), sleep, attempted
                )
                if reason is not None:
                    return tournaments, reason if page == 0 else None
                raw_events = payload.get("events") if isinstance(payload, dict) else None
                if not isinstance(raw_events, list) or not raw_events:
                    break
                for raw in raw_events:
                    try:
                        event = validate_event(raw, now, "last")
                    except CaptureFailure:
                        continue
                    if event["sofascore_id"] in seen:
                        continue
                    seen.add(event["sofascore_id"])
                    events.append(event)
        if events:
            tournaments.append({
                "sofascore_tournament_id": league.tournament_id,
                "league_name": league.label,
                "season_id": season["season_id"],
                "season_name": season["season_name"],
                "season_kind": "historical",
                "season_detected": False,
                "events": events,
            })
    return tournaments, None


def validate_output(catalog_path: Path, output_path: Path) -> None:
    if catalog_path.resolve() == output_path.resolve():
        raise ValueError("Output must not be the catalog.")
    if output_path.exists() or output_path.is_symlink():
        raise ValueError("Output already exists; choose a new capture file.")
    if output_path.suffix.lower() != ".json":
        raise ValueError("Output must be a JSON file.")


def default_output_path() -> Path:
    stamp = utc_now().strftime("%Y%m%dT%H%M%S%fZ")
    return Path(__file__).resolve().parents[1] / ".provider-runs" / "sofascore" / f"historical-{stamp}-{uuid4().hex[:8]}.json"


def run_fetch(catalog_path: Path, output_path: Path, *, transport: Any, seasons: int = 2, pages: int = 2,
              rounds: int = 0, limit: int | None = None, tournament_id: int | None = None,
              now: Callable[[], datetime] = utc_now, sleep: Callable[[float], None] = lambda _: None) -> dict[str, Any]:
    if not 1 <= seasons <= MAX_SEASONS:
        raise ValueError(f"Season count must be between 1 and {MAX_SEASONS}.")
    if not 1 <= pages <= MAX_EVENT_PAGES:
        raise ValueError(f"Page count must be between 1 and {MAX_EVENT_PAGES}.")
    if not 0 <= rounds <= MAX_ROUNDS:
        raise ValueError(f"Round count must be between 0 and {MAX_ROUNDS}.")
    catalog_path, output_path = Path(catalog_path), Path(output_path)
    validate_output(catalog_path, output_path)
    leagues = select_leagues(read_catalog(catalog_path), limit=limit, tournament_id=tournament_id)
    snapshot_instant = now()
    attempted = [0]
    tournaments: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []
    for league in leagues:
        fetched, reason = fetch_previous_seasons(transport, league, seasons, pages, snapshot_instant, sleep, attempted, rounds=rounds)
        if reason is not None:
            failures.append({"tournamentId": league.tournament_id, "reason": reason})
        tournaments.extend(fetched)
    events_total = sum(len(tournament["events"]) for tournament in tournaments)
    capture = {
        "source": "sofascore",
        "capturedAt": utc_timestamp(snapshot_instant),
        "tournaments": tournaments,
    }
    if events_total:
        write_capture(output_path, capture)
    return {
        "leagues": len(leagues),
        "seasons": len(tournaments),
        "events": events_total,
        "attempted": attempted[0],
        "failures": failures,
        "output": str(output_path) if events_total else None,
    }


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
            summary = run_fetch(
                options.catalog, output, transport=transport, seasons=options.seasons, pages=options.pages,
                rounds=options.rounds, limit=options.limit, tournament_id=options.tournament_id
            )
    except ValueError as error:
        print(json.dumps({"error": str(error)}))
        return 2
    except OSError:
        print(json.dumps({"error": "Capture output could not be published; no existing file was overwritten."}))
        return 2
    if transport is not None:
        summary["impersonate"] = transport.active
    print(json.dumps(summary, ensure_ascii=False, allow_nan=False))
    return 0 if summary["events"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
