# Sofascore Field Evidence

## Purpose

Sofascore is a candidate source only. This document is an evidence capture worksheet and does not confirm that Sofascore exposes any field through an official or stable API.

Do not mark a field `confirmed` without reviewed sample response evidence. Do not build a Sofascore adapter from assumptions in this file.

Current strategy update: Sofascore is the preferred no-paid-cost candidate for now because paid providers are deferred, but it remains evidence-gated and not adapter-ready. The static/team-logo capture plan lives in `docs/providers/sofascore-static-evidence-plan.md`.

## Reviewed Sources

| Source | Reviewed Date | Evidence Use | Notes |
| --- | --- | --- | --- |
| `https://sofascore.helpscoutdocs.com/article/129-does-sofascore-offer-sports-data-api` | 2026-04-29 | Legal/operational risk and API availability note. | Sofascore states it cannot share sports data sources as API endpoints due to data-provider agreements. This is a production-readiness risk, not legal advice. |
| `https://www.sofascore.com/categories` | 2026-04-29 | Public website sport and featured competition names. | Page shows football and basketball as public sports and lists featured football/basketball competitions, but does not provide DTO-ready IDs. |
| `https://api.sofascore.com/api/v1/unique-tournament/17/seasons` | 2026-04-29 | Sample season response shape for one known football tournament. | Undocumented endpoint returned a `seasons` array with season `id`, `name`, `year`, and `editor`; this is partial evidence only and not adapter approval. |

## Evidence Status Labels

| Status | Meaning |
| --- | --- |
| `confirmed` | Reviewed sample response evidence confirms the field exists and maps cleanly. |
| `likely` | Evidence suggests availability, but more samples are needed. |
| `unknown` | No reviewed evidence yet. |
| `unavailable` | Reviewed evidence indicates the field is not available. |
| `blocked` | Research is blocked by access, legal/terms, auth, rate-limit, or operational concerns. |
| `raw_only` | Field exists or may exist, but should not be normalized yet. |

## Football Evidence

| Field Group | Desired Fields | Evidence Status | Sample Source/Endpoint Placeholder | Target DTO | Target Table | Priority | Timing | Storage Decision | Notes/Risks |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Static entities | sport ID/name, country ID/name/code, competition ID/name, season ID/name | `unknown` | TBD | `ProviderSport`, `ProviderCountry`, `ProviderCompetition`, `ProviderSeason` | `sports`, `countries`, `competitions`, `seasons` | P0 | static | normalized if confirmed | Foundational dependency for all other operations. |
| Fixtures/upcoming matches | match ID, competition, season, home team, away team, scheduled start, status | `unknown` | TBD | `ProviderMatch` | `matches` | P0 | pre-match | normalized if confirmed | Must avoid live-score polling behavior. |
| Finished matches | match ID, teams, competition, scheduled start, finished status, winner if available | `unknown` | TBD | `ProviderMatch` | `matches` | P0 | post-match | normalized if confirmed | Finished data is safer than live data. |
| Match details | round, stage, venue, referee, neutral ground, attendance, metadata | `unknown` | TBD | `ProviderMatch` | `matches` | P0/P1 | pre-match/post-match | normalized or metadata if confirmed | Common match context only; no sport-specific stats here. |
| Football scores | current, halftime, fulltime, extra-time, penalties, winner | `unknown` | TBD | `ProviderFootballMatchScore` | `football_match_scores` | P0 | post-match | normalized if confirmed | Score rows require existing match mapping. |
| Football team statistics | shots, shots on target, possession, corners, fouls, cards, big chances, xG, attacks | `unknown` | TBD | `ProviderFootballMatchTeamStatistics` | `football_match_team_statistics` | P0/P1 | post-match | normalized if confirmed | Availability may vary by league. |
| Football standings | position, played, wins, draws, losses, goals for/against, goal difference, points, form | `unknown` | TBD | `ProviderFootballStanding` | `football_standings` | P0 | periodic | normalized if confirmed | Requires competition and team mappings. |
| Football events | goals, cards, substitutions, penalties, event minute, player/team references | `unknown` | TBD | future DTO | future `football_match_events` | P1 | post-match | future/raw-only | No event normalizer exists yet. |
| Football lineups | starters, bench, formation, shirt number, role, position | `unknown` | TBD | future DTO | future `football_lineups` | P1 | pre-match/post-match | future/raw-only | Pre-match availability may be inconsistent. |
| Football player match statistics | minutes, rating, goals, assists, cards, shots, passes | `unknown` | TBD | future DTO | future `football_player_match_statistics` | P1/P2 | post-match | future/raw-only | Requires stable player mappings. |
| Football shot maps | shot coordinates, xG per shot, body part, shot result, minute | `unknown` | TBD | future DTO | future `football_shot_maps` | P1/P2 | post-match | future/raw-only | Coordinate system and volume need review. |
| Injuries/missing players | player ID, absence reason, injury/suspension status, expected return | `unknown` | TBD | future DTO | future availability/lineup table | P1 | pre-match | future/raw-only | Often provider-specific and legally/operationally sensitive. |
| Head-to-head | prior meetings, dates, scores, competition, venue/home-away context | `unknown` | TBD | future feature input | future `football_head_to_head_features` inputs | P1 | pre-match | raw then derived | Feature builder should compute final values. |
| Referee/venue | referee name/ID if available, venue name, city/stadium context | `unknown` | TBD | `ProviderMatch` | `matches` | P1 | pre-match/post-match | normalized if confirmed | Existing match DTO supports generic fields. |

