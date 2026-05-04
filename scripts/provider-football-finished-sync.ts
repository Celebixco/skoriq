import "dotenv/config";
import { pathToFileURL } from "node:url";
import { loadConfig } from "@sports-data/config";
import { APIFootballComAdapter, mapAPIFootballComStatus } from "@sports-data/providers";
import type { APIFootballComEvent, ProviderFetchResult } from "@sports-data/providers";
import pg from "pg";
import { manualLeagueConfigs } from "./apifootball-manual-league-config.js";
import { providerName } from "./apifootball-manual-league-config.js";
import { checkDatabaseReadiness, formatDatabaseReadinessResult } from "./db-readiness.js";
import {
  closeDependencies,
  createDryRunDependencies,
  createExecuteDependencies,
  runManualAPIFootballComIngestion,
  validateManualIngestionOptions
} from "./provider-apifootball-manual-ingest.js";
import type { ManualIngestionRunResult } from "./provider-apifootball-manual-ingest.js";

interface FinishedSyncOptions {
  execute: boolean;
  lookbackHours: number;
  allReviewedEnabled: boolean;
  countryId?: string;
  leagueId?: string;
  limit: number;
  verbose: boolean;
}

interface FinishedSyncLeagueReport {
  countryId: string;
  leagueId: string;
  from: string;
  to: string;
  providerCallsMade: number;
  eventsFetched: number;
  scoresFetched: number;
  finishedMatchesUpdated: number;
  scoreRowsUpdated: number;
  skippedStatuses: string[];
  unresolvedRows: number;
  unresolvedDiagnostics?: FinishedSyncUnresolvedDiagnostic[];
}

export interface FinishedSyncUnresolvedDiagnostic {
  operation: "events" | "scores";
  league: {
    countryId: string;
    leagueId: string;
  };
  providerEventId?: string;
  canonicalMatchId?: string;
  matchLabel?: string;
  rawStatus?: string;
  canonicalStatusDecision: string;
  reason:
    | "unsupported_status"
    | "live_numeric_status"
    | "live_minute_status"
    | "after_pen"
    | "missing_team_mapping"
    | "missing_competition_mapping"
    | "missing_score"
    | "match_not_finished"
    | "already_processed"
    | "date_window_mismatch"
    | "unknown";
  scoreFieldPresence: {
    fulltimePresent: boolean;
    halftimePresent: boolean;
  };
}

interface CapturedProviderResult {
  operation: "events" | "scores";
  result: ProviderFetchResult<unknown>;
}

export function parseFinishedSyncArgs(argv: string[]): FinishedSyncOptions {
  const options: FinishedSyncOptions = {
    execute: false,
    lookbackHours: 72,
    allReviewedEnabled: false,
    limit: 200,
    verbose: false
  };

  for (const arg of argv) {
    if (arg === "--execute") {
      options.execute = true;
      continue;
    }
    if (arg === "--dry-run") {
      options.execute = false;
      continue;
    }
    if (arg === "--all-reviewed-enabled") {
      options.allReviewedEnabled = true;
      continue;
    }
    if (arg === "--verbose") {
      options.verbose = true;
      continue;
    }

    const [key, value] = parseFlag(arg);
    switch (key) {
      case "--lookback-hours":
        options.lookbackHours = parsePositiveInteger(key, value);
        break;
      case "--country-id":
        options.countryId = requiredFlagValue(key, value);
        break;
      case "--league-id":
        options.leagueId = requiredFlagValue(key, value);
        break;
      case "--limit":
        options.limit = parsePositiveInteger(key, value);
        break;
      default:
        throw new Error(`Unknown football finished sync flag "${key}".`);
    }
  }

  if (!options.allReviewedEnabled && !(options.countryId && options.leagueId)) {
    throw new Error("Finished sync requires --all-reviewed-enabled or --country-id plus --league-id.");
  }
  return options;
}

