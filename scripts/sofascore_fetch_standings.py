"""Capture current SofaScore standings for the configured leagues without database writes."""

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any, Callable
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parent))

from sofascore_fetch_recent_matches import (  # noqa: E402
    API_BASE,
    MAX_SAFE_INTEGER,
    REQUEST_DELAY_SECONDS,
    REQUEST_TIMEOUT_SECONDS,
    CaptureFailure,
    ImpersonationTransport,
    LeagueScope,
    utc_now,
    utc_timestamp,
    write_capture,
)

MAX_TABLE_ROWS = 40
MAX_FORM_LENGTH = 10
Transport = Callable[..., Any]


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, default=Path(__file__).with_name("sofascore_catalog.json"))
    parser.add_argument("--output", type=Path, help="New JSON capture file; existing files are never overwritten.")
    parser.add_argument("--limit-tournaments", type=int, default=None)
    parser.add_argument("--tournament-id", type=int, default=None)
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
            continue
        try:
            tournament_value = int(league.get("sofascore_tournament_id"))
            season_id = int(league.get("season_id"))
        except (TypeError, ValueError):
            continue
        if not 0 < tournament_value <= MAX_SAFE_INTEGER or not 0 < season_id <= MAX_SAFE_INTEGER:
            continue
        if tournament_id is not None and tournament_value != tournament_id:
            continue
        if tournament_value in seen:
            continue
        seen.add(tournament_value)
        selected.append(LeagueScope(tournament_value, season_id, str(league.get("league_name") or tournament_value)))
        if limit is not None and len(selected) == limit:
            break
    if not selected:
        raise ValueError("Catalog did not contain any usable leagues.")
    return selected


def standings_endpoint(tournament_id: int, season_id: int) -> str:
    return f"{API_BASE}/unique-tournament/{tournament_id}/season/{season_id}/standings/total"


def bounded_int(value: Any, minimum: int, maximum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
        raise CaptureFailure("invalid_standing_value")
    return value


def validate_row(row: Any) -> dict[str, Any]:
    if not isinstance(row, dict):
        raise CaptureFailure("invalid_row")
    team = row.get("team")
    team_id = bounded_int(team.get("id") if isinstance(team, dict) else None, 1, MAX_SAFE_INTEGER)
    played = bounded_int(row.get("matches"), 0, 100)
    wins = bounded_int(row.get("wins"), 0, 100)
    draws = bounded_int(row.get("draws"), 0, 100)
    losses = bounded_int(row.get("losses"), 0, 100)
    goals_for = bounded_int(row.get("scoresFor"), 0, 500)
    goals_against = bounded_int(row.get("scoresAgainst"), 0, 500)
    points = bounded_int(row.get("points"), 0, 300)
    position = bounded_int(row.get("position"), 1, MAX_TABLE_ROWS)
    if wins + draws + losses != played:
        raise CaptureFailure("inconsistent_row")
    form = row.get("form")
    form_string = None
    if isinstance(form, str) and 0 < len(form) <= MAX_FORM_LENGTH and all(letter in "WDL" for letter in form):
        form_string = form
    return {
        "position": position,
        "team_id": team_id,
        "played": played,
        "wins": wins,
        "draws": draws,
        "losses": losses,
        "goals_for": goals_for,
        "goals_against": goals_against,
        "points": points,
        "form": form_string,
    }


def select_table_group(payload: Any) -> list[dict[str, Any]]:
    if not isinstance(payload, dict) or not isinstance(payload.get("standings"), list):
        raise CaptureFailure("partial_response")
    tables = [entry for entry in payload["standings"] if isinstance(entry, dict) and isinstance(entry.get("rows"), list)]
    if not tables:
        raise CaptureFailure("partial_response")
    total = next((entry for entry in tables if str(entry.get("name", "")).strip().lower() == "total"), None)
    chosen = total or tables[0]
    rows: list[dict[str, Any]] = []
    for row in chosen["rows"][:MAX_TABLE_ROWS]:
        try:
            rows.append(validate_row(row))
        except CaptureFailure:
            continue
    if not rows:
        raise CaptureFailure("no_rows")
    rows.sort(key=lambda item: item["position"])
    return rows


def run_fetch(catalog_path: Path, output_path: Path, *, transport: Transport,
              limit_tournaments: int | None = None, tournament_id: int | None = None,
              now: Callable[[], Any] = utc_now,
              sleep: Callable[[float], None] = time.sleep) -> dict[str, Any]:
    catalog_path, output_path = Path(catalog_path), Path(output_path)
    if output_path.exists() or output_path.is_symlink():
        raise ValueError("Output already exists; choose a new capture file.")
    try:
        catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise ValueError("Catalog cannot be read as JSON.") from error
    leagues = select_leagues(catalog, limit_tournaments, tournament_id)
    snapshot_instant = now()
    tournaments: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []
    attempted = 0
    stopped_status: int | None = None
    for league in leagues:
        if stopped_status is not None:
            failures.append({"tournamentId": league.tournament_id, "reason": f"skipped_after_http_{stopped_status}"})
            continue
        if attempted:
            sleep(REQUEST_DELAY_SECONDS)
        attempted += 1
        try:
            response = transport(standings_endpoint(league.tournament_id, league.season_id), timeout=REQUEST_TIMEOUT_SECONDS)
        except Exception:
            failures.append({"tournamentId": league.tournament_id, "reason": "transport_error"})
            continue
        if response.status_code in (403, 429):
            stopped_status = response.status_code
            failures.append({"tournamentId": league.tournament_id, "status": response.status_code, "reason": f"http_{response.status_code}"})
            continue
        if response.status_code != 200:
            failures.append({"tournamentId": league.tournament_id, "status": response.status_code, "reason": f"http_{response.status_code}"})
            continue
        try:
            payload = response.json()
        except (ValueError, TypeError):
            failures.append({"tournamentId": league.tournament_id, "reason": "non_json"})
            continue
        try:
            rows = select_table_group(payload)
        except CaptureFailure as error:
            failures.append({"tournamentId": league.tournament_id, "reason": str(error)})
            continue
        tournaments.append({
            "sofascore_tournament_id": league.tournament_id,
            "season_id": league.season_id,
            "league_name": league.label,
            "standings": rows,
        })
    capture = {
        "source": "sofascore-standings",
        "capturedAt": utc_timestamp(snapshot_instant),
        "tournaments": tournaments,
    }
    if tournaments:
        write_capture(output_path, capture)
    return {
        "requested_leagues": len(leagues),
        "fetched_leagues": len(tournaments),
        "rows_total": sum(len(item["standings"]) for item in tournaments),
        "attempted_requests": attempted,
        "failures": failures,
        "output": str(output_path) if tournaments else None,
    }


def default_output_path() -> Path:
    stamp = utc_now().strftime("%Y%m%dT%H%M%S%fZ")
    return Path(__file__).resolve().parents[1] / ".provider-runs" / "sofascore" / f"standings-{stamp}-{uuid4().hex[:8]}.json"


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
                                tournament_id=options.tournament_id)
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
