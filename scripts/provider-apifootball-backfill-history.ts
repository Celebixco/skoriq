import "dotenv/config";
import { pathToFileURL } from "node:url";
import { sql } from "drizzle-orm";
import { loadConfig } from "@sports-data/config";
import { createDatabase } from "@sports-data/database";
import { APIFootballComAdapter } from "@sports-data/providers";
import type { Database } from "@sports-data/database";
import { checkDatabaseReadiness, formatDatabaseReadinessResult } from "./db-readiness.js";
import {
  closeDependencies,
  createDryRunDependencies,
  createExecuteDependencies,
  resolveManualLeagueConfig,
  runManualAPIFootballComIngestion
} from "./provider-apifootball-manual-ingest.js";
import type { ManualIngestionRunResult, ManualLeagueReviewConfig } from "./provider-apifootball-manual-ingest.js";

const providerName = "apifootball-com";
const defaultBatchDays = 14;
const maxReviewedBackfillBatchDays = 14;

export interface HistoricalBackfillOptions {
  countryId?: string;
  leagueId?: string;
  from?: string;
  to?: string;
  batchDays: number;
  targetFinished?: number;
  stopAfterEmptyBatches: number;
  execute: boolean;
}

export interface HistoricalBackfillBatchReport {
  from: string;
  to: string;
  dryRunSuccess: boolean;
  empty: boolean;
  credentialLabels: {
    events?: string;
    results?: string;
  };
  eventsFetched: number;
  scoresFetched: number;
  finishedCount: number;
  notStartedCount: number;
  mappedEvents: number;
  scoreRowsMapped: number;
  unresolvedSkippedRows: number;
  executeRun: boolean;
  executeSuccess?: boolean;
  dbWritesCount: number;
  totalFinishedMatchesAfterExecute?: number;
  errorMessage?: string;
}

export interface HistoricalBackfillReport {
  provider: typeof providerName;
  mode: "dry-run" | "execute";
  countryId?: string;
  leagueId?: string;
  leagueName?: string;
  from?: string;
  to?: string;
  batchDays: number;
  batches: HistoricalBackfillBatchReport[];
  totalBatchesProcessed: number;
  totalExecutedBatches: number;
  totalEmptyBatches: number;
  totalEventsFetched: number;
  totalScoresFetched: number;
  totalMatchesInsertedOrUpdated: number;
  finalFinishedMatchCount?: number;
  stopReason: "completed" | "target_finished_reached" | "empty_batch_limit_reached" | "batch_failed" | "unresolved_rows" | "blocked";
  nextRecommendedDateRange?: {
    from: string;
    to: string;
  };
  secretExposureCheck: "clean";
}

export interface HistoricalBackfillDependencies {
  runManualBatch(options: { from: string; to: string; execute: boolean }): Promise<ManualIngestionRunResult>;
  queryFinishedMatchCount?(): Promise<number>;
  log?(message: string): void;
}

export function parseHistoricalBackfillArgs(argv: string[]): HistoricalBackfillOptions {
  const options: HistoricalBackfillOptions = {
    batchDays: defaultBatchDays,
    stopAfterEmptyBatches: 2,
    execute: false
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

    const [key, value] = parseFlag(arg);
    switch (key) {
      case "--country-id":
        options.countryId = requiredFlagValue(key, value);
        break;
      case "--league-id":
        options.leagueId = requiredFlagValue(key, value);
        break;
      case "--from":
        options.from = requiredFlagValue(key, value);
        break;
      case "--to":
        options.to = requiredFlagValue(key, value);
        break;
      case "--batch-days":
        options.batchDays = parsePositiveInteger(key, value);
        break;
      case "--target-finished":
        options.targetFinished = parsePositiveInteger(key, value);
        break;
      case "--stop-after-empty-batches":
        options.stopAfterEmptyBatches = parsePositiveInteger(key, value);
        break;
      default:
        throw new Error(`Unknown APIFootball.com historical backfill flag "${key}".`);
    }
  }

  return options;
}

