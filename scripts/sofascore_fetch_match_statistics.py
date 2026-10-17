"""Capture SofaScore full-time team statistics for selected events without database writes."""

import argparse
import json
import math
import os
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Protocol
from uuid import uuid4

MAX_MATCHES = 100
MAX_SAFE_INTEGER = 9_007_199_254_740_991
REQUEST_TIMEOUT_SECONDS = 15
REQUEST_DELAY_SECONDS = 0.7
API_BASE = "https://www.sofascore.com/api/v1"
IMPERSONATE_CANDIDATES = ("chrome", "chrome131", "chrome124", "safari")


class ProviderResponse(Protocol):
    status_code: int

    def json(self) -> Any: ...


Transport = Callable[..., ProviderResponse]


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
    if limit > MAX_MATCHES:
        raise argparse.ArgumentTypeError(f"Limit must be between 1 and {MAX_MATCHES}.")
    return limit


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True, help="JSON match list produced by the sync orchestrator.")
    parser.add_argument("--output", type=Path, help="New JSON capture file; existing files are never overwritten.")
    parser.add_argument("--limit", type=limit_argument, default=MAX_MATCHES, help=f"Maximum events to fetch (1-{MAX_MATCHES}).")
    return parser.parse_args(argv)


def read_input(input_path: Path) -> list[dict[str, int]]:
    try:
        document = json.loads(input_path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise ValueError("Match input cannot be read as JSON.") from error
    raw_matches = document.get("matches") if isinstance(document, dict) else document
    if not isinstance(raw_matches, list):
        raise ValueError("Match input must contain a matches list.")
    matches: list[dict[str, int]] = []
    seen: set[int] = set()
    for raw in raw_matches:
        if not isinstance(raw, dict):
            continue
        try:
            event_id = positive_id(raw.get("eventId"))
            home_team_id = positive_id(raw.get("homeTeamId"))
            away_team_id = positive_id(raw.get("awayTeamId"))
        except ValueError:
            continue
        if event_id in seen or home_team_id == away_team_id:
            continue
        seen.add(event_id)
        matches.append({"eventId": event_id, "homeTeamId": home_team_id, "awayTeamId": away_team_id})
    return matches


def statistics_endpoint(event_id: int) -> str:
    return f"{API_BASE}/event/{event_id}/statistics"


def fetch_payload(transport: Transport, endpoint: str, sleep: Callable[[float], None], attempted: list[int]) -> tuple[Any, str | None, int | None]:
    if attempted[0]:
        sleep(REQUEST_DELAY_SECONDS)
    attempted[0] += 1
    try:
        response = transport(endpoint, timeout=REQUEST_TIMEOUT_SECONDS)
    except Exception:
        return None, "transport_error", None
    status = response.status_code
    if status != 200:
        return None, f"http_{status}" if isinstance(status, int) else "invalid_response", status
    try:
        return response.json(), None, status
    except (ValueError, TypeError):
        return None, "non_json", status


def numeric_value(item: dict[str, Any], side: str) -> int | float | None:
    value = item.get(f"{side}Value")
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        text = item.get(side)
        if isinstance(text, str):
            cleaned = text.strip().replace("%", "").replace(",", ".")
            try:
                parsed = float(cleaned)
            except ValueError:
                return None
            return parsed if math.isfinite(parsed) else None
        return None
    return value


def collect_items(period: dict[str, Any]) -> dict[str, dict[str, Any]]:
    items: dict[str, dict[str, Any]] = {}
    for group in period.get("groups") or []:
        if not isinstance(group, dict):
            continue
        for item in group.get("statisticsItems") or []:
            if not isinstance(item, dict):
                continue
            key = item.get("key")
            if isinstance(key, str) and key and key not in items:
                items[key] = item
    return items


def normalized_side(items: dict[str, dict[str, Any]], side: str) -> dict[str, int | float]:
    def value(*keys: str) -> int | float | None:
        for key in keys:
            item = items.get(key)
            if item is not None:
                parsed = numeric_value(item, side)
                if parsed is not None:
                    return parsed
        return None

    def as_int(value_: int | float | None) -> int | None:
        return int(round(value_)) if value_ is not None else None

    passes = value("passes")
    accurate_passes = value("accuratePasses")
    pass_accuracy = (
        round(accurate_passes / passes * 100, 2)
        if isinstance(passes, (int, float)) and passes > 0 and isinstance(accurate_passes, (int, float))
        else None
    )
    big_chances = value("bigChanceCreated")
    if big_chances is None:
        scored = value("bigChanceScored")
        missed = value("bigChanceMissed")
        if scored is not None or missed is not None:
            big_chances = (scored or 0) + (missed or 0)

    normalized: dict[str, int | float | None] = {
        "possessionPercent": value("ballPossession"),
        "shotsTotal": as_int(value("totalShotsOnGoal")),
        "shotsOnTarget": as_int(value("shotsOnGoal")),
        "shotsOffTarget": as_int(value("shotsOffGoal")),
        "blockedShots": as_int(value("blockedScoringAttempt")),
        "corners": as_int(value("cornerKicks")),
        "fouls": as_int(value("fouls")),
        "yellowCards": as_int(value("yellowCards")),
        "redCards": as_int(value("redCards", "redCard")),
        "offsides": as_int(value("offsides")),
        "goalkeeperSaves": as_int(value("goalkeeperSaves")),
        "passes": as_int(passes),
        "accuratePasses": as_int(accurate_passes),
        "passAccuracyPercent": pass_accuracy,
        "bigChances": as_int(big_chances),
        "bigChancesMissed": as_int(value("bigChanceMissed")),
        "expectedGoals": value("expectedGoals"),
        "expectedAssists": value("expectedAssists"),
        "attacks": as_int(value("attacks")),
        "dangerousAttacks": as_int(value("dangerousAttacks")),
        "hitWoodwork": as_int(value("hitWoodwork")),
        "tackles": as_int(value("totalTackle")),
        "interceptions": as_int(value("interceptionWon")),
        "clearances": as_int(value("totalClearance")),
        "duelsWon": None,
        "aerialDuelsWon": None,
    }
    return {key: metric for key, metric in normalized.items() if metric is not None}


def extract_statistics(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict) or not isinstance(payload.get("statistics"), list):
        raise CaptureFailure("partial_response")
    periods = [period for period in payload["statistics"] if isinstance(period, dict)]
    full_time = next((period for period in periods if str(period.get("period", "")).upper() == "ALL"), None)
    if full_time is None:
        raise CaptureFailure("missing_full_time")
    items = collect_items(full_time)
    if not items:
        raise CaptureFailure("empty_statistics")
    home = normalized_side(items, "home")
    away = normalized_side(items, "away")
    if not home and not away:
        raise CaptureFailure("empty_statistics")
    return {"home": home, "away": away}


def validate_output(input_path: Path, output_path: Path) -> None:
    if input_path.resolve() == output_path.resolve():
        raise ValueError("Output must not be the input match list.")
    if output_path.exists() or output_path.is_symlink():
        raise ValueError("Output already exists; choose a new capture file.")
    if output_path.suffix.lower() != ".json":
        raise ValueError("Output must be a JSON file.")


def write_capture(output_path: Path, capture: dict[str, Any]) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=".match-statistics-", suffix=".tmp", dir=output_path.parent)
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            json.dump(capture, stream, ensure_ascii=False, indent=2, allow_nan=False)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.link(temporary_path, output_path)
    finally:
        temporary_path.unlink(missing_ok=True)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def utc_timestamp(instant: datetime) -> str:
    if instant.tzinfo is None:
        raise ValueError("Fetch timestamps must include a timezone.")
    return instant.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def default_output_path() -> Path:
    stamp = utc_now().strftime("%Y%m%dT%H%M%S%fZ")
    return Path(__file__).resolve().parents[1] / ".provider-runs" / "sofascore" / f"match-statistics-{stamp}-{uuid4().hex[:8]}.json"


