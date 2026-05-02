# Public Prediction Eligibility Policy

## Purpose

This policy defines when a settled football Tahmin output may later become a public `Başarılı Tahminler` candidate.

Public visibility is a separate product step after internal settlement. A prediction settling successfully does not automatically make it public-eligible or public-published.

The future manual review workflow is documented in [Public Eligibility Review Workflow Plan](./public-eligibility-review-workflow.md).

Public visitors may later see only limited, settled successful predictions. They must not see active/upcoming predictions, full analytics, failed/void predictions as individual cards, private reasoning, provider internals, dashboard data, or tahmin kombini features.

The persistence foundation and dry-run evaluator are implemented. This does not publish anything: no status mutation, public page, public API, member publishing, or tahmin kombini implementation exists in this step.

## Eligibility Rules

A football prediction output can become `public_eligible` only if all of these conditions are true:

- `settlement_status = settled_success`.
- `football_prediction_outputs.status = settled_success`.
- `recommendation_tier` is `primary` or `try`.
- `consistency_status` is `passed` or `warning`.
- `audit_only = false`.
- The prediction was generated before match start.
- The prediction was not blocked.
- The prediction has no blocking conflicts.
- Required settlement metadata is present.
- A public summary can be generated safely.
- Internal review explicitly approves it later.

A football prediction output must not become `public_eligible` if any of these conditions are true:

- `settlement_status = settled_failed`.
- `settlement_status = settled_void`.
- `recommendation_tier = avoid`.
- `consistency_status = blocked`.
- `audit_only = true`.
- The prediction was generated after match start.
- Required metadata is missing.
- Metadata or summary content contains raw provider data.
- The output has an unresolved blocking conflict.
- A future admin manually excludes it.

## Blocked/Avoid But Settled Success

An output can settle successfully but still be a bad recommendation candidate.

Example:

- `first_half_over_0_5` was generated as `Uzak Dur`.
- It was blocked because first-half evidence was missing.
- The real match outcome later satisfied the rule.
- It settled as `settled_success`.
- It still must remain audit-only and must not become a public successful prediction.

Reason: public eligibility depends on recommendation validity at generation time, not only the later result. A correct outcome from an avoided or blocked candidate is useful for audit, but it was not a valid SkorIQ recommendation.

## Public Card Content

A future public card may show:

- Match.
- Sport and competition.
- Product-safe Tahmin label.
- Güven skoru at the time of prediction.
- Timestamp proving the prediction was generated before match start.
- Settled result.
- Success badge.
- Short public summary.

A future public card must not show:

- Raw provider payloads.
- Provider internals.
- Internal feature IDs.
- Internal database IDs.
- Full private reasoning.
- Upcoming predictions.
- Failed predictions as individual cards.
- Certainty or guarantee language.

## Transparency Policy

SkorIQ must internally store all prediction outcomes: success, failure, and void.

Public pages may initially show successful examples, but this must not become misleading. Future performance reporting should include aggregate totals, success rate, failed count, and void count if product direction allows.

Copy rules:

- Güven skoru is not certainty.
- Past success does not guarantee future results.
- Public cards are historical analysis results, not active recommendations.
- Avoid language that implies certainty, guaranteed outcome, or financial return.

Use:

- Tahmin
- Başarılı tahmin
- Analiz sonucu
- Güven skoru
- İç denetim
- Public görünürlük

Avoid:

- bahis
- banko
- garanti
- kazanç vaadi

## Persistence Foundation

`football_prediction_outputs` includes future public visibility timestamps:

- `public_eligible_at` nullable timestamp.
- `public_published_at` nullable timestamp.
- `public_excluded_at` nullable timestamp.
- `public_exclusion_reason` nullable text.

`public_successful_predictions` exists as an empty future-ready table:

- `id`.
- `prediction_output_id`.
- `public_title`.
- `public_summary`.
- `public_visible_at`.
- `display_order`.
- `is_featured`.
- `status`: `draft`, `published`, or `hidden`.
- `created_at`.
- `updated_at`.

The dry-run evaluator does not populate `public_successful_predictions`, does not set `public_eligible_at`, and does not change output status. It only reports which settled outputs would be candidates under this policy.

Manual dry-run:

```bash
npm run analytics:football:public-eligibility:evaluate -- --match-id=<match-uuid>
```

Use `--prediction-id=<prediction-output-uuid>` to inspect a single settled output. Add `--json` for machine-readable output. There is intentionally no `--execute` mode.

Authenticated internal review endpoints and dashboard pages now expose the same evaluator result in read-only form:

```http
GET /api/football/public-eligibility/evaluate
GET /api/football/matches/<match-uuid>/public-eligibility
```

Dashboard:

- `/football/public-eligibility`
- `/football/matches/:matchId/public-eligibility`

These surfaces group eligible and excluded outputs, show blocker codes such as `generated_after_kickoff`, and include safety copy that settled success is not automatic public publishing.

## Future API Plan

Public endpoints:

```http
GET /api/public/football/successful-predictions
GET /api/public/football/successful-predictions/:id
```

Admin/internal endpoints:

```http
GET /api/admin/football/public-eligibility-candidates
POST /api/admin/football/predictions/:id/mark-public-eligible
POST /api/admin/football/predictions/:id/publish-public
POST /api/admin/football/predictions/:id/hide-public
```

These endpoints are plans only and must not be exposed until schema, auth guards, audit logging, tests, and dashboard review flows exist.

## Future Dashboard/Admin Plan

Future internal pages:

- Public Eligibility Candidates.
- Public Successful Predictions.

The eligibility candidate page should show settled successful `primary` and `try` outputs and explain exclusions:

- `avoid`.
- `blocked`.
- `audit_only`.
- `settled_failed`.
- `settled_void`.
- generated after match start.
- missing metadata.
- unresolved blocking conflict.

## Dortmund vs Freiburg Classification

Current Dortmund vs Freiburg evaluator result:

- `eligible=0`.
- `excluded=5`.
- All outputs are excluded by `generated_after_kickoff`.
- `BTTS yes` is also `settled_failed`.
- `first_half_over_0_5` is also `avoid`, `blocked`, and `audit_only`.

No public review workflow should start for this match because public proof requires predictions generated before kickoff.

## Implementation Roadmap

Recommended next implementation order:

1. Implemented: internal public eligibility review API.
2. Implemented: dashboard public eligibility review page.
3. Planning: define explicit public eligibility candidate review workflow.
4. Add audit fields or action log for public review.
5. Add mark-public-eligible mutation guarded by evaluator.
6. Add public draft creation.
7. Add publish/hide mutations.
8. Add public successful predictions API and page.
9. Add aggregate performance summary later.
10. Add tahmin kombini later.

## Non-Goals

- No prediction publishing.
- No status mutation.
- No public row population in this step.
- No public page implementation.
- No tahmin kombini implementation.
- No provider calls, ingestion, or scheduler behavior.
