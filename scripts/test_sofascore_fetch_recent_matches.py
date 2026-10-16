"""Tests for the recent finished matches capture."""

import json
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import sofascore_fetch_recent_matches as capture  # noqa: E402

NOW = datetime(2026, 10, 16, 12, 0, tzinfo=timezone.utc)
RECENT_TS = int(datetime(2026, 10, 15, 18, 0, tzinfo=timezone.utc).timestamp())
STALE_TS = int(datetime(2026, 7, 1, 18, 0, tzinfo=timezone.utc).timestamp())


def event(identifier: int, ts: int = RECENT_TS, *, home: int = 101, away: int = 202,
          home_score: int = 2, away_score: int = 1, status: str = "finished",
          halftime: tuple[int, int] | None = (1, 0), round_number: int = 7) -> dict:
    payload = {
        "id": identifier,
        "startTimestamp": ts,
        "status": {"type": status},
        "roundInfo": {"round": round_number},
        "homeTeam": {"id": home},
        "awayTeam": {"id": away},
        "homeScore": {"current": home_score},
        "awayScore": {"current": away_score},
    }
    if halftime is not None:
        payload["homeScore"]["period1"] = halftime[0]
        payload["awayScore"]["period1"] = halftime[1]
    return payload


class FakeResponse:
    def __init__(self, status_code: int, payload: object = None):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        if self._payload is None:
            raise ValueError("no json")
        return self._payload


class FakeTransport:
    def __init__(self, routes: dict[str, FakeResponse]):
        self.routes = routes
        self.calls: list[str] = []

    def __call__(self, url: str, *, timeout: int) -> FakeResponse:
        self.calls.append(url)
        for fragment, response in self.routes.items():
            if fragment in url:
                return response
        raise AssertionError(f"Unexpected request: {url}")


def write_catalog(path: Path, leagues: list[dict]) -> Path:
    path.write_text(json.dumps(leagues), encoding="utf-8")
    return path


class SelectLeaguesTests(unittest.TestCase):
    def test_dedupes_and_skips_invalid_entries(self):
        leagues = capture.select_leagues([
            {"sofascore_tournament_id": 52, "season_id": 98080, "league_name": "Süper Lig"},
            {"sofascore_tournament_id": 52, "season_id": 999, "league_name": "duplicate"},
            {"sofascore_tournament_id": 0, "season_id": 1},
            {"league_name": "missing ids"},
        ])
        self.assertEqual(len(leagues), 1)
        self.assertEqual(leagues[0].tournament_id, 52)
        self.assertEqual(leagues[0].season_id, 98080)

    def test_limit_and_empty_catalog(self):
        catalog = [
            {"sofascore_tournament_id": 52, "season_id": 1},
            {"sofascore_tournament_id": 53, "season_id": 1},
        ]
        self.assertEqual(len(capture.select_leagues(catalog, limit=1)), 1)
        with self.assertRaises(ValueError):
            capture.select_leagues([])

    def test_tournament_filter_selects_a_single_league(self):
        catalog = [
            {"sofascore_tournament_id": 52, "season_id": 1, "league_name": "Süper Lig"},
            {"sofascore_tournament_id": 98, "season_id": 2, "league_name": "1. Lig"},
        ]
        leagues = capture.select_leagues(catalog, None, 98)
        self.assertEqual([league.tournament_id for league in leagues], [98])
        with self.assertRaises(ValueError):
            capture.select_leagues(catalog, None, 999)


class ValidateEventTests(unittest.TestCase):
    def test_captures_finished_event_with_halftime(self):
        captured = capture.validate_event(event(5001), NOW)
        self.assertEqual(captured["sofascore_id"], 5001)
        self.assertEqual(captured["home_score_halftime"], 1)
        self.assertEqual(captured["away_score_halftime"], 0)
        self.assertEqual(captured["round"], 7)

    def test_rejects_not_finished_and_missing_score(self):
        with self.assertRaises(capture.CaptureFailure):
            capture.validate_event(event(5002, status="inprogress"), NOW)
        payload = event(5003)
        payload["homeScore"].pop("current")
        with self.assertRaises(capture.CaptureFailure):
            capture.validate_event(payload, NOW)

    def test_rejects_invalid_scores_and_teams(self):
        with self.assertRaises(capture.CaptureFailure):
            capture.validate_event(event(5004, home_score=99), NOW)
        with self.assertRaises(capture.CaptureFailure):
            capture.validate_event(event(5005, home=7, away=7), NOW)

    def test_sanitizes_invalid_round_and_skips_halftime_when_absent(self):
        captured = capture.validate_event(event(5006, halftime=None, round_number=0), NOW)
        self.assertIsNone(captured["round"])
        self.assertNotIn("home_score_halftime", captured)


class RunFetchTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.catalog = write_catalog(self.root / "catalog.json", [
            {"sofascore_tournament_id": 52, "season_id": 98080, "league_name": "Süper Lig"},
            {"sofascore_tournament_id": 98, "season_id": 87876, "league_name": "1. Lig"},
        ])
        self.output = self.root / "capture.json"

    def test_captures_events_sorted_and_deduped(self):
        older = event(6001, ts=RECENT_TS - 3600)
        newer = event(6002, ts=RECENT_TS)
        duplicate = event(6001, ts=RECENT_TS - 3600)
        transport = FakeTransport({
            "tournament/52/season/98080/events": FakeResponse(200, {"events": [older, newer]}),
            "tournament/98/season/87876/events": FakeResponse(200, {"events": [duplicate]}),
        })
        summary = capture.run_fetch(self.catalog, self.output, transport=transport, now=lambda: NOW, sleep=lambda _: None)
        self.assertEqual(summary["events_total"], 2)
        self.assertEqual(summary["failures"], [])
        document = json.loads(self.output.read_text(encoding="utf-8"))
        self.assertEqual(document["source"], "sofascore")
        self.assertEqual(document["capturedAt"], "2026-10-16T12:00:00.000Z")
        first = document["tournaments"][0]
        self.assertEqual([item["sofascore_id"] for item in first["events"]], [6002, 6001])
        self.assertEqual(document["tournaments"][1]["events"], [])

    def test_stops_after_rate_limit_and_skips_remaining(self):
        transport = FakeTransport({
            "tournament/52/season/98080/events": FakeResponse(429, None),
        })
        summary = capture.run_fetch(self.catalog, self.output, transport=transport, now=lambda: NOW, sleep=lambda _: None)
        self.assertEqual(summary["fetched_leagues"], 0)
        self.assertEqual([failure["reason"] for failure in summary["failures"]], ["http_429", "skipped_after_http_429"])
        self.assertIsNone(summary["output"])
        self.assertFalse(self.output.exists())
        self.assertEqual(len(transport.calls), 1)

    def test_detects_current_season_when_catalog_season_is_stale(self):
        transport = FakeTransport({
            "tournament/52/season/98080/events": FakeResponse(200, {"events": [event(7001, ts=STALE_TS)]}),
            "tournament/98/season/87876/events": FakeResponse(200, {"events": [event(7101)]}),
            "tournament/52/seasons": FakeResponse(200, {"seasons": [{"id": 99000}, {"id": 98080}]}),
            "tournament/52/season/99000/events": FakeResponse(200, {"events": [event(7201)]}),
        })
        summary = capture.run_fetch(self.catalog, self.output, transport=transport, now=lambda: NOW, sleep=lambda _: None)
        self.assertEqual(summary["failures"], [])
        document = json.loads(self.output.read_text(encoding="utf-8"))
        first = document["tournaments"][0]
        self.assertEqual(first["season_id"], 99000)
        self.assertTrue(first["season_detected"])
        self.assertEqual([item["sofascore_id"] for item in first["events"]], [7201])

    def test_reports_no_recent_events_without_auto_detected_alternative(self):
        transport = FakeTransport({
            "tournament/52/season/98080/events": FakeResponse(200, {"events": [event(7301, ts=STALE_TS)]}),
            "tournament/98/season/87876/events": FakeResponse(200, {"events": [event(7302)]}),
            "tournament/52/seasons": FakeResponse(200, {"seasons": []}),
        })
        summary = capture.run_fetch(self.catalog, self.output, transport=transport, now=lambda: NOW, sleep=lambda _: None)
        reasons = [failure["reason"] for failure in summary["failures"]]
        self.assertIn("no_recent_events", reasons)
        # Stale but validated events stay in the capture; the failure entry is a warning for operators.
        self.assertEqual(summary["fetched_leagues"], 2)
        document = json.loads(self.output.read_text(encoding="utf-8"))
        self.assertEqual(document["tournaments"][0]["events"][0]["sofascore_id"], 7301)

    def test_refuses_existing_output(self):
        self.output.write_text("{}", encoding="utf-8")
        transport = FakeTransport({})
        with self.assertRaises(ValueError):
            capture.run_fetch(self.catalog, self.output, transport=transport, now=lambda: NOW, sleep=lambda _: None)

    def test_transport_error_is_reported_without_details(self):
        def failing(url: str, *, timeout: int):
            raise ConnectionError("sensitive diagnostic text")

        summary = capture.run_fetch(self.catalog, self.output, transport=failing, now=lambda: NOW, sleep=lambda _: None)
        self.assertEqual(summary["failures"][0]["reason"], "transport_error")
        self.assertNotIn("sensitive", json.dumps(summary))


class ImpersonationTransportTests(unittest.TestCase):
    class FakeSession:
        def __init__(self, responses: dict[str, int]):
            self.responses = responses
            self.calls: list[str] = []

        def get(self, url: str, *, timeout: int, impersonate: str, allow_redirects: bool, headers: dict) -> FakeResponse:
            self.calls.append(impersonate)
            return FakeResponse(self.responses.get(impersonate, 403), {"events": []})

    def test_falls_through_403_candidates_and_sticks_to_the_working_profile(self):
        session = self.FakeSession({"chrome": 403, "chrome131": 200})
        transport = capture.ImpersonationTransport(session, ("chrome", "chrome131", "chrome124"))
        self.assertEqual(transport("https://example", timeout=5).status_code, 200)
        self.assertEqual(transport.active, "chrome131")
        transport("https://example", timeout=5)
        self.assertEqual(session.calls, ["chrome", "chrome131", "chrome131"])

    def test_returns_the_last_403_when_every_candidate_fails(self):
        session = self.FakeSession({})
        transport = capture.ImpersonationTransport(session, ("chrome", "safari"))
        self.assertEqual(transport("https://example", timeout=5).status_code, 403)
        self.assertEqual(session.calls, ["chrome", "safari"])

    def test_requires_at_least_one_candidate(self):
        with self.assertRaises(ValueError):
            capture.ImpersonationTransport(self.FakeSession({}), ())


class ParseArgsTests(unittest.TestCase):
    def test_defaults(self):
        options = capture.parse_args([])
        self.assertEqual(options.catalog.name, "sofascore_catalog.json")
        self.assertIsNone(options.limit_tournaments)

    def test_rejects_invalid_limit(self):
        with self.assertRaises(SystemExit):
            capture.parse_args(["--limit-tournaments", "0"])


if __name__ == "__main__":
    unittest.main()
