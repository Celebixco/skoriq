# Football Prediction Output Workflow

## Purpose

This document defines how SkorIQ represents football Tahmin outputs after the analytics feature layer is ready. The implemented foundation covers draft output persistence, consistency conflicts, and internal/manual settlement. It still does not implement a prediction model, public page, member-visible publishing, provider calls, ingestion, scheduler, or tahmin kombini feature.

Consistency validation is planned separately in [Prediction Consistency Engine Plan](./prediction-consistency-engine.md). Prediction outputs must pass consistency checks before member visibility, public eligibility, or future tahmin kombini use.

Football MVP prediction work should prioritize goal-related outputs over exact score outputs. The planned feature expansion for over/under, BTTS, first-half, team-total, and goal-profile evidence is documented in [Football Goal Feature Expansion Plan](../analytics/football-goal-feature-expansion-plan.md).

Current implementation status: persistence foundation exists for `football_prediction_outputs`, `football_prediction_conflicts`, and `football_prediction_settlements`. A deterministic candidate generator can persist checked candidates as `draft` only, and a manual settlement runner can evaluate existing outputs against normalized football scores. No output is member-visible, public, or tahmin-kombini eligible by default.

Pre-match generation timing is defined in [Pre-Match Analysis Window Policy](./pre-match-analysis-window-policy.md). Future automated candidate generation should default to matches in the next 36 hours and should not make outputs member-visible if they were generated too early, too late, or from stale snapshots.

Stale draft refresh rules are defined in [Stale Draft Rebuild Workflow](./stale-draft-rebuild-workflow.md). Stale drafts should remain audit-only until the match is rebuilt inside the valid window; they must not be used for member visibility, public proof, or future tahmin kombini.

## Prediction Output Definition

A football prediction output is a persisted future decision/result produced from existing feature snapshots and reasoning. It is separate from:

- Feature readiness: `football_match_prediction_features` says whether a match has enough data to analyze.
- Reasoning: deterministic explanation of readiness, risk factors, and missing data.
- Final prediction model: future logic that chooses a Tahmin output.
- Public result card: future public proof/results item shown only after successful settlement.

A prediction output should capture the exact state at generation time so it can be audited later.

Suggested fields:

- `match_id`
- `sport`
- `prediction_type`
- `prediction_value`
- `confidence_score`
- `confidence_ceiling`
- `risk_level`
- `feature_snapshot_id`
- `reasoning_summary`
- `generated_at`
- `visible_to_members_at`
- `consistency_status`
- `consistency_summary`
- `expectation_snapshot`
- `status`
- `metadata`

Future prediction types may include:

- `match_result_1x2`
- `double_chance`
- `over_under_goals`
- `both_teams_to_score`
- `first_half_over_0_5`
- `team_total_goals`
- `score_range`

These prediction types are examples only and are not implemented yet.

Goal-output MVP focus:

- `over_0_5_goals`, `over_1_5_goals`, `over_2_5_goals`
- `under_2_5_goals`, `under_3_5_goals`
- `first_half_over_0_5`
- `both_teams_to_score_yes`, `both_teams_to_score_no`
- `home_team_over_0_5`, `away_team_over_0_5`
- `home_team_over_1_5`, `away_team_over_1_5`
- `low_goal_profile`, `high_goal_profile`

Exact score outputs should remain future/low-confidence and may first be used as internal consistency anchors rather than public-facing predictions.

## Dry-Run Candidate Prototype

A local/manual candidate preview command exists:

```bash
npm run analytics:football:prediction-candidates:generate -- --match-id=<match-uuid>
npm run analytics:football:prediction-candidates:generate -- --match-id=<match-uuid> --check-consistency
npm run analytics:football:prediction-candidates:generate -- --match-id=<match-uuid> --persist-draft
```

