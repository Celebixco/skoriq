# Football Feature Catalog

## Purpose

This catalog plans football prediction features from implemented normalized P0/P1 data only: `matches`, `football_match_scores`, `football_match_team_statistics`, and `football_standings`.

Implementation status: `football_team_form_features`, `football_head_to_head_features`, and `football_match_prediction_features` schemas and builders are implemented. Prediction models, provider adapters, frontend, odds, and live recalculation remain unimplemented.

Goal-related football Tahmin outputs are the preferred MVP direction because they are more explainable than exact score predictions. The future goal-profile expansion is planned in [Football Goal Feature Expansion Plan](./football-goal-feature-expansion-plan.md).

## Implemented Builder Lifecycle

- `buildForTeam(teamId, options)` writes feature rows for configured windows and scopes.
- `buildForMatch(matchId)` writes pre-match feature rows for both teams using only matches before the target match scheduled time.
- `rebuildAfterMatch(matchId)` writes feature rows for both teams including the final match itself when the match status is final.
- `buildForCompetitionSeason(competitionId, seasonId)` can rebuild teams discovered from final matches in that competition/season.
- `FootballHeadToHeadFeatureBuilder.buildForPair(teamAId, teamBId, options)` writes pair rows for canonical team ordering and configured windows.
- `FootballHeadToHeadFeatureBuilder.buildForMatch(matchId)` writes pre-match H2H rows for the target match pair.
- `FootballHeadToHeadFeatureBuilder.rebuildAfterMatch(matchId)` includes the final match itself when the match status is final.
- `FootballMatchPredictionFeatureBuilder.buildForMatch(matchId)` writes one precomputed feature snapshot for a target match by combining existing home/away team form and H2H features.
- `FootballMatchReasoningBuilder.buildFromPredictionFeature(feature)` creates a deterministic read-only explanation snapshot from an existing football match prediction feature row.
- No queue, scheduler, provider ingestion trigger, prediction model, or live recalculation is attached yet.

## Implemented Calculation Rules

- Final statuses included: `finished`, `after_extra_time`, `after_penalties`.
- Non-final, future, cancelled, postponed, scheduled, and abandoned matches are excluded.
- Default windows are 5 and 10; default scopes are `overall`, `home`, and `away`.
- Missing team statistics and standings do not block feature creation.
- No-match rows are written with zero count totals, `sample_size=0`, `coverage_score=0`, and unavailable rate/average fields as null.
- Rate fields use a `0..100` convention.
- H2H feature pairs are canonicalized by deterministic team UUID string order, so A-vs-B and B-vs-A do not create duplicate feature rows.
- H2H coverage score is a simple `0..100` score: up to 80 points from sample size relative to the requested window, plus up to 20 points for score availability in fetched source rows.
- Match prediction feature snapshots use weighted coverage: 40% home form, 40% away form, and 20% H2H when H2H has samples; otherwise 50% home form and 50% away form with `metadata.h2hMissing=true`.
- Match prediction readiness follows [Prediction Readiness Policy](./prediction-readiness-policy.md): `ready` requires home and away form sample sizes of at least 3 plus combined coverage of at least 50; H2H is useful but optional for MVP readiness when form coverage is strong.
- `partial` means useful feature context exists but sample size or coverage is limited; `insufficient_data` means critical source context is missing, both form sides are empty, or combined coverage is below 20.
- Match prediction feature snapshots are feature inputs only. They do not produce predicted scores, betting picks, odds, or kupons.
- Match reasoning snapshots are explanation outputs only. They report positive signals, risks, missing data, prediction eligibility, kupon ineligibility, and a confidence ceiling, but never generate a predicted score or betting decision.
- Current goal features cover basic fulltime scoring rates, but they do not yet cover first-half goal rates, explicit under rates, team-total rates, goal volatility, or match-level goal-profile classifications.

## Feature Catalog

Goal-related football features are not intended to be consumed as raw numbers only. The first causal mapping for `over_0_5_rate`, `under_2_5_rate`, scored/conceded rates, team-total rates, and first-half goal fields is documented in [Football Goal Signal Interpretation](./football-goal-signal-interpretation.md).

