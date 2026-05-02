# API-Football Sample Capture Checklist

## Purpose

This worksheet prepares manual, sanitized API-Football sample capture before any adapter implementation. It is documentation only: no API-Football adapter, HTTP client, API keys, scheduled jobs, ingestion, database writes, schema changes, normalizers, frontend, prediction logic, or live-score behavior are added by this document.

Current adapter gate decision: `research_more`.

## Sample Capture Safety Rules

- Never commit API keys, private request headers, cookies, session identifiers, dashboard URLs with tokens, or account-specific/private data.
- Sanitize every sample before committing it to documentation.
- Keep only minimal representative snippets that prove response shape and fields; do not paste full large payloads.
- Capture provider response shape, field names, nesting, and value types, not production data volume.
- Record capture date, endpoint or documentation reference, request params used, and plan/free-tier context if known.
- Do not write samples to the database.
- Do not add application fetching code, scripts, scheduled jobs, or ingestion jobs while capturing evidence.
- If a sample requires plan access, auth, or permission that is not available, mark it `blocked` instead of guessing.

## Evidence Status Rules

| Status | Use When |
| --- | --- |
| `confirmed` | A sanitized sample response shows the field and the mapping is reviewed. |
| `likely` | Provider docs describe the endpoint or field family, but no sanitized sample is captured. |
| `unknown` | Neither docs nor sample evidence prove the field. |
| `unavailable` | Reviewed evidence shows the provider does not supply the field. |
| `raw_only` | The field exists, but no approved canonical target exists yet. |
| `blocked` | Access, plan, permission, quota, or terms constraints prevent evidence capture. |

## Required Sample Operations

| Operation | Endpoint / Reference Placeholder | Request Params To Record | Required DTO Fields To Verify | Optional DTO Fields To Verify | Target Normalizer | Target Table | Evidence Status | Adapter Readiness | Notes / Risks |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Countries | API-Football countries reference | none or supported filters | `providerEntityId`, `name` | `code`, `slug`, `metadata` | `CountryNormalizer` | `countries` | `likely` | research_more | Prefer stable provider ID/code if available; do not invent ISO codes. |
| Leagues / competitions | API-Football leagues reference | country, season, league filters if used | `providerEntityId`, `sportProviderId`, `name` | `countryProviderId`, `slug`, `type`, `gender`, `level`, `metadata` | `CompetitionNormalizer` | `competitions` | `likely` | research_more | Confirm how football sport identity is represented or injected. |
| Seasons | API-Football seasons or leagues reference | league, season, country filters if used | `providerEntityId`, `competitionProviderId`, `name` | `year`, `startDate`, `endDate`, `isCurrent`, `metadata` | `SeasonNormalizer` | `seasons` | `likely` | research_more | Define season provider ID convention if seasons are year-only. |
| Teams | API-Football teams reference | league, season, team, country filters if used | `providerEntityId`, `sportProviderId`, `name`, logo evidence | `countryProviderId`, `shortName`, `slug`, `logoUrl`, `venueName`, `foundedYear`, `metadata` | `TeamNormalizer` | `teams` | `likely` | research_more | Team adapter is not field-complete until logo availability is confirmed or explicitly unavailable. |
| Fixtures / upcoming | API-Football fixtures reference | date, from/to, league, season, status filters if used | `providerEntityId`, `competitionProviderId`, `homeTeamProviderId`, `awayTeamProviderId`, `scheduledStartAt`, `status` | `seasonProviderId`, `roundName`, `stageName`, `venueName`, `refereeName`, `metadata` | `MatchNormalizer` | `matches` | `likely` | research_more | No live polling; capture only shape needed for moderate pre-match refresh. |
| Fixtures / finished | API-Football fixtures reference | date, from/to, league, season, status filters if used | `providerEntityId`, `competitionProviderId`, `homeTeamProviderId`, `awayTeamProviderId`, `scheduledStartAt`, `status` | `seasonProviderId`, `winnerProviderTeamId`, `roundName`, `venueName`, `refereeName`, `metadata` | `MatchNormalizer` | `matches` | `likely` | research_more | Finished fixtures are safer than live data for first match slice. |
| Fixture score fields | API-Football fixtures score fields reference | fixture ID or finished fixture filters | `matchProviderId` | halftime, fulltime, extra-time, penalty score fields, `winnerProviderTeamId`, `status`, `metadata` | `FootballMatchScoreNormalizer` | `football_match_scores` | `likely` | research_more | Score normalizer depends on existing match mapping and does not create matches. |
| Standings | API-Football standings reference | league and season | `competitionProviderId`, `teamProviderId`, `position`, `played`, `wins`, `draws`, `losses`, `goalsFor`, `goalsAgainst`, `goalDifference`, `points` | `seasonProviderId`, home/away splits, `formString`, `status`, `metadata` | `FootballStandingNormalizer` | `football_standings` | `likely` | research_more | Partial standings should not be mapped as complete rows. |
| Fixture team statistics | API-Football fixture statistics reference | fixture ID, team ID if supported | `matchProviderId`, `teamProviderId` | possession, shots, shots on target/off target, corners, fouls, cards, offsides, saves, passes, xG, attacks, `metadata` | `FootballMatchTeamStatisticsNormalizer` | `football_match_team_statistics` | `likely` | research_more | Statistic names/values must be sample-driven and provider-agnostic. |

