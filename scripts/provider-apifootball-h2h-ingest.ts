import "dotenv/config";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { APIFootballComHttpClient, APIFootballComHttpError, createAPIFootballCredentialResolver, sanitizeProviderPayload } from "@sports-data/providers";
import type { MatchStatus } from "@sports-data/shared";
import { checkDatabaseReadiness, formatDatabaseReadinessResult } from "./db-readiness.js";
import {
  extractDirectH2HRecords,
  isIntegerString,
  optionalString,
  resolveH2HTarget,
  summarizeH2HPayload
} from "./provider-apifootball-h2h-evidence.js";
import type { H2HRecordLike, ResolvedH2HTarget } from "./provider-apifootball-h2h-evidence.js";

const providerName = "apifootball-com";
const defaultBaseUrl = "https://apiv3.apifootball.com/";
const defaultTimeoutMs = 15000;

export interface APIFootballH2HIngestOptions {
  matchId?: string;
  execute: boolean;
  allowPartial: boolean;
  minimumCleanRows: number;
}

export interface APIFootballH2HIngestPlanRow {
  providerMatchId?: string;
  matchDate?: string;
  homeTeamProviderId?: string;
  awayTeamProviderId?: string;
  competitionProviderId?: string;
  canonicalCompetitionId?: string;
  canonicalHomeTeamId?: string;
  canonicalAwayTeamId?: string;
  homeScoreFulltime?: number;
  awayScoreFulltime?: number;
  homeScoreHalftime?: number;
  awayScoreHalftime?: number;
  status?: MatchStatus;
  scheduledStartAt?: string;
  action: "normalize" | "skip";
  skipReason?: string;
}

export interface H2HProviderMappingLookup {
  competitionByProviderId: Record<string, string | undefined>;
  teamByProviderId: Record<string, string | undefined>;
}

export interface APIFootballH2HIngestReport {
  mode: "dry-run" | "execute";
  providerAction: "get_H2H";
  credentialLabel?: string;
  target: ResolvedH2HTarget;
  totalH2hRows: number;
  cleanRows: number;
  skippedRows: number;
  skippedReasons: Record<string, number>;
  allowPartial: boolean;
  minimumCleanRows: number;
  executeSafe: boolean;
  blockReason?: string;
  h2hFetchedCount: number;
  stableH2HMatchIdsCount: number;
  stableHomeAwayProviderTeamIdsCount: number;
  canonicalTeamMappingCount: number;
  fulltimeScoreFieldsPresentCount: number;
  halftimeScoreFieldsPresentCount: number;
  unresolvedSkippedRows: number;
  wouldInsertOrUpdateMatches: number;
  wouldInsertOrUpdateScores: number;
  matchesInsertedOrUpdated: number;
  footballMatchScoresInsertedOrUpdated: number;
  providerMatchMappingsCreated: number;
  providerMatchMappingsReused: number;
  h2hCanonicalMatchesAvailableForPair?: number;
  h2hScoreRowsAvailableForPair?: number;
  rawPayloadPersistenceCount: 0;
  dbWritesCount: number;
  secretExposureCheck: "clean";
  cleanEnoughForFutureExecute: boolean;
  rows: APIFootballH2HIngestPlanRow[];
  warnings: string[];
}

type Queryable = Pick<pg.Pool | pg.PoolClient, "query">;

const defaultMinimumCleanRows = 3;
const allowPartialSkipReasons = new Set(["missing_competition_mapping", "unsupported_competition_scope", "competition_mapping_missing"]);

