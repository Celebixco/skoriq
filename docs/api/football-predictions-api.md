# SkorIQ Football Predictions API

## Overview

These endpoints expose read-only member-safe prediction previews plus internal review data for draft football Tahmin candidates and settled football Tahmin audit results.

All endpoints require authentication when `AUTH_ENABLED=true`. They are admin-only internal review endpoints for persisted `football_prediction_outputs`, `football_prediction_conflicts`, settlement rows, and public eligibility evaluator output.

RBAC behavior:

- Anonymous requests return `401`.
- Authenticated `member` users return `403`.
- Authenticated `admin` users can read these endpoints.

All prediction endpoints do not:

- mark predictions `member_visible`
- publish predictions
- settle predictions
- generate public successful-prediction cards
- generate tahmin kombini output
- call providers
- run ingestion
- write to the database
- expose raw provider payloads, provider API keys, database URLs, passwords, JWTs, or provider IDs by default

Current base path includes the API global prefix:

```http
/api
```

## Member-Safe Match Prediction Preview

```http
GET /api/member/football/matches/:matchId/prediction-preview
```

Returns a sanitized prediction preview for authenticated members and admins. This endpoint is intentionally separate from admin draft review endpoints.

RBAC behavior:

- Anonymous requests return `401`.
- Authenticated `member` users return `200`.
- Authenticated `admin` users return `200`.

Filtering rules:

- Includes only `status=draft` or `status=member_visible`.
- Includes only `recommendation_tier=primary|try|alternative`.
- Includes only `consistency_status=passed|warning`.
- Excludes `avoid`, `blocked`, `audit_only`, generated-after-kickoff, and candidates with blocking conflicts.
- Excludes raw metadata, expectation snapshots, conflict internals, provider IDs, and admin-only audit fields.

Stale behavior:

- If safe candidates exist but their analysis window status is `stale`, `too_early`, or `too_late`, the endpoint returns `status="stale"` with empty groups.
- If no safe candidate exists, the endpoint returns `status="not_available"`.

Response shape:

```json
{
  "matchId": "269856cc-f8af-436a-8b68-f7e635b890c5",
  "status": "available",
  "message": "Bu maç için SkorIQ ön tahmin yorumu hazır.",
  "groups": {
    "primary": [],
    "try": [
      {
        "predictionId": "prediction-id",
        "displayLabel": "MS 2.5 Üst",
        "predictionType": "over_under_goals",
        "predictionValue": "over_2_5",
        "recommendationTier": "try",
        "confidenceScore": 64,
        "riskLevel": "medium",
        "reasoningSummary": "Gol profili güçlü.",
        "generatedAt": "2026-05-01T10:00:00.000Z",
        "kickoffAt": "2026-05-01T18:30:00.000Z",
        "isFresh": true,
        "analysisWindowStatus": "within_window"
      }
    ],
    "alternative": []
  },
  "summary": "Bu ön tahminler mevcut veri kapsamına göre üretilmiştir; nihai sonuç garantisi değildir.",
  "warnings": []
}
```

Supported member labels include `MS 1`, `MS X`, `MS 2`, `Çifte Şans 1X`, `Çifte Şans X2`, `Çifte Şans 12`, `MS 2.5 Üst`, `MS 2.5 Alt`, `İY 0.5 Üst`, `KG Var`, and `KG Yok`.

## List Draft Prediction Outputs

```http
GET /api/football/predictions/drafts
```

Lists authenticated/internal draft prediction outputs. By default the endpoint returns `status=draft`.

### Query Parameters

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `matchId` | UUID | no | none | Filter by canonical match ID. |
| `status` | string | no | `draft` | Filter by prediction lifecycle status. |
| `consistencyStatus` | `unchecked` \| `passed` \| `warning` \| `blocked` | no | none | Filter by consistency status. |
| `recommendationTier` | `primary` \| `try` \| `alternative` \| `avoid` | no | none | Filter by candidate tier. |
| `predictionType` | string | no | none | Filter by prediction type, such as `match_result_1x2`. |
| `limit` | integer | no | `20` | Page size. Minimum `1`, maximum `100`. |
| `offset` | integer | no | `0` | Zero-based offset. |

