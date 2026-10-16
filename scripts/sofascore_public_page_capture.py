"""Convert a saved visible SofaScore statistics panel without network or database access."""

import argparse
import json
import re
import unicodedata
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import urlsplit

from sofascore_fetch_team_statistics import (
    LEAGUE_IDENTITY_FIELDS, MAX_SAFE_INTEGER, TEAM_IDENTITY_FIELDS,
    default_output_path, positive_id, utc_timestamp, validate_output, write_capture,
)

NUMBER = r"(?:0|[1-9]\d*)(?:\.\d+)?"
# Only labels with explicit units or unambiguous season counts are mapped.
METRICS = {
    "General": {
        "Matches": ("matches", "integer"), "Goals scored": ("goalsScored", "integer"),
        "Goals conceded": ("goalsConceded", "integer"), "Assists": ("assists", "integer"),
    },
    "Attacking": {
        "Goals per game": ("goalsScoredPerGame", "number"), "Penalty goals": (("penaltyGoals", "penaltiesTaken"), "count_or_ratio"),
        "Free kick goals": (("freeKickGoals", "freeKickShots"), "ratio"),
        "Goals from inside the box": (("goalsFromInsideTheBox", "shotsFromInsideTheBox"), "ratio"),
        "Goals from outside the box": (("goalsFromOutsideTheBox", "shotsFromOutsideTheBox"), "ratio"),
        "Left-footed goals": ("leftFootGoals", "integer"), "Right-footed goals": ("rightFootGoals", "integer"),
        "Headed goals": ("headedGoals", "integer"), "Big chances per game": ("bigChancesPerGame", "number"),
        "Big chances missed per game": ("bigChancesMissedPerGame", "number"),
        "Total shots per game": ("shotsPerGame", "number"), "Shots on target per game": ("shotsOnTargetPerGame", "number"),
        "Shots off target per game": ("shotsOffTargetPerGame", "number"), "Blocked shots per game": ("blockedScoringAttemptPerGame", "number"),
        "Succ. dribbles per game": ("successfulDribblesPerGame", "number"), "Corners per game": ("cornersPerGame", "number"),
        "Free kicks per game": ("freeKicksPerGame", "number"), "Hit woodwork": ("hitWoodwork", "integer"),
        "Counter attacks": ("fastBreaks", "integer"),
    },
    "Passes": {
        "Ball possession": ("averageBallPossession", "percent"),
        "Accurate passes": ("accuratePassesPercentage", "percentage_only"),
        "Acc. own half": ("accurateOwnHalfPassesPercentage", "percentage_only"),
        "Acc. opposition half": ("accurateOppositionHalfPassesPercentage", "percentage_only"),
        "Acc. long balls": ("accurateLongBallsPercentage", "percentage_only"),
        "Acc. crosses": ("accurateCrossesPercentage", "percentage_only"),
    },
    "Defending": {
        "Clean sheets": ("cleanSheets", "integer"), "Goals conceded per game": ("goalsConcededPerGame", "number"),
        "Tackles per game": ("tacklesPerGame", "number"), "Interceptions per game": ("interceptionsPerGame", "number"),
        "Clearances per game": ("clearancesPerGame", "number"), "Saves per game": ("savesPerGame", "number"),
        "Balls recovered per game": ("ballRecoveryPerGame", "number"), "Errors leading to shot": ("errorsLeadingToShot", "integer"),
        "Errors leading to goal": ("errorsLeadingToGoal", "integer"), "Penalties committed": ("penaltiesCommited", "integer"),
        "Penalty goals conceded": ("penaltyGoalsConceded", "integer"), "Clearance off line": ("clearancesOffLine", "integer"),
        "Last man tackle": ("lastManTackles", "integer"),
    },
    "Running performance (per match)": {
        "Distance covered": ("kilometersCoveredPerGame", "km"), "Number of sprints": ("numberOfSprintsPerGame", "number"),
    },
    "Other": {
        "Duels won per game": (("duelsWonPerGame", "duelsWonPercentage"), "number_percentage"),
        "Ground duels won": ("groundDuelsWonPercentage", "percentage_only"),
        "Aerial duels won": ("aerialDuelsWonPercentage", "percentage_only"),
        "Possession lost per game": ("possessionLostPerGame", "number"), "Throw-ins per game": ("throwInsPerGame", "number"),
        "Goal kicks per game": ("goalKicksPerGame", "number"), "Offsides per game": ("offsidesPerGame", "number"),
        "Fouls per game": ("foulsPerGame", "number"), "Yellow cards per game": ("yellowCardsPerGame", "number"),
        "Red cards": ("redCards", "integer"),
    },
}


