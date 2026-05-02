# Football Data Requirements

## Purpose

Football data collection is driven by match analysis and future score prediction, not live-score delivery. The platform should collect enough normalized historical and upcoming-match data to build team form, scoring tendency, match context, and later lineup/player-strength features.

## P0 - Required For MVP Score Prediction

These fields are required before football prediction features are useful:

- Fixtures and scheduled matches.
- Finished matches and final score.
- Halftime score.
- Home team and away team.
- Competition and season.
- Match date and scheduled start time.
- Standings.
- Last 5 and last 10 team form.
- Home form and away form.
- Goals for and goals against.
- Shots.
- Shots on target.
- Possession.
- Corners.
- Cards, including yellow and red cards.

## P1 - Strongly Improves Prediction

These fields should be added after P0 score and team-stat foundations are stable:

- Expected goals when available.
- Big chances.
- Dangerous attacks.
- Lineups and formations.
- Missing players.
- Player ratings.
- Head-to-head records.
- Referee.
- Venue.
- Shot map when available.

## P2 - Advanced/Future

These fields are useful later, but should not block MVP prediction foundations:

- Player heatmaps.
- Attacking momentum.
- Average positions.
- Market values.
- Detailed player profiles.
- Advanced player season statistics.

## Normalization Notes

- Keep canonical identity in shared tables: `sports`, `countries`, `competitions`, `seasons`, `teams`, `players`, and `matches`.
- Keep football scores, statistics, events, lineups, shot maps, and prediction features in football-specific tables.
- `football_match_scores` is implemented for score summary storage and depends on already-normalized canonical matches.
- `football_match_team_statistics` is implemented for P0/P1 team-level match statistics such as shots, possession, corners, cards, and expected goals.
- `football_standings` is implemented for P0 league table rows, including wins, draws, losses, goals for/against, goal difference, points, and form.
- Do not force football statistics into generic shared tables just because another sport has a similarly named metric.
- Store provider payloads raw before normalization, but only retain raw payloads according to existing retention policy.

## MVP Prediction Feature Groups

- Recent form points.
- Goals for and against.
- Home and away strength.
- Over/under rates.
- Both teams to score rate.
- Expected goals for and against when available.
- Shot quality.
- Lineup strength.
- Card and referee tendencies.

## Current Non-Goals

- No football prediction model yet.
- No Sofascore adapter yet.
- No live-score system.
- No football events, lineups, player match statistics, shot maps, or prediction features yet.
- No frontend.
- No betting or odds module unless explicitly approved later.
