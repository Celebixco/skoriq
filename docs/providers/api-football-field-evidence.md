# API-Football Field Evidence

## Purpose

API-Football is the current first football provider candidate for evidence capture. This document prepares the adapter implementation gate by defining the first evidence scope, operation mapping, DTO mapping, sample-response slots, and future test plan.

This is documentation only. It does not implement an API-Football adapter, add HTTP fetching, add API keys, schedule jobs, ingest data, write to a database, modify schema, add normalizers, add prediction logic, or introduce live-score behavior.

Manual sanitized sample capture must use `docs/providers/api-football-sample-capture-checklist.md`. No field in this document should move to `confirmed` until that checklist has a sanitized sample and mapping decision.

## Provider Overview

| Field | Evidence |
| --- | --- |
| Official API availability | Likely. API-Football has provider-facing pricing/docs pages and lists football endpoint families. |
| Free plan suitability | Likely suitable for MVP verification only. Public pricing evidence listed a free plan and request limits at review time, but current plan limits must be manually verified before implementation. |
| Quota limitation risk | Medium. Free/low-tier quotas may be enough for sample evidence, but production sync volume requires separate sizing. |
| Authentication | API key/dashboard expected. Do not store API keys, private headers, cookies, or session data in this repo. |
| Endpoint documentation requirement | Required before adapter implementation. Each endpoint must have a sanitized sample response mapped to DTO fields. |
| Terms/legal risk note | Medium until reviewed. Terms and production usage rights must be reviewed before real adapter work. This is not legal advice. |
| Why better first football candidate than Sofascore | API-Football appears to offer an official football API and public endpoint-family documentation, while Sofascore remains research-only with unresolved API/terms concerns. |

## Evidence Status Labels

| Status | Meaning |
| --- | --- |
| `confirmed` | Sanitized sample response evidence confirms the field exists and maps cleanly. |
| `likely` | Provider-facing docs/pricing pages list the endpoint family or field family, but no sample response has been mapped yet. |
| `unknown` | No reviewed evidence yet. |
| `unavailable` | Reviewed evidence indicates the field is not available. |
| `blocked` | Research is blocked by access, auth, quota, terms, or operational concerns. |
| `raw_only` | Field exists or may exist, but should not be normalized yet. |

## First Evidence Scope

In scope:

- Countries.
- Seasons.
- Leagues and competitions.
- Teams.
- Upcoming and finished fixtures.
- Fixture scores.
- Standings.
- Fixture team statistics.

Out of scope for this evidence slice:

- Live-score implementation.
- Odds.
- Predictions endpoint.
- Lineups.
- Injuries.
- Events.
- Player statistics.
- Transfers.
- Advanced features.

## Operation Mapping

| App Operation | API-Football Concept | Expected Source Endpoint Placeholder | Required Request Params | Target DTO | Target Normalizer | Target Table | Priority | Timing | Evidence Status | Readiness |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `list_countries` | Countries | `/countries` | none or provider-supported filters; verify | `ProviderCountry` | `CountryNormalizer` | `countries` | P0 | static | `likely` | research_more |
| `list_competitions` | Leagues | `/leagues` | optional country/season filters; verify | `ProviderCompetition` | `CompetitionNormalizer` | `competitions` | P0 | static | `likely` | research_more |
| `list_seasons` | Seasons | `/leagues/seasons` or season values from leagues response; verify | none or league filter; verify | `ProviderSeason` | `SeasonNormalizer` | `seasons` | P0 | static | `likely` | research_more |
| `list_teams` | Teams | `/teams` | league and season likely required; verify | `ProviderTeam` | `TeamNormalizer` | `teams` | P0 | periodic | `likely` | research_more |
| `list_upcoming_matches` | Fixtures | `/fixtures` | date/from/to/league/season/status; verify | `ProviderMatch` | `MatchNormalizer` | `matches` | P0 | pre_match | `likely` | research_more |
| `list_finished_matches` | Fixtures | `/fixtures` | date/from/to/league/season/status; verify | `ProviderMatch` | `MatchNormalizer` | `matches` | P0 | post_match | `likely` | research_more |
| `get_football_match_score` | Fixture score | `/fixtures` or fixture detail score object; verify | fixture ID; verify | `ProviderFootballMatchScore` | `FootballMatchScoreNormalizer` | `football_match_scores` | P0 | post_match | `likely` | research_more |
| `get_football_standings` | Standings | `/standings` | league and season likely required; verify | `ProviderFootballStanding` | `FootballStandingNormalizer` | `football_standings` | P0 | periodic | `likely` | research_more |
| `get_football_team_statistics` | Fixture statistics | `/fixtures/statistics` | fixture ID and maybe team ID; verify | `ProviderFootballMatchTeamStatistics` | `FootballMatchTeamStatisticsNormalizer` | `football_match_team_statistics` | P0/P1 | post_match | `likely` | research_more |

