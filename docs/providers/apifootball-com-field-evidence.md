# apifootball.com Field Evidence And POC Adapter Notes

## Provider Distinction

`apifootball.com` is a different provider from `api-football.com / API-SPORTS`.

Do not mix endpoint names, request formats, pricing, rate limits, response fields, or evidence status between these providers. This document refers only to `apifootball.com`, whose public documentation shows action-based query parameters such as `action=get_countries`.

## Security

An API key was accidentally exposed in chat. That key must be rotated outside this repository before any future manual sample capture or provider use.

Rules:

- Use only `APIFOOTBALL_COM_API_KEY*` values from server environment variables or deployment secrets.
- Never commit API keys, request URLs containing keys, headers, cookies, or account-specific data.
- Never print API keys in logs, test snapshots, docs, or error messages.
- Logs and reports may include only safe credential labels such as `countries`, `events`, `fixtures`, `default`, or `legacy`.
- Use placeholders such as `<REDACTED_API_KEY>` in examples.

## Current POC Status

Gate decision: `ready_for_manual_ingestion` for the tested football slice only; production use remains `research_more` and blocked.

The adapter can be configured for controlled local/manual use only. It is blocked in production and is not connected to scheduled jobs, automatic ingestion, frontend, prediction, odds, or live-score behavior.

Sample review workflow: `docs/providers/apifootball-com-sample-review-workflow.md`.

The POC is approved only for the guarded local/manual ingestion command for the reviewed football slice. This does not approve production ingestion, scheduled jobs, automatic sync, frontend work, prediction models, odds, or live-score behavior.

Latest local sample review: 2026-04-29 second staged capture succeeded for league `171` (`2. Bundesliga`, Germany) from 2026-04-24 through 2026-04-26. Sanitized samples confirmed teams with absolute badge URLs, finished events with stable match/team IDs and score fields, and standings with stable team IDs and required table fields. The tested football slice is `ready_for_manual_ingestion`.

## Environment Variables

| Variable | Default | Required | Notes |
| --- | --- | --- | --- |
| `APIFOOTBALL_COM_API_KEY` | none | fallback only | Legacy fallback. Must never be committed or logged. |
| `APIFOOTBALL_COM_API_KEY_DEFAULT` | none | fallback only | Used when an endpoint-specific key is not configured. |
| `APIFOOTBALL_COM_API_KEY_COUNTRIES` | none | optional | Preferred for `get_countries`. |
| `APIFOOTBALL_COM_API_KEY_LEAGUES` | none | optional | Preferred for `get_leagues`. |
| `APIFOOTBALL_COM_API_KEY_TEAMS` | none | optional | Preferred for `get_teams`. |
| `APIFOOTBALL_COM_API_KEY_STANDINGS` | none | optional | Preferred for `get_standings`. |
| `APIFOOTBALL_COM_API_KEY_EVENTS` | none | optional | Preferred for historical/current `get_events`. |
| `APIFOOTBALL_COM_API_KEY_RESULTS` | none | optional | Preferred for finished score/result refreshes; falls back through default/legacy when missing. |
| `APIFOOTBALL_COM_API_KEY_FIXTURES` | none | optional | Preferred for upcoming fixture fetches; falls back through default/legacy when missing. |
| `APIFOOTBALL_COM_API_KEY_PLAYERS` | none | optional | Reserved for future dedicated player profile endpoints. |
| `APIFOOTBALL_COM_API_KEY_STATISTICS` | none | optional | Reserved for future match/team statistics endpoints. |
| `APIFOOTBALL_COM_API_KEY_LINEUPS` | none | optional | Reserved for future lineup endpoints. |
| `APIFOOTBALL_COM_API_KEY_INJURIES` | none | conditionally required | Required for the controlled `provider:football:player-availability-sync` command. If missing, the command must exit safely with `missing_injuries_credential` and must not call the provider. |
| `APIFOOTBALL_COM_BASE_URL` | `https://apiv3.apifootball.com/` | yes | Action-based request base URL. |
| `APIFOOTBALL_COM_ENABLED` | `false` | yes | Must remain false by default. |
| `APIFOOTBALL_COM_TIMEOUT_MS` | `15000` | yes | Local HTTP timeout. |

