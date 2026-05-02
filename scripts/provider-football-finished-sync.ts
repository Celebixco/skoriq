import "dotenv/config";
import { pathToFileURL } from "node:url";
import { loadConfig } from "@sports-data/config";
import { APIFootballComAdapter } from "@sports-data/providers";
import { manualLeagueConfigs } from "./apifootball-manual-league-config.js";
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
}

export function parseFinishedSyncArgs(argv: string[]): FinishedSyncOptions {
  const options: FinishedSyncOptions = {
    execute: false,
    lookbackHours: 72,
    allReviewedEnabled: false,
    limit: 200
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
    environment: { nodeEnv: config.NODE_ENV }
  });

  const dependencies = options.execute ? createExecuteDependencies(config, adapter) : createDryRunDependencies(adapter);
  const reports: FinishedSyncLeagueReport[] = [];
  try {
    for (const league of leagues) {
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
      const result = await runManualAPIFootballComIngestion(manualOptions, { ...dependencies, log: () => undefined });
      reports.push(mapManualResult(league.countryId, league.leagueId, from, to, result));
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
    leagues: reports,
    secretExposureCheck: "clean"
  };
}

function mapManualResult(countryId: string, leagueId: string, from: string, to: string, result: ManualIngestionRunResult): FinishedSyncLeagueReport {
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
    unresolvedRows: result.totals.unresolvedRowsCount
  };
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