## Missing-Field Policy

- Missing required DTO fields means the operation is not adapter-ready.
- Optional DTO fields may be omitted.
- Provider-specific or ambiguous fields must remain raw-only until a provider-agnostic mapping is approved.
- API-Football IDs must remain provider IDs and must not leak into public API contracts.
- Values must be transformed into existing provider-agnostic DTO names before ingestion.
- Team logo evidence is required before the team adapter is field-complete. Missing individual team logos should not block ingestion, but must be tracked.

## DTO Mapping

### ProviderCountry

| DTO Field | Required | API-Football Candidate Field | Transform Needed | Missing-Field Behavior | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `providerEntityId` | yes | country name/code/id if present; verify sample | Convert to stable string. Prefer provider ID/code if available. | Block adapter mapping. | `unknown` | Country endpoint family is likely, exact identifier is unconfirmed. |
| `name` | yes | country name; verify sample | Preserve display name. | Block adapter mapping. | `likely` | Needs sample response. |
| `code` | no | country code if present; verify sample | Normalize code casing. | Omit if unavailable. | `unknown` | Do not invent ISO codes. |
| `slug` | no | provider slug if present; verify sample | Use provider slug or normalized name fallback only after policy approval. | Omit if unavailable. | `unknown` | Slug support unverified. |
| `metadata` | no | extra generic country fields | Keep only provider-agnostic metadata. | Omit if unsafe. | `unknown` | Raw-only for provider-specific fields. |

### ProviderCompetition

| DTO Field | Required | API-Football Candidate Field | Transform Needed | Missing-Field Behavior | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `providerEntityId` | yes | league ID; verify sample | Convert numeric/string ID to string. | Block adapter mapping. | `likely` | Leagues endpoint family is likely. |
| `sportProviderId` | yes | football constant or sport field if present; verify | Use approved provider sport ID policy. | Block adapter mapping. | `unknown` | Need explicit static sport mapping decision. |
| `countryProviderId` | no | country name/code/object in league response; verify | Resolve to mapped country provider ID when available. | Omit if unavailable. | `likely` | Needs country mapping evidence. |
| `name` | yes | league name; verify sample | Preserve display name. | Block adapter mapping. | `likely` | Needs sample response. |
| `slug` | no | league slug if present; verify | Use source slug or normalized name fallback after policy approval. | Omit if unavailable. | `unknown` | Slug support unverified. |
| `gender` | no | gender field if present; verify | Preserve generic value only. | Omit if unavailable. | `unknown` | Unverified. |
| `level` | no | league type/category if present; verify | Map to generic level/type only if stable. | Omit if unavailable. | `unknown` | Avoid provider-specific semantics. |
| `metadata` | no | logo/type/country metadata; verify | Keep provider-agnostic metadata only. | Omit if unsafe. | `likely` | Do not store raw response shape as metadata. |

### ProviderSeason