## Static Discovery Evidence

| Operation | Evidence Status | Sample Source/Endpoint Placeholder | Observed Response Shape Summary | Required Fields For DTO | Fields Confirmed | Fields Missing Or Unverified | Target DTO | Target Normalizer | Target Table | Priority | Implementation Readiness | Risks/Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `list_sports` | `likely` | `https://www.sofascore.com/categories` | Public page lists sport navigation entries including Football and Basketball. | `providerEntityId`, `name`; optional `slug`, `metadata`. | Sport names `Football` and `Basketball` are publicly visible. | Provider sport IDs are not confirmed from reviewed evidence. DTO-ready slug/source structure is not confirmed. | `ProviderSport` | `SportNormalizer` | `sports` | P0 | research_more | Good directional evidence for sport coverage, but not a confirmed API response. |
| `list_countries` | `unknown` | TBD | No reviewed static country/category list response captured for this slice. | `providerEntityId`, `name`; optional `code`, `slug`, `metadata`. | None. | Provider country/category IDs, names, ISO/code fields, and country-to-competition mapping are unverified. | `ProviderCountry` | `CountryNormalizer` | `countries` | P0 | research_more | Do not use requester geolocation responses as a canonical country list. |
| `list_competitions` | `likely` | `https://www.sofascore.com/categories` | Public page lists featured football competitions such as UEFA Champions League, FIFA World Cup, Premier League, Serie A, LaLiga, and Bundesliga; basketball examples include NBA, Euroleague, Liga ACB, Lega A Basket, and Turkish Basketball Super League. | `providerEntityId`, `sportProviderId`, `name`; optional `countryProviderId`, `slug`, `gender`, `level`, `metadata`. | Competition names are publicly visible. | Provider competition IDs, sport/category references, country/category references, slug, gender, and level are not confirmed from reviewed evidence. | `ProviderCompetition` | `CompetitionNormalizer` | `competitions` | P0 | research_more | Names alone are not enough for canonical normalization or provider mappings. |
| `list_seasons` | `likely` | `https://api.sofascore.com/api/v1/unique-tournament/17/seasons` | Undocumented JSON response returned a `seasons` array. Items observed with `id`, `name`, `year`, `editor`, and sometimes `seasonCoverageInfo`. | `providerEntityId`, `competitionProviderId`, `name`; optional `startDate`, `endDate`, `isCurrent`, `metadata`. | Season `id`, `name`, and `year` observed for one football tournament. Competition provider ID can be inferred from the endpoint path for the sample, but is not present inside each item. | Basketball season coverage unverified. Current-season flag, start/end dates, and stable endpoint policy unverified. | `ProviderSeason` | `SeasonNormalizer` | `seasons` | P0 | research_more | Partial sample evidence only. Endpoint is undocumented and must pass legal/terms and stability review before adapter work. |

## Static + Team Logo Evidence Gate

Sofascore static/team evidence must be captured through `docs/providers/sofascore-static-evidence-plan.md`.