### Response

```json
{
  "items": [
    {
      "predictionId": "db2b0842-117b-46b3-aa4f-c4ae68304e64",
      "matchId": "89759e35-758d-416e-b0d3-ad07436c8a9b",
      "match": {
        "matchId": "89759e35-758d-416e-b0d3-ad07436c8a9b",
        "competition": {
          "id": "e91bf32e-3683-49f6-8077-6247889e58a5",
          "name": "Bundesliga",
          "country": "Germany"
        },
        "kickoffAt": "2026-04-26T17:30:00.000Z",
        "status": "finished",
        "homeTeam": { "id": "home-team-id", "name": "Borussia Dortmund", "logoUrl": "https://example.test/dortmund.png" },
        "awayTeam": { "id": "away-team-id", "name": "Freiburg", "logoUrl": "https://example.test/freiburg.png" }
      },
      "predictionType": "match_result_1x2",
      "predictionValue": "1",
      "predictionFamily": "match_result",
      "recommendationTier": "primary",
      "displayLabel": "Tahminim",
      "confidenceScore": 65,
      "confidenceCeiling": 65,
      "riskLevel": "medium",
      "status": "draft",
      "consistencyStatus": "warning",
      "conflictCount": 2,
      "blockingConflictCount": 0,
      "warningConflictCount": 2,
      "reasoningSummary": "Ev sahibi form ve güç göstergelerinde önde görünüyor.",
      "generatedAt": "2026-04-30T00:00:00.000Z",
      "createdAt": "2026-04-30T00:00:00.000Z"
    }
  ],
  "pagination": {
    "limit": 20,
    "offset": 0,
    "total": 1
  }
}
```

## Draft Prediction Detail

```http
GET /api/football/predictions/drafts/:predictionId
```

Returns one draft prediction output with sanitized expectation, metadata, and consistency conflicts.

### Responses

| Status | Meaning |
| --- | --- |
| `200` | Draft prediction found. |
| `400` | Invalid UUID. |
| `401` | Authentication required. |
| `404` | Draft prediction not found. |

### Detail Additions

```json
{
  "expectationSnapshot": {
    "expectedHomeGoals": 1.85,
    "expectedAwayGoals": 0.98,
    "expectedTotalGoals": 2.83,
    "expectedScoreline": "2-1",
    "goalProfile": "medium_goal",
    "resultProfile": "home_lean",
    "h2hMissing": true
  },
  "consistencySummary": "Consistency dry-run complete: 0 passed, 4 warning, 1 blocked.",
  "conflicts": [
    {
      "conflictType": "h2h_missing_warning",
      "severity": "warning",
      "sourcePredictionType": "match_result_1x2",
      "conflictingPredictionType": null,
      "reason": "H2H sample is missing; confidence is capped and future usage should stay cautious."
    }
  ],
  "metadata": {
    "draftPersistencePolicy": "draft_only_not_member_visible"
  }
}
```

## Match Draft Prediction Review

```http
GET /api/football/matches/:matchId/prediction-drafts
```

Returns draft candidates for one football match grouped by recommendation tier.