export function validateHistoricalBackfillOptions(
  options: HistoricalBackfillOptions,
  env: NodeJS.ProcessEnv,
  configs?: readonly ManualLeagueReviewConfig[]
) {
  if (env.NODE_ENV === "production") {
    throw new Error("APIFootball.com historical backfill is forbidden in production.");
  }
  if (env.APIFOOTBALL_COM_ENABLED !== "true") {
    throw new Error("APIFootball.com historical backfill requires APIFOOTBALL_COM_ENABLED=true.");
  }
  if (!hasAnyAPIFootballCredential(env)) {
    throw new Error("At least one APIFOOTBALL_COM_API_KEY* value is required for APIFootball.com historical backfill.");
  }
  if (!options.countryId) throw new Error("APIFootball.com historical backfill requires --country-id.");
  if (!options.leagueId) throw new Error("APIFootball.com historical backfill requires --league-id.");
  if (!options.from) throw new Error("APIFootball.com historical backfill requires --from=YYYY-MM-DD.");
  if (!options.to) throw new Error("APIFootball.com historical backfill requires --to=YYYY-MM-DD.");
  if (options.batchDays > maxReviewedBackfillBatchDays) {
    throw new Error(`APIFootball.com reviewed historical backfill batches must be ${maxReviewedBackfillBatchDays} days or fewer.`);
  }

  parseDateOnly(options.from, "--from");
  parseDateOnly(options.to, "--to");

  const league = resolveManualLeagueConfig(options.countryId, options.leagueId, configs);
  if (!league) {
    throw new Error("APIFootball.com historical backfill is limited to configured reviewed and enabled leagues.");
  }
  if (!league.reviewed || !league.enabled) {
    throw new Error("APIFootball.com historical backfill requires reviewed=true and enabled=true.");
  }
}

