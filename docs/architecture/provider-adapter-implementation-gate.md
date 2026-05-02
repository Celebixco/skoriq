# Provider Adapter Implementation Gate

## Purpose

No real provider adapter may be implemented until this gate is satisfied for the selected operation. This protects the provider-agnostic architecture, avoids production data pollution, and prevents accidental live-score or scraping behavior.

## Mandatory Gate Checklist

- [ ] Operation selected from the provider operation map.
- [ ] Provider-specific evidence document updated.
- [ ] Representative sample response captured and reviewed.
- [ ] Fields mapped to provider-agnostic DTO fields.
- [ ] Target table exists.
- [ ] Target normalizer exists.
- [ ] Missing-field policy defined.
- [ ] Validation rules defined.
- [ ] Rate-limit behavior documented.
- [ ] Retry behavior documented.
- [ ] Raw payload retention confirmed.
- [ ] Unit tests planned for DTO mapping and adapter behavior.
- [ ] Raw payload processor impact assessed.
- [ ] No production database pollution path exists.
- [ ] Mock/no-op provider remains forbidden in production.
- [ ] Legal/terms risk acknowledged for review before production use.
- [ ] No live-score behavior, WebSockets, or second-by-second polling added.
- [ ] No scraping code added to the application.

## First Real Adapter Slice Recommendation

Start with static discovery first:

- `list_sports`
- `list_countries`
- `list_competitions`
- `list_seasons`

This is the safest first slice because it is low volume, non-live, foundational for every later normalized entity, and already supported by canonical DTOs, repositories, normalizers, and provider mappings.

Later safe candidates after static evidence is reviewed:

- Finished matches and sport-specific scores.
- Sport-specific standings.

Avoid starting with:

- Live or in-progress match data.
- Events.
- Lineups.
- Injuries or missing players.
- Player match statistics.
- Basketball player box scores.
- Prediction features.
- Odds or betting data.

## Approval Record

| Operation | Provider | Gate Status | Reviewer | Decision Date | Notes |
| --- | --- | --- | --- | --- | --- |
| `list_sports` | Sofascore | research_more | Codex | 2026-04-29 | Public categories page shows Football and Basketball names, but provider sport IDs and structured response shape are unconfirmed. |
| `list_countries` | Sofascore | research_more | Codex | 2026-04-29 | No reviewed country/category list sample for DTO mapping. |
| `list_competitions` | Sofascore | research_more | Codex | 2026-04-29 | Public categories page shows featured competition names, but provider IDs, sport/category references, and complete static coverage are unconfirmed. |
| `list_seasons` | Sofascore | research_more | Codex | 2026-04-29 | One undocumented football tournament season endpoint returned `id`, `name`, and `year`, but coverage, stability, terms risk, and basketball evidence remain unresolved. |

## Static Slice Gate Evaluation

Decision: `research_more`.

| Gate Requirement | Status | Notes |
| --- | --- | --- |
| Operation selected | satisfied | Static slice: `list_sports`, `list_countries`, `list_competitions`, `list_seasons`. |
| Sample response captured | partial | One undocumented season response sample captured for Premier League seasons. Sports and competitions evidence comes from public page content, not DTO-ready API responses. |
| Fields mapped to DTOs | partial | `ProviderSeason` is partially mappable from one sample; `ProviderSport`, `ProviderCountry`, and `ProviderCompetition` still lack confirmed provider IDs or structured response shapes. |
| Target normalizers exist | satisfied | `SportNormalizer`, `CountryNormalizer`, `CompetitionNormalizer`, and `SeasonNormalizer` exist. |
| Missing-field policy defined | satisfied | Missing required DTO fields means the operation is not adapter-ready. Optional fields may be omitted or retained as provider-agnostic metadata only when safe. |
| Validation rules defined | satisfied | Existing static normalizers validate required DTO fields. Adapter mapping tests must assert required field presence before handoff. |
| Rate-limit/retry behavior documented | partial | No rate-limit evidence captured. Future adapter must use conservative retry/backoff and never live-poll. |
| Raw payload retention confirmed | satisfied | Existing raw payload retention applies after ingestion; discovery itself must not write raw payloads. |
| Tests planned | satisfied | Future static adapter tests are documented below. |
| Production safety considered | satisfied | No database writes, scheduled jobs, secrets, cookies, or session-specific data in discovery. |
| Legal/terms risk acknowledged | satisfied | Sofascore FAQ says sports data sources cannot be shared as API endpoints due to data-provider agreements; production use requires review. |
| No live-score behavior added | satisfied | Static slice only; no match/scores/live data researched or implemented. |

## Future Static Adapter Test Plan