export function parseAPIFootballH2HIngestArgs(argv: string[]): APIFootballH2HIngestOptions {
  const options: APIFootballH2HIngestOptions = { execute: false, allowPartial: false, minimumCleanRows: defaultMinimumCleanRows };
  for (const arg of argv) {
    if (arg === "--execute") {
      options.execute = true;
      continue;
    }
    if (arg === "--dry-run") {
      options.execute = false;
      continue;
    }
    if (arg === "--allow-partial") {
      options.allowPartial = true;
      continue;
    }
    const [key, value] = arg.split("=", 2);
    switch (key) {
      case "--match-id":
        options.matchId = requiredFlagValue(key, value);
        break;
      case "--minimum-clean-rows":
        options.minimumCleanRows = parsePositiveIntegerFlag(key, value);
        break;
      default:
        throw new Error(`Unknown APIFootball.com H2H ingest flag "${key}".`);
    }
  }
  return options;
}

export function validateAPIFootballH2HIngestOptions(options: APIFootballH2HIngestOptions, env: NodeJS.ProcessEnv) {
  if (!options.matchId) throw new Error("APIFootball.com H2H ingest requires --match-id=<uuid>.");
  if (!Number.isInteger(options.minimumCleanRows) || options.minimumCleanRows < 1) {
    throw new Error("APIFootball.com H2H ingest requires --minimum-clean-rows to be a positive integer.");
  }
  if (env.NODE_ENV === "production") throw new Error("APIFootball.com H2H ingest is forbidden in production.");
  if (env.APIFOOTBALL_COM_ENABLED !== "true") throw new Error("APIFootball.com H2H ingest requires APIFOOTBALL_COM_ENABLED=true.");
}

export interface H2HPartialExecutePolicy {
  totalH2hRows: number;
  cleanRows: number;
  skippedRows: number;
  skippedReasons: Record<string, number>;
  allowPartial: boolean;
  minimumCleanRows: number;
  executeSafe: boolean;
  blockReason?: string;
}

export function evaluateH2HPartialExecutePolicy(rows: APIFootballH2HIngestPlanRow[], options: Pick<APIFootballH2HIngestOptions, "allowPartial" | "minimumCleanRows">): H2HPartialExecutePolicy {
  const cleanRows = rows.filter((row) => row.action === "normalize").length;
  const skippedRows = rows.length - cleanRows;
  const skippedReasons = countSkippedReasons(rows);
  const skippedReasonKeys = Object.keys(skippedReasons);

  if (cleanRows < options.minimumCleanRows) {
    return {
      totalH2hRows: rows.length,
      cleanRows,
      skippedRows,
      skippedReasons: { ...skippedReasons, clean_rows_below_minimum: 1 },
      allowPartial: options.allowPartial,
      minimumCleanRows: options.minimumCleanRows,
      executeSafe: false,
      blockReason: "clean_rows_below_minimum"
    };
  }

  if (skippedRows === 0) {
    return {
      totalH2hRows: rows.length,
      cleanRows,
      skippedRows,
      skippedReasons,
      allowPartial: options.allowPartial,
      minimumCleanRows: options.minimumCleanRows,
      executeSafe: true
    };
  }

  if (!options.allowPartial) {
    return {
      totalH2hRows: rows.length,
      cleanRows,
      skippedRows,
      skippedReasons,
      allowPartial: false,
      minimumCleanRows: options.minimumCleanRows,
      executeSafe: false,
      blockReason: "unresolved_rows_present_strict_mode"
    };
  }

  const disallowedReasons = skippedReasonKeys.filter((reason) => !allowPartialSkipReasons.has(reason));
  if (disallowedReasons.length > 0) {
    return {
      totalH2hRows: rows.length,
      cleanRows,
      skippedRows,
      skippedReasons,
      allowPartial: true,
      minimumCleanRows: options.minimumCleanRows,
      executeSafe: false,
      blockReason: `disallowed_skipped_reasons:${disallowedReasons.join(",")}`
    };
  }

  return {
    totalH2hRows: rows.length,
    cleanRows,
    skippedRows,
    skippedReasons,
    allowPartial: true,
    minimumCleanRows: options.minimumCleanRows,
    executeSafe: true
  };
}