If `APIFOOTBALL_COM_ENABLED=true` and no usable `APIFOOTBALL_COM_API_KEY*` value exists, config fails clearly. If `NODE_ENV=production` and the adapter is enabled, config fails because production provider usage is not approved.

Fallback order is endpoint-specific key, then `APIFOOTBALL_COM_API_KEY_DEFAULT`, then legacy `APIFOOTBALL_COM_API_KEY`.

Request auth uses the apifootball.com documented query parameter `APIkey`. Do not use API-SPORTS headers or alternate query names such as `api_key`, `apikey`, or `key` unless apifootball.com changes its documentation.

## Public Documentation Signals

| Area | Evidence Status | Notes |
| --- | --- | --- |
| Countries | `confirmed` | Sanitized 2026-04-29 local sample confirms `country_id` and `country_name`. |
| Leagues / competitions | `confirmed` | Sanitized 2026-04-29 local sample confirms `league_id`, `league_name`, `country_id`, and `country_name`. |
| Events / fixtures / results | `confirmed` | Sanitized 2026-04-29 local sample for league `171` confirms stable match IDs, league IDs, date/time fields, stable home/away team IDs, status, and score field names. |
| Standings | `confirmed` | Sanitized 2026-04-29 local sample for league `171` confirms stable team IDs, table totals, goals, points, and home/away split field names. |
| Teams | `confirmed` | Sanitized 2026-04-29 local sample for league `171` confirms `team_key`, `team_name`, and absolute `team_badge` URLs. |
| Predictions | `raw_only` | Do not use provider predictions for our own model. |
| Odds | `blocked` | No betting/odds module in this platform. |
| Livescore | `blocked` | No live-score polling or live-score architecture. |

## Operation Mapping

| apifootball.com Action | Platform Operation | Target DTO | Target Normalizer/Table | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| `get_countries` | `list_countries` | `ProviderCountry` | `CountryNormalizer` / `countries` | POC implemented | Maps `country_id`, `country_name`. |
| `get_leagues` | `list_competitions` | `ProviderCompetition` | `CompetitionNormalizer` / `competitions` | POC implemented | Injects football sport provider context as `football`; maps `country_id` when present. |
| `get_teams` | `list_teams` | `ProviderTeam` | `TeamNormalizer` / `teams` | POC implemented | Maps `team_badge` or equivalent logo field to `ProviderTeam.logoUrl`. |
| `get_events` | `list_upcoming_matches`, `list_finished_matches`, `get_match_details` | `ProviderMatch` | `MatchNormalizer` / `matches` | POC implemented | Requires stable home/away team IDs; name-only rows are unresolved. |
| `get_events` | `get_football_match_score` | `ProviderFootballMatchScore` | `FootballMatchScoreNormalizer` / `football_match_scores` | POC implemented | Maps current/fulltime, halftime, extra-time, and penalty score fields when present. |
| `get_standings` | `get_football_standings` | `ProviderFootballStanding` | `FootballStandingNormalizer` / `football_standings` | POC implemented | Requires stable `team_id`; rows without it are unresolved. |
| `get_teams` + nested `players[]` | controlled player availability sync | `ProviderPlayer` + `ProviderFootballPlayerAvailability` | `players`, `football_player_team_memberships`, `football_player_availability` | Controlled implementation | Uses only explicit provider player rows. Missing data means unknown, not healthy squad. |
| `get_H2H` | head-to-head evidence for upcoming/analyzable matches | canonical `matches` + `football_match_scores` for clean rows | `football_head_to_head_features` inputs after feature build | Dry-run/guarded execute implemented | Must run after countries/leagues, teams, and events are mapped. Fetch scoped upcoming/analyzable match pairs only, not all possible team pairs. |
| `get_predictions` | none | none | raw-only/not used | Not implemented | Do not depend on provider predictions. |
| `get_livescore` | none | none | blocked | Not implemented | No live-score polling. |