| DTO Field | Required | API-Football Candidate Field | Transform Needed | Missing-Field Behavior | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `providerEntityId` | yes | season year/value or season ID if present; verify | Convert to stable string scoped to competition if needed. | Block adapter mapping. | `likely` | Need policy for year-only seasons. |
| `competitionProviderId` | yes | league ID from request/response; verify | Inject from request context if not present in item. | Block adapter mapping. | `likely` | Must be deterministic. |
| `name` | yes | season year/name; verify | Convert year to display name if provider lacks name. | Block adapter mapping. | `likely` | Mapping convention must be tested. |
| `startDate` | no | start date if present; verify | ISO date string. | Omit if unavailable. | `unknown` | Unverified. |
| `endDate` | no | end date if present; verify | ISO date string. | Omit if unavailable. | `unknown` | Unverified. |
| `isCurrent` | no | current flag if present; verify | Boolean. | Omit if unavailable. | `unknown` | Unverified. |
| `metadata` | no | coverage/year metadata; verify | Keep provider-agnostic metadata only. | Omit if unsafe. | `unknown` | Avoid raw response dumps. |

### ProviderTeam

| DTO Field | Required | API-Football Candidate Field | Transform Needed | Missing-Field Behavior | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `providerEntityId` | yes | team ID; verify sample | Convert numeric/string ID to string. | Block adapter mapping. | `likely` | Teams endpoint family is likely. |
| `sportProviderId` | yes | football constant or sport field if present; verify | Use approved provider sport ID policy. | Block adapter mapping. | `unknown` | Requires static sport mapping. |
| `countryProviderId` | no | team country if present; verify | Resolve to mapped country provider ID when available. | Omit if unavailable. | `unknown` | Country relationship unverified. |
| `name` | yes | team name; verify sample | Preserve display name. | Block adapter mapping. | `likely` | Needs sample response. |
| `shortName` | no | code/short name if present; verify | Preserve generic short name. | Omit if unavailable. | `unknown` | Unverified. |
| `slug` | no | slug if present; verify | Use source slug or normalized name fallback after policy approval. | Omit if unavailable. | `unknown` | Unverified. |
| `logoUrl` | no | logo URL, crest, badge, or image URL if present; verify | Preserve URL if stable, absolute, public, and not account-tokenized. | Missing individual logos do not block ingestion, but availability must be tracked. | `likely` | Required evidence for team adapter readiness; map to `ProviderTeam.logoUrl` and persist through `teams.logo_url`, not metadata-only. |
| `venueName` | no | venue/stadium name if present; verify | Preserve generic venue name. | Omit if unavailable. | `likely` | Stadium object may require metadata policy. |
| `foundedYear` | no | founded year if present; verify | Convert to number. | Omit if unavailable. | `likely` | Validate finite year. |
| `metadata` | no | generic team profile metadata | Keep provider-agnostic metadata only. | Omit if unsafe. | `unknown` | Raw-only for provider-specific fields. |

### ProviderMatch

| DTO Field | Required | API-Football Candidate Field | Transform Needed | Missing-Field Behavior | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `providerEntityId` | yes | fixture ID; verify sample | Convert numeric/string ID to string. | Block adapter mapping. | `likely` | Fixtures endpoint family is likely. |
| `sportProviderId` | no | football constant or sport field if present; verify | Use approved provider sport ID policy. | Omit only if competition can resolve sport. | `unknown` | Prefer explicit sport when safe. |
| `competitionProviderId` | yes | league ID; verify sample | Convert to string. | Block adapter mapping. | `likely` | Requires mapped competition. |
| `seasonProviderId` | no | season year/ID; verify | Convert to static season provider ID convention. | Omit if unavailable. | `likely` | Must match season mapping convention. |
| `homeTeamProviderId` | yes | home team ID; verify sample | Convert to string. | Block adapter mapping. | `likely` | Requires mapped team. |
| `awayTeamProviderId` | yes | away team ID; verify sample | Convert to string. | Block adapter mapping. | `likely` | Requires mapped team. |
| `scheduledStartAt` | yes | fixture date/time; verify sample | Convert to ISO timestamp. | Block adapter mapping. | `likely` | Time zone semantics must be tested. |
| `status` | yes | fixture status; verify sample | Map to allowed provider-agnostic match statuses. | Block if unmapped. | `likely` | No live-only statuses should leak into domain. |
| `roundName`, `venueName`, `refereeName` | no | round/venue/referee fields; verify | Preserve generic strings. | Omit if unavailable. | `likely` | Context fields are useful but optional. |
| `winnerProviderTeamId` | no | winner/team result if present; verify | Convert to string. | Omit if unavailable. | `unknown` | May only be available after finalization. |
| `metadata` | no | generic fixture metadata | Store provider-agnostic metadata only. | Omit if unsafe. | `unknown` | Score-summary fields should use score DTO. |

