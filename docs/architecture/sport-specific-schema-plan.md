# Sport-Specific Schema Split Plan

## Purpose

The platform uses shared canonical identity tables for provider-agnostic sports entities and sport-specific tables for prediction-relevant scores, statistics, events, lineups, and features. This keeps football and basketball analysis accurate without bending one sport into another sport's schema.

## Shared Core Boundary

These tables remain shared across sports:

- `sports`
- `countries`
- `competitions`
- `seasons`
- `teams`
- `players`
- `matches`
- `provider_mappings`
- `raw_provider_payloads`
- `sync_jobs`
- `sync_job_logs`

Shared tables store identity and common match context only. Public APIs should expose canonical IDs, not provider IDs.

These do not belong in shared identity tables:

- Football shot maps.
- Football expected goals statistics.
- Football lineups.
- Basketball quarter or overtime score detail.
- Basketball field goal, three point, or free throw percentages.
- Basketball player box scores.
- Prediction feature rows.

## Recommended Normalizer And Schema Order

Do not blindly continue with a generic `match_score` normalizer for detailed analysis.

Recommended order:

1. Keep shared `matches` as the canonical fixture and match identity table.
2. Use existing generic `match_scores` only for universal score summaries if needed.
3. Implement sport-specific scoring tables for detailed prediction-ready scores.
4. Implement football and basketball team-stat tables before events and advanced player data.
5. Build derived prediction feature tables only after the raw normalized sport-specific facts exist.

Preferred near-term path:

- Football: `football_match_scores` then `football_match_team_statistics`.
- Basketball: `basketball_match_scores`, `basketball_period_scores`, then `basketball_team_match_statistics`.

## Proposed Football-Specific Tables

| Table | Purpose | Key Columns | Relations | Priority | Timing |
| --- | --- | --- | --- | --- | --- |
| `football_match_scores` | Store football score summary without overloading generic score tables. | `match_id`, `home_score_current`, `away_score_current`, `home_score_halftime`, `away_score_halftime`, `home_score_fulltime`, `away_score_fulltime`, `home_score_extra_time`, `away_score_extra_time`, `home_score_penalties`, `away_score_penalties`, `winner_team_id`, `metadata_json` | `matches`, `teams` | P0 | Implemented |
| `football_match_team_statistics` | Store team-level football match stats. | `match_id`, `team_id`, `opponent_team_id`, `is_home`, `possession_percent`, `shots_total`, `shots_on_target`, `corners`, `fouls`, `yellow_cards`, `red_cards`, `expected_goals`, `big_chances`, `dangerous_attacks`, `metadata_json` | `matches`, `teams` | P0/P1 | Implemented |
| `football_match_events` | Store football event timelines. | `match_id`, `team_id`, `player_id`, `event_type`, `minute`, `extra_minute`, `metadata_json`, `provider_order`, `content_hash` | `matches`, `teams`, `players` | P1 | Later |
| `football_lineups` | Store formations, starters, bench, and missing player context. | `match_id`, `team_id`, `player_id`, `role`, `position`, `shirt_number`, `formation`, `is_starting`, `is_missing`, `metadata_json` | `matches`, `teams`, `players` | P1 | Later |
| `football_player_match_statistics` | Store player-level match contribution. | `match_id`, `team_id`, `player_id`, `minutes`, `rating`, `goals`, `assists`, `cards`, `shots`, `passes`, `metadata_json`, `content_hash` | `matches`, `teams`, `players` | P1/P2 | Later |
| `football_shot_maps` | Store shot-level location and quality data. | `match_id`, `team_id`, `player_id`, `minute`, `x`, `y`, `xg`, `body_part`, `shot_result`, `metadata_json` | `matches`, `teams`, `players` | P1/P2 | Later |
| `football_team_form_features` | Store precomputed football team form features. | `team_id`, `competition_id`, `season_id`, `as_of_match_id`, `as_of_date`, `window_size`, `scope`, direct form/stat/standing feature columns, `sample_size`, `coverage_score`, `metadata_json` | `teams`, `competitions`, `seasons`, `matches`, `football_match_scores`, `football_match_team_statistics`, `football_standings` | P0/P1 derived | Implemented |
| `football_head_to_head_features` | Store pairwise football matchup features. | `team_a_id`, `team_b_id`, `as_of_match_id`, `features_json`, `content_hash` | `teams`, `matches` | P0/P1 derived | After normalized scores/stats |
| `football_prediction_features` | Store match-level prediction-ready feature snapshots. | `match_id`, `features_json`, `model_context_json`, `content_hash` | `matches` | Derived | After feature builders |
| `football_standings` | Store football league table rows. | `competition_id`, `season_id`, `team_id`, `position`, `played`, `wins`, `draws`, `losses`, `goals_for`, `goals_against`, `goal_difference`, `points`, `form_string`, `metadata_json` | `competitions`, `seasons`, `teams` | P0 | Implemented |

## Proposed Basketball-Specific Tables