- Provider adapter returns `ProviderFetchResult` for each static operation.
- DTO mapping works for `ProviderSport`, `ProviderCountry`, `ProviderCompetition`, and `ProviderSeason`.
- Adapter mapping fails clearly when required static DTO fields are missing.
- `ProviderIngestionService` receives static provider results without direct canonical writes.
- Raw payloads are stored before processing.
- Static normalizers process static payloads and create provider mappings.
- Repeated static ingestion does not create duplicate canonical records.
- Mock/no-op provider remains production-blocked.
- No live-score queues, live polling, or dynamic match-data behavior is introduced.

## API-Football Football Gate Evaluation

Decision: `research_more`.

| Gate Requirement | Status | Notes |
| --- | --- | --- |
| Operation selected | satisfied | API-Football evidence scope covers countries, leagues, seasons, teams, fixtures, scores, standings, and fixture statistics. |
| Provider-specific evidence document updated | satisfied | See `docs/providers/api-football-field-evidence.md`. |
| Representative sample response captured | not satisfied | No sanitized sample responses captured yet. |
| Fields mapped to DTOs | partial | Candidate mappings are documented, but no sample response confirms exact fields. |
| Team logo evidence captured | not satisfied | Team adapter readiness requires sanitized evidence for logo/image/crest/badge URL availability and mapping to `ProviderTeam.logoUrl` / `teams.logo_url`; missing individual logos should be tracked but not ingestion-blocking. |
| Target tables and normalizers exist | satisfied | All scoped target tables and normalizers already exist. |
| Missing-field policy defined | satisfied | Missing required DTO fields blocks adapter mapping. |
| Validation rules defined | partial | Existing normalizers validate DTOs; adapter-side transformation tests still need samples. |
| Rate-limit/retry behavior documented | partial | Public plan limits require manual verification; retry policy must be defined before code. |
| Raw payload retention confirmed | satisfied | Existing raw payload retention applies after ingestion; this task does not ingest. |
| Tests planned | satisfied | Future API-Football adapter tests are documented. |
| Production safety considered | satisfied | No API keys, scheduled jobs, ingestion, or database writes in this evidence phase. |
| Legal/terms risk acknowledged | satisfied | Terms and production rights require manual review before real adapter work. |
| No live-score behavior added | satisfied | Evidence scope excludes live-score implementation. |

Minimum criteria to move API-Football from `research_more` toward `ready_for_adapter_implementation`:

- Countries, leagues/competitions, seasons, teams, fixtures, scores, and standings samples are captured and sanitized.
- Teams sample evidence confirms logo URL availability or explicitly marks it unavailable.
- DTO mapping has no unresolved required fields.
- Missing optional fields have omit, raw-only, or safe metadata policy.
- Rate-limit, retry, raw payload retention, tests, production safety, and legal/terms review notes are documented.

## Sofascore Static + Team Logo Gate Evaluation

Decision: `research_more`.

| Gate Requirement | Status | Notes |
| --- | --- | --- |
| Operation selected | satisfied | Static/team-logo evidence scope covers sports, categories/countries, football/basketball competitions, seasons, football/basketball teams, and team logos. |
| Provider-specific evidence plan updated | satisfied | See `docs/providers/sofascore-static-evidence-plan.md`. |
| Representative sample responses captured | partial | Public sport/competition names and one football season sample exist; no DTO-ready country/category/team/logo samples are captured. |
| Fields mapped to DTOs | partial | Candidate mapping checklist exists, but required IDs and team/logo fields are unresolved. |
| Team logo evidence captured | not satisfied | Football and basketball team logo availability must be confirmed or explicitly marked unavailable before team adapter readiness. |
| Target tables and normalizers exist | satisfied | Static canonical normalizers and `teams.logo_url` exist. |
| Missing-field policy defined | satisfied | Missing required DTO fields blocks adapter mapping; missing individual logos should be non-fatal but logged/marked. |
| Validation rules defined | partial | Existing normalizers validate DTOs; adapter-side mapping tests still require samples. |
| Rate-limit/retry behavior documented | not satisfied | No approved rate-limit/retry behavior exists for Sofascore. |
| Raw payload retention confirmed | satisfied | Existing raw payload retention applies after ingestion; this task does not ingest. |
| Tests planned | satisfied | Future mapper tests are documented in the static evidence plan. |
| Production safety considered | satisfied | No fetching, scraping, scheduled jobs, ingestion, DB writes, or production mock data in evidence phase. |
| Legal/terms risk acknowledged | satisfied | Sofascore has no confirmed official public API contract for this platform's use; review is required before production use. |
| No live-score behavior added | satisfied | Static/team-logo evidence only; live-score behavior remains prohibited. |

Minimum criteria to move Sofascore from `research_more` toward `ready_for_adapter_implementation`:

- Sanitized static samples are captured for sports, categories/countries, competitions, seasons, and teams.
- Football and basketball team logo availability is confirmed or explicitly unavailable.
- DTO mapping has no unresolved required fields.
- Missing optional fields have omit, raw-only, or safe metadata policy.
- Rate-limit/retry behavior, raw payload retention, tests, production safety, and legal/terms review notes are documented.

## apifootball.com Football POC Gate Evaluation

Decision: `local_poc_only`; production gate remains `research_more`.

Provider naming warning: `apifootball.com` is not `api-football.com / API-SPORTS`.

| Gate Requirement | Status | Notes |
| --- | --- | --- |
| Operation selected | satisfied | POC scope covers `get_countries`, `get_leagues`, `get_events`, `get_standings`, and `get_teams`. |
| Provider-specific evidence document updated | satisfied | See `docs/providers/apifootball-com-field-evidence.md`. |
| Representative sample responses captured | partial/blocked | Public docs include examples. A 2026-04-29 local staged capture produced `get_countries` and `get_leagues` samples, but both returned authentication failure and confirmed no DTO fields. |
| Fields mapped to DTOs | partial/satisfied for POC | Countries, leagues, teams, events/scores, and standings have pure mappers; standings without stable team IDs remain unresolved. |
| Team logo evidence captured | partial | Public docs show `team_badge`; sanitized samples still need to confirm current logo availability and stability. |
| Target tables and normalizers exist | satisfied | Scoped DTOs map to existing canonical/football tables. |
| Missing-field policy defined | satisfied | Missing required IDs fail or mark rows unresolved; missing individual logos are non-fatal and marked. |
| Validation rules defined | partial | Mapper tests cover core transformations; production validation still requires real samples. |
| Rate-limit/retry behavior documented | partial | Timeout exists; retry is intentionally not implemented. Current limits/terms still require manual verification. |
| Raw payload retention confirmed | satisfied | Adapter can produce `ProviderFetchResult`; sample capture writes local files only and does not ingest. |
| Tests planned/added | satisfied | Unit tests use mocks and no real HTTP calls. |
| Production safety considered | satisfied | Config and adapter block enabled provider usage in production. |
| Legal/terms risk acknowledged | partial | Manual terms review still required before production. |
| No live-score behavior added | satisfied | Livescore, polling, scheduler jobs, and WebSockets are not implemented. |

Minimum criteria before production adapter approval:

- Rotate the exposed API key and use only environment variables.
- Capture sanitized local samples for countries, leagues, teams with logos, finished events/scores, and standings.
- Confirm rate limits, terms, and allowed production usage.
- Decide whether standings/team/event samples consistently include stable team IDs.
- Add explicit manual ingestion workflow only after sample evidence passes.

## apifootball.com Manual Ingestion Gate

Decision: not ready; remains `research_more` until reviewed samples pass the workflow in `docs/providers/apifootball-com-sample-review-workflow.md`.

`ready_for_manual_ingestion` is a narrow state. It permits designing a future local/manual ingestion command only; it does not approve production ingestion, scheduled jobs, live polling, frontend use, prediction models, or automatic sync.

| Requirement | Current Status | Required Evidence |
| --- | --- | --- |
| Countries sample reviewed | not satisfied; auth-blocked sample reviewed | Sanitized successful `get_countries` sample confirms stable `country_id` and `country_name`. |
| Leagues sample reviewed | not satisfied; auth-blocked sample reviewed | Sanitized successful `get_leagues` sample confirms stable `league_id`, `league_name`, and country context when present. |
| Teams sample reviewed | not satisfied | Sanitized `get_teams` sample confirms stable team ID and team name. |
| Team logo gate reviewed | not satisfied | Logo field is confirmed or explicitly unavailable; missing individual logos are non-fatal and marked. |
| Events sample reviewed | not satisfied | Sanitized `get_events` sample confirms stable `match_id`, `league_id`, scheduled time, status, and stable home/away team IDs. |
| Score fields reviewed | not satisfied | Finished event sample confirms fulltime/current, halftime, extra-time, penalty, and status mapping behavior. |
| Standings reviewed | not satisfied | Sanitized `get_standings` sample confirms stable `team_id`, or standings normalization is explicitly blocked/raw-only. |
| Key leakage check | required for every review | No key, secret headers, cookies, private data, or full keyed URLs in docs, logs, tests, or committed files. |
| Sample storage check | required for every review | `.provider-samples/` remains gitignored and local-only. |

If all requirements pass, the next approved planning step is a local/manual ingestion design with dry-run mode, explicit operation selection, small dataset limits, raw payload storage, normalizer processing, rollback/cleanup notes, and no scheduler.

## Non-Goals

- No Sofascore adapter yet.
- No real HTTP fetching yet.
- No scraping code.
- No scheduled provider jobs.
- No provider ingestion jobs.
- No database writes from discovery.
- No prediction model.
- No frontend.
- No live-score system.
