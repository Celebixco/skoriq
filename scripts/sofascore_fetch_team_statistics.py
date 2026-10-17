"""Capture selected SofaScore team-season statistics without database writes."""

import argparse
import json
import math
import os
import tempfile
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Protocol
from uuid import uuid4

MAX_LIMIT = 30
MAX_SAFE_INTEGER = 9_007_199_254_740_991
REQUEST_TIMEOUT_SECONDS = 15
REQUEST_DELAY_SECONDS = 1.0
LEAGUE_IDENTITY_FIELDS = (
    "country", "country_code", "country_slug", "league_name", "league_slug",
    "sofascore_tournament_id", "tournament_logo_url", "season_id", "season_name",
)
TEAM_IDENTITY_FIELDS = (
    "sofascore_id", "name", "short_name", "name_code", "slug", "logo_url",
    "country_name", "country_code", "country_slug", "team_colors",
)


class ProviderResponse(Protocol):
    status_code: int

    def json(self) -> Any: ...


Transport = Callable[..., ProviderResponse]


@dataclass(frozen=True)
class TeamScope:
    league: dict[str, Any]
    team: dict[str, Any]
    team_id: int
    tournament_id: int
    season_id: int

    @property
    def endpoint(self) -> str:
        return (
            f"https://www.sofascore.com/api/v1/team/{self.team_id}"
            f"/unique-tournament/{self.tournament_id}/season/{self.season_id}"
            "/statistics/overall"
        )


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


def limit_argument(value: str) -> int:
    limit = positive_argument(value)
    if limit > MAX_LIMIT:
        raise argparse.ArgumentTypeError(f"Limit must be between 1 and {MAX_LIMIT}.")
    return limit


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, default=Path(__file__).with_name("sofascore_catalog.json"))
    parser.add_argument("--output", type=Path, help="New JSON capture file; existing files are never overwritten.")
    parser.add_argument("--limit", type=limit_argument, default=1, help="Maximum requests, 1-20; default 1.")
    parser.add_argument("--team-id", type=positive_argument)
    parser.add_argument("--tournament-id", type=positive_argument)
    return parser.parse_args(argv)


def select_scopes(catalog: Any, limit: int, team_id: int | None,
                  tournament_id: int | None) -> list[TeamScope]:
    if isinstance(catalog, dict):
        catalog = catalog.get("leagues")
    if not isinstance(catalog, list):
        raise ValueError("Catalog must contain a league list.")
    selected: list[TeamScope] = []
    seen: set[tuple[int, int, int]] = set()
    for league in catalog:
        if not isinstance(league, dict):
            raise ValueError("Catalog league entries must be objects.")
        tournament = positive_id(league.get("sofascore_tournament_id"))
        if tournament_id is not None and tournament != tournament_id:
            continue
        season = positive_id(league.get("season_id"))
        teams = league.get("teams")
        if not isinstance(teams, list):
            raise ValueError("Catalog league teams must be a list.")
        for team in teams:
            if not isinstance(team, dict):
                raise ValueError("Catalog team entries must be objects.")
            identifier = positive_id(team.get("sofascore_id"))
            if team_id is not None and identifier != team_id:
                continue
            scope_key = (identifier, tournament, season)
            if scope_key in seen:
                continue
            seen.add(scope_key)
            selected.append(TeamScope(league, team, identifier, tournament, season))
            if len(selected) == limit:
                return selected
    return selected


def validate_statistics(payload: Any) -> dict[str, int | float]:
    if not isinstance(payload, dict) or payload.get("error") or payload.get("errors"):
        raise CaptureFailure("partial_response")
    statistics = payload.get("statistics")
    if not isinstance(statistics, dict):
        raise CaptureFailure("partial_response")
    if not statistics:
        raise CaptureFailure("empty_statistics")
    metrics: dict[str, int | float] = {}
    for key, value in statistics.items():
        if key == "statisticsType":
            continue
        if (isinstance(value, bool) or not isinstance(value, (int, float))
                or abs(value) > MAX_SAFE_INTEGER
                or (isinstance(value, float) and not math.isfinite(value))):
            raise CaptureFailure("invalid_numeric")
        metrics[key] = value
    matches = metrics.get("matches")
    if matches is None:
        raise CaptureFailure("partial_statistics")
    if matches <= 0:
        raise CaptureFailure("no_played_matches")
    if matches != int(matches):
        raise CaptureFailure("invalid_numeric")
    if not metrics.keys() - {"matches", "id", "awardedMatches", "avgRatingVersion"}:
        raise CaptureFailure("partial_statistics")
    return metrics


def validate_output(catalog_path: Path, output_path: Path) -> None:
    if catalog_path.resolve() == output_path.resolve():
        raise ValueError("Output must not be the input catalog.")
    if output_path.exists() or output_path.is_symlink():
        raise ValueError("Output already exists; choose a new capture file.")
    if output_path.suffix.lower() != ".json":
        raise ValueError("Output must be a JSON file.")