export async function runHistoricalBackfill(
  options: HistoricalBackfillOptions,
  dependencies: HistoricalBackfillDependencies,
  configs?: readonly ManualLeagueReviewConfig[]
): Promise<HistoricalBackfillReport> {
  const league = resolveManualLeagueConfig(options.countryId, options.leagueId, configs);
  const batches = splitDateRange(required(options.from, "--from"), required(options.to, "--to"), options.batchDays);
  const batchReports: HistoricalBackfillBatchReport[] = [];
  let emptyBatches = 0;
  let stopReason: HistoricalBackfillReport["stopReason"] = "completed";

  for (const batch of batches) {
    let dryRun: ManualIngestionRunResult | undefined;
    try {
      dryRun = await dependencies.runManualBatch({ from: batch.from, to: batch.to, execute: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : "APIFootball.com historical backfill dry-run failed.";
      const empty = isNoEventsFoundError(message);
      batchReports.push(emptyBatchReport(batch.from, batch.to, message, empty));
      if (empty) {
        emptyBatches += 1;
        if (emptyBatches >= options.stopAfterEmptyBatches) {
          stopReason = "empty_batch_limit_reached";
          break;
        }
        continue;
      }

      stopReason = "batch_failed";
      break;
    }

    const dryReport = summarizeBatch(batch.from, batch.to, dryRun, false);
    if (dryReport.unresolvedSkippedRows > 0) {
      batchReports.push(dryReport);
      stopReason = "unresolved_rows";
      break;
    }

    if (dryReport.eventsFetched === 0) {
      emptyBatches += 1;
      dryReport.empty = true;
      batchReports.push(dryReport);
      if (emptyBatches >= options.stopAfterEmptyBatches) {
        stopReason = "empty_batch_limit_reached";
        break;
      }
      continue;
    }

    emptyBatches = 0;
    if (!options.execute) {
      batchReports.push(dryReport);
    } else {
      const beforeFinished = await dependencies.queryFinishedMatchCount?.();
      const execute = await dependencies.runManualBatch({ from: batch.from, to: batch.to, execute: true });
      const afterFinished = await dependencies.queryFinishedMatchCount?.();
      batchReports.push({
        ...summarizeBatch(batch.from, batch.to, execute, true),
        executeRun: true,
        executeSuccess: execute.ingestionRunReport.result !== "failed",
        dbWritesCount: execute.totals.eventsCount + execute.totals.scoresCount,
        totalFinishedMatchesAfterExecute: afterFinished,
        ...(beforeFinished !== undefined && afterFinished !== undefined ? { totalFinishedMatchesAfterExecute: afterFinished } : {})
      });
    }

    const currentFinished = await dependencies.queryFinishedMatchCount?.();
    if (options.targetFinished !== undefined && currentFinished !== undefined && currentFinished >= options.targetFinished) {
      stopReason = "target_finished_reached";
      break;
    }
  }

  const finalFinishedMatchCount = await dependencies.queryFinishedMatchCount?.();
  const report: HistoricalBackfillReport = {
    provider: providerName,
    mode: options.execute ? "execute" : "dry-run",
    countryId: options.countryId,
    leagueId: options.leagueId,
    leagueName: league?.leagueName,
    from: options.from,
    to: options.to,
    batchDays: options.batchDays,
    batches: batchReports,
    totalBatchesProcessed: batchReports.length,
    totalExecutedBatches: batchReports.filter((batch) => batch.executeRun).length,
    totalEmptyBatches: batchReports.filter((batch) => batch.empty).length,
    totalEventsFetched: batchReports.reduce((total, batch) => total + batch.eventsFetched, 0),
    totalScoresFetched: batchReports.reduce((total, batch) => total + batch.scoresFetched, 0),
    totalMatchesInsertedOrUpdated: batchReports.reduce((total, batch) => total + batch.dbWritesCount, 0),
    finalFinishedMatchCount,
    stopReason,
    nextRecommendedDateRange: nextRecommendedRange(batchReports, options.batchDays),
    secretExposureCheck: "clean"
  };
  dependencies.log?.(JSON.stringify(report, null, 2));
  return report;
}

export function splitDateRange(from: string, to: string, batchDays: number): Array<{ from: string; to: string }> {
  const start = parseDateOnly(from, "--from");
  const end = parseDateOnly(to, "--to");
  if (end.getTime() < start.getTime()) {
    throw new Error("APIFootball.com historical backfill requires --to to be on or after --from.");
  }

  const batches: Array<{ from: string; to: string }> = [];
  let cursor = start;
  while (cursor.getTime() <= end.getTime()) {
    const batchEnd = new Date(cursor);
    batchEnd.setUTCDate(batchEnd.getUTCDate() + batchDays - 1);
    if (batchEnd.getTime() > end.getTime()) {
      batchEnd.setTime(end.getTime());
    }
    batches.push({ from: formatDateOnly(cursor), to: formatDateOnly(batchEnd) });
    cursor = new Date(batchEnd);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return batches;
}

function summarizeBatch(from: string, to: string, result: ManualIngestionRunResult, executeRun: boolean): HistoricalBackfillBatchReport {
  const events = result.operations.find((operation) => operation.operation === "events");
  const scores = result.operations.find((operation) => operation.operation === "scores");
  return {
    from,
    to,
    dryRunSuccess: true,
    empty: result.totals.eventsCount === 0,
    credentialLabels: {
      events: "events",
      results: "results"
    },
    eventsFetched: events?.fetchedCount ?? result.totals.eventsCount,
    scoresFetched: scores?.fetchedCount ?? result.totals.scoresCount,
    finishedCount: result.totals.eventsCount,
    notStartedCount: 0,
    mappedEvents: result.totals.eventsCount,
    scoreRowsMapped: result.totals.scoresCount,
    unresolvedSkippedRows: result.totals.unresolvedRowsCount,
    executeRun,
    executeSuccess: executeRun ? result.ingestionRunReport.result !== "failed" : undefined,
    dbWritesCount: executeRun ? result.totals.eventsCount + result.totals.scoresCount : 0,
    totalFinishedMatchesAfterExecute: undefined
  };
}

function emptyBatchReport(from: string, to: string, message: string, empty: boolean): HistoricalBackfillBatchReport {
  return {
    from,
    to,
    dryRunSuccess: empty,
    empty,
    credentialLabels: {
      events: "events",
      results: "results"
    },
    eventsFetched: 0,
    scoresFetched: 0,
    finishedCount: 0,
    notStartedCount: 0,
    mappedEvents: 0,
    scoreRowsMapped: 0,
    unresolvedSkippedRows: 0,
    executeRun: false,
    dbWritesCount: 0,
    errorMessage: sanitizeErrorMessage(message)
  };
}

function nextRecommendedRange(reports: HistoricalBackfillBatchReport[], batchDays: number) {
  const last = reports.at(-1);
  if (!last) return undefined;
  const nextTo = parseDateOnly(last.from, "--from");
  nextTo.setUTCDate(nextTo.getUTCDate() - 1);
  const nextFrom = new Date(nextTo);
  nextFrom.setUTCDate(nextFrom.getUTCDate() - batchDays + 1);
  return { from: formatDateOnly(nextFrom), to: formatDateOnly(nextTo) };
}

function isNoEventsFoundError(message: string) {
  return /no event found/i.test(message);
}

function sanitizeErrorMessage(message: string) {
  return message.replace(/APIkey=[^&\s]+/gi, "APIkey=<redacted>");
}

function parseFlag(arg: string): [string, string | undefined] {
  const index = arg.indexOf("=");
  return index === -1 ? [arg, undefined] : [arg.slice(0, index), arg.slice(index + 1)];
}

function requiredFlagValue(flag: string, value: string | undefined): string {
  if (!value) throw new Error(`Flag ${flag} requires a value.`);
  return value;
}

function parsePositiveInteger(flag: string, value: string | undefined) {
  const parsed = Number(requiredFlagValue(flag, value));
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer.`);
  }
  return parsed;
}

function parseDateOnly(value: string, flag: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`APIFootball.com historical backfill requires ${flag}=YYYY-MM-DD.`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`APIFootball.com historical backfill received invalid ${flag} date.`);
  }
  return date;
}

function formatDateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

function required<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new Error(`Missing required ${name}.`);
  return value;
}

function hasAnyAPIFootballCredential(env: NodeJS.ProcessEnv) {
  return Boolean(
    env.APIFOOTBALL_COM_API_KEY ||
      env.APIFOOTBALL_COM_API_KEY_DEFAULT ||
      env.APIFOOTBALL_COM_API_KEY_COUNTRIES ||
      env.APIFOOTBALL_COM_API_KEY_LEAGUES ||
      env.APIFOOTBALL_COM_API_KEY_TEAMS ||
      env.APIFOOTBALL_COM_API_KEY_STANDINGS ||
      env.APIFOOTBALL_COM_API_KEY_EVENTS ||
      env.APIFOOTBALL_COM_API_KEY_RESULTS ||
      env.APIFOOTBALL_COM_API_KEY_FIXTURES ||
      env.APIFOOTBALL_COM_API_KEY_PLAYERS ||
      env.APIFOOTBALL_COM_API_KEY_STATISTICS ||
      env.APIFOOTBALL_COM_API_KEY_LINEUPS ||
      env.APIFOOTBALL_COM_API_KEY_INJURIES
  );
}

async function main() {
  const options = parseHistoricalBackfillArgs(process.argv.slice(2));
  validateHistoricalBackfillOptions(options, process.env);
  const config = loadConfig();
  const readiness = await checkDatabaseReadiness({
    databaseUrl: config.DATABASE_URL,
    nodeEnv: config.NODE_ENV,
    dbExecutionTarget: config.DB_EXECUTION_TARGET,
    allowRemoteTestDb: config.ALLOW_REMOTE_TEST_DB,
    neonBranchName: config.NEON_BRANCH_NAME
  });
  if (readiness.status !== "ready") {
    throw new Error(`Database readiness check failed before provider fetch.\n${formatDatabaseReadinessResult(readiness)}`);
  }

  const adapter = new APIFootballComAdapter({
    enabled: config.APIFOOTBALL_COM_ENABLED,
    apiKey: config.APIFOOTBALL_COM_API_KEY,
    apiKeys: {
      defaultApiKey: config.APIFOOTBALL_COM_API_KEY_DEFAULT,
      countriesApiKey: config.APIFOOTBALL_COM_API_KEY_COUNTRIES,
      leaguesApiKey: config.APIFOOTBALL_COM_API_KEY_LEAGUES,
      teamsApiKey: config.APIFOOTBALL_COM_API_KEY_TEAMS,
      standingsApiKey: config.APIFOOTBALL_COM_API_KEY_STANDINGS,
      eventsApiKey: config.APIFOOTBALL_COM_API_KEY_EVENTS,
      resultsApiKey: config.APIFOOTBALL_COM_API_KEY_RESULTS,
      fixturesApiKey: config.APIFOOTBALL_COM_API_KEY_FIXTURES,
      playersApiKey: config.APIFOOTBALL_COM_API_KEY_PLAYERS,
      statisticsApiKey: config.APIFOOTBALL_COM_API_KEY_STATISTICS,
      lineupsApiKey: config.APIFOOTBALL_COM_API_KEY_LINEUPS,
      injuriesApiKey: config.APIFOOTBALL_COM_API_KEY_INJURIES
    },
    baseUrl: config.APIFOOTBALL_COM_BASE_URL,
    timeoutMs: config.APIFOOTBALL_COM_TIMEOUT_MS,
    environment: { nodeEnv: config.NODE_ENV, allowProductionAccess: config.APIFOOTBALL_COM_ALLOW_PRODUCTION }
  });
  const database = createDatabase(config.DATABASE_URL);
  const dryRunDependencies = createDryRunDependencies(adapter);
  const executeDependencies = createExecuteDependencies(config, adapter);

  try {
    await runHistoricalBackfill(options, {
      runManualBatch: ({ from, to, execute }) =>
        runManualAPIFootballComIngestion(
          {
            execute,
            verifyAfter: false,
            reportJson: false,
            operations: ["events", "scores"],
            countryId: options.countryId,
            leagueId: options.leagueId,
            from,
            to
          },
          execute ? executeDependencies : dryRunDependencies
        ),
      queryFinishedMatchCount: () => queryFinishedMatchCount(database, required(options.leagueId, "--league-id")),
      log: (message) => console.log(message)
    });
  } finally {
    await closeDependencies(executeDependencies);
  }
}

async function queryFinishedMatchCount(database: Database, leagueId: string) {
  const rows = await database.execute<{ count: string | number }>(sql`
    select count(*)::int as count
    from matches m
    join provider_mappings pm on pm.internal_entity_id = m.competition_id
    where pm.provider = 'apifootball-com'
      and pm.entity_type = 'competition'
      and pm.provider_entity_id = ${leagueId}
      and m.status = 'finished'
  `);
  return Number(rows[0]?.count ?? 0);
}

const isDirectRun = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "APIFootball.com historical backfill failed.");
    process.exitCode = 1;
  });
}