## Sanitized Sample Slots

Use one small sanitized snippet per operation. Keep credentials and account context out of every sample.

### Countries

- Sample captured: no
- Capture date: TBD
- Endpoint / docs reference: TBD
- Plan/free-tier context: TBD
- Request params: TBD
- Sanitized sample:

```json
{
  "sample": "TBD"
}
```

- Fields observed: TBD
- Fields missing: TBD
- Mapping decision: not mapped until sample exists
- Adapter readiness: research_more

### Leagues / Competitions

- Sample captured: no
- Capture date: TBD
- Endpoint / docs reference: TBD
- Plan/free-tier context: TBD
- Request params: TBD
- Sanitized sample:

```json
{
  "sample": "TBD"
}
```

- Fields observed: TBD
- Fields missing: TBD
- Mapping decision: not mapped until sample exists
- Adapter readiness: research_more

### Seasons

- Sample captured: no
- Capture date: TBD
- Endpoint / docs reference: TBD
- Plan/free-tier context: TBD
- Request params: TBD
- Sanitized sample:

```json
{
  "sample": "TBD"
}
```

- Fields observed: TBD
- Fields missing: TBD
- Mapping decision: not mapped until sample exists
- Adapter readiness: research_more

### Teams

- Sample captured: no
- Capture date: TBD
- Endpoint / docs reference: TBD
- Plan/free-tier context: TBD
- Request params: TBD
- Sanitized sample:

```json
{
  "sample": "TBD"
}
```

- Fields observed: TBD
- Fields missing: TBD
- Logo evidence: not captured
- Mapping decision: not mapped until sample exists
- Adapter readiness: research_more

### Fixtures / Upcoming

- Sample captured: no
- Capture date: TBD
- Endpoint / docs reference: TBD
- Plan/free-tier context: TBD
- Request params: TBD
- Sanitized sample:

```json
{
  "sample": "TBD"
}
```

- Fields observed: TBD
- Fields missing: TBD
- Mapping decision: not mapped until sample exists
- Adapter readiness: research_more

### Fixtures / Finished

- Sample captured: no
- Capture date: TBD
- Endpoint / docs reference: TBD
- Plan/free-tier context: TBD
- Request params: TBD
- Sanitized sample:

```json
{
  "sample": "TBD"
}
```

- Fields observed: TBD
- Fields missing: TBD
- Mapping decision: not mapped until sample exists
- Adapter readiness: research_more

### Fixture Score Fields

- Sample captured: no
- Capture date: TBD
- Endpoint / docs reference: TBD
- Plan/free-tier context: TBD
- Request params: TBD
- Sanitized sample:

```json
{
  "sample": "TBD"
}
```

- Fields observed: TBD
- Fields missing: TBD
- Mapping decision: not mapped until sample exists
- Adapter readiness: research_more

### Standings

- Sample captured: no
- Capture date: TBD
- Endpoint / docs reference: TBD
- Plan/free-tier context: TBD
- Request params: TBD
- Sanitized sample:

```json
{
  "sample": "TBD"
}
```

- Fields observed: TBD
- Fields missing: TBD
- Mapping decision: not mapped until sample exists
- Adapter readiness: research_more

### Fixture Team Statistics

- Sample captured: no
- Capture date: TBD
- Endpoint / docs reference: TBD
- Plan/free-tier context: TBD
- Request params: TBD
- Sanitized sample:

```json
{
  "sample": "TBD"
}
```

- Fields observed: TBD
- Fields missing: TBD
- Mapping decision: not mapped until sample exists
- Adapter readiness: research_more

