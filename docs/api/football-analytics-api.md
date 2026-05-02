# SkorIQ Football Analytics API

## Overview

These endpoints expose read-only SkorIQ football Maç analizi reports built from existing normalized data, feature snapshots, and the deterministic reasoning layer.

When `AUTH_ENABLED=true`, all football analytics and catalog endpoints documented here require a valid membership auth cookie. Unauthenticated requests return `401`.

They do not:

- generate final score predictions
- generate final Tahmin output or public successful-prediction flows
- call providers
- run ingestion
- write to the database
- start scheduler jobs or live-score behavior
- expose raw provider payloads, provider API keys, database URLs, credentials, or provider IDs by default

Current base path includes the API service global prefix:

```http
/api
```

## Dashboard Overview

The dashboard home page should use the compact overview endpoint documented in `docs/api/dashboard-overview-api.md`:

```http
GET /api/dashboard/overview
```

It is authenticated, read-only, role-aware, and returns member-safe analytics overview data plus admin-only summary fields when the authenticated user has `role=admin`. It does not call providers, run ingestion, write to the database, or expose admin/internal prediction review data to members.

## Single Match Analytics

```http
GET /api/analytics/football/matches/:matchId
```

Returns one football match analytics report from an existing `football_match_prediction_features` snapshot and reasoning output.

### Path Parameters

| Name | Type | Required | Description |
| --- | --- | --- | --- |
| `matchId` | UUID | yes | Canonical match ID. |

### Query Parameters

| Name | Type | Required | Description |
| --- | --- | --- | --- |
| `debug` | boolean | no | When `true`, includes source feature IDs and sanitized metadata references. Defaults to `false`. |

### Responses

| Status | Meaning |
| --- | --- |
| `200` | Match analytics report found. |
| `400` | Invalid UUID or query parameter. |
| `401` | Authentication required when auth is enabled. |
| `404` | Match does not exist, or the analytics feature snapshot has not been built yet. |

### Example Request

```http
GET /api/analytics/football/matches/89759e35-758d-416e-b0d3-ad07436c8a9b
```

### Example Response

```json
{
  "match": {
    "matchId": "89759e35-758d-416e-b0d3-ad07436c8a9b",
    "competition": {
      "id": "e91bf32e-3683-49f6-8077-6247889e58a5",
      "name": "Bundesliga",
      "country": "Germany"
    },
    "kickoffAt": "2026-04-26T17:30:00.000Z",
    "status": "finished",
    "homeTeam": {
      "id": "b4235ef3-4d8c-4461-aeec-37e9abef3130",
      "name": "Borussia Dortmund"
    },
    "awayTeam": {
      "id": "example-away-team-id",
      "name": "Freiburg"
    }
  },
  "featureStatus": "ready",
  "predictionEligible": true,
  "kuponEligible": false,
  "confidenceCeiling": 65,
  "combinedCoverageScore": 64,
  "homeForm": {
    "sampleSize": 5,
    "coverageScore": 70,
    "scope": "home",
    "windowSize": 5
  },
  "awayForm": {
    "sampleSize": 4,
    "coverageScore": 58,
    "scope": "away",
    "windowSize": 5
  },
  "h2h": {
    "sampleSize": 0,
    "coverageScore": 0,
    "h2hMissing": true
  },
  "positiveSignals": [
    "Minimum MVP feature readiness is satisfied.",
    "Home team form coverage is strong: sample_size=5, coverage=70.00.",
    "Away team form coverage is strong: sample_size=4, coverage=58.00.",
    "Combined feature coverage is usable for MVP analysis: 64.00."
  ],
  "riskFactors": [
    "Head-to-head history is missing or zero-sample, so confidence is capped."
  ],
  "missingDataWarnings": [
    "Head-to-head sample is unavailable for this matchup."
  ],
  "summary": "Feature readiness is ready; team-form coverage is sufficient for MVP prediction analysis, but missing H2H caps confidence at 65."
}
```

### Debug Response Additions

```http
GET /api/analytics/football/matches/89759e35-758d-416e-b0d3-ad07436c8a9b?debug=true
```

Adds:

```json
{
  "debug": {
    "sourceFeatureIds": {
      "homeFormFeatureId": "home-form-feature-uuid",
      "awayFormFeatureId": "away-form-feature-uuid",
      "h2hFeatureId": "h2h-feature-uuid"
    },
    "metadata": {
      "h2hMissing": true,
      "coverageFormula": "team_form_only_h2h_missing"
    }
  }
}
```

Debug output is for operators and internal tooling. It must not include provider API keys, database credentials, raw provider payloads, or provider request URLs.

## Match Analytics List

```http
GET /api/analytics/football/matches
```

Lists football matches with existing analytics snapshots. The response uses the same item shape as the single-match endpoint and adds pagination metadata.

