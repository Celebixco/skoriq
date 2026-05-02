# apifootball.com Sample Capture Review Workflow

## Purpose

This workflow explains how to run the local apifootball.com sample capture script, review sanitized sample files, update provider evidence, and decide whether the adapter can move from `local_poc_only` / `research_more` toward `ready_for_manual_ingestion`.

This is a review workflow only. It does not approve production ingestion, scheduled jobs, automatic sync, frontend work, prediction models, odds, or live-score behavior.

Provider naming warning: `apifootball.com` is different from `api-football.com / API-SPORTS`. Do not mix request formats, endpoint names, pricing, response fields, or evidence status between them.

## Safety Rules

- Never commit API keys, full request URLs containing keys, headers, cookies, account data, or private provider responses.
- Never paste `APIFOOTBALL_COM_API_KEY` into documentation, test snapshots, logs, or issue comments.
- Never run sample capture with `NODE_ENV=production`.
- Never commit `.provider-samples/`; it must remain gitignored and local-only.
- Use narrow date ranges and small samples only.
- Capture representative response shape, not huge payload dumps.
- Do not write samples to the database.
- Do not call `ProviderIngestionService` from sample review.
- Do not schedule provider jobs from this workflow.

## Local Sample Capture

Run the local capture command only after the exposed key has been rotated and the replacement key is available through the local environment.

```bash
APIFOOTBALL_COM_SAMPLE_COUNTRY_ID=<COUNTRY_ID> \
APIFOOTBALL_COM_SAMPLE_LEAGUE_ID=<LEAGUE_ID> \
APIFOOTBALL_COM_SAMPLE_FROM=<YYYY-MM-DD> \
APIFOOTBALL_COM_SAMPLE_TO=<YYYY-MM-DD> \
npm run provider:apifootball:capture:samples
```

Keep `APIFOOTBALL_COM_API_KEY` in local `.env` or another local environment source. Do not paste it into command history, docs, sample files, logs, tickets, or chat.

To check only local authentication wiring before capture:

```bash
npm run provider:apifootball:auth:check
```

Required:

- `APIFOOTBALL_COM_API_KEY`

Optional filters:

- `APIFOOTBALL_COM_ENABLED=true`
- `APIFOOTBALL_COM_SAMPLE_COUNTRY_ID`
- `APIFOOTBALL_COM_SAMPLE_LEAGUE_ID`
- `APIFOOTBALL_COM_SAMPLE_FROM`
- `APIFOOTBALL_COM_SAMPLE_TO`

The capture script supports staged sampling:

- Without `APIFOOTBALL_COM_SAMPLE_LEAGUE_ID`, it still captures `get_countries` and `get_leagues`, then skips `get_events`, `get_standings`, and `get_teams` with clear local messages.
- Without both `APIFOOTBALL_COM_SAMPLE_FROM` and `APIFOOTBALL_COM_SAMPLE_TO`, it skips `get_events` with a clear local message and still captures countries, leagues, and league-scoped samples when possible.
- `APIFOOTBALL_COM_API_KEY` is always required.
- Provider failures are written as sanitized `*.error.sample.json` files under `.provider-samples/apifootball-com/`.
- Displayed request URLs always redact the `APIkey` query parameter as `<redacted>`.

Recommended capture pattern:

- Start with countries and leagues if league/date filters are not known yet.
- Add one known football country and one known league for the second pass.
- Use a narrow finished-match date range, ideally one to three days.
- Capture teams for the selected league before reviewing events or standings.
- Keep generated files under `.provider-samples/apifootball-com/`.

## Auth Troubleshooting

If `get_countries` or `get_leagues` returns an authentication failure, check these items before retrying:

- Missing key: confirm `APIFOOTBALL_COM_API_KEY` exists in local environment or `.env`; never print the value.
- Invalid key: rotate or re-copy the key from the provider dashboard, then retry the local auth check.
- Inactive key: confirm the key is enabled on the provider account and not awaiting email, billing, trial, or account activation.
- Wrong provider website: `apifootball.com` is not `api-football.com / API-SPORTS`; keys and endpoint formats are not interchangeable.
- Wrong base URL: confirm `APIFOOTBALL_COM_BASE_URL` is `https://apiv3.apifootball.com/` unless provider docs explicitly instruct otherwise.
- Exhausted or restricted plan: free/trial plans may block some endpoints, expire, or return quota/plan messages; inspect only the sanitized local error sample.
- Auth parameter mismatch: apifootball.com uses the query parameter `APIkey` with that casing. Do not switch to `api_key`, `apikey`, `key`, headers, or API-SPORTS request formats unless apifootball.com documentation changes.

