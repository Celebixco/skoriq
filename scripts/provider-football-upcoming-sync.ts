import "dotenv/config";
import { pathToFileURL } from "node:url";
import { loadConfig } from "@sports-data/config";
import { APIFootballComAdapter, mapAPIFootballComStatus } from "@sports-data/providers";
import type { APIFootballComEvent, ProviderFetchResult } from "@sports-data/providers";
import { manualLeagueConfigs } from "./apifootball-manual-league-config.js";
import type { ManualLeagueReviewConfig } from "./apifootball-manual-league-config.js";
import { checkDatabaseReadiness, formatDatabaseReadinessResult } from "./db-readiness.js";
import {
  closeDependencies,
  createDryRunDependencies,
  createExecuteDependencies,
  runManualAPIFootballComIngestion,
  validateManualIngestionOptions
} from "./provider-apifootball-manual-ingest.js";
import type { ManualFetchRequest, ManualIngestionDependencies, ManualIngestionRunResult } from "./provider-apifootball-manual-ingest.js";

export interface UpcomingSyncOptions {
  execute: boolean;
  allReviewedEnabled: boolean;
  countryId?: string;
  leagueId?: string;
  from?: string;
  to?: string;
  windowDays: number;
  limit: number;
  maxRuntimeSeconds: number;
}

export interface UpcomingSyncDiagnostic {
  operation: "events" | "scores";
  providerEventId?: string;
  matchLabel?: string;
  rawStatus?: string;
  canonicalStatusDecision: string;
  reason:
    | "finished_ignored"
    | "live_numeric_status"
    | "live_minute_status"
    | "after_pen"
    | "missing_team_mapping"
    | "missing_competition_mapping"
    | "match_not_finished"
    | "unsupported_status"
    | "unknown";
}

export interface UpcomingSyncLeagueReport {
  countryId: string;
  leagueId: string;
  leagueName: string;
  from: string;
  to: string;
  eventsFetched: number;
  upcomingMatchesMapped: number;
  upcomingMatchesUpserted: number;
  scoreRowsMapped: number;
  scoreRowsUpserted: number;
  providerMappingsCreatedOrReused: number;
  skippedRows: number;
  skippedReasons: Record<string, number>;
  unresolvedRows: number;
  unsafeRows: number;
  dbWritesCount: number;
  credentialLabels: string[];
  secretExposureCheck: "clean";
}

export interface UpcomingSyncRunResult {
  provider: "manual-football-upcoming-sync";
  mode: "dry-run" | "execute";
  from: string;
  to: string;
  windowDays: number;
  leaguesScanned: number;
  totalEventsFetched: number;
  totalUpcomingMatchesMapped: number;
  totalUpcomingMatchesUpserted: number;
  totalScoreRowsMapped: number;
  totalScoreRowsUpserted: number;
  totalSkipped: number;
  unsafeRows: number;
  stopReason: "completed" | "max_runtime_exceeded";
  elapsedMs: number;
  leagues: UpcomingSyncLeagueReport[];
  secretExposureCheck: "clean";
}

interface UpcomingSyncDependencies {
  createManualDependencies(config: ReturnType<typeof loadConfig>, adapter: APIFootballComAdapter, execute: boolean): ManualIngestionDependencies & { close?: () => Promise<void> };
  now(): Date;
}

const defaultDependencies: UpcomingSyncDependencies = {
  createManualDependencies: (config, adapter, execute) => (execute ? createExecuteDependencies(config, adapter) : createDryRunDependencies(adapter)),
  now: () => new Date()
};

export function parseUpcomingSyncArgs(argv: string[]): UpcomingSyncOptions {
  const options: UpcomingSyncOptions = {
    execute: false,
    allReviewedEnabled: false,
    windowDays: 5,
    limit: 200,
    maxRuntimeSeconds: 300
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

    const [key, value] = parseFlag(arg);
    switch (key) {
      case "--country-id":
        options.countryId = requiredFlagValue(key, value);
        break;
      case "--league-id":
        options.leagueId = requiredFlagValue(key, value);
        break;
      case "--from":
        options.from = parseDateFlag(key, value);
        break;
      case "--to":
        options.to = parseDateFlag(key, value);
        break;
      case "--window-days":
        options.windowDays = parsePositiveInteger(key, value);
        break;
      case "--limit":
        options.limit = Math.min(parsePositiveInteger(key, value), 200);
        break;
      case "--max-runtime-seconds":
        options.maxRuntimeSeconds = parsePositiveInteger(key, value);
        break;
      default:
        throw new Error(`Unknown football upcoming sync flag "${key}".`);
    }
  }

  if (!options.allReviewedEnabled && !(options.countryId && options.leagueId)) {
    throw new Error("Upcoming sync requires --all-reviewed-enabled or --country-id plus --league-id.");
  }
  if ((options.from && !options.to) || (!options.from && options.to)) {
    throw new Error("Upcoming sync requires both --from and --to when either date is supplied.");
  }
  return options;
}

