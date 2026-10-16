# SkorIQ takeover baseline — 2026-09-27

## Verified current environment

- Dashboard: https://skoriq.87.76.130.252.sslip.io/
- Hosting: Coolify at https://coolify.flixify.vip/.
- Coolify application: `skoriq-platform`, repository `Celebixco/skoriq`, branch `release/soft-launch`, root `docker-compose.coolify.yml`.
- The existing sports dataset comes from the SofaScore catalog workflow. Production APIFootball.com integration is disabled and has no configured provider key. A hosting access token does not authenticate to a sports provider.
- A bounded request to the SofaScore team-season statistics endpoint returned a nonempty real response. This proves access for that request, not continuous availability or complete league coverage.
- A later one-request capture to the same endpoint returned HTTP 403. The capture stopped without retrying or saving an empty success. The user chose to continue scraping SofaScore. A normal browser could read public team Statistics pages for Manchester City and Amed in two leagues; their visible data and capture times were saved for offline conversion. This supervised workflow does not yet establish continuous production availability.
- The live status endpoint reported 16 leagues, 308 teams and 573 matches. Its zero team-season-statistics count was unreliable: the old query checked only `season_statistics`, while the importer writes `seasonStatistics`. The corrected query checks both spellings and excludes empty/nonobject statistics.

## Changes prepared locally

- Removed the unauthenticated HTTP seed endpoint.
- Container migrations apply schema changes without invoking the destructive catalog rebuild or resetting administrator credentials.
- The legacy seed and SofaScore rebuild daemon require an explicitly opted-in disposable local test database. They cannot refresh the production dataset.
- PostgreSQL and Redis connectivity now determine API readiness. Process liveness remains separate.
- Production configuration requires authentication and a non-placeholder JWT secret; Compose requires deployment secrets.
- Raw-payload job IDs are deterministic and accepted by BullMQ's actual job validation.
- The sync status endpoint reports an unverified automation state until an operational scheduler is evidenced.
- Cookie files, secrets and provider captures are excluded from source control and Docker build contexts.

These changes are local. They have not been deployed, and their behavior must not be assumed to be present on the live site.

## Latest local verification

- All workspace production builds passed.
- The full Vitest run passed 833 of 835 tests. Two pre-existing dashboard match-report expectations still fail; the separate frontend task includes their resolution.
- The controlled importer passed 45 focused regressions; API primary-scope selection passed 23 and existing catalog controller checks passed 10. Backend targeted TypeScript and lint checks passed. Both Python capture tools passed 26 tests, including 13 visible-page converter checks.
- The new dashboard season-telemetry checks passed five regressions. Missing measurements render as unavailable, real zeros remain zero, per-game values carry units, and comparisons do not mix season totals with averages. Static coverage and verified-season claims were removed from these components.
- Actual saved public-page captures converted successfully: Manchester City `17:96668` (5 matches, 13 goals, 58 visible metrics) and Amed `52:98080` (6 matches, 15 goals, 59 visible metrics). Both passed no-database importer validation and local API-selector checks. Missing totals/xG remained absent. No database writes were performed.
- Default saved-catalog validation, without a database, accepted 301 distinct teams across 344 competition/season scopes. This is catalog validation, not proof of canonical persistence.
- ESLint remains blocked by 13 pre-existing errors in the dashboard and legacy verification scripts. Files changed for the backend/data fixes pass focused lint checks.
- Both Coolify YAML files parsed successfully. Docker image execution and PostgreSQL integration were not exercised locally.
- The real one-request capture returned HTTP 403, reported the failure and saved no success file. No provider retry or production database write followed.

## Deployment checks

1. Review the final backend changes together with the separately developed dashboard changes. Preserve existing local edits and canonical database identifiers.
2. Set `FRONTEND_ORIGIN` to `https://skoriq.87.76.130.252.sslip.io` for this environment. The inspected live value contains older hosts. If an explicit `CORS_ORIGIN` is retained in a custom deployment, it must include the same current origin.
3. Confirm authentication, JWT/database secrets and the migration command in the effective Compose configuration. Do not enable legacy `FORCE_SEED` for refreshes.
4. Run the build, relevant unit checks and disposable PostgreSQL integration checks. Local Docker/PostgreSQL was unavailable during this audit; mocked database tests do not replace this check.
5. After an authorized deployment, verify `/api/health/live`, `/api/health/ready`, authenticated dashboard access and actual team profiles. Dependency readiness alone does not verify provider freshness or analytics completeness.

## Data work sequence

First capture and validate small real-provider responses, then match existing provider identities and refresh statistics without rebuilding entities. Every refresh must retain team/match UUIDs, unrelated metadata and prediction history. Store competition/season scope and the actual source timestamp; missing or invalid responses must not overwrite valid data or become a fabricated complete analysis.

Season telemetry is the first controlled slice. The capture, visible-page converter and importer commands are documented in the root README and `docs/providers/sofascore-public-page-capture.md`. Capture is separate from database writes, and importer execution is limited to approved test targets. The importer stores scope-specific snapshots and their season names; it preserves an unverified legacy flat summary instead of placing cup statistics under a domestic league. The team-profile API selects one snapshot matching the team, primary competition and exact season name, returning null for ambiguous or unverifiable scoped data.

Safe match/score refresh, scheduled operation, persistence verification and recovery from provider failures need separate validation before claiming that production sync works. AI commentators follow once the data foundation and dashboard truthfulness are reliable.

## Assessment

The initial repository assessment was **5/10**: useful domain foundations, but destructive seed exposure, misleading readiness, invalid queue identifiers and frontend data-state defects blocked confidence in production operation. Takeover readiness was **8/10**. A higher project score requires verified production data refresh and successful frontend/integration checks, not only local code changes.
