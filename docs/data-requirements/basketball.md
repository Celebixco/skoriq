# Basketball Data Requirements

## Purpose

Basketball data collection is driven by match analysis and future score prediction, not live-score delivery. The platform should collect enough normalized historical and upcoming-match data to build team form, scoring efficiency, pace proxies, rotation strength, and later player contribution features.

## P0 - Required For MVP Score Prediction

These fields are required before basketball prediction features are useful:

- Fixtures and scheduled matches.
- Finished matches and final score.
- Quarter scores.
- Home team and away team.
- Competition and season.
- Match date and scheduled start time.
- Standings.
- Last 5 and last 10 team form.
- Home form and away form.
- Points for and points against.
- Field goal percentage.
- Three point percentage.
- Free throw percentage.
- Rebounds.
- Assists.
- Turnovers.
- Fouls.

## P1 - Strongly Improves Prediction

These fields should be added after P0 score and team-stat foundations are stable:

- Player box score.
- Starter information.
- Minutes.
- Plus-minus.
- Bench points.
- Points in paint.
- Fast break points.
- Biggest lead.
- Injury or suspension context.
- Head-to-head records.

## P2 - Advanced/Future

These fields are useful later, but should not block MVP prediction foundations:

- Usage rate.
- Pace proxy.
- Offensive rating proxy.
- Defensive rating proxy.
- Rotation trend.
- Player efficiency trend.
- Odds or line movement if available later.

## Normalization Notes

- Keep canonical identity in shared tables: `sports`, `countries`, `competitions`, `seasons`, `teams`, `players`, and `matches`.
- Keep basketball period scores, team box scores, player box scores, rosters, and prediction features in basketball-specific tables.
- `basketball_match_scores` and `basketball_period_scores` are implemented for final/summary and quarter/overtime score storage.
- `basketball_team_match_statistics` is implemented for P0/P1 team-level box-score inputs such as shooting splits, rebounds, assists, turnovers, fouls, paint points, and bench points.
- `basketball_standings` is implemented for P0 league table rows, including wins, losses, win percentage, points for/against, point difference, conference, and division context.
- Do not force basketball box-score structure into generic shared football-oriented tables.
- Store provider payloads raw before normalization, but only retain raw payloads according to existing retention policy.

## MVP Prediction Feature Groups

- Recent win rate.
- Points for and against.
- Pace proxy.
- Shooting efficiency.
- Rebound rate.
- Turnover rate.
- Quarter performance.
- Bench contribution.
- Player minutes and rotation strength.

## Current Non-Goals

- No basketball prediction model yet.
- No Sofascore adapter yet.
- No live-score system.
- No basketball player box scores, rosters, or prediction features yet.
- No frontend.
- No betting or odds module unless explicitly approved later.
