# Provider Ingestion Roadmap

## Purpose

This roadmap defines the safe order and timing for future provider integration. The platform is for analysis and prediction, not live-score delivery, so ingestion should be reliable, moderate, and field-driven.

No real provider adapter is implemented yet.

## Timing Strategy

Fixture sync and prediction analysis have different timing rules. Fixture sync may look beyond the next 24 hours for schedule visibility, mapping checks, and dashboard planning. Pre-match analytics and prediction candidate generation should default to the near-term window defined in [Pre-Match Analysis Window Policy](../product/pre-match-analysis-window-policy.md): `now` through `now + 24 hours`, with a suggested 30-minute minimum lead time before kickoff.

### Football

| Dataset | Recommended Timing | Notes |
| --- | --- | --- |
| Upcoming fixtures | 1-2 times per day | Enough for non-live planning and schedule discovery. May fetch beyond 24h; this does not authorize candidate generation. |
| Today's fixtures | Every 2-3 hours | Refresh status and fixture context without live polling. |
| Finished matches | Recheck around 6h and 24h after expected end | Allows provider finalization and stat corrections. |
| Scores | After match finalization and during finished-match rechecks | Use `football_match_scores`; do not publish live score updates. |
| Team match statistics | After finalization and 24h recheck | Use `football_match_team_statistics`; stats may be revised. |
| Standings | Daily and after matchday windows | Use `football_standings`. |
| Team/player profiles | Daily or every few days | Avoid noisy updates unless a provider signals profile changes. |
| Lineups | Only when pre-match availability is verified | Future work; do not build until provider fields and schema are approved. |
| Post-match events/player stats/shot maps | After finalization | Future work; high variance by provider and league. |

Analysis selection rule: future football automation should select `scheduled` / `not_started` matches in the next 24 hours by default, require mapped teams and sufficient historical feature data, and skip matches inside the minimum lead-time cutoff unless an admin override is explicitly logged.

Stale draft rebuilds are analytics work, not fixture-ingestion work. Fixture sync may discover or refresh future matches, but it should only trigger future rebuild consideration after the match enters the valid analysis window described in [Stale Draft Rebuild Workflow](../product/stale-draft-rebuild-workflow.md). Rebuild metadata fields now exist on `football_prediction_outputs`; ingestion must not mutate them directly.

### Basketball

| Dataset | Recommended Timing | Notes |
| --- | --- | --- |
| Upcoming fixtures | 1-2 times per day | Enough for schedule discovery and prediction planning. May fetch beyond 24h; analysis generation remains near-term by default. |
| Today's fixtures | Every 2-3 hours | Refresh status and context without live polling. |
| Finished matches | Recheck around 6h and 24h after expected end | Allows final scores, period scores, and stats to settle. |
| Scores and period scores | After match finalization and during finished-match rechecks | Use `basketball_match_scores` and `basketball_period_scores`. |
| Team match statistics | After finalization and 24h recheck | Use `basketball_team_match_statistics`; box-score totals may be corrected. |
| Standings | Daily and after matchday windows | Use `basketball_standings`. |
| Rosters/player profiles | Daily or every few days | Future roster/availability work should be field-driven. |
| Player box scores | After finalization | Future work; required before player rotation features. |

## Adapter Implementation Order

1. Provider discovery and health-check shell.
2. Static entity ingestion: sports, countries, competitions, seasons.
3. Team and player ingestion.
4. Upcoming and finished match ingestion.
5. Sport-specific score ingestion.
6. Sport-specific team statistics ingestion.
7. Standings ingestion.
8. Football events, lineups, missing players, shot maps, and player match statistics planning and implementation.
9. Basketball player box score, roster, injury/suspension, and rotation planning and implementation.
10. Prediction feature builders after normalized score/stat/standing history exists.
11. Future stale-draft detection for matches entering the approved near-term analysis window.
12. Future pre-match scheduler that selects only the approved near-term analysis window by default.

## Current Adapter Shell Status

The provider adapter shell exists, but no real provider adapter exists yet.

Implemented shell pieces:

- Provider adapter contract.
- Provider capability model.
- Provider health-check result contract.
- Provider endpoint metadata and MVP operation map.
- Provider request context.
- Provider registry with duplicate-name and unknown-provider failures.
- Local no-op adapter for tests/local development only.
- Adapter-to-ingestion bridge that converts adapter operation results into `ProviderIngestionService` requests.

