# Football Team Profile API

`GET /api/football/teams/:teamId/profile` returns a read-only, member-safe football team profile for the team detail page.

When `AUTH_ENABLED=true`, the endpoint requires a valid member/admin auth cookie. Anonymous requests return `401`. The response is not admin-only and does not include raw provider payloads, provider credentials, database credentials, provider IDs, conflict internals, or prediction draft internals.

## Response Sections

- `team`: canonical team identity, logo, country, and primary competition.
- `standing`: latest normalized `football_standings` row for the team when available; otherwise `null`.
- `formSummary`: latest nullable-season window-5 `football_team_form_features` rows for `overall`, `home`, and `away`.
- `goalProfile`: goal-rate fields derived from the latest overall form summary. Missing source values remain `null`.
- `recentMatches`: latest finished football matches involving the team, including opponent, home/away context, fulltime score, halftime score, and `W|D|L` result.
- `upcomingMatches`: next scheduled/not-started matches with feature snapshot status when available.
- `dataCoverage`: normalized-data availability summary. Player, lineup, and injury flags are currently `false` until those data sources are implemented.

## Data Sources

The endpoint reads only normalized SkorIQ tables:

- `teams`
- `countries`
- `competitions`
- `football_standings`
- `matches`
- `football_match_scores`
- `football_team_form_features`
- `football_match_prediction_features`

It does not call providers, write to the database, run ingestion, generate predictions, settle outputs, or publish anything.

## Example

```http
GET /api/football/teams/50118e80-fc92-449a-9742-6e986863b744/profile
```

```json
{
  "team": {
    "id": "50118e80-fc92-449a-9742-6e986863b744",
    "name": "Arsenal FC",
    "logoUrl": "https://...",
    "country": "England",
    "primaryCompetition": {
      "id": "85a16e6c-0aff-4ab8-9693-7d258ec7cb86",
      "name": "Premier League",
      "country": "England"
    }
  },
  "standing": {
    "position": 1,
    "played": 30,
    "wins": 20,
    "draws": 5,
    "losses": 5,
    "goalsFor": 60,
    "goalsAgainst": 25,
    "goalDifference": 35,
    "points": 65
  },
  "formSummary": {
    "overall": null,
    "home": null,
    "away": null
  },
  "goalProfile": {
    "scoredRate": null,
    "concededRate": null,
    "teamOver05Rate": null,
    "teamOver15Rate": null,
    "under25Rate": null,
    "firstHalfOver05Rate": null,
    "firstHalfAvgGoalsFor": null,
    "firstHalfAvgGoalsAgainst": null
  },
  "recentMatches": [],
  "upcomingMatches": [],
  "dataCoverage": {
    "matchesAvailable": 0,
    "scoresAvailable": 0,
    "formCoverageScore": null,
    "hasStanding": true,
    "hasLogo": true,
    "playersAvailable": false,
    "lineupsAvailable": false,
    "injuriesAvailable": false
  }
}
```

