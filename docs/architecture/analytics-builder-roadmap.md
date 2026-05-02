# Analytics Builder Roadmap

## Purpose

This roadmap describes how analytics builders create football and basketball analysis features from normalized tables. It does not implement prediction models, provider adapters, frontend automation, public successful-prediction flows, or live-score behavior.

## Builder Architecture

Future builders should read canonical and sport-specific normalized facts, then write precomputed feature rows. They should not read raw provider payloads directly.

Current implementation status: `football_team_form_features`, `football_head_to_head_features`, `football_match_prediction_features`, and `basketball_team_form_features` schemas and builders are implemented. Basketball head-to-head, basketball match prediction features, analytics API endpoints, and prediction models remain future work.

Football team form builds now have a local/manual runner:

```bash
npm run analytics:football:team-form:build -- --team-id=<team-uuid>
```

Dry-run is the default. Execute mode requires `--execute`, passes the same local/Neon-test database readiness checks used by manual ingestion, and writes only `football_team_form_features` through the existing builder and repository. Competition-level builds require `--all-approved-football`. Reviewed APIFootball slices may not have stable season IDs, so nullable-season competition builds must explicitly add `--allow-null-season`; this uses `season_id is null` and does not create fake seasons. The runner does not fetch provider data, does not schedule future work, and does not create prediction outputs. Use `--report-json` for a sanitized manual audit report under ignored `.provider-runs/analytics/`.

Football head-to-head builds also have a local/manual runner:

```bash
npm run analytics:football:h2h:build -- --team-a-id=<team-uuid> --team-b-id=<team-uuid>
```

The H2H runner canonicalizes team pairs, supports match-based and guarded competition-level builds, defaults to dry-run, and requires `--execute` for writes. Nullable-season competition builds use the same explicit `--allow-null-season` convention as football team form.

Football match prediction feature snapshots have a local/manual runner:

```bash
npm run analytics:football:match-prediction-features:build -- --match-id=<match-uuid>
```

Dry-run is the default. Execute mode requires `--execute`, passes the same local/Neon-test database readiness checks, and writes only `football_match_prediction_features`. The runner combines existing team form and H2H feature rows into a precomputed match snapshot. It does not generate a predicted score, public pick, frontend response, provider fetch, or scheduled job.

Feature readiness is governed by [Prediction Readiness Policy](../analytics/prediction-readiness-policy.md). H2H is optional for MVP readiness when home and away team-form coverage is strong; missing H2H is recorded in metadata and should cap future public-use confidence rather than block feature readiness by itself. Future prediction systems must treat `insufficient_data` rows as ineligible and should use only `ready` rows by default.

Pre-match analysis timing is governed by [Pre-Match Analysis Window Policy](../product/pre-match-analysis-window-policy.md). Future automated feature/candidate generation should default to `now` through `now + 36 hours`, require kickoff to be outside the minimum lead-time cutoff, and mark older early-generated snapshots as stale rather than member-visible ready. Manual smoke tests may build features outside that future default only when explicitly approved and kept draft/internal.

Future Tahmin outputs, consistency validation, and settlement are planned separately in [Football Prediction Output Workflow](../product/football-prediction-output-workflow.md), [Prediction Consistency Engine Plan](../product/prediction-consistency-engine.md), and [Prediction Settlement Policy](../product/prediction-settlement-policy.md). Feature snapshots are not public predictions; a separate output, consistency, settlement, and publication workflow is required before any successful prediction can appear publicly.

The first persistence foundation for `football_prediction_outputs`, `football_prediction_conflicts`, and `football_prediction_settlements` is implemented. It stores draft outputs, computed conflict findings, and internal/manual settlement results. It does not publish public cards, make predictions member-visible, or create tahmin kombini output.

Public eligibility is policy-only for now and documented in [Public Prediction Eligibility Policy](../product/public-prediction-eligibility-policy.md). Future public candidates must be settled successful `primary` or `try` outputs with acceptable consistency status, no blocking conflicts, `audit_only=false`, generation before match start, safe metadata, and internal review approval. `Uzak Dur` / blocked outputs remain audit-only even when they settle successfully.