## Field Mapping Notes

### ProviderCountry

| DTO Field | apifootball.com Field | Status |
| --- | --- | --- |
| `providerEntityId` | `country_id` | `confirmed` |
| `name` | `country_name` | `confirmed` |
| `metadata.source` | constant `apifootball-com` | implemented |

### ProviderCompetition

| DTO Field | apifootball.com Field | Status |
| --- | --- | --- |
| `providerEntityId` | `league_id` | `confirmed` |
| `sportProviderId` | adapter-injected `football` | implemented POC policy |
| `countryProviderId` | `country_id` | `confirmed` |
| `name` | `league_name` | `confirmed` |
| `metadata.countryName` | `country_name` | `confirmed` |

### ProviderTeam

| DTO Field | apifootball.com Field | Status |
| --- | --- | --- |
| `providerEntityId` | `team_key` or `team_id` | `confirmed`; reviewed sample uses `team_key` |
| `sportProviderId` | adapter-injected `football` | implemented POC policy |
| `countryProviderId` | `country_id` if supplied | `unknown` |
| `name` | `team_name` | `confirmed` |
| `logoUrl` | `team_badge`, fallback `team_logo`/`logo`/`badge`/`image` | `confirmed`; reviewed sample uses absolute `team_badge` URLs |
| `metadata.logoMissing` | computed | implemented |

Team logo gate:

- Team logo evidence passes for league `171` because reviewed `get_teams` rows include absolute `team_badge` URLs that can map to `ProviderTeam.logoUrl`.
- Missing individual logos are non-fatal.
- Missing logos must be marked through metadata/logging.
- Logo values must map to `ProviderTeam.logoUrl` and persist to `teams.logo_url`, not only metadata.

### ProviderMatch

| DTO Field | apifootball.com Field | Status |
| --- | --- | --- |
| `providerEntityId` | `match_id` | `confirmed` |
| `competitionProviderId` | `league_id` | `confirmed` |
| `homeTeamProviderId` | `match_hometeam_id` | `confirmed`; required |
| `awayTeamProviderId` | `match_awayteam_id` | `confirmed`; required |
| `scheduledStartAt` | `match_date` + `match_time` | implemented UTC parse policy |
| `status` | `match_status` | confirmed with `Finished`; implemented conservative mapper; numeric live-minute-like values such as `18` remain unsupported and are skipped rather than coerced |
| `roundName` | `match_round` | optional |
| `venueName` | `match_stadium` | optional |
| `refereeName` | `match_referee` | optional |

If stable team IDs are missing, event rows are unresolved. The adapter must not fabricate provider team IDs from names.

### ProviderFootballMatchScore

| DTO Field | apifootball.com Field | Status |
| --- | --- | --- |
| `matchProviderId` | `match_id` | `confirmed` |
| `homeScoreCurrent` / `awayScoreCurrent` | `match_hometeam_score` / `match_awayteam_score` | `confirmed` |
| `homeScoreFullTime` / `awayScoreFullTime` | `match_hometeam_ft_score` or score fallback | implemented POC policy |
| halftime scores | `match_hometeam_halftime_score`, `match_awayteam_halftime_score` | `confirmed` |
| extra-time scores | `match_hometeam_extra_score`, `match_awayteam_extra_score` | `confirmed` |
| penalty scores | `match_hometeam_penalty_score`, `match_awayteam_penalty_score` | `confirmed` |

### ProviderFootballStanding

| DTO Field | apifootball.com Field | Status |
| --- | --- | --- |
| `competitionProviderId` | `league_id` | `confirmed` |
| `teamProviderId` | `team_id` | `confirmed`; required |
| `position` | `overall_league_position` | `confirmed` |
| `played` | `overall_league_payed` | `confirmed`; provider spelling preserved in source field |
| `wins/draws/losses` | `overall_league_W/D/L` | `confirmed` |
| `goalsFor/goalsAgainst` | `overall_league_GF/GA` | `confirmed` |
| `goalDifference` | computed from GF-GA | implemented POC policy |
| `points` | `overall_league_PTS` | `confirmed` |
| home/away splits | `home_*`, `away_*` fields | `confirmed` |