For every retry, keep the key out of terminal output. Prefer loading the key from `.env` and running:

```bash
npm run provider:apifootball:auth:check
```

## Sample Review Checklist

Each reviewed sample should record:

- Capture date.
- Local sample filename.
- Provider action.
- Request parameters without API key.
- Whether the response is an array, object, empty result, or provider error.
- Whether required DTO fields are present.
- Whether optional fields are present.
- Whether any field requires transformation.
- Whether the row can be normalized, is unresolved, or should remain raw-only.

### Countries

Target: `ProviderCountry` -> `CountryNormalizer` -> `countries`.

Review:

- Stable `country_id` exists.
- `country_name` exists.
- `country_id` maps to `ProviderCountry.providerEntityId`.
- `country_name` maps to `ProviderCountry.name`.
- Empty or malformed rows fail mapping clearly.

Gate result:

- Confirm `list_countries` only when a sanitized sample shows stable `country_id` and `country_name`.

### Leagues / Competitions

Target: `ProviderCompetition` -> `CompetitionNormalizer` -> `competitions`.

Review:

- Stable `league_id` exists.
- `league_name` exists.
- `country_id` exists when returned.
- `country_name` exists when returned.
- `league_id` maps to `ProviderCompetition.providerEntityId`.
- `league_name` maps to `ProviderCompetition.name`.
- `country_id` maps to `ProviderCompetition.countryProviderId` when available.
- Football sport context remains adapter-injected and provider-agnostic.

Gate result:

- Confirm `list_competitions` only when a sanitized sample shows stable league identity and competition name.

### Teams

Target: `ProviderTeam` -> `TeamNormalizer` -> `teams`.

Review:

- Stable team ID exists, such as `team_key` or `team_id`.
- Team name exists.
- Team badge/logo field exists when available, such as `team_badge`, `team_logo`, `logo`, `badge`, or `image`.
- Logo URL maps to `ProviderTeam.logoUrl`.
- Logo URL is absolute or has a documented safe transformation policy.
- Logo URL appears stable enough for canonical team profile storage.
- Missing individual logo does not fail mapping.
- Missing individual logo is marked through metadata or future adapter diagnostics.
- Logo is not buried only in metadata when `teams.logo_url` exists.

Gate result:

- Team ingestion is not field-complete until team logo availability is confirmed or explicitly marked unavailable with an accepted policy.

### Events / Fixtures / Scores

Targets:

- `ProviderMatch` -> `MatchNormalizer` -> `matches`.
- `ProviderFootballMatchScore` -> `FootballMatchScoreNormalizer` -> `football_match_scores`.

Review:

- Stable `match_id` exists.
- Stable `league_id` exists.
- `match_date` and `match_time` exist or a safe timestamp alternative exists.
- Stable home team ID exists.
- Stable away team ID exists.
- Home and away names are present for review context.
- Name-only teams are treated as unresolved; do not generate fake provider team IDs from names.
- `match_status` maps to a supported provider-agnostic status.
- Final score fields exist for finished samples.
- Halftime score fields are present or documented unavailable.
- Extra-time and penalty score fields are present or documented unavailable.
- Venue, referee, and round fields are optional and mapped only when safe.

Gate result:

- Confirm event-to-match mapping only when stable match, competition, and team identities are present.
- Confirm score mapping only when score fields are observed and status handling is reviewed.

### Standings

Target: `ProviderFootballStanding` -> `FootballStandingNormalizer` -> `football_standings`.

Review:

- Stable league ID is present or request context reliably supplies it.
- Stable team ID exists.
- Team name exists for review context.
- Position field exists.
- Played, wins, draws, losses fields exist.
- Goals for and goals against fields exist.
- Points field exists.
- Home and away split fields are present or documented unavailable.
- Goal difference can be mapped or safely computed from goals for and against.

Gate result:

- Confirm standing mapping only when stable `team_id` exists.
- If standings return team names without stable IDs, mark standing normalization `blocked` and keep data raw-only until identity is resolved.

## Evidence Status Update Rules

| Status | Use When |
| --- | --- |
| `confirmed` | A reviewed sanitized sample proves the field exists and maps to the DTO. |
| `likely` | Public docs show the field or endpoint family, but no reviewed sample confirms it. |
| `unknown` | Neither docs nor reviewed samples prove the field. |
| `unavailable` | Reviewed samples or provider docs clearly show the field is absent. |
| `blocked` | Required access, identity, terms, or field semantics prevent safe normalization. |
| `raw_only` | The field exists but should not be normalized into current canonical tables. |

Only update `confirmed` after checking sanitized local sample files. Do not mark fields confirmed from memory, screenshots without field context, or provider marketing pages.

## Adapter Gate Movement