A deterministic dry-run football prediction candidate generator prototype is implemented for local/manual preview only. It reads ready feature snapshots and emits candidate ideas, but it does not make them member-visible. Adding `--check-consistency` runs the consistency engine in memory and marks preview candidates as `passed`, `warning`, or `blocked`. Adding `--persist-draft` stores checked candidates and conflicts as draft audit rows only; checked drafts are still not product predictions.

Future default candidate generation should only select matches inside the pre-match analysis window. Drafts generated outside the window should remain internal experiments and must not become member-visible or public-eligible by default.

Current runner status: `analytics:football:prediction-candidates:generate` reports `analysisWindowStatus` with `--window-hours` and `--minimum-lead-minutes` options. Adding `--enforce-window` blocks dry-run generation and `--persist-draft` unless the match is inside the window. Enforcement is opt-in for manual use; future scheduler work should enforce the policy by default.

Manual pre-match pipeline runner status: `pipeline:football:prematch` orchestrates the existing match-based team form builder, H2H feature builder, match prediction feature builder, reasoning builder, candidate generator, consistency check, and optional draft persistence for one match or one reviewed/enabled league scope. Dry-run is the default and writes no rows. Execute mode is manual only, requires a safe local/Neon-test DB target, selects only matches inside `now -> now + 36h` and outside the minimum lead-time cutoff, and persists drafts only through `--persist-draft --enforce-window` when the feature snapshot is `ready` and at least one non-blocked recommendation candidate exists. It does not call providers, run ingestion, publish, mark member-visible, settle, or create tahmin kombini output.

Stale draft rebuild policy is documented in [Stale Draft Rebuild Workflow](../product/stale-draft-rebuild-workflow.md). The metadata fields for stale/rebuild tracking now exist on `football_prediction_outputs`, and a manual one-match rebuild command exists. Future scheduler automation should reuse the same safety rules: refresh team form, H2H, match prediction features, reasoning, candidates, and consistency checks for matches entering the valid window, then persist draft-only outputs without settlement, member visibility, public publishing, or tahmin kombini side effects.

Football match reasoning has a read-only local/manual runner:

```bash
npm run analytics:football:reasoning:build -- --match-id=<match-uuid>
```

The runner reads an existing `football_match_prediction_features` row and returns deterministic explanation signals: why the row is usable or not, positive form signals, risk factors, missing data warnings, Tahmin eligibility, public-use ineligibility, and a Güven skoru ceiling. It does not write database rows, call providers, run ingestion, schedule work, or generate predictions. Future AI explanation layers may use this structured output as input.

A read-only match analytics viewer combines the same pieces into a human-readable report:

```bash
npm run analytics:football:match:view -- --match-id=<match-uuid>
```

The viewer shows match identity, competition, kickoff, home/away teams, feature status, coverage, reasoning signals, risk factors, missing data warnings, and summary. `--json` returns machine-readable output, and `--debug` includes source feature IDs. It remains read-only and does not rebuild features or run prediction logic.

Football prediction settlement also has a local/manual runner:

```bash
npm run analytics:football:predictions:settle -- --match-id=<match-uuid>
```

Dry-run is the default. Execute mode requires `--execute`, uses the shared DB readiness guard, reads only normalized `matches` and `football_match_scores`, writes `football_prediction_settlements`, and updates output status to `settled_success`, `settled_failed`, or `settled_void`. It does not call providers, run ingestion, publish, settle publicly, or make outputs member-visible.

Internal settlement review is implemented as authenticated, read-only API and dashboard surfaces:

```http
GET /api/football/predictions/settlements
GET /api/football/predictions/settlements/<settlement-uuid>
GET /api/football/matches/<match-uuid>/prediction-settlements
```

Dashboard routes `/football/predictions/settlements`, `/football/predictions/settlements/:settlementId`, and `/football/matches/:matchId/prediction-settlements` show settlement status, conflicts, audit-only flags, and member/public visibility summaries. They do not expose publish, member-visible, settlement mutation, public-publishing, or tahmin kombini controls.