Rows without stable `team_id` are unresolved and must not be sent to the standing normalizer.

### Controlled Player Availability Notes

- Current controlled support uses `get_teams` team payloads when they include nested `players[]` rows and explicit injury-like flags such as `player_injured`.
- Dedicated `get_injuries` field evidence is still incomplete; do not invent suspension data and do not infer injuries from lineup absence alone.
- Only explicit unavailability context should normalize into `football_player_availability`.
- Missing player availability data must be treated as `unknown`, not "full squad" or "no injuries".
- Public/member APIs may expose only safe fields such as player name, team, status, reason, expected return date, and freshness. They must never expose provider IDs or raw payloads.

### Future H2H Evidence

APIFootball H2H onboarding must be scoped to upcoming or otherwise analyzable matches after canonical dependencies are in place. It is not a broad pair-expansion job.

Implemented guarded commands:

```bash
npm run provider:apifootball:h2h:evidence -- --match-id=<match-uuid>
npm run provider:apifootball:h2h:ingest -- --match-id=<match-uuid>
```

Both commands are dry-run/read-only by default. The ingest command requires `--execute` for writes and supports one target match at a time. Strict execute remains the default: any skipped row blocks writes. Admins can opt into `--allow-partial --minimum-clean-rows=3` for reviewed/enabled leagues when skipped rows are only `missing_competition_mapping` or `unsupported_competition_scope`. Partial execute normalizes only clean direct H2H rows into canonical `matches` and `football_match_scores`, creates/reuses provider match mappings for those clean rows, reports skipped row counts/reasons, and leaves raw payload persistence at zero. Rows with missing provider match IDs, unmapped teams, unstable pair identity, unparseable dates, or unparseable scores still block execute. The command never creates fake competitions, teams, matches, or provider IDs, and it does not run feature builders, prediction candidates, settlement, public/member-visible mutations, tahmin kombini, scheduler work, or raw payload cleanup.

The reviewed/enabled league wrapper `npm run provider:apifootball:h2h:backfill-upcoming -- --country-id=<id> --league-id=<id>` batches that same one-match H2H planning path across upcoming `not_started` matches. It is dry-run by default, can be narrowed by date range, analysis window, or limit, and executes only matches whose individual H2H report is safe. It reports skipped matches and skipped row reasons; it does not broaden H2H to all historical pairs or create fake competition/team/match identifiers.

H2H dry-run should report, when the provider supplies the fields:

- provider match IDs
- past match dates
- home and away provider team IDs
- mapped canonical home and away team IDs
- mapped canonical match references when possible
- fulltime score fields
- halftime score fields
- unresolved row counts
- safe credential labels only

H2H pass criteria:

- Provider responds successfully or cleanly reports no H2H data.
- Team IDs are stable.
- Match IDs are stable when provided.
- Fulltime scores are parseable when present.
- Halftime scores are parseable when present.
- Unresolved rows are reported and block execute unless an explicit acceptance policy is documented.
- No fake provider IDs, team IDs, or match IDs are created.
- Dry-run writes zero database rows.

H2H is a supporting causal signal. It may strengthen or weaken goal profile, BTTS, and over/under reasoning when sample size, recency, and coverage are meaningful. Missing H2H should lower the confidence ceiling and add risk context, not automatically block MVP readiness when current team-form evidence is strong. Old or low-sample H2H should be downweighted, and H2H that contradicts current form should become a risk warning rather than an automatic decision.

## Local Sample Capture

Manual command:

```bash
npm run provider:apifootball:capture:samples
```

Local auth-only check:

```bash
npm run provider:apifootball:auth:check
```

This command:

- Requires `APIFOOTBALL_COM_API_KEY`.
- Refuses `NODE_ENV=production`.
- Writes sanitized local snippets to `.provider-samples/apifootball-com/`.
- Writes sanitized provider errors to `*.error.sample.json` files when the provider returns an auth, plan, quota, or HTTP error response.
- Never writes to the database.
- Never calls `ProviderIngestionService`.
- Never schedules jobs.
- Trims payload size and redacts the key.
- Redacts the `APIkey` query parameter in displayed URLs and local error samples.
- Supports staged capture: countries and leagues can be captured before league/date filters are known.
- Skips event capture with a clear message when `APIFOOTBALL_COM_SAMPLE_LEAGUE_ID`, `APIFOOTBALL_COM_SAMPLE_FROM`, or `APIFOOTBALL_COM_SAMPLE_TO` is missing.
- Skips standings and teams with a clear message when `APIFOOTBALL_COM_SAMPLE_LEAGUE_ID` is missing.

Optional sample filters:

- `APIFOOTBALL_COM_SAMPLE_COUNTRY_ID`
- `APIFOOTBALL_COM_SAMPLE_LEAGUE_ID`
- `APIFOOTBALL_COM_SAMPLE_FROM`
- `APIFOOTBALL_COM_SAMPLE_TO`

After capture, review local files using `docs/providers/apifootball-com-sample-review-workflow.md`. Do not commit `.provider-samples/`; only record sanitized field evidence, unresolved blockers, and gate decisions in documentation.

## Local Manual Ingestion

Manual command:

```bash
npm run provider:apifootball:ingest:manual -- \
  --country-id=4 \
  --league-id=171 \
  --from=2026-04-24 \
  --to=2026-04-26
```

Execute mode:

```bash
APIFOOTBALL_COM_ENABLED=true \
npm run provider:apifootball:ingest:manual -- \
  --execute \
  --country-id=4 \
  --league-id=171 \
  --from=2026-04-24 \
  --to=2026-04-26
```

Rules:

- Dry-run is the default and calls the provider only for safe counts and mapping summaries.
- `--execute` is required before any database write.
- Execute mode runs database readiness checks before any provider fetch or write.
- The command refuses `NODE_ENV=production`.
- The command requires `APIFOOTBALL_COM_ENABLED=true` and `APIFOOTBALL_COM_API_KEY`, but never prints the key.
- Execute mode is restricted to reviewed and enabled leagues: `country_id=4`, `league_id=171` (`2. Bundesliga`), `country_id=4`, `league_id=175` (`Bundesliga`), `country_id=111`, `league_id=322` (`Süper Lig`, Turkey), `country_id=44`, `league_id=152` (`Premier League`, England), `country_id=6`, `league_id=302` (`La Liga`, Spain), `country_id=5`, `league_id=207` (`Serie A`, Italy), `country_id=3`, `league_id=168` (`Ligue 1`, France), and `country_id=82`, `league_id=244` (`Eredivisie`, Netherlands).
- Review candidates can dry-run only when `dryRunAllowed=true`; `--execute` remains blocked until a league is explicitly `reviewed=true` and `enabled=true`.
- Unknown leagues and configured candidates with `dryRunAllowed=false` are blocked in dry-run and execute mode.
- France Ligue 1 is reviewed/enabled: `country_id=3`, `league_id=168`, `league_name=Ligue 1`, `dryRunAllowed=true`, `reviewed=true`, and `enabled=true`. Discovery selected the exact France `Ligue 1` row; similar competitions found during discovery include France Ligue 2, Coupe de la Ligue, National 1/2/3, Première Ligue, Trophée des Champions, plus non-France `Ligue 1` rows in other countries. Review evidence: teams/logos 18/18, standings 18/18, upcoming events 9/9, recent finished events/scores 9/9, FT/HT scores 9/9, unresolved rows 0. A narrow countries/leagues execute is required before data execute because the competition mapping is not yet present on the current test branch.
- Netherlands Eredivisie is reviewed/enabled: `country_id=82`, `league_id=244`, `league_name=Eredivisie`, `dryRunAllowed=true`, `reviewed=true`, and `enabled=true`. Discovery selected the exact Netherlands `Eredivisie` row; similar Dutch competitions found during discovery include KNVB Beker (`243`, `1194`), Eerste Divisie (`245`), Derde Divisie (`242`), Eredivisie Women (`481`), Reserve League (`721`), Super Cup (`391`), Tweede Divisie (`584`), and U18/U19/U21 Divisie rows. Review evidence: teams 22/22, logos 21/22 with one missing non-fatal, one standings-name enrichment, standings 18/18, recent finished events/scores 8/8 with FT/HT scores 8/8, and upcoming events/scores 10/11 with one safely skipped `After Pen.` non-standard status. `After Pen.` remains skipped unless an explicit policy is added and must not create normal score rows. A narrow countries/leagues execute is required before data execute because the competition mapping is not yet present on the current test branch.
- Italy Serie A is reviewed/enabled: `country_id=5`, `league_id=207`, `league_name=Serie A`, `dryRunAllowed=true`, `reviewed=true`, and `enabled=true`. Discovery selected the exact Italy `Serie A` row; similar leagues found during discovery include Serie B, Serie C, Serie D, Serie A Women, Coppa Italia, Super Cup, Primavera leagues/cups, and non-Italy Serie A names in Brazil/Mexico. Review evidence: teams/logos 20/20 with 19/20 logos and one exact standings-name enrichment, standings 20/20, recent finished events/scores 10/10 with FT/HT scores 10/10, and upcoming events/scores 9/10. Initial upcoming evidence for 2026-05-01 to 2026-05-07 found one live row, provider match `615673`, with numeric `match_status` values observed as minute-like live values. The safe policy is to skip unsupported numeric live statuses and never map them to `finished` or create fake fulltime scores. This caveat is non-fatal for review approval because finished-score evidence is clean; a later refresh should ingest the row after APIFootball returns a supported final/scheduled status.
- Spain La Liga is reviewed/enabled: `country_id=6`, `league_id=302`, `league_name=La Liga`, `dryRunAllowed=true`, `reviewed=true`, and `enabled=true`. Discovery selected the exact Spain `La Liga` row; similar Spanish competitions found during discovery include Segunda División, Copa del Rey, Super Cup, Primera División RFEF, and Primera División Femenina. Review evidence: teams/logos 20/20, standings 20/20, upcoming events 10/10, recent finished events/scores 10/10, FT/HT scores 10/10, unresolved rows 0. A narrow countries/leagues execute is required before data execute because the competition mapping is not yet present on the current test branch.
- England Premier League is reviewed/enabled: `country_id=44`, `league_id=152`, `league_name=Premier League`, `dryRunAllowed=true`, `reviewed=true`, and `enabled=true`. Discovery found similar league names, but the exact England Premier League candidate is `league_id=152`. Review evidence: teams/logos 20/20, standings 20/20, events/scores 10/10, unresolved rows 0. A narrow countries/leagues execute is required before data execute because the competition mapping is not yet present on the current test branch.
- Süper Lig team evidence found two APIFootball `get_teams` rows with stable `team_key` but missing `team_name` and logo fields. Both exact team IDs appear in standings/events, and standings provides `team_name`. The manual ingestion path enriches only the missing team name from the same-league standings row with the exact same provider team ID. It does not infer logos or fabricate IDs. Süper Lig is reviewed/enabled after teams mapped 18/18, standings mapped 18/18, and events mapped 9/9 in dry-run evidence; the 2 missing logos are non-fatal.
- Süper Lig prediction readiness is not approved yet. On the approved non-production test branch, normalized evidence currently includes 18 teams, 16 logos, 18 standings rows, 38 finished matches, 9 upcoming matches, 38 score rows, and 38/38 halftime score coverage. All upcoming matches remain `partial` because scoped home/away samples are low and H2H is 0 for every upcoming matchup. Samsunspor vs Galatasaray is the best available target but remains `partial` with combined coverage 40. Süper Lig is therefore analysis-only: no forced candidate generation, draft persistence, tahmin kombini inclusion, member visibility, or public publishing.
- `--from` and `--to` are required for events and scores, and the date range must be seven days or fewer.
- Supported operations are `countries`, `leagues`, `teams`, `events`, `scores`, and `standings`; omitted `--operations` runs all reviewed operations.
- Execute mode writes raw payload records through `ProviderIngestionService` and immediately processes them with `RawPayloadProcessor` in dependency order.
- No scheduler, cron, worker polling loop, production sync, live polling, frontend, prediction, odds, or broad provider rollout is added.

