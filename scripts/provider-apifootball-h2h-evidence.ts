import "dotenv/config";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { APIFootballComHttpClient, APIFootballComHttpError, createAPIFootballCredentialResolver, sanitizeProviderPayload } from "@sports-data/providers";
import type { APIFootballComHttpResult } from "@sports-data/providers";
import { checkDatabaseReadiness, formatDatabaseReadinessResult } from "./db-readiness.js";

const providerName = "apifootball-com";
const defaultBaseUrl = "https://apiv3.apifootball.com/";
const defaultTimeoutMs = 15000;

export interface APIFootballH2HEvidenceOptions {
  matchId?: string;
}

export interface ResolvedH2HTarget {
  matchId: string;
  competitionId: string;
  competitionName: string;
  canonicalHomeTeamId: string;
  canonicalAwayTeamId: string;
  homeTeamName: string;
  awayTeamName: string;
  kickoffAt: string;
  homeProviderTeamId?: string;
  awayProviderTeamId?: string;
  providerMatchId?: string;
}

export interface H2HRecordFieldSummary {
  providerMatchId?: string;
  matchDate?: string;
  matchStatus?: string;
  homeTeamProviderId?: string;
  awayTeamProviderId?: string;
  hasHomeTeamName: boolean;
  hasAwayTeamName: boolean;
  hasFulltimeScore: boolean;
  hasHalftimeScore: boolean;
  fulltimeScoreParseable: boolean;
  halftimeScoreParseable: boolean;
  canonicalTeamsMappable: boolean;
}

export interface H2HEvidenceSummary {
  providerAction: "get_H2H";
  credentialLabel: string;
  recordsFetchedCount: number;
  stableH2HMatchIdsCount: number;
  stableHomeAwayTeamIdsCount: number;
  fulltimeScoreFieldsPresentCount: number;
  halftimeScoreFieldsPresentCount: number;
  mappedCanonicalTeamReferencesPossible: boolean;
  unresolvedRowsCount: number;
  skippedRowsCount: number;
  cleanEnoughForFutureExecute: boolean;
  records: H2HRecordFieldSummary[];
}

export interface H2HEvidenceReport {
  mode: "dry-run";
  dbReadiness: "ready" | "not_ready";
  providerAction: "get_H2H";
  credentialLabel?: string;
  target?: ResolvedH2HTarget;
  arsenalProviderTeamIdResolved: boolean;
  fulhamProviderTeamIdResolved: boolean;
  providerMatchIdResolved: boolean;
  h2h?: H2HEvidenceSummary;
  dbWritesCount: 0;
  rawPayloadPersistenceCount: 0;
  secretExposureCheck: "clean";
  warnings: string[];
}

type Queryable = Pick<pg.Pool, "query">;

export interface H2HRecordLike {
  match_id?: unknown;
  country_id?: unknown;
  country_name?: unknown;
  league_id?: unknown;
  league_name?: unknown;
  match_date?: unknown;
  match_time?: unknown;
  match_status?: unknown;
  match_hometeam_id?: unknown;
  match_hometeam_name?: unknown;
  match_hometeam_score?: unknown;
  match_awayteam_id?: unknown;
  match_awayteam_name?: unknown;
  match_awayteam_score?: unknown;
  match_hometeam_halftime_score?: unknown;
  match_awayteam_halftime_score?: unknown;
  [key: string]: unknown;
}

export function parseAPIFootballH2HEvidenceArgs(argv: string[]): APIFootballH2HEvidenceOptions {
  const options: APIFootballH2HEvidenceOptions = {};

  for (const arg of argv) {
    const [key, value] = arg.split("=", 2);
    switch (key) {
      case "--match-id":
        options.matchId = requiredValue(key, value);
        break;
      default:
        throw new Error(`Unknown APIFootball.com H2H evidence flag "${key}".`);
    }
  }

  return options;
}

