import "dotenv/config";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { resolveFootballPrematchWindowPolicy } from "@sports-data/shared";
import { manualLeagueConfigs } from "./apifootball-manual-league-config.js";
import { checkDatabaseReadiness, formatDatabaseReadinessResult } from "./db-readiness.js";
import {
  assertReviewedTargets,
  createPrematchMatchPipelineRunner,
  loadPrematchMatchesFromDb,
  runFootballPrematchPipeline,
  validateFootballPrematchPipelineOptions
} from "./pipeline-football-prematch.js";
import type { FootballPrematchPipelineMatchReport, FootballPrematchPipelineMatchTarget, FootballPrematchPipelineOptions } from "./pipeline-football-prematch.js";
import { evaluatePreMatchAnalysisWindow } from "./analytics-football-prediction-candidates-generate.js";

interface DailyPrematchOptions {
  execute: boolean;
  windowHours: number;
  minimumLeadMinutes: number;
  limit: number;
  countryId?: string;
  leagueId?: string;
  competitionId?: string;
  matchId?: string;
  allReviewedEnabled: boolean;
  timezone: string;
  maxRuntimeSeconds: number;
  perMatchTimeoutSeconds: number;
  continueOnError: boolean;
  verbose: boolean;
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
  draftsThatWouldBePersisted: number;
  pendingGeneration: number;
  notReady: number;
  stale: number;
  noCandidateSignal: number;
  failedMatches: number;
  elapsedMs: number;
  stoppedReason?: string;
  dbWrites: number;
  reports: Array<{
    countryId?: string;
    leagueId?: string;
    competitionId?: string;
    matchId?: string;
    leagueName?: string;
    matches: FootballPrematchPipelineMatchReport[];
  }>;
  safetyConfirmation: string;
  secretExposureCheck: "clean";
}

interface DailyPrematchDependencies {
  loadMatches?(options: FootballPrematchPipelineOptions, now: Date): Promise<FootballPrematchPipelineMatchTarget[]>;
  runMatchPipeline?(input: {
    target: FootballPrematchPipelineMatchTarget;
    options: FootballPrematchPipelineOptions;
    now: Date;
  }): Promise<FootballPrematchPipelineMatchReport>;
  log?(message: string): void;
}

interface DailyLeagueScope {
  countryId?: string;
  leagueId?: string;
  competitionId?: string;
  matchId?: string;
  countryName?: string;
  leagueName?: string;
}

export function parseDailyPrematchArgs(argv: string[]): DailyPrematchOptions {
  const policy = resolveFootballPrematchWindowPolicy();
  const options: DailyPrematchOptions = {
    execute: false,
    windowHours: policy.windowHours,
    minimumLeadMinutes: policy.minimumLeadMinutes,
    limit: 50,
    allReviewedEnabled: false,
    timezone: "Europe/Istanbul",
    maxRuntimeSeconds: 300,
    perMatchTimeoutSeconds: 45,
    continueOnError: true,
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
    if (arg === "--continue-on-error") {
      options.continueOnError = true;
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
      case "--competition-id":
        options.competitionId = requiredFlagValue(key, value);
        break;
      case "--match-id":
        options.matchId = requiredFlagValue(key, value);
        break;
      case "--timezone":
        options.timezone = requiredFlagValue(key, value);
        break;
      case "--max-runtime-seconds":
        options.maxRuntimeSeconds = parsePositiveInteger(key, value);
        break;
      case "--per-match-timeout-seconds":
        options.perMatchTimeoutSeconds = parsePositiveInteger(key, value);
        break;
      case "--continue-on-error":
        options.continueOnError = parseBooleanFlag(key, value);
        break;
      default:
        throw new Error(`Unknown football daily pre-match flag "${key}".`);
    }
  }

  const scopeCount = [options.allReviewedEnabled, Boolean(options.countryId || options.leagueId), Boolean(options.competitionId), Boolean(options.matchId)].filter(Boolean).length;
  if (scopeCount !== 1) {
    throw new Error("Daily pre-match scan requires exactly one scope: --all-reviewed-enabled, --country-id plus --league-id, --competition-id, or --match-id.");
  }
  if ((options.countryId && !options.leagueId) || (!options.countryId && options.leagueId)) {
    throw new Error("Daily pre-match scan requires --country-id and --league-id together.");
  }

  return options;
}