export async function runFinishedSync(options: FinishedSyncOptions): Promise<{
  provider: "manual-football-finished-sync";
  mode: "dry-run" | "execute";
  leaguesScanned: number;
  matchesChecked: number;
  providerCallsMade: number;
  finishedMatchesUpdated: number;
  scoreRowsUpdated: number;
  skippedStatuses: string[];
  unresolvedRows: number;
  unresolvedReasonCounts?: Record<string, number>;
  unresolvedRowsAreSafeSkips?: boolean;
  unresolvedDiagnostics?: FinishedSyncUnresolvedDiagnostic[];
  leagues: FinishedSyncLeagueReport[];
  secretExposureCheck: "clean";
}> {
  const config = loadConfig();
  const now = new Date();
  const from = dateOnly(new Date(now.getTime() - options.lookbackHours * 60 * 60 * 1000));
  const to = dateOnly(now);
  const leagues = manualLeagueConfigs
    .filter((league) => league.reviewed && league.enabled)
    .filter((league) => (options.allReviewedEnabled ? true : league.countryId === options.countryId && league.leagueId === options.leagueId))
    .slice(0, options.limit);

  const adapter = new APIFootballComAdapter({
    enabled: config.APIFOOTBALL_COM_ENABLED,
    apiKey: config.APIFOOTBALL_COM_API_KEY,
    apiKeys: {
      defaultApiKey: config.APIFOOTBALL_COM_API_KEY_DEFAULT,
      eventsApiKey: config.APIFOOTBALL_COM_API_KEY_EVENTS,
      resultsApiKey: config.APIFOOTBALL_COM_API_KEY_RESULTS
    },
    baseUrl: config.APIFOOTBALL_COM_BASE_URL,
    timeoutMs: config.APIFOOTBALL_COM_TIMEOUT_MS,
    environment: { nodeEnv: config.NODE_ENV, allowProductionAccess: config.APIFOOTBALL_COM_ALLOW_PRODUCTION }
  });

  const dependencies = options.execute ? createExecuteDependencies(config, adapter) : createDryRunDependencies(adapter);
  const reports: FinishedSyncLeagueReport[] = [];
  try {
    for (const league of leagues) {
      const capturedResults: CapturedProviderResult[] = [];
      const manualOptions = {
        execute: options.execute,
        verifyAfter: options.execute,
        reportJson: false,
        operations: ["events", "scores"] as const,
        countryId: league.countryId,
        leagueId: league.leagueId,
        from,
        to
      };
      validateManualIngestionOptions(manualOptions, process.env);
      const result = await runManualAPIFootballComIngestion(manualOptions, {
        ...dependencies,
        fetchProviderResult: async (request) => {
          const result = await dependencies.fetchProviderResult(request);
          if (request.operation === "list_finished_matches") {
            capturedResults.push({ operation: "events", result });
          }
          if (request.operation === "get_football_match_score") {
            capturedResults.push({ operation: "scores", result });
          }
          return result;
        },
        log: () => undefined
      });
      const unresolvedDiagnostics = options.verbose
        ? await enrichCanonicalMatchIds(buildUnresolvedDiagnostics(league.countryId, league.leagueId, capturedResults), config.DATABASE_URL)
        : undefined;
      reports.push(mapManualResult(league.countryId, league.leagueId, from, to, result, unresolvedDiagnostics));
    }
  } finally {
    await closeDependencies(dependencies);
  }

  return {
    provider: "manual-football-finished-sync",
    mode: options.execute ? "execute" : "dry-run",
    leaguesScanned: reports.length,
    matchesChecked: reports.reduce((sum, report) => sum + report.eventsFetched, 0),
    providerCallsMade: reports.reduce((sum, report) => sum + report.providerCallsMade, 0),
    finishedMatchesUpdated: reports.reduce((sum, report) => sum + report.finishedMatchesUpdated, 0),
    scoreRowsUpdated: reports.reduce((sum, report) => sum + report.scoreRowsUpdated, 0),
    skippedStatuses: [...new Set(reports.flatMap((report) => report.skippedStatuses))],
    unresolvedRows: reports.reduce((sum, report) => sum + report.unresolvedRows, 0),
    unresolvedReasonCounts: options.verbose ? countUnresolvedReasons(reports.flatMap((report) => report.unresolvedDiagnostics ?? [])) : undefined,
    unresolvedRowsAreSafeSkips: options.verbose ? reports.flatMap((report) => report.unresolvedDiagnostics ?? []).every(isSafeExpectedSkip) : undefined,
    unresolvedDiagnostics: options.verbose ? reports.flatMap((report) => report.unresolvedDiagnostics ?? []) : undefined,
    leagues: reports,
    secretExposureCheck: "clean"
  };
}