def normalized(value):
    if not isinstance(value, str) or not value.strip():
        raise ValueError("Required identity text is missing.")
    return " ".join(unicodedata.normalize("NFKC", value).casefold().split())


def capture_identity(capture):
    if not isinstance(capture, dict) or normalized(capture.get("selectedTab")) != "statistics":
        raise ValueError("Capture must come from the selected Statistics tab.")
    endpoint = capture.get("pageUrl")
    if not isinstance(endpoint, str):
        raise ValueError("Capture requires a public team statistics URL.")
    url = urlsplit(endpoint)
    route = re.fullmatch(r"/football/team/([^/]+)/([1-9]\d*)/?", url.path)
    if (url.scheme != "https" or url.netloc not in {"www.sofascore.com", "sofascore.com"}
            or url.query or url.fragment != "tab:statistics" or not route):
        raise ValueError("Capture requires a public team statistics URL.")
    captured_at = capture.get("capturedAt")
    if not isinstance(captured_at, str) or not re.fullmatch(
            r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)", captured_at):
        raise ValueError("Capture time must be an ISO timestamp in UTC.")
    instant = datetime.fromisoformat(captured_at.replace("Z", "+00:00"))
    if instant.utcoffset() != timedelta(0):
        raise ValueError("Capture time must be in UTC.")
    return positive_id(int(route[2])), endpoint, utc_timestamp(instant)


def resolve_scope(capture, catalog, team_id):
    if not isinstance(catalog, list):
        raise ValueError("Catalog must contain a league list.")
    tournament = normalized(capture.get("tournamentLabel"))
    season = normalized(capture.get("seasonLabel"))
    team_name = normalized(capture.get("teamName"))
    proof = capture.get("scopeProofUrl")
    proof_ids = None
    if proof is not None:
        if not isinstance(proof, str):
            raise ValueError("Scope proof must be a public tournament URL.")
        url = urlsplit(proof)
        route = re.fullmatch(r"/football/tournament/([^/]+)/([^/]+)/([1-9]\d*)/?", url.path)
        fragment = re.fullmatch(r"id:([1-9]\d*)", url.fragment)
        if (url.scheme != "https" or url.netloc not in {"www.sofascore.com", "sofascore.com"}
                or url.query or not route or not fragment):
            raise ValueError("Scope proof must be a public tournament and season URL.")
        proof_ids = (positive_id(int(route[3])), positive_id(int(fragment[1])))
    candidates = []
    for league in catalog:
        if not isinstance(league, dict) or normalized(league.get("league_name")) != tournament:
            continue
        scope = (positive_id(league.get("sofascore_tournament_id")), positive_id(league.get("season_id")))
        if proof_ids is not None and scope != proof_ids:
            continue
        catalog_season = normalized(league.get("season_name"))
        year_token = re.search(r"\b\d{2}(?:\d{2})?/\d{2}(?:\d{2})?$", catalog_season)
        if (catalog_season not in {season, tournament + " " + season}
                and not (proof_ids is not None and year_token and year_token[0] == season)):
            continue
        teams = league.get("teams")
        if not isinstance(teams, list):
            raise ValueError("Catalog scope must contain teams.")
        for team in teams:
            if isinstance(team, dict) and team.get("sofascore_id") == team_id:
                positive_id(team.get("sofascore_id"))
                if normalized(team.get("name")) != team_name:
                    raise ValueError("Captured team name conflicts with the catalog identity.")
                candidates.append((league, team))
    if len(candidates) != 1:
        raise ValueError("Captured team and season must resolve to exactly one catalog scope.")
    return candidates[0]


def number(value, integer=False, maximum=MAX_SAFE_INTEGER):
    if not re.fullmatch(r"(?:0|[1-9]\d*)" if integer else NUMBER, value):
        raise ValueError("Known metric has an invalid numeric value or unit.")
    result = int(value) if integer or "." not in value else float(value)
    if result > maximum:
        raise ValueError("Known metric is outside its permitted range.")
    return result