### ProviderFootballMatchScore

| DTO Field | Required | API-Football Candidate Field | Transform Needed | Missing-Field Behavior | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `providerEntityId` | yes | fixture ID or score identity; verify | Prefer fixture ID-derived string if no separate score ID exists. | Block if no stable payload identity. | `unknown` | Score rows do not create provider mappings. |
| `matchProviderId` | yes | fixture ID; verify | Convert to string. | Block adapter mapping. | `likely` | Must resolve existing match mapping. |
| halftime scores | no | score halftime fields; verify | Convert to numbers. | Omit if unavailable. | `likely` | Needed for prediction but not all fixtures may have it. |
| fulltime scores | no | score fulltime fields; verify | Convert to numbers. | Omit if unavailable. | `likely` | Required for useful finished score ingestion, though DTO field is optional. |
| extra-time/penalty scores | no | score extra-time/penalty fields; verify | Convert to numbers. | Omit if unavailable. | `likely` | Optional. |
| `winnerProviderTeamId` | no | winner/team field if present; verify | Convert to team provider ID. | Omit if unavailable. | `unknown` | Can derive later only if policy approved; do not infer silently. |
| `status` | no | fixture status; verify | Map to allowed match status. | Omit if unavailable. | `likely` | No live-score behavior. |
| `metadata` | no | generic score metadata | Store provider-agnostic metadata only. | Omit if unsafe. | `unknown` | Raw response remains in raw payload storage. |

### ProviderFootballMatchTeamStatistics

| DTO Field | Required | API-Football Candidate Field | Transform Needed | Missing-Field Behavior | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `matchProviderId` | yes | fixture ID; verify | Convert to string. | Block adapter mapping. | `likely` | Must resolve match mapping. |
| `teamProviderId` | yes | team ID in statistics row; verify | Convert to string. | Block adapter mapping. | `likely` | Must be home or away team. |
| possession/shots/corners/cards/fouls fields | no | statistic name/value pairs; verify | Normalize names and parse numbers/percentages. | Omit missing optional fields. | `likely` | Needs sample-driven statistic-name mapping. |
| xG/big chances/dangerous attacks | no | statistic name/value pairs; verify | Normalize only if present and generic. | Omit if unavailable. | `unknown` | Do not fabricate advanced metrics. |
| `metadata` | no | generic statistics metadata | Store provider-agnostic metadata only. | Omit if unsafe. | `unknown` | Provider-specific stat names may need raw-only handling. |

### ProviderFootballStanding

| DTO Field | Required | API-Football Candidate Field | Transform Needed | Missing-Field Behavior | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `competitionProviderId` | yes | league ID; verify | Convert to string. | Block adapter mapping. | `likely` | Requires competition mapping. |
| `seasonProviderId` | no | season/year; verify | Convert to season provider ID convention. | If supplied but unmapped, normalizer fails. | `likely` | Must align with season ingestion. |
| `teamProviderId` | yes | team ID; verify | Convert to string. | Block adapter mapping. | `likely` | Requires team mapping. |
| position/played/wins/draws/losses | yes | standing rank/all stats; verify | Convert to non-negative numbers. | Block adapter mapping. | `likely` | Partial standings should not be ingested as complete rows. |
| goals for/against/difference/points | yes | goals/points fields; verify | Convert to numbers. | Block adapter mapping. | `likely` | Goal difference may be negative. |
| home/away splits/form/status | no | home/away/all/form/status fields; verify | Convert to optional fields. | Omit if unavailable. | `likely` | Existing normalizer supports optional splits. |
| `metadata` | no | generic standing metadata | Store provider-agnostic metadata only. | Omit if unsafe. | `unknown` | Raw response remains in raw payload storage. |

