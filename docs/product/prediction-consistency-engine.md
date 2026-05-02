# Prediction Consistency Engine Plan

## Purpose

SkorIQ must behave like a reasoning system, not a set of isolated prediction outputs. The future consistency engine prevents contradictory football Tahmin outputs from becoming member-visible, public-visible, or eligible for tahmin kombini generation.

This document describes the consistency policy and the first dry-run implementation. No model, settlement engine, public page, provider call, ingestion, scheduler, auth change, or tahmin kombini engine is implemented here.

Current implementation status: storage fields for consistency results and the `football_prediction_conflicts` table exist as persistence foundation. A deterministic in-memory consistency engine also exists for dry-run candidate bundles.

The dry-run football prediction candidate generator emits candidates with `consistency_status=unchecked` by default. Passing `--check-consistency` validates the bundle in memory and returns `passed`, `warning`, or `blocked` statuses. If a candidate becomes `blocked`, the consistency layer must also move it to `recommendation_tier=avoid` with display label `Uzak Dur`; blocked candidates must never remain under `primary`, `try`, or `alternative`. These candidates are still preview-only and must not become member-visible until future persistence/publication workflows are explicitly implemented.

Goal-related consistency is a priority for the football MVP. The feature expansion needed to support stronger over/under, BTTS, first-half, and team-total checks is documented in [Football Goal Feature Expansion Plan](../analytics/football-goal-feature-expansion-plan.md). The causal meaning of the first goal-feature slice is documented in [Football Goal Signal Interpretation](../analytics/football-goal-signal-interpretation.md).

## Execution Point

The consistency engine:

- Runs after candidate predictions are generated.
- Runs before `member_visible`.
- Runs before settlement/public visibility.
- Runs before future tahmin kombini generation.
- Blocks or warns on contradictory outputs.
- Does not generate predictions itself.

Only consistency-passed predictions can move to member-visible state by default. Public successful predictions must also have passed consistency checks before they can become public-eligible.

Dry-run command:

```bash
npm run analytics:football:prediction-candidates:generate -- --match-id=<match-uuid> --check-consistency
npm run analytics:football:prediction-candidates:generate -- --match-id=<match-uuid> --persist-draft
```

`--check-consistency` does not write `football_prediction_outputs` or `football_prediction_conflicts`. `--persist-draft` is the explicit manual exception: it stores checked candidates as `status=draft`, persists the consistency summary, expectation snapshot, conflict counts, and replaces per-output conflict rows. It does not call providers, does not create member-visible Tahmin output, and does not publish, settle, or create tahmin kombini output.

## Prediction Families

Future prediction outputs should be grouped into families:

- `match_result`
- `scoreline`
- `total_goals`
- `first_half_goals`
- `both_teams_to_score`
- `team_total_goals`
- `double_chance`
- `score_range`

The engine validates candidates across families for the same match.

## Canonical Match Expectation

Every prediction bundle should include a canonical match expectation object:

```json
{
  "expected_home_goals": 0,
  "expected_away_goals": 0,
  "expected_total_goals": 0,
  "expected_scoreline": "0-0",
  "expected_first_half_goals": null,
  "btts_expected": false,
  "goal_profile": "low_goal",
  "result_profile": "draw_lean"
}
```

Fields:

- `expected_home_goals`
- `expected_away_goals`
- `expected_total_goals`
- `expected_scoreline`
- `expected_first_half_goals` nullable
- `btts_expected` boolean or nullable
- `goal_profile`: `low_goal | medium_goal | high_goal`
- `result_profile`: `home_lean | away_lean | draw_lean | balanced`

This object does not need to be a final score prediction for users. It is an internal coherence anchor for validating candidate outputs.

## Conflict Severity

| Severity | Meaning | Default Handling |
| --- | --- | --- |
| `blocking` | Logical contradiction. Output cannot be shown, settled as normal, public-published, or used in tahmin kombini. | Remove or block. |
| `warning` | Plausible only as an alternative scenario or low-confidence edge case. | May be shown internally, excluded from safe tahmin kombini. |
| `info` | Non-blocking note. | Keep for audit and explanation. |

## Hard Conflict Rules

Hard conflicts block the output.

Examples:

- `expected_scoreline=0-0` conflicts with:
  - `over_0_5_goals`
  - `over_1_5_goals`
  - `over_2_5_goals`
  - `btts_yes`
  - `first_half_over_0_5`
  - any statement that requires a goal
- `expected_scoreline=1-0` conflicts with:
  - `btts_yes`
  - `over_2_5_goals`
  - away team total over `0.5`