export function buildH2HIngestPlan(records: H2HRecordLike[], target: ResolvedH2HTarget, mappings: H2HProviderMappingLookup): APIFootballH2HIngestPlanRow[] {
  return records.map((record) => {
    const providerMatchId = optionalString(record.match_id);
    const homeTeamProviderId = optionalString(record.match_hometeam_id);
    const awayTeamProviderId = optionalString(record.match_awayteam_id);
    const competitionProviderId = optionalString(record.league_id);
    const homeScoreRaw = optionalString(record.match_hometeam_score);
    const awayScoreRaw = optionalString(record.match_awayteam_score);
    const homeHtRaw = optionalString(record.match_hometeam_halftime_score);
    const awayHtRaw = optionalString(record.match_awayteam_halftime_score);
    const scheduledStartAt = parseProviderDateTime(optionalString(record.match_date), optionalString(record.match_time));
    const status = normalizeProviderStatus(optionalString(record.match_status));
    const canonicalHomeTeamId = homeTeamProviderId ? mappings.teamByProviderId[homeTeamProviderId] : undefined;
    const canonicalAwayTeamId = awayTeamProviderId ? mappings.teamByProviderId[awayTeamProviderId] : undefined;
    const canonicalCompetitionId = competitionProviderId ? mappings.competitionByProviderId[competitionProviderId] : undefined;

    const base = {
      providerMatchId,
      matchDate: optionalString(record.match_date),
      homeTeamProviderId,
      awayTeamProviderId,
      competitionProviderId,
      canonicalCompetitionId,
      canonicalHomeTeamId,
      canonicalAwayTeamId,
      homeScoreFulltime: parseInteger(homeScoreRaw),
      awayScoreFulltime: parseInteger(awayScoreRaw),
      homeScoreHalftime: parseInteger(homeHtRaw),
      awayScoreHalftime: parseInteger(awayHtRaw),
      status,
      scheduledStartAt: scheduledStartAt?.toISOString()
    };

    const skipReason =
      missingReason("missing_provider_match_id", !providerMatchId) ??
      missingReason("missing_home_or_away_provider_team_id", !homeTeamProviderId || !awayTeamProviderId) ??
      missingReason("h2h_team_not_in_target_pair", !isTargetPair(homeTeamProviderId, awayTeamProviderId, target)) ??
      missingReason("missing_competition_provider_id", !competitionProviderId) ??
      missingReason("missing_competition_mapping", !canonicalCompetitionId) ??
      missingReason("team_mapping_missing", !canonicalHomeTeamId || !canonicalAwayTeamId) ??
      missingReason("missing_or_unparseable_match_date", !scheduledStartAt) ??
      missingReason("missing_or_unparseable_fulltime_score", !isIntegerString(homeScoreRaw) || !isIntegerString(awayScoreRaw)) ??
      missingReason("missing_or_unparseable_halftime_score", Boolean((homeHtRaw || awayHtRaw) && (!isIntegerString(homeHtRaw) || !isIntegerString(awayHtRaw))));

    return skipReason ? { ...base, action: "skip", skipReason } : { ...base, action: "normalize" };
  });
}

