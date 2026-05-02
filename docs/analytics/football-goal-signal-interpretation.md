# Football Goal Signal Interpretation

## Purpose

SkorIQ goal features must not remain spreadsheet-style columns. Every important goal feature should map to:

```text
feature -> signal -> causal interpretation -> supported predictions -> risk conditions
```

This document defines the first causal interpretation layer for the implemented `football_team_form_features` goal fields and the match-level goal-profile snapshots stored on `football_match_prediction_features`. It does not implement a prediction model, tahmin kombini, settlement changes, public publishing, provider calls, ingestion, scheduler behavior, or frontend behavior.

## Interpretation Principles

- A feature value is only useful when it explains a plausible match mechanism.
- A single team signal should usually be paired with opponent evidence before it supports a candidate.
- First-half predictions require first-half evidence; fulltime goal evidence is not enough.
- H2H missing is a confidence/risk condition, not automatic rejection when team-form evidence is strong.
- Contradictory signals should become consistency warnings or blocks before any member-visible or public use.
- Missing data should produce a warning or skip decision, not fabricated confidence.

## Feature Signal Map

| Feature | Signal Meaning | Causal Interpretation | Supported Prediction Types | Risk Conditions | Contradiction Conditions |
| --- | --- | --- | --- | --- | --- |
| `over_0_5_rate` high | Included matches rarely end goalless. | Baseline match environment has at least one goal tendency. Stronger when both teams also have high `scored_rate` or `conceded_rate`. | `over_0_5_goals`, cautious support for `over_1_5_goals` | Low sample, weak opponent evidence, H2H missing, missing shot/xG evidence | Contradicts a `0-0` expectation or strong low-goal profile. |
| `under_2_5_rate` high | Team’s recent matches tend to stay below three total goals. | Match may be controlled, lower tempo, or one-sided without escalation. | `under_2_5_goals`, low-goal profile, avoid high-total candidates | Small sample, opponent high-goal profile, tactical changes, missing recent context | Contradicts high-confidence `over_2_5_goals`, `over_3_5_goals`, or high expected total goals. |
| `scored_rate` high | Team consistently finds at least one goal. | Team attacking output is repeatable enough to support team-goal candidates when opponent defensive concession evidence agrees. | `team_over_0_5`, `team_over_1_5`, `over_1_5_goals`, `btts_yes` | Weak opponent sample, opponent clean-sheet signal, H2H missing, low shot/xG evidence | Contradicts scoreline/profile where this team is expected to score `0`. |
| `conceded_rate` high | Team regularly allows at least one goal. | Defensive openness or game-state exposure increases opponent scoring chance. | Opponent `team_over_0_5`, `btts_yes`, `over_1_5_goals` | Opponent weak scoring signal, recent defensive/tactical change, low sample | Contradicts a strong clean-sheet expectation for the same team. |
| `team_over_0_5_rate` high | Team-goal version of scoring consistency. | Same as `scored_rate`, but semantically scoped for team-total reasoning and UI explanations. | `home_team_over_0_5`, `away_team_over_0_5`, `btts_yes` | Same as `scored_rate`; also requires venue context in home/away scopes | Contradicts expected team goals near `0` or exact score with this team at `0`. |
| `team_over_1_5_rate` high | Team sometimes reaches two or more goals. | Stronger attacking ceiling signal; should be paired with opponent concession profile before recommending 1.5 team total. | `home_team_over_1_5`, `away_team_over_1_5`, high-goal profile | Volatile scoring, low sample, opponent strong defense, H2H missing | Contradicts low expected team-goals proxy or low-goal profile. |
| `first_half_over_0_5_rate` high | Included matches often have a first-half goal. | Early match tempo or defensive exposure supports first-half goal consideration when both sides show first-half evidence. | `first_half_over_0_5` | Missing/low first-half denominator, one-team-only signal, fulltime-only evidence | Contradicts `first_half_goal_profile=low_goal` or expected first-half goals near `0`. |
| `first_half_over_0_5_rate` low or null | First-half goal evidence is weak or missing. | Do not recommend `İY 0.5 Üst` without stronger evidence. | Avoid/skip first-half candidate, warning on first-half outputs | Missing halftime coverage, small sample | Blocks or warns against high-confidence `first_half_over_0_5`. |
| `first_half_avg_goals_for` high | Team contributes goals before halftime. | Team may start aggressively or exploit early defensive gaps. | Team first-half goal lean, `first_half_over_0_5` support | Needs opponent first-half concession evidence; low denominator risk | Contradicts low first-half profile if paired signals are weak. |
| `first_half_avg_goals_against` high | Team allows first-half goals. | Opponent may have an early scoring path if its first-half scoring signal also exists. | Opponent first-half goal lean, `first_half_over_0_5` support | Needs opponent first-half scoring evidence; low denominator risk | Contradicts first-half clean/low profile when strong. |

