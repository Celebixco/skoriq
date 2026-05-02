# Public Successful Predictions Plan

## Purpose

SkorIQ may later expose a public proof/results area at `skoriq.com` for settled successful predictions only. This is a future product surface; it is not implemented yet.

Public visitors must not see active analytics, upcoming predictions, dashboard routes, detailed reasoning, provider internals, or any feature that generates prediction combinations. The public surface is only for limited proof after a match has finished and a prediction has been settled as successful.

Current implementation status: prediction output, conflict, and internal settlement persistence foundation exists, plus a draft candidate preview/persistence command. No member-visible prediction publishing, public showcase table, public page, public API, or tahmin kombini exists yet.

Detailed output and settlement workflow:

- [Football Prediction Output Workflow](./football-prediction-output-workflow.md)
- [Prediction Consistency Engine Plan](./prediction-consistency-engine.md)
- [Prediction Settlement Policy](./prediction-settlement-policy.md)
- [Public Prediction Eligibility Policy](./public-prediction-eligibility-policy.md)
- [Public Eligibility Review Workflow Plan](./public-eligibility-review-workflow.md)

Use SkorIQ product language:

- Tahmin
- Analiz
- Başarılı tahmin
- Güven skoru
- Maç analizi

Avoid public-facing terms that imply certainty or financial outcome.

## Public Concept

Public users can see only predictions that satisfy all of these conditions:

- The prediction was generated before the match.
- The prediction was visible to members before the match.
- The prediction passed consistency checks before member visibility.
- The match is finished and verified.
- Settlement is complete.
- The prediction settlement is `settled_success`.
- The item has been explicitly marked `public_eligible`.
- The item has been published to the public showcase.

`settled_success` alone is not enough. Public eligibility requires a separate internal review gate. `avoid`, `blocked`, and `audit_only` outputs must stay internal even if the actual match outcome makes them settle successfully.

Public users cannot see:

- Active/upcoming predictions.
- Member-only prediction candidates.
- Settled failed predictions as individual cards unless a future transparency report is explicitly approved.
- Full private reasoning.
- Raw feature IDs.
- Provider internals.
- Provider IDs by default.
- Raw provider payloads.
- Active confidence engine details.
- Prediction-combination generation.

## Public Card Content

A public successful-prediction card should show:

- Match.
- Competition.
- Prediction type.
- Prediction value, expressed in product-safe language.
- Güven skoru at time of prediction.
- Timestamp showing it was published before match start.
- Settled result.
- Success indicator.
- Short explanation.

A public card must not show:

- Raw feature IDs.
- Provider internals.
- Provider request data.
- Full private reasoning.
- Upcoming picks.
- Active confidence-engine internals.
- Sensitive admin notes.

## Prediction Output Lifecycle

Future prediction outputs should move through explicit states:

1. `feature_ready`: Required feature snapshots exist and pass readiness policy.
2. `draft`: Candidate exists but is not finalized or visible.
3. `generated`: A future model or deterministic engine creates an output.
4. `consistency_checked`: Candidate has been evaluated for same-match contradictions.
5. `member_visible`: The prediction is visible to authenticated members before kickoff.
6. `locked`: The match is too close to kickoff or has started, so the prediction should no longer be edited.
7. `settlement_pending`: Result comparison is queued or under review.
8. `settled_success`: The prediction was successful.
9. `settled_failed`: The prediction was not successful.
10. `settled_void`: The prediction is void because the match/result context invalidated it.
11. `public_eligible`: A successful settled prediction has passed public-display checks.
12. `public_published`: The prediction is visible on the public proof/results page.
13. `archived`: Output remains retained for audit but is hidden from active views.

Only `public_published` successful predictions may appear publicly.

## Future Data Model Plan

The first prediction output and conflict storage foundation is implemented. Settlement, public showcase, and performance aggregate tables remain planned only.

### `football_prediction_outputs` - implemented persistence foundation

Purpose: store every generated football prediction, not only successful ones.

Suggested fields:

- `id`
- `match_id`
- `prediction_type`
- `prediction_value`
- `confidence_score`
- `confidence_ceiling`
- `risk_level`
- `feature_snapshot_id`
- `reasoning_snapshot_id` nullable, if reasoning is persisted later
- `consistency_status`
- `expectation_snapshot`
- `conflict_count`
- `generated_at`
- `visible_to_members_at`
- `locked_at` nullable
- `status`
- `metadata`
- `created_at`
- `updated_at`

### `football_prediction_settlements` - implemented internal foundation

Purpose: store verified outcome comparison for every prediction output.

Suggested fields:

- `id`
- `prediction_output_id`
- `match_id`
- `actual_result`
- `settlement_status`
- `evaluated_at`
- `settlement_reason`
- `settlement_metadata`
- `created_at`
- `updated_at`

### `football_prediction_conflicts` - implemented persistence foundation

Purpose: store consistency conflicts detected before member visibility or public publication.

Suggested fields:

- `id`
- `prediction_output_id`
- `match_id`
- `conflict_type`
- `severity`
- `source_prediction_type`
- `conflicting_prediction_type`
- `reason`
- `created_at`

### `public_successful_predictions` - persistence foundation

Purpose: store curated public showcase entries for settled successful predictions.

Suggested fields:

- `id`
- `prediction_output_id`
- `public_title`
- `public_summary`
- `public_visible_at`
- `display_order`
- `is_featured`
- `status`
- `created_at`
- `updated_at`

`football_prediction_outputs` public visibility fields are available for future workflows and documented in [Public Prediction Eligibility Policy](./public-prediction-eligibility-policy.md), including `public_eligible_at`, `public_published_at`, `public_excluded_at`, and `public_exclusion_reason`. The dry-run eligibility evaluator does not populate this table and does not change prediction statuses.

Internal users can review evaluator output through authenticated read-only endpoints and dashboard pages:

- `GET /api/football/public-eligibility/evaluate`
- `GET /api/football/matches/<match-uuid>/public-eligibility`
- `/football/public-eligibility`
- `/football/matches/:matchId/public-eligibility`

These review surfaces do not create public cards and do not mark predictions public eligible or public published.

The future review workflow separates evaluator eligibility from publication:

1. Evaluator says `eligible=true`.
2. Admin review moves the candidate to review pending.
3. A public draft may be created.
4. Admin approval may publish the public card.
5. Published cards may later be hidden if data or copy issues appear.

No part of that mutation workflow is implemented yet.

### `prediction_performance_daily` - planned

Purpose: store aggregate transparency/performance metrics without exposing active private predictions.

Suggested fields:

- `id`
- `date`
- `sport`
- `prediction_type`
- `total_predictions`
- `success_count`
- `failed_count`
- `void_count`
- `success_rate`
- `created_at`
- `updated_at`

## Transparency Policy

SkorIQ must internally store all generated predictions, not only successful predictions. Public pages may initially show only successful settled predictions, but internal performance tracking must include successes, failures, and voids.

Product rules:

- Do not use certainty language.
- Güven skoru is not certainty.
- Predictions are data-driven and risk-aware.
- Public successful-prediction cards should be treated as proof/results, not active recommendations.
- Future public performance summaries should include total prediction count and success rate if product direction allows.
- Failed predictions should remain available internally for audit, calibration, and model-quality analysis.

## Future Public API Plan

Do not implement these endpoints yet.

```http
GET /api/public/football/successful-predictions
GET /api/public/football/successful-predictions/:id
```

Public endpoints should return only limited settled-success data and must not require auth. They must not expose active predictions, feature IDs, provider internals, raw payloads, or full private reasoning.

## Future UI Plan

Public route:

```text
/successful-predictions
```

Suggested public title:

```text
Başarılı Tahminler
```

The page should use a card/list layout with settled successful predictions only. It should clearly say that cards are historical results, not active or upcoming predictions.

## Dependencies

This plan depends on future implementation of:

- Prediction output generator.
- Settlement engine.
- Result verification.
- Performance tracking.
- Public-safe curation and publication workflow.

## Non-Goals

- No prediction model is implemented by this plan.
- No public page is implemented by this plan.
- No DB migration is implemented by this plan.
- No payment system is implemented by this plan.
- No provider call, ingestion, scheduler, or frontend implementation is included.