The shell deliberately does not include provider HTTP clients, Sofascore endpoints, scraping, scheduled provider jobs, or production mock data.

Provider discovery evidence must be captured before any real adapter implementation:

- `docs/providers/provider-discovery-plan.md`
- `docs/providers/provider-operation-coverage-matrix.md`
- `docs/architecture/provider-adapter-implementation-gate.md`

Sofascore evidence is tracked separately in `docs/providers/sofascore-field-evidence.md`; fields in that document are not confirmed until reviewed sample evidence is recorded.

Sofascore is the preferred no-paid-cost candidate for now because paid provider options are deferred, but this is not adapter approval. Static and team-logo evidence must be captured through `docs/providers/sofascore-static-evidence-plan.md`; the gate remains `research_more`.

As of 2026-04-29, Sofascore static discovery for `list_sports`, `list_countries`, `list_competitions`, and `list_seasons` is still `research_more`. Public evidence exists for sport/featured competition names and one football season response shape, but the static slice is not ready for adapter implementation.

Provider candidate comparison lives in `docs/providers/provider-candidate-comparison.md`. Earlier paid-provider candidates remain useful historical evidence, but no paid provider is planned for production ingestion at this stage. Preserve the provider-agnostic shell rather than hardcoding Sofascore into the domain.

api-football.com / API-SPORTS football evidence lives in `docs/providers/api-football-field-evidence.md`. Its current gate decision is `research_more`, and it is deferred because the free tier is too limited for current production-ingestion goals.

The next API-Football step is sanitized manual sample capture using `docs/providers/api-football-sample-capture-checklist.md`, not adapter implementation. Team samples must verify logo/image/crest/badge URL availability for `ProviderTeam.logoUrl` and persistence to `teams.logo_url`; missing individual logos should be tracked but should not fail ingestion.

apifootball.com is now the controlled low/no-cost football POC candidate. It is distinct from api-football.com / API-SPORTS. The local POC adapter is disabled by default, blocked in production, uses only environment variables, and is not wired to schedulers or automatic ingestion. Evidence and workflow notes live in `docs/providers/apifootball-com-field-evidence.md`. The standard league onboarding checklist lives in `docs/providers/apifootball-league-onboarding-runbook.md`.

APIFootball.com now supports endpoint-based multi-credential routing. Provider code chooses keys by safe operation label: countries, leagues, teams, standings, fixtures, events, results, players, statistics, lineups, injuries, then falls back to default and legacy labels. Real keys live only in `.env` or deployment secrets; ingestion reports may show only the safe label used and must never expose raw key values, partial keys, request URLs with keys, or frontend-visible credentials.

The apifootball.com POC supports manual fetching/mapping for countries, leagues, teams, events/scores, and standings. Country data is a required onboarding dependency: every league must confirm `country_id` and `country_name`, then execute countries/leagues before teams, standings, events, scores, or future H2H execute. This keeps the canonical relation chain stable: `country -> competition -> team -> match`, and it powers the future Football Explorer path from Country to Leagues to League detail to Standings to Teams to Team detail. The reviewed football slice now has guarded local/manual database writes through `--execute`; it does not implement livescore polling, odds, predictions, H2H ingestion, lineups, injuries, players, scheduled sync, production ingestion, or frontend behavior.

H2H is now part of the league onboarding standard as a dedicated post-mapping stage. It should be fetched for upcoming or analyzable matches after teams and events are mapped, not for every possible team pair in a league. H2H dry-run must happen before execute. Passing evidence means the provider responds successfully or cleanly reports no H2H, stable team IDs exist, stable match IDs exist when supplied, fulltime and halftime scores are parseable when present, unresolved rows are reported, no fake IDs are created, and dry-run writes zero rows. Missing H2H should not block MVP readiness when team-form coverage is strong enough; it should cap confidence and add a risk warning. Old or low-sample H2H must be downweighted.

The guarded APIFootball H2H ingest command is manual and one-match scoped:

```bash
npm run provider:apifootball:h2h:ingest -- --match-id=<match-uuid>
```