def run_fetch(input_path: Path, output_path: Path, *, transport: Transport,
              limit: int = MAX_MATCHES, now: Callable[[], datetime] = utc_now,
              sleep: Callable[[float], None] = time.sleep) -> dict[str, Any]:
    if not 1 <= limit <= MAX_MATCHES:
        raise ValueError(f"Limit must be between 1 and {MAX_MATCHES}.")
    input_path, output_path = Path(input_path), Path(output_path)
    validate_output(input_path, output_path)
    matches = read_input(input_path)[:limit]
    snapshot_instant = now()
    attempted = [0]
    captured: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []
    stopped_status: int | None = None
    for match in matches:
        if stopped_status is not None:
            failures.append({"eventId": match["eventId"], "reason": f"skipped_after_http_{stopped_status}"})
            continue
        payload, reason, status = fetch_payload(transport, statistics_endpoint(match["eventId"]), sleep, attempted)
        if status in (403, 429):
            stopped_status = status
        if reason is not None:
            failures.append({"eventId": match["eventId"], "status": status, "reason": reason})
            continue
        try:
            statistics = extract_statistics(payload)
        except CaptureFailure as error:
            failures.append({"eventId": match["eventId"], "status": status, "reason": str(error)})
            continue
        captured.append({**match, "statistics": statistics})
    capture = {
        "source": "sofascore-match-statistics",
        "capturedAt": utc_timestamp(snapshot_instant),
        "matches": captured,
    }
    if captured:
        write_capture(output_path, capture)
    return {
        "requested": len(matches),
        "attempted": attempted[0],
        "succeeded": len(captured),
        "failed": len(failures),
        "failures": failures,
        "output": str(output_path) if captured else None,
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
            summary = run_fetch(options.input, output, transport=transport, limit=options.limit)
    except ValueError as error:
        print(json.dumps({"error": str(error)}))
        return 2
    except OSError:
        print(json.dumps({"error": "Capture output could not be published; no existing file was overwritten."}))
        return 2
    if transport is not None:
        summary["impersonate"] = transport.active
    print(json.dumps(summary, ensure_ascii=False, allow_nan=False))
    return 0 if summary["succeeded"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
