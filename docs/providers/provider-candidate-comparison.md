# Provider Candidate Comparison

## Purpose

This document compares candidate providers for football and basketball match analysis and score prediction. It is planning evidence only. It does not approve any provider for production, implement adapter code, add scraping, create ingestion jobs, write to the database, or require paid infrastructure.

Provider details change over time. Pricing, plan limits, terms, and exact field availability must be manually verified again before adapter implementation.

## Reviewed Sources

| Provider | Source | Reviewed Date | Notes |
| --- | --- | --- | --- |
| Sofascore | `docs/providers/sofascore-field-evidence.md` and Sofascore sports data API FAQ | 2026-04-29 | Research-only candidate. Sofascore states it cannot share sports data sources as API endpoints due to data-provider agreements. |
| api-football.com / API-SPORTS | `https://www.api-football.com/pricing` | 2026-04-29 | Pricing page lists free and paid plans plus football endpoints such as countries, seasons, leagues, standings, fixtures, lineups, statistics, players, injuries, odds, and predictions. This is not apifootball.com. |
| apifootball.com | `docs/providers/apifootball-com-field-evidence.md` and public apifootball.com docs/pricing pages | 2026-04-29 | Low/no-cost football POC candidate with action-based query params such as `get_countries`, `get_leagues`, `get_events`, `get_standings`, and `get_teams`; production gate remains blocked. |
| Sportmonks | `https://www.sportmonks.com/football-api/plans-pricing/` and `https://docs.sportmonks.com/v3/.../fixtures` | 2026-04-29 | Football-focused API with documented fixtures, standings, teams/player data, events, lineups, and statistics. Paid plans and 14-day trial documented. |
| TheSportsDB | `https://www.thesportsdb.com/documentation` and pricing page search result | 2026-04-29 | Multi-sport API with free tier and broad metadata/results orientation; detailed prediction-stat depth requires verification. |
| football-data.org | `https://www.football-data.org/` and `https://www.football-data.org/pricing` | 2026-04-29 | Football-only API with free plan and paid tiers for deeper data. |
| balldontlie | `https://www.balldontlie.io/docs` | 2026-04-29 | Basketball/NBA and other league APIs; docs list teams, players, games, stats, standings, betting odds, and player props. |
| SportsDataAPI | `https://sportsdataapi.com/` | 2026-04-29 | Multi-sport API product page claims football and basketball endpoints, free tier, and broad stats coverage. Must verify docs and terms before use. |

## Provider Overview

| Provider | Sports Covered | Official API Availability | Free Tier / Trial | Pricing Risk | Authentication | Terms / Legal Risk | Documentation Quality | Expected Reliability |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Sofascore | Public site shows football and basketball. | Not approved; Sofascore FAQ says it cannot share sports data sources as API endpoints. | Unknown. | Unknown. | Unknown. | High. | Low for official API use. | Unknown. |
| api-football.com / API-SPORTS | Football API; provider site also references other sports under API-Sports ecosystem. | Official football API appears available. | Free plan listed with 100 requests/day; exact current limits require verification. | Medium. | API key/dashboard. | Medium; verify terms. | Medium/High. | Medium/High pending sample testing. |
| apifootball.com | Football. | Public docs show action-based API usage. | Public pricing currently appears more usable for low/no-cost POC than the API-SPORTS free tier; exact current terms still require verification. | Low/Medium. | API key query parameter. | Medium; verify terms before production. | Medium; docs include response examples. | Unknown/Medium pending controlled sample testing. |
| Sportmonks | Football; other Sportmonks products may exist but this comparison uses football evidence only. | Official football API available. | 14-day trial documented; paid plans start at listed monthly prices. | Medium/High. | API token. | Medium; verify terms and selected-league licensing. | High. | High pending sample testing. |
| TheSportsDB | Multi-sport including football and basketball. | Official API available. | Free tier documented; premium tiers exist. | Low/Medium. | API key for some tiers/features. | Medium; crowd-sourced data quality/terms need review. | Medium. | Medium. |
| football-data.org | Football only. | Official API available. | Free plan documented. | Low/Medium. | API token. | Low/Medium; verify terms. | Medium. | Medium/High for supported competitions. |
| balldontlie | NBA, WNBA, NCAAB, football leagues, and other sports per docs landing page. | Official API available. | Pricing/free limits require verification per league/API. | Medium. | API key likely; verify current docs. | Medium; verify terms. | Medium/High. | Medium/High for NBA-style data pending sample testing. |
| SportsDataAPI | Multi-sport, including football, basketball, and NBA. | Official API product available. | Product page lists free 100 requests/day and paid plans; requires verification. | Medium. | API key/dashboard. | Medium; verify terms. | Medium; docs appear dashboard-hosted. | Unknown/Medium until tested. |

## MVP Operation Coverage

Legend: `yes` = documented support appears present, `partial` = likely but incomplete or sport-limited, `unknown` = not verified, `no` = not relevant or not observed. No entry means adapter-ready without sample evidence.

