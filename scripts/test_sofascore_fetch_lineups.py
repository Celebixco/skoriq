"""Tests for the SofaScore lineups capture."""

import json
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import sofascore_fetch_lineups as capture  # noqa: E402

NOW = datetime(2026, 10, 18, 2, 0, tzinfo=timezone.utc)


def player(player_id, name, position, shirt, substitute, rating=None):
    return {
        "player": {"id": player_id, "name": name, "position": position},
        "position": position,
        "shirtNumber": shirt,
        "substitute": substitute,
        "statistics": {"rating": rating}
    }


def payload(confirmed=True, home_players=None, away_players=None):
    return {
        "confirmed": confirmed,
        "home": {"formation": "4-2-3-1", "players": home_players if home_players is not None else [
            player(254491, "Ederson", "G", 31, False, 8.6),
            player(1001, "Home Substitute", "M", 10, True)
        ]},
        "away": {"formation": "4-4-2", "players": away_players if away_players is not None else [
            player(2001, "Away Player", "D", 4, False, 7.1)
        ]}
    }


class FakeResponse:
    def __init__(self, status_code, body=None):
        self.status_code = status_code
        self._body = body

    def json(self):
        if self._body is None:
            raise ValueError("no json")
        return self._body


class FakeTransport:
    def __init__(self, routes):
        self.routes = routes
        self.calls = []

    def __call__(self, url, *, timeout):
        self.calls.append(url)
        event_id = int(url.rsplit("/", 2)[-2])
        return self.routes[event_id]


class ExtractTests(unittest.TestCase):
    def test_maps_lineups_and_players(self):
        lineups = capture.extract_lineups(payload())
        self.assertTrue(lineups["confirmed"])
        self.assertEqual(lineups["home"]["formation"], "4-2-3-1")
        self.assertEqual(len(lineups["home"]["players"]), 2)
        self.assertEqual(lineups["home"]["players"][0], {
            "playerId": 254491, "name": "Ederson", "position": "G", "shirtNumber": 31,
            "substitute": False, "orderIndex": 0, "rating": 8.6
        })
        self.assertTrue(lineups["home"]["players"][1]["substitute"])
        self.assertEqual(lineups["away"]["formation"], "4-4-2")

    def test_rejects_empty_or_partial_payloads(self):
        with self.assertRaises(capture.CaptureFailure):
            capture.extract_lineups({})
        with self.assertRaises(capture.CaptureFailure):
            capture.extract_lineups(payload(home_players=[], away_players=[]))
        with self.assertRaises(capture.CaptureFailure):
            capture.extract_lineups({"home": {}, "away": {}})

    def test_skips_players_without_identity_and_keeps_unconfirmed_flag(self):
        lineups = capture.extract_lineups(payload(confirmed=False, home_players=[player(0, "Bad", "G", 1, False)]))
        self.assertFalse(lineups["confirmed"])
        self.assertEqual(lineups["home"]["players"], [])


class RunFetchTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.input = self.root / "input.json"
        self.input.write_text(json.dumps({"matches": [
            {"eventId": 11, "homeTeamId": 101, "awayTeamId": 202},
            {"eventId": 12, "homeTeamId": 303, "awayTeamId": 404}
        ]}), encoding="utf-8")
        self.output = self.root / "capture.json"

    def run_fetch(self, transport, **kwargs):
        return capture.run_fetch(self.input, self.output, transport=transport, now=lambda: NOW, sleep=lambda _: None, **kwargs)

    def test_captures_and_writes_output(self):
        summary = self.run_fetch(FakeTransport({11: FakeResponse(200, payload()), 12: FakeResponse(200, payload())}))
        self.assertEqual(summary["succeeded"], 2)
        document = json.loads(self.output.read_text(encoding="utf-8"))
        self.assertEqual(document["source"], "sofascore-lineups")
        self.assertEqual(document["capturedAt"], "2026-10-18T02:00:00.000Z")
        self.assertEqual(len(document["matches"]), 2)

    def test_rate_limit_stops_remaining_requests(self):
        summary = self.run_fetch(FakeTransport({11: FakeResponse(429), 12: FakeResponse(200, payload())}))
        self.assertEqual(summary["attempted"], 1)
        self.assertEqual(summary["failures"][0]["reason"], "http_429")
        self.assertEqual(summary["failures"][1]["reason"], "skipped_after_http_429")
        self.assertFalse(self.output.exists())

    def test_refuses_to_overwrite_existing_output(self):
        self.output.write_text("existing", encoding="utf-8")
        with self.assertRaises(ValueError):
            self.run_fetch(FakeTransport({}))
        self.assertEqual(self.output.read_text(encoding="utf-8"), "existing")

    def test_rejects_invalid_limits(self):
        transport = FakeTransport({})
        for limit in (0, capture.MAX_MATCHES + 1):
            with self.subTest(limit=limit), self.assertRaises(ValueError):
                self.run_fetch(transport, limit=limit)
        self.assertEqual(transport.calls, [])


if __name__ == "__main__":
    unittest.main()
