# SkorIQ

SkorIQ — Veri Destekli Maç Analizi.

SkorIQ (`skoriq.com`) is a protected match-analysis platform for inspecting normalized football and basketball data, analytics readiness, feature coverage, and reasoning signals. The repository still keeps internal package, table, and script names stable to avoid unnecessary churn.

This is not a live-score platform. The MVP intentionally avoids second-by-second updates, live WebSockets, TimescaleDB, ClickHouse, Kafka, and paid managed queue/cache infrastructure.

Current Tahmin foundation status:

- Draft football Tahmin candidates can be generated, consistency-checked, and persisted as internal audit rows.
- Draft review API/dashboard screens are authenticated and read-only.
- Football prediction settlement foundation can evaluate existing outputs against normalized football scores with a manual dry-run-first command.
- Settlement does not publish predictions, does not make outputs member-visible, does not create public successful prediction cards, and does not power tahmin kombini.
- Public eligibility foundation can dry-run which settled successful outputs would be future public candidates; it does not mutate statuses or create public cards.
- Football goal-feature expansion is underway so future Tahmin outputs can focus on explainable goal profiles such as MS 1.5 Üst, MS 2.5 Alt, İY 0.5 Üst, KG Var/Yok, and team-total goals before exact score work. Implemented slices now add team-form goal rates, first-half goal evidence, match-level goal-profile proxy snapshots, and dry-run candidate generation that consumes those profiles. The signal map documents feature -> signal -> causal reasoning -> prediction support.

Dashboard overview:

- `GET /api/dashboard/overview` is the protected read-only home-page API.
- Members receive compact analytics counts, upcoming match summaries, coverage averages, and member-safe prediction preview items.
- Admins receive the same payload plus a small `admin` summary for internal review counts.
- The endpoint does not call providers, run ingestion, write to the database, publish predictions, mark outputs member-visible, or expose admin/internal audit details to members.

Member-safe prediction preview:

- `GET /api/member/football/matches/:matchId/prediction-preview` returns a protected, sanitized match-level prediction preview for authenticated members and admins.
- Pre-match draft generation now uses a configurable 36-hour window by default: `FOOTBALL_PREMATCH_WINDOW_HOURS=36` and `FOOTBALL_PREMATCH_MINIMUM_LEAD_MINUTES=30`.
- `npm run pipeline:football:daily-prematch -- --all-reviewed-enabled --execute` is the documented daily 09:00 Europe/Istanbul scan command. It uses normalized DB data only and keeps outputs draft-only.
- `npm run provider:football:finished-sync -- --all-reviewed-enabled --lookback-hours=72 --execute` refreshes recent final scores for reviewed/enabled leagues only.
- `npm run analytics:football:settle-predictions -- --all-reviewed-enabled --lookback-hours=96 --execute` stores internal settlement results without publishing or changing member visibility.
- `GET /api/football/prediction-results` and `/summary` power the member-safe Tahmin Sonuçları page.
- It is separate from admin draft review endpoints and does not expose conflicts, raw metadata, expectation snapshots, audit-only rows, blocked/avoid candidates, provider IDs, or generated-after-kickoff candidates.
- It does not publish predictions, mark outputs member-visible, run settlement, call providers, run ingestion, or generate tahmin kombini output.

Manual settlement preview:

```bash
npm run analytics:football:predictions:settle -- --match-id=<match-uuid>
```

Add `--execute` only for an approved local or Neon test branch when internal settlement rows/status updates are intentionally desired.

Manual public eligibility preview:

```bash
npm run analytics:football:public-eligibility:evaluate -- --match-id=<match-uuid>
```

This command is dry-run only. It reports eligible/excluded settled outputs and suggested public copy, but writes zero rows, does not set `public_eligible`, and does not publish anything.

## Services

- `apps/api`: NestJS HTTP API.
- `apps/worker`: BullMQ worker service.
- `apps/scheduler`: freshness and cleanup scheduler.
- `packages/database`: Drizzle PostgreSQL schema and database client.
- `packages/providers`: provider interfaces and DTOs.
- `packages/normalizers`: provider DTO to canonical model contracts.
- `packages/analysis`: analysis feature builder contracts.
- `packages/queue`: queue names and job contracts.

## Persistence Foundation

The current repository layer supports the pipeline foundation only. It does not fetch Sofascore or any real provider data yet.

Raw payload lifecycle:

- Provider responses will be inserted into `raw_provider_payloads` before normalization.
- Insert helpers compute stable request and payload hashes when not provided.
- Successful payloads become cleanup-ready after `RAW_PAYLOAD_SUCCESS_RETENTION_DAYS`.
- Failed payloads are retained longer using `RAW_PAYLOAD_FAILED_RETENTION_DAYS`.

Provider mapping lifecycle:

- External provider IDs are mapped to internal canonical UUIDs through `provider_mappings`.
- Public APIs must use canonical IDs and should not expose provider IDs by default.
- Mapping helpers use database uniqueness for idempotency and race safety.

Sync job lifecycle:

- `sync_jobs` tracks queued/running/succeeded/failed state, queue name, job name, provider, entity type, provider entity ID, timestamps, duration, and failure reason.
- `sync_job_logs` stores detailed operational messages and is cleanup-safe after `SYNC_LOG_RETENTION_DAYS`.

Cleanup lifecycle:

- The worker currently implements only `cleanup-queue` processing.
- Cleanup deletes expired raw payload rows and old sync job logs only.
- Cleanup must never delete canonical sports data, provider mappings, match data, standings, statistics, or analysis features.

Neon Free storage note:

- Raw payload and sync log retention is intentionally short to control storage.
- Canonical normalized data and provider mappings are permanent.

## Pipeline Contract Wiring