export async function runAPIFootballH2HIngest(options: APIFootballH2HIngestOptions, env: NodeJS.ProcessEnv = process.env): Promise<APIFootballH2HIngestReport> {
  validateAPIFootballH2HIngestOptions(options, env);
  const readiness = await checkDatabaseReadiness({
    databaseUrl: env.DATABASE_URL,
    nodeEnv: env.NODE_ENV,
    dbExecutionTarget: env.DB_EXECUTION_TARGET,
    allowRemoteTestDb: env.ALLOW_REMOTE_TEST_DB,
    neonBranchName: env.NEON_BRANCH_NAME
  });
  if (readiness.status !== "ready") {
    throw new Error(`Database is not ready for APIFootball.com H2H ingest:\n${formatDatabaseReadinessResult(readiness)}`);
  }

  const resolver = createAPIFootballCredentialResolver({
    legacyApiKey: env.APIFOOTBALL_COM_API_KEY,
    defaultApiKey: env.APIFOOTBALL_COM_API_KEY_DEFAULT,
    countriesApiKey: env.APIFOOTBALL_COM_API_KEY_COUNTRIES,
    leaguesApiKey: env.APIFOOTBALL_COM_API_KEY_LEAGUES,
    teamsApiKey: env.APIFOOTBALL_COM_API_KEY_TEAMS,
    standingsApiKey: env.APIFOOTBALL_COM_API_KEY_STANDINGS,
    eventsApiKey: env.APIFOOTBALL_COM_API_KEY_EVENTS,
    resultsApiKey: env.APIFOOTBALL_COM_API_KEY_RESULTS,
    fixturesApiKey: env.APIFOOTBALL_COM_API_KEY_FIXTURES,
    playersApiKey: env.APIFOOTBALL_COM_API_KEY_PLAYERS,
    statisticsApiKey: env.APIFOOTBALL_COM_API_KEY_STATISTICS,
    lineupsApiKey: env.APIFOOTBALL_COM_API_KEY_LINEUPS,
    injuriesApiKey: env.APIFOOTBALL_COM_API_KEY_INJURIES
  });
  if (!resolver.hasAnyCredential()) throw new Error("At least one APIFOOTBALL_COM_API_KEY* value is required for APIFootball.com H2H ingest.");

  const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 1 });
  try {
    const target = await resolveH2HTarget(pool, options.matchId!);
    const sportSlug = await resolveTargetSportSlug(pool, target.competitionId);
    if (sportSlug !== "football") {
      throw new Error(`APIFootball.com H2H ingest requires a football target match; resolved sport "${sportSlug}".`);
    }
    if (!target.homeProviderTeamId || !target.awayProviderTeamId) {
      throw new Error("APIFootball.com H2H ingest requires APIFootball provider mappings for both target teams.");
    }

    const client = new APIFootballComHttpClient({
      baseUrl: env.APIFOOTBALL_COM_BASE_URL ?? defaultBaseUrl,
      credentialResolver: resolver,
      timeoutMs: Number(env.APIFOOTBALL_COM_TIMEOUT_MS ?? defaultTimeoutMs)
    });
    const providerResult = await client.requestJson<unknown>({
      action: "get_H2H",
      credentialAction: "events",
      params: {
        firstTeamId: target.homeProviderTeamId,
        secondTeamId: target.awayProviderTeamId,
        timezone: "Europe/Istanbul"
      }
    });
    const sanitizedPayload = sanitizeProviderPayload(providerResult.payload, "");
    const records = extractDirectH2HRecords(sanitizedPayload);
    const h2hEvidence = summarizeH2HPayload(sanitizedPayload, target, providerResult.metadata.credentialLabel);
    const mappings = await loadProviderMappings(pool, records);
    const rows = buildH2HIngestPlan(records, target, mappings);
    const normalizableRows = rows.filter((row) => row.action === "normalize");
    const partialPolicy = evaluateH2HPartialExecutePolicy(rows, options);

    if (options.execute && !partialPolicy.executeSafe) {
      return buildReport({
        mode: "execute",
        target,
        credentialLabel: providerResult.metadata.credentialLabel,
        evidence: h2hEvidence,
        rows,
        partialPolicy,
        execution: emptyExecution(),
        warnings: [`Execute blocked: ${partialPolicy.blockReason ?? "h2h_partial_policy_not_satisfied"}.`]
      });
    }

    if (!options.execute) {
      return buildReport({
        mode: "dry-run",
        target,
        credentialLabel: providerResult.metadata.credentialLabel,
        evidence: h2hEvidence,
        rows,
        partialPolicy,
        execution: emptyExecution(),
        warnings: []
      });
    }

    const execution = await executeH2HNormalization(pool, target, normalizableRows);
    const verification = await queryPairVerification(pool, target);
    return buildReport({
      mode: "execute",
      target,
      credentialLabel: providerResult.metadata.credentialLabel,
      evidence: h2hEvidence,
      rows,
      partialPolicy,
      execution,
      verification,
      warnings: []
    });
  } catch (error) {
    if (error instanceof APIFootballComHttpError) {
      throw new Error(
        JSON.stringify(
          {
            kind: error.details.kind,
            action: error.details.action,
            message: error.details.message,
            safeRequestUrl: error.details.safeRequestUrl,
            credentialLabel: error.details.credentialLabel,
            status: error.details.status
          },
          null,
          2
        )
      );
    }
    throw error;
  } finally {
    await pool.end();
  }
}

