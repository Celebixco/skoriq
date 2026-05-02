# Basketball Feature Catalog

## Purpose

This catalog plans basketball prediction features from implemented normalized P0/P1 data only: `matches`, `basketball_match_scores`, `basketball_period_scores`, `basketball_team_match_statistics`, and `basketball_standings`.

Implementation status: `basketball_team_form_features` schema and builder are implemented for team form features. Head-to-head features, match prediction feature snapshots, prediction models, provider adapters, frontend, odds, and live recalculation remain unimplemented.

## Feature Catalog

| Feature Group | Feature | Source Tables | Required Fields | Priority | Pre-Match Availability | Window | Null / Missing Behavior | Target Future Table |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Recent form | last 5 wins | `matches`, `basketball_match_scores` | finished matches, final score/winner, team side | P0 | yes | last 5 | null if fewer than minimum matches; store sample size | `basketball_team_form_features` |
| Recent form | last 10 wins | `matches`, `basketball_match_scores` | finished matches, final score/winner, team side | P0 | yes | last 10 | null if insufficient history | `basketball_team_form_features` |
| Recent form | last 5 points for/against | `basketball_match_scores` | final score, team side | P0 | yes | last 5 | null if score missing | `basketball_team_form_features` |
| Recent form | last 10 points for/against | `basketball_match_scores` | final score, team side | P0 | yes | last 10 | null if score missing | `basketball_team_form_features` |
| Recent form | home/away form | `matches`, `basketball_match_scores` | team side, final score/result | P0 | yes | last 5 home or away, season-to-date | null if insufficient home/away sample | `basketball_team_form_features` |
| Scoring profile | points for average | `basketball_match_scores` | final score, team side | P0 | yes | last 5, last 10, season-to-date | null if score missing | `basketball_team_form_features` |
| Scoring profile | points against average | `basketball_match_scores` | final score, team side | P0 | yes | last 5, last 10, season-to-date | null if score missing | `basketball_team_form_features` |
| Scoring profile | first half points average | `basketball_match_scores`, `basketball_period_scores` | halftime or Q1+Q2 scores | P0/P1 | yes | last 5, last 10 | null if period/halftime scores missing | `basketball_team_form_features` |
| Scoring profile | second half points average | `basketball_period_scores` | Q3+Q4 scores | P1 | yes when period scores exist | last 5, last 10 | null if period scores missing | `basketball_team_form_features` |
| Scoring profile | quarter scoring profile | `basketball_period_scores` | Q1-Q4 scores | P0/P1 | yes | last 5, last 10 | null for missing periods; track coverage | `basketball_team_form_features` |
| Scoring profile | average total points | `basketball_match_scores` | both final scores | P0 | yes | last 5, last 10, season-to-date | null if score missing | `basketball_team_form_features` |
| Scoring profile | over total proxy | `basketball_match_scores` | total points history | P1 | yes | last 5, last 10 | null until threshold policy exists | `basketball_team_form_features` |
| Efficiency profile | field goal percentage average | `basketball_team_match_statistics` | `field_goal_percent` | P0 | yes | last 5, last 10 | null if stat missing | `basketball_team_form_features` |
| Efficiency profile | three point percentage average | `basketball_team_match_statistics` | `three_point_percent` | P0 | yes | last 5, last 10 | null if stat missing | `basketball_team_form_features` |
| Efficiency profile | free throw percentage average | `basketball_team_match_statistics` | `free_throw_percent` | P0 | yes | last 5, last 10 | null if stat missing | `basketball_team_form_features` |
| Efficiency profile | rebound rate proxy | `basketball_team_match_statistics` | rebounds total/offensive/defensive | P0/P1 | yes | last 5, last 10 | null if rebounds missing | `basketball_team_form_features` |
| Efficiency profile | assist rate proxy | `basketball_team_match_statistics` | assists, field goals made if available | P0/P1 | yes | last 5, last 10 | null if inputs missing | `basketball_team_form_features` |
| Efficiency profile | turnover rate proxy | `basketball_team_match_statistics` | turnovers | P0/P1 | yes | last 5, last 10 | null if stat missing | `basketball_team_form_features` |
| Efficiency profile | foul rate | `basketball_team_match_statistics` | personal fouls | P0/P1 | yes | last 5, last 10 | null if stat missing | `basketball_team_form_features` |
| Standings context | position | `basketball_standings` | `position` | P0 | yes after latest standings | latest row before match | null if no standings row | `basketball_team_form_features` |
| Standings context | win percentage | `basketball_standings` | `win_percentage` or wins/losses | P0 | yes | latest row | null if unavailable | `basketball_team_form_features` |
| Standings context | point difference | `basketball_standings` | `point_difference` | P0 | yes | latest row | null if standings missing | `basketball_team_form_features` |
| Standings context | home/away record | `basketball_standings` | home wins/losses, away wins/losses | P1 | yes when supplied | latest row | null if splits unavailable | `basketball_team_form_features` |
| Standings context | streak | `basketball_standings` | `streak` | P1 | yes when supplied | latest row | null if unavailable | `basketball_team_form_features` |
| Standings context | conference/division | `basketball_standings` | `conference`, `division` | P2 | yes when supplied | latest row | null if unavailable | `basketball_team_form_features` |
| Matchup / head-to-head | h2h wins | `matches`, `basketball_match_scores` | pair matches, final scores/results | P1 | yes | last 3, last 5 | null if no pair history | `basketball_head_to_head_features` |
| Matchup / head-to-head | h2h average total points | `basketball_match_scores` | pair match final scores | P1 | yes | last 3, last 5 | null if score missing | `basketball_head_to_head_features` |
| Matchup / head-to-head | h2h margin | `basketball_match_scores` | pair final score margin | P1 | yes | last 3, last 5 | null if score missing | `basketball_head_to_head_features` |
| Matchup / head-to-head | h2h home advantage | `matches`, `basketball_match_scores` | side, final score/result | P1 | yes | last 5 or all recent | null if insufficient sample | `basketball_head_to_head_features` |
| Matchup / head-to-head | close game rate | `basketball_match_scores` | final score margin | P1 | yes | last 5 or all recent | null until close-game threshold policy exists | `basketball_head_to_head_features` |
| Prediction-ready match features | home_team_form_score | team form features | recent win/points/efficiency metrics | P0 | yes | latest pre-match snapshot | null if form unavailable | `basketball_match_prediction_features` |
| Prediction-ready match features | away_team_form_score | team form features | recent win/points/efficiency metrics | P0 | yes | latest pre-match snapshot | null if form unavailable | `basketball_match_prediction_features` |
| Prediction-ready match features | home_offensive_strength | scores + team stats | points for, FG%, 3P%, assists, turnovers | P0/P1 | yes | last 5, last 10 | null or low confidence if coverage weak | `basketball_match_prediction_features` |
| Prediction-ready match features | away_offensive_strength | scores + team stats | points for, FG%, 3P%, assists, turnovers | P0/P1 | yes | last 5, last 10 | null or low confidence if coverage weak | `basketball_match_prediction_features` |
| Prediction-ready match features | home_defensive_strength | scores + team stats | points against, rebounds, turnovers forced proxy later | P0/P1 | yes | last 5, last 10 | null or low confidence if coverage weak | `basketball_match_prediction_features` |
| Prediction-ready match features | away_defensive_strength | scores + team stats | points against, rebounds, turnovers forced proxy later | P0/P1 | yes | last 5, last 10 | null or low confidence if coverage weak | `basketball_match_prediction_features` |
| Prediction-ready match features | expected_home_points_proxy | form + scoring + efficiency | offense/defense inputs, league baseline later | P1 | yes | latest pre-match snapshot | null until baseline policy exists | `basketball_match_prediction_features` |
| Prediction-ready match features | expected_away_points_proxy | form + scoring + efficiency | offense/defense inputs, league baseline later | P1 | yes | latest pre-match snapshot | null until baseline policy exists | `basketball_match_prediction_features` |
| Prediction-ready match features | expected_total_points_proxy | form + scoring + efficiency | both expected points proxies, pace proxy later | P1 | yes | latest pre-match snapshot | null until baseline policy exists | `basketball_match_prediction_features` |
| Prediction-ready match features | confidence score inputs | feature coverage | sample size, source coverage, recency | P0 | yes | latest pre-match snapshot | always record coverage even when values null | `basketball_match_prediction_features` |

## Notes

- Features are pre-match only when calculated from matches and standings completed before the target match tipoff.
- Do not include target-match final scores, period scores, or team statistics in the feature snapshot for that match.
- Implemented team form rows cover overall/home/away scopes, last-5/last-10 windows, scoring profile, period profile, team-stat averages, standings context, sample size, and coverage score.
- Missing statistics, period scores, or standings do not block feature creation; unavailable averages remain null and coverage score reflects available source depth.
- Do not infer player rotation, pace, usage, or odds-derived fields until future player/odds data exists.