The internal pipeline skeleton now supports this safe flow:

```text
ProviderFetchResult
-> ProviderIngestionService
-> raw_provider_payloads
-> raw-payload-processing-queue
-> RawPayloadProcessor
-> normalizer shell
-> processed or failed raw payload status
```

Provider ingestion lifecycle:

- Ingestion accepts provider-agnostic `ProviderFetchResult` values.
- It validates required provider metadata, stores the raw payload, and enqueues `process-raw-payload`.
- It does not normalize directly and does not write canonical sports data.

Raw payload processing lifecycle:

- The processor loads the raw payload by ID, validates processing state, routes by entity type, and calls a normalizer shell.
- Known entity types currently use validated-only shells.
- Unknown entity types fail loudly.
- Normalizer failures mark the raw payload as failed and are logged through sync job logs when context is available.

Mock provider isolation policy:

- Mock provider ingestion is allowed only for local development, unit tests, isolated integration tests, and dry-run validation.
- `MOCK_PROVIDER_ENABLED=true` is required for mock ingestion outside production.
- `MOCK_PROVIDER_ENABLED=true` with `NODE_ENV=production` fails fast during config loading.
- Coolify services force `MOCK_PROVIDER_ENABLED=false` by default.
- Do not write mock provider data into a Neon production database.

Real provider integration is still not implemented.

## Provider Adapter Shell

The provider adapter shell defines the infrastructure future real providers must implement before endpoint work begins:

- provider adapter contract
- provider capability declarations
- provider health-check result contract
- provider endpoint metadata and MVP operation map
- provider request context
- provider registry
- local no-op adapter for tests/local development only
- adapter-to-ingestion bridge into `ProviderIngestionService`

The local no-op adapter and legacy mock provider are forbidden in production. No adapter currently calls external URLs, and no Sofascore adapter, scraping code, scheduled provider ingestion, or real provider fetching exists yet.

Provider discovery must happen before real adapter work. Evidence and readiness gates live in:

- `docs/providers/provider-discovery-plan.md`
- `docs/providers/sofascore-field-evidence.md`
- `docs/providers/provider-evidence-template.md`
- `docs/providers/provider-operation-coverage-matrix.md`
- `docs/providers/provider-candidate-comparison.md`
- `docs/providers/apifootball-com-field-evidence.md`
- `docs/providers/apifootball-com-sample-review-workflow.md`
- `docs/providers/apifootball-league-onboarding-runbook.md`
- `docs/architecture/provider-adapter-implementation-gate.md`

apifootball.com is the current controlled low/no-cost football POC provider and is distinct from api-football.com / API-SPORTS. The adapter is disabled by default, blocked in production, and uses only `APIFOOTBALL_COM_*` environment variables. Local sample capture writes sanitized snippets under ignored `.provider-samples/` and never writes to the database. The capture script supports staged sampling: countries and leagues can be captured first, while league/date-scoped events, teams, and standings are skipped with clear messages until the needed filters are set.

APIFootball.com authentication uses the documented `APIkey` query parameter against `https://apiv3.apifootball.com/` by default. The base URL remains configurable through `APIFOOTBALL_COM_BASE_URL`. The adapter supports endpoint-based credential routing through server-only environment variables: endpoint-specific keys such as `APIFOOTBALL_COM_API_KEY_EVENTS`, `APIFOOTBALL_COM_API_KEY_FIXTURES`, and `APIFOOTBALL_COM_API_KEY_STANDINGS` are preferred, then `APIFOOTBALL_COM_API_KEY_DEFAULT`, then the legacy `APIFOOTBALL_COM_API_KEY`. Reports and errors may include safe labels such as `events`, `fixtures`, `default`, or `legacy`, but must never include raw keys or partial keys. To check local auth wiring without running ingestion or printing the key, configure the relevant `APIFOOTBALL_COM_API_KEY*` value in local `.env` and run:

```bash
npm run provider:apifootball:auth:check
```

APIFootball.com samples must be reviewed before any manual ingestion workflow is approved. Reviewed samples must confirm countries, leagues, teams with logo behavior, events/scores, stable team identity, and standings behavior or explicitly document blockers. Country data is mandatory for league onboarding: confirm `country_id` and `country_name`, then run countries/leagues execute before teams, standings, events, scores, or future H2H execute. This preserves the canonical chain `country -> competition -> team -> match` and supports the future Football Explorer flow from Country to Leagues to League detail to Standings to Teams to Team detail. Manual ingestion readiness still does not approve production sync, scheduled jobs, or live-score behavior.

H2H is now part of the standard league onboarding pipeline after teams and events are mapped. It should be fetched for upcoming/analyzable matches only, not for every possible team pair. H2H dry-run must pass before execute: provider success or clean no-data response, stable team IDs, stable match IDs when provided, parseable fulltime and halftime scores when present, unresolved rows reported, no fake IDs, and zero DB writes in dry-run. H2H remains a supporting causal signal: it can support or weaken goal profiles, BTTS, and over/under reasoning, but missing H2H should cap confidence and add risk context rather than override strong current form or block MVP readiness by itself.

APIFootball H2H has a guarded one-match command:

```bash
npm run provider:apifootball:h2h:ingest -- --match-id=<match-uuid>
```

Dry-run is the default. Add `--execute` only after reviewing a clean dry-run on an approved local or Neon test target. The command resolves the target match and APIFootball team mappings, calls `get_H2H` for that exact pair, and normalizes only clean rows into canonical `matches` plus `football_match_scores` so the existing H2H feature builder can consume them. Strict execute blocks if any row is skipped. For reviewed/enabled leagues, admins may opt into partial execute with `--allow-partial --minimum-clean-rows=3` when skipped rows are only non-critical competition-scope skips such as `missing_competition_mapping` or `unsupported_competition_scope`. Partial execute still normalizes only clean rows, reports skipped reasons, and never creates fake competitions, teams, matches, or provider IDs. Execute is always blocked for production/main, missing team mappings, unstable match/team IDs, unparseable score/date fields, or any path that would require fake IDs. It does not persist raw payloads, run feature builders, generate candidates, settle predictions, publish, mark member-visible, or run tahmin kombini.

