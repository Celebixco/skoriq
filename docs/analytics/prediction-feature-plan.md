# Prediction Feature Plan

## Purpose

Prediction consumers must not read raw provider responses directly. Raw provider payloads are retained for traceability and reprocessing, but prediction features should be built from normalized canonical and sport-specific tables.

This document describes the prediction feature layer. It does not implement APIs, machine learning models, provider adapters, ingestion jobs, frontend, public successful-prediction pages, paid analytics infrastructure, or live-score behavior.

Public/member access policy is separate from feature engineering. See:

- [Member Access Policy](../product/member-access-policy.md)
- [Public Successful Predictions Plan](../product/public-successful-predictions.md)
- [Football Prediction Output Workflow](../product/football-prediction-output-workflow.md)
- [Prediction Consistency Engine Plan](../product/prediction-consistency-engine.md)
- [Prediction Settlement Policy](../product/prediction-settlement-policy.md)
- [Football Goal Feature Expansion Plan](./football-goal-feature-expansion-plan.md)
- [Football Goal Signal Interpretation](./football-goal-signal-interpretation.md)

## Prediction Layer Overview

```text
provider payloads
-> raw_provider_payloads
-> normalizers
-> canonical + sport-specific facts
-> feature builders
-> precomputed feature tables
-> future analytics APIs / future prediction models
```

Current implemented normalized facts:

- Shared: `sports`, `countries`, `competitions`, `seasons`, `teams`, `players`, `matches`.
- Football: `football_match_scores`, `football_match_team_statistics`, `football_standings`.
- Basketball: `basketball_match_scores`, `basketball_period_scores`, `basketball_team_match_statistics`, `basketball_standings`.

Feature builders should create precomputed rows so future prediction consumers can read stable snapshots instead of recalculating from raw match history at request time.

## Proposed Future Feature Tables

### Football

| Table | Purpose | Key Columns | Source Tables | Windows | Update Trigger | Retention | Uniqueness | Example Fields |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `football_team_form_features` | Store team-level rolling football form and performance. | `team_id`, `competition_id`, `season_id`, `as_of_match_id`, `as_of_date`, `window_size`, `scope`, direct feature columns, `sample_size`, `coverage_score`, `metadata_json`, timestamps | `matches`, `football_match_scores`, `football_match_team_statistics`, `football_standings` | last 5, last 10, overall/home/away | manual builder call for now; future triggers after finalization/standings/nightly | Keep canonical historical snapshots; prune only if explicitly approved later. | `team_id + competition_id + season_id + as_of_match_id + window_size + scope` | Implemented: points, goals for/against, over/under rates, scored/conceded rates, first-half goal fields, team-total rates, stat averages, standings context |
| `football_head_to_head_features` | Store pairwise matchup history for two teams. | `team_a_id`, `team_b_id`, `competition_id`, `season_id`, `as_of_match_id`, `as_of_date`, `window_size`, direct feature columns, `sample_size`, `coverage_score`, timestamps | `matches`, `football_match_scores` | last 5, last 10 | manual builder call for now; future triggers after finalization/nightly | Keep canonical historical snapshots; prune only if explicitly approved later. | normalized team pair + `competition_id + season_id + as_of_match_id + window_size` | Implemented: h2h wins, goals average, BTTS, over rates, home split counts |
| `football_match_prediction_features` | Store pre-match feature snapshot for a football match. | `match_id`, `home_team_id`, `away_team_id`, `competition_id`, `season_id`, form/H2H feature references, direct proxy columns, coverage scores, `feature_status`, timestamps | `matches`, `football_team_form_features`, `football_head_to_head_features` | selected form/H2H windows, default 5/5 | manual builder call for now; future triggers after team-form/H2H rebuilds | Keep snapshots used by future models. | `match_id + form_window_size + h2h_window_size` | Implemented: home/away form references, H2H references, coverage, attack/defense proxies, standings diffs |

### Basketball