### Historical Backfill Runner

Reviewed/enabled football leagues can use a faster, still manual backfill runner for finished match history:

```bash
APIFOOTBALL_COM_ENABLED=true \
npm run provider:apifootball:backfill-history -- \
  --country-id=44 \
  --league-id=152 \
  --from=2026-04-01 \
  --to=2026-04-30 \
  --batch-days=14
```

Rules:

- Review candidates remain limited to 7-day evidence dry-runs through the manual ingestion command.
- Reviewed/enabled leagues may use max 14-day historical `events,scores` batches.
- Dry-run is the default and writes nothing.
- `--execute` still performs a dry-run before every batch execute.
- The command is manual only and refuses production/main DB targets.
- The command stops on unresolved/skipped rows, provider failures, the configured empty-batch limit, optional `--target-finished`, or end of range.
- Reports include safe credential labels only and never include raw API keys, partial keys, DB credentials, raw payload bodies, prediction output changes, or frontend-visible secrets.
- The runner does not run feature builders, prediction generation, settlement, public/member-visible mutations, tahmin kombini, scheduler work, or raw payload cleanup.

The command stores provider DTO payloads for normalizer compatibility, with sanitized provider raw context preserved inside DTO `raw` fields where the APIFootball.com mapper supplies it. It does not write canonical tables directly from the adapter.

Database readiness:

- Run `npm run db:check` before execute mode.
- The check reads `DATABASE_URL`, refuses production/Neon/remote managed targets by default, and reports only sanitized host, port, database name, SSL mode, branch name when provided, and classification.
- It verifies a basic query and expected tables. If tables are missing, run migrations before ingestion.
- If PostgreSQL is unreachable, start a local server manually, use Docker Compose when Docker is installed, or point `DATABASE_URL` to an existing disposable local PostgreSQL database.
- Neon test branches are allowed only with `DB_EXECUTION_TARGET=neon-test` and `ALLOW_REMOTE_TEST_DB=true`.
- `DATABASE_URL` and `NEON_BRANCH_NAME` must not look like main, prod, or production.
- Do not use Neon main, Neon production, or broad remote managed databases for first ingestion.

Team logo handling:

- `team_badge` maps to `ProviderTeam.logoUrl`.
- Missing individual logos are non-fatal.
- Missing logos are counted and marked through `metadata.logoMissing`.
- Logo values must not be stored only in metadata.

Season handling:

- APIFootball.com reviewed responses do not provide a stable season provider ID for this slice.
- The command does not fabricate season IDs.
- Matches and football standings use nullable season behavior already supported by the normalizers and schema.

## Authentication Troubleshooting

Use `npm run provider:apifootball:auth:check` first. It checks `get_countries` only, refuses production, and does not print the key.

Common causes:

- Missing key: `APIFOOTBALL_COM_API_KEY` is not present in local `.env` or the current shell.
- Invalid key: the value was copied incorrectly, rotated, revoked, or belongs to another account.
- Inactive key: the provider account, trial, email verification, billing, or subscription is not active yet.
- Wrong provider website: this POC targets `apifootball.com`, not `api-football.com / API-SPORTS`.
- Wrong base URL: `APIFOOTBALL_COM_BASE_URL` should be `https://apiv3.apifootball.com/` unless apifootball.com documentation says otherwise.
- Exhausted or restricted plan: a free/trial plan may return quota, subscription, or endpoint restriction messages.
- Provider auth parameter mismatch: the client intentionally sends `APIkey`; changing casing or using header auth can cause provider rejection.

When authentication fails, inspect only the sanitized `.provider-samples/apifootball-com/*.error.sample.json` file. It may include the redacted request URL, error kind, HTTP status, provider message, and sanitized response body.

## Local Sample Review Log

