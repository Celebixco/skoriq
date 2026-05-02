# Sports Data Platform MVP Architecture

## Purpose

This backend collects sports data for analysis, not live-score delivery. It stores controlled raw provider payloads, normalizes them into provider-agnostic canonical PostgreSQL tables, and prepares analysis-ready features for fast API reads.

## Core Flow

```text
External Provider
-> Provider Client
-> Collector Worker
-> Raw Provider Payload Storage
-> Validator
-> Normalizer
-> Canonical PostgreSQL Tables
-> Analysis Feature Builder
-> Platform API
```

## MVP Infrastructure

- API, worker, and scheduler run as separate Node.js services.
- PostgreSQL is Neon Free in production, using only standard PostgreSQL-compatible schema and migrations.
- Redis is self-hosted and used for BullMQ, dedupe locks, and rate-limit coordination.
- Production does not require a Postgres container; local development may use Docker Postgres.

## Provider Rule

Provider adapters live under `packages/providers`. Canonical database tables and public APIs must not depend on Sofascore or any other provider's response structure. External IDs belong in `provider_mappings` and admin/debug tooling only.

The provider adapter shell defines provider capabilities, health-check results, endpoint metadata, request context, a provider registry, a local no-op adapter, and a bridge into `ProviderIngestionService`. This is infrastructure only: no adapter currently calls external URLs, no Sofascore adapter exists, and no provider ingestion is scheduled automatically.

## Raw Payload Retention

Raw payloads are required before normalization but must be retained carefully:

- Successful payloads default to 7 days.
- Failed payloads default to 30 days.
- Sync logs default to 14 days.
- Canonical tables and provider mappings are permanent.

Cleanup must never delete canonical entities, match data, standings, statistics, analysis features, or provider mappings.

## Persistence Layer

The database package contains focused repositories for the ingestion pipeline foundation:

- Raw provider payload persistence stores provider responses before normalization, computes stable hashes, tracks processing state, and applies retention windows.
- Provider mapping persistence resolves provider-specific IDs to internal canonical UUIDs without leaking provider IDs into public APIs.
- Sync job persistence tracks job lifecycle, queue/job names, provider/entity context, timing, failure reasons, and structured logs.
- Cleanup persistence is deliberately narrow and may only delete expired raw payloads and old sync job logs.

This layer is provider-agnostic. It does not include Sofascore integration, real external fetching, normalization, predictions, frontend work, or live-score behavior.

## Pipeline Contract Wiring

The pipeline package provides safe internal contracts before real provider integration:

- Provider ingestion accepts a provider-agnostic fetch result and stores the raw payload.
- Raw payload processing loads a stored payload, validates status, routes by entity type, and calls a normalizer shell.
- Normalizer shells currently validate envelopes only and do not upsert canonical entities.
- Worker support is limited to cleanup and raw payload processing.
- Scheduler remains cleanup-only.

Mock provider policy:

- Mock ingestion is forbidden in production.
- `MOCK_PROVIDER_ENABLED=true` is never allowed with `NODE_ENV=production`.
- Mock provider data must not be written into Neon production.
- No scheduler or worker path automatically fetches mock provider data.

## Static Normalization

The first real canonical normalizers are limited to low-risk static entities:

- `sport`
- `country`
- `competition`
- `season`
- `team`
- `player`
- `match`

The dependency order is `sport -> country -> competition -> season`, with `team` and `player` depending on a mapped sport and optional country/team mappings. Match normalization depends on mapped competition, home team, and away team, with optional season and winner team mappings. These normalizers create or reuse provider mappings and upsert canonical rows idempotently.

Teams use one shared canonical `teams` table across football and basketball. The canonical uniqueness boundary is `sport_id + slug`, allowing Galatasaray football and Galatasaray basketball to be separate rows while preventing duplicate fallback teams within one sport. Provider mappings remain mandatory for provider team entities. Sport-specific statistics, predictions, and analysis features must be modeled in future sport-specific or analysis tables, not on the shared team identity row.

Players use one shared canonical `players` table across football and basketball. Each player belongs to a sport through `sport_id`; `players.country_id` currently represents nationality country in the repository and normalizer layer. Provider mapping is the primary identity source. The only fallback natural key is `sport_id + slug + date_of_birth` when available, because name or slug alone is not safe. Football and basketball player statistics must live in future tables such as `football_player_match_statistics` and `basketball_player_box_scores`, not on the shared player identity row.