Reviewed/enabled leagues can use a controlled upcoming H2H batch wrapper:

```bash
npm run provider:apifootball:h2h:backfill-upcoming -- --country-id=<country-id> --league-id=<league-id> --limit=20
```

The upcoming H2H runner is manual, one league at a time, dry-run by default, and only considers `not_started` matches. Optional `--from/--to`, `--window-hours`, `--limit`, `--allow-partial`, and `--minimum-clean-rows=3` flags narrow the run. With `--execute`, each match still performs the existing one-match H2H planning path first; only `executeSafe=true` matches are normalized, unsafe matches are skipped and reported, and the runner never runs feature builders, candidates, drafts, settlement, member-visible/public publishing, tahmin kombini, scheduler work, or fake-ID creation.

Reviewed APIFootball.com football test slices can be tested with a guarded local/manual ingestion command. Dry-run is the default. Reviewed/enabled leagues can dry-run and execute:

- `country_id=4`, `league_id=171`, `2. Bundesliga`
- `country_id=4`, `league_id=175`, `Bundesliga`
- `country_id=111`, `league_id=322`, `Süper Lig`
- `country_id=44`, `league_id=152`, `Premier League`
- `country_id=6`, `league_id=302`, `La Liga`
- `country_id=5`, `league_id=207`, `Serie A`
- `country_id=3`, `league_id=168`, `Ligue 1`
- `country_id=82`, `league_id=244`, `Eredivisie`

Italy Serie A is reviewed/enabled: `country_id=5`, `league_id=207`, `league_name=Serie A`, `dryRunAllowed=true`, `reviewed=true`, and `enabled=true`. Discovery selected the exact Italy `Serie A` row after comparing similar leagues such as Serie B, Serie C, Serie D, Serie A Women, Coppa Italia, Super Cup, Primavera leagues/cups, plus non-Italy Serie A names in Brazil and Mexico. Review evidence: teams/logos 20/20 with 19/20 logos and one standings-name enrichment, standings 20/20, recent finished events/scores 10/10 with FT/HT scores 10/10, and upcoming events/scores 9/10. The one upcoming skipped row was a live APIFootball numeric `match_status` that must remain skipped until the provider returns a supported final/scheduled status; it is non-fatal because finished-score evidence is clean. Run a narrow countries/leagues execute before teams, standings, or events execute.

France Ligue 1 is reviewed/enabled: `country_id=3`, `league_id=168`, `league_name=Ligue 1`, `dryRunAllowed=true`, `reviewed=true`, and `enabled=true`. Discovery selected the exact France `Ligue 1` row after comparing similar French competitions such as Ligue 2, Coupe de la Ligue, National 1/2/3, Première Ligue, and Trophée des Champions, plus non-France `Ligue 1` rows in other countries. Review evidence: teams/logos 18/18, standings 18/18, upcoming events 9/9, recent finished events/scores 9/9, FT/HT scores 9/9, unresolved rows 0. Run a narrow countries/leagues execute before teams, standings, or events execute.

Netherlands Eredivisie is reviewed/enabled: `country_id=82`, `league_id=244`, `league_name=Eredivisie`, `dryRunAllowed=true`, `reviewed=true`, and `enabled=true`. Discovery selected the exact Netherlands `Eredivisie` row after comparing similar Dutch competitions such as KNVB Beker (`243`, `1194`), Eerste Divisie (`245`), Derde Divisie (`242`), Eredivisie Women (`481`), Reserve League (`721`), Super Cup (`391`), Tweede Divisie (`584`), and U18/U19/U21 Divisie rows. Review evidence: teams 22/22, logos 21/22 with one missing non-fatal, one standings-name enrichment, standings 18/18, and recent finished events/scores 8/8 with FT/HT scores 8/8. The upcoming slice mapped 10/11 and skipped one `After Pen.` non-standard status; this is accepted as a non-fatal caveat, remains skipped unless an explicit policy is added, and must not create normal league score rows. Run a narrow countries/leagues execute before teams, standings, or events execute.

Süper Lig is reviewed/enabled after teams, standings, and events dry-run evidence. Teams mapped 18/18 after exact standings-name enrichment for two missing `team_name` rows. Logo coverage is 16/18; the two missing logos are accepted as non-fatal. Execute is allowed only through the guarded manual command and still requires an approved local or Neon test database target.

Premier League is reviewed/enabled after controlled dry-run evidence: teams/logos 20/20, standings 20/20, events/scores 10/10, unresolved rows 0. Because its competition provider mapping does not exist yet on the current test branch, run a narrow countries/leagues execute before teams, standings, or events execute.

Spain La Liga is reviewed/enabled after controlled dry-run evidence: teams/logos 20/20, standings 20/20, upcoming events 10/10, recent finished events/scores 10/10, FT/HT scores 10/10, unresolved rows 0. Discovery selected the exact Spain `La Liga` row after comparing similar Spanish competitions such as Segunda División, Copa del Rey, Super Cup, Primera División RFEF, and Primera División Femenina. Because its competition provider mapping does not exist yet on the current test branch, run a narrow countries/leagues execute before teams, standings, or events execute.