## Match-Level Goal Profile Signals

`football_match_prediction_features` now stores deterministic match-level goal summaries that aggregate the home-scope and away-scope team form fields. These are proxy signals, not xG, not probability, and not final Tahmin output.

| Match Feature | Signal Meaning | Causal Interpretation | Supported Future Prediction Types | Risk Conditions | Contradiction Conditions |
| --- | --- | --- | --- | --- | --- |
| `home_goal_signal_score` high | Home scoring path is supported by home team-total evidence and away concession evidence. | Home attack has repeatable scoring behavior and the opponent has allowed goals in the relevant away scope. | `home_team_over_0_5`, `home_team_over_1_5`, `over_1_5_goals`, home-lean goal profile | Missing venue sample, low away concession sample, H2H missing | Contradicts expected home goals near `0` or an exact score where home scores `0`. |
| `away_goal_signal_score` high | Away scoring path is supported by away team-total evidence and home concession evidence. | Away attack has a plausible scoring route against the home defensive profile. | `away_team_over_0_5`, `away_team_over_1_5`, `over_1_5_goals`, BTTS support | Weak away scoring sample, home clean-sheet signal, H2H missing | Contradicts expected away goals near `0` or an exact score where away scores `0`. |
| `expected_total_goals_proxy` high | Combined team-goal pathways point to a higher goal environment. | Match profile may support fulltime over candidates when both team profiles are not weak. | `over_1_5_goals`, cautious `over_2_5_goals`, high-goal profile | Proxy is not probability; first-half and BTTS still need their own evidence | Contradicts `under_2_5` when low-goal evidence is stronger. |
| `goal_profile=low_goal` | Expected total proxy and team signals are low. | Match may be controlled, low-tempo, or lacking two-sided scoring support. | `under_2_5_goals`, avoid/skip high-goal candidates | One team may still have a strong isolated team-goal path | Blocks or warns against high-confidence `over_2_5`, `over_3_5`, or goal-required bundles. |
| `first_half_goal_signal_score` high | Both teams’ first-half environments support an early goal. | First-half goal candidate has direct first-half evidence rather than fulltime-only inference. | `first_half_over_0_5` | Missing one side’s first-half history, small denominator | Contradicts `first_half_goal_profile=low_goal` or missing-evidence avoid rules. |
| `btts_signal_score` high with `btts_profile=yes_lean` | Both teams show scoring and conceding support. | Both sides have plausible scoring paths and both defenses allow goals. | `both_teams_to_score_yes`, over candidates | One team’s scored/conceded support can cap this to balanced even if total-goal proxy is high | Contradicts one-sided scoreline or expected team goals near `0`. |

## Causal Combination Examples

### Team Goal Support

```text
home scored_rate high
+ away conceded_rate high
-> home regularly scores and away regularly allows goals
-> supports home_team_over_0_5 or over_1_5
-> risk: low sample, missing H2H, weak shot/xG evidence
```