Dry-run is the default. `--execute` is allowed only on local or explicitly approved Neon test targets, after a reviewed dry-run. Strict mode remains the default and blocks if any row is skipped. Reviewed/enabled leagues may opt into `--allow-partial --minimum-clean-rows=3` when skipped rows are only allowed non-critical competition-scope reasons such as `missing_competition_mapping` or `unsupported_competition_scope`. Partial execute normalizes only clean direct H2H rows into canonical `matches` and `football_match_scores`, creates/reuses provider match mappings for those clean rows, and reports skipped row counts/reasons. It never creates fake competitions, teams, matches, or provider IDs. It still blocks missing team mappings, unstable match/team IDs, unparseable scores, unparseable dates, production/main targets, and any path that would require fabricated data. It does not persist raw payloads, run feature builders, generate predictions, settle, publish, mark member-visible, run tahmin kombini, add scheduler behavior, or clean unrelated raw payloads.

Reviewed/enabled leagues also have a manual upcoming H2H batch runner:

```bash
npm run provider:apifootball:h2h:backfill-upcoming -- --country-id=<reviewed-country-id> --league-id=<reviewed-league-id>
```

This is a controlled wrapper over the existing one-match H2H ingest path. It processes one reviewed/enabled league at a time, only `not_started` matches, and optional `--from/--to`, `--window-hours`, and `--limit` filters. Dry-run writes nothing. Execute still evaluates every match first and only normalizes matches whose one-match report is `executeSafe=true`; unsafe matches are skipped instead of failing the whole run. It is not a scheduler and does not run feature builders, candidates, drafts, settlement, public/member-visible flows, tahmin kombini, or fake-ID creation.

After normalized teams, standings, historical matches, scores, and H2H are in place, reviewed/enabled leagues can use the manual pre-match pipeline runner:

```bash
npm run pipeline:football:prematch -- --country-id=<country-id> --league-id=<league-id> --limit=20
```

This runner is analytics-only orchestration, not provider ingestion. It selects only upcoming matches inside the configured pre-match window, rebuilds match-scoped team form/H2H/match features, runs reasoning and consistency-checked candidates, and persists draft audit rows only in explicit `--execute` mode with window enforcement. It never fetches provider data, writes raw payloads, publishes predictions, marks member-visible, settles, or creates tahmin kombini output.

Standard APIFootball football league onboarding stages:

1. Discovery.
2. Review Candidate Config.
3. Countries/Leagues Dry-Run if applicable.
4. Teams/Logos Dry-Run.
5. Standings Dry-Run.
6. Events/Scores Dry-Run.
7. Evidence Review.
8. Mark Reviewed/Enabled.
9. Countries/Leagues Execute.
10. Teams Execute.
11. Standings Execute.
12. Historical Events/Scores Backfill.
13. Upcoming Events Execute.
14. H2H Dry-Run for upcoming matches.
15. H2H Execute for clean upcoming matches.
16. Feature Build.
17. Pre-Match Candidate Flow.

Reviewed football test slices now have a guarded local/manual ingestion command. Reviewed and enabled leagues can dry-run and execute. The current execute-approved allowlist is `country_id=4` with `league_id=171` (`2. Bundesliga`) and `league_id=175` (`Bundesliga`), plus `country_id=111`, `league_id=322` (`Süper Lig`), `country_id=44`, `league_id=152` (`Premier League`), `country_id=6`, `league_id=302` (`La Liga`), `country_id=5`, `league_id=207` (`Serie A`), `country_id=3`, `league_id=168` (`Ligue 1`), and `country_id=82`, `league_id=244` (`Eredivisie`).

