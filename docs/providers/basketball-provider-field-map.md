# Basketball Provider Field Map

## Purpose

This map defines which basketball provider fields are useful, where they should land, and whether the platform can normalize them today. Field availability must be verified against real provider responses before adapter implementation.

## Already Supported

| Field Group | Field | Expected Provider Source | Target | Prediction Usefulness | Priority | Availability | Storage | Notes/Risks |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Fixture identity | match provider ID | fixture list or match detail | `matches`, `provider_mappings` | De-duplication and history joins. | P0 | Pre-match/post-match | Normalized | Required for match normalization. |
| Competition | competition provider ID/name | fixture list, competition endpoint | `competitions` | League context and quality grouping. | P0 | Pre-match | Normalized | Must be mapped before matches. |
| Season | season provider ID/name | fixture list, competition endpoint | `seasons` | Season-specific standings and form. | P0 | Pre-match | Normalized | Optional on match, required when provider supplies standings by season. |
| Teams | home and away team provider IDs | fixture list or match detail | `teams`, `matches` | Core identity for form and matchup features. | P0 | Pre-match | Normalized | Teams must be mapped before matches. |
| Schedule | scheduled start time | fixture list or match detail | `matches` | Rest windows and travel/timing context. | P0 | Pre-match | Normalized | Time zone handling must be verified per provider. |
| Status | provider-agnostic match status | fixture list or match detail | `matches`, `basketball_match_scores` metadata/status | Finished/upcoming filtering. | P0 | Pre-match/post-match | Normalized | Live-style statuses should not introduce live-score architecture. |
| Score | final/current/halftime/overtime score | score summary or match detail | `basketball_match_scores` | Points for/against and result labels. | P0 | Post-match | Normalized | Current scores are summary-only, not live delivery. |
| Period scores | quarter and overtime scores | period score response or match detail | `basketball_period_scores` | Quarter tendencies and scoring profile. | P0 | Post-match | Normalized | Overtime numbering must be verified per provider. |
| Winner | winner team provider ID | score summary or match detail | `basketball_match_scores`, optional `matches` | Result features and standings checks. | P0 | Post-match | Normalized | Missing winner mapping should not create teams. |
| Team statistics | shooting splits, rebounds, assists, turnovers, fouls | team statistics or box-score response | `basketball_team_match_statistics` | Core efficiency and possession proxy features. | P0 | Post-match | Normalized | Percentage convention is `0..100`. |
| Team statistics | bench points, paint points, fast-break points, biggest lead | team statistics or box-score response | `basketball_team_match_statistics` | Rotation and style indicators. | P1 | Post-match | Normalized when present | May be missing outside major leagues. |
| Standings | position, played, wins/losses, win percentage, points for/against | standings response | `basketball_standings` | Team quality and league context. | P0 | Pre-match/post-match | Normalized | Refresh after matchdays and daily. |

## Needed Next

| Field Group | Field | Expected Provider Source | Target | Prediction Usefulness | Priority | Availability | Storage | Notes/Risks |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Player box scores | minutes, points, rebounds, assists, steals, blocks, turnovers, fouls, plus-minus | player box-score response | future `basketball_player_box_scores` | Player contribution and rotation strength. | P1 | Post-match | Future normalized | Requires stable player mappings. |
| Starter info | starters and bench players | roster or box-score response | future `basketball_rosters` | Rotation and lineup strength. | P1 | Pre-match/post-match | Future normalized | Pre-match starter availability may be inconsistent. |
| Minutes | player minutes | player box-score response | future `basketball_player_box_scores` | Rotation load and availability. | P1 | Post-match | Future normalized | Format may be `MM:SS` and needs validation. |
| Plus-minus | player plus-minus | player box-score response | future `basketball_player_box_scores` | Contextual impact signal. | P1 | Post-match | Future normalized | Can be noisy for prediction if used naively. |
| Rosters | active roster, availability, role | roster/team profile response | future `basketball_rosters` | Player availability and depth. | P1 | Pre-match | Future normalized | Provider may not expose injuries consistently. |
| Injuries/suspensions | player absence context | team news, roster, or player status response | future availability table or roster metadata | Major predictor for rotation strength. | P1 | Pre-match | Future normalized or raw-only | Often incomplete or provider-specific. |
| Team rotation data | starter/bench trends, recent minutes | derived from box scores and rosters | future feature tables | Minutes and bench contribution trends. | P1/P2 | Pre-match derived | Derived normalized | Requires historical player box scores first. |
| Head-to-head source data | prior meetings between teams | historical fixture response | future `basketball_head_to_head_features` inputs | Pairwise matchup tendency. | P1 | Pre-match | Raw and later derived | Feature builder should compute final features. |

## Future And Advanced

| Field Group | Field | Expected Provider Source | Target | Prediction Usefulness | Priority | Availability | Storage | Notes/Risks |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Pace proxy | possessions or possession-estimate inputs | team/player statistics response | future basketball feature tables | Scoring environment and totals prediction. | P2 | Post-match/pre-match derived | Derived normalized | May be estimated from box-score fields. |
| Usage rate | player usage or usage inputs | advanced player stats response | future advanced player stats table | Player role and offensive load. | P2 | Post-match | Future normalized | Often unavailable in basic providers. |
| Efficiency ratings | offensive/defensive rating proxy | advanced team/player stats response | future feature tables | Team quality and matchup strength. | P2 | Derived | Derived normalized | Prefer deriving from normalized box scores when possible. |
| Player efficiency trend | rolling efficiency metrics | derived from player box scores | future feature tables | Rotation quality and form. | P2 | Pre-match derived | Derived normalized | Requires player box-score history. |
| Odds/line movement | pre-match odds and movement | approved odds provider only | future odds module | Market-implied probability. | P2 | Pre-match | Not implemented | Requires separate approval and compliance review. |

## Basketball Adapter Readiness Notes

- P0 adapter work can begin only after real provider responses prove fixture, score, period-score, team-statistics, and standings field availability.
- Player box scores and rosters require separate schema/normalizer tasks before normalization.
- Missing optional P1/P2 fields should not block P0 ingestion if DTO validation defines safe fallback behavior.