| Date | Local Files Reviewed | Result | Confirmed Fields | Gate Impact |
| --- | --- | --- | --- | --- |
| 2026-04-29 | `get_countries.error.sample.json` | v1 base URL returned provider authentication failure. API key value remained redacted in the local error sample. | none | Switched default base URL to v3 before retrying. |
| 2026-04-29 | `get_countries.sample.json`, `get_leagues.sample.json` | Staged capture succeeded with v3 base URL. `get_events`, `get_standings`, and `get_teams` were skipped because no sample league ID was set. | Countries: `country_id`, `country_name`. Leagues: `league_id`, `league_name`, `country_id`, `country_name`. Candidate next league: `171` (`2. Bundesliga`, Germany). | Keep `research_more`; next stage should capture teams, standings, and narrow date-range events for one league. |
| 2026-04-29 | `get_teams.sample.json`, `get_events.sample.json`, `get_standings.sample.json` | Second staged capture succeeded for league `171` (`2. Bundesliga`, Germany) and date range 2026-04-24 to 2026-04-26. Local samples are trimmed and redacted; field presence was reviewed from sanitized response shape metadata. | Teams: `team_key`, `team_name`, absolute `team_badge`. Events: `match_id`, `league_id`, `match_date`, `match_time`, stable home/away IDs and names, `Finished` status, fulltime/halftime/extra/penalty score field names. Standings: `team_id`, `team_name`, position, played/W/D/L, goals for/against, points, and home/away split field names. | Mark `ready_for_manual_ingestion` for the tested football slice only; production use remains blocked. |

## Manual Ingestion Gate

Current decision: `ready_for_manual_ingestion` for the tested football slice only.

The reviewed slice satisfies:

- Countries and leagues are confirmed from sanitized samples.
- Countries/leagues execute is required before teams, standings, events, scores, or future H2H execute so country and competition mappings exist first.
- Teams are confirmed from sanitized samples.
- Team logo availability is confirmed or explicitly unavailable with an accepted missing-logo policy.
- Events confirm stable `match_id`, `league_id`, and stable home/away team identities.
- Score fields and status mapping are confirmed from finished event samples.
- Standings are confirmed or explicitly blocked because stable `team_id` is missing.
- Future H2H evidence must be gathered only for upcoming/analyzable matches after teams/events are mapped, with dry-run-first pass criteria documented above.
- No API key or private provider data appears in documentation, logs, tests, or committed files.
- `.provider-samples/` remains ignored and local-only.

This state permits guarded local/manual execute only for reviewed/enabled football slices, now including Süper Lig. This does not approve production sync, scheduled jobs, live polling, frontend use, prediction models, odds, or broad provider rollout.

Manual ingestion runs now emit sanitized `ingestionRunReport` summaries in console output. `--report-json` can additionally persist the same report under ignored `.provider-runs/apifootball-com/` for local audit history without writing API keys, database credentials, or raw provider payload bodies.

When a failed APIFootball raw payload becomes recoverable after a mapping fix, the approved retry path is `npm run provider:raw-payload:reprocess -- --raw-payload-id=<uuid>`. It is dry-run by default, supports one explicit failed APIFootball `football_standing` payload at a time, performs dependency checks for competition/team mappings, and never refetches provider data or deletes raw payloads. This exists for dependency repair cases such as Süper Lig standings failing before league `322` had a competition provider mapping.

## Non-Goals

- No production ingestion.
- No scheduled jobs.
- No live-score polling.
- No predictions endpoint dependency.
- No odds module.
- No basketball adapter.
- No frontend.
- No prediction model.

## Player / Availability Evidence

Current project evidence treats these APIFootball actions as cautiously usable for football:

- `get_teams` with nested `players[]` for squad / player-list normalization
- `get_teams` with injury credential for explicit player availability rows when the provider marks a player as injured / doubtful / unavailable
- `get_lineups` for starting XI / substitutes when the payload is present

Important:

- no suspension is inferred unless the provider says so explicitly
- no injury is inferred from a missing lineup appearance alone
- no provider IDs or raw payload bodies should surface in member APIs