Reasoning copy example:

> Ev sahibi düzenli gol üretiyor, deplasman takımı dış sahada gol yeme eğiliminde.

### BTTS Support

```text
home scored_rate high
+ away scored_rate high
+ home conceded_rate high
+ away conceded_rate high
-> both teams have scoring paths and both defenses allow goals
-> supports KG Var / BTTS yes
-> risk: one side has low team_over_0_5_rate in the relevant venue scope
```

Reasoning copy example:

> İki takım da gol bulma eğilimi gösteriyor; savunma tarafında karşılıklı gol riski var.

### Low-Goal Support

```text
under_2_5_rate high
+ team_over_1_5_rate low
+ opponent scoring/conceding signals are modest
-> match may stay controlled or low tempo
-> supports under_2_5 or avoid over_2_5
-> risk: recent high-goal outlier, missing opponent evidence
```

Reasoning copy example:

> Düşük gol profili 2.5 Üst tahminiyle çelişiyor; daha temkinli gol senaryosu öne çıkıyor.

### First-Half Skip

```text
first_half_over_0_5_rate null or low
-> first-half evidence is missing or weak
-> skip/avoid first_half_over_0_5
-> do not infer first-half goals from fulltime over rates alone
```

Reasoning copy example:

> İlk yarı gol verisi yetersiz olduğu için İY 0.5 Üst önerilmedi.

## Reasoning Layer Impact

Future reasoning builders should use these interpretations to populate:

- `positive_signals`: strong scoring, conceding, BTTS, over/under, and first-half evidence.
- `risk_factors`: low sample, missing H2H, conflicting low/high goal signals, missing first-half denominator.
- `missing_data_warnings`: halftime data absent, no opponent concession evidence, no venue-specific sample.
- `confidence_ceiling`: lower when H2H or first-half evidence is missing for a goal-specific candidate.
- `recommendation_tier`: promote only coherent, evidence-backed candidates; keep weak or contradictory outputs as `Uzak Dur`.

## Candidate Generator Impact

The deterministic candidate generator now consumes the match-level goal profile fields directly. The generator still produces dry-run preview candidates only; it does not create member-visible predictions or public output.

- `goal_profile=high_goal` with a strong expected total proxy can support `MS 2.5 Üst` as `Denenir` or `Alternatif`.
- `goal_profile=medium_goal` supports `MS 1.5 Üst` before considering higher lines.
- `goal_profile=low_goal` supports `MS 2.5 Alt` and suppresses high-total candidates.
- `first_half_goal_profile=likely_goal` is required before `İY 0.5 Üst` can be promoted; otherwise it stays skipped or `Uzak Dur`.
- `btts_profile=yes_lean` is required before `KG Var` can be `Denenir`; `balanced` BTTS evidence is not strong enough for that tier.
- Missing H2H continues to cap confidence and appears as a warning/risk condition.

The output is deliberately compact: one `Tahminim`, up to two `Denenir`, one `Alternatif`, and one `Uzak Dur`.

## Consistency Impact

Consistency checks consume the signal interpretation, not just raw rates:

- `under_2_5_rate` high and low-goal profile should warn/block high-confidence `over_2_5`.
- `scored_rate` high cannot override an expected `0` team goal without opponent concession support.
- `first_half_over_0_5` must be blocked or warned when first-half evidence is missing.
- BTTS yes must be blocked when the canonical expectation says one side scores `0`.
- Team-total outputs must align with expected team-goal proxies and opponent concession evidence.

Current consistency behavior also reads `goal_profile`, `first_half_goal_profile`, `btts_profile`, expected team-goal proxies, and home/away team goal profiles from candidate metadata. These remain proxy signals, not probabilities.

## Non-Goals

- No final prediction model.
- No tahmin kombini.
- No odds or betting terminology.
- No provider fetches or ingestion.
- No public successful prediction publishing.
- No frontend behavior change.