export function resolveUpcomingSyncLeagues(
  options: Pick<UpcomingSyncOptions, "allReviewedEnabled" | "countryId" | "leagueId" | "limit">,
  configs: readonly ManualLeagueReviewConfig[] = manualLeagueConfigs
): ManualLeagueReviewConfig[] {
  const matching = configs.filter((league) =>
    options.allReviewedEnabled ? league.reviewed && league.enabled : league.countryId === options.countryId && league.leagueId === options.leagueId
  );
  if (matching.length === 0) {
    throw new Error("Football upcoming sync is limited to configured reviewed and enabled leagues.");
  }
  const blocked = matching.find((league) => !league.reviewed || !league.enabled);
  if (blocked) {
    throw new Error("Football upcoming sync execute/dry-run is limited to reviewed and enabled leagues.");
  }
  return matching.slice(0, options.limit);
}

export async function runUpcomingSync(
  options: UpcomingSyncOptions,
  dependencies: UpcomingSyncDependencies = defaultDependencies
): Promise<UpcomingSyncRunResult> {
  const config = loadConfig();
  const startedAt = dependencies.now();
  const { from, to } = resolveDateWindow(options, startedAt);
  const leagues = resolveUpcomingSyncLeagues(options);
  const adapter = new APIFootballComAdapter({
    enabled: config.APIFOOTBALL_COM_ENABLED,
    apiKey: config.APIFOOTBALL_COM_API_KEY,
    apiKeys: {
      defaultApiKey: config.APIFOOTBALL_COM_API_KEY_DEFAULT,
      eventsApiKey: config.APIFOOTBALL_COM_API_KEY_EVENTS,
      resultsApiKey: config.APIFOOTBALL_COM_API_KEY_RESULTS,
      fixturesApiKey: config.APIFOOTBALL_COM_API_KEY_FIXTURES
    },
    baseUrl: config.APIFOOTBALL_COM_BASE_URL,
    timeoutMs: config.APIFOOTBALL_COM_TIMEOUT_MS,
    environment: { nodeEnv: config.NODE_ENV, allowProductionAccess: config.APIFOOTBALL_COM_ALLOW_PRODUCTION }
  });
  const manualDependencies = dependencies.createManualDependencies(config, adapter, options.execute);
  const reports: UpcomingSyncLeagueReport[] = [];
  let stopReason: UpcomingSyncRunResult["stopReason"] = "completed";

  try {
    for (const league of leagues) {
      if (dependencies.now().getTime() - startedAt.getTime() > options.maxRuntimeSeconds * 1000) {
        stopReason = "max_runtime_exceeded";
        break;
      }
      reports.push(await runUpcomingSyncForLeague(league, options, from, to, manualDependencies));
    }
  } finally {
    await closeDependencies(manualDependencies);
  }

  const elapsedMs = dependencies.now().getTime() - startedAt.getTime();
  return {
    provider: "manual-football-upcoming-sync",
    mode: options.execute ? "execute" : "dry-run",
    from,
    to,
    windowDays: options.windowDays,
    leaguesScanned: reports.length,
    totalEventsFetched: reports.reduce((sum, report) => sum + report.eventsFetched, 0),
    totalUpcomingMatchesMapped: reports.reduce((sum, report) => sum + report.upcomingMatchesMapped, 0),
    totalUpcomingMatchesUpserted: reports.reduce((sum, report) => sum + report.upcomingMatchesUpserted, 0),
    totalScoreRowsMapped: reports.reduce((sum, report) => sum + report.scoreRowsMapped, 0),
    totalScoreRowsUpserted: reports.reduce((sum, report) => sum + report.scoreRowsUpserted, 0),
    totalSkipped: reports.reduce((sum, report) => sum + report.skippedRows, 0),
    unsafeRows: reports.reduce((sum, report) => sum + report.unsafeRows, 0),
    stopReason,
    elapsedMs,
    leagues: reports,
    secretExposureCheck: "clean"
  };
}

