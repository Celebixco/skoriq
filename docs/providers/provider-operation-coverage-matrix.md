# Provider Operation Coverage Matrix

## Purpose

This matrix compares current and future provider operations against application support and evidence readiness. Evidence status must be updated from provider-specific evidence documents before any adapter implementation.

Status labels: `confirmed`, `likely`, `unknown`, `unavailable`, `blocked`, `raw_only`.

## MVP Operations

| Operation | Current App Support | Required Provider Fields | Evidence Status | Target DTO | Target Table | Priority | Adapter Readiness |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `list_sports` | Adapter shell + normalizer | provider sport ID, name, slug/code when available | `likely` for public sport names; IDs unconfirmed | `ProviderSport` | `sports` | P0 | research more |
| `list_countries` | Adapter shell + normalizer | provider country ID, name, code/slug when available | `unknown` | `ProviderCountry` | `countries` | P0 | research more |
| `list_competitions` | Adapter shell + normalizer | provider competition ID, sport provider ID, optional country provider ID, name | `likely` for public featured competition names; IDs/context unconfirmed | `ProviderCompetition` | `competitions` | P0 | research more |
| `list_seasons` | Adapter shell + normalizer | provider season ID, competition provider ID, name, optional dates/current flag | `likely` for one football tournament season list sample; incomplete | `ProviderSeason` | `seasons` | P0 | research more |
| `list_teams` | Adapter shell + normalizer | provider team ID, sport provider ID, name, logo URL evidence, optional country provider ID/profile fields | `unknown` | `ProviderTeam` | `teams` | P0 | research more |
| `list_players` | Adapter shell + normalizer | provider player ID, sport provider ID, name, optional team/country/profile fields | `unknown` | `ProviderPlayer` | `players` | P1 | research more |
| `list_upcoming_matches` | Adapter shell + normalizer | provider match ID, competition, home/away teams, scheduled start, status | `unknown` | `ProviderMatch` | `matches` | P0 | research more |
| `list_finished_matches` | Adapter shell + normalizer | provider match ID, competition, home/away teams, scheduled start, finished status | `unknown` | `ProviderMatch` | `matches` | P0 | research more |
| `get_match_details` | Adapter shell + normalizer | provider match ID, context fields, optional venue/referee/winner/metadata | `unknown` | `ProviderMatch` | `matches` | P0 | research more |
| `get_football_match_score` | Adapter shell + normalizer | match provider ID, halftime/fulltime/current scores, optional extra-time/penalties/winner | `unknown` | `ProviderFootballMatchScore` | `football_match_scores` | P0 | research more |
| `get_basketball_match_score` | Adapter shell + normalizer | match provider ID, final/current/halftime/overtime scores, optional winner | `unknown` | `ProviderBasketballMatchScore` | `basketball_match_scores` | P0 | research more |
| `get_basketball_period_scores` | Adapter shell + normalizer | match provider ID, period number/type, optional overtime number, home/away score | `unknown` | `ProviderBasketballPeriodScore` | `basketball_period_scores` | P0 | research more |
| `get_football_team_statistics` | Adapter shell + normalizer | match provider ID, team provider ID, football team-stat fields | `unknown` | `ProviderFootballMatchTeamStatistics` | `football_match_team_statistics` | P0/P1 | research more |
| `get_basketball_team_statistics` | Adapter shell + normalizer | match provider ID, team provider ID, basketball team-stat fields | `unknown` | `ProviderBasketballTeamMatchStatistics` | `basketball_team_match_statistics` | P0/P1 | research more |
| `get_football_standings` | Adapter shell + normalizer | competition provider ID, optional season provider ID, team provider ID, football table fields | `unknown` | `ProviderFootballStanding` | `football_standings` | P0 | research more |
| `get_basketball_standings` | Adapter shell + normalizer | competition provider ID, optional season provider ID, team provider ID, basketball table fields | `unknown` | `ProviderBasketballStanding` | `basketball_standings` | P0 | research more |

## Future Operations