New leagues move through a review-candidate state before execute is allowed. Netherlands Eredivisie is now configured as reviewed/enabled: `country_id=82`, `league_id=244`, `dryRunAllowed=true`, `reviewed=true`, and `enabled=true`. It was selected from APIFootball league discovery as the exact Netherlands `Eredivisie` row; similar Dutch competitions such as KNVB Beker (`243`, `1194`), Eerste Divisie (`245`), Derde Divisie (`242`), Eredivisie Women (`481`), Reserve League (`721`), Super Cup (`391`), Tweede Divisie (`584`), and U18/U19/U21 Divisie rows remain out of execute scope. Review evidence: teams 22/22, logos 21/22 with one missing non-fatal, one standings-name enrichment, standings 18/18, recent finished events/scores 8/8 with FT/HT scores 8/8, and upcoming events/scores 10/11 with one safely skipped `After Pen.` non-standard status. `After Pen.` is accepted as a non-fatal caveat only because recent finished-score evidence is clean; it must remain skipped and must not create normal score rows unless an explicit policy is added. France Ligue 1 is now configured as reviewed/enabled: `country_id=3`, `league_id=168`, `dryRunAllowed=true`, `reviewed=true`, and `enabled=true`. It was selected from APIFootball league discovery as the exact France `Ligue 1` row; similar competitions such as Ligue 2, Coupe de la Ligue, National 1/2/3, Première Ligue, Trophée des Champions, and non-France `Ligue 1` rows remain out of scope. Review evidence: teams/logos 18/18, standings 18/18, upcoming events 9/9, recent finished events/scores 9/9, FT/HT scores 9/9, unresolved rows 0. A narrow countries/leagues execute is required before Ligue 1 teams, standings, or events execute because the competition provider mapping is not yet present on the current test branch. Italy Serie A is now configured as reviewed/enabled: `country_id=5`, `league_id=207`, `dryRunAllowed=true`, `reviewed=true`, and `enabled=true`. It was selected from APIFootball league discovery as the exact Italy `Serie A` row; similar leagues such as Serie B, Serie C, Serie D, Serie A Women, Coppa Italia, Super Cup, Primavera leagues/cups, and non-Italy Serie A names in Brazil/Mexico remain out of scope. Review evidence: teams/logos 20/20 with 19/20 logos and one standings-name enrichment, standings 20/20, recent finished events/scores 10/10 with FT/HT scores 10/10, and upcoming events/scores 9/10. The one skipped upcoming row was a live APIFootball numeric `match_status`; it is non-fatal because finished-score evidence is clean, but it must remain skipped and later refreshed after a final supported status appears. Spain La Liga is now configured as reviewed/enabled: `country_id=6`, `league_id=302`, `dryRunAllowed=true`, `reviewed=true`, and `enabled=true`. It was selected from APIFootball league discovery as the exact Spain `La Liga` row; similar Spanish competitions such as Segunda División, Copa del Rey, Super Cup, Primera División RFEF, and Primera División Femenina remain out of scope. Review evidence: teams/logos 20/20, standings 20/20, upcoming events 10/10, recent finished events/scores 10/10, FT/HT scores 10/10, unresolved rows 0. A narrow countries/leagues execute is required before La Liga teams, standings, or events execute because the competition provider mapping is not yet present on the current test branch. Süper Lig has completed controlled teams/logos/events/standings dry-run review and is now configured as `dryRunAllowed=true`, `reviewed=true`, and `enabled=true`. Unknown leagues and configured candidates with `dryRunAllowed=false` remain blocked in both dry-run and execute mode.

Reviewed/enabled football leagues may use the manual historical backfill runner:

```bash
npm run provider:apifootball:backfill-history -- \
  --country-id=<reviewed-country-id> \
  --league-id=<reviewed-league-id> \
  --from=<YYYY-MM-DD> \
  --to=<YYYY-MM-DD> \
  --batch-days=14
```

The runner is a controlled batching wrapper over the existing APIFootball manual ingestion path. It is not a scheduler. It requires local or explicit Neon test DB readiness, refuses production/main targets, and calls only `events,scores`. Each batch performs dry-run first; when `--execute` is present, the same clean batch is then executed. It stops on unresolved/skipped rows, provider failures, configured empty-batch limit, optional target finished count, or end of range. Review-candidate leagues stay on the stricter 7-day evidence dry-run path and cannot use this runner until `reviewed=true` and `enabled=true`.

England Premier League is now configured as reviewed/enabled: `country_id=44`, `league_id=152`, `dryRunAllowed=true`, `reviewed=true`, and `enabled=true`. It was selected from APIFootball league discovery because it is the exact `Premier League` row for England; similar league names such as Premier League 2, Premier League Cup, Premier League Summer Series, U18 Premier League, and Non League Premier remain out of scope. Review evidence: teams/logos 20/20, standings 20/20, events/scores 10/10, unresolved rows 0. A narrow countries/leagues execute is required before Premier League teams, standings, or events execute because the competition provider mapping is not yet present on the current test branch.

Süper Lig MVP readiness is analysis-only for now. The non-production `skoriq-ingestion-test` branch has clean normalized coverage for 18 teams, 16 logos, 18 standings rows, 38 finished matches, 9 upcoming matches, 38 score rows, and 38/38 halftime score rows. However, all 9 upcoming matches are still `partial` for prediction readiness because scoped home/away samples are low and H2H is 0 for every upcoming matchup. The best current target, Samsunspor vs Galatasaray, remains `partial` with combined coverage 40. Do not force candidate generation, persist drafts, include Süper Lig in tahmin kombini, or expose member/public predictions until scoped samples and/or H2H coverage improve.