| Operation | Sofascore | api-football.com / API-SPORTS | apifootball.com | Sportmonks | TheSportsDB | football-data.org | balldontlie | SportsDataAPI |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `list_sports` | partial | partial | no dedicated endpoint; adapter injects football context | partial | yes | no | yes | yes |
| `list_countries` | unknown | yes | likely via `get_countries` | partial | unknown | unknown | unknown | yes |
| `list_competitions` | partial | yes | likely via `get_leagues` | yes | yes | yes | yes | yes |
| `list_seasons` | partial | yes | unknown/not in first POC | yes | yes | partial | yes | yes |
| `list_teams` | unknown | yes | likely via `get_teams`, logo evidence likely via `team_badge` | yes | yes | yes | yes | yes |
| `list_players` | unknown | yes | documented but out of POC | yes | yes | partial | yes | yes |
| `list_upcoming_matches` | unknown | yes | likely via `get_events` | yes | yes | yes | yes | yes |
| `list_finished_matches` | unknown | yes | likely via `get_events` | yes | yes | yes | yes | yes |
| `get_match_details` | unknown | yes | likely via `get_events&match_id=` | yes | partial | yes | yes | yes |
| `get_football_match_score` | unknown | yes | likely via `get_events` score fields | yes | partial | yes | yes for selected football leagues; verify | yes |
| `get_basketball_match_score` | unknown | unknown | no | no evidence in football docs | partial | no | yes | yes |
| `get_basketball_period_scores` | unknown | unknown | no | no evidence in football docs | unknown | no | yes for NBA-style APIs; verify | yes |
| `get_football_team_statistics` | unknown | yes | documented via statistics, not implemented in POC | yes | unknown | unknown/limited | partial for selected football leagues; verify | yes |
| `get_basketball_team_statistics` | unknown | unknown | no | no evidence in football docs | unknown | no | yes | yes |
| `get_football_standings` | unknown | yes | likely via `get_standings` | yes | partial | yes | yes for selected football leagues; verify | yes |
| `get_basketball_standings` | unknown | unknown | no | no evidence in football docs | unknown | no | yes | yes |

## Prediction Field Coverage

### Football

| Field | Sofascore | api-football.com / API-SPORTS | apifootball.com | Sportmonks | TheSportsDB | football-data.org | balldontlie | SportsDataAPI |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Fixtures | unknown | yes | likely via `get_events` | yes | yes | yes | yes for selected leagues; verify | yes |
| Scores | unknown | yes | likely via `get_events` | yes | yes | yes | yes for selected leagues; verify | yes |
| Halftime score | unknown | requires verification | likely via halftime fields | requires verification | requires verification | requires verification | requires verification | requires verification |
| Standings | unknown | yes | likely via `get_standings` | yes | limited/verify | yes | yes for selected leagues; verify | yes |
| Shots | unknown | yes/statistics listed; verify response | documented statistics, not POC implemented | yes/statistics documented; verify type coverage | unknown | unknown | unknown | yes/verify |
| Shots on target | unknown | yes/statistics listed; verify response | documented statistics, not POC implemented | yes/statistics documented; verify type coverage | unknown | unknown | unknown | yes/verify |
| Possession | unknown | yes/statistics listed; verify response | documented statistics, not POC implemented | yes/statistics documented; verify type coverage | unknown | unknown | unknown | yes/verify |
| Corners | unknown | yes/statistics listed; verify response | documented statistics, not POC implemented | yes/statistics documented; verify type coverage | unknown | unknown | unknown | yes/verify |
| Cards | unknown | yes/events/statistics listed; verify response | event details likely raw-only for now | yes/events/statistics documented; verify type coverage | unknown | yes in paid deep-data tier | unknown | yes/verify |
| Fouls | unknown | yes/statistics listed; verify response | documented statistics, not POC implemented | yes/statistics documented; verify type coverage | unknown | unknown | unknown | yes/verify |
| xG | unknown | unknown | unknown | unknown/possibly advanced; verify | unknown | unknown | unknown | unknown/verify |
| Lineups | unknown | yes | documented but out of POC | yes | unknown | paid deep-data tier lists line-ups/subs | unknown | yes/verify |
| Player stats | unknown | yes | documented but out of POC | yes | yes/verify | squads/player data; match stats require verification | yes for selected leagues; verify | yes |

### Basketball