async function loadProviderMappings(db: Queryable, records: H2HRecordLike[]): Promise<H2HProviderMappingLookup> {
  const competitionProviderIds = unique(records.map((record) => optionalString(record.league_id)));
  const teamProviderIds = unique(records.flatMap((record) => [optionalString(record.match_hometeam_id), optionalString(record.match_awayteam_id)]));
  const competitionByProviderId = await loadMappingMap(db, "competition", competitionProviderIds);
  const teamByProviderId = await loadMappingMap(db, "team", teamProviderIds);
  return { competitionByProviderId, teamByProviderId };
}

async function loadMappingMap(db: Queryable, entityType: "competition" | "team", providerIds: string[]) {
  if (providerIds.length === 0) return {};
  const result = await db.query<{ provider_entity_id: string; internal_entity_id: string }>(
    `
      select provider_entity_id, internal_entity_id
      from provider_mappings
      where provider = $1 and entity_type = $2 and provider_entity_id = any($3::text[])
    `,
    [providerName, entityType, providerIds]
  );
  return Object.fromEntries(result.rows.map((row) => [row.provider_entity_id, row.internal_entity_id]));
}

async function executeH2HNormalization(pool: pg.Pool, target: ResolvedH2TargetForExecute, rows: APIFootballH2HIngestPlanRow[]): Promise<ExecutionSummary> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const execution = emptyExecution();
    for (const row of rows) {
      const mapping = await findProviderMatchMapping(client, row.providerMatchId!);
      let matchId = mapping?.internal_entity_id;
      if (mapping) execution.providerMatchMappingsReused += 1;

      const matchInput = {
        sportId: await resolveTargetSportId(client, target.competitionId),
        competitionId: row.canonicalCompetitionId!,
        seasonId: row.canonicalCompetitionId === target.competitionId ? await resolveTargetSeasonId(client, target.matchId) : null,
        homeTeamId: row.canonicalHomeTeamId!,
        awayTeamId: row.canonicalAwayTeamId!,
        scheduledStartAt: row.scheduledStartAt!,
        status: row.status ?? "finished",
        metadataJson: {
          source: "apifootball_h2h_ingest",
          targetMatchId: target.matchId,
          providerMatchId: row.providerMatchId,
          providerAction: "get_H2H"
        }
      };

      if (matchId) {
        await updateMatch(client, matchId, matchInput);
      } else {
        matchId = await upsertMatch(client, matchInput);
        await createProviderMatchMapping(client, row.providerMatchId!, matchId);
        execution.providerMatchMappingsCreated += 1;
      }
      execution.matchesInsertedOrUpdated += 1;

      await upsertFootballScore(client, matchId, row);
      execution.footballMatchScoresInsertedOrUpdated += 1;
    }
    await client.query("commit");
    return execution;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

type ResolvedH2TargetForExecute = Pick<ResolvedH2HTarget, "matchId" | "competitionId">;

interface MatchInput {
  sportId: string;
  competitionId: string;
  seasonId: string | null;
  homeTeamId: string;
  awayTeamId: string;
  scheduledStartAt: string;
  status: MatchStatus;
  metadataJson: Record<string, unknown>;
}

interface ExecutionSummary {
  matchesInsertedOrUpdated: number;
  footballMatchScoresInsertedOrUpdated: number;
  providerMatchMappingsCreated: number;
  providerMatchMappingsReused: number;
}

