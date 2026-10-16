import io
import json
import tempfile
import unittest
from contextlib import redirect_stderr
from pathlib import Path

import sofascore_public_page_capture as converter


def catalog_fixture():
    return [{"league_name": "Premier League", "season_name": "Premier League 26/27",
             "sofascore_tournament_id": 17, "season_id": 96668,
             "teams": [{"sofascore_id": 17, "name": "Manchester City", "slug": "manchester-city",
                        "season_statistics": {"matches": 99, "shots": 999}}]}]


def capture_fixture():
    return {
        "pageUrl": "https://www.sofascore.com/football/team/manchester-city/17#tab:statistics",
        "capturedAt": "2026-09-26T21:56:32.497Z", "selectedTab": "Statistics",
        "teamName": "Manchester City", "tournamentLabel": "Premier League", "seasonLabel": "26/27",
        "rating": "",
        "groups": {
            "General": "Matches\n5\nGoals scored\n13\nGoals conceded\n5\nAssists\n10",
            "Attacking": "Total shots per game\n13.6\nCorners per game\n6.2\nFree kick goals\n1/1\nBlocked shots per game\n3.8",
            "Passes": "Ball possession\n63.2%\nAccurate passes\n561 (89.2%)",
            "Defending": "Clean sheets\n2\nGoals conceded per game\n1\nBalls recovered per game\n42.6",
            "Running performance (per match)": "Distance covered\n111.2 km\nNumber of sprints\n92.4",
            "Other": "Ground duels won\n35.6 (48.9%)\nDuels won per game\n50.6 (50.8%)\nUnknown label\nignored"
        }
    }