## Team Logo Evidence Checklist

Team logo availability is required evidence for the API-Football team adapter gate. Missing individual team logos should not fail ingestion, but availability must be tracked.

| Evidence Item | Status | Notes |
| --- | --- | --- |
| Provider team ID observed | `unknown` | Required for `ProviderTeam.providerEntityId`. |
| Team name observed | `unknown` | Required for `ProviderTeam.name`. |
| Team code or short name observed | `unknown` | Optional mapping to `ProviderTeam.shortName`. |
| Country observed | `unknown` | Optional mapping to `ProviderTeam.countryProviderId` if it can resolve to a country mapping. |
| Founded year observed | `unknown` | Optional mapping to `ProviderTeam.foundedYear`. |
| Venue/stadium observed | `unknown` | Optional mapping to `ProviderTeam.venueName`. |
| Logo URL observed | `unknown` | Optional field, but required evidence before team adapter readiness. |
| Logo URL is absolute | `unknown` | Prefer absolute public URL. |
| Logo URL appears stable | `unknown` | Verify it does not contain temporary signatures or account tokens. |
| Image format is usable | `unknown` | Record extension/content type if available without fetching private assets. |
| Some teams omit logo | `unknown` | Missing individual logos should be tracked, not ingestion-blocking. |
| Maps to `ProviderTeam.logoUrl` | `unknown` | Do not bury logo in metadata when first-class field exists. |
| Persists to `teams.logo_url` | supported by app | Existing `TeamNormalizer` and team repository support this path. |

Acceptance rule:

- The API-Football team adapter is not field-complete until logo URL availability is either confirmed from sanitized samples or explicitly marked `unavailable`.
- If a team sample includes a usable logo URL, adapter mapping must set `ProviderTeam.logoUrl`.
- If an individual team is missing a logo, ingestion should continue and record the missing-logo condition in adapter diagnostics or safe metadata/status.
- Logo fields must not be discarded into generic `metadata` when `teams.logo_url` is available.

## DTO Mapping Evidence Tables

### ProviderCountry

| DTO Field | Required | Sample Field To Check | Evidence Status | Missing-Field Behavior |
| --- | --- | --- | --- | --- |
| `providerEntityId` | yes | provider country ID, code, or stable country identifier | `unknown` | Blocks country adapter mapping. |
| `name` | yes | country name | `likely` | Blocks country adapter mapping. |
| `code` | no | country code | `unknown` | Omit if unavailable. |
| `slug` | no | country slug | `unknown` | Omit if unavailable. |
| `metadata` | no | generic country metadata | `unknown` | Keep only safe provider-agnostic metadata. |

### ProviderCompetition

| DTO Field | Required | Sample Field To Check | Evidence Status | Missing-Field Behavior |
| --- | --- | --- | --- | --- |
| `providerEntityId` | yes | league ID | `likely` | Blocks competition adapter mapping. |
| `sportProviderId` | yes | sport field or approved API-Football football constant | `unknown` | Blocks competition adapter mapping. |
| `countryProviderId` | no | country object/name/code | `likely` | Omit if unavailable; prefer mapped country provider ID. |
| `name` | yes | league name | `likely` | Blocks competition adapter mapping. |
| `slug` | no | league slug | `unknown` | Omit if unavailable. |
| `type` | no | league/cup type | `unknown` | Omit unless provider-agnostic. |
| `gender` | no | gender field | `unknown` | Omit if unavailable. |
| `level` | no | division/level field | `unknown` | Omit unless stable and generic. |
| `metadata` | no | generic competition metadata | `unknown` | Keep only safe provider-agnostic metadata. |

### ProviderSeason

| DTO Field | Required | Sample Field To Check | Evidence Status | Missing-Field Behavior |
| --- | --- | --- | --- | --- |
| `providerEntityId` | yes | season ID, year, or stable season value | `likely` | Blocks season adapter mapping. |
| `competitionProviderId` | yes | league ID from item or request context | `likely` | Blocks season adapter mapping. |
| `name` | yes | season name/year | `likely` | Blocks season adapter mapping. |
| `year` | no | season year | `likely` | Omit if unavailable. |
| `startDate` | no | start date | `unknown` | Omit if unavailable. |
| `endDate` | no | end date | `unknown` | Omit if unavailable. |
| `isCurrent` | no | current flag | `unknown` | Omit if unavailable. |
| `metadata` | no | generic season metadata | `unknown` | Keep only safe provider-agnostic metadata. |