interface PairVerification {
  h2hCanonicalMatchesAvailableForPair: number;
  h2hScoreRowsAvailableForPair: number;
}

async function resolveTargetSportId(db: Queryable, competitionId: string) {
  const result = await db.query<{ sport_id: string }>("select sport_id from competitions where id = $1", [competitionId]);
  const sportId = result.rows[0]?.sport_id;
  if (!sportId) throw new Error(`Cannot resolve sport for competition "${competitionId}".`);
  return sportId;
}

async function resolveTargetSportSlug(db: Queryable, competitionId: string) {
  const result = await db.query<{ slug: string }>(
    `
      select s.slug
      from competitions c
      join sports s on s.id = c.sport_id
      where c.id = $1
    `,
    [competitionId]
  );
  const slug = result.rows[0]?.slug;
  if (!slug) throw new Error(`Cannot resolve sport for competition "${competitionId}".`);
  return slug;
}

async function resolveTargetSeasonId(db: Queryable, matchId: string) {
  const result = await db.query<{ season_id: string | null }>("select season_id from matches where id = $1", [matchId]);
  return result.rows[0]?.season_id ?? null;
}

async function findProviderMatchMapping(db: Queryable, providerMatchId: string) {
  const result = await db.query<{ internal_entity_id: string }>(
    "select internal_entity_id from provider_mappings where provider = $1 and entity_type = 'match' and provider_entity_id = $2 limit 1",
    [providerName, providerMatchId]
  );
  return result.rows[0];
}

async function createProviderMatchMapping(db: Queryable, providerMatchId: string, matchId: string) {
  await db.query(
    `
      insert into provider_mappings (provider, entity_type, provider_entity_id, internal_entity_type, internal_entity_id, metadata_json)
      values ($1, 'match', $2, 'match', $3, $4::jsonb)
      on conflict (provider, entity_type, provider_entity_id)
      do update set internal_entity_id = excluded.internal_entity_id, internal_entity_type = excluded.internal_entity_type, updated_at = now()
    `,
    [providerName, providerMatchId, matchId, JSON.stringify({ source: "apifootball_h2h_ingest" })]
  );
}

async function upsertMatch(db: Queryable, input: MatchInput) {
  const result = await db.query<{ id: string }>(
    `
      insert into matches (sport_id, competition_id, season_id, home_team_id, away_team_id, scheduled_start_at, status, metadata_json)
      values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
      on conflict on constraint matches_natural_uidx
      do update set
        sport_id = excluded.sport_id,
        status = excluded.status,
        metadata_json = excluded.metadata_json,
        updated_at = now()
      returning id
    `,
    [input.sportId, input.competitionId, input.seasonId, input.homeTeamId, input.awayTeamId, input.scheduledStartAt, input.status, JSON.stringify(input.metadataJson)]
  );
  return result.rows[0]!.id;
}

async function updateMatch(db: Queryable, matchId: string, input: MatchInput) {
  await db.query(
    `
      update matches
      set sport_id = $1,
          competition_id = $2,
          season_id = $3,
          home_team_id = $4,
          away_team_id = $5,
          scheduled_start_at = $6,
          status = $7,
          metadata_json = $8::jsonb,
          updated_at = now()
      where id = $9
    `,
    [input.sportId, input.competitionId, input.seasonId, input.homeTeamId, input.awayTeamId, input.scheduledStartAt, input.status, JSON.stringify(input.metadataJson), matchId]
  );
}