async function runUpcomingSyncForLeague(
  league: ManualLeagueReviewConfig,
  options: UpcomingSyncOptions,
  from: string,
  to: string,
  dependencies: ManualIngestionDependencies
): Promise<UpcomingSyncLeagueReport> {
  const captured: Array<{ operation: "events" | "scores"; result: ProviderFetchResult<unknown> }> = [];
  const manualOptions = {
    execute: options.execute,
    verifyAfter: false,
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
      const providerResult = await dependencies.fetchProviderResult(rewriteUpcomingFetchRequest(request));
      const filtered = filterUpcomingProviderResult(providerResult, request.operation === "get_football_match_score" ? "scores" : "events", options.limit);
      if (request.operation === "list_finished_matches") captured.push({ operation: "events", result: filtered });
      if (request.operation === "get_football_match_score") captured.push({ operation: "scores", result: filtered });
      return filtered;
    },
    log: () => undefined
  });

  return mapUpcomingManualResult(league, from, to, result, captured, options.execute);
}

function rewriteUpcomingFetchRequest(request: ManualFetchRequest): ManualFetchRequest {
  if (request.operation !== "list_finished_matches") {
    return request;
  }
  return {
    ...request,
    operation: "list_upcoming_matches"
  };
}

export function filterUpcomingProviderResult(result: ProviderFetchResult<unknown>, operation: "events" | "scores", limit: number): ProviderFetchResult<unknown> {
  const rawRows = asArray(result.rawPayload ?? result.data);
  const dataRows = asArray(result.data)
    .filter((row) => {
      const status = optionalString(asRecord(row).status);
      return status === "scheduled" || status === "not_started";
    })
    .slice(0, limit);
  const allowedProviderIds = new Set(dataRows.map((row) => optionalString(asRecord(row).providerEntityId ?? asRecord(row).matchProviderId)).filter(Boolean));
  const cappedRawRows = rawRows
    .filter((row) => {
      const providerEventId = optionalString(asRecord(row).match_id ?? asRecord(row).providerEntityId);
      if (!providerEventId) return true;
      const diagnostic = classifyUpcomingUnresolvedEvent(operation, row as APIFootballComEvent);
      return allowedProviderIds.has(providerEventId) || diagnostic.reason !== "unknown";
    })
    .slice(0, limit);

  return {
    ...result,
    data: dataRows,
    rawPayload: cappedRawRows,
    metadata: {
      ...result.metadata,
      endpoint: operation === "events" ? "list_upcoming_matches" : result.metadata.endpoint
    }
  };
}

function mapUpcomingManualResult(
  league: ManualLeagueReviewConfig,
  from: string,
  to: string,
  result: ManualIngestionRunResult,
  captured: Array<{ operation: "events" | "scores"; result: ProviderFetchResult<unknown> }>,
  execute: boolean
): UpcomingSyncLeagueReport {
  const diagnostics = buildUpcomingDiagnostics(captured);
  const skippedReasons = countReasons(diagnostics);
  const eventsOperation = result.operations.find((operation) => operation.operation === "events");
  const scoresOperation = result.operations.find((operation) => operation.operation === "scores");
  const upcomingMatchesMapped = eventsOperation?.mappedCount ?? 0;
  const scoreRowsMapped = scoresOperation?.mappedCount ?? 0;

  return {
    countryId: league.countryId,
    leagueId: league.leagueId,
    leagueName: league.leagueName,
    from,
    to,
    eventsFetched: eventsOperation?.fetchedCount ?? 0,
    upcomingMatchesMapped,
    upcomingMatchesUpserted: execute ? upcomingMatchesMapped : 0,
    scoreRowsMapped,
    scoreRowsUpserted: execute ? scoreRowsMapped : 0,
    providerMappingsCreatedOrReused: execute ? upcomingMatchesMapped : 0,
    skippedRows: diagnostics.length,
    skippedReasons,
    unresolvedRows: result.totals.unresolvedRowsCount,
    unsafeRows: diagnostics.filter((diagnostic) => !isSafeUpcomingSkip(diagnostic)).length,
    dbWritesCount: execute ? upcomingMatchesMapped + scoreRowsMapped : 0,
    credentialLabels: unique(captured.map(({ result }) => optionalString(result.metadata.credentialLabel)).filter((value): value is string => Boolean(value))),
    secretExposureCheck: "clean"
  };
}

export function buildUpcomingDiagnostics(captured: Array<{ operation: "events" | "scores"; result: ProviderFetchResult<unknown> }>): UpcomingSyncDiagnostic[] {
  return captured.flatMap(({ operation, result }) => {
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
      .map((row) => classifyUpcomingUnresolvedEvent(operation, row));
  });
}