### ProviderTeam

| DTO Field | Required | Sample Field To Check | Evidence Status | Missing-Field Behavior |
| --- | --- | --- | --- | --- |
| `providerEntityId` | yes | team ID | `likely` | Blocks team adapter mapping. |
| `sportProviderId` | yes | sport field or approved API-Football football constant | `unknown` | Blocks team adapter mapping. |
| `countryProviderId` | no | team country | `unknown` | Omit if unavailable. |
| `name` | yes | team name | `likely` | Blocks team adapter mapping. |
| `shortName` | no | code or short name | `unknown` | Omit if unavailable. |
| `slug` | no | team slug | `unknown` | Omit if unavailable. |
| `logoUrl` | no | logo, crest, badge, or image URL | `likely` | Missing individual logos do not block ingestion, but availability evidence is required for adapter readiness. |
| `venueName` | no | venue/stadium name | `likely` | Omit if unavailable. |
| `foundedYear` | no | founded year | `likely` | Omit if unavailable. |
| `metadata` | no | generic team metadata | `unknown` | Do not store logo only in metadata. |

### ProviderMatch

| DTO Field | Required | Sample Field To Check | Evidence Status | Missing-Field Behavior |
| --- | --- | --- | --- | --- |
| `providerEntityId` | yes | fixture ID | `likely` | Blocks match adapter mapping. |
| `competitionProviderId` | yes | league ID | `likely` | Blocks match adapter mapping. |
| `seasonProviderId` | no | season ID/year | `likely` | Omit if unavailable. |
| `homeTeamProviderId` | yes | home team ID | `likely` | Blocks match adapter mapping. |
| `awayTeamProviderId` | yes | away team ID | `likely` | Blocks match adapter mapping. |
| `scheduledStartAt` | yes | fixture date/time | `likely` | Blocks match adapter mapping. |
| `status` | yes | fixture status | `likely` | Blocks if status cannot map to allowed canonical status. |
| `roundName` | no | round | `likely` | Omit if unavailable. |
| `stageName` | no | stage | `unknown` | Omit if unavailable. |
| `venueName` | no | venue/stadium | `likely` | Omit if unavailable. |
| `refereeName` | no | referee | `likely` | Omit if unavailable. |
| `winnerProviderTeamId` | no | winner team ID | `unknown` | Omit if unavailable. |
| `metadata` | no | generic fixture metadata | `unknown` | Keep only safe provider-agnostic metadata. |

### ProviderFootballMatchScore

| DTO Field | Required | Sample Field To Check | Evidence Status | Missing-Field Behavior |
| --- | --- | --- | --- | --- |
| `matchProviderId` | yes | fixture ID | `likely` | Blocks score adapter mapping. |
| halftime score | no | halftime home/away scores | `likely` | Omit if unavailable. |
| fulltime score | no | fulltime home/away scores | `likely` | Omit if unavailable. |
| extra time score | no | extra-time home/away scores | `likely` | Omit if unavailable. |
| penalty score | no | penalty home/away scores | `likely` | Omit if unavailable. |
| `winnerProviderTeamId` | no | winner team ID | `unknown` | Omit if unavailable; do not infer silently. |
| `status` | no | fixture status | `likely` | Omit if unavailable. |
| `metadata` | no | generic score metadata | `unknown` | Keep only safe provider-agnostic metadata. |

### ProviderFootballStanding

| DTO Field | Required | Sample Field To Check | Evidence Status | Missing-Field Behavior |
| --- | --- | --- | --- | --- |
| `competitionProviderId` | yes | league ID | `likely` | Blocks standing adapter mapping. |
| `seasonProviderId` | no | season/year | `likely` | If supplied, must resolve to mapped season. |
| `teamProviderId` | yes | team ID | `likely` | Blocks standing adapter mapping. |
| `position` | yes | rank/position | `likely` | Blocks standing adapter mapping. |
| `played` | yes | played/all played | `likely` | Blocks standing adapter mapping. |
| `wins` | yes | wins/all wins | `likely` | Blocks standing adapter mapping. |
| `draws` | yes | draws/all draws | `likely` | Blocks standing adapter mapping. |
| `losses` | yes | losses/all losses | `likely` | Blocks standing adapter mapping. |
| `goalsFor` | yes | goals for | `likely` | Blocks standing adapter mapping. |
| `goalsAgainst` | yes | goals against | `likely` | Blocks standing adapter mapping. |
| `goalDifference` | yes | goal difference | `likely` | Blocks standing adapter mapping. |
| `points` | yes | points | `likely` | Blocks standing adapter mapping. |
| home/away splits | no | home/away played, wins, draws, losses, goals | `likely` | Omit if unavailable. |
| `formString` | no | recent form string | `likely` | Omit if unavailable. |
| `metadata` | no | generic standing metadata | `unknown` | Keep only safe provider-agnostic metadata. |