export async function resolveH2HTarget(db: Queryable, matchId: string): Promise<ResolvedH2HTarget> {
  const result = await db.query<{
    match_id: string;
    competition_id: string;
    competition_name: string;
    home_team_id: string;
    away_team_id: string;
    home_team_name: string;
    away_team_name: string;
    kickoff_at: Date;
    home_provider_team_id: string | null;
    away_provider_team_id: string | null;
    provider_match_id: string | null;
  }>(
    `
      select
        m.id as match_id,
        c.id as competition_id,
        c.name as competition_name,
        m.home_team_id,
        m.away_team_id,
        ht.name as home_team_name,
        at.name as away_team_name,
        m.scheduled_start_at as kickoff_at,
        home_pm.provider_entity_id as home_provider_team_id,
        away_pm.provider_entity_id as away_provider_team_id,
        match_pm.provider_entity_id as provider_match_id
      from matches m
      join competitions c on c.id = m.competition_id
      join teams ht on ht.id = m.home_team_id
      join teams at on at.id = m.away_team_id
      left join provider_mappings home_pm
        on home_pm.provider = $2
        and home_pm.entity_type = 'team'
        and home_pm.internal_entity_type = 'team'
        and home_pm.internal_entity_id = m.home_team_id
      left join provider_mappings away_pm
        on away_pm.provider = $2
        and away_pm.entity_type = 'team'
        and away_pm.internal_entity_type = 'team'
        and away_pm.internal_entity_id = m.away_team_id
      left join provider_mappings match_pm
        on match_pm.provider = $2
        and match_pm.entity_type = 'match'
        and match_pm.internal_entity_type = 'match'
        and match_pm.internal_entity_id = m.id
      where m.id = $1
      limit 1
    `,
    [matchId, providerName]
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error(`Match not found for match_id=${matchId}.`);
  }

  return {
    matchId: row.match_id,
    competitionId: row.competition_id,
    competitionName: row.competition_name,
    canonicalHomeTeamId: row.home_team_id,
    canonicalAwayTeamId: row.away_team_id,
    homeTeamName: row.home_team_name,
    awayTeamName: row.away_team_name,
    kickoffAt: row.kickoff_at.toISOString(),
    homeProviderTeamId: row.home_provider_team_id ?? undefined,
    awayProviderTeamId: row.away_provider_team_id ?? undefined,
    providerMatchId: row.provider_match_id ?? undefined
  };
}

export function summarizeH2HPayload(payload: unknown, target: Pick<ResolvedH2HTarget, "homeProviderTeamId" | "awayProviderTeamId">, credentialLabel: string): H2HEvidenceSummary {
  const records = extractDirectH2HRecords(payload).map((record) => summarizeRecord(record, target));
  const unresolvedRowsCount = records.filter((record) => !record.canonicalTeamsMappable || !record.fulltimeScoreParseable).length;

  return {
    providerAction: "get_H2H",
    credentialLabel,
    recordsFetchedCount: records.length,
    stableH2HMatchIdsCount: records.filter((record) => Boolean(record.providerMatchId)).length,
    stableHomeAwayTeamIdsCount: records.filter((record) => Boolean(record.homeTeamProviderId && record.awayTeamProviderId)).length,
    fulltimeScoreFieldsPresentCount: records.filter((record) => record.hasFulltimeScore).length,
    halftimeScoreFieldsPresentCount: records.filter((record) => record.hasHalftimeScore).length,
    mappedCanonicalTeamReferencesPossible: records.length > 0 && records.every((record) => record.canonicalTeamsMappable),
    unresolvedRowsCount,
    skippedRowsCount: 0,
    cleanEnoughForFutureExecute: unresolvedRowsCount === 0,
    records
  };
}