### Response Shape

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
    "homeTeam": { "id": "home-team-id", "name": "Borussia Dortmund", "logoUrl": "https://example.test/dortmund.png" },
    "awayTeam": { "id": "away-team-id", "name": "Freiburg", "logoUrl": "https://example.test/freiburg.png" }
  },
  "outputsByRecommendationTier": {
    "primary": { "label": "Tahminim", "items": [] },
    "try": { "label": "Denenir", "items": [] },
    "alternative": { "label": "Alternatif", "items": [] },
    "avoid": { "label": "Uzak Dur", "items": [] }
  },
  "conflictsSummary": {
    "total": 11,
    "blocking": 1,
    "warning": 10,
    "info": 0
  },
  "memberVisible": false,
  "note": "Draft prediction candidates are internal review/audit rows only; no member visibility, settlement, public publishing, or tahmin kombini promotion is performed."
}
```

## Safety Notes

- Draft rows are internal review/audit data only.
- `memberVisible` remains false in the match-drafts response.
- `Uzak Dur` / `blocked` candidates may appear for audit, but must not be shown as recommendations.
- Public visitors cannot access these endpoints.
- No final score prediction, public successful-prediction card, settlement result, or tahmin kombini output is returned.

## List Prediction Settlements

```http
GET /api/football/predictions/settlements
```

Lists authenticated/internal settlement results. The endpoint is read-only and includes only outputs with a `football_prediction_settlements` row.

### Query Parameters

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `matchId` | UUID | no | none | Filter by canonical match ID. |
| `predictionId` | UUID | no | none | Filter by prediction output ID. |
| `settlementStatus` | `settled_success` \| `settled_failed` \| `settled_void` | no | none | Filter by settlement result. |
| `consistencyStatus` | `unchecked` \| `passed` \| `warning` \| `blocked` | no | none | Filter by consistency status. |
| `recommendationTier` | `primary` \| `try` \| `alternative` \| `avoid` | no | none | Filter by candidate tier. |
| `auditOnly` | boolean | no | none | Filter audit-only rows. Derived from settlement metadata or blocked/avoid fallback. |
| `limit` | integer | no | `20` | Page size. Minimum `1`, maximum `100`. |
| `offset` | integer | no | `0` | Zero-based offset. |

### Response Item

```json
{
  "settlementId": "c7e2f83c-8d95-4d58-b7cb-7c8f2d3a75cd",
  "predictionId": "db2b0842-117b-46b3-aa4f-c4ae68304e64",
  "matchId": "89759e35-758d-416e-b0d3-ad07436c8a9b",
  "match": {
    "matchId": "89759e35-758d-416e-b0d3-ad07436c8a9b",
    "competition": { "id": "competition-id", "name": "Bundesliga", "country": "Germany" },
    "kickoffAt": "2026-04-26T17:30:00.000Z",
    "status": "finished",
    "homeTeam": { "id": "home-team-id", "name": "Borussia Dortmund", "logoUrl": "https://example.test/dortmund.png" },
    "awayTeam": { "id": "away-team-id", "name": "Freiburg", "logoUrl": "https://example.test/freiburg.png" }
  },
  "predictionType": "match_result_1x2",
  "predictionValue": "1",
  "predictionFamily": "match_result",
  "recommendationTier": "primary",
  "displayLabel": "Tahminim",
  "confidenceScore": 65,
  "riskLevel": "medium",
  "consistencyStatus": "warning",
  "settlementStatus": "settled_success",
  "actualResult": "1-0",
  "settlementReason": "Home team won at full time.",
  "auditOnly": false,
  "memberVisible": false,
  "publicStatus": { "publicEligible": false, "publicPublished": false, "status": "settled_success" },
  "conflictCount": 2,
  "evaluatedAt": "2026-04-30T00:00:00.000Z",
  "createdAt": "2026-04-30T00:00:00.000Z"
}
```

## Prediction Settlement Detail

```http
GET /api/football/predictions/settlements/:settlementId
```

Returns one settlement with sanitized settlement metadata, prediction metadata, expectation snapshot, and conflicts.

### Responses

| Status | Meaning |
| --- | --- |
| `200` | Settlement found. |
| `400` | Invalid UUID. |
| `401` | Authentication required. |
| `404` | Settlement not found. |

The detail response includes `guardNotes` reminding clients that the result is internal, not public-published, not member-visible, and that `Uzak Dur` / blocked candidates are audit-only even if they settle successfully.

## Match Settlement Review

```http
GET /api/football/matches/:matchId/prediction-settlements
```

Returns settlement outputs for one football match grouped by recommendation tier.

### Response Shape

```json
{
  "match": {
    "matchId": "89759e35-758d-416e-b0d3-ad07436c8a9b",
    "competition": { "id": "competition-id", "name": "Bundesliga", "country": "Germany" },
    "kickoffAt": "2026-04-26T17:30:00.000Z",
    "status": "finished",
    "homeTeam": { "id": "home-team-id", "name": "Borussia Dortmund", "logoUrl": "https://example.test/dortmund.png" },
    "awayTeam": { "id": "away-team-id", "name": "Freiburg", "logoUrl": "https://example.test/freiburg.png" }
  },
  "outputsByRecommendationTier": {
    "primary": { "label": "Tahminim", "items": [] },
    "try": { "label": "Denenir", "items": [] },
    "alternative": { "label": "Alternatif", "items": [] },
    "avoid": { "label": "Uzak Dur", "items": [] }
  },
  "settlementSummary": {
    "success": 4,
    "failed": 1,
    "void": 0,
    "auditOnly": 1,
    "memberVisible": 0,
    "publicEligible": 0,
    "publicPublished": 0
  },
  "conflictsSummary": { "total": 11, "blocking": 1, "warning": 10, "info": 0 },
  "note": "Bu sonuç iç denetim amaçlıdır. Public başarılı tahmin olarak yayınlanmamıştır, üyelere görünür tahmin değildir ve tahmin kombini için kullanılmaz."
}
```

### Settlement Safety Notes

- Settlement review endpoints are authenticated and read-only.
- `settled_success` does not imply public eligibility or member visibility.
- `auditOnly=true`, `recommendationTier=avoid`, or `consistencyStatus=blocked` rows must not be treated as recommendations.
- No settlement mutation, public publishing, member-visible promotion, or tahmin kombini action exists in this API.

## Public Eligibility Evaluation

```http
GET /api/football/public-eligibility/evaluate
```

Runs the public eligibility evaluator in read-only mode over settled football prediction outputs.

### Query Parameters

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `matchId` | UUID | no | none | Filter by canonical match ID. |
| `predictionId` | UUID | no | none | Filter by prediction output ID. |
| `settlementStatus` | `settled_success` \| `settled_failed` \| `settled_void` | no | none | Filter by settlement result. |
| `consistencyStatus` | `unchecked` \| `passed` \| `warning` \| `blocked` | no | none | Filter by consistency status. |
| `recommendationTier` | `primary` \| `try` \| `alternative` \| `avoid` | no | none | Filter by candidate tier. |
| `limit` | integer | no | `20` | Page size. Minimum `1`, maximum `100`. |
| `offset` | integer | no | `0` | Zero-based offset. |

### Response Shape

```json
{
  "eligible": [],
  "excluded": [
    {
      "predictionOutputId": "db2b0842-117b-46b3-aa4f-c4ae68304e64",
      "matchId": "89759e35-758d-416e-b0d3-ad07436c8a9b",
      "predictionType": "match_result_1x2",
      "predictionValue": "1",
      "displayLabel": "Tahminim",
      "recommendationTier": "primary",
      "confidenceScore": 65,
      "settlementStatus": "settled_success",
      "eligible": false,
      "blockers": ["generated_after_kickoff"],
      "blockerMessages": ["Prediction was generated after match kickoff."],
      "warnings": ["Consistency warning requires internal review before public eligibility."]
    }
  ],
  "summary": {
    "eligibleCount": 0,
    "excludedCount": 5,
    "lateGeneratedCount": 5,
    "auditOnlyCount": 1,
    "failedCount": 1,
    "blockedCount": 1
  },
  "pagination": { "limit": 20, "offset": 0, "total": 5 },
  "publicSafetyNotes": [
    "Settled success otomatik public yayın anlamına gelmez.",
    "Maçtan sonra üretilen tahminler public kanıt olarak kullanılamaz."
  ]
}
```

## Match Public Eligibility Review

```http
GET /api/football/matches/:matchId/public-eligibility
```

Runs the same evaluator for one match and includes a match summary.

### Public Eligibility Safety Notes

- Authentication is required.
- The endpoints are read-only and do not write to `football_prediction_outputs`.
- The endpoints do not create `public_successful_predictions` rows.
- Eligible means internal candidate only; it does not mean public published.
- Late-generated test predictions are excluded because they cannot be used as public proof.
- No raw provider payloads, provider keys, database URLs, password hashes, JWTs, public publishing controls, or tahmin kombini output are returned.