- `expected_scoreline=2-1` conflicts with:
  - `under_1_5_goals`
  - `btts_no`
  - away team total under `0.5`
- `expected_scoreline=0-2` conflicts with:
  - home team total over `0.5`
  - `btts_yes`
  - home win
- `draw_0_0` conflicts with all goal-required predictions.
- `btts_yes` conflicts with `under_1_5_goals`.
- `double_chance_1X` conflicts with high-confidence away win.
- `double_chance_X2` conflicts with high-confidence home win.
- `low_goal` profile conflicts with high-confidence `over_2_5_goals` unless it is explicitly marked as a low-confidence alternative scenario.
- `first_half_over_0_5` must block or warn when the candidate lacks first-half evidence, even if fulltime goal profile is medium or high.
- Team total over outputs must align with the expected team goal proxy for that side.

## Soft Conflict And Warning Rules

Warning conflicts may remain as internal alternatives but should not be safe-mode tahmin kombini candidates.

Examples:

- Match result draw plus `over_2_5_goals` is valid only if the expectation supports `2-2` or another high-scoring draw.
- Team total over while expected team goals are low should warn or block depending on threshold and confidence.
- `first_half_over_0_5` requires first-half goal tendency evidence, not only fulltime goal expectation.
- `score_range` with a narrow low-goal band should warn against high-total alternatives.
- Balanced result profile with very high-confidence 1X2 output should warn unless supported by strong model evidence.
- Goal-profile uncertainty should warn against promoting too many correlated goal candidates in one match bundle.

## Bundle Validation Process

Future validation should run at bundle level:

1. Candidate predictions are generated.
2. Canonical match expectation is computed.
3. Consistency engine checks every candidate against the expectation.
4. Engine checks candidates against each other.
5. Blocking contradictions are removed or blocked.
6. Warning conflicts are flagged and excluded from safe tahmin kombini.
7. Final member-visible prediction set is created from consistency-passed outputs.
8. Only consistency-passed and `settled_success` outputs can become `public_eligible`.

The candidate generator and consistency engine now consume the persisted match snapshot fields `expected_home_goals_proxy`, `expected_away_goals_proxy`, `expected_total_goals_proxy`, `home_goal_signal_score`, `away_goal_signal_score`, `first_half_goal_signal_score`, `btts_signal_score`, `goal_profile`, `first_half_goal_profile`, `btts_profile`, and home/away team goal profiles. The generator uses them to keep candidate output compact; the consistency engine uses them to warn or block contradictions before any draft persistence or future member visibility.

Timing coherence is handled by [Pre-Match Analysis Window Policy](./pre-match-analysis-window-policy.md), not by scoreline conflict rules. Future consistency or publication gates should still receive window metadata so outputs generated too early, too late, or from stale snapshots cannot become member-visible, public-eligible, or tahmin-kombini candidates by accident.

Profile-aware consistency rules:

- `goal_profile=high_goal` supports `over_2_5` and warns against `under_2_5`.
- `goal_profile=low_goal` blocks or warns against `over_2_5`, especially when expected total goals are below `1.5`.
- `goal_profile=medium_goal` supports `over_1_5` but warns against weak `over_2_5`.
- `first_half_goal_profile=likely_goal` supports `first_half_over_0_5`; `unknown` or `low_goal` blocks recommendation candidates.
- `btts_profile=balanced` warns `BTTS yes`; `no_lean` blocks or strong-warns it.
- Very low expected team-goal proxy warns or blocks BTTS/team-total over candidates.

Consistency checks should treat goal features as causal signals:

- High `under_2_5_rate` means low-goal pressure and should warn or block high-confidence `over_2_5` unless another strong high-goal signal explains the contradiction.
- High `scored_rate` supports team-goal candidates only when opponent concession evidence also supports the mechanism.
- Missing or low `first_half_over_0_5_rate` should block or warn against high-confidence `first_half_over_0_5`.
- High `conceded_rate` supports opponent scoring paths, but not if opponent scoring evidence is weak.
- Team-total outputs must align with both team scoring signals and opponent conceded signals.

## Tahmin Kombini Rule

The future tahmin kombini engine can consume only consistency-passed predictions.

Rules:

- No prediction with a blocking conflict can enter a combination.
- Warning-conflict predictions are excluded from safe mode.
- Same-match correlated predictions must be controlled.
- Multiple outputs from the same match should not be naively combined as independent confidence.
- Safe mode should prefer different matches or explicitly modeled correlation groups.

## Future Schema Additions

Extend future `football_prediction_outputs` with:

- `consistency_status`: `unchecked | passed | warning | blocked`
- `consistency_checked_at`
- `consistency_summary`
- `expectation_snapshot` jsonb
- `conflict_count`
- `blocking_conflict_count`
- `warning_conflict_count`

Add future table `football_prediction_conflicts`:

- `id`
- `prediction_output_id`
- `match_id`
- `conflict_type`
- `severity`
- `source_prediction_type`
- `conflicting_prediction_type`
- `reason`
- `created_at`

These fields/tables now exist as storage foundation only. They can persist already-computed consistency results and conflicts in a future workflow; the current dry-run engine evaluates rules in memory only.

Manual draft persistence now uses these fields for audit-only storage. The persistence command must keep all rows in `draft`; `visible_to_members_at` remains null. Blocked/avoid candidates may be stored only so admins can audit why a candidate was rejected.

Blocked candidates are internal rejection records, not recommendation candidates. A blocked row may appear in admin draft review only under `Uzak Dur`; member-safe previews must exclude `avoid`, `blocked`, audit-only, generated-after-kickoff, and blocking-conflict candidates.

Authenticated review APIs may read these stored conflict rows for internal audit. They are read-only and must not perform state transitions, settlement, public publishing, or tahmin kombini generation.

## Examples

### A. `0-0` Draw Profile

Expectation:

- `expected_scoreline=0-0`
- `goal_profile=low_goal`
- `result_profile=draw_lean`
- `btts_expected=false`

Compatible:

- `match_result_1x2=X`
- `under_1_5_goals`
- `under_2_5_goals`
- `btts_no`
- `first_half_under_0_5`
- score range containing `0-0`

Incompatible:

- `over_0_5_goals`
- `over_1_5_goals`
- `over_2_5_goals`
- `btts_yes`
- `first_half_over_0_5`
- any team total over `0.5`

### B. `1-1` Draw Profile

Expectation:

- `expected_scoreline=1-1`
- `goal_profile=medium_goal`
- `result_profile=draw_lean`
- `btts_expected=true`

Compatible:

- `match_result_1x2=X`
- `double_chance_1X`
- `double_chance_X2`
- `over_1_5_goals`
- `under_2_5_goals`
- `btts_yes`

Incompatible:

- `under_1_5_goals`
- `btts_no`
- high-confidence home win
- high-confidence away win

### C. `2-1` Home Win Profile

Expectation:

- `expected_scoreline=2-1`
- `goal_profile=high_goal`
- `result_profile=home_lean`
- `btts_expected=true`

Compatible:

- `match_result_1x2=1`
- `double_chance_1X`
- `over_2_5_goals`
- `btts_yes`
- home team total over `1.5`

Incompatible:

- `under_1_5_goals`
- `btts_no`
- `double_chance_X2` at high confidence
- away clean sheet

### D. `0-2` Away Win Profile

Expectation:

- `expected_scoreline=0-2`
- `goal_profile=medium_goal`
- `result_profile=away_lean`
- `btts_expected=false`

Compatible:

- `match_result_1x2=2`
- `double_chance_X2`
- `under_2_5_goals`
- `btts_no`
- away team total over `1.5`

Incompatible:

- home team total over `0.5`
- `btts_yes`
- home win
- `double_chance_1X` at high confidence

### E. High Total-Goal Profile

Expectation:

- `expected_total_goals>=3`
- `goal_profile=high_goal`
- `result_profile=balanced | home_lean | away_lean`

Compatible:

- `over_2_5_goals`
- `over_1_5_goals`
- `btts_yes` when both teams have expected goals above zero
- score ranges such as `2-1`, `1-2`, `2-2`, `3-1`

Incompatible:

- `under_1_5_goals`
- `first_half_under_0_5` at high confidence unless first-half evidence supports late scoring
- `btts_no` when both teams have expected goals above zero

## Settlement Interaction

Consistency status is not settlement status.

- Consistency validates logical coherence before publishing.
- Settlement validates actual outcome after the match.
- A consistent prediction can still fail.
- An inconsistent prediction should not be shown to members, public users, or tahmin kombini consumers.

## Public Visibility

Public successful predictions must have passed consistency checks.

Public cards may include a short explanation such as:

```text
Bu tahmin, maçın düşük gol profili ve beraberlik eğilimiyle tutarlıydı.
```

Blocked predictions must never be public-published. Warning predictions should not be public-published by default unless a future policy explicitly permits alternative-scenario disclosure.

## Non-Goals

- No member-visible prediction publication.
- No prediction model.
- No settlement implementation.
- No public page.
- No tahmin kombini implementation.
- No provider call, ingestion, scheduler, or auth behavior change.