export async function runAPIFootballH2HEvidenceDryRun(options: APIFootballH2HEvidenceOptions, env: NodeJS.ProcessEnv = process.env): Promise<H2HEvidenceReport> {
  if (!options.matchId) {
    throw new Error("APIFootball.com H2H evidence requires --match-id=<uuid>.");
  }
  if (env.NODE_ENV === "production") {
    throw new Error("APIFootball.com H2H evidence is forbidden in production.");
  }
  if (env.APIFOOTBALL_COM_ENABLED !== "true") {
    throw new Error("APIFootball.com H2H evidence requires APIFOOTBALL_COM_ENABLED=true.");
  }

  const readiness = await checkDatabaseReadiness({
    databaseUrl: env.DATABASE_URL,
    nodeEnv: env.NODE_ENV,
    dbExecutionTarget: env.DB_EXECUTION_TARGET,
    allowRemoteTestDb: env.ALLOW_REMOTE_TEST_DB,
    neonBranchName: env.NEON_BRANCH_NAME
  });
  if (readiness.status !== "ready") {
    throw new Error(`Database is not ready for APIFootball.com H2H evidence:\n${formatDatabaseReadinessResult(readiness)}`);
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
  if (!resolver.hasAnyCredential()) {
    throw new Error("At least one APIFOOTBALL_COM_API_KEY* value is required for APIFootball.com H2H evidence.");
  }

  const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 1 });
  try {
    const target = await resolveH2HTarget(pool, options.matchId);
    if (!target.homeProviderTeamId || !target.awayProviderTeamId) {
      return {
        mode: "dry-run",
        dbReadiness: "ready",
        providerAction: "get_H2H",
        target,
        arsenalProviderTeamIdResolved: Boolean(target.homeProviderTeamId),
        fulhamProviderTeamIdResolved: Boolean(target.awayProviderTeamId),
        providerMatchIdResolved: Boolean(target.providerMatchId),
        dbWritesCount: 0,
        rawPayloadPersistenceCount: 0,
        secretExposureCheck: "clean",
        warnings: ["Provider team IDs are required before APIFootball H2H evidence can be fetched."]
      };
    }

    const client = new APIFootballComHttpClient({
      baseUrl: env.APIFOOTBALL_COM_BASE_URL ?? defaultBaseUrl,
      credentialResolver: resolver,
      timeoutMs: Number(env.APIFOOTBALL_COM_TIMEOUT_MS ?? defaultTimeoutMs)
    });
    const result: APIFootballComHttpResult<unknown> = await client.requestJson({
      action: "get_H2H",
      credentialAction: "events",
      params: {
        firstTeamId: target.homeProviderTeamId,
        secondTeamId: target.awayProviderTeamId,
        timezone: "Europe/Istanbul"
      }
    });
    const h2h = summarizeH2HPayload(sanitizeProviderPayload(result.payload, ""), target, result.metadata.credentialLabel);

    return {
      mode: "dry-run",
      dbReadiness: "ready",
      providerAction: "get_H2H",
      credentialLabel: result.metadata.credentialLabel,
      target,
      arsenalProviderTeamIdResolved: true,
      fulhamProviderTeamIdResolved: true,
      providerMatchIdResolved: Boolean(target.providerMatchId),
      h2h,
      dbWritesCount: 0,
      rawPayloadPersistenceCount: 0,
      secretExposureCheck: "clean",
      warnings: []
    };
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

export function extractDirectH2HRecords(payload: unknown): H2HRecordLike[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  if (Array.isArray(payload)) {
    const first = payload.find((item) => item && typeof item === "object") as Record<string, unknown> | undefined;
    const legacyRecords = first?.firstTeam_VS_secondTeam;
    return Array.isArray(legacyRecords) ? (legacyRecords as H2HRecordLike[]) : [];
  }

  const records = (payload as Record<string, unknown>).firstTeam_VS_secondTeam;
  return Array.isArray(records) ? (records as H2HRecordLike[]) : [];
}

function summarizeRecord(record: H2HRecordLike, target: Pick<ResolvedH2HTarget, "homeProviderTeamId" | "awayProviderTeamId">): H2HRecordFieldSummary {
  const homeTeamProviderId = optionalString(record.match_hometeam_id);
  const awayTeamProviderId = optionalString(record.match_awayteam_id);
  const homeScore = optionalString(record.match_hometeam_score);
  const awayScore = optionalString(record.match_awayteam_score);
  const homeHtScore = optionalString(record.match_hometeam_halftime_score);
  const awayHtScore = optionalString(record.match_awayteam_halftime_score);
  const expectedTeamIds = new Set([target.homeProviderTeamId, target.awayProviderTeamId].filter(Boolean));

  return {
    providerMatchId: optionalString(record.match_id),
    matchDate: optionalString(record.match_date),
    matchStatus: optionalString(record.match_status),
    homeTeamProviderId,
    awayTeamProviderId,
    hasHomeTeamName: Boolean(optionalString(record.match_hometeam_name)),
    hasAwayTeamName: Boolean(optionalString(record.match_awayteam_name)),
    hasFulltimeScore: Boolean(homeScore && awayScore),
    hasHalftimeScore: Boolean(homeHtScore && awayHtScore),
    fulltimeScoreParseable: isIntegerString(homeScore) && isIntegerString(awayScore),
    halftimeScoreParseable: homeHtScore === undefined && awayHtScore === undefined ? true : isIntegerString(homeHtScore) && isIntegerString(awayHtScore),
    canonicalTeamsMappable: Boolean(homeTeamProviderId && awayTeamProviderId && expectedTeamIds.has(homeTeamProviderId) && expectedTeamIds.has(awayTeamProviderId))
  };
}

export function optionalString(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (typeof value === "number") {
    return String(value);
  }
  return undefined;
}

export function isIntegerString(value: string | undefined): boolean {
  return value !== undefined && /^-?\d+$/.test(value.trim());
}

function requiredValue(flag: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function formatReport(report: H2HEvidenceReport): string {
  return JSON.stringify(
    {
      ...report,
      h2h: report.h2h
        ? {
            ...report.h2h,
            records: report.h2h.records.map((record) => ({
              providerMatchId: record.providerMatchId,
              matchDate: record.matchDate,
              matchStatus: record.matchStatus,
              homeTeamProviderId: record.homeTeamProviderId,
              awayTeamProviderId: record.awayTeamProviderId,
              hasHomeTeamName: record.hasHomeTeamName,
              hasAwayTeamName: record.hasAwayTeamName,
              hasFulltimeScore: record.hasFulltimeScore,
              hasHalftimeScore: record.hasHalftimeScore,
              fulltimeScoreParseable: record.fulltimeScoreParseable,
              halftimeScoreParseable: record.halftimeScoreParseable,
              canonicalTeamsMappable: record.canonicalTeamsMappable
            }))
          }
        : undefined
    },
    null,
    2
  );
}

async function main() {
  const options = parseAPIFootballH2HEvidenceArgs(process.argv.slice(2));
  const report = await runAPIFootballH2HEvidenceDryRun(options);
  console.log(formatReport(report));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