export function classifyUpcomingUnresolvedEvent(operation: "events" | "scores", row: APIFootballComEvent): UpcomingSyncDiagnostic {
  const rawStatus = optionalString(row.match_status);
  const homeName = optionalString(row.match_hometeam_name);
  const awayName = optionalString(row.match_awayteam_name);
  const statusDecision = safeStatusDecision(rawStatus);
  return {
    operation,
    providerEventId: optionalString(row.match_id),
    matchLabel: homeName && awayName ? `${homeName} vs ${awayName}` : undefined,
    rawStatus,
    canonicalStatusDecision: statusDecision.status,
    reason: classifyUpcomingReason(row, statusDecision)
  };
}

function classifyUpcomingReason(row: APIFootballComEvent, statusDecision: { status: string; supported: boolean }): UpcomingSyncDiagnostic["reason"] {
  if (!optionalString(row.league_id)) {
    return "missing_competition_mapping";
  }
  if (!optionalString(row.match_hometeam_id) || !optionalString(row.match_awayteam_id)) {
    return "missing_team_mapping";
  }
  const normalizedStatus = (optionalString(row.match_status) ?? "").trim().toLowerCase();
  if (!statusDecision.supported) {
    if (/^\d+$/.test(normalizedStatus) && optionalString(row.match_live) === "1") return "live_numeric_status";
    if (/^(?:45|90)\+\d*$/.test(normalizedStatus)) return "live_minute_status";
    if (normalizedStatus === "after pen.") return "after_pen";
    if (["half time", "ht", "1st half", "2nd half", "live", "in play"].includes(normalizedStatus)) return "match_not_finished";
    return "unsupported_status";
  }
  if (["finished", "after_extra_time", "after_penalties", "cancelled", "abandoned", "postponed"].includes(statusDecision.status)) {
    return "finished_ignored";
  }
  return "unknown";
}

function safeStatusDecision(rawStatus: string | undefined) {
  try {
    return { status: mapAPIFootballComStatus(rawStatus), supported: true };
  } catch {
    return { status: "unsupported", supported: false };
  }
}

function isSafeUpcomingSkip(diagnostic: UpcomingSyncDiagnostic) {
  return ["finished_ignored", "live_numeric_status", "live_minute_status", "after_pen", "match_not_finished"].includes(diagnostic.reason);
}

function resolveDateWindow(options: Pick<UpcomingSyncOptions, "from" | "to" | "windowDays">, now: Date) {
  if (options.from && options.to) {
    return { from: options.from, to: options.to };
  }
  const from = dateOnly(now);
  const to = dateOnly(new Date(now.getTime() + options.windowDays * 86_400_000));
  return { from, to };
}

function countReasons(diagnostics: UpcomingSyncDiagnostic[]) {
  return diagnostics.reduce<Record<string, number>>((counts, diagnostic) => {
    counts[diagnostic.reason] = (counts[diagnostic.reason] ?? 0) + 1;
    return counts;
  }, {});
}

function unique(values: string[]) {
  return [...new Set(values)];
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

function parseDateFlag(flag: string, value: string | undefined) {
  const normalized = requiredFlagValue(flag, value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) throw new Error(`${flag} must use YYYY-MM-DD.`);
  return normalized;
}

function parsePositiveInteger(flag: string, value: string | undefined) {
  const parsed = Number(requiredFlagValue(flag, value));
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${flag} must be a positive integer.`);
  return parsed;
}

async function main() {
  const options = parseUpcomingSyncArgs(process.argv.slice(2));
  const readiness = await checkDatabaseReadiness({
    databaseUrl: process.env.DATABASE_URL,
    nodeEnv: process.env.NODE_ENV,
    dbExecutionTarget: process.env.DB_EXECUTION_TARGET,
    allowRemoteTestDb: process.env.ALLOW_REMOTE_TEST_DB,
    neonBranchName: process.env.NEON_BRANCH_NAME
  });
  if (options.execute && readiness.status !== "ready") {
    throw new Error(`Database readiness check failed before upcoming sync execute.\n${formatDatabaseReadinessResult(readiness)}`);
  }
  console.log(JSON.stringify(await runUpcomingSync(options), null, 2));
}

const isDirectRun = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message.replace(/APIkey=[^&\s]+/gi, "APIkey=<redacted>").replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "DATABASE_URL=<redacted>") : "Football upcoming sync failed.");
    process.exitCode = 1;
  });
}