def write_capture(output_path: Path, captured: list[dict[str, Any]]) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=".team-statistics-", suffix=".tmp", dir=output_path.parent)
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            json.dump(captured, stream, ensure_ascii=False, indent=2, allow_nan=False)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        # Publishing a hard link is atomic and refuses an existing target, unlike replace().
        os.link(temporary_path, output_path)
    finally:
        temporary_path.unlink(missing_ok=True)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def utc_timestamp(instant: datetime) -> str:
    if instant.tzinfo is None:
        raise ValueError("Fetch timestamps must include a timezone.")
    return instant.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def run_fetch(catalog_path: Path, output_path: Path, *, transport: Transport,
              limit: int = 1, team_id: int | None = None, tournament_id: int | None = None,
              now: Callable[[], datetime] = utc_now,
              sleep: Callable[[float], None] = time.sleep) -> dict[str, Any]:
    positive_id(limit)
    if limit > MAX_LIMIT:
        raise ValueError(f"Limit must be between 1 and {MAX_LIMIT}.")
    if team_id is not None:
        positive_id(team_id)
    if tournament_id is not None:
        positive_id(tournament_id)
    catalog_path, output_path = Path(catalog_path), Path(output_path)
    validate_output(catalog_path, output_path)
    try:
        catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise ValueError("Catalog cannot be read as JSON.") from error
    scopes = select_scopes(catalog, limit, team_id, tournament_id)
    captured: dict[tuple[int, int], dict[str, Any]] = {}
    failures: list[dict[str, Any]] = []
    attempted = succeeded = 0
    stopped_status: int | None = None
    for scope in scopes:
        status: int | None = None
        reason: str | None = None
        if stopped_status is not None:
            reason = f"skipped_after_http_{stopped_status}"
        else:
            if attempted:
                sleep(REQUEST_DELAY_SECONDS)
            attempted += 1
            try:
                response = transport(scope.endpoint, timeout=REQUEST_TIMEOUT_SECONDS)
            except Exception:
                # Transport libraries have different exceptions; never expose their diagnostic text.
                reason = "transport_error"
            else:
                fetched_at = utc_timestamp(now())
                status = response.status_code
                if status != 200:
                    reason = f"http_{status}" if isinstance(status, int) else "invalid_response"
                    if status in (403, 429):
                        stopped_status = status
                else:
                    try:
                        payload = response.json()
                    except (ValueError, TypeError):
                        reason = "non_json"
                    else:
                        try:
                            metrics = validate_statistics(payload)
                        except CaptureFailure as error:
                            reason = str(error)
                        else:
                            key = (scope.tournament_id, scope.season_id)
                            if key not in captured:
                                captured[key] = {field: scope.league[field] for field in LEAGUE_IDENTITY_FIELDS
                                                 if field in scope.league}
                                captured[key]["teams"] = []
                            team = {field: scope.team[field] for field in TEAM_IDENTITY_FIELDS if field in scope.team}
                            team.update(season_statistics=metrics, providerFetchedAt=fetched_at,
                                        endpoint=scope.endpoint, source="sofascore")
                            captured[key]["teams"].append(team)
                            succeeded += 1
        if reason:
            failures.append({"teamId": scope.team_id, "tournamentId": scope.tournament_id,
                             "seasonId": scope.season_id, "endpoint": scope.endpoint,
                             "status": status, "reason": reason})
    leagues = list(captured.values())
    for league in leagues:
        league["teams_count"] = len(league["teams"])
    if succeeded:
        write_capture(output_path, leagues)
    return {"requested": len(scopes), "attempted": attempted, "succeeded": succeeded,
            "failed": len(failures), "partial": 0 < succeeded < len(scopes), "failures": failures,
            "output": str(output_path) if succeeded else None}


def default_output_path() -> Path:
    stamp = utc_now().strftime("%Y%m%dT%H%M%S%fZ")
    return Path(__file__).resolve().parents[1] / ".provider-samples" / "sofascore" / f"team-statistics-{stamp}-{uuid4().hex[:8]}.json"


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
                return session.get(url, timeout=timeout, impersonate="chrome", allow_redirects=False,
                                   headers={"Accept": "application/json", "Referer": "https://www.sofascore.com/"})
            summary = run_fetch(options.catalog, output, transport=transport, limit=options.limit,
                                team_id=options.team_id, tournament_id=options.tournament_id)
    except ValueError as error:
        print(json.dumps({"error": str(error)}))
        return 2
    except OSError:
        print(json.dumps({"error": "Capture output could not be published; no existing file was overwritten."}))
        return 2
    print(json.dumps(summary, ensure_ascii=False, allow_nan=False))
    return 0 if summary["succeeded"] and not summary["failed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