| Evidence Area | Evidence Status | Readiness | Notes |
| --- | --- | --- | --- |
| Sports | `likely` for public names; IDs unknown | research_more | Need structured provider sport IDs or approved stable keys. |
| Categories/countries | `unknown` | research_more | Need stable category/country IDs and names. |
| Football competitions/tournaments | `likely` for public names; IDs unknown | research_more | Need stable tournament IDs and sport/category references. |
| Basketball competitions/tournaments | `likely` for public names; IDs unknown | research_more | Need basketball-specific competition evidence. |
| Seasons | `likely` for one football sample only | research_more | Need stability review and basketball evidence. |
| Football teams | `unknown` | research_more | Need team ID/name/sport/category/logo evidence. |
| Basketball teams | `unknown` | research_more | Need team ID/name/sport/category/logo evidence. |
| Team logos | `unknown` | research_more | Required for team adapter readiness; map to `ProviderTeam.logoUrl` and `teams.logo_url`. |

Team logo acceptance:

- Team adapter is not ready unless logo availability is confirmed or explicitly marked unavailable.
- Missing individual logos should be non-fatal.
- Missing logos must be logged or marked by future adapter mapping.
- Logo fields must not be discarded into metadata when `teams.logo_url` exists.

## Static DTO Mapping

### ProviderSport

| DTO Field | Required | Sofascore Evidence | Transformation Needed | Unresolved Questions |
| --- | --- | --- | --- | --- |
| `providerEntityId` | yes | `unknown` | Need stable provider sport key such as `football`/`basketball` only if confirmed. | Are sport identifiers stable and acceptable from a reviewed source? |
| `name` | yes | `likely`; public page shows Football and Basketball. | Preserve as display name. | Is there a structured source for all supported sports? |
| `slug` | no | `unknown` | Derive only if source slug is confirmed or use normalized name as fallback. | Does Sofascore expose a canonical slug? |
| `metadata` | no | `unknown` | Store only provider-agnostic metadata if needed. | What sport metadata is stable enough to retain? |

### ProviderCountry

| DTO Field | Required | Sofascore Evidence | Transformation Needed | Unresolved Questions |
| --- | --- | --- | --- | --- |
| `providerEntityId` | yes | `unknown` | None until category/country evidence exists. | Is the country/category ID stable across sports? |
| `name` | yes | `unknown` | None until category/country evidence exists. | Are country names available in static competition/category responses? |
| `code` | no | `unknown` | Normalize ISO/code only if provided by a static source. | Are ISO country codes exposed? |
| `slug` | no | `unknown` | Derive from name only if code is unavailable and name is confirmed. | Are slugs available? |
| `metadata` | no | `unknown` | Store only provider-agnostic category metadata if safe. | Does category metadata contain provider-specific details that should remain raw-only? |

### ProviderCompetition

| DTO Field | Required | Sofascore Evidence | Transformation Needed | Unresolved Questions |
| --- | --- | --- | --- | --- |
| `providerEntityId` | yes | `unknown` from reviewed static competition evidence. | Need stable tournament/competition ID before adapter work. | Are IDs available from a reviewed static source for football and basketball? |
| `sportProviderId` | yes | `unknown` | Map from reviewed sport context only. | Can a competition response identify sport without relying on URL path? |
| `countryProviderId` | no | `unknown` | Map category/country reference only when confirmed. | Are competitions grouped by country/category with stable IDs? |
| `name` | yes | `likely`; public page shows featured competition names. | Preserve as competition name. | Are names complete enough beyond featured competitions? |
| `slug` | no | `unknown` | Use source slug only if confirmed. | Are slugs stable? |
| `gender` | no | `unknown` | Store only generic gender if exposed. | Is gender available for competitions? |
| `level` | no | `unknown` | Store only generic level/type if exposed. | Is level/type available without provider-specific semantics? |
| `metadata` | no | `unknown` | Store only provider-agnostic metadata. | Which extra fields should remain raw-only? |

### ProviderSeason

