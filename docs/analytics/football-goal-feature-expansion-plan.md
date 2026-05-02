# Football Goal Feature Expansion Plan

## Purpose

SkorIQ should prioritize goal-related football Tahmin outputs for the MVP because they are more explainable, easier to audit, and more realistic than exact score prediction. Exact score remains a future, low-confidence research area and must not become the primary product surface until the platform has much stronger historical coverage and calibration evidence.

The first implementation slice extends `football_team_form_features` and the football team form builder with nullable goal-profile fields for fulltime over/under, scored/conceded, team-total, and first-half evidence. This plan still does not implement prediction models, candidate generator changes, consistency engine changes, provider calls, ingestion, scheduler behavior, frontend work, public publishing, or tahmin kombini.

The causal interpretation layer for these fields is defined in [Football Goal Signal Interpretation](./football-goal-signal-interpretation.md). Future prediction and reasoning work must use that feature-to-signal mapping instead of treating the fields as raw spreadsheet values.

## Goal Prediction Philosophy

Goal predictions must be derived from observable normalized facts: team form, scoring and conceding behavior, home/away splits, first-half behavior, BTTS behavior, over/under rates, H2H goal context when available, and later match statistics such as shots or xG when provider coverage is proven.

Core principles:

- Goal-related Tahmin outputs are prioritized over exact score for MVP.
- Exact score is a future low-confidence output and should be treated as an internal consistency anchor before it is treated as user-facing prediction.
- Every goal feature must map to signal meaning, causal interpretation, supported prediction types, risk conditions, and contradiction conditions.
- No goal prediction should be generated without minimum evidence for the specific market family.
- Missing H2H should reduce confidence, not automatically block goal predictions when team-form evidence is strong.
- First-half predictions require first-half evidence; fulltime goal tendency alone is not enough.
- The candidate generator must produce fewer, clearer candidates instead of many weak alternatives.
- The consistency engine must block contradictions before any member-visible, public, or tahmin-kombini use.

Focus prediction types:

- `over_0_5_goals`
- `over_1_5_goals`
- `over_2_5_goals`
- `under_2_5_goals`
- `under_3_5_goals`
- `first_half_over_0_5`
- `both_teams_to_score_yes`
- `both_teams_to_score_no`
- `home_team_over_0_5`
- `away_team_over_0_5`
- `home_team_over_1_5`
- `away_team_over_1_5`
- `low_goal_profile`
- `high_goal_profile`

## Required Feature Groups

### A. Fulltime Goal Profile

Purpose: explain whether the full match tends toward low, medium, or high total goals.

Future fields:

- `avg_total_goals`
- `avg_goals_for`
- `avg_goals_against`
- `total_goals_stddev`
- `over_0_5_rate`
- `over_1_5_rate`
- `over_2_5_rate`
- `over_3_5_rate`
- `under_2_5_rate`
- `clean_sheet_rate`
- `failed_to_score_rate`
- `both_teams_to_score_rate`

### B. Home/Away Goal Profile

Purpose: preserve venue-sensitive scoring behavior instead of flattening home and away form.

Future fields:

- `home_avg_goals_for`
- `home_avg_goals_against`
- `away_avg_goals_for`
- `away_avg_goals_against`
- `home_over_1_5_rate`
- `away_over_1_5_rate`
- `home_clean_sheet_rate`
- `away_failed_to_score_rate`

### C. First-Half Goal Profile

Purpose: make first-half predictions evidence-gated and avoid recommending early-goal outputs from fulltime data alone.

Future fields:

- `first_half_avg_total_goals`
- `first_half_over_0_5_rate`
- `first_half_home_goal_rate`
- `first_half_away_goal_rate`
- `first_half_goals_for_avg`
- `first_half_goals_against_avg`
- `first_half_0_0_rate`
- `early_goal_tendency`

`early_goal_tendency` should remain future-only until minute-level or reliable first-half trend data is available.

### D. BTTS Profile