async function upsertFootballScore(db: Queryable, matchId: string, row: APIFootballH2HIngestPlanRow) {
  const winnerTeamId =
    row.homeScoreFulltime! > row.awayScoreFulltime! ? row.canonicalHomeTeamId : row.awayScoreFulltime! > row.homeScoreFulltime! ? row.canonicalAwayTeamId : null;
  await db.query(
    `
      insert into football_match_scores (
        match_id, home_team_id, away_team_id, winner_team_id,
        home_score_current, away_score_current,
        home_score_halftime, away_score_halftime,
        home_score_fulltime, away_score_fulltime,
        status, metadata_json
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $5, $6, $9, $10::jsonb)
      on conflict (match_id)
      do update set
        home_team_id = excluded.home_team_id,
        away_team_id = excluded.away_team_id,
        winner_team_id = excluded.winner_team_id,
        home_score_current = excluded.home_score_current,
        away_score_current = excluded.away_score_current,
        home_score_halftime = excluded.home_score_halftime,
        away_score_halftime = excluded.away_score_halftime,
        home_score_fulltime = excluded.home_score_fulltime,
        away_score_fulltime = excluded.away_score_fulltime,
        status = excluded.status,
        metadata_json = excluded.metadata_json,
        updated_at = now()
    `,
    [
      matchId,
      row.canonicalHomeTeamId,
      row.canonicalAwayTeamId,
      winnerTeamId,
      row.homeScoreFulltime,
      row.awayScoreFulltime,
      row.homeScoreHalftime,
      row.awayScoreHalftime,
      row.status ?? "finished",
      JSON.stringify({ source: "apifootball_h2h_ingest", providerMatchId: row.providerMatchId })
    ]
  );
}

async function queryPairVerification(db: Queryable, target: ResolvedH2HTarget): Promise<PairVerification> {
  const result = await db.query<{ matches_count: string; scores_count: string }>(
    `
      select
        count(distinct m.id)::text as matches_count,
        count(distinct s.id)::text as scores_count
      from matches m
      left join football_match_scores s on s.match_id = m.id
      where m.competition_id = $1
        and m.scheduled_start_at < $2
        and (
          (m.home_team_id = $3 and m.away_team_id = $4)
          or (m.home_team_id = $4 and m.away_team_id = $3)
        )
    `,
    [target.competitionId, target.kickoffAt, target.canonicalHomeTeamId, target.canonicalAwayTeamId]
  );
  return {
    h2hCanonicalMatchesAvailableForPair: Number(result.rows[0]?.matches_count ?? 0),
    h2hScoreRowsAvailableForPair: Number(result.rows[0]?.scores_count ?? 0)
  };
}

function buildReport(input: {
  mode: "dry-run" | "execute";
  target: ResolvedH2HTarget;
  credentialLabel?: string;
  evidence: ReturnType<typeof summarizeH2HPayload>;
  rows: APIFootballH2HIngestPlanRow[];
  partialPolicy: H2HPartialExecutePolicy;
  execution: ExecutionSummary;
  verification?: PairVerification;
  warnings: string[];
}): APIFootballH2HIngestReport {
  const normalizableRows = input.rows.filter((row) => row.action === "normalize");
  const unresolvedSkippedRows = input.rows.length - normalizableRows.length;
  return {
    mode: input.mode,
    providerAction: "get_H2H",
    credentialLabel: input.credentialLabel,
    target: input.target,
    totalH2hRows: input.partialPolicy.totalH2hRows,
    cleanRows: input.partialPolicy.cleanRows,
    skippedRows: input.partialPolicy.skippedRows,
    skippedReasons: input.partialPolicy.skippedReasons,
    allowPartial: input.partialPolicy.allowPartial,
    minimumCleanRows: input.partialPolicy.minimumCleanRows,
    executeSafe: input.partialPolicy.executeSafe,
    blockReason: input.partialPolicy.blockReason,
    h2hFetchedCount: input.evidence.recordsFetchedCount,
    stableH2HMatchIdsCount: input.evidence.stableH2HMatchIdsCount,
    stableHomeAwayProviderTeamIdsCount: input.evidence.stableHomeAwayTeamIdsCount,
    canonicalTeamMappingCount: input.rows.filter((row) => Boolean(row.canonicalHomeTeamId && row.canonicalAwayTeamId)).length,
    fulltimeScoreFieldsPresentCount: input.evidence.fulltimeScoreFieldsPresentCount,
    halftimeScoreFieldsPresentCount: input.evidence.halftimeScoreFieldsPresentCount,
    unresolvedSkippedRows,
    wouldInsertOrUpdateMatches: normalizableRows.length,
    wouldInsertOrUpdateScores: normalizableRows.length,
    matchesInsertedOrUpdated: input.mode === "execute" ? input.execution.matchesInsertedOrUpdated : 0,
    footballMatchScoresInsertedOrUpdated: input.mode === "execute" ? input.execution.footballMatchScoresInsertedOrUpdated : 0,
    providerMatchMappingsCreated: input.mode === "execute" ? input.execution.providerMatchMappingsCreated : 0,
    providerMatchMappingsReused: input.mode === "execute" ? input.execution.providerMatchMappingsReused : 0,
    h2hCanonicalMatchesAvailableForPair: input.verification?.h2hCanonicalMatchesAvailableForPair,
    h2hScoreRowsAvailableForPair: input.verification?.h2hScoreRowsAvailableForPair,
    rawPayloadPersistenceCount: 0,
    dbWritesCount: input.mode === "execute" ? input.execution.matchesInsertedOrUpdated + input.execution.footballMatchScoresInsertedOrUpdated + input.execution.providerMatchMappingsCreated : 0,
    secretExposureCheck: "clean",
    cleanEnoughForFutureExecute: input.partialPolicy.executeSafe,
    rows: input.rows,
    warnings: input.warnings
  };
}