| Table | Purpose | Key Columns | Source Tables | Windows | Update Trigger | Retention | Uniqueness | Example Fields |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `basketball_team_form_features` | Store team-level rolling basketball form and efficiency. | `team_id`, `competition_id`, `season_id`, `as_of_match_id`, `as_of_date`, `window_size`, `scope`, direct feature columns, `sample_size`, `coverage_score`, `metadata_json`, timestamps | `matches`, `basketball_match_scores`, `basketball_period_scores`, `basketball_team_match_statistics`, `basketball_standings` | last 5, last 10, overall/home/away | manual builder call for now; future triggers after finalization/standings/nightly | Keep canonical historical snapshots; prune only if explicitly approved later. | `team_id + competition_id + season_id + as_of_match_id + window_size + scope` | Implemented: wins, points for/against, total/period scoring, stat averages, standings context |
| `basketball_head_to_head_features` | Store pairwise basketball matchup history. | `team_a_id`, `team_b_id`, `competition_id`, `as_of_match_id`, `window_size`, `features_json`, `coverage_json`, `created_at`, `updated_at` | `matches`, `basketball_match_scores`, `basketball_period_scores`, `basketball_team_match_statistics` | last 3, last 5, all available recent | finished match involving pair, nightly rebuild | Keep historical snapshots for model training. | normalized team pair + `competition_id + as_of_match_id + window_size` | h2h wins, average total points, margin, close game rate |
| `basketball_match_prediction_features` | Store pre-match feature snapshot for an upcoming basketball match. | `match_id`, `home_team_id`, `away_team_id`, `competition_id`, `season_id`, `feature_version`, `features_json`, `coverage_json`, `created_at`, `updated_at` | team form + h2h feature tables, `matches`, `basketball_standings` | latest available before tipoff | upcoming match creation/update, affected team feature rebuild, nightly rebuild | Keep snapshots used by future models. | `match_id + feature_version` | offensive/defensive strength, expected points proxy, expected total proxy |

## Builder Flow

### Football

1. A finished match score, team statistics row, or standings row is normalized.
2. Builder identifies affected teams from the canonical match and standings context.
3. Implemented builder can rebuild `football_team_form_features` for affected teams and configured windows.
4. Implemented builder can rebuild `football_head_to_head_features` for the affected pair when called manually.
5. Implemented builder can rebuild `football_match_prediction_features` for one target match when called manually.

Football team form rebuilds are currently manual only through:

```bash
npm run analytics:football:team-form:build -- --team-id=<team-uuid>
```

The command defaults to dry-run, uses the shared database readiness guard, allows local or explicitly approved Neon test branches only, and requires `--execute` before upserting feature rows. It reads normalized football tables only, never calls provider APIs, and can write a sanitized JSON audit report with `--report-json`.

Football H2H rebuilds are also manual only through:

```bash
npm run analytics:football:h2h:build -- --team-a-id=<team-uuid> --team-b-id=<team-uuid>
```

The command canonicalizes pair order, defaults to dry-run, uses the same database readiness guard, and requires `--execute` before upserting `football_head_to_head_features`. It can also build one match pair with `--match-id` or reviewed nullable-season APIFootball competition slices with `--competition-id --all-approved-football --allow-null-season`.

Provider H2H onboarding is separate from the normalized H2H feature builder. During league expansion, H2H provider data should be fetched only for upcoming or otherwise analyzable matches after countries/leagues, teams, and events are mapped. It should not attempt every possible team pair. H2H fetches must be dry-run first, execute only when clean, and capture provider match IDs, match dates, home/away teams, fulltime scores, halftime scores when available, canonical team references, canonical match references when possible, and unresolved row counts. No fake IDs should be created.

APIFootball H2H execute is implemented as a guarded one-match ingestion path. Clean rows are normalized into canonical `matches` and `football_match_scores`, not directly into prediction outputs. After execute, the existing `analytics:football:h2h:build -- --match-id=<match-uuid>` command can consume those canonical rows and rebuild `football_head_to_head_features`. This separation keeps provider ingestion, feature building, candidate generation, and consistency checks independent.

Football match prediction feature snapshots are manual only through:

```bash
npm run analytics:football:match-prediction-features:build -- --match-id=<match-uuid>
```

The command defaults to dry-run and requires `--execute` before upserting `football_match_prediction_features`. It combines existing home/away team form rows and H2H rows, computes a weighted combined coverage score, and sets `feature_status` to `ready`, `partial`, or `insufficient_data`. This is not a prediction model and does not generate scores, public picks, or public successful-prediction flows.

Goal-focused feature expansion is the preferred football MVP direction before exact score work. The first team-form slice stores `over_0_5_rate`, `under_2_5_rate`, `scored_rate`, `conceded_rate`, `team_over_0_5_rate`, `team_over_1_5_rate`, `first_half_over_0_5_rate`, `first_half_avg_goals_for`, and `first_half_avg_goals_against`. The match snapshot builder now aggregates those fields into proxy signals: `expected_total_goals_proxy`, home/away expected goal proxies, home/away goal signal scores, `first_half_goal_signal_score`, `btts_signal_score`, `goal_profile`, `first_half_goal_profile`, `btts_profile`, and home/away team goal profiles. These are causal feature summaries, not probabilities. Candidate generation and consistency logic intentionally still do not consume these fields until a separate approved update.

These fields must be consumed through causal signal interpretation, not raw thresholds alone. The mapping is:

```text
feature -> signal -> causal interpretation -> supported predictions -> risk conditions
```

See [Football Goal Signal Interpretation](./football-goal-signal-interpretation.md) before updating candidate generation, reasoning, or consistency behavior.

Readiness is defined in [Prediction Readiness Policy](./prediction-readiness-policy.md). MVP `ready` rows require home and away form samples of at least 3 and combined coverage of at least 50. H2H is optional when form coverage is strong: if H2H has samples, coverage uses 40% home form, 40% away form, and 20% H2H; if H2H is missing or zero-sample, coverage uses 50% home form and 50% away form and records `metadata.h2hMissing=true`. `insufficient_data` rows must be excluded from future prediction and public-use candidate generation.

H2H remains a supporting causal signal. It may support or weaken goal-profile, BTTS, and over/under reasoning when the sample is recent and meaningful, but it must not override current form, home/away performance, goal-profile evidence, player/referee/injury/lineup context when implemented, or consistency checks. Missing H2H should cap confidence and add a risk warning rather than automatically block MVP readiness when form coverage is strong. Old or low-sample H2H should be downweighted. H2H that contradicts current form should produce risk context, not an automatic decision.

### Süper Lig MVP Readiness

Süper Lig is analysis-only until the feature base improves. Current normalized test-branch evidence is strong enough for catalog, standings, score, halftime, team-form, and match-feature exploration, but not enough for prediction candidate generation:

- Teams: 18/18; logos: 16/18.
- Standings: 18/18.
- Finished matches: 38; upcoming matches: 9.
- Score rows: 38; halftime scores: 38/38.
- Upcoming match readiness: all `partial`.
- H2H: 0 for all upcoming matches.
- Best target: Samsunspor vs Galatasaray, still `partial` with combined coverage 40.

Do not force deterministic candidate generation for Süper Lig, do not persist draft outputs, and do not include Süper Lig in tahmin kombini while upcoming rows remain `partial`. Süper Lig can be used for analysis dashboards and feature-quality validation only until scoped home/away samples and/or H2H coverage improve.

Football match reasoning is manual and read-only through:

```bash
npm run analytics:football:reasoning:build -- --match-id=<match-uuid>
```

It converts an existing `football_match_prediction_features` row into deterministic explanation signals: positive signals, negative signals, risk factors, missing data warnings, prediction eligibility, public-use ineligibility, and a confidence ceiling. It does not write database rows, call providers, generate predictions, or create public successful-prediction flows. Future AI explanations can consume this structured reasoning output, but the reasoning layer itself remains deterministic.

Football match analytics reports are available through a read-only viewer:

```bash
npm run analytics:football:match:view -- --match-id=<match-uuid>
```

