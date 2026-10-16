"""Tests for the standings capture."""

import json
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import sofascore_fetch_standings as capture  # noqa: E402
from sofascore_fetch_recent_matches import CaptureFailure  # noqa: E402

NOW = datetime(2026, 10, 16, 12, 0, tzinfo=timezone.utc)


class FakeResponse:
    def __init__(self, status_code: int, payload: object = None):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        if self._payload is None:
            raise ValueError("no json")
        return self._payload


def standing_row(team: int, position: int, played: int = 8, points: int = 19, name: str = "Total") -> dict:
    return {"position": position, "team": {"id": team}, "matches": played, "wins": 6, "draws": 1, "losses": 1,
            "scoresFor": 18, "scoresAgainst": 6, "points": points, "form": "WWDWL"}


def payload_with(rows: list[dict], name: str = "Total") -> dict:
    return {"standings": [{"name": name, "rows": rows}]}


class SelectLeaguesTests(unittest.TestCase):
    def test_filters_and_limits(self):
        catalog = [
            {"sofascore_tournament_id": 52, "season_id": 98080, "league_name": "Süper Lig"},
            {"sofascore_tournament_id": 98, "season_id": 87876},
            {"sofascore_tournament_id": 52, "season_id": 1},
        ]
        self.assertEqual(len(capture.select_leagues(catalog, limit=1)), 1)
        self.assertEqual(capture.select_leagues(catalog, None, 98)[0].season_id, 87876)
        with self.assertRaises(ValueError):
            capture.select_leagues([])


class TableGroupTests(unittest.TestCase):
    def test_prefers_total_group_and_sorts_by_position(self):
        payload = {"standings": [
            {"name": "Home", "rows": [standing_row(1, 5)]},
            {"name": "Total", "rows": [standing_row(9, 2, played=8), standing_row(7, 1, played=8)]},
        ]}
        rows = capture.select_table_group(payload)
        self.assertEqual([row["team_id"] for row in rows], [7, 9])

    def test_skips_invalid_rows_and_requires_rows(self):
        rows = capture.select_table_group(payload_with([
            standing_row(1, 1),
            {"position": 2, "team": {"id": 2}, "matches": 8, "wins": 9, "draws": 0, "losses": 0, "scoresFor": 1, "scoresAgainst": 1, "points": 1},
            {"position": 3, "team": {"id": 3}, "matches": 8, "wins": 6, "draws": 1, "losses": 1, "scoresFor": 18, "scoresAgainst": 6, "points": 19, "form": "XX"},
        ]))
        self.assertEqual(len(rows), 2)
        self.assertIsNone(rows[1]["form"])
        with self.assertRaises(CaptureFailure):
            capture.select_table_group(payload_with([]))


class RunFetchTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.catalog = self.root / "catalog.json"
        self.catalog.write_text(json.dumps([
            {"sofascore_tournament_id": 52, "season_id": 98080, "league_name": "Süper Lig"},
            {"sofascore_tournament_id": 98, "season_id": 87876, "league_name": "1. Lig"},
        ]), encoding="utf-8")
        self.output = self.root / "standings.json"

    def test_captures_standings_for_each_league(self):
        def transport(url, *, timeout):
            return FakeResponse(200, payload_with([standing_row(7, 1), standing_row(9, 2)]))

        summary = capture.run_fetch(self.catalog, self.output, transport=transport, now=lambda: NOW, sleep=lambda _: None)
        self.assertEqual(summary["fetched_leagues"], 2)
        self.assertEqual(summary["rows_total"], 4)
        document = json.loads(self.output.read_text(encoding="utf-8"))
        self.assertEqual(document["source"], "sofascore-standings")
        self.assertEqual(len(document["tournaments"][0]["standings"]), 2)

    def test_rate_limit_stops_and_reports_remaining(self):
        def transport(url, *, timeout):
            return FakeResponse(429)

        summary = capture.run_fetch(self.catalog, self.output, transport=transport, now=lambda: NOW, sleep=lambda _: None)
        self.assertEqual(summary["fetched_leagues"], 0)
        self.assertEqual([failure["reason"] for failure in summary["failures"]], ["http_429", "skipped_after_http_429"])
        self.assertIsNone(summary["output"])

    def test_refuses_existing_output(self):
        self.output.write_text("{}", encoding="utf-8")
        with self.assertRaises(ValueError):
            capture.run_fetch(self.catalog, self.output, transport=lambda url, *, timeout: FakeResponse(200), now=lambda: NOW, sleep=lambda _: None)


if __name__ == "__main__":
    unittest.main()