Süper Lig is analysis-only for prediction MVP readiness. The current test branch has 18 teams, 18 standings rows, 38 finished matches, 9 upcoming matches, 38 score rows, and 38/38 halftime score coverage, but all upcoming matches are still `partial` because scoped samples are low and H2H is 0. Do not force candidate generation, persist drafts, include Süper Lig in tahmin kombini, or expose member/public predictions until readiness improves.

During APIFootball manual ingestion, missing team names may be enriched only from same-league standings rows with an exact provider team ID match. This fallback fills the name only, reports `enrichedTeamNamesCount` and `enrichedFrom=standings`, and never infers logos or creates fake provider IDs.

```bash
APIFOOTBALL_COM_ENABLED=true \
npm run provider:apifootball:ingest:manual -- \
  --country-id=4 \
  --league-id=171 \
  --from=2026-04-24 \
  --to=2026-04-26
```

Add `--execute` only for intentional database writes to an approved local database or explicit Neon test branch. Execute mode is blocked in production, runs a database readiness check before any provider fetch, stores payloads through `ProviderIngestionService`, processes them inline through `RawPayloadProcessor`, and prints a safe post-run verification report with canonical counts, team logo coverage, raw payload status counts, failed payload count, and current-run unresolved/skipped rows. Every run also includes a sanitized `ingestionRunReport` summary in console output. Add `--report-json` to persist that report under ignored `.provider-runs/apifootball-com/`. Dry-run does not query the database unless `--verify-after` is explicitly supplied. Reports never include API keys or database credentials and do not clean up failed payloads automatically. The command does not add any scheduler, cron, automatic sync, live polling, frontend, prediction module, or broad provider rollout. APIFootball.com does not provide a stable season ID in the reviewed slice, so matches and standings use nullable season behavior rather than fabricated season mappings.

Reviewed/enabled APIFootball football leagues also support a controlled historical backfill runner for finished-match history:

```bash
APIFOOTBALL_COM_ENABLED=true \
npm run provider:apifootball:backfill-history -- \
  --country-id=44 \
  --league-id=152 \
  --from=2026-04-01 \
  --to=2026-04-30 \
  --batch-days=14
```

Dry-run is the default. Add `--execute` only after reviewing the dry-run. The runner is manual only, requires local or explicit Neon test DB readiness, refuses production/main targets, and only allows leagues marked `reviewed=true` and `enabled=true`. It splits the requested range into max 14-day batches, runs an events/scores dry-run before every execute batch, stops on unresolved rows or non-empty failures, and stops after the configured empty-batch limit. Review-candidate leagues remain on the stricter 7-day evidence workflow through `provider:apifootball:ingest:manual`; the backfill runner does not loosen review-candidate guards. It never runs feature builders, prediction candidates, settlement, public/member-visible changes, tahmin kombini, schedulers, or provider cleanup.

If a dependency mapping is fixed after a raw payload already failed, use the manual one-payload retry command instead of deleting or broadly cleaning payloads:

```bash
npm run provider:raw-payload:reprocess -- --raw-payload-id=<uuid>
```

Dry-run is the default and writes zero rows. Add `--execute` only on an approved local or Neon test branch after the dry-run reports complete dependencies. MVP support is intentionally narrow: APIFootball `football_standing` payloads only, `status=failed` only, one explicit raw payload ID only. The command does not call providers, does not delete payloads, and does not retry unrelated failures.

## Static Canonical Normalization

Implemented canonical normalizers:

- `sport`
- `country`
- `competition`
- `season`
- `team`
- `player`
- `match`

Dependency order:

```text
sport
country
sport + optional country -> competition
competition -> season
```

Static normalizer lifecycle:

- Validate provider-agnostic DTO fields.
- Resolve existing provider mapping when present.
- Upsert or update the canonical row idempotently.
- Create or reuse the provider mapping.
- Return a structured normalization result to the raw payload processor.

Provider mapping behavior:

- Every normalized static provider entity must have a mapping.
- Competition normalization requires a mapped sport and optionally a mapped country.
- Season normalization requires a mapped competition.
- Team normalization requires a mapped sport and may use a mapped country when available.
- Player normalization requires a mapped sport and may use mapped current team and nationality country when available.
- Match normalization requires mapped competition, home team, and away team, with optional season and winner team mappings.
- Missing dependencies fail loudly and mark the raw payload failed.

Team normalization lifecycle:

- Teams use one shared canonical `teams` table for football, basketball, and future sports.
- Each team belongs to exactly one sport through `sport_id`.
- The natural fallback identity is `sport_id + slug`, so Galatasaray football and Galatasaray basketball can coexist as separate canonical teams.
- Provider mappings remain mandatory for every provider team entity.
- Generic profile fields such as logo, venue, founded year, gender, type, and metadata may live on `teams`.
- Sport-specific statistics, predictions, and analysis features must live in future sport-specific or analysis tables, not in the shared team identity row.

Player normalization lifecycle:

- Players use one shared canonical `players` table for football, basketball, and future sports.
- Each player belongs to exactly one sport through `sport_id`.
- `players.country_id` currently represents nationality country in the repository and normalizer layer.
- Provider mappings are the primary identity source for provider player entities.
- The fallback natural key is intentionally strict: `sport_id + slug + date_of_birth` when available. Name or slug alone must not be treated as unique.
- Football and basketball player statistics must live in future sport-specific tables such as `football_player_match_statistics` and `basketball_player_box_scores`, not in the shared player identity row.

Match normalization lifecycle:

- Matches use one shared canonical `matches` table for football, basketball, and future sports.
- Provider mappings are the primary identity source for provider match entities.
- The fallback natural key is `competition_id + season_id + home_team_id + away_team_id + scheduled_start_at` with PostgreSQL `NULLS NOT DISTINCT` handling.
- Match rows depend on normalized competition and team mappings; season and winner mappings are optional.
- Match-level score-summary DTO fields remain metadata-only on the shared match row.
- Detailed score persistence is sport-specific through `football_match_scores`, `basketball_match_scores`, and `basketball_period_scores`.
- Team-level match statistics are sport-specific through `football_match_team_statistics` and `basketball_team_match_statistics`.
- Standings are sport-specific through `football_standings` and `basketball_standings`; basketball `win_percentage` uses a `0..100` convention.