Public eligibility persistence fields/table, a dry-run evaluator, and authenticated read-only public eligibility review API/dashboard are implemented. The evaluator reports candidate eligibility only; it does not mutate prediction status, create public rows, publish public cards, or make outputs member-visible. The future review workflow is documented in [Public Eligibility Review Workflow Plan](../product/public-eligibility-review-workflow.md). Next implementation steps: add audit fields or action log, add a mark-public-eligible mutation guarded by the evaluator, create public drafts, and only then build public successful prediction API/page. Tahmin kombini remains later.

Football goal-feature expansion is now underway. The first implemented slice extends `football_team_form_features` with fulltime over/under, scored/conceded, team-total, and first-half goal fields. The match prediction feature builder now aggregates those team-form fields into match-level expected-goal proxy signals, goal-profile classifications, first-half profile, BTTS profile, and team goal profiles. The first causal interpretation map is documented in [Football Goal Signal Interpretation](../analytics/football-goal-signal-interpretation.md), so future work should translate features into signals and risk-aware explanations rather than raw spreadsheet thresholds. Candidate generation, consistency rules, and H2H goal fields remain unchanged until separately approved. See [Football Goal Feature Expansion Plan](../analytics/football-goal-feature-expansion-plan.md).

The API exposes the same read-only report shape:

```http
GET /api/analytics/football/matches?featureStatus=ready
GET /api/analytics/football/matches/<match-uuid>
```

The list endpoint supports readiness/eligibility filters, competition/team UUID filters, pagination, and `debug=true`. `debug=true` includes source feature IDs and sanitized metadata references. The endpoints validate UUIDs and query values, the single-match endpoint returns `404` for missing matches or missing feature snapshots, and neither endpoint calls providers, writes rows, triggers ingestion, schedules jobs, or generates final Tahmin output.

See the lightweight API contract in [SkorIQ Football Analytics API](../api/football-analytics-api.md).

The dashboard foundation also includes read-only football catalog browsing:

- `GET /api/football/teams`
- `GET /api/football/teams/<team-uuid>`
- `GET /api/football/competitions`
- `GET /api/football/competitions/<competition-uuid>`

These endpoints power `/football/teams`, `/football/teams/<teamId>`, `/football/competitions`, and `/football/competitions/<competitionId>`. They expose canonical team logos from `teams.logo_url`, lightweight readiness summaries, recent matches, and standings where available. They remain read-only and do not introduce ingestion, scheduler, prediction, provider, public successful-prediction, or write paths.

```text
normalized scores/statistics/standings
-> affected team detection
-> team form feature rebuild
-> head-to-head feature rebuild
-> upcoming match prediction feature snapshot rebuild
```

Builders should be idempotent and versioned by feature definition. A future `feature_version` should allow recalculating historical snapshots without silently changing model inputs.

## Future Prediction Output And Settlement Roadmap

The analytics builder layer stops at feature snapshots and reasoning. Future prediction work should proceed in this order:

1. Implemented: prediction output schema foundation.
2. Implemented: consistency fields and conflict table foundation.
3. Implemented: deterministic prediction candidate generator prototype in dry-run mode.
4. Implemented: dry-run consistency engine foundation.
5. Implemented: manual draft persistence for consistency-checked candidates.
6. Implemented: settlement rule engine and manual settlement runner.
7. Implemented: admin settlement/audit views.
8. Implemented: public eligibility dry-run evaluator and internal review dashboard.
9. In progress: football goal-feature expansion for explainable goal Tahmin outputs; first team-form field slice and causal signal interpretation docs are implemented.
10. Add public successful predictions page.
11. Add member active predictions page.
12. Add tahmin kombini engine later.

Future output lifecycle:

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

Public users may see only limited `public_published` successful predictions. Active/upcoming predictions and full reasoning remain member-only.

Consistency gate: generated outputs must be checked against a canonical match expectation before they become member-visible. Blocking conflicts cannot be shown, settled for public use, or consumed by future tahmin kombini. Warning conflicts may be retained for internal alternative-scenario analysis but should be excluded from safe mode.

## Football Builder Flow

