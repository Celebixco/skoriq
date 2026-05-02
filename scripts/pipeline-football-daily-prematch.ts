import "dotenv/config";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { resolveFootballPrematchWindowPolicy } from "@sports-data/shared";
import { manualLeagueConfigs } from "./apifootball-manual-league-config.js";
import { checkDatabaseReadiness, formatDatabaseReadinessResult } from "./db-readiness.js";
import {
  createPrematchMatchPipelineRunner,
  loadPrematchMatchesFromDb,
  runFootballPrematchPipeline,
  validateFootballPrematchPipelineOptions
} from "./pipeline-football-prematch.js";
import type { FootballPrematchPipelineMatchReport, FootballPrematchPipelineOptions } from "./pipeline-football-prematch.js";

interface DailyPrematchOptions {
  execute: boolean;
  windowHours: number;
  minimumLeadMinutes: number;
  limit: number;
  countryId?: string;
  leagueId?: string;
  allReviewedEnabled: boolean;
  timezone: string;
}

interface DailyPrematchReport {
  provider: "manual-football-daily-prematch";
  mode: "dry-run" | "execute";
  timezone: string;
  windowHours: number;
  minimumLeadMinutes: number;
  leaguesScanned: number;
  matchesConsidered: number;
  matchesInsideWindow: number;
  readyMatches: number;
  skippedMatches: number;
  draftsPersisted: number;
  pendingGeneration: number;
  notReady: number;
  stale: number;
  noCandidateSignal: number;
  reports: Array<{
    countryId?: string;
    leagueId?: string;
    matches: FootballPrematchPipelineMatchReport[];
  }>;
  safetyConfirmation: string;
  secretExposureCheck: "clean";
}

export function parseDailyPrematchArgs(argv: string[]): DailyPrematchOptions {
  const policy = resolveFootballPrematchWindowPolicy();
  const options: DailyPrematchOptions = {
    execute: false,
    windowHours: policy.windowHours,
    minimumLeadMinutes: policy.minimumLeadMinutes,
    limit: 200,
    allReviewedEnabled: false,
    timezone: "Europe/Istanbul"
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
      case "--window-hours":
        options.windowHours = parsePositiveInteger(key, value);
        break;
      case "--minimum-lead-minutes":
        options.minimumLeadMinutes = parsePositiveInteger(key, value);
        break;
      case "--limit":
        options.limit = parsePositiveInteger(key, value);
        break;
      case "--country-id":
        options.countryId = requiredFlagValue(key, value);
        break;
      case "--league-id":
        options.leagueId = requiredFlagValue(key, value);
        break;
      case "--timezone":
        options.timezone = requiredFlagValue(key, value);
        break;
      default:
        throw new Error(`Unknown football daily pre-match flag "${key}".`);
    }
  }

  if (!options.allReviewedEnabled && !(options.countryId && options.leagueId)) {
    throw new Error("Daily pre-match scan requires --all-reviewed-enabled or --country-id plus --league-id.");
  }
  if ((options.countryId && !options.leagueId) || (!options.countryId && options.leagueId)) {
    throw new Error("Daily pre-match scan requires --country-id and --league-id together.");
  }

  return options;
}

export async function runDailyPrematchScan(options: DailyPrematchOptions, databaseUrl: string, now = new Date()): Promise<DailyPrematchReport> {
  const reviewedLeagues = manualLeagueConfigs.filter((league) => league.reviewed && league.enabled);
  const leagueScopes = options.allReviewedEnabled
    ? reviewedLeagues
    : reviewedLeagues.filter((league) => league.countryId === options.countryId && league.leagueId === options.leagueId);

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const reports: DailyPrematchReport["reports"] = [];
  try {
    for (const league of leagueScopes) {
      const pipelineOptions: FootballPrematchPipelineOptions = {
        countryId: league.countryId,
        leagueId: league.leagueId,
        windowHours: options.windowHours,
        minimumLeadMinutes: options.minimumLeadMinutes,
        limit: options.limit,
        execute: options.execute
      };
      validateFootballPrematchPipelineOptions(pipelineOptions, process.env);
      const targets = await loadPrematchMatchesFromDb(pool, pipelineOptions, now);
      const report = await runFootballPrematchPipeline(pipelineOptions, {
        now: () => now,
        loadMatches: async () => targets,
        runMatchPipeline: createPrematchMatchPipelineRunner(databaseUrl)
      });
      reports.push({ countryId: league.countryId, leagueId: league.leagueId, matches: report.matches });
    }
  } finally {
    await pool.end();
  }

  const matches = reports.flatMap((report) => report.matches);
  return {
    provider: "manual-football-daily-prematch",
    mode: options.execute ? "execute" : "dry-run",
    timezone: options.timezone,
    windowHours: options.windowHours,
    minimumLeadMinutes: options.minimumLeadMinutes,
    leaguesScanned: leagueScopes.length,
    matchesConsidered: matches.length,
    matchesInsideWindow: matches.filter((match) => match.analysisWindowStatus === "within_window").length,
    readyMatches: matches.filter((match) => match.featureStatus === "ready").length,
    skippedMatches: matches.filter((match) => Boolean(match.skipReason)).length,
    draftsPersisted: matches.reduce((sum, match) => sum + match.persistedCount, 0),
    pendingGeneration: matches.filter((match) => match.featureStatus === "ready" && match.persistedCount === 0 && match.candidateBlockedReasons.length === 0).length,
    notReady: matches.filter((match) => match.featureStatus && match.featureStatus !== "ready").length,
    stale: matches.filter((match) => match.analysisWindowStatus === "stale").length,
    noCandidateSignal: matches.filter((match) => match.candidateBlockedReasons.length > 0 || (match.featureStatus === "ready" && !hasRecommendation(match))).length,
    reports,
    safetyConfirmation: "No providers, ingestion, settlement, public/member-visible mutation, or tahmin kombini flows were run.",
    secretExposureCheck: "clean"
  };
}

function hasRecommendation(match: FootballPrematchPipelineMatchReport) {
  return match.candidates.Tahminim.length > 0 || match.candidates.Denenir.length > 0 || match.candidates.Alternatif.length > 0;
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
  const options = parseDailyPrematchArgs(process.argv.slice(2));
  const readiness = await checkDatabaseReadiness({
    databaseUrl: process.env.DATABASE_URL,
    nodeEnv: process.env.NODE_ENV,
    dbExecutionTarget: process.env.DB_EXECUTION_TARGET,
    allowRemoteTestDb: process.env.ALLOW_REMOTE_TEST_DB,
    neonBranchName: process.env.NEON_BRANCH_NAME
  });
  if (readiness.status !== "ready") {
    throw new Error(`Database readiness check failed before daily pre-match scan.\n${formatDatabaseReadinessResult(readiness)}`);
  }
  const report = await runDailyPrematchScan(options, process.env.DATABASE_URL!);
  console.log(JSON.stringify(report, null, 2));
}

const isDirectRun = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "DATABASE_URL=<redacted>") : "Daily football pre-match scan failed.");
    process.exitCode = 1;
  });
}