Sport-specific schema planning:

- Football and basketball data requirements are documented separately before stat/event/feature normalizers are implemented.
- Shared canonical tables remain for identity and common match context.
- Football and basketball score, team-statistics, and standings tables are implemented; football team form, football head-to-head, and football match prediction feature snapshots are implemented as manual analytics layers. Events, lineups, player stats, box scores, prediction models, and frontend features remain planned only.
- Provider field availability and ingestion planning docs now define which provider fields are needed, where they map, and what must remain raw-only until future schema work is approved.

Still intentionally not implemented:

- event, lineup, roster, player statistics, and prediction canonical upserts
- real provider integration
- production mock seeding
- frontend and prediction models

## Analytics Feature Builders

The first analytics implementation slices are available for football and basketball team form, plus football head-to-head:

- `football_team_form_features`
- `FootballTeamFormFeatureBuilder`
- `football_head_to_head_features`
- `FootballHeadToHeadFeatureBuilder`
- `football_match_prediction_features`
- `FootballMatchPredictionFeatureBuilder`
- `FootballMatchReasoningBuilder`
- `basketball_team_form_features`
- `BasketballTeamFormFeatureBuilder`

The builders read only normalized sport-specific facts and existing feature rows. They write precomputed team form rows for overall/home/away scopes, football pairwise head-to-head rows, and football match feature snapshots that combine home/away form plus H2H coverage. Football team form rows now include the first goal-feature expansion slice: `over_0_5_rate`, `under_2_5_rate`, `scored_rate`, `conceded_rate`, `team_over_0_5_rate`, `team_over_1_5_rate`, `first_half_over_0_5_rate`, `first_half_avg_goals_for`, and `first_half_avg_goals_against`. These fields are paired with a causal interpretation document so future reasoning can explain why a goal candidate is supported, risky, or contradictory. The reasoning builder is read-only and explains an existing football match feature snapshot. They are not connected to provider ingestion, queues, schedulers, APIs, or prediction models yet.

Football team form features can be built manually against an approved local database or explicit Neon test branch. Dry-run is the default and reads normalized data without writing feature rows:

```bash
npm run analytics:football:team-form:build -- \
  --competition-id=<competition-uuid> \
  --season-id=<season-uuid> \
  --all-approved-football
```

Use `--team-id=<team-uuid>` for one team or `--match-id=<match-uuid>` for one match. Competition-level builds require `--all-approved-football`; APIFootball reviewed slices may use nullable season behavior, so omit `--season-id` only when intentionally adding `--allow-null-season`. This filters normalized matches and standings with `season_id is null` and never creates fake season IDs. Add `--execute` only after `npm run db:check` passes for a local/test database. Execute mode upserts `football_team_form_features` and prints a safe post-run verification count. Optional flags include `--window-sizes=5,10`, `--scopes=overall,home,away`, and `--report-json`, which writes an audit report under ignored `.provider-runs/analytics/`. This command never calls providers and does not require APIFootball credentials.

Football head-to-head features can also be built manually. The runner canonicalizes pair ordering so A/B and B/A write the same feature key:

```bash
npm run analytics:football:h2h:build -- \
  --team-a-id=<team-uuid> \
  --team-b-id=<team-uuid>
```

Use `--match-id=<match-uuid>` for one match pair or `--competition-id=<competition-uuid> --all-approved-football --allow-null-season` for reviewed nullable-season APIFootball slices. Dry-run is the default; `--execute` is required before writing `football_head_to_head_features`. The runner uses the same local/Neon-test database readiness guard and never calls providers.

Football match prediction feature snapshots can be built manually after team form and H2H features exist for the target match:

```bash
npm run analytics:football:match-prediction-features:build -- \
  --match-id=<match-uuid>
```

Dry-run is the default. Add `--execute` only on a local or explicitly approved Neon test branch to upsert `football_match_prediction_features`. Optional flags include `--form-window-size=5`, `--h2h-window-size=5`, and `--report-json`. Coverage is weighted: H2H contributes 20% when it has samples, but missing H2H switches to team-form-only weighting and is marked in metadata. This command creates feature inputs only; it does not output match results, public picks, or model results.

Prediction readiness is documented in `docs/analytics/prediction-readiness-policy.md`. Future automated prediction should use only `ready` rows by default, while `insufficient_data` rows are audit/debug artifacts and must not feed future public successful-prediction flows. Ready rows with missing H2H need a future confidence cap before any public use.

Football match reasoning can be generated from an existing feature snapshot:

```bash
npm run analytics:football:reasoning:build -- \
  --match-id=<match-uuid>
```

This read-only command uses the same local/Neon-test database readiness guard, prints deterministic reasoning signals, and never writes to the database. It explains readiness, positive signals, risk factors, missing data, Tahmin eligibility, public-use ineligibility, and Güven skoru. It is not a prediction model or AI explanation service.

Football match analytics can be viewed as one complete read-only report:

```bash
npm run analytics:football:match:view -- \
  --match-id=<match-uuid>
```

The viewer prints match identity, competition, kickoff, teams, feature readiness, coverage, reasoning signals, risk factors, missing data warnings, and summary. Add `--json` for machine-readable output or `--debug` to include source feature IDs. The viewer never writes to the database, never calls providers, and never generates final Tahmin output.

The same report is exposed through a read-only API endpoint:

```http
GET /api/analytics/football/matches?featureStatus=ready
GET /api/analytics/football/matches/<match-uuid>
GET /api/analytics/football/matches/<match-uuid>?debug=true
```

The list endpoint supports `featureStatus=ready|partial|insufficient_data`, `predictionEligible=true|false`, `kuponEligible=true|false`, `competitionId=<uuid>`, `teamId=<uuid>`, `limit`, `offset`, and `debug=true`. The single-match endpoint validates the match UUID and returns `404` for missing matches or missing feature snapshots. Both endpoints return JSON with match identity, feature readiness, coverage, reasoning signals, risk factors, missing data warnings, and summary. `debug=true` adds source feature IDs and sanitized metadata only; it never exposes provider API keys, database credentials, raw provider payloads, or final Tahmin output.

The API contract is documented in `docs/api/football-analytics-api.md`.
Internal draft Tahmin review endpoints are documented in `docs/api/football-predictions-api.md`.

Additional read-only football catalog endpoints support the dashboard foundation:

```http
GET /api/football/countries
GET /api/football/countries/<country-uuid>/competitions
GET /api/football/teams
GET /api/football/teams/<team-uuid>
GET /api/football/teams/<team-uuid>/profile
GET /api/football/competitions
GET /api/football/competitions/<competition-uuid>
GET /api/football/competitions/<competition-uuid>/profile
```

These endpoints expose the Football Explorer path `Country -> Leagues -> League Detail -> Teams -> Team Detail` from normalized database tables only. Country and competition Explorer responses include canonical counts for teams, standings, matches, finished/upcoming matches, prediction-ready coverage, and H2H-supported upcoming matches where available. Team logos come from persisted `teams.logo_url`; league logos are nullable and returned only when a public-safe URL already exists in canonical competition metadata. They do not expose provider IDs by default, raw provider payloads, provider keys, database URLs, admin draft internals, settlement/public state, or final Tahmin output.

Membership/auth foundation is documented in `docs/security/auth.md`. When `AUTH_ENABLED=true`, dashboard analytics and catalog APIs require login:

```bash
AUTH_ENABLED=true
AUTH_JWT_SECRET=<local-random-secret>
AUTH_COOKIE_NAME=betify_auth
AUTH_TOKEN_TTL_SECONDS=86400
```

Create or update a local admin after migrations:

```bash
ADMIN_EMAIL=admin@example.com \
ADMIN_PASSWORD=<long-local-password> \
npm run auth:create-admin
```

The bootstrap command refuses `NODE_ENV=production`, lowercases the email, hashes the password, and does not print passwords or hashes. This is membership access only; billing, subscription plans, prediction models, and public successful-prediction flows are not implemented.

Member registration is available through `POST /api/auth/register` and the dashboard `/register` route. Registration collects ad, soyad, Turkish `+90` telefon numarası, e-posta, şifre, şifre tekrar, and a simple math security question; login remains e-posta + şifre only. Registration creates `role=member`, `status=active`, uses the same HTTP-only cookie auth strategy, and auto-logs the member in. It never creates admin users; admins are still created only through `npm run auth:create-admin`. Email verification, password reset, social login, billing, and subscription plans are not implemented yet.

Role-based access control:

- Members can access overview, football match analytics, teams, competitions, `/api/auth/me`, and logout.
- Admins can additionally access internal Draft Tahminler, Tahmin Sonuçları, Public Uygunluk, and future provider/system/audit areas.
- Admin-only APIs return `401` for anonymous requests and `403` for authenticated non-admin users.

Public/member access policy is planned in `docs/product/member-access-policy.md`, `docs/product/public-successful-predictions.md`, and `docs/product/public-prediction-eligibility-policy.md`. The future football prediction output, consistency, and settlement workflow is planned in `docs/product/football-prediction-output-workflow.md`, `docs/product/prediction-consistency-engine.md`, and `docs/product/prediction-settlement-policy.md`. Anonymous visitors may later see only limited settled successful predictions; they must not access the dashboard, active/upcoming predictions, full reasoning, analytics feature coverage, provider/admin pages, or any future tahmin kombini feature. Generated predictions must pass consistency checks before member visibility, public eligibility, or future tahmin kombini use. `settled_success` does not automatically mean public eligibility, and `Uzak Dur` / blocked audit-only outputs remain internal even if they settle successfully.

Future public publication workflow is planned in `docs/product/public-eligibility-review-workflow.md`. It separates evaluator eligibility from admin review, public draft creation, approval, publish, hide, and rejection states. No mutation endpoint or public successful predictions page exists yet.

Public eligibility storage now includes future visibility timestamps on `football_prediction_outputs` and the `public_successful_predictions` table. The evaluator is report-only: no `public_successful_predictions` rows are inserted, no statuses are changed, and internal review is still required before any future public page.

Pre-match analysis timing is planned in `docs/product/pre-match-analysis-window-policy.md`. Fixture sync may fetch beyond 36 hours for schedule visibility, but automated analytics and draft Tahmin generation should default to matches from now through the next 36 hours, with a suggested 30-minute minimum lead time before kickoff. Outputs generated too early or from stale snapshots should remain internal and must not become member-visible or public by default.

The candidate generator now reports this timing status without enforcing it yet:

```bash
npm run analytics:football:prediction-candidates:generate -- --match-id=<match-uuid> --window-hours=36 --minimum-lead-minutes=30
```

The report includes `analysisWindowStatus`, lead time, and rebuild/staleness notes. `--persist-draft` remains draft-only and is not blocked by the window report in this phase.

To opt into blocking behavior during manual checks:

```bash
npm run analytics:football:prediction-candidates:generate -- --match-id=<match-uuid> --enforce-window
```