Without `--persist-draft`, it reads an existing `ready` `football_match_prediction_features` row and emits dry-run candidate ideas only. The generator consumes match-level goal-profile proxy fields such as `goal_profile`, `expected_total_goals_proxy`, `first_half_goal_profile`, `btts_profile`, and team goal profiles. It does not write `football_prediction_outputs`, does not mark anything `member_visible`, does not publish, and does not settle.

Future default selection should require the match to be inside the pre-match analysis window: kickoff later than the minimum lead time and no more than 36 hours away. Fixture records may exist earlier for schedule visibility, but candidate generation should not treat far-future fixtures as ready for member-facing analysis.

Reporting phase: the manual candidate runner accepts `--window-hours` and `--minimum-lead-minutes` and emits an `analysisWindow` report. `--persist-draft` may store that report in audit metadata.

Opt-in enforcement phase: adding `--enforce-window` blocks candidate generation and draft persistence unless `analysisWindowStatus=within_window`. This is not the default yet; future scheduler work should enable it by default.

Stale rebuild phase: when existing drafts are stale, the future manual workflow should rebuild team form, H2H, match prediction features, reasoning, and candidate consistency before running `--persist-draft --enforce-window`. The MVP handling policy is upsert-by-dedupe for matching candidate type/value and no destructive delete or archive until explicit stale/rebuild fields exist.

Controlled pre-match pipeline phase: `npm run pipeline:football:prematch` is the manual orchestration wrapper for the same sequence. It may target one match or one reviewed/enabled APIFootball league scope. Dry-run lists eligible matches and does not persist drafts. Execute mode rebuilds match-scoped features, runs reasoning, runs candidate generation with consistency, then calls the candidate generator with `--persist-draft --enforce-window` only when the match is currently inside the analysis window, the feature status is `ready`, and the recommendation groups contain at least one non-blocked candidate. It does not publish, mark member-visible, settle, call providers, run ingestion, or create tahmin kombini output.

Goal candidate policy:

- Prefer fewer, clearer candidates over broad lists.
- Cap preview output at one `Tahminim`, up to two `Denenir`, one `Alternatif`, and one `Uzak Dur`.
- After consistency checking, any `blocked` candidate must be reclassified as `avoid` / `Uzak Dur`; blocked rows must never remain in `Tahminim`, `Denenir`, or `Alternatif`.
- BTTS requires direct `yes_lean` evidence before it can become `Denenir`.
- First-half outputs require direct first-half profile support; fulltime goal profile alone is not enough.
- Goal-profile fields are proxy signals, not probabilities.
- The consistency engine now re-checks those profile fields and can warn/block low-vs-high goal contradictions, weak first-half support, weak BTTS support, and unsafe team-total evidence.

`--persist-draft` is the only write-capable mode for this command. It is local/manual, requires the same safe database readiness checks, automatically runs consistency validation, and upserts candidates as `football_prediction_outputs.status=draft`. It also replaces the stored conflict rows for each output so repeated runs remain idempotent by dedupe key.

Draft storage policy:

- `passed` and `warning` candidates are stored as draft audit candidates only.
- `blocked` / `Uzak Dur` candidates are also stored as draft audit rows so the system can explain what it deliberately avoided.
- Blocked and avoid candidates must never become member-visible recommendations.
- Member-safe preview endpoints hide blocked, avoid, audit-only, generated-after-kickoff, and blocking-conflict rows even when they exist internally for admin review.
- Draft rows are not settled, public, published, or tahmin-kombini eligible.
- The command does not call providers and does not generate final predictions.

Draft review API:

```http
GET /api/football/predictions/drafts
GET /api/football/predictions/drafts/:predictionId
GET /api/football/matches/:matchId/prediction-drafts
```

These endpoints are authenticated and read-only. They expose draft outputs and conflicts for internal review/audit only. They do not mark predictions member-visible, settle, publish, or create tahmin kombini output.

Settlement review API:

```http
GET /api/football/predictions/settlements
GET /api/football/predictions/settlements/:settlementId
GET /api/football/matches/:matchId/prediction-settlements
```