| Field | Sofascore | api-football.com / API-SPORTS | apifootball.com | Sportmonks | TheSportsDB | football-data.org | balldontlie | SportsDataAPI |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Fixtures | unknown | no football-only evidence | no basketball evidence | no football-doc evidence | yes/verify | no | yes | yes |
| Final score | unknown | no football-only evidence | no basketball evidence | no football-doc evidence | yes/verify | no | yes | yes |
| Quarter scores | unknown | no football-only evidence | no basketball evidence | no football-doc evidence | unknown | no | yes/verify | yes |
| Standings | unknown | no football-only evidence | no basketball evidence | no football-doc evidence | unknown/verify | no | yes | yes |
| Team box score | unknown | no football-only evidence | no basketball evidence | no football-doc evidence | unknown | no | yes | yes |
| FG% | unknown | no football-only evidence | no basketball evidence | no football-doc evidence | unknown | no | yes/verify response | yes/verify |
| 3P% | unknown | no football-only evidence | no basketball evidence | no football-doc evidence | unknown | no | yes/verify response | yes/verify |
| FT% | unknown | no football-only evidence | no basketball evidence | no football-doc evidence | unknown | no | yes/verify response | yes/verify |
| Rebounds | unknown | no football-only evidence | no basketball evidence | no football-doc evidence | unknown | no | yes | yes |
| Assists | unknown | no football-only evidence | no basketball evidence | no football-doc evidence | unknown | no | yes | yes |
| Turnovers | unknown | no football-only evidence | no basketball evidence | no football-doc evidence | unknown | no | yes | yes |
| Fouls | unknown | no football-only evidence | no basketball evidence | no football-doc evidence | unknown | no | yes/verify response | yes/verify |
| Player box score | unknown | no football-only evidence | no basketball evidence | no football-doc evidence | unknown | no | yes | yes |

## Risk Matrix

| Provider | Technical Risk | Legal/Terms Risk | Data Completeness Risk | Cost Risk | Lock-in Risk | Implementation Complexity |
| --- | --- | --- | --- | --- | --- | --- |
| Sofascore | high | high | high | unknown | high | high |
| api-football.com / API-SPORTS | medium | medium | medium | medium | medium | medium |
| apifootball.com | medium | medium | medium | low/medium | medium | low/medium |
| Sportmonks | low/medium | medium | low/medium for selected football leagues | medium/high | medium | medium |
| TheSportsDB | medium | medium | medium/high for prediction-grade stats | low/medium | low | low/medium |
| football-data.org | low/medium | low/medium | medium/high for advanced stats and basketball | low/medium | low | low |
| balldontlie | low/medium | medium | low/medium for NBA, high for global basketball | medium | medium | low/medium |
| SportsDataAPI | medium | medium | unknown/medium until samples verified | medium | medium | medium |

## Recommendation

Best first implementation candidate:

- apifootball.com for the first controlled low/no-cost football POC, starting with countries, leagues, teams, events/scores, and standings.
- api-football.com / API-SPORTS remains historical evidence but is not preferred now because its free tier is too limited for production ingestion.
- Sportmonks if higher documentation quality and professional football coverage are more important than cost, and selected-league limits are acceptable.

Provider evidence tracking:

- `docs/providers/apifootball-com-field-evidence.md`
- `docs/providers/api-football-field-evidence.md`

Best provider for football:

- Sportmonks appears strongest for professional football depth and documentation.
- apifootball.com is the current low/no-cost POC candidate.
- api-football.com / API-SPORTS appears attractive for breadth but is deferred due free-tier limits.
- football-data.org is a strong lightweight fallback for fixtures, scores, and standings, but likely insufficient for full prediction-stat coverage.

Best provider for basketball:

- balldontlie appears strongest for NBA-style teams, players, games, stats, and standings.
- SportsDataAPI appears promising for broader basketball coverage, but requires manual verification of docs, terms, and sample responses.

Sofascore position:

- Keep Sofascore research-only unless official/approved access, stable response evidence, and terms review are available.

Multi-provider strategy:

- Do not require multiple providers for the first adapter.
- Preserve provider-agnostic DTOs, provider mappings, raw payload capture, and adapter registry so a second provider can be added later.
- Avoid schema or feature decisions that assume a single provider's response shape.

Provider naming warning:

- `api-football.com / API-SPORTS` and `apifootball.com` are separate providers. Do not mix endpoint names, pricing, request format, or field evidence.

Safest first adapter slice:

1. For apifootball.com POC: countries and leagues first, then teams only with logo evidence, then finished fixtures/scores, then standings.
2. Finished matches and score summaries.
3. Standings.
4. Team statistics only after sample responses prove field availability and validation behavior.

## Adapter Gate Impact

Closest to adapter-ready:

- apifootball.com for football POC operations, with production gate still blocked.
- api-football.com / API-SPORTS for football static and P0 match/standing/stat operations, pending sample response evidence, terms review, and cost viability.
- Sportmonks for football static and P0/P1 operations, pending paid/trial account viability and sample response evidence.
- balldontlie for basketball/NBA operations, pending sample response evidence and coverage decision.

Evidence still missing:

- Actual provider sample responses mapped to `ProviderSport`, `ProviderCountry`, `ProviderCompetition`, and `ProviderSeason`.
- Exact field-level mapping for score/stat/standing DTOs.
- Rate-limit and retry behavior per selected plan.
- Terms review for production use.
- Confirmation that no provider-specific IDs leak into public APIs.