`--enforce-window` allows generation only when `analysisWindowStatus=within_window`. It blocks `too_early`, `too_late`, `stale`, and `unknown` cases without writing drafts. This is not the default yet; future scheduler work should enforce it by default.

Stale draft rebuild policy is planned in `docs/product/stale-draft-rebuild-workflow.md`. Drafts generated more than 36 hours before kickoff should be treated as audit-only stale data until team form, H2H, match features, reasoning, and candidates are rebuilt inside the valid window with `--enforce-window`. `football_prediction_outputs` has metadata fields for stale/rebuild tracking, and manual commands exist. Scheduled execution is documented but must be explicitly enabled by operations.

```bash
npm run analytics:football:prediction-drafts:rebuild-stale -- --match-id=<match-uuid>
npm run analytics:football:prediction-drafts:rebuild-stale -- --match-id=<match-uuid> --execute
```

The command is dry-run by default. Execute mode rebuilds only the target match, requires the valid analysis window, persists draft-only candidates, and does not call providers, run ingestion, settle, publish, mark member-visible, create public rows, or generate tahmin kombini output.

The controlled manual pre-match pipeline runner wraps the same safe sequence for one match or one reviewed/enabled league:

```bash
npm run pipeline:football:prematch -- --country-id=<provider-country-id> --league-id=<provider-league-id> --limit=20
npm run pipeline:football:prematch -- --match-id=<match-uuid>
```

Dry-run is the default and writes nothing. Execute mode is local/Neon-test only, selects only matches inside the configured pre-match window, rebuilds match-scoped team form, H2H, match prediction features, reasoning, and consistency-checked candidates, then persists draft audit rows only when the feature is `ready`, the match is inside the window, and at least one non-blocked recommendation candidate exists. It does not call providers, run ingestion, settle, publish, mark member-visible, create public predictions, schedule jobs, or generate tahmin kombini output.

Internal public eligibility review is available through authenticated, read-only API/dashboard surfaces:

```http
GET /api/football/public-eligibility/evaluate
GET /api/football/matches/<match-uuid>/public-eligibility
```

Dashboard routes `/football/public-eligibility` and `/football/matches/:matchId/public-eligibility` show eligible/excluded settled outputs, blocker reasons, late-generated test prediction warnings, and public safety notes. These screens do not publish, approve, mutate statuses, create public cards, or create tahmin kombini output.

Prediction persistence foundation now includes `football_prediction_outputs` and `football_prediction_conflicts`, plus a focused repository for lifecycle-safe storage. This is storage only: no persisted/member-visible prediction generation, settlement engine, public successful predictions page, or tahmin kombini engine exists yet.

The deterministic football prediction candidate generator prototype is local/manual and dry-run only:

```bash
npm run analytics:football:prediction-candidates:generate -- --match-id=<match-uuid>
npm run analytics:football:prediction-candidates:generate -- --match-id=<match-uuid> --check-consistency
npm run analytics:football:prediction-candidates:generate -- --match-id=<match-uuid> --persist-draft
```

It emits compact preview tiers `Tahminim`, `Denenir`, `Alternatif`, and `Uzak Dur` from existing ready feature snapshots. The generator now consumes match-level goal profiles for over/under, BTTS, and first-half evidence gates; these profiles are proxy signals, not probabilities. The optional `--check-consistency` flag runs the deterministic consistency engine in memory and marks candidates as `passed`, `warning`, or `blocked` with conflict details, including profile-aware low/high goal, first-half, BTTS, and team-total checks. Any blocked candidate is reclassified as `avoid` / `Uzak Dur` and must never remain under `Tahminim`, `Denenir`, or `Alternatif`. The optional `--persist-draft` flag automatically runs consistency checks and stores the candidates as `status=draft` audit rows only. Draft persistence does not mark anything member-visible, settle outcomes, publish public cards, or create tahmin kombini output. `Uzak Dur` / blocked candidates are stored only for audit and must never be shown as recommendations.

Authenticated internal users can review stored draft candidates through read-only API endpoints:

```http
GET /api/football/predictions/drafts
GET /api/football/predictions/drafts/<prediction-uuid>
GET /api/football/matches/<match-uuid>/prediction-drafts
```

These endpoints do not mutate prediction status, publish, settle, or generate tahmin kombini output.

Authenticated internal users can also review settled prediction outputs through read-only settlement review endpoints:

```http
GET /api/football/predictions/settlements
GET /api/football/predictions/settlements/<settlement-uuid>
GET /api/football/matches/<match-uuid>/prediction-settlements
```

These endpoints expose settlement results, conflicts, audit-only flags, and member/public visibility summaries for internal review only. `settled_success` does not mean public eligibility, and `Uzak Dur` / blocked outputs remain audit-only even if they settle successfully.

The first read-only SkorIQ dashboard skeleton lives in `apps/dashboard`:

```bash
npm run dev:api
VITE_API_BASE_URL=http://localhost:3000/api npm run dev:dashboard
```

Dashboard routes:

- `/login`
- `/register`
- `/football/analytics`
- `/football/analytics/<match-uuid>`
- `/football/predictions/drafts`
- `/football/predictions/drafts/<prediction-uuid>`
- `/football/matches/<match-uuid>/prediction-drafts`
- `/football/predictions/settlements`
- `/football/predictions/settlements/<settlement-uuid>`
- `/football/matches/<match-uuid>/prediction-settlements`
- `/football/teams`
- `/football/teams/<team-uuid>`
- `/football/competitions`
- `/football/competitions/<competition-uuid>`