Purpose: explain whether both sides have enough scoring and conceding evidence for `KG Var` / `KG Yok`.

Future fields:

- `btts_rate`
- `home_scored_rate`
- `away_scored_rate`
- `home_conceded_rate`
- `away_conceded_rate`
- `clean_sheet_rate`
- `failed_to_score_rate`

### E. Team Total Goal Profile

Purpose: support team-specific goal predictions by joining one team scoring consistency with the opponent concession profile.

Future fields:

- `home_team_over_0_5_rate`
- `away_team_over_0_5_rate`
- `home_team_over_1_5_rate`
- `away_team_over_1_5_rate`
- `team_scoring_consistency`
- `opponent_concession_consistency`

### F. H2H Goal Profile

Purpose: enrich confidence when matchup history exists without making H2H mandatory for MVP readiness.

Future fields:

- `h2h_avg_total_goals`
- `h2h_over_1_5_rate`
- `h2h_over_2_5_rate`
- `h2h_btts_rate`
- `h2h_low_goal_rate`
- `h2h_sample_size`
- `h2h_missing`

## Existing Table Gap Analysis

### `football_team_form_features`

Already implemented:

- `avg_goals_for`
- `avg_goals_against`
- `clean_sheet_rate`
- `failed_to_score_rate`
- `both_teams_to_score_rate`
- `over_0_5_rate`
- `over_1_5_rate`
- `over_2_5_rate`
- `over_3_5_rate`
- `under_2_5_rate`
- `scored_rate`
- `conceded_rate`
- `team_over_0_5_rate`
- `team_over_1_5_rate`
- `first_half_over_0_5_rate`
- `first_half_avg_goals_for`
- `first_half_avg_goals_against`
- home/away/overall scopes through `scope`
- `sample_size`
- `coverage_score`

Important gaps:

- No explicit `under_3_5_rate`.
- No first-half `0-0` rate or early-goal tendency classification.
- No opponent failed-to-score or concession consistency fields.
- No total-goals volatility or standard deviation field.
- No explicit goal profile classification.

### `football_head_to_head_features`

Already implemented:

- `avg_total_goals`
- team goal averages
- `both_teams_to_score_rate`
- `over_1_5_rate`
- `over_2_5_rate`
- `over_3_5_rate`
- `sample_size`
- `coverage_score`

Important gaps:

- No `h2h_over_0_5_rate`.
- No `h2h_under_2_5_rate`.
- No explicit low-goal or high-goal rate.
- No first-half H2H goal fields.
- No H2H confidence modifier beyond sample/coverage metadata.

### `football_match_prediction_features`

Already implemented:

- home/away form feature references
- H2H feature reference
- source coverage scores
- weighted combined coverage score
- recent points
- home/away goal averages
- attack and defense strength proxies
- H2H average total goals, BTTS rate, and over `2.5` rate
- expected home/away/total goals proxy fields
- home/away team goal signal scores
- first-half goal signal score
- BTTS signal score
- goal profile classifications for total goals, first-half goals, BTTS, and each team
- standings diffs
- readiness status and metadata including `h2hMissing`, `goalProfileInputs`, and `goalProfileFormulaVersion`

Important gaps:

- No explicit under-rate or low-goal proxy.
- No goal volatility field.
- Match-level profiles are not consumed by the candidate generator or consistency engine yet.

## Proposed Schema Extension Plan

The first approved slice is implemented for `football_team_form_features`. Remaining items are future additions only.

### `football_team_form_features`

Implemented first-slice additions:

- `over_0_5_rate`
- `under_2_5_rate`
- `first_half_over_0_5_rate`
- `first_half_avg_goals_for`
- `first_half_avg_goals_against`
- `scored_rate`
- `conceded_rate`
- `team_over_0_5_rate`
- `team_over_1_5_rate`

Future candidate additions:

- `opponent_failed_to_score_rate`
- `goal_volatility_score`

First-slice calculation behavior:

- Fulltime goal fields use the same final fulltime/current-score fallback as existing form fields.
- `over_0_5_rate`, `under_2_5_rate`, `scored_rate`, `conceded_rate`, `team_over_0_5_rate`, and `team_over_1_5_rate` use the included form matches as denominator.
- `team_over_0_5_rate` currently mirrors `scored_rate`; it is stored separately so future candidate generation can speak in team-total semantics.
- First-half fields use only included matches with normalized halftime scores as denominator.
- If no valid halftime denominator exists, first-half fields remain `null` instead of `0`.
- `sample_size` and `coverage_score` remain aligned with existing team form behavior.

### `football_head_to_head_features`

Candidate additions:

- `h2h_over_0_5_rate`
- `h2h_under_2_5_rate`
- `h2h_low_goal_rate`
- `h2h_high_goal_rate`

### `football_match_prediction_features`

Implemented match-level goal-profile additions:

- `expected_total_goals_proxy`
- `expected_home_goals_proxy`
- `expected_away_goals_proxy`
- `home_goal_signal_score`
- `away_goal_signal_score`
- `first_half_goal_signal_score`
- `btts_signal_score`
- `goal_profile`: `low_goal | medium_goal | high_goal | unknown`
- `first_half_goal_profile`: `likely_goal | low_goal | unknown`
- `btts_profile`: `yes_lean | no_lean | balanced | unknown`
- `home_team_goal_profile`: `weak | moderate | strong | unknown`
- `away_team_goal_profile`: `weak | moderate | strong | unknown`

Match-level calculation behavior:

- `home_goal_signal_score` combines home team-goal rates with away concession rate.
- `away_goal_signal_score` combines away team-goal rates with home concession rate.
- Expected goal proxies are rough `0..3` causal summaries, not xG and not probability.
- `expected_total_goals_proxy` is the sum of the home and away proxies when both can be calculated.
- `first_half_goal_signal_score` requires both teams to have first-half rate evidence; missing first-half data returns `null`.
- `btts_signal_score` requires both scoring and conceding evidence from both teams.
- Profiles become `unknown` when source evidence is missing instead of fabricating values.
- Metadata records `goalProfileInputs` and `goalProfileFormulaVersion` for auditability.

## Evidence Requirements

MVP thresholds:

- Over/under candidates require both home and away form samples of at least `3`.
- `first_half_over_0_5` requires first-half samples of at least `3` for both teams or a documented strong competition-level first-half signal.
- BTTS candidates require scoring evidence and conceding evidence for both teams.
- Team-total candidates require the team scoring sample and the opponent concession sample.
- H2H can adjust confidence but should not be required.
- Any candidate with missing required evidence should be skipped or marked `Uzak Dur`, not promoted as `Tahminim`.

Recommended production thresholds later:

- Prefer form samples of at least `5` for primary goal candidates.
- Prefer first-half samples of at least `5` before first-half primary candidates.
- Require stable coverage and calibration by competition before public or tahmin-kombini use.
- Track model/candidate hit rate by prediction type before increasing confidence ceilings.

## Candidate Generator Impact

The deterministic dry-run candidate generator now consumes match-level goal profiles from `football_match_prediction_features`. This is still not a final prediction model: it uses proxy signals to decide which candidate ideas are worth previewing, which are only alternatives, and which should be avoided.

Examples:

- `over_1_5` requires `goal_profile=medium_goal` and `expected_total_goals_proxy >= 1.8`.
- `over_2_5` requires `goal_profile=high_goal` and `expected_total_goals_proxy >= 2.8`.
- `under_2_5` requires low goal profile plus clean-sheet or failed-to-score support.
- `first_half_over_0_5` requires `first_half_goal_profile=likely_goal` and first-half signal score of at least `65`.
- `BTTS yes` requires `btts_profile=yes_lean` and a BTTS signal score of at least `65`; `balanced` BTTS can only remain an `Alternatif`.
- `BTTS no` requires clean-sheet or failed-to-score signals.
- Team-total overs require the team's scoring profile and the opponent concession profile to agree; they remain future-facing until settlement and review support is extended.