Matches use one shared canonical `matches` table across football and basketball. Provider mapping is the primary identity source. The fallback natural key is `competition_id + season_id + home_team_id + away_team_id + scheduled_start_at` with PostgreSQL `NULLS NOT DISTINCT` handling. Match-level score-summary provider fields remain metadata-only on the shared match row; detailed score persistence is sport-specific through `football_match_scores`, `basketball_match_scores`, and `basketball_period_scores`. Team-level match statistics are also sport-specific through `football_match_team_statistics` and `basketball_team_match_statistics`. Standings are sport-specific through `football_standings` and `basketball_standings`.

Generic `match_score`, generic `match_statistics`, generic `standing`, event, analysis, and prediction logic remain intentionally not implemented here. Football and basketball score/statistics normalizers depend on already-normalized canonical matches and teams. Sport-specific standings normalizers depend on already-normalized canonical competitions, optional seasons, and teams. These dependent normalizers do not create dependent-row provider mappings.

Sport-specific schema planning lives in:

- `docs/architecture/sport-specific-schema-plan.md`
- `docs/architecture/ingestion-roadmap.md`
- `docs/data-requirements/football.md`
- `docs/data-requirements/basketball.md`
- `docs/providers/provider-field-availability-plan.md`
- `docs/providers/football-provider-field-map.md`
- `docs/providers/basketball-provider-field-map.md`

These documents define the football/basketball split for scores, statistics, standings, events, lineups, box scores, prediction features, and future provider field acceptance. The first score, team-statistics, and standings tables are implemented; events, lineups, player statistics, box scores, provider adapters, and prediction features remain future work.

## Local PostgreSQL Integration Tests

Integration tests are explicit and local-only. They use `TEST_DATABASE_URL`, never `DATABASE_URL`, and fail fast for production mode, non-local database hosts, Neon-like targets, or database names that do not clearly identify a test database.

Recommended workflow:

```bash
npm run docker:test:up
export TEST_DATABASE_URL=postgres://postgres:postgres@localhost:55432/sports_data_test
npm run test:integration
```

The integration lane proves:

- Drizzle migrations apply to a fresh PostgreSQL 16 database.
- `pgcrypto` and `gen_random_uuid()` work.
- PostgreSQL `UNIQUE NULLS NOT DISTINCT` constraints reject duplicate nullable natural keys.
- Static normalizers create canonical rows and provider mappings idempotently.
- Repository transaction rollback prevents partial canonical/mapping writes.
- Raw payload processing can mark successful static payloads processed and invalid static payloads failed.

These tests do not add real provider fetching, Sofascore integration, mock production seeding, or event/statistics normalizers.

Neon Free storage discipline:

- Successful raw payloads should be retained briefly.
- Failed raw payloads may be retained longer for debugging.
- Sync logs are temporary.
- Canonical entities, provider mappings, match data, standings, statistics, and analysis feature tables are permanent.

## Queues

The MVP queues are:

- `fixture-sync-queue`
- `finished-match-sync-queue`
- `match-detail-sync-queue`
- `standings-sync-queue`
- `team-sync-queue`
- `player-sync-queue`
- `raw-payload-processing-queue`
- `normalization-queue`
- `analysis-feature-build-queue`
- `cleanup-queue`

There is intentionally no live match queue.

## Freshness Policy

- Upcoming matches: 1-2 times per day.
- Today's scheduled matches: every 2-3 hours.
- Finished matches: recheck 6 and 24 hours after expected end.
- Old finished matches: freeze after final verification.
- Standings: daily.
- Team/player profiles: daily or every few days.
- Competition/season metadata: daily.

Provider adapter implementation must not start until the target provider fields have been mapped through the provider field availability docs. Sofascore remains only a candidate source; no provider-specific response shape should define canonical schema or public API contracts.

## MVP Non-Goals

- No live-score WebSocket architecture.
- No second-by-second updates.
- No TimescaleDB.
- No ClickHouse.
- No Kafka.
- No paid managed queue/cache.
- No Supabase-specific features.
- No frontend until backend foundations are stable.