The dashboard consumes only read-only football analytics/catalog APIs. It renders persisted `teams.logo_url` values where available and falls back to neutral team initials when a logo is missing. It also includes internal read-only Draft Tahminler and Tahmin Sonuçları review pages for persisted candidates, consistency conflicts, and settlement audit results. With auth enabled, unauthenticated users are redirected to `/login`, and the API client sends the HTTP-only cookie with requests. It does not call providers, write to the database, run ingestion, publish/member-visible predictions, settle outcomes from the UI, create public successful predictions, generate tahmin kombini output, or generate final Tahmin output. See `docs/frontend/analytics-dashboard-plan.md`.

Member users do not see admin/internal review navigation. Direct member navigation to admin-only review routes shows a `403` page, while backend admin guards prevent hidden internal data from being returned.

Dashboard smoke-test milestone: local API `http://localhost:3000/api` and local dashboard `http://127.0.0.1:5173` were tested against the approved Neon test branch. `/football/analytics` and `/football/analytics/89759e35-758d-416e-b0d3-ad07436c8a9b` loaded Borussia Dortmund vs Freiburg with `Ready`, Tahmin uygunluğu `Yes`, Başarılı tahminler `No`, coverage `64%`, H2H missing, reasoning signals, risk factors, and the required “not a final prediction” safety copy. A local CORS issue was found and fixed for GET-only dashboard origins. No secrets or raw payloads were visible, and typecheck, lint, tests, and build passed.

Prediction models, production frontend polish, basketball head-to-head, and live recalculation remain unimplemented.

Local auth troubleshooting: use `localhost` with `localhost`, or `127.0.0.1` with `127.0.0.1`, consistently for both API and dashboard during development. Mixing `localhost` and `127.0.0.1` can prevent the HTTP-only auth cookie from being shared.

## Local Start

```bash
npm install
docker compose -f docker/local/compose.yml up -d
cp .env.example .env
npm run typecheck
npm run dev:api
```

Run migrations explicitly before using a database-backed service:

```bash
npm run db:check
npm run db:migrate
```

`npm run db:check` is read-only. It reports the sanitized target host, port, database name, SSL mode, classification, connectivity, and whether expected tables exist. It never prints credentials. Classifications are `local`, `neon-test`, `remote-unsafe`, and `unknown`.

- Start local PostgreSQL manually and create `sports_data`.
- Use `docker compose -f docker/local/compose.yml up -d` when Docker is installed.
- Point `DATABASE_URL` at an existing local disposable PostgreSQL database.
- To use a Neon test branch, create a non-main/non-production branch, set its test branch `DATABASE_URL`, set `DB_EXECUTION_TARGET=neon-test`, set `ALLOW_REMOTE_TEST_DB=true`, and optionally set `NEON_BRANCH_NAME`.
- Do not use Neon main, Neon production, or broad remote managed databases for first ingestion.

## Local PostgreSQL Integration Tests

Integration tests are opt-in and use a disposable local PostgreSQL database only. They must never point at Neon or any production database.

Recommended local flow:

```bash
npm run docker:test:up
export TEST_DATABASE_URL=postgres://postgres:postgres@localhost:55432/sports_data_test
npm run db:test:reset
npm run db:test:migrate
npm run test:integration
```

`npm run test:integration` also runs the reset and migration steps before executing integration tests. The test database guard refuses to run when:

- `TEST_DATABASE_URL` is missing.
- `TEST_DATABASE_URL` equals `DATABASE_URL`.
- `NODE_ENV=production`.
- the database host is not local.
- the database name does not clearly contain `test`.

The local test service uses `postgres:16-alpine`, while the schema remains standard PostgreSQL 15+/16 compatible. The integration suite validates that migrations apply cleanly, `pgcrypto` UUID generation works, `UNIQUE NULLS NOT DISTINCT` constraints are enforced, static normalizers are idempotent, provider mappings are created/reused, transaction rollback prevents partial writes, and raw payload processing updates status correctly.

Current limitation: integration tests use local fixtures only. Real provider integration is still not implemented, and mock/test data must not be written to Neon production.

For Coolify, deploy `api`, `worker`, `scheduler`, and self-hosted `redis` as separate services. PostgreSQL should remain external through Neon for MVP. Run migrations as an explicit release step before routing traffic to a new API version; do not run migrations implicitly inside every service container.

Health endpoints:

- `/api/health/live`: process liveness.
- `/api/health/ready`: readiness scaffold; database and Redis checks will be enabled when persistence wiring is added.

## Dependency Audit

The current moderate audit findings are tied to development/build tooling around `drizzle-kit` and transitive `esbuild` packages. Do not run `npm audit fix --force`; track upstream Drizzle Kit updates deliberately. The near-term production mitigation is keeping dev dependencies out of the runtime image.

## Architecture Docs

- `docs/architecture/mvp-architecture.md`
- `docs/architecture/sport-specific-schema-plan.md`
- `docs/architecture/ingestion-roadmap.md`
- `docs/architecture/analytics-builder-roadmap.md`
- `docs/product/pre-match-analysis-window-policy.md`
- `docs/product/stale-draft-rebuild-workflow.md`
- `docs/architecture/provider-adapter-implementation-gate.md`
- `docs/data-requirements/football.md`
- `docs/data-requirements/basketball.md`
- `docs/analytics/prediction-feature-plan.md`
- `docs/analytics/football-feature-catalog.md`
- `docs/analytics/basketball-feature-catalog.md`
- `docs/providers/provider-discovery-plan.md`
- `docs/providers/sofascore-field-evidence.md`
- `docs/providers/provider-evidence-template.md`
- `docs/providers/provider-operation-coverage-matrix.md`
- `docs/providers/provider-candidate-comparison.md`
- `docs/providers/provider-field-availability-plan.md`
- `docs/providers/football-provider-field-map.md`
- `docs/providers/basketball-provider-field-map.md`
- `docs/agents/agent-contracts.md`