For APIFootball team identity quality, the manual command can use a narrow same-league fallback: when a `get_teams` row has a stable provider team ID but an empty `team_name`, it may fill only the team name from `get_standings` when the standings row has the exact same team ID and a non-empty `team_name`. This is provider data quality handling, not fake data creation. The fallback never fills logos, never creates provider IDs, and is reported through `enrichedTeamNamesCount` / `enrichedFrom=standings`.

```bash
APIFOOTBALL_COM_ENABLED=true \
npm run provider:apifootball:ingest:manual -- \
  --country-id=4 \
  --league-id=171 \
  --from=2026-04-24 \
  --to=2026-04-26
```

Dry-run is the default. `--execute` is required for database writes. Execute mode runs `npm run db:check`-equivalent readiness checks before provider fetch, stores payloads through `ProviderIngestionService`, runs `RawPayloadProcessor` inline in dependency order, and does not require a worker for this command. Execute mode also prints a safe post-run verification report with canonical counts, team logo coverage, raw payload status distribution, failed payload count, current-run unresolved/skipped rows, and before/after regression detection when available. Every run emits a sanitized `ingestionRunReport`; `--report-json` optionally persists it to ignored `.provider-runs/apifootball-com/`. The command does not use `sync_job_logs` for this manual history because those logs are tied to sync jobs. Production remains blocked, and no scheduler, cron, automatic sync, live polling, frontend, prediction model, odds module, basketball adapter, or broad provider rollout is approved.

Failed raw payload retry is manual/admin-only. Use `npm run provider:raw-payload:reprocess -- --raw-payload-id=<uuid>` after a known dependency or provider mapping fix. Dry-run writes nothing and validates the target payload, provider, entity type, current failed status, and dependency mappings. Execute reprocesses exactly that raw payload through the normalizer path without refetching provider data. The MVP is restricted to APIFootball `football_standing` payloads, does not delete raw payloads, does not retry all failures, and does not clean historical failed rows.

Local database readiness options:

- Run local PostgreSQL manually and create `sports_data`.
- Use `docker compose -f docker/local/compose.yml up -d` if Docker is installed.
- Use an existing disposable local PostgreSQL database.
- Use an explicitly approved Neon test branch only with `DB_EXECUTION_TARGET=neon-test` and `ALLOW_REMOTE_TEST_DB=true`.
- Optionally set `NEON_BRANCH_NAME` so `db:check` displays the reviewed branch name.
- Run `npm run db:check` to confirm sanitized target details, connectivity, and expected tables.
- Do not point first ingestion at Neon main, Neon production, or broad remote managed PostgreSQL.

The command does not fabricate season IDs. APIFootball.com reviewed responses do not provide a stable season provider ID for this slice, so matches and football standings rely on nullable season behavior already supported by the schema and normalizers.

## Endpoint Acceptance Gate

Before implementing a provider endpoint:

- Inspect representative responses for football and/or basketball.
- Update the provider-specific evidence document.
- Satisfy `docs/architecture/provider-adapter-implementation-gate.md`.
- Map each needed field to a provider-agnostic DTO.
- Confirm the target table exists or document raw-only storage.
- Define P0/P1/P2 priority and whether the field is pre-match or post-match.
- Define missing-field behavior.
- Define validation rules.
- Define sync frequency and retry behavior.
- Define whether fetched fixtures are for schedule visibility only or eligible for the 24-hour pre-match analysis window.
- Confirm raw payload retention is acceptable.
- Add unit tests for DTO mapping and normalizer behavior.
- Avoid production mock data and never target Neon production with test fixtures.

## Raw-Only Vs Normalized Guidance

Normalize when:

- The field is provider-agnostic.
- The schema and normalizer already exist.
- Validation behavior is clear.
- The field is needed for P0/P1 analysis or future feature builders.

Keep raw-only when:

- The field is provider-specific or unstable.
- The target table is not approved yet.
- The field has unclear semantics across sports or leagues.
- The field is high-volume advanced data such as heatmaps or momentum timelines.
- Legal or terms-of-service review is pending.

## Non-Goals

- No Sofascore adapter yet.
- No scraping code.
- No live-score polling or WebSockets.
- No automatic pre-match analysis scheduler from this roadmap alone.
- No prediction model.
- No betting or odds module unless separately approved.
- No frontend.
- No schema or normalizer changes from this roadmap alone.