These endpoints are authenticated and read-only. They expose already-created settlement rows, related prediction output fields, conflicts, audit-only flags, and member/public visibility summaries. They do not create settlements, change statuses, publish public cards, make predictions member-visible, or create tahmin kombini output.

The dashboard exposes the same review data at:

- `/football/predictions/drafts`
- `/football/predictions/drafts/:predictionId`
- `/football/matches/:matchId/prediction-drafts`
- `/football/predictions/settlements`
- `/football/predictions/settlements/:settlementId`
- `/football/matches/:matchId/prediction-settlements`

These routes are also read-only and intentionally include guard copy that draft candidates are not member-visible, not settled, not public, and not tahmin-kombini eligible. Settlement review routes add guard copy that settled results are internal audit data, not public successful predictions, and not member-visible by default.

## Internal Manual Settlement

A local/manual settlement command exists:

```bash
npm run analytics:football:predictions:settle -- --match-id=<match-uuid>
npm run analytics:football:predictions:settle -- --prediction-id=<prediction-output-uuid>
```

Dry-run is the default and evaluates existing prediction outputs without writing rows or changing statuses. Execute mode requires `--execute`, uses the shared database readiness guard, allows only local or explicitly approved Neon test branches, and writes only:

- `football_prediction_settlements`
- the related `football_prediction_outputs.status` as `settled_success`, `settled_failed`, or `settled_void`

Settlement reads normalized `matches` and `football_match_scores` only. It does not read raw provider payloads, call providers, run ingestion, publish public cards, make outputs member-visible, or create tahmin kombini output. Blocked / `Uzak Dur` draft outputs may be settled internally for audit, but remain ineligible for public or member recommendation flows.

Recommendation tiers:

- `primary`: displayed as `Tahminim`.
- `try`: displayed as `Denenir`.
- `alternative`: displayed as `Alternatif`.
- `avoid`: displayed as `Uzak Dur`.

Rules:

- At most one primary candidate.
- Confidence is capped by the reasoning confidence ceiling.
- H2H missing adds warning/risk context.
- First-half candidates require specific evidence; otherwise they are skipped or marked avoid.
- Goal candidates require explicit goal-profile evidence from the expanded feature set; fulltime scoring alone must not justify first-half outputs.
- All candidates remain `consistency_status=unchecked` by default.
- `--check-consistency` marks the preview candidates as `passed`, `warning`, or `blocked` in memory only.
- Blocking conflicts prevent future recommendation use; warning conflicts remain analysis-only until future policy allows otherwise.
- `--persist-draft` stores the checked candidate fields, recommendation tier, display label, reasoning summary, expectation snapshot, consistency summary, and conflict counts as draft-only audit data.

## Status Lifecycle

Future football prediction outputs should use explicit lifecycle states:

| Status | Meaning |
| --- | --- |
| `draft` | Candidate exists but is not finalized or visible. |
| `generated` | A prediction output was generated from a feature snapshot. |
| `member_visible` | The output is visible to authenticated members before kickoff. |
| `locked` | The match is too close to kickoff or has started; output should no longer be edited. |
| `settlement_pending` | Match is final or believed final, and settlement evaluation is pending. |
| `settled_success` | Prediction evaluated successfully. |
| `settled_failed` | Prediction evaluated unsuccessfully. |
| `settled_void` | Prediction cannot be fairly evaluated. |
| `public_eligible` | A successful settled prediction passed public-display checks. |
| `public_published` | A successful settled prediction is visible publicly. |
| `archived` | Output is retained for audit but hidden from active operational views. |

Primary transition path:

```text
feature_ready
-> draft
-> generated
-> consistency_checked
-> member_visible
-> locked
-> settlement_pending
-> settled_success | settled_failed | settled_void
-> public_eligible
-> public_published
-> archived
```

Rules:

- Only `ready` feature snapshots should be eligible for automated prediction generation by default.
- Future automation should also require `analysis_window_status=within_window` before member visibility.
- Stale drafts should be rebuilt inside a valid window before future member-visible/public workflows.
- Stale drafts should not feed public eligibility, member-visible predictions, or tahmin kombini.
- `partial` snapshots may be used for internal analysis experiments only if explicitly allowed later.
- `insufficient_data` snapshots must not produce member-visible predictions.
- Candidate outputs must pass consistency validation before `member_visible`.
- Public publication requires successful settlement and explicit public eligibility.

## Risk And Confidence

Future outputs should include both `confidence_score` and `risk_level`.

- `confidence_score`: model or deterministic score for the specific Tahmin output.
- `confidence_ceiling`: maximum confidence allowed by feature/reasoning quality.
- `risk_level`: product-friendly risk bucket, for example `low`, `medium`, `high`.

Policy copy:

- "Güven skoru kesinlik anlamına gelmez."
- "Tahminler veri destekli analiz çıktısıdır."
- "Geçmiş başarı gelecekteki sonuçları garanti etmez."

## Future Data Model Plan

The first persistence foundation includes `football_prediction_outputs`, `football_prediction_conflicts`, and `football_prediction_settlements`. Public showcase and performance aggregate tables remain planned only.

### `football_prediction_outputs` - implemented persistence foundation

Purpose: store every generated football Tahmin output, including later failures and voids.

Suggested fields:

- `id`
- `match_id`
- `prediction_type`
- `prediction_value`
- `confidence_score`
- `confidence_ceiling`
- `risk_level`
- `feature_snapshot_id`
- `reasoning_snapshot_id` nullable
- `status`
- `consistency_status`: `unchecked | passed | warning | blocked`
- `consistency_checked_at`
- `consistency_summary`
- `expectation_snapshot` jsonb
- `conflict_count`
- `blocking_conflict_count`
- `warning_conflict_count`
- `generated_at`
- `visible_to_members_at`
- `locked_at` nullable
- `stale_at` nullable
- `rebuild_required` boolean, default false
- `generation_window_status` nullable
- `generated_lead_time_minutes` nullable
- `rebuild_reason` nullable
- `last_rebuilt_at` nullable
- `metadata`
- `created_at`
- `updated_at`

Stale/rebuild metadata is storage only. It lets future manual rebuild and scheduler workflows identify stale drafts, but it does not archive rows, change prediction status, publish, mark member-visible, settle, or create public cards.

The manual stale rebuild command updates these metadata fields for target-match draft outputs returned by candidate persistence. It does not delete stale rows, archive rows, settle outputs, mark `member_visible`, or create public rows.

### `football_prediction_conflicts` - implemented persistence foundation

Purpose: store consistency conflicts detected before member visibility or public/tahmin kombini use.

Suggested fields:

- `id`
- `prediction_output_id`
- `match_id`
- `conflict_type`
- `severity`
- `source_prediction_type`
- `conflicting_prediction_type`
- `reason`
- `metadata`
- `created_at`

### `football_prediction_settlements` - implemented settlement foundation

Purpose: store settlement evaluation for every output.

Suggested fields:

- `id`
- `prediction_output_id`
- `match_id`
- `settlement_status`
- `actual_result`
- `evaluated_at`
- `settlement_reason`
- `settlement_metadata`
- `created_at`
- `updated_at`

### `public_successful_predictions` - planned

Purpose: curate settled successful outputs for public proof/results display.

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

### `prediction_performance_daily` - planned

Purpose: track aggregate performance across successes, failures, and voids.

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

## Member And Public Visibility

Active/upcoming predictions are members-only. Full reasoning is members-only. Public users may see only limited, settled, successful predictions after settlement and publication.

Visibility rules:

- `draft`: admin/internal only.
- `generated`: admin/internal only.
- `member_visible`: members and admins only; requires `consistency_status=passed` by default.
- `locked`: members and admins only.
- `settlement_pending`: admins only by default.
- `settled_success`: members/admins; public only after public publication.
- `settled_failed`: stored internally; no individual public card by default.
- `settled_void`: stored internally; no individual public card by default.
- `public_eligible`: admins can review/publish.
- `public_published`: anonymous visitors can see limited public card.