def metric_value(value, kind):
    if kind == "count_or_ratio" and "/" not in value:
        return (number(value, integer=True),)
    if kind in {"ratio", "count_or_ratio"}:
        match = re.fullmatch(r"(\d+)/(\d+)", value)
        if not match:
            raise ValueError("Known metric requires a count ratio.")
        counts = tuple(number(part, integer=True) for part in match.groups())
        if counts[0] > counts[1]:
            raise ValueError("Goal count cannot exceed its visible shot count.")
        return counts
    if kind in {"percentage_only", "number_percentage"}:
        match = re.fullmatch(rf"({NUMBER})\s+\(({NUMBER})%\)", value)
        if not match:
            raise ValueError("Known metric requires a visible amount and percentage.")
        amount, percent = number(match[1]), number(match[2], maximum=100)
        return (percent,) if kind == "percentage_only" else (amount, percent)
    suffix = "%" if kind == "percent" else " km" if kind == "km" else ""
    if suffix and not value.endswith(suffix):
        raise ValueError("Known metric is missing its expected unit.")
    numeric = value[:-len(suffix)] if suffix else value
    return (number(numeric, integer=kind == "integer", maximum=100 if kind == "percent" else MAX_SAFE_INTEGER),)


def convert_capture(capture, catalog):
    team_id, endpoint, captured_at = capture_identity(capture)
    league, team = resolve_scope(capture, catalog, team_id)
    groups = capture.get("groups")
    if not isinstance(groups, dict):
        raise ValueError("Capture requires visible statistics groups.")
    statistics = {}
    for group, labels in METRICS.items():
        text = groups.get(group, "")
        if not isinstance(text, str):
            raise ValueError("Visible statistics groups must be text.")
        lines = [line.strip() for line in text.splitlines() if line.strip()]
        for index, line in enumerate(lines):
            if line not in labels:
                continue
            fields, kind = labels[line]
            fields = fields if isinstance(fields, tuple) else (fields,)
            if index + 1 == len(lines) or any(field in statistics for field in fields):
                raise ValueError("Known metric is missing or duplicated.")
            statistics.update(zip(fields, metric_value(lines[index + 1], kind)))
    if not {"matches", "goalsScored", "goalsConceded", "assists"} <= statistics.keys() or statistics["matches"] <= 0:
        raise ValueError("General statistics require played matches, goals and assists.")
    rating = capture.get("rating", "")
    if not isinstance(rating, str):
        raise ValueError("Visible rating must be text.")
    if rating.strip():
        statistics["avgRating"] = number(rating.strip(), maximum=10)
    captured_team = {field: team[field] for field in TEAM_IDENTITY_FIELDS if field in team}
    captured_team.update(season_statistics=statistics, providerFetchedAt=captured_at, endpoint=endpoint,
                         source="sofascore_public_page", captureMethod="visible_dom", statisticsCoverage="visible_partial")
    if "scopeProofUrl" in capture:
        captured_team["scopeProofUrl"] = capture["scopeProofUrl"]
    result = {field: league[field] for field in LEAGUE_IDENTITY_FIELDS if field in league}
    result.update(teams=[captured_team], teams_count=1)
    return [result]


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path, help="Saved visible-DOM JSON; no browser or network is used.")
    parser.add_argument("--catalog", type=Path, default=Path(__file__).with_name("sofascore_catalog.json"))
    parser.add_argument("--output", type=Path, help="New capture JSON; existing files are never overwritten.")
    return parser.parse_args(argv)


def run_conversion(input_path, catalog_path, output_path):
    input_path, catalog_path, output_path = map(Path, (input_path, catalog_path, output_path))
    validate_output(input_path, output_path)
    validate_output(catalog_path, output_path)
    try:
        capture = json.loads(input_path.read_text(encoding="utf-8"))
        catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        raise ValueError("Saved capture and catalog must be readable JSON.") from None
    write_capture(output_path, convert_capture(capture, catalog))
    return {"requested": 1, "succeeded": 1, "failed": 0, "source": "sofascore_public_page", "output": str(output_path)}


def main(argv=None):
    options = parse_args(argv)
    try:
        summary = run_conversion(options.input, options.catalog, options.output or default_output_path())
    except (ValueError, OSError):
        print(json.dumps({"requested": 1, "succeeded": 0, "failed": 1,
                          "error": "Invalid capture, unresolved scope, or protected output; no capture was published."}))
        return 1
    print(json.dumps(summary))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