class PublicPageCaptureTests(unittest.TestCase):
    def test_resolves_exact_scope_and_preserves_visible_units_without_fake_totals(self):
        output = converter.convert_capture(capture_fixture(), catalog_fixture())
        self.assertEqual(len(output), 1)
        self.assertEqual((output[0]["sofascore_tournament_id"], output[0]["season_id"]), (17, 96668))
        team = output[0]["teams"][0]
        statistics = team["season_statistics"]
        self.assertEqual({key: statistics[key] for key in ("matches", "goalsScored", "goalsConceded", "assists")},
                         {"matches": 5, "goalsScored": 13, "goalsConceded": 5, "assists": 10})
        self.assertEqual(statistics["shotsPerGame"], 13.6)
        self.assertEqual(statistics["cornersPerGame"], 6.2)
        self.assertEqual(statistics["kilometersCoveredPerGame"], 111.2)
        self.assertEqual(statistics["numberOfSprintsPerGame"], 92.4)
        self.assertEqual(statistics["accuratePassesPercentage"], 89.2)
        self.assertEqual(statistics["groundDuelsWonPercentage"], 48.9)
        self.assertEqual(statistics["duelsWonPerGame"], 50.6)
        self.assertEqual(statistics["duelsWonPercentage"], 50.8)
        self.assertEqual(statistics["blockedScoringAttemptPerGame"], 3.8)
        self.assertEqual(statistics["ballRecoveryPerGame"], 42.6)
        self.assertNotIn("shots", statistics)
        self.assertNotIn("accuratePasses", statistics)
        self.assertNotIn("accuratePassesPerGame", statistics)
        self.assertNotIn("groundDuelsWonPerGame", statistics)
        self.assertNotIn("expectedGoals", statistics)
        self.assertNotIn("avgRating", statistics)
        self.assertEqual(statistics["freeKickGoals"], 1)
        self.assertEqual(statistics["freeKickShots"], 1)
        self.assertEqual(team["providerFetchedAt"], "2026-09-26T21:56:32.497Z")
        self.assertEqual(team["source"], "sofascore_public_page")
        self.assertEqual(team["captureMethod"], "visible_dom")
        self.assertEqual(team["endpoint"], capture_fixture()["pageUrl"])

    def test_accepts_exact_full_season_label_and_normalized_identity_text(self):
        capture = capture_fixture()
        capture.update(seasonLabel="Premier League 26/27", tournamentLabel=" premier  LEAGUE ",
                       teamName=" Manchester  City ", rating="7.90")
        output = converter.convert_capture(capture, catalog_fixture())
        self.assertEqual(len(output), 1)
        self.assertEqual(output[0]["teams"][0]["season_statistics"]["avgRating"], 7.9)

    def test_explicit_scope_proof_resolves_catalog_season_prefix_variant(self):
        capture = capture_fixture()
        capture.update(teamName="Amed Sportif Faaliyetler", tournamentLabel="Trendyol Süper Lig",
                       pageUrl="https://www.sofascore.com/football/team/amed-sportif-faaliyetler/207011#tab:statistics",
                       scopeProofUrl="https://www.sofascore.com/football/tournament/turkey/trendyol-super-lig/52#id:98080")
        catalog = [{"league_name": "Trendyol Süper Lig", "season_name": "Super Lig 26/27",
                    "sofascore_tournament_id": 52, "season_id": 98080,
                    "teams": [{"name": "Amed Sportif Faaliyetler", "sofascore_id": 207011}]}]
        output = converter.convert_capture(capture, catalog)
        self.assertEqual((output[0]["sofascore_tournament_id"], output[0]["season_id"]), (52, 98080))
        for proof in (capture["scopeProofUrl"].replace("98080", "98081"),
                      capture["scopeProofUrl"].replace("/52#", "/53#"),
                      capture["scopeProofUrl"].replace("www.sofascore.com", "example.com"),
                      capture["scopeProofUrl"].replace("id:98080", "id:98080extra")):
            with self.subTest(proof=proof), self.assertRaises(ValueError):
                converter.convert_capture(dict(capture, scopeProofUrl=proof), catalog)
        with self.assertRaises(ValueError):
            converter.convert_capture(dict(capture, seasonLabel="25/26"), catalog)
        capture.pop("scopeProofUrl")
        with self.assertRaises(ValueError):
            converter.convert_capture(capture, catalog)

    def test_refuses_unknown_or_ambiguous_scope_and_conflicting_team_identity(self):
        for field, value in (("teamName", "Another Team"), ("tournamentLabel", "Championship"),
                             ("seasonLabel", "25/26"), ("pageUrl", "https://www.sofascore.com/football/team/another/99#tab:statistics")):
            capture = capture_fixture()
            capture[field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                converter.convert_capture(capture, catalog_fixture())
        catalog = catalog_fixture() * 2
        with self.assertRaises(ValueError):
            converter.convert_capture(capture_fixture(), catalog)

    def test_refuses_wrong_tab_page_or_non_utc_invalid_capture_time(self):
        for field, value in (("selectedTab", "Matches"), ("capturedAt", "2026-09-26T21:56:32"),
                             ("capturedAt", "2026-02-31T21:56:32Z"), ("capturedAt", "2026-09-26T21:56:32+03:00"),
                             ("pageUrl", "https://example.com/football/team/manchester-city/17#tab:statistics"),
                             ("pageUrl", "https://www.sofascore.com/football/team/manchester-city/17#tab:matches")):
            capture = capture_fixture()
            capture[field] = value
            with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                converter.convert_capture(capture, catalog_fixture())

    def test_rejects_missing_required_general_fields_and_invalid_known_values(self):
        for group, text in (("General", "Matches\n5"), ("General", "Matches\n0\nGoals scored\n13\nGoals conceded\n5\nAssists\n10"),
                            ("Attacking", "Total shots per game\n13.6 km"), ("Attacking", "Free kick goals\n2/1"),
                            ("Passes", "Ball possession\n101%"), ("Passes", "Accurate passes\n561 (101%)"),
                            ("Running performance (per match)", "Distance covered\n111.2 miles"),
                            ("Defending", "Clean sheets\n2.5")):
            capture = capture_fixture()
            capture["groups"][group] = text
            with self.subTest(group=group, text=text), self.assertRaises(ValueError):
                converter.convert_capture(capture, catalog_fixture())
        capture = capture_fixture()
        capture["rating"] = "10.1"
        with self.assertRaises(ValueError):
            converter.convert_capture(capture, catalog_fixture())

    def test_zero_observed_counts_are_preserved_and_missing_rating_is_omitted(self):
        capture = capture_fixture()
        capture["groups"]["General"] = "Matches\n5\nGoals scored\n0\nGoals conceded\n0\nAssists\n0"
        capture.pop("rating")
        output = converter.convert_capture(capture, catalog_fixture())
        self.assertEqual(len(output), 1)
        statistics = output[0]["teams"][0]["season_statistics"]
        self.assertEqual(statistics["goalsScored"], 0)
        self.assertNotIn("avgRating", statistics)

    def test_penalty_count_and_visible_ratio_keep_only_observed_denominator(self):
        for displayed, expected in (("0", {"penaltyGoals": 0}), ("0/1", {"penaltyGoals": 0, "penaltiesTaken": 1})):
            capture = capture_fixture()
            capture["groups"]["Attacking"] = "Penalty goals\n" + displayed
            with self.subTest(displayed=displayed):
                statistics = converter.convert_capture(capture, catalog_fixture())[0]["teams"][0]["season_statistics"]
                self.assertEqual({key: statistics[key] for key in ("penaltyGoals", "penaltiesTaken") if key in statistics}, expected)

    def test_input_catalog_and_existing_output_cannot_be_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            raw, catalog, output = (Path(directory) / name for name in ("raw.json", "catalog.json", "output.json"))
            raw.write_text(json.dumps(capture_fixture()), encoding="utf-8")
            catalog.write_text(json.dumps(catalog_fixture()), encoding="utf-8")
            for protected in (raw, catalog):
                before = protected.read_bytes()
                with self.assertRaises(ValueError):
                    converter.run_conversion(raw, catalog, protected)
                self.assertEqual(protected.read_bytes(), before)
            output.write_text("existing", encoding="utf-8")
            with self.assertRaises(ValueError):
                converter.run_conversion(raw, catalog, output)
            self.assertEqual(output.read_text(encoding="utf-8"), "existing")

    def test_invalid_capture_never_creates_an_empty_success_file(self):
        with tempfile.TemporaryDirectory() as directory:
            raw, catalog, output = (Path(directory) / name for name in ("raw.json", "catalog.json", "output.json"))
            raw.write_text(json.dumps({}), encoding="utf-8")
            catalog.write_text(json.dumps(catalog_fixture()), encoding="utf-8")
            with self.assertRaises(ValueError):
                converter.run_conversion(raw, catalog, output)
            self.assertFalse(output.exists())

    def test_valid_capture_writes_only_selected_observed_scope(self):
        with tempfile.TemporaryDirectory() as directory:
            raw, catalog, output = (Path(directory) / name for name in ("raw.json", "catalog.json", "output.json"))
            raw.write_text(json.dumps(capture_fixture()), encoding="utf-8")
            catalog.write_text(json.dumps(catalog_fixture()), encoding="utf-8")
            summary = converter.run_conversion(raw, catalog, output)
            self.assertEqual((summary["requested"], summary["succeeded"], summary["failed"]), (1, 1, 0))
            self.assertEqual(json.loads(output.read_text(encoding="utf-8")),
                             converter.convert_capture(capture_fixture(), catalog_fixture()))
            self.assertEqual(list(output.parent.glob("*.tmp")), [])

    def test_duplicate_visible_known_field_is_rejected(self):
        capture = capture_fixture()
        capture["groups"]["General"] += "\nMatches\n6"
        with self.assertRaises(ValueError):
            converter.convert_capture(capture, catalog_fixture())

    def test_cli_requires_saved_input(self):
        with redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            converter.parse_args([])


if __name__ == "__main__":
    unittest.main()