## Tahmin Kombini Future Dependency

The future tahmin kombini feature can only use member-visible prediction outputs. It must:

- Exclude `insufficient_data`.
- Exclude blocking consistency conflicts.
- Exclude warning consistency conflicts from safe mode.
- Prefer `ready` feature lineage.
- Use `confidence_score`, `confidence_ceiling`, `risk_level`, and later settlement history.
- Control same-match correlated predictions.
- Apply stricter thresholds for safe mode.
- Remain unavailable to anonymous visitors.

No tahmin kombini engine is implemented now.

## Admin Workflow

Future admin capabilities should include:

- View all generated predictions.
- Inspect linked feature snapshot.
- Inspect reasoning summary.
- Inspect consistency status and conflict details.
- Inspect settlement status.
- Trigger or review settlement.
- Mark successful predictions as public-eligible.
- Publish a successful prediction publicly.
- Hide or archive a public card if needed.
- Review aggregate performance.

Admin publication should never bypass settlement. Admin actions should be audited when implemented.

## Future API Plan

Do not implement these endpoints yet.

Member:

```http
GET /api/member/football/matches/:matchId/prediction-preview
GET /api/member/football/predictions
GET /api/member/football/predictions/:id
```

Implemented member-safe preview:

- `GET /api/member/football/matches/:matchId/prediction-preview`
- Authenticated members and admins can read it.
- Anonymous requests return `401`.
- It returns only sanitized `primary`, `try`, and `alternative` groups.
- It excludes `avoid`, `blocked`, `audit_only`, generated-after-kickoff, and blocking-conflict candidates.
- It never exposes admin draft internals, conflicts, raw metadata, expectation snapshots, provider IDs, settlement internals, public publishing fields, or tahmin kombini output.
- If matching candidates are stale or outside the analysis window, it returns `status=stale` with empty groups and the message `Bu maç için tahminler güncel analiz penceresinde yenilenmelidir.`

Public:

```http
GET /api/public/football/successful-predictions
GET /api/public/football/successful-predictions/:id
```

Admin:

```http
GET /api/admin/football/predictions
POST /api/admin/football/predictions/:id/settle
POST /api/admin/football/predictions/:id/publish
```

Public eligibility policy is documented separately in [Public Prediction Eligibility Policy](./public-prediction-eligibility-policy.md). The future review workflow is documented in [Public Eligibility Review Workflow Plan](./public-eligibility-review-workflow.md). A `settled_success` result is only the first prerequisite; future public publication also requires recommendation-tier, consistency, audit-only, timing, metadata, and internal-review checks.

## Implementation Roadmap

Recommended future order:

1. Implemented: prediction output schema foundation.
2. Implemented: consistency fields and conflict table foundation.
3. Implemented: deterministic prediction candidate generator prototype in dry-run mode.
4. Implemented: dry-run consistency engine foundation.
5. Implemented: manual draft persistence for consistency-checked candidates.
6. Implemented: settlement rule engine.
7. Implemented: internal settlement/audit review API and dashboard views.
8. Implemented: public eligibility schema fields/table foundation.
9. Implemented: public eligibility dry-run evaluator.
10. Implemented: internal public eligibility review API and dashboard page.
11. Implemented: stale/rebuild metadata fields for future draft refresh workflows.
12. Planning: public eligibility candidate review workflow.
13. Implemented: manual stale-draft rebuild command.
14. Add audit fields or action log for public review.
15. Add mark-public-eligible mutation guarded by evaluator.
16. Add public draft creation.
17. Add publish/hide mutations.
18. Add public successful predictions API and page.
19. Add member active predictions page.
20. Add tahmin kombini engine later.

## Non-Goals

- No prediction model implementation.
- No schema or migration from this document.
- No member-visible prediction publication.
- No settlement code.
- No public page.
- No tahmin kombini implementation.
- No provider call, ingestion, scheduler, or auth behavior change.