### Query Parameters

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `featureStatus` | `ready` \| `partial` \| `insufficient_data` | no | none | Filter by feature readiness status. |
| `predictionEligible` | boolean | no | none | Filter by feature-readiness eligibility. This is not a final prediction. |
| `kuponEligible` | boolean | no | none | Contract field for future public-use eligibility. Currently expected to be `false` because no public successful-prediction engine exists. |
| `competitionId` | UUID | no | none | Filter by canonical competition ID. |
| `teamId` | UUID | no | none | Filter by canonical home or away team ID. |
| `limit` | integer | no | `20` | Page size. Minimum `1`, maximum `100`. |
| `offset` | integer | no | `0` | Zero-based offset. |
| `debug` | boolean | no | `false` | Include source feature IDs and sanitized metadata references on each item. |

### Responses

| Status | Meaning |
| --- | --- |
| `200` | List returned. Empty `items` is valid. |
| `400` | Invalid query parameter, UUID, boolean, feature status, limit, or offset. |
| `401` | Authentication required when auth is enabled. |

### Example Request

```http
GET /api/analytics/football/matches?featureStatus=ready&limit=20&offset=0
```

### Example Response

```json
{
  "items": [
    {
      "match": {
        "matchId": "89759e35-758d-416e-b0d3-ad07436c8a9b",
        "competition": {
          "id": "e91bf32e-3683-49f6-8077-6247889e58a5",
          "name": "Bundesliga",
          "country": "Germany"
        },
        "kickoffAt": "2026-04-26T17:30:00.000Z",
        "status": "finished",
        "homeTeam": {
          "id": "b4235ef3-4d8c-4461-aeec-37e9abef3130",
          "name": "Borussia Dortmund"
        },
        "awayTeam": {
          "id": "example-away-team-id",
          "name": "Freiburg"
        }
      },
      "featureStatus": "ready",
      "predictionEligible": true,
      "kuponEligible": false,
      "confidenceCeiling": 65,
      "combinedCoverageScore": 64,
      "homeForm": {
        "sampleSize": 5,
        "coverageScore": 70,
        "scope": "home",
        "windowSize": 5
      },
      "awayForm": {
        "sampleSize": 4,
        "coverageScore": 58,
        "scope": "away",
        "windowSize": 5
      },
      "h2h": {
        "sampleSize": 0,
        "coverageScore": 0,
        "h2hMissing": true
      },
      "positiveSignals": [
        "Minimum MVP feature readiness is satisfied."
      ],
      "riskFactors": [
        "Head-to-head history is missing or zero-sample, so confidence is capped."
      ],
      "missingDataWarnings": [
        "Head-to-head sample is unavailable for this matchup."
      ],
      "summary": "Feature readiness is ready; team-form coverage is sufficient for MVP prediction analysis, but missing H2H caps confidence at 65."
    }
  ],
  "pagination": {
    "limit": 20,
    "offset": 0,
    "total": 1
  }
}
```

## Field Definitions

| Field | Meaning |
| --- | --- |
| `featureStatus` | Readiness status from `football_match_prediction_features`: `ready`, `partial`, or `insufficient_data`. |
| `predictionEligible` | `true` only when the feature snapshot is ready under the current readiness policy. This does not mean a prediction has been made. |
| `kuponEligible` | Currently always `false` because no public successful-prediction engine exists. |
| `confidenceCeiling` | Displayed as Güven skoru. It is a deterministic confidence cap from the reasoning layer, not a win probability. |
| `combinedCoverageScore` | Coverage score from the match prediction feature snapshot. Current MVP logic weights home/away form and treats H2H as optional when missing. |
| `homeForm` / `awayForm` | Team-form source sample size, coverage score, scope, and window size used by the snapshot. |
| `h2h` | Head-to-head source sample size, coverage score, and whether H2H is missing or zero-sample. |
| `positiveSignals` | Deterministic reasons the match is analytically usable. |
| `riskFactors` | Deterministic confidence or quality risks. |
| `missingDataWarnings` | Missing source context that future consumers should account for. |
| `summary` | Human-readable deterministic explanation from the reasoning layer. |

## Football Team Catalog

```http
GET /api/football/teams
GET /api/football/teams/:teamId
GET /api/football/teams/:teamId/profile
```

These endpoints are read-only catalog helpers for the dashboard. They expose canonical team identity and persisted `teams.logo_url` values, never provider credentials or raw payloads.

### Team List Query Parameters

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `competitionId` | UUID | no | none | Restrict teams to matches in one competition. |
| `search` | string | no | none | Case-insensitive team name search. Maximum 80 characters. |
| `limit` | integer | no | `50` | Page size. Minimum `1`, maximum `100`. |
| `offset` | integer | no | `0` | Zero-based offset. |

### Team List Item

```json
{
  "teamId": "b4235ef3-4d8c-4461-aeec-37e9abef3130",
  "name": "Borussia Dortmund",
  "shortName": "Dortmund",
  "logoUrl": "https://...",
  "country": "Germany",
  "competitions": [
    {
      "competitionId": "e91bf32e-3683-49f6-8077-6247889e58a5",
      "name": "Bundesliga",
      "country": "Germany"
    }
  ],
  "matchesCount": 12,
  "hasLogo": true,
  "latestFormCoverage": 70
}
```

### Team Detail Additions

`GET /api/football/teams/:teamId` returns the same identity fields plus:

- `recentMatches`
- `latestForm`
- `analyticsReadiness`

Invalid team UUIDs return `400`. Missing football teams return `404`.
Unauthenticated requests return `401` when auth is enabled.

### Team Profile

`GET /api/football/teams/:teamId/profile` is the richer team-detail API for member/admin dashboards. It uses only normalized database tables and returns:

- canonical team identity, logo, country, and primary competition
- current standing when available
- latest nullable-season window-5 form summaries for `overall`, `home`, and `away`
- goal-profile fields from team form features
- latest finished matches with fulltime/halftime score and `W|D|L` result
- upcoming matches with match prediction feature status when a snapshot exists
- data coverage flags for matches, scores, logo, standing, and not-yet-normalized player/lineup/injury data

The profile endpoint does not expose provider IDs by default, raw provider payloads, provider API keys, database credentials, conflict internals, prediction draft internals, or fake/static values.

## Football Competition Catalog

```http
GET /api/football/countries
GET /api/football/countries/:countryId/competitions
GET /api/football/competitions
GET /api/football/competitions/:competitionId
GET /api/football/competitions/:competitionId/profile
```

These endpoints are read-only Football Explorer helpers for dashboard browsing. The intended product path is:

`Country -> Leagues -> League Detail -> Teams -> Team Detail`

They use normalized `countries`, `competitions`, `teams`, `football_standings`, `matches`, `football_match_scores`, `football_team_form_features`, and `football_match_prediction_features` data. They do not call providers or expose raw provider payloads.

### Country List Item

```json
{
  "id": "694d8845-e034-457e-ba41-82e89d5c1b5f",
  "name": "England",
  "logoUrl": null,
  "competitionCount": 1,
  "teamCount": 20,
  "matchCount": 233,
  "finishedMatchCount": 223,
  "upcomingMatchCount": 10,
  "averageCoverage": 74.58
}
```

Country logos are currently nullable because the canonical `countries` table does not store a logo field.

### Country Competitions Item

```json
{
  "id": "85a16e6c-0aff-4ab8-9693-7d258ec7cb86",
  "name": "Premier League",
  "country": {
    "id": "694d8845-e034-457e-ba41-82e89d5c1b5f",
    "name": "England"
  },
  "logoUrl": null,
  "teamCount": 20,
  "standingRows": 20,
  "matchCount": 233,
  "finishedMatchCount": 223,
  "upcomingMatchCount": 10,
  "averageCoverage": 74.58,
  "dataStatus": "ready"
}
```

`dataStatus` is `ready`, `partial`, or `insufficient` based on normalized teams/matches/coverage. League logos are returned only when a public-safe URL already exists in canonical competition metadata; otherwise `logoUrl` is `null`.

### Competition List Query Parameters

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `limit` | integer | no | `50` | Page size. Minimum `1`, maximum `100`. |
| `offset` | integer | no | `0` | Zero-based offset. |

### Competition List Item

```json
{
  "competitionId": "e91bf32e-3683-49f6-8077-6247889e58a5",
  "name": "Bundesliga",
  "country": "Germany",
  "teamsCount": 18,
  "matchesCount": 54,
  "readyMatchesCount": 1,
  "averageCoverage": 64
}
```

### Competition Detail Additions

`GET /api/football/competitions/:competitionId` returns the same identity fields plus:

- `teams` with logos
- `matches`
- `standings` when normalized standing rows exist
- `analyticsReadiness`

Invalid competition UUIDs return `400`. Missing football competitions return `404`.
Unauthenticated requests return `401` when auth is enabled.

### Competition Profile

`GET /api/football/competitions/:competitionId/profile` returns the League Detail screen payload:

- `competition`: canonical competition identity, nullable league logo URL, and country identity
- `summary`: team, standing, match, finished/upcoming, average coverage, H2H-supported upcoming, and prediction-ready upcoming counts
- `standings`: normalized standing rows with team logo URLs
- `teams`: canonical team cards with persisted `teams.logo_url`
- `upcomingMatches`: upcoming/scheduled canonical matches with coverage hints
- `recentMatches`: latest finished canonical matches with coverage hints
- `dataCoverage`: public-safe readiness flags for the league detail page

The profile response never includes provider IDs by default, raw payloads, internal provider mappings, DB credentials, admin-only draft metadata, or settlement/public publication state.

## Safety And Non-Goals

These endpoints are intentionally limited:

- No final score prediction is returned.
- No final Tahmin output or public successful-prediction output is returned.
- No raw provider payload is returned.
- No provider API key, database URL, credential, or provider request URL is returned.
- No provider call is made.
- No ingestion, feature rebuild, queue enqueue, scheduler job, or database write is triggered.
- No live-score behavior is implemented.

## Intended Future Consumers

- Admin dashboards for verifying analytics readiness.
- Future frontend match analysis screens.
- Future prediction services that consume only `ready` feature rows.
- Future public successful-prediction selectors that must apply stricter confidence and policy checks before considering any match.

Future consumers must treat `predictionEligible=true` as feature-readiness only. It is not model confidence, not a predicted outcome, and not public-use approval.