| Trigger | Builder Action | Target Table |
| --- | --- | --- |
| Finished match score finalized | Implemented builder supports rebuilding rolling form and scoring profile for home and away teams when called manually. | `football_team_form_features` |
| Football team statistics finalized | Implemented builder includes team performance statistics when available. | `football_team_form_features` |
| Football standings updated | Implemented builder includes standings context when available. | `football_team_form_features` |
| Finished match involving a pair | Implemented builder supports rebuilding pairwise matchup features for the two teams when called manually. | `football_head_to_head_features` |
| Team or h2h feature changes | Implemented builder supports rebuilding one match prediction feature snapshot when called manually. | `football_match_prediction_features` |
| Existing prediction feature snapshot needs explanation | Implemented read-only reasoning builder summarizes readiness, risks, missing data, and policy eligibility. | no table; console/report output |
| Operator needs one-match analytics inspection | Implemented read-only viewer joins match identity with prediction feature coverage and reasoning output. | no table; console/JSON output |
| API consumer needs one-match analytics inspection | Implemented read-only endpoint returns the same report shape as JSON. | no table; API JSON output |

## Basketball Builder Flow

| Trigger | Builder Action | Target Table |
| --- | --- | --- |
| Finished match score finalized | Implemented builder supports rebuilding rolling form and scoring profile for home and away teams when called manually. | `basketball_team_form_features` |
| Basketball period scores finalized | Implemented builder includes quarter/half scoring profile when available. | `basketball_team_form_features` |
| Basketball team statistics finalized | Implemented builder includes efficiency and box-score proxy inputs when available. | `basketball_team_form_features` |
| Basketball standings updated | Implemented builder includes standings context when available. | `basketball_team_form_features` |
| Finished match involving a pair | Rebuild pairwise matchup features for the two teams. | `basketball_head_to_head_features` |
| Team or h2h feature changes | Rebuild prediction feature snapshots for upcoming matches involving affected teams. | `basketball_match_prediction_features` |

## Update Frequency

- Run after finished match finalization.
- Run after standings updates.
- Run nightly to catch late corrections or backfilled data.
- Allow manual rebuilds for debugging and historical backfills.
- Current football team form and football H2H rebuilds are manual only; no scheduler or automatic ingestion trigger exists yet.
- Future pre-match automation should run periodically and process only near-term upcoming matches in the next 36 hours by default.
- Do not rebuild second-by-second.
- Do not add live-score queues, WebSockets, or live prediction updates.

## Missing Data And Confidence

- Store null when a feature cannot be calculated safely.
- Store sample size and source coverage for each feature group.
- Distinguish insufficient data from a real zero value.
- Add confidence/coverage fields to future feature tables.
- Use league-average fallback only after the platform has enough normalized league history and an approved fallback policy.
- Never fabricate missing provider fields.

## Recommended Implementation Order

1. Implemented: `football_team_form_features` schema and builder.
2. Implemented: `basketball_team_form_features` schema and builder.
3. Implemented: local/manual football team form analytics runner.
4. Implemented: `football_head_to_head_features` schema, builder, and local/manual runner.
5. Implemented: `football_match_prediction_features` schema, builder, and local/manual runner.
6. Implemented: read-only football match reasoning layer and manual runner.
7. Next: `basketball_head_to_head_features`.
8. Football goal-feature expansion: first team-form slice and match-level goal-profile snapshot fields implemented; next slices should add H2H goal fields, then update candidate generation and consistency rules to consume the profiles.
9. `basketball_match_prediction_features`.
10. Analytics read endpoints for feature inspection.
11. Implemented: admin/manual pre-match analysis window report plus opt-in `--enforce-window` guard.
12. Implemented: stale draft rebuild metadata fields.
13. Implemented: manual stale-draft rebuild workflow.
14. Next: dashboard stale indicators and rebuild-needed filters.
15. Prediction model work after feature coverage is proven.

## Acceptance Criteria For Future Builder Work

- Builder reads only normalized canonical and sport-specific tables.
- Builder never writes raw provider payloads or provider mappings.
- Builder is idempotent for the same feature version and source facts.
- Builder avoids target leakage by excluding the target match result/statistics from pre-match feature snapshots.
- Builder records coverage/confidence information.
- Builder status logic follows the documented prediction readiness policy.
- Builder has unit tests for null handling, sample-size behavior, home/away splits, and idempotency.

## Non-Goals

- No prediction model.
- No public successful-prediction module.
- No provider adapter.
- No paid analytics infrastructure.
- No frontend.
- No live-score recalculation.