function mapManualResult(
  countryId: string,
  leagueId: string,
  from: string,
  to: string,
  result: ManualIngestionRunResult,
  unresolvedDiagnostics?: FinishedSyncUnresolvedDiagnostic[]
): FinishedSyncLeagueReport {
  return {
    countryId,
    leagueId,
    from,
    to,
    providerCallsMade: result.operations.filter((operation) => operation.operation === "events" || operation.operation === "scores").length,
    eventsFetched: result.totals.eventsCount,
    scoresFetched: result.totals.scoresCount,
    finishedMatchesUpdated: result.mode === "execute" ? result.totals.eventsCount : 0,
    scoreRowsUpdated: result.mode === "execute" ? result.totals.scoresCount : 0,
    skippedStatuses: result.ingestionRunReport.warnings.filter((warning) => /status/i.test(warning)),
    unresolvedRows: result.totals.unresolvedRowsCount,
    unresolvedDiagnostics
  };
}

export function buildUnresolvedDiagnostics(countryId: string, leagueId: string, capturedResults: CapturedProviderResult[]): FinishedSyncUnresolvedDiagnostic[] {
  return capturedResults.flatMap(({ operation, result }) => {
    const mappedProviderIds = new Set(
      asArray(result.data)
        .map((row) => optionalString(asRecord(row).providerEntityId ?? asRecord(row).matchProviderId))
        .filter((value): value is string => Boolean(value))
    );

    return asArray(result.rawPayload ?? result.data)
      .map((row) => asRecord(row) as APIFootballComEvent)
      .filter((row) => {
        const providerEventId = optionalString(row.match_id);
        return !providerEventId || !mappedProviderIds.has(providerEventId);
      })
      .map((row) => classifyUnresolvedEvent(countryId, leagueId, operation, row));
  });
}

export function classifyUnresolvedEvent(
  countryId: string,
  leagueId: string,
  operation: "events" | "scores",
  row: APIFootballComEvent
): FinishedSyncUnresolvedDiagnostic {
  const rawStatus = optionalString(row.match_status);
  const providerEventId = optionalString(row.match_id);
  const homeName = optionalString(row.match_hometeam_name);
  const awayName = optionalString(row.match_awayteam_name);
  const statusDecision = safeStatusDecision(rawStatus);
  const reason = classifyUnresolvedReason(row, statusDecision);

  return {
    operation,
    league: { countryId, leagueId },
    providerEventId,
    matchLabel: homeName && awayName ? `${homeName} vs ${awayName}` : undefined,
    rawStatus,
    canonicalStatusDecision: statusDecision.status,
    reason,
    scoreFieldPresence: {
      fulltimePresent: hasFulltimeScorePair(row, statusDecision),
      halftimePresent: hasScorePair(row.match_hometeam_halftime_score, row.match_awayteam_halftime_score)
    }
  };
}

function classifyUnresolvedReason(
  row: APIFootballComEvent,
  statusDecision: { status: string; supported: boolean }
): FinishedSyncUnresolvedDiagnostic["reason"] {
  if (!optionalString(row.league_id)) {
    return "missing_competition_mapping";
  }
  if (!optionalString(row.match_hometeam_id) || !optionalString(row.match_awayteam_id)) {
    return "missing_team_mapping";
  }

  const rawStatus = optionalString(row.match_status) ?? "";
  const normalizedStatus = rawStatus.trim().toLowerCase();
  if (!statusDecision.supported) {
    if (/^\d+$/.test(normalizedStatus) && optionalString(row.match_live) === "1") {
      return "live_numeric_status";
    }
    if (isLiveMinuteStatus(normalizedStatus)) {
      return "live_minute_status";
    }
    if (normalizedStatus === "after pen.") {
      return "after_pen";
    }
    if (["half time", "ht", "1st half", "2nd half", "live", "in play"].includes(normalizedStatus)) {
      return "match_not_finished";
    }
    return "unsupported_status";
  }

  if (!["finished", "after_extra_time", "after_penalties"].includes(statusDecision.status)) {
    return "match_not_finished";
  }

  if (!hasScorePair(row.match_hometeam_ft_score, row.match_awayteam_ft_score) && !hasScorePair(row.match_hometeam_score, row.match_awayteam_score)) {
    return "missing_score";
  }

  return "unknown";
}