| DTO Field | Required | Sofascore Evidence | Transformation Needed | Unresolved Questions |
| --- | --- | --- | --- | --- |
| `providerEntityId` | yes | `likely`; sample item includes numeric `id`. | Convert numeric ID to string. | Is ID stable across all tournament season endpoints? |
| `competitionProviderId` | yes | `likely` for sampled endpoint path only. | Inject from requested tournament/competition ID if endpoint is approved. | Should this be accepted when not present inside each item? |
| `name` | yes | `likely`; sample item includes `name`. | Preserve source name. | Are basketball season names shaped the same way? |
| `startDate` | no | `unknown` | Do not infer from `year`. | Are exact start dates available elsewhere? |
| `endDate` | no | `unknown` | Do not infer from `year`. | Are exact end dates available elsewhere? |
| `isCurrent` | no | `unknown` | Do not infer without explicit evidence. | Is a current-season flag available in a stable field? |
| `metadata` | no | `likely`; sample item includes `year`, `editor`, and sometimes `seasonCoverageInfo`. | Store only provider-agnostic fields if approved. | Should `editor` remain raw-only? |

## Basketball Evidence

| Field Group | Desired Fields | Evidence Status | Sample Source/Endpoint Placeholder | Target DTO | Target Table | Priority | Timing | Storage Decision | Notes/Risks |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Static entities | sport ID/name, country ID/name/code, competition ID/name, season ID/name | `unknown` | TBD | `ProviderSport`, `ProviderCountry`, `ProviderCompetition`, `ProviderSeason` | `sports`, `countries`, `competitions`, `seasons` | P0 | static | normalized if confirmed | Foundational dependency for all other operations. |
| Fixtures/upcoming matches | match ID, competition, season, home team, away team, scheduled start, status | `unknown` | TBD | `ProviderMatch` | `matches` | P0 | pre-match | normalized if confirmed | Must avoid live-score polling behavior. |
| Finished matches | match ID, teams, competition, scheduled start, finished status, winner if available | `unknown` | TBD | `ProviderMatch` | `matches` | P0 | post-match | normalized if confirmed | Finished data is safer than live data. |
| Match details | round, stage, venue, attendance, neutral ground, metadata | `unknown` | TBD | `ProviderMatch` | `matches` | P0/P1 | pre-match/post-match | normalized or metadata if confirmed | Common match context only. |
| Basketball scores | current, final, halftime, overtime, winner | `unknown` | TBD | `ProviderBasketballMatchScore` | `basketball_match_scores` | P0 | post-match | normalized if confirmed | Score rows require existing match mapping. |
| Basketball period scores | q1, q2, q3, q4, overtime period scores | `unknown` | TBD | `ProviderBasketballPeriodScore` | `basketball_period_scores` | P0 | post-match | normalized if confirmed | Overtime numbering must be verified. |
| Basketball team statistics | shooting splits, rebounds, assists, turnovers, fouls, paint points, bench points | `unknown` | TBD | `ProviderBasketballTeamMatchStatistics` | `basketball_team_match_statistics` | P0/P1 | post-match | normalized if confirmed | Percentage convention is `0..100`. |
| Basketball standings | position, played, wins, losses, win percentage, points for/against, conference/division | `unknown` | TBD | `ProviderBasketballStanding` | `basketball_standings` | P0 | periodic | normalized if confirmed | Requires competition and team mappings. |
| Basketball player box scores | minutes, points, rebounds, assists, steals, blocks, turnovers, fouls, plus-minus | `unknown` | TBD | future DTO | future `basketball_player_box_scores` | P1 | post-match | future/raw-only | No box-score normalizer exists yet. |
| Rosters/starters | active roster, starters, bench, availability, role | `unknown` | TBD | future DTO | future `basketball_rosters` | P1 | pre-match/post-match | future/raw-only | Pre-match starter availability may be inconsistent. |
| Injuries/missing players | player ID, injury/suspension status, absence reason, expected return | `unknown` | TBD | future DTO | future roster/availability table | P1 | pre-match | future/raw-only | Often incomplete and provider-specific. |
| Head-to-head | prior meetings, dates, scores, competition, venue/home-away context | `unknown` | TBD | future feature input | future `basketball_head_to_head_features` inputs | P1 | pre-match | raw then derived | Feature builder should compute final values. |

## Sofascore Decision Log

| Date | Decision | Evidence Link/Source | Reviewer | Notes |
| --- | --- | --- | --- | --- |
| 2026-04-29 | Static slice decision: `research_more`. | Sources listed in Reviewed Sources. | Codex | Partial public evidence exists for sports, featured competition names, and one football season endpoint. Required DTO mapping is not complete enough for adapter implementation. |