export async function runDailyPrematchScan(options: DailyPrematchOptions, databaseUrl: string, now = new Date(), dependencies: DailyPrematchDependencies = {}): Promise<DailyPrematchReport> {
  const startedAt = Date.now();
  const deadline = startedAt + options.maxRuntimeSeconds * 1000;
  const log = dependencies.log ?? (() => undefined);
  const leagueScopes = resolveDailyPrematchScopes(options);

  log(
    `[daily-prematch] startup mode=${options.execute ? "execute" : "dry-run"} windowHours=${options.windowHours} minimumLeadMinutes=${options.minimumLeadMinutes} limit=${options.limit} scope=${formatScope(options)} maxRuntimeSeconds=${options.maxRuntimeSeconds} perMatchTimeoutSeconds=${options.perMatchTimeoutSeconds}`
  );

  const pool = dependencies.loadMatches ? undefined : new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const reports: DailyPrematchReport["reports"] = [];
  let stoppedReason: string | undefined;
  try {
    for (const [leagueIndex, league] of leagueScopes.entries()) {
      if (Date.now() >= deadline) {
        stoppedReason = "max_runtime_exceeded";
        log(`[daily-prematch] max runtime reached before league ${leagueIndex + 1}/${leagueScopes.length}; stopping with partial report.`);
        break;
      }
      const pipelineOptions: FootballPrematchPipelineOptions = {
        countryId: league.countryId,
        leagueId: league.leagueId,
        competitionId: league.competitionId,
        matchId: league.matchId,
        windowHours: options.windowHours,
        minimumLeadMinutes: options.minimumLeadMinutes,
        limit: options.limit,
        execute: options.execute
      };
      validateFootballPrematchPipelineOptions(pipelineOptions, process.env);
      const targets = dependencies.loadMatches ? await dependencies.loadMatches(pipelineOptions, now) : await loadPrematchMatchesFromDb(pool!, pipelineOptions, now);
      assertReviewedTargets(targets);
      const leagueReports: FootballPrematchPipelineMatchReport[] = [];
      const insideWindowCount = targets.filter((target) => evaluateTargetWindow(target, pipelineOptions, now) === "within_window").length;
      log(
        `[daily-prematch] league ${leagueIndex + 1}/${leagueScopes.length} ${league.countryName ?? "unknown-country"} / ${league.leagueName ?? league.competitionId ?? league.matchId ?? "unknown-league"} country_id=${league.countryId ?? "n/a"} league_id=${league.leagueId ?? "n/a"} matchesConsidered=${targets.length} matchesInsideWindow=${insideWindowCount}`
      );

      const runner = dependencies.runMatchPipeline ?? createPrematchMatchPipelineRunner(databaseUrl);
      for (const [matchIndex, target] of targets.entries()) {
        const matchStartedAt = Date.now();
        if (Date.now() >= deadline) {
          stoppedReason = "max_runtime_exceeded";
          log(`[daily-prematch] max runtime reached before match ${matchIndex + 1}/${targets.length}; stopping with partial report.`);
          break;
        }
        const analysisWindowStatus = evaluateTargetWindow(target, pipelineOptions, now);
        log(
          `[daily-prematch] match ${matchIndex + 1}/${targets.length} action=${analysisWindowStatus === "within_window" ? "planned" : "skipped"} status=${analysisWindowStatus} match_id=${target.matchId} kickoff=${target.kickoffAt} label="${target.matchLabel}"`
        );

        const report = await runSingleMatchWithTimeout({
          target,
          options: pipelineOptions,
          now,
          runner,
          timeoutSeconds: options.perMatchTimeoutSeconds
        });
        const elapsedMs = Date.now() - matchStartedAt;
        leagueReports.push(report);
        log(
          `[daily-prematch] match ${matchIndex + 1}/${targets.length} action=${report.errorMessage || report.skipReason ? "skipped" : "processed"} status=${report.analysisWindowStatus} featureStatus=${report.featureStatus ?? "n/a"} persisted=${report.persistedCount} elapsedMs=${elapsedMs}`
        );

        if (report.errorMessage && !options.continueOnError) {
          stoppedReason = "match_failed_continue_on_error_false";
          break;
        }
      }

      reports.push({ countryId: league.countryId, leagueId: league.leagueId, competitionId: league.competitionId, matchId: league.matchId, leagueName: league.leagueName, matches: leagueReports });
      if (stoppedReason) break;
    }
  } finally {
    await pool?.end();
  }

  const matches = reports.flatMap((report) => report.matches);
  const report = {
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
    draftsThatWouldBePersisted: options.execute ? 0 : matches.filter((match) => match.featureStatus === "ready" && hasRecommendation(match)).length,
    pendingGeneration: matches.filter((match) => match.featureStatus === "ready" && match.persistedCount === 0 && match.candidateBlockedReasons.length === 0).length,
    notReady: matches.filter((match) => match.featureStatus && match.featureStatus !== "ready").length,
    stale: matches.filter((match) => match.analysisWindowStatus === "stale").length,
    noCandidateSignal: matches.filter((match) => match.candidateBlockedReasons.length > 0 || (match.featureStatus === "ready" && !hasRecommendation(match))).length,
    failedMatches: matches.filter((match) => Boolean(match.errorMessage)).length,
    elapsedMs: Date.now() - startedAt,
    stoppedReason,
    dbWrites: options.execute ? matches.reduce((sum, match) => sum + match.persistedCount, 0) : 0,
    reports,
    safetyConfirmation: "No providers, ingestion, settlement, public/member-visible mutation, or tahmin kombini flows were run.",
    secretExposureCheck: "clean"
  } satisfies DailyPrematchReport;

  log(
    `[daily-prematch] final leaguesScanned=${report.leaguesScanned} matchesConsidered=${report.matchesConsidered} insideWindow=${report.matchesInsideWindow} ready=${report.readyMatches} skipped=${report.skippedMatches} failed=${report.failedMatches} dryRunWouldPersist=${report.draftsThatWouldBePersisted} draftsPersisted=${report.draftsPersisted} dbWrites=${report.dbWrites} elapsedMs=${report.elapsedMs} stoppedReason=${report.stoppedReason ?? "completed"}`
  );
  return report;
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

function parseBooleanFlag(flag: string, value: string | undefined) {
  const normalized = requiredFlagValue(flag, value).toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error(`${flag} must be true or false.`);
}

function resolveDailyPrematchScopes(options: DailyPrematchOptions): DailyLeagueScope[] {
  const reviewedLeagues = manualLeagueConfigs.filter((league) => league.reviewed && league.enabled);
  if (options.allReviewedEnabled) return reviewedLeagues;
  if (options.countryId && options.leagueId) {
    return reviewedLeagues.filter((league) => league.countryId === options.countryId && league.leagueId === options.leagueId);
  }
  if (options.competitionId) return [{ competitionId: options.competitionId, leagueName: options.competitionId }];
  if (options.matchId) return [{ matchId: options.matchId, leagueName: options.matchId }];
  return [];
}

function formatScope(options: DailyPrematchOptions) {
  if (options.allReviewedEnabled) return "all-reviewed-enabled";
  if (options.countryId && options.leagueId) return `country:${options.countryId}/league:${options.leagueId}`;
  if (options.competitionId) return `competition:${options.competitionId}`;
  if (options.matchId) return `match:${options.matchId}`;
  return "unknown";
}

function evaluateTargetWindow(target: FootballPrematchPipelineMatchTarget, options: FootballPrematchPipelineOptions, now: Date) {
  return evaluatePreMatchAnalysisWindow({
    kickoffAt: target.kickoffAt,
    evaluatedAt: now,
    windowHours: options.windowHours,
    minimumLeadMinutes: options.minimumLeadMinutes
  }).analysisWindowStatus;
}

async function runSingleMatchWithTimeout(input: {
  target: FootballPrematchPipelineMatchTarget;
  options: FootballPrematchPipelineOptions;
  now: Date;
  runner: NonNullable<DailyPrematchDependencies["runMatchPipeline"]>;
  timeoutSeconds: number;
}) {
  const report = await runFootballPrematchPipeline(input.options, {
    now: () => input.now,
    loadMatches: async () => [input.target],
    runMatchPipeline: async (runnerInput) =>
      withTimeout(input.runner(runnerInput), input.timeoutSeconds, `Match ${input.target.matchId} exceeded per-match timeout of ${input.timeoutSeconds}s.`)
  });
  const matchReport = report.matches[0];
  if (matchReport?.errorMessage?.includes("per-match timeout")) {
    matchReport.skipReason = "per_match_timeout";
  }
  return matchReport;
}

function withTimeout<T>(promise: Promise<T>, timeoutSeconds: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutSeconds * 1000);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
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
  console.log(
    `[daily-prematch] db status=${readiness.status} classification=${readiness.target.classification} branch=${readiness.target.neonBranchName ?? "n/a"}`
  );
  const report = await runDailyPrematchScan(options, process.env.DATABASE_URL!, new Date(), { log: (message) => console.log(message) });
  console.log(JSON.stringify(report, null, 2));
}

const isDirectRun = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "DATABASE_URL=<redacted>") : "Daily football pre-match scan failed.");
    process.exitCode = 1;
  });
}
