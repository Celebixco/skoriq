"""Tests for the SofaScore previous-season capture."""

import json
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import sofascore_fetch_historical_matches as historical  # noqa: E402

NOW = datetime(2026, 10, 18, 3, 0, tzinfo=timezone.utc)
CATALOG = [{"sofascore_tournament_id": 52, "league_name": "Super Lig", "season_id": 100}]
SEASONS = {"seasons": [
    {"id": 100, "year": "26/27", "name": "Super Lig 26/27"},
    {"id": 90, "year": "25/26", "name": "Super Lig 25/26"},
    {"id": 80, "year": "24/25", "name": "Super Lig 24/25"},
    {"id": 99, "year": "80/81", "name": "Super Lig 80/81"},
    {"id": 110, "year": "27/28", "name": "Super Lig 27/28"},
]}


def event(event_id, start=1730000000):
    return {
        "id": event_id,
        "startTimestamp": start,
        "status": {"type": "finished"},
        "homeTeam": {"id": 1},
        "awayTeam": {"id": 2},
        "homeScore": {"current": 2, "period1": 1},
        "awayScore": {"current": 1, "period1": 0},
        "roundInfo": {"round": 5},
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
        for suffix, response in self.routes.items():
            if url.endswith(suffix):
                return response
        raise AssertionError(f"Unexpected URL {url}")


class PreviousSeasonsTests(unittest.TestCase):
    def test_selects_only_previous_seasons_newest_first(self):
        result = historical.previous_seasons(SEASONS, 100, 2)
        self.assertEqual([season["season_id"] for season in result], [90, 80])

    def test_rejects_missing_seasons_payload(self):
        with self.assertRaises(historical.CaptureFailure):
            historical.previous_seasons({}, 100, 2)


class RunFetchTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.catalog = self.root / "catalog.json"
        self.catalog.write_text(json.dumps(CATALOG), encoding="utf-8")
        self.output = self.root / "historical.json"

    def run_fetch(self, transport, **kwargs):
        return historical.run_fetch(
            self.catalog, self.output, transport=transport, now=lambda: NOW, sleep=lambda _: None, **kwargs
        )

    def test_captures_previous_seasons_with_historical_marker(self):
        transport = FakeTransport({
            "/unique-tournament/52/seasons": FakeResponse(200, SEASONS),
            "/season/90/events/last/0": FakeResponse(200, {"events": [event(1001)]}),
            "/season/80/events/last/0": FakeResponse(200, {"events": [event(1002, 1700000000)]}),
        })
        summary = self.run_fetch(transport, seasons=2, pages=1)
        self.assertEqual(summary["events"], 2)
        self.assertEqual(summary["seasons"], 2)
        document = json.loads(self.output.read_text(encoding="utf-8"))
        self.assertEqual(document["source"], "sofascore")
        self.assertTrue(all(t["season_kind"] == "historical" for t in document["tournaments"]))
        self.assertEqual([t["season_id"] for t in document["tournaments"]], [90, 80])
        self.assertEqual(document["tournaments"][0]["season_name"], "Super Lig 25/26")
        self.assertEqual(document["tournaments"][0]["events"][0]["sofascore_id"], 1001)

    def test_missing_previous_seasons_is_reported(self):
        transport = FakeTransport({
            "/unique-tournament/52/seasons": FakeResponse(200, {"seasons": [{"id": 100, "year": 2026, "name": "Current"}]})
        })
        summary = self.run_fetch(transport, seasons=2, pages=1)
        self.assertEqual(summary["events"], 0)
        self.assertEqual(summary["failures"][0]["reason"], "no_previous_seasons")
        self.assertFalse(self.output.exists())

    def test_rate_limit_on_seasons_is_reported(self):
        summary = self.run_fetch(FakeTransport({"/unique-tournament/52/seasons": FakeResponse(429)}), seasons=2, pages=1)
        self.assertEqual(summary["events"], 0)
        self.assertEqual(summary["failures"][0]["reason"], "http_429")

    def test_refuses_to_overwrite_output(self):
        self.output.write_text("existing", encoding="utf-8")
        with self.assertRaises(ValueError):
            self.run_fetch(FakeTransport({}))
        self.assertEqual(self.output.read_text(encoding="utf-8"), "existing")


if __name__ == "__main__":
    unittest.main()
