import copy
import io
import json
import tempfile
import unittest
from contextlib import redirect_stderr
from datetime import datetime, timezone
from pathlib import Path

import sofascore_fetch_team_statistics as fetcher


class Response:
    def __init__(self, status=200, payload=None):
        self.status_code = status
        self.payload = payload

    def json(self):
        if isinstance(self.payload, Exception):
            raise self.payload
        return self.payload


class Transport:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def __call__(self, url, *, timeout):
        self.calls.append((url, timeout))
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


def catalog_fixture():
    return [
        {
            "country": "Turkey", "league_name": "Super Lig",
            "sofascore_tournament_id": 52, "season_id": 98080,
            "season_name": "26/27", "teams_count": 2,
            "matches": [{"old": True}],
            "teams": [
                {"sofascore_id": 111, "name": "Team One", "slug": "one",
                 "season_statistics": {"matches": 99, "goalsScored": 999},
                 "providerFetchedAt": "2020-01-01T00:00:00Z",
                 "recent_matches": [{"old": True}], "played": 99},
                {"sofascore_id": 222, "name": "Team Two"}
            ]
        },
        {
            "league_name": "Another League", "sofascore_tournament_id": 17,
            "season_id": 12345, "teams": [{"sofascore_id": 111, "name": "Team One"}]
        }
    ]


class FetchTeamStatisticsTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.catalog = Path(self.directory.name) / "catalog.json"
        self.output = Path(self.directory.name) / "capture.json"
        self.catalog.write_text(json.dumps(catalog_fixture()), encoding="utf-8")
        self.fetched_at = datetime(2026, 9, 27, 10, 20, 30, tzinfo=timezone.utc)

    def run_fetch(self, transport, **options):
        return fetcher.run_fetch(
            self.catalog, self.output, transport=transport,
            now=lambda: self.fetched_at, sleep=lambda _: None, **options
        )

    def test_success_uses_new_statistics_and_response_time_provenance(self):
        transport = Transport([Response(payload={"statistics": {
            "matches": 5, "goalsScored": 0, "goalsPrevented": -1.2,
            "statisticsType": {"sportSlug": "football", "statisticsType": "team"}
        }})])
        original = self.catalog.read_bytes()
        summary = self.run_fetch(transport)
        self.assertEqual(summary["succeeded"], 1)
        captured = json.loads(self.output.read_text(encoding="utf-8"))
        team = captured[0]["teams"][0]
        self.assertEqual(team["season_statistics"], {"matches": 5, "goalsScored": 0, "goalsPrevented": -1.2})
        self.assertEqual(team["providerFetchedAt"], "2026-09-27T10:20:30.000Z")
        self.assertEqual(team["source"], "sofascore")
        self.assertEqual(team["endpoint"],
                         "https://api.sofascore.com/api/v1/team/111/unique-tournament/52/season/98080/statistics/overall")
        self.assertNotIn("recent_matches", team)
        self.assertNotIn("played", team)
        self.assertNotIn("matches", captured[0])
        self.assertEqual(captured[0]["teams_count"], 1)
        self.assertEqual(self.catalog.read_bytes(), original)
        self.assertEqual(transport.calls[0][1], 15)

    def test_default_cli_limit_is_one_and_filters_are_explicit(self):
        options = fetcher.parse_args([])
        self.assertEqual(options.limit, 1)
        self.assertIsNone(options.team_id)
        self.assertIsNone(options.tournament_id)
        self.assertEqual(Path(options.catalog).resolve(), Path(fetcher.__file__).with_name("sofascore_catalog.json").resolve())

    def test_filter_and_limit_do_not_fetch_unselected_scopes(self):
        transport = Transport([Response(payload={"statistics": {"matches": 3, "goalsScored": 2}})])
        summary = self.run_fetch(transport, team_id=111, tournament_id=17, limit=1)
        self.assertEqual(summary["requested"], 1)
        self.assertEqual(len(transport.calls), 1)
        captured = json.loads(self.output.read_text(encoding="utf-8"))
        self.assertEqual(captured[0]["sofascore_tournament_id"], 17)
        self.assertEqual(captured[0]["season_id"], 12345)

    def test_same_team_in_two_league_scopes_is_fetched_separately(self):
        transport = Transport([Response(payload={"statistics": {"matches": 3, "goalsScored": 2}})] * 2)
        summary = self.run_fetch(transport, team_id=111, limit=2)
        self.assertEqual(summary["requested"], 2)
        self.assertEqual(len(transport.calls), 2)
        self.assertNotEqual(transport.calls[0][0], transport.calls[1][0])
        self.assertEqual(len(json.loads(self.output.read_text(encoding="utf-8"))), 2)

    def test_duplicate_team_tournament_season_is_requested_once(self):
        catalog = catalog_fixture()
        catalog[0]["teams"].append(copy.deepcopy(catalog[0]["teams"][0]))
        self.catalog.write_text(json.dumps(catalog), encoding="utf-8")
        transport = Transport([Response(payload={"statistics": {"matches": 3, "goalsScored": 2}})] * 3)
        summary = self.run_fetch(transport, limit=20)
        self.assertEqual(summary["requested"], 3)
        self.assertEqual(len(transport.calls), 3)
        self.assertEqual(len({url for url, _ in transport.calls}), 3)

    def test_rejects_invalid_cli_limits_and_identifiers(self):
        for arguments in (["--limit", "0"], ["--limit", "21"], ["--limit", "-1"],
                          ["--team-id", "0"], ["--tournament-id", "-3"]):
            with self.subTest(arguments=arguments), redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit):
                    fetcher.parse_args(arguments)

    def test_failed_responses_never_create_a_success_file(self):
        cases = [
            (Response(429, {}), "http_429"),
            (Response(403, {}), "http_403"),
            (Response(200, ValueError("private body content")), "non_json"),
            (Response(200, {}), "partial_response"),
            (Response(200, {"statistics": {}}), "empty_statistics"),
            (Response(200, {"statistics": {"matches": 3}}), "partial_statistics"),
            (Response(200, {"statistics": {"matches": 3, "goalsScored": "2"}}), "invalid_numeric"),
            (Response(200, {"statistics": {"matches": True, "goalsScored": 2}}), "invalid_numeric"),
            (Response(200, {"statistics": {"matches": 3, "goalsScored": float("nan")}}), "invalid_numeric"),
            (Response(200, {"statistics": {"matches": 0, "goalsScored": 0}}), "no_played_matches"),
            (Response(200, {"statistics": {"matches": -1, "goalsScored": 2}}), "no_played_matches"),
            (RuntimeError("private transport detail"), "transport_error")
        ]
        for response, reason in cases:
            with self.subTest(reason=reason):
                summary = self.run_fetch(Transport([response]))
                self.assertEqual(summary["failed"], 1)
                self.assertEqual(summary["succeeded"], 0)
                self.assertEqual(summary["failures"][0]["reason"], reason)
                self.assertNotIn("private", json.dumps(summary))
                self.assertFalse(self.output.exists())

    def test_partial_batch_contains_only_successful_refreshed_teams(self):
        transport = Transport([
            Response(payload={"statistics": {"matches": 3, "goalsScored": 2}}),
            Response(payload={"statistics": {}})
        ])
        summary = self.run_fetch(transport, limit=2)
        self.assertEqual((summary["requested"], summary["succeeded"], summary["failed"]), (2, 1, 1))
        self.assertTrue(summary["partial"])
        teams = json.loads(self.output.read_text(encoding="utf-8"))[0]["teams"]
        self.assertEqual([team["sofascore_id"] for team in teams], [111])

    def test_rate_limit_stops_the_batch_without_retrying(self):
        transport = Transport([Response(429, {})])
        summary = self.run_fetch(transport, limit=2)
        self.assertEqual(len(transport.calls), 1)
        self.assertEqual(summary["failed"], 2)
        self.assertFalse(self.output.exists())

    def test_requests_are_spaced_and_use_individual_fetch_timestamps(self):
        delays = []
        instants = iter([self.fetched_at, datetime(2026, 9, 27, 10, 20, 32, tzinfo=timezone.utc)])
        transport = Transport([Response(payload={"statistics": {"matches": 3, "goalsScored": 2}})] * 2)
        summary = fetcher.run_fetch(self.catalog, self.output, transport=transport, limit=2,
                                    now=lambda: next(instants), sleep=delays.append)
        self.assertEqual(summary["succeeded"], 2)
        self.assertEqual(delays, [1.0])
        teams = json.loads(self.output.read_text(encoding="utf-8"))[0]["teams"]
        self.assertNotEqual(teams[0]["providerFetchedAt"], teams[1]["providerFetchedAt"])

    def test_never_overwrites_the_catalog_or_existing_output(self):
        for output in (self.catalog, self.catalog.parent / "." / self.catalog.name):
            with self.subTest(output=output):
                transport = Transport([])
                original = self.catalog.read_bytes()
                with self.assertRaises(ValueError):
                    fetcher.run_fetch(self.catalog, output, transport=transport)
                self.assertEqual(self.catalog.read_bytes(), original)
                self.assertEqual(transport.calls, [])
        self.output.write_text("existing capture", encoding="utf-8")
        with self.assertRaises(ValueError):
            self.run_fetch(Transport([]))
        self.assertEqual(self.output.read_text(encoding="utf-8"), "existing capture")

    def test_rejects_invalid_direct_limit_without_transport_calls(self):
        transport = Transport([])
        for options in ({"limit": 21}, {"team_id": 0}, {"tournament_id": -3}):
            with self.subTest(options=options), self.assertRaises(ValueError):
                self.run_fetch(transport, **options)
        self.assertEqual(transport.calls, [])

    def test_no_matching_scope_does_not_create_a_file_or_make_a_request(self):
        transport = Transport([])
        summary = self.run_fetch(transport, team_id=999999)
        self.assertEqual(summary["requested"], 0)
        self.assertEqual(transport.calls, [])
        self.assertFalse(self.output.exists())


if __name__ == "__main__":
    unittest.main()
