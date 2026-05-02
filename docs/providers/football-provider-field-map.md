# Football Provider Field Map

## Purpose

This map defines which football provider fields are useful, where they should land, and whether the platform can normalize them today. Field availability must be verified against real provider responses before adapter implementation.

## Already Supported

| Field Group | Field | Expected Provider Source | Target | Prediction Usefulness | Priority | Availability | Storage | Notes/Risks |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Fixture identity | match provider ID | fixture list or match detail | `matches`, `provider_mappings` | De-duplication and history joins. | P0 | Pre-match/post-match | Normalized | Required for match normalization. |
| Competition | competition provider ID/name | fixture list, competition endpoint | `competitions` | League context and strength grouping. | P0 | Pre-match | Normalized | Must be mapped before matches. |
| Season | season provider ID/name | fixture list, competition endpoint | `seasons` | Season-specific standings and form. | P0 | Pre-match | Normalized | Optional on match, required when provider supplies standings by season. |
| Teams | home and away team provider IDs | fixture list or match detail | `teams`, `matches` | Core identity for form and matchup features. | P0 | Pre-match | Normalized | Teams must be mapped before matches. |
| Schedule | scheduled start time | fixture list or match detail | `matches` | Rest windows and fixture timing. | P0 | Pre-match | Normalized | Time zone handling must be verified per provider. |
| Status | provider-agnostic match status | fixture list or match detail | `matches`, `football_match_scores` metadata/status | Finished/upcoming filtering. | P0 | Pre-match/post-match | Normalized | Live-style statuses should not introduce live-score architecture. |
| Score | halftime and fulltime score | score summary or match detail | `football_match_scores` | Goals, totals, result labels. | P0 | Post-match | Normalized | Extra-time and penalties are supported when available. |
| Winner | winner team provider ID | score summary or match detail | `football_match_scores`, optional `matches` | Result features and standings checks. | P0 | Post-match | Normalized | Missing winner mapping should not create teams. |
| Team statistics | shots, shots on target, possession, corners, fouls, cards | match statistics response | `football_match_team_statistics` | P0 model inputs for team strength and match style. | P0 | Post-match | Normalized | Availability often varies by league. |
| Team statistics | xG, big chances, dangerous attacks | match statistics response | `football_match_team_statistics` | Strong shot quality and pressure signals. | P1 | Post-match | Normalized when present | Some providers/leagues may omit these. |
| Standings | position, played, W/D/L, goals, points, form | standings response | `football_standings` | League strength, pressure, and form context. | P0 | Pre-match/post-match | Normalized | Refresh after matchdays and daily. |
| Context | referee and venue | match detail | `matches` | Referee/card and home-ground effects. | P1 | Pre-match/post-match | Normalized if present | Existing match fields support this, but availability must be checked. |

## Needed Next

| Field Group | Field | Expected Provider Source | Target | Prediction Usefulness | Priority | Availability | Storage | Notes/Risks |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Events | goals, cards, substitutions, penalties, VAR-like events | match events response | future `football_match_events` | Sequence and player availability context. | P1 | In-match/post-match | Future normalized | Do not build live timelines yet. |
| Lineups | starters, bench, formation, shirt number | lineup response | future `football_lineups` | Pre-match lineup strength and tactical setup. | P1 | Usually pre-match/post-match | Future normalized | Pre-match availability may be inconsistent. |
| Missing players | injury, suspension, absence reason | lineup/team news response | future `football_lineups` or availability table | Major predictor for team strength. | P1 | Pre-match | Future normalized or raw-only | Often provider-specific and incomplete. |
| Player match stats | minutes, rating, goals, assists, cards, passes, shots | player statistics response | future `football_player_match_statistics` | Player contribution and lineup quality. | P1/P2 | Post-match | Future normalized | Requires stable player mappings. |
| Shot maps | shot coordinates, xG per shot, body part, result | shot map response | future `football_shot_maps` | Shot quality and chance profile. | P1/P2 | Post-match | Future normalized | Coordinate systems vary by provider. |
| Head-to-head source data | prior meetings between teams | historical fixture response | future `football_head_to_head_features` inputs | Pairwise matchup tendency. | P1 | Pre-match | Raw and later derived | Feature builder should compute final features. |

## Future And Advanced

| Field Group | Field | Expected Provider Source | Target | Prediction Usefulness | Priority | Availability | Storage | Notes/Risks |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Heatmaps | player heatmap coordinates | advanced player/match response | future advanced table | Movement and role analysis. | P2 | Post-match | Raw-only until schema approved | High volume and provider-specific. |
| Momentum | attacking momentum or pressure timeline | advanced match response | future advanced table | Match control and pressure trend. | P2 | Post-match | Raw-only until schema approved | May be proprietary or UI-only. |
| Market value | player or squad market value | player/team profile response | future player profile enrichment | Squad strength proxy. | P2 | Pre-match | Raw-only or future normalized | Source freshness and licensing require review. |
| Player season stats | season aggregates by player | player season statistics response | future player season table | Long-term player form. | P2 | Pre-match/post-match | Future normalized | Needs sport-specific schema approval. |
| Odds/line movement | pre-match odds and movement | approved odds provider only | future odds module | Market-implied probability. | P2 | Pre-match | Not implemented | Requires separate approval and compliance review. |

## Football Adapter Readiness Notes

- P0 adapter work can begin only after real provider responses prove fixture, score, team-statistics, and standings field availability.
- Events, lineups, player statistics, and shot maps require separate schema/normalizer tasks before normalization.
- Missing optional P1/P2 fields should not block P0 ingestion if DTO validation defines safe fallback behavior.