Current status:

- Local POC adapter: implemented.
- Production adapter: `research_more`.
- Manual ingestion readiness: approved only for the reviewed football slice.

Move toward `ready_for_manual_ingestion` only when all of these are true:

- Countries sample is confirmed.
- Leagues sample is confirmed.
- Teams sample is confirmed.
- Team logo evidence is confirmed or explicitly unavailable with an accepted policy.
- Events sample is confirmed.
- Stable `match_id` is confirmed.
- Stable home/away team identity strategy is confirmed.
- Football score fields are mapped from reviewed samples.
- Standings are mapped or explicitly documented as blocked due missing stable team IDs.
- No API key or private auth data appears in docs, logs, tests, or sample snippets.
- `.provider-samples/` remains gitignored and no sample files are committed.

`ready_for_manual_ingestion` does not mean production-ready. It only permits the guarded local/manual command for the reviewed football slice.

## Manual Ingestion Readiness Notes

The reviewed football slices now have a local/manual ingestion command. It remains dry-run by default and is restricted to reviewed `country_id=4` with `league_id=171` (`2. Bundesliga`) or `league_id=175` (`Bundesliga`).

Dry-run example:

```bash
APIFOOTBALL_COM_ENABLED=true \
npm run provider:apifootball:ingest:manual -- \
  --country-id=4 \
  --league-id=171 \
  --from=2026-04-24 \
  --to=2026-04-26
```

Execute example:

```bash
APIFOOTBALL_COM_ENABLED=true \
npm run provider:apifootball:ingest:manual -- \
  --execute \
  --country-id=4 \
  --league-id=171 \
  --from=2026-04-24 \
  --to=2026-04-26
```

Manual ingestion rules:

- `--execute` is required for database writes.
- `NODE_ENV=production` is refused.
- Execute mode runs database readiness checks before provider fetch or writes.
- Dates are required for events and scores, with a maximum seven-day range.
- Operations can be restricted with `--operations=countries,leagues,teams,events,scores,standings`.
- Execute mode writes raw payload records through `ProviderIngestionService` and processes them inline through `RawPayloadProcessor`.
- Execute mode prints a safe post-run verification report by default. The report includes canonical counts, team logo coverage, raw payload status distribution, failed raw payload count, unresolved/skipped rows from the current run, and whether before/after canonical counts decreased unexpectedly.
- Every run also emits a sanitized `ingestionRunReport` with command context, counts, timing, duration, result status, and warnings.
- Add `--report-json` to persist the sanitized run report under ignored `.provider-runs/apifootball-com/`; this does not write API keys, database credentials, or raw provider payload bodies.
- Dry-run does not query the database unless `--verify-after` is explicitly supplied for a read-only verification check.
- The verification report must not include API keys, database usernames, passwords, or connection strings, and it does not delete or clean up failed payloads.
- No worker is required for this command because processing is inline; the normal worker service remains available for queued raw-payload jobs from other flows.
- Rollback is manual: use a disposable local database or reset local test data before execute-mode experiments.
- The command does not add a scheduler, cron, queue polling loop, production run path, automatic provider sync, live polling, frontend, prediction, odds, or broad provider rollout.

Database readiness:

- Run `npm run db:check` before execute mode.
- If Docker is installed, local Postgres can be started with `docker compose -f docker/local/compose.yml up -d`.
- If Docker is unavailable, start PostgreSQL manually or use an existing disposable local PostgreSQL database.
- Run migrations after the database is reachable.
- For a Neon test branch, create a non-main/non-production branch and set `DATABASE_URL` to that branch only.
- Set `DB_EXECUTION_TARGET=neon-test` and `ALLOW_REMOTE_TEST_DB=true`; optionally set `NEON_BRANCH_NAME` for display in `db:check`.
- Run migrations against the test branch, then run `npm run db:check`.
- Do not use Neon main, Neon production, or broad remote managed databases for first ingestion.

## Production Safety Notes

- The adapter remains disabled by default.
- The adapter remains blocked in production.
- There are no scheduled jobs.
- There is no automatic ingestion.
- API key usage is environment-only.
- Sample files are local-only and ignored by git.
- HTTP helper and adapter errors must redact keys.
- Team logos must map to `ProviderTeam.logoUrl` when present.
- Missing team logos must be tracked without failing individual team mapping.

## Review Output Template

Use this short template when updating evidence after a local review:

```md
### Review: apifootball.com <action> sample

- Capture date:
- Local file:
- Request params, no key:
- Response shape:
- Required fields confirmed:
- Missing fields:
- Unresolved rows:
- DTO mapping decision:
- Evidence status changes:
- Gate impact:
- Reviewer notes:
```