| Table | Purpose | Key Columns | Relations | Priority | Timing |
| --- | --- | --- | --- | --- | --- |
| `basketball_match_scores` | Store basketball final score summary. | `match_id`, `home_score_current`, `away_score_current`, `home_score_final`, `away_score_final`, `home_score_halftime`, `away_score_halftime`, `home_score_overtime`, `away_score_overtime`, `winner_team_id`, `metadata_json` | `matches`, `teams` | P0 | Implemented |
| `basketball_period_scores` | Store quarter and overtime scoring. | `match_id`, `period_number`, `period_type`, `overtime_number`, `home_score`, `away_score`, `metadata_json` | `matches` | P0 | Implemented |
| `basketball_team_match_statistics` | Store team box-score level stats. | `match_id`, `team_id`, `opponent_team_id`, `is_home`, `field_goals_made`, `field_goals_attempted`, `field_goal_percent`, `three_point_percent`, `free_throw_percent`, `rebounds_total`, `assists`, `turnovers`, `personal_fouls`, `points_in_paint`, `fast_break_points`, `bench_points`, `biggest_lead`, `metadata_json` | `matches`, `teams` | P0/P1 | Implemented |
| `basketball_player_box_scores` | Store player box-score contribution. | `match_id`, `team_id`, `player_id`, `is_starter`, `minutes`, `points`, `rebounds`, `assists`, `steals`, `blocks`, `turnovers`, `fouls`, `plus_minus`, `metadata_json`, `content_hash` | `matches`, `teams`, `players` | P1 | Later |
| `basketball_rosters` | Store starters, bench, and roster context. | `match_id`, `team_id`, `player_id`, `role`, `is_starter`, `is_available`, `metadata_json` | `matches`, `teams`, `players` | P1 | Later |
| `basketball_team_form_features` | Store precomputed basketball team form features. | `team_id`, `competition_id`, `season_id`, `as_of_match_id`, `as_of_date`, `window_size`, `scope`, direct form/period/stat/standing feature columns, `sample_size`, `coverage_score`, `metadata_json` | `teams`, `competitions`, `seasons`, `matches`, `basketball_match_scores`, `basketball_period_scores`, `basketball_team_match_statistics`, `basketball_standings` | P0/P1 derived | Implemented |
| `basketball_head_to_head_features` | Store pairwise basketball matchup features. | `team_a_id`, `team_b_id`, `as_of_match_id`, `features_json`, `content_hash` | `teams`, `matches` | P0/P1 derived | After normalized scores/stats |
| `basketball_prediction_features` | Store match-level prediction-ready feature snapshots. | `match_id`, `features_json`, `model_context_json`, `content_hash` | `matches` | Derived | After feature builders |
| `basketball_standings` | Store basketball league table rows. | `competition_id`, `season_id`, `team_id`, `position`, `played`, `wins`, `losses`, `win_percentage`, `points_for`, `points_against`, `point_difference`, `conference`, `division`, `metadata_json` | `competitions`, `seasons`, `teams` | P0 | Implemented |

## Provider Data Collection Checklist

Provider integration must not start until the target fields are mapped by sport and priority.

For each provider candidate, document:

- Which P0 football fields are available?
- Which P1/P2 football fields are available?
- Which P0 basketball fields are available?
- Which P1/P2 basketball fields are available?
- Which fields are missing?
- Which fields are stored raw only?
- Which fields are normalized?
- Which fields are used for prediction features?
- Which fields require sport-specific tables?
- Which fields are stable enough for MVP?
- Which fields should wait for later enrichment?

## Prediction Feature Strategy

Football feature groups:

- Recent form points.
- Goals for and against.
- Home and away strength.
- Over and under rates.
- Both teams to score rate.
- Expected goals for and against.
- Shot quality.
- Lineup strength.
- Card and referee tendencies.

Basketball feature groups:

- Recent win rate.
- Points for and against.
- Pace proxy.
- Shooting efficiency.
- Rebound rate.
- Turnover rate.
- Quarter performance.
- Bench contribution.
- Player minutes and rotation strength.

## What Not To Build Yet

- No prediction model yet.
- No Sofascore adapter yet.
- No live-score system.
- No football or basketball events, lineups, player statistics, box scores, standings, or prediction tables yet.
- No frontend.
- No betting or odds module unless explicitly approved later.
- No real provider fetching until provider field availability has been checked against the P0/P1/P2 lists.

## Implemented Scoring Slice

The first sport-specific scoring slice is implemented:

- `football_match_scores`
- `basketball_match_scores`
- `basketball_period_scores`

These tables are dependent facts keyed by canonical match identity. Their normalizers require an existing provider mapping for the match and do not create matches, teams, or score-row provider mappings. The generic `match_scores` table remains available only for universal summary use if explicitly needed later; detailed football and basketball scoring should use the sport-specific tables above.

The first team-statistics slice is implemented:

- `football_match_team_statistics`
- `basketball_team_match_statistics`

These tables are dependent facts keyed by canonical match and team identity. Their normalizers require existing provider mappings for the match and team, verify that the team belongs to the canonical match, derive `opponent_team_id` and `is_home`, and do not create matches, teams, or statistics-row provider mappings. The generic `match_statistics` table remains shell-only and should not be used for detailed football or basketball analysis.

The sport-specific standings slice is implemented:

- `football_standings`
- `basketball_standings`

These standings tables are dependent facts keyed by canonical competition, optional season, and team identity. Their normalizers require existing provider mappings for competition and team, require a season mapping when `seasonProviderId` is supplied, and do not create provider mappings for standing rows. Basketball `win_percentage` uses a `0..100` convention. Validation is intentionally tolerant of provider partial tables and does not fail solely when wins/losses totals exceed `played`.