The viewer combines match identity, competition, kickoff, teams, prediction feature coverage, and reasoning output into one human-readable report. Use `--json` for machine-readable output and `--debug` to include source feature IDs. It does not write rows, rebuild stored features, call providers, generate predictions, or create public successful-prediction flows.

The same report shape is exposed through the read-only API endpoint:

```http
GET /api/analytics/football/matches?featureStatus=ready
GET /api/analytics/football/matches/<match-uuid>
GET /api/analytics/football/matches/<match-uuid>?debug=true
```

The list API supports filters for `featureStatus`, `predictionEligible`, `kuponEligible`, `competitionId`, `teamId`, `limit`, `offset`, and `debug`. The API returns match identity, `featureStatus`, `predictionEligible`, `kuponEligible`, `confidenceCeiling`, coverage groups, positive signals, risk factors, missing data warnings, summary, and list pagination where applicable. `debug=true` includes source feature IDs and sanitized metadata references. It does not expose raw provider payloads, provider API keys, database credentials, final score predictions, or public successful-prediction output.

### Basketball

1. A finished match score, period score, team statistics row, or standings row is normalized.
2. Builder identifies affected teams from the canonical match and standings context.
3. Implemented builder can rebuild `basketball_team_form_features` for affected teams and configured windows when called manually.
4. Builder rebuilds `basketball_head_to_head_features` for the affected pair.
5. Builder rebuilds `basketball_match_prediction_features` for upcoming matches involving either affected team.

## Update Frequency

- Rebuild after finished match finalization.
- Rebuild after standings updates.
- Run a nightly rebuild to catch late provider corrections.
- Support manual rebuilds for debugging and backfills.
- Do not run second-by-second live recalculation.
- Do not introduce live-score queues or WebSockets for feature updates.

## Missing Data Policy

- Minimum required data depends on each feature; if required source fields are missing, set the feature to `null`.
- Track `sample_size`, `window_size`, and coverage metrics alongside feature values.
- Mark insufficient sample size separately from true zero values.
- Use league-average fallback only after enough normalized league history exists and the fallback policy is documented.
- Do not fabricate missing scores, statistics, standings, or inferred provider fields.
- Include a feature confidence or coverage score in future feature tables so downstream consumers can decide whether to trust a feature snapshot.
- Future prediction consumers should treat only `ready` match prediction feature snapshots as eligible for automated prediction by default.

## Future Prediction Output And Public Showcase Boundary

Feature snapshots are not prediction outputs. A future prediction output generator must create a separate persisted output before any member-facing or public-facing prediction can exist.

Future output stages should be explicit:

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

Anonymous visitors may later see only `public_published` predictions that were settled successfully. They must not see active/upcoming predictions, member-only prediction candidates, full reasoning, feature IDs, or provider internals.

Members may later see upcoming prediction outputs and detailed reasoning after a prediction model and member prediction pages are explicitly implemented. Admins may later review all generated predictions and settlements for audit.

Future data model candidates, not implemented yet:

- Implemented persistence foundation: `football_prediction_outputs`
- Implemented persistence foundation: `football_prediction_conflicts`
- `football_prediction_settlements`
- `public_successful_predictions`
- `prediction_performance_daily`

SkorIQ must internally retain all generated predictions, including failed and void outcomes. Public successful-prediction cards may highlight settled successful predictions, but internal performance tracking must include total count and success rate if public transparency reporting is approved later.

Future football prediction outputs should include prediction type, prediction value, confidence score, confidence ceiling, risk level, feature snapshot reference, optional reasoning snapshot reference, consistency status, expectation snapshot, conflict counts, generation/member-visible/locked timestamps, status, and metadata. Settlement requires final normalized match results and deterministic rules per prediction type.

Consistency validation runs after candidate generation and before any future member visibility. The first implementation is dry-run and in-memory only. It blocks contradictory same-match outputs, such as a `0-0` draw expectation paired with goal-required predictions. Only consistency-passed outputs can become member-visible by default, public-eligible after settlement, or future tahmin kombini candidates.