function countSkippedReasons(rows: APIFootballH2HIngestPlanRow[]) {
  return rows.reduce<Record<string, number>>((counts, row) => {
    if (row.action !== "skip") return counts;
    const reason = row.skipReason ?? "unknown";
    counts[reason] = (counts[reason] ?? 0) + 1;
    return counts;
  }, {});
}

function emptyExecution(): ExecutionSummary {
  return {
    matchesInsertedOrUpdated: 0,
    footballMatchScoresInsertedOrUpdated: 0,
    providerMatchMappingsCreated: 0,
    providerMatchMappingsReused: 0
  };
}

function isTargetPair(homeTeamProviderId: string | undefined, awayTeamProviderId: string | undefined, target: ResolvedH2HTarget) {
  if (!homeTeamProviderId || !awayTeamProviderId || !target.homeProviderTeamId || !target.awayProviderTeamId) return false;
  const expected = new Set([target.homeProviderTeamId, target.awayProviderTeamId]);
  return expected.has(homeTeamProviderId) && expected.has(awayTeamProviderId);
}

function parseProviderDateTime(dateValue: string | undefined, timeValue: string | undefined): Date | undefined {
  if (!dateValue) return undefined;
  const time = timeValue && /^\d{1,2}:\d{2}$/.test(timeValue) ? timeValue.padStart(5, "0") : "00:00";
  const parsed = new Date(`${dateValue}T${time}:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function normalizeProviderStatus(status: string | undefined): MatchStatus {
  if (!status) return "finished";
  return /finished|ft|after extra|after penalties/i.test(status) ? "finished" : "finished";
}

function parseInteger(value: string | undefined): number | undefined {
  return isIntegerString(value) ? Number(value) : undefined;
}

function missingReason(reason: string, condition: boolean): string | undefined {
  return condition ? reason : undefined;
}

function unique(values: Array<string | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function requiredFlagValue(flag: string, value: string | undefined) {
  if (!value) throw new Error(`${flag} requires a value.`);
  return value;
}

function parsePositiveIntegerFlag(flag: string, value: string | undefined) {
  const rawValue = requiredFlagValue(flag, value);
  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${flag} must be a positive integer.`);
  return parsed;
}

function formatReport(report: APIFootballH2HIngestReport) {
  return JSON.stringify(report, null, 2);
}

async function main() {
  const options = parseAPIFootballH2HIngestArgs(process.argv.slice(2));
  const report = await runAPIFootballH2HIngest(options);
  console.log(formatReport(report));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