## Sample Response Evidence Slots

| Operation | Sample Captured | Source URL / Doc Reference | Sanitized Sample Placeholder | Fields Observed | Fields Missing | Mapping Decision | Adapter Readiness |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `list_countries` | no | API-Football docs/pricing endpoint family reference | TBD | TBD | TBD | Not mapped until sample exists. | research_more |
| `list_competitions` | no | API-Football docs/pricing endpoint family reference | TBD | TBD | TBD | Not mapped until sample exists. | research_more |
| `list_seasons` | no | API-Football docs/pricing endpoint family reference | TBD | TBD | TBD | Not mapped until sample exists. | research_more |
| `list_teams` | no | API-Football docs/pricing endpoint family reference | TBD | TBD | TBD | Not mapped until sample exists. | research_more |
| `list_upcoming_matches` | no | API-Football docs/pricing endpoint family reference | TBD | TBD | TBD | Not mapped until sample exists. | research_more |
| `list_finished_matches` | no | API-Football docs/pricing endpoint family reference | TBD | TBD | TBD | Not mapped until sample exists. | research_more |
| `get_football_match_score` | no | API-Football docs/pricing endpoint family reference | TBD | TBD | TBD | Not mapped until sample exists. | research_more |
| `get_football_standings` | no | API-Football docs/pricing endpoint family reference | TBD | TBD | TBD | Not mapped until sample exists. | research_more |
| `get_football_team_statistics` | no | API-Football docs/pricing endpoint family reference | TBD | TBD | TBD | Not mapped until sample exists. | research_more |

## Adapter Gate Decision

Decision: `research_more`.

Reasons:

- No sanitized API-Football sample responses have been captured in this repo.
- Endpoint families appear likely from provider-facing pages, but exact response shapes are not mapped.
- Existing target tables and normalizers are ready for this evidence scope.
- Team ingestion is not field-complete until logo URL availability is confirmed or explicitly marked unavailable.
- Missing-field policy and future test plan are documented.
- Rate-limit/retry assumptions, exact current pricing/limits, and terms still require manual verification.

## First Adapter Slice Recommendation

After evidence is captured and reviewed, implement in this order:

1. Countries.
2. Leagues/competitions.
3. Seasons.
4. Teams.
5. Finished/upcoming fixtures.
6. Football scores.
7. Football standings.
8. Football team statistics.

Do not implement the entire API-Football surface at once.

## Future API-Football Adapter Test Plan

- Adapter maps countries to `ProviderCountry`.
- Adapter maps leagues to `ProviderCompetition`.
- Adapter maps seasons to `ProviderSeason`.
- Adapter maps teams to `ProviderTeam`.
- Adapter maps team logo fields to `ProviderTeam.logoUrl`.
- `TeamNormalizer` persists `ProviderTeam.logoUrl` to `teams.logo_url`.
- Missing logo for an individual team does not fail ingestion, but is logged or marked in adapter diagnostics/status or safe metadata.
- Logo fields are not discarded into generic metadata when first-class `logoUrl` exists.
- Adapter maps fixtures to `ProviderMatch`.
- Adapter maps fixture score fields to `ProviderFootballMatchScore`.
- Adapter maps standings to `ProviderFootballStanding`.
- Adapter maps fixture statistics to `ProviderFootballMatchTeamStatistics`.
- Provider result includes provider, endpoint, request params, request hash input, duration, and fetched timestamp metadata.
- Rate-limit metadata is captured if API-Football exposes it.
- API keys and private headers are never logged, stored, or returned in docs/tests.
- Ingestion remains off by default.
- No live-score queue, polling loop, WebSocket, prediction endpoint, odds endpoint, or scheduled sync is introduced.

## Non-Goals

- No API-Football adapter code yet.
- No real HTTP fetching in application code.
- No API keys or secrets.
- No scheduled provider jobs.
- No database writes.
- No predictions endpoint usage.
- No odds usage.
- No lineups, injuries, events, player statistics, or transfers in this slice.
- No live-score behavior.
- No frontend.