Goal candidates must become evidence-gated before product use. Over/under, BTTS, first-half, and team-total candidates should require the feature groups documented in [Football Goal Feature Expansion Plan](./football-goal-feature-expansion-plan.md). First-half outputs must not be generated from fulltime goal evidence alone, and low-goal profiles must prevent high-confidence goal-required recommendations.

Implemented dry-run prototype:

```bash
npm run analytics:football:prediction-candidates:generate -- --match-id=<match-uuid>
npm run analytics:football:prediction-candidates:generate -- --match-id=<match-uuid> --check-consistency
npm run analytics:football:prediction-candidates:generate -- --match-id=<match-uuid> --persist-draft
```

This command reads a ready football match prediction feature snapshot and produces local candidate ideas with `Tahminim`, `Denenir`, `Alternatif`, and `Uzak Dur` labels. With `--check-consistency`, it validates logical coherence in memory and returns `passed`, `warning`, or `blocked` statuses plus conflict counts. With `--persist-draft`, it stores checked candidates as draft-only audit rows and replaces conflict rows idempotently. It does not publish predictions, settle outcomes, mark member visibility, or create tahmin kombini entries.

H2H rows used by these snapshots can come from the guarded one-match APIFootball H2H ingest path. Strict H2H execute remains the default, but reviewed/enabled leagues may opt into `--allow-partial --minimum-clean-rows=3` when skipped rows are only non-critical competition-scope rows such as `missing_competition_mapping` or `unsupported_competition_scope`. Partial H2H execute is a data-quality compromise only: it normalizes clean rows, reports skipped rows, and must not create fake IDs or let H2H override current form, home/away performance, goal profiles, consistency checks, or the pre-match analysis-window policy.

For reviewed/enabled leagues, the upcoming H2H batch runner can prepare multiple upcoming matches before feature refresh:

```bash
npm run provider:apifootball:h2h:backfill-upcoming -- --country-id=<id> --league-id=<id> --allow-partial
```

This runner only fills canonical H2H match/score inputs for individually safe upcoming matches. It does not rebuild H2H features by itself; after execute, run the H2H feature builder and match prediction feature snapshot for the reported `nextRecommendedFeatureRefreshTargets`.

## Model Boundary

- This is feature engineering planning only.
- No machine learning model exists yet.
- No automated predictions exist yet.
- No public successful-prediction or line movement module exists yet.
- Future models may consume these feature tables after enough historical coverage and feature quality checks exist.

## Implementation Order Recommendation

1. Implemented: `football_team_form_features` schema and builder.
2. Implemented: `basketball_team_form_features` schema and builder.
3. Implemented: local/manual football team form analytics runner for controlled dry-run and execute builds.
4. Implemented: `football_head_to_head_features` schema, builder, and local/manual runner.
5. Implemented: `football_match_prediction_features` schema, builder, and local/manual runner.
6. Implemented: read-only `FootballMatchReasoningBuilder` and manual reasoning runner.
7. Next: implement basketball head-to-head feature tables and builders.
8. Implemented: prediction output schema foundation.
9. Implemented: consistency fields and conflict table foundation.
10. Implemented: deterministic prediction candidate generator prototype.
11. Implemented: dry-run consistency engine foundation.
12. Implemented: manual draft persistence for consistency-checked candidates.
13. Implemented: settlement rule engine.
14. Implemented: admin settlement/audit views.
15. Implemented: public eligibility dry-run evaluator and internal review pages.
16. In progress: football goal-feature expansion. First team-form slice is implemented; H2H goal fields, match-level goal profiles, candidate-generator usage, and consistency-engine updates remain future work.
17. Add public successful predictions page.
18. Add member active predictions page.
19. Add tahmin kombini engine later.

## What Not To Build Yet

- No provider adapter.
- No prediction model.
- No public successful-prediction implementation.
- No persisted/member-visible prediction generation.
- No tahmin kombini implementation.
- No frontend implementation from this plan.
- No live-score recalculation.
- No paid analytics infrastructure.
- No schema, migrations, builders, or APIs from this planning document alone.