### ProviderFootballMatchTeamStatistics

| DTO Field | Required | Sample Field To Check | Evidence Status | Missing-Field Behavior |
| --- | --- | --- | --- | --- |
| `matchProviderId` | yes | fixture ID | `likely` | Blocks statistics adapter mapping. |
| `teamProviderId` | yes | team ID | `likely` | Blocks statistics adapter mapping. |
| `possessionPercent` | no | possession percent | `likely` | Omit if unavailable. |
| `shotsTotal` | no | total shots | `likely` | Omit if unavailable. |
| `shotsOnTarget` | no | shots on goal/target | `likely` | Omit if unavailable. |
| `shotsOffTarget` | no | shots off target | `likely` | Omit if unavailable. |
| `corners` | no | corner kicks | `likely` | Omit if unavailable. |
| `fouls` | no | fouls | `likely` | Omit if unavailable. |
| `yellowCards` | no | yellow cards | `likely` | Omit if unavailable. |
| `redCards` | no | red cards | `likely` | Omit if unavailable. |
| `offsides` | no | offsides | `likely` | Omit if unavailable. |
| `goalkeeperSaves` | no | goalkeeper saves | `likely` | Omit if unavailable. |
| `passes` | no | total passes | `likely` | Omit if unavailable. |
| `accuratePasses` | no | accurate passes | `likely` | Omit if unavailable. |
| `bigChances` | no | big chances | `unknown` | Omit if unavailable. |
| `expectedGoals` | no | xG/expected goals | `unknown` | Omit if unavailable. |
| attacks / dangerous attacks | no | attacks and dangerous attacks | `unknown` | Omit if unavailable. |
| `metadata` | no | generic statistics metadata | `unknown` | Keep only safe provider-agnostic metadata. |

## Adapter Gate Update Criteria

Move API-Football from `research_more` toward `ready_for_adapter_implementation` only when all minimum criteria are satisfied:

- Countries sample captured and mapped to `ProviderCountry`.
- Leagues/competitions sample captured and mapped to `ProviderCompetition`.
- Seasons sample captured and mapped to `ProviderSeason`.
- Teams sample captured and team logo availability is confirmed or explicitly unavailable.
- Fixtures sample captured for upcoming and finished contexts.
- Fixture score fields identified and mapped to `ProviderFootballMatchScore`.
- Standings sample captured and required fields mapped to `ProviderFootballStanding`.
- Fixture team statistics sample captured or explicitly deferred from the first adapter slice.
- DTO mapping has no unresolved required field.
- Missing optional fields have a documented omit, raw-only, or metadata policy.
- Rate-limit and retry expectations are documented.
- Raw payload retention behavior is confirmed.
- Unit tests are planned for adapter mapping, ingestion handoff, provider mappings, idempotency, missing logos, and production safety.
- Terms/legal risk is acknowledged for review before production use.
- No live-score behavior, scraping, scheduled job, or production database write path is introduced accidentally.

## Future Adapter Test Updates

- API-Football team adapter maps provider logo field to `ProviderTeam.logoUrl`.
- `TeamNormalizer` persists `logoUrl` to `teams.logo_url`.
- Missing logo for an individual team does not fail ingestion.
- Missing logo is logged or marked in adapter diagnostics/status or safe metadata.
- Logo URL is not lost into generic metadata when the first-class `logoUrl` field exists.
- Team DTO mapping fails clearly if required `providerEntityId`, `sportProviderId`, or `name` is missing.
- Static and fixture adapters return `ProviderFetchResult` without leaking API keys or private headers.
- Ingestion remains off by default and no live-score behavior is introduced.

## Non-Goals

- No API-Football adapter code yet.
- No real HTTP client or application fetching code.
- No API key storage.
- No scheduled provider jobs.
- No ingestion jobs.
- No database writes.
- No schema changes.
- No new normalizers.
- No frontend.
- No prediction logic.
- No live-score polling, queues, or WebSockets.