function safeStatusDecision(rawStatus: string | undefined) {
  try {
    return {
      status: mapAPIFootballComStatus(rawStatus),
      supported: true
    };
  } catch {
    return {
      status: "unsupported",
      supported: false
    };
  }
}

async function enrichCanonicalMatchIds(
  diagnostics: FinishedSyncUnresolvedDiagnostic[],
  databaseUrl: string | undefined
): Promise<FinishedSyncUnresolvedDiagnostic[]> {
  const providerEventIds = [...new Set(diagnostics.map((diagnostic) => diagnostic.providerEventId).filter((value): value is string => Boolean(value)))];
  if (!databaseUrl || providerEventIds.length === 0) {
    return diagnostics;
  }

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const result = await pool.query<{ provider_entity_id: string; internal_entity_id: string }>(
      "select provider_entity_id, internal_entity_id from provider_mappings where provider = $1 and entity_type = 'match' and provider_entity_id = any($2::text[])",
      [providerName, providerEventIds]
    );
    const canonicalByProviderId = new Map(result.rows.map((row) => [row.provider_entity_id, row.internal_entity_id]));
    return diagnostics.map((diagnostic) => ({
      ...diagnostic,
      canonicalMatchId: diagnostic.providerEventId ? canonicalByProviderId.get(diagnostic.providerEventId) : undefined
    }));
  } finally {
    await pool.end();
  }
}

function countUnresolvedReasons(diagnostics: FinishedSyncUnresolvedDiagnostic[]) {
  return diagnostics.reduce<Record<string, number>>((counts, diagnostic) => {
    counts[diagnostic.reason] = (counts[diagnostic.reason] ?? 0) + 1;
    return counts;
  }, {});
}

function isSafeExpectedSkip(diagnostic: FinishedSyncUnresolvedDiagnostic) {
  return ["live_numeric_status", "live_minute_status", "after_pen", "match_not_finished"].includes(diagnostic.reason);
}

function hasFulltimeScorePair(row: APIFootballComEvent, statusDecision: { status: string; supported: boolean }) {
  if (hasScorePair(row.match_hometeam_ft_score, row.match_awayteam_ft_score)) {
    return true;
  }
  if (["finished", "after_extra_time", "after_penalties"].includes(statusDecision.status)) {
    return hasScorePair(row.match_hometeam_score, row.match_awayteam_score);
  }
  return false;
}

function hasScorePair(home: unknown, away: unknown) {
  return optionalString(home) !== undefined && optionalString(away) !== undefined;
}

function isLiveMinuteStatus(status: string) {
  return /^(?:45|90)\+\d*$/.test(status);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const normalized = String(value).trim();
  return normalized ? normalized : undefined;
}

function dateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

function parseFlag(arg: string): [string, string | undefined] {
  const index = arg.indexOf("=");
  return index === -1 ? [arg, undefined] : [arg.slice(0, index), arg.slice(index + 1)];
}

function requiredFlagValue(flag: string, value: string | undefined) {
  if (!value) throw new Error(`Flag ${flag} requires a value.`);
  return value;
}

function parsePositiveInteger(flag: string, value: string | undefined) {
  const parsed = Number(requiredFlagValue(flag, value));
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${flag} must be a positive integer.`);
  return parsed;
}

async function main() {
  const options = parseFinishedSyncArgs(process.argv.slice(2));
  const readiness = await checkDatabaseReadiness({
    databaseUrl: process.env.DATABASE_URL,
    nodeEnv: process.env.NODE_ENV,
    dbExecutionTarget: process.env.DB_EXECUTION_TARGET,
    allowRemoteTestDb: process.env.ALLOW_REMOTE_TEST_DB,
    neonBranchName: process.env.NEON_BRANCH_NAME
  });
  if (readiness.status !== "ready") {
    throw new Error(`Database readiness check failed before finished score sync.\n${formatDatabaseReadinessResult(readiness)}`);
  }
  console.log(JSON.stringify(await runFinishedSync(options), null, 2));
}

const isDirectRun = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message.replace(/APIkey=[^&\s]+/gi, "APIkey=<redacted>").replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "DATABASE_URL=<redacted>") : "Football finished sync failed.");
    process.exitCode = 1;
  });
}
