"""Tests for the SofaScore match statistics capture."""

import json
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import sofascore_fetch_match_statistics as capture  # noqa: E402

NOW = datetime(2026, 10, 18, 1, 0, tzinfo=timezone.utc)


def item(key, home, away):
    return {"key": key, "homeValue": home, "awayValue": away, "home": str(home), "away": str(away)}


def payload(**overrides):
    items = [
        item("ballPossession", 59, 41),
        item("totalShotsOnGoal", 24, 13),
        item("shotsOnGoal", 7, 5),
        item("shotsOffGoal", 9, 5),
        item("blockedScoringAttempt", 8, 3),
        item("cornerKicks", 4, 3),
        item("fouls", 18, 3),
        item("yellowCards", 1, 0),
        item("offsides", 3, 2),
        item("goalkeeperSaves", 4, 5),
        item("passes", 532, 365),
        item("accuratePasses", 476, 313),
        item("bigChanceCreated", 8, 2),
        item("bigChanceMissed", 6, 2),
        item("expectedGoals", 3.77, 0.99),
        item("totalTackle", 10, 12),
        item("interceptionWon", 6, 14),
        item("totalClearance", 11, 22),
    ]
    for key, values in overrides.items():
        items.append(item(key, values[0], values[1]))
    return {"statistics": [{"period": "ALL", "groups": [{"groupName": "Match overview", "statisticsItems": items}]}]}


class FakeResponse:
    def __init__(self, status_code: int, body: object = None):
        self.status_code = status_code
        self._body = body

    def json(self):
        if self._body is None:
            raise ValueError("no json")
        return self._body


class FakeTransport:
    def __init__(self, routes: dict[int, FakeResponse]):
        self.routes = routes
        self.calls: list[str] = []

    def __call__(self, url: str, *, timeout: int) -> FakeResponse:
        self.calls.append(url)
        event_id = int(url.rsplit("/", 2)[-2])
        return self.routes[event_id]


class InputTests(unittest.TestCase):
    def test_reads_deduped_positive_matches(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "input.json"
            path.write_text(json.dumps({"matches": [
                {"eventId": 1, "homeTeamId": 10, "awayTeamId": 20},
                {"eventId": 1, "homeTeamId": 10, "awayTeamId": 20},
                {"eventId": 0, "homeTeamId": 10, "awayTeamId": 20},
                {"eventId": 2, "homeTeamId": 10, "awayTeamId": 10},
                {"eventId": 3, "homeTeamId": 10, "awayTeamId": 20},
            ]}), encoding="utf-8")
            self.assertEqual(capture.read_input(path), [
                {"eventId": 1, "homeTeamId": 10, "awayTeamId": 20},
                {"eventId": 3, "homeTeamId": 10, "awayTeamId": 20},
            ])

    def test_rejects_missing_matches_list(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "input.json"
            path.write_text("{}", encoding="utf-8")
            with self.assertRaises(ValueError):
                capture.read_input(path)


class ExtractTests(unittest.TestCase):
    def test_maps_schema_fields_and_derives_pass_accuracy(self):
        statistics = capture.extract_statistics(payload())
        self.assertEqual(statistics["home"]["possessionPercent"], 59)
        self.assertEqual(statistics["home"]["shotsTotal"], 24)
        self.assertEqual(statistics["home"]["shotsOnTarget"], 7)
        self.assertEqual(statistics["home"]["bigChances"], 8)
        self.assertEqual(statistics["home"]["bigChancesMissed"], 6)
        self.assertEqual(statistics["home"]["expectedGoals"], 3.77)
        self.assertEqual(statistics["home"]["tackles"], 10)
        self.assertEqual(statistics["home"]["clearances"], 11)
        self.assertAlmostEqual(statistics["home"]["passAccuracyPercent"], 89.47)
        self.assertNotIn("duelsWon", statistics["home"])

    def test_rejects_missing_full_time_or_empty_statistics(self):
        with self.assertRaises(capture.CaptureFailure):
            capture.extract_statistics({"statistics": [{"period": "1ST", "groups": []}]})
        with self.assertRaises(capture.CaptureFailure):
            capture.extract_statistics({"statistics": [{"period": "ALL", "groups": []}]})
        with self.assertRaises(capture.CaptureFailure):
            capture.extract_statistics({})


class RunFetchTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.input = self.root / "input.json"
        self.input.write_text(json.dumps({"matches": [
            {"eventId": 11, "homeTeamId": 101, "awayTeamId": 202},
            {"eventId": 12, "homeTeamId": 303, "awayTeamId": 404},
        ]}), encoding="utf-8")
        self.output = self.root / "capture.json"

    def run_fetch(self, transport, **kwargs):
        return capture.run_fetch(self.input, self.output, transport=transport, now=lambda: NOW, sleep=lambda _: None, **kwargs)

    def test_captures_events_and_writes_atomic_output(self):
        transport = FakeTransport({11: FakeResponse(200, payload()), 12: FakeResponse(200, payload())})
        summary = self.run_fetch(transport)
        self.assertEqual(summary["succeeded"], 2)
        self.assertEqual(summary["failed"], 0)
        document = json.loads(self.output.read_text(encoding="utf-8"))
        self.assertEqual(document["source"], "sofascore-match-statistics")
        self.assertEqual(document["capturedAt"], "2026-10-18T01:00:00.000Z")
        self.assertEqual(len(document["matches"]), 2)
        self.assertEqual(document["matches"][0]["statistics"]["home"]["possessionPercent"], 59)

    def test_rate_limit_stops_remaining_requests(self):
        transport = FakeTransport({11: FakeResponse(429), 12: FakeResponse(200, payload())})
        summary = self.run_fetch(transport)
        self.assertEqual(summary["succeeded"], 0)
        self.assertEqual(summary["attempted"], 1)
        self.assertEqual(summary["failures"][0]["reason"], "http_429")
        self.assertEqual(summary["failures"][1]["reason"], "skipped_after_http_429")
        self.assertFalse(self.output.exists())

    def test_partial_payload_is_a_failure_not_a_success(self):
        transport = FakeTransport({11: FakeResponse(200, {"statistics": []}), 12: FakeResponse(200, payload())})
        summary = self.run_fetch(transport)
        self.assertEqual(summary["succeeded"], 1)
        self.assertEqual(summary["failed"], 1)
        self.assertEqual(summary["failures"][0]["reason"], "missing_full_time")

    def test_refuses_to_overwrite_existing_output(self):
        self.output.write_text("existing", encoding="utf-8")
        with self.assertRaises(ValueError):
            self.run_fetch(FakeTransport({}))
        self.assertEqual(self.output.read_text(encoding="utf-8"), "existing")

    def test_rejects_invalid_direct_limits_without_requests(self):
        transport = FakeTransport({})
        for limit in (0, capture.MAX_MATCHES + 1):
            with self.subTest(limit=limit), self.assertRaises(ValueError):
                self.run_fetch(transport, limit=limit)
        self.assertEqual(transport.calls, [])


if __name__ == "__main__":
    unittest.main()