Candidate tiering should stay conservative:

- `Tahminim`: one primary candidate only, strong evidence, no blocking conflict.
- `Denenir`: useful but lower-confidence candidate with coherent evidence.
- `Alternatif`: plausible alternative scenario, not safe-mode tahmin-kombini material.
- `Uzak Dur`: intentionally rejected or insufficiently supported candidate retained for audit/explanation.

Bundle size is intentionally capped: at most one `Tahminim`, two `Denenir`, one `Alternatif`, and one `Uzak Dur`. This prevents goal-heavy matches from producing noisy, overlapping candidate lists.

## Consistency Engine Impact

Goal prediction expansion now tightens the consistency gate through match-level profile fields.

Implemented/preserved consistency rules:

- `expected_scoreline=0-0` blocks goal-required predictions such as `over_0_5`, `over_1_5`, `over_2_5`, `BTTS yes`, and `first_half_over_0_5`.
- `low_goal` profile blocks high-confidence `over_2_5` unless the candidate is explicitly marked as a low-confidence alternative.
- `BTTS yes` conflicts with one-sided scoreline expectation and any same-bundle `under_1_5`.
- First-half predictions require first-half evidence and should warn or block when only fulltime goal evidence exists.
- Team-total predictions must align with expected team goals.
- The candidate generator should provide a canonical expectation snapshot before consistency checks run.

The expectation snapshot should include:

- `expected_home_goals_proxy`
- `expected_away_goals_proxy`
- `expected_total_goals_proxy`
- `goal_profile`
- `first_half_goal_profile`
- `btts_profile`
- `result_profile`

## Reasoning Layer Impact

The reasoning layer should explain not just what is recommended, but what was not recommended and why.

Example Turkish reasoning copy:

- "Ev sahibi düzenli gol üretiyor, deplasman takımı dış sahada gol yeme eğiliminde."
- "İlk yarı gol verisi yetersiz olduğu için İY 0.5 Üst önerilmedi."
- "H2H eksik olduğu için güven tavanı sınırlı."
- "Gol profili düşük olduğu için 2.5 Üst yerine 2.5 Alt daha tutarlı."

Reasoning metadata should identify:

- missing first-half evidence
- missing H2H context
- low sample size
- profile conflict warnings
- confidence ceiling reason

## UI Impact

Dashboard and future member UI should show goal predictions with clear product language:

- `Tahminim`
- `Denenir`
- `Alternatif`
- `Uzak Dur`
- `MS 1.5 Üst`
- `MS 2.5 Alt`
- `İY 0.5 Üst`
- `KG Var`
- `KG Yok`

UI rules:

- Show confidence score and risk level together.
- Do not imply certainty.
- Do not show too many candidates on one match.
- Keep `Uzak Dur` candidates collapsed or separated as audit/explanation.
- Avoid public-facing terms like "bahis", "banko", "garanti", or "kazanç vaadi".
- Clearly state that goal predictions are data-supported analysis outputs, not guaranteed outcomes.

## Implementation Roadmap

Recommended order:

1. Extend `football_team_form_features` with first-half and goal profile fields.
2. Update the team form builder calculations and tests.
3. Extend `football_head_to_head_features` with additional goal fields.
4. Update the match prediction feature builder with goal-profile proxies.
5. Update the candidate generator to use goal profiles and evidence gates.
6. Update consistency engine rules with goal-profile checks.
7. Update reasoning output for goal-profile evidence and missing data.
8. Update dashboard display for goal-profile signals and candidate explanations.

## Non-Goals

- No exact score model now.
- No betting or odds.
- No tahmin kombini engine.
- No live-score behavior.
- No public publishing.
- No provider fetching or ingestion changes.
- No schema, migrations, builders, or runtime behavior from this planning document alone.