| Operation | Current App Support | Required Provider Fields | Evidence Status | Target DTO | Target Table | Priority | Adapter Readiness |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `get_football_events` | Not implemented | match/team/player references, event type, minute, event metadata | `unknown` | future DTO | future `football_match_events` | P1 | blocked |
| `get_football_lineups` | Not implemented | match/team/player references, starters, bench, formation, missing players | `unknown` | future DTO | future `football_lineups` | P1 | blocked |
| `get_basketball_player_box_scores` | Not implemented | match/team/player references, minutes, points, rebounds, assists, plus-minus, fouls | `unknown` | future DTO | future `basketball_player_box_scores` | P1 | blocked |
| `get_rosters` | Not implemented | team/player references, starter/bench/availability/role context | `unknown` | future DTO | future roster tables | P1 | blocked |

## Readiness Rules

- `research more`: sample evidence is missing or incomplete.
- `blocked`: application schema/normalizer support is missing or legal/operational concerns block implementation.
- `build shell`: operation can be represented in the adapter shell but should not fetch real data yet.
- `build adapter`: all adapter implementation gate requirements are satisfied.

## Candidate Provider Signals

These signals are planning guidance only. They do not make any operation adapter-ready without sample response evidence and the adapter implementation gate.

| Provider | Strongest Apparent Fit | Static Operations | Scores | Team Statistics | Standings | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Sofascore | Preferred no-paid-cost candidate for now, still evidence-gated. | partial/unknown | unknown | unknown | unknown | API contract is unconfirmed; static/team-logo evidence must pass before adapter work. |
| api-football.com / API-SPORTS | Historical football API candidate. | likely | likely football | likely football | likely football | Different provider from apifootball.com; deferred because free tier is too limited for current production-ingestion goals. |
| apifootball.com | Current low/no-cost football POC candidate. | POC implemented for countries/leagues/teams | POC implemented for football events/scores | documented but not implemented in POC | POC implemented | Adapter is disabled by default, production-blocked, and not wired to schedulers or ingestion jobs. |
| Sportmonks | Football depth and documentation candidate. | likely | likely football | likely football | likely football | Docs/product pages show fixture, league, standings, team/player, event, lineup, and statistics coverage; cost and selected-league limits require verification. |
| TheSportsDB | Low-cost multi-sport metadata/results candidate. | likely | partial | unknown | partial | Good lightweight candidate, but prediction-grade team statistics require verification. |
| football-data.org | Lightweight football fixtures/scores/standings candidate. | partial football | likely football | unknown/limited | likely football | Football-only; advanced stats and basketball are not a fit. |
| balldontlie | Basketball/NBA data candidate. | likely basketball | likely basketball | likely basketball | likely basketball | Strong basketball/NBA signal; international basketball coverage and pricing need verification. |
| SportsDataAPI | Multi-sport football/basketball candidate. | likely | likely | likely | likely | Promising breadth, but docs/terms/sample responses need manual verification before any adapter work. |

## API-Football Evidence Candidate

API-Football here means `api-football.com / API-SPORTS`, not `apifootball.com`. This provider is deferred due free-tier limitations. Evidence details live in `docs/providers/api-football-field-evidence.md`.

| Operation | API-Football Evidence Status | Adapter Readiness | Notes |
| --- | --- | --- | --- |
| `list_countries` | `likely` endpoint family; no sample response captured | research more | Required before competition mapping. |
| `list_competitions` | `likely` via leagues endpoint family; no sample response captured | research more | Must map league ID, name, sport, and optional country. |
| `list_seasons` | `likely` endpoint family; no sample response captured | research more | Must define season provider ID convention. |
| `list_teams` | `likely` endpoint family; no sample response captured | research more | Requires sport mapping policy and logo URL evidence; missing individual logos should be tracked but not ingestion-blocking. |
| `list_upcoming_matches` | `likely` fixtures endpoint family; no sample response captured | research more | No live polling; moderate pre-match refresh only. |
| `list_finished_matches` | `likely` fixtures endpoint family; no sample response captured | research more | Safer first match slice after static dependencies. |
| `get_football_match_score` | `likely` via fixture score fields; no sample response captured | research more | Must not create match rows from score normalizer. |
| `get_football_standings` | `likely` endpoint family; no sample response captured | research more | Requires competition/team mappings. |
| `get_football_team_statistics` | `likely` endpoint family; no sample response captured | research more | Needs sample-driven statistic-name mapping. |

## apifootball.com POC Candidate

apifootball.com is the current controlled low/no-cost football POC candidate. Evidence and implementation notes live in `docs/providers/apifootball-com-field-evidence.md`.