| Feature Group | Feature | Source Tables | Required Fields | Priority | Pre-Match Availability | Window | Null / Missing Behavior | Target Future Table |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Recent form | last 5 points | `matches`, `football_match_scores` | finished matches, winner/score, home/away teams | P0 | yes | last 5 team matches before target match | calculate from available matches; store sample size | `football_team_form_features` |
| Recent form | last 10 points | `matches`, `football_match_scores` | finished matches, winner/score, home/away teams | P0 | yes | last 10 team matches | null if insufficient history; store sample size | `football_team_form_features` |
| Recent form | last 5 goals for/against | `matches`, `football_match_scores` | fulltime score, team side | P0 | yes | last 5 | null if score missing | `football_team_form_features` |
| Recent form | last 10 goals for/against | `matches`, `football_match_scores` | fulltime score, team side | P0 | yes | last 10 | null if score missing | `football_team_form_features` |
| Recent form | win/draw/loss rates | `matches`, `football_match_scores` | fulltime score or winner | P0 | yes | last 5, last 10, season-to-date | null if result missing; keep denominator | `football_team_form_features` |
| Recent form | home/away form | `matches`, `football_match_scores` | team side, score/result | P0 | yes | last 5 home or away, season-to-date | null if insufficient home/away sample | `football_team_form_features` |
| Scoring profile | goals for average | `football_match_scores`, `matches` | fulltime score, team side | P0 | yes | last 5, last 10, season-to-date | null if no scored matches | `football_team_form_features` |
| Scoring profile | goals against average | `football_match_scores`, `matches` | fulltime score, team side | P0 | yes | last 5, last 10, season-to-date | null if no scored matches | `football_team_form_features` |
| Scoring profile | first half goal rates | `football_match_scores` | halftime score | P1 | yes when historical halftime exists | last 5, last 10 | implemented: `first_half_over_0_5_rate`, `first_half_avg_goals_for`, `first_half_avg_goals_against`; null if halftime denominator missing | `football_team_form_features` |
| Scoring profile | clean sheet rate | `football_match_scores`, `matches` | goals against | P0 | yes | last 5, last 10, season-to-date | null if score missing | `football_team_form_features` |
| Scoring profile | failed to score rate | `football_match_scores`, `matches` | goals for | P0 | yes | last 5, last 10, season-to-date | null if score missing | `football_team_form_features` |
| Scoring profile | both teams to score rate | `football_match_scores` | both teams fulltime scores | P0 | yes | last 5, last 10, season-to-date | null if either score missing | `football_team_form_features` |
| Scoring profile | over 1.5 / 2.5 / 3.5 rates | `football_match_scores` | total goals | P0 | yes | last 5, last 10, season-to-date | null if score missing | `football_team_form_features` |
| Scoring profile | over 0.5 / under 2.5 rates | `football_match_scores` | total goals | P1 | yes | last 5, last 10, season-to-date | implemented: `over_0_5_rate`, `under_2_5_rate`; null if no fulltime denominator | `football_team_form_features` |
| Scoring profile | team scored / conceded rates | `football_match_scores`, `matches` | goals for/against | P1 | yes | last 5, last 10, season-to-date | implemented: `scored_rate`, `conceded_rate`; null if no fulltime denominator | `football_team_form_features` |
| Scoring profile | team total over 0.5 / 1.5 rates | `football_match_scores`, `matches` | team goals by side | P1 | yes | last 5, last 10, season-to-date | implemented: `team_over_0_5_rate`, `team_over_1_5_rate`; null if no fulltime denominator | `football_team_form_features` |
| Scoring profile | goal volatility score | `football_match_scores` | total goals distribution | P2 | yes after enough sample | last 10 or season-to-date | null until volatility policy exists | `football_team_form_features` |
| Team performance statistics | average shots | `football_match_team_statistics` | `shots_total` | P0 | yes after historical stats exist | last 5, last 10 | null if stat missing; track coverage | `football_team_form_features` |
| Team performance statistics | average shots on target | `football_match_team_statistics` | `shots_on_target` | P0 | yes | last 5, last 10 | null if stat missing | `football_team_form_features` |
| Team performance statistics | average possession | `football_match_team_statistics` | `possession_percent` | P0 | yes | last 5, last 10 | null if stat missing | `football_team_form_features` |
| Team performance statistics | average corners | `football_match_team_statistics` | `corners` | P0 | yes | last 5, last 10 | null if stat missing | `football_team_form_features` |
| Team performance statistics | average cards | `football_match_team_statistics` | `yellow_cards`, `red_cards` | P0/P1 | yes | last 5, last 10 | null if both card fields missing | `football_team_form_features` |
| Team performance statistics | average fouls | `football_match_team_statistics` | `fouls` | P0/P1 | yes | last 5, last 10 | null if stat missing | `football_team_form_features` |
| Team performance statistics | xG average | `football_match_team_statistics` | `expected_goals` | P1 | yes when provider supplies xG | last 5, last 10 | null if xG unavailable; do not infer | `football_team_form_features` |
| Team performance statistics | dangerous attacks average | `football_match_team_statistics` | `dangerous_attacks` | P1 | yes when provider supplies it | last 5, last 10 | null if unavailable | `football_team_form_features` |
| Standings context | league position | `football_standings` | `position` | P0 | yes after latest standings | latest row before match | null if no standings row | `football_team_form_features` |
| Standings context | points | `football_standings` | `points` | P0 | yes | latest row | null if standings missing | `football_team_form_features` |
| Standings context | goal difference | `football_standings` | `goal_difference` | P0 | yes | latest row | null if standings missing | `football_team_form_features` |
| Standings context | home/away standing splits | `football_standings` | home/away played/wins/draws/losses/goals | P1 | yes when supplied | latest row | null if splits unavailable | `football_team_form_features` |
| Standings context | distance to top/relegation | `football_standings` | full league table snapshot | P2 | yes later | latest table | null until table-wide builder exists | `football_team_form_features` |
| Matchup / head-to-head | last h2h matches | `matches`, `football_match_scores` | pair matches, scores/results | P1 | yes | last 3, last 5 | null if no pair history | `football_head_to_head_features` |
| Matchup / head-to-head | h2h goals average | `football_match_scores` | pair match scores | P1 | yes | last 3, last 5 | null if score missing | `football_head_to_head_features` |
| Matchup / head-to-head | h2h home advantage | `matches`, `football_match_scores` | side, score/result | P1 | yes | last 5 or all recent | null if insufficient sample | `football_head_to_head_features` |
| Matchup / head-to-head | h2h over/BTTS rates | `football_match_scores` | pair match scores | P1 | yes | last 3, last 5 | null if score missing | `football_head_to_head_features` |
| Matchup / head-to-head | h2h low/high goal rates | `football_match_scores` | pair match scores | P1 | yes | last 3, last 5 | null if no pair history | `football_head_to_head_features` |
| Prediction-ready match features | home_team_form_score | team form features | recent form metrics | P0 | yes | latest pre-match snapshot | null if team form unavailable | `football_match_prediction_features` |
| Prediction-ready match features | away_team_form_score | team form features | recent form metrics | P0 | yes | latest pre-match snapshot | null if team form unavailable | `football_match_prediction_features` |
| Prediction-ready match features | home_attack_strength | scores + team stats | goals, shots, shots on target, xG if available | P0/P1 | yes | last 5, last 10 | null or low confidence if coverage weak | `football_match_prediction_features` |
| Prediction-ready match features | away_attack_strength | scores + team stats | goals, shots, shots on target, xG if available | P0/P1 | yes | last 5, last 10 | null or low confidence if coverage weak | `football_match_prediction_features` |
| Prediction-ready match features | home_defense_strength | scores + team stats | goals against, shots allowed proxy | P0/P1 | yes | last 5, last 10 | null or low confidence if coverage weak | `football_match_prediction_features` |
| Prediction-ready match features | away_defense_strength | scores + team stats | goals against, shots allowed proxy | P0/P1 | yes | last 5, last 10 | null or low confidence if coverage weak | `football_match_prediction_features` |
| Prediction-ready match features | expected_home_goals_proxy | team form goal fields | home team-total rates + away concession rate + minor first-half concession context | P1 | yes | latest pre-match snapshot | null when source goal fields are missing; proxy only, not xG | `football_match_prediction_features` |
| Prediction-ready match features | expected_away_goals_proxy | team form goal fields | away team-total rates + home concession rate + minor first-half concession context | P1 | yes | latest pre-match snapshot | null when source goal fields are missing; proxy only, not xG | `football_match_prediction_features` |
| Prediction-ready match features | expected_total_goals_proxy | team form goal fields | home/away expected goal proxies | P1 | yes | latest pre-match snapshot | null when either side proxy is missing | `football_match_prediction_features` |
| Prediction-ready match features | home_goal_signal_score / away_goal_signal_score | team form goal fields | team scoring path plus opponent concession weakness | P1 | yes | latest pre-match snapshot | null when team-total or conceded evidence is missing | `football_match_prediction_features` |
| Prediction-ready match features | first_half_goal_signal_score | halftime score history | average of both teams' first-half over 0.5 rates | P1/P2 | yes when both sides have halftime history | latest pre-match snapshot | null when either side lacks first-half evidence | `football_match_prediction_features` |
| Prediction-ready match features | btts_signal_score | scoring/conceding rates | both teams' scored and conceded support | P1 | yes | latest pre-match snapshot | null when any scoring/conceding input is missing | `football_match_prediction_features` |
| Prediction-ready match features | goal_profile | match-level goal proxy | low/medium/high/unknown total-goal environment | P1 | yes | latest pre-match snapshot | `unknown` when total proxy is missing | `football_match_prediction_features` |
| Prediction-ready match features | first_half_goal_profile | first-half signal score | likely_goal/low_goal/unknown from direct first-half evidence | P1/P2 | yes when halftime history exists | latest pre-match snapshot | `unknown` when first-half signal is missing or inconclusive | `football_match_prediction_features` |
| Prediction-ready match features | btts_profile | BTTS signal score | yes_lean/no_lean/balanced/unknown from scoring and conceding support | P1 | yes | latest pre-match snapshot | `unknown` when explicit inputs are missing | `football_match_prediction_features` |
| Prediction-ready match features | home_team_goal_profile / away_team_goal_profile | team goal signal scores | weak/moderate/strong/unknown team scoring pathways | P1 | yes | latest pre-match snapshot | `unknown` when team goal signal is missing | `football_match_prediction_features` |
| Prediction-ready match features | confidence score inputs | feature coverage | sample size, source coverage, recency | P0 | yes | latest pre-match snapshot | always record coverage even when values null | `football_match_prediction_features` |

## Notes

- Features are pre-match only when calculated from matches and standings completed before the target match kickoff.
- Do not include target-match final scores/statistics in the feature snapshot for that match.
- Do not infer xG, dangerous attacks, or unavailable provider fields from unrelated stats.
