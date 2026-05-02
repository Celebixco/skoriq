# SkorIQ Dashboard Overview API

## Purpose

`GET /api/dashboard/overview` gives the dashboard home page a compact read-only payload so the frontend does not need to assemble overview cards by calling many analytics, catalog, prediction, and admin endpoints.

The endpoint never calls providers, runs ingestion, writes to the database, changes prediction/settlement/public states, or exposes raw provider payloads.

## Access

Authentication is required when `AUTH_ENABLED=true`.

| User | Result |
| --- | --- |
| Anonymous | `401` |
| Member | `200` with member-safe overview |
| Admin | `200` with member-safe overview plus `admin` summary |

The `admin` field is omitted entirely for members.

## Response Shape

```json
{
  "user": {
    "email": "member@example.com",
    "role": "member"
  },
  "overview": {
    "analyzedMatchesCount": 12,
    "readyMatchesCount": 7,
    "partialMatchesCount": 3,
    "insufficientMatchesCount": 2,
    "averageCombinedCoverageScore": 63.5,
    "predictionEligibleCount": 7,
    "h2hMissingCount": 4
  },
  "upcomingMatches": [],
  "analysisDistribution": {
    "ready": 7,
    "partial": 3,
    "insufficient": 2,
    "unknown": 0
  },
  "coverageSummary": {
    "averageCombinedCoverageScore": 63.5,
    "averageHomeFormCoverage": 72.25,
    "averageAwayFormCoverage": 70.75,
    "averageH2hCoverage": 48
  },
  "predictionPreview": {
    "status": "available",
    "items": []
  },
  "dataStatus": {
    "analyticsApi": "ok",
    "teamsCatalog": "ok",
    "competitionsCatalog": "ok",
    "predictionPreview": "empty"
  }
}
```

Admins additionally receive:

```json
{
  "admin": {
    "draftPredictionCount": 5,
    "settlementCount": 4,
    "publicEligibilityExcludedCount": 3,
    "publicEligibilityEligibleCount": 1,
    "rebuildRequiredCount": 2
  }
}
```

## Member-Safe Prediction Preview

The overview includes only safe preview items:

- `recommendation_tier` is `primary`, `try`, or `alternative`
- `consistency_status` is `passed` or `warning`
- candidate is not `avoid`
- candidate is not `blocked`
- candidate is not audit-only
- candidate was generated before kickoff
- candidate has no blocking conflicts
- stale/too-early/too-late/unknown window candidates are not returned as normal items

Members never receive conflict details, raw metadata, expectation snapshots, audit-only rows, provider IDs, database IDs beyond canonical match/prediction identifiers needed by product UI, secrets, tokens, or passwords.

## Data Status

`dataStatus` lets the frontend keep the home page resilient if an optional section is empty or temporarily unavailable:

- `ok`: section loaded and has data
- `empty`: section loaded but has no rows/items
- `error`: section failed; no mutation was attempted

Database availability failures may still make the whole API request fail at the infrastructure layer.