| Operation | apifootball.com Evidence / Implementation Status | Adapter Readiness | Notes |
| --- | --- | --- | --- |
| `list_countries` | POC adapter maps `get_countries` to `ProviderCountry` | local POC only | No production ingestion; API key env-only. |
| `list_competitions` | POC adapter maps `get_leagues` to `ProviderCompetition` | local POC only | Football sport context is adapter-injected as `football`. |
| `list_teams` | POC adapter maps `get_teams` to `ProviderTeam`; logo candidates map to `logoUrl` | local POC only | Team logo evidence still needs real sanitized sample confirmation. |
| `list_upcoming_matches` | POC adapter maps `get_events` to `ProviderMatch` | local POC only | No live polling; stable team IDs required. |
| `list_finished_matches` | POC adapter maps `get_events` to `ProviderMatch` | local POC only | Safer first match slice after static dependencies. |
| `get_match_details` | POC adapter maps `get_events&match_id=` to `ProviderMatch` | local POC only | Rows with team names only are unresolved. |
| `get_football_match_score` | POC adapter maps `get_events` score fields to `ProviderFootballMatchScore` | local POC only | Score normalizer still requires existing match mapping. |
| `get_football_standings` | POC adapter maps `get_standings` to `ProviderFootballStanding` | local POC only | Rows without stable `team_id` are unresolved. |
| `get_football_team_statistics` | Public docs indicate statistics endpoint, but POC does not implement it | research more | Keep out of first adapter slice. |

Manual ingestion readiness is separate from POC implementation. The adapter can make controlled local calls, but none of these operations are `ready_for_manual_ingestion` until samples are captured and reviewed with `docs/providers/apifootball-com-sample-review-workflow.md`.

| Operation | POC Mapper Status | Sample Review Status | Manual Ingestion Readiness | Required Evidence Before Manual Ingestion |
| --- | --- | --- | --- | --- |
| `list_countries` | implemented | auth-blocked sample reviewed; no fields confirmed | not ready | Sanitized successful `get_countries` sample confirms stable `country_id` and `country_name`. |
| `list_competitions` | implemented | auth-blocked sample reviewed; no fields confirmed | not ready | Sanitized successful `get_leagues` sample confirms stable `league_id`, `league_name`, and country context when present. |
| `list_teams` | implemented | not reviewed | not ready | Sanitized `get_teams` sample confirms stable team ID, team name, logo field behavior, and missing-logo policy. |
| `list_upcoming_matches` | implemented | not reviewed | not ready | Sanitized `get_events` sample confirms match identity, competition identity, scheduled time, status, and stable home/away team IDs. |
| `list_finished_matches` | implemented | not reviewed | not ready | Sanitized finished `get_events` sample confirms final status, final score fields, and stable team IDs. |
| `get_match_details` | implemented | not reviewed | not ready | Match-specific sample confirms same identity fields and optional context fields without requiring live behavior. |
| `get_football_match_score` | implemented | not reviewed | not ready | Finished event sample confirms fulltime/current, halftime, extra-time, penalty, and status mapping behavior. |
| `get_football_standings` | implemented | not reviewed | not ready | Sanitized `get_standings` sample confirms stable `team_id`; otherwise standings normalization remains blocked/raw-only. |

## Sofascore No-Paid-Cost Evidence Candidate

Sofascore is the preferred no-paid-cost candidate while paid providers are deferred. This does not make Sofascore adapter-ready. Static and logo evidence details live in `docs/providers/sofascore-static-evidence-plan.md`.

| Operation | Sofascore Evidence Status | Adapter Readiness | Notes |
| --- | --- | --- | --- |
| `list_sports` | `likely` for public sport names; provider IDs unconfirmed | research more | Need structured sport IDs or approved stable keys. |
| `list_countries` | `unknown` for categories/countries | research more | Need category/country list source and mapping policy. |
| `list_competitions` | `likely` for public featured competition names; IDs/context unconfirmed | research more | Football and basketball competitions must be evidenced separately. |
| `list_seasons` | `likely` from one undocumented football season sample; incomplete | research more | Need stability review, basketball evidence, and current/date policy. |
| `list_teams` | `unknown` | research more | Football and basketball team samples must confirm logo availability or explicit unavailability. |
