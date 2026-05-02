import "dotenv/config";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { checkDatabaseReadiness, formatDatabaseReadinessResult } from "./db-readiness.js";
import { manualLeagueConfigs, resolveManualLeagueConfig } from "./provider-apifootball-manual-ingest.js";
import { runAPIFootballH2HIngest } from "./provider-apifootball-h2h-ingest.js";
import type { APIFootballH2HIngestReport } from "./provider-apifootball-h2h-ingest.js";
import type { ManualLeagueReviewConfig } from "./provider-apifootball-manual-ingest.js";

const providerName = "apifootball-com";
const defaultLimit = 20;
const defaultMinimumCleanRows = 3;

export interface UpcomingH2HBackfillOptions {
  countryId?: string;
  leagueId?: string;
  from?: string;
  to?: string;
  windowHours?: number;
  limit: number;
  allowPartial: boolean;
  minimumCleanRows: number;
  execute: boolean;
}

export interface UpcomingH2HMatchTarget {
  matchId: string;
  matchLabel: string;
  kickoffAt: string;
}

export interface UpcomingH2HMatchReport {
  matchId: string;
  matchLabel: string;
  kickoffAt: string;
  providerTeamIdsPresent: boolean;
  totalH2hRows: number;
  cleanRows: number;
  skippedRows: number;
  skippedReasons: Record<string, number>;
  executeSafe: boolean;
  blockReason?: string;
  executed: boolean;
  matchesWritten: number;
  scoreRowsWritten: number;
  providerMappingsCreated: number;
  providerMappingsReused: number;
  credentialLabel?: string;
  errorMessage?: string;
}

export interface UpcomingH2HBackfillReport {
  provider: typeof providerName;
  mode: "dry-run" | "execute";
  countryId?: string;
  leagueId?: string;
  leagueName?: string;
  from?: string;
  to?: string;
  windowHours?: number;
  limit: number;
  allowPartial: boolean;
  minimumCleanRows: number;
  matches: UpcomingH2HMatchReport[];
  matchesConsidered: number;
  h2hDryRunsSuccessful: number;
  executeSafeMatches: number;
  executedMatches: number;
  skippedMatches: number;
  totalCleanRows: number;
  totalSkippedRows: number;
  secretExposureCheck: "clean";
  nextRecommendedFeatureRefreshTargets: Array<{ matchId: string; matchLabel: string }>;
}

export interface UpcomingH2HBackfillDependencies {
  loadUpcomingMatches(options: UpcomingH2HBackfillOptions): Promise<UpcomingH2HMatchTarget[]>;
  runOneMatch(options: { matchId: string; execute: boolean; allowPartial: boolean; minimumCleanRows: number }): Promise<APIFootballH2HIngestReport>;
  log?(message: string): void;
}

export function parseUpcomingH2HBackfillArgs(argv: string[]): UpcomingH2HBackfillOptions {
  const options: UpcomingH2HBackfillOptions = {
    limit: defaultLimit,
    allowPartial: false,
    minimumCleanRows: defaultMinimumCleanRows,
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
    if (arg === "--allow-partial") {
      options.allowPartial = true;
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
      case "--window-hours":
        options.windowHours = parsePositiveInteger(key, value);
        break;
      case "--limit":
        options.limit = parsePositiveInteger(key, value);
        break;
      case "--minimum-clean-rows":
        options.minimumCleanRows = parsePositiveInteger(key, value);
        break;
      default:
        throw new Error(`Unknown APIFootball.com upcoming H2H backfill flag "${key}".`);
    }
  }

  return options;
}

export function validateUpcomingH2HBackfillOptions(
  options: UpcomingH2HBackfillOptions,
  env: NodeJS.ProcessEnv,
  configs: readonly ManualLeagueReviewConfig[] = manualLeagueConfigs
) {
  if (env.NODE_ENV === "production") throw new Error("APIFootball.com upcoming H2H backfill is forbidden in production.");
  if (env.APIFOOTBALL_COM_ENABLED !== "true") throw new Error("APIFootball.com upcoming H2H backfill requires APIFOOTBALL_COM_ENABLED=true.");
  if (!options.countryId) throw new Error("APIFootball.com upcoming H2H backfill requires --country-id.");
  if (!options.leagueId) throw new Error("APIFootball.com upcoming H2H backfill requires --league-id.");
  if (options.from) parseDateOnly(options.from, "--from");
  if (options.to) parseDateOnly(options.to, "--to");
  if ((options.from && !options.to) || (!options.from && options.to)) {
    throw new Error("APIFootball.com upcoming H2H backfill requires --from and --to to be provided together.");
  }

  const league = resolveManualLeagueConfig(options.countryId, options.leagueId, configs);
  if (!league) throw new Error("APIFootball.com upcoming H2H backfill is limited to configured reviewed and enabled leagues.");
  if (!league.reviewed || !league.enabled) throw new Error("APIFootball.com upcoming H2H backfill requires reviewed=true and enabled=true.");
}

export function selectUpcomingH2HMatches(
  matches: UpcomingH2HMatchTarget[],
  options: Pick<UpcomingH2HBackfillOptions, "from" | "to" | "windowHours" | "limit">,
  now = new Date()
) {
  const filtered = matches
    .filter((match) => {
      const kickoff = new Date(match.kickoffAt);
      if (Number.isNaN(kickoff.getTime())) return false;
      if (options.from && options.to) {
        return kickoff.getTime() >= startOfDateOnly(options.from).getTime() && kickoff.getTime() <= endOfDateOnly(options.to).getTime();
      }
      if (options.windowHours !== undefined) {
        const windowEnd = new Date(now.getTime() + options.windowHours * 60 * 60 * 1000);
        return kickoff.getTime() >= now.getTime() && kickoff.getTime() <= windowEnd.getTime();
      }
      return kickoff.getTime() >= now.getTime();
    })
    .sort((a, b) => new Date(a.kickoffAt).getTime() - new Date(b.kickoffAt).getTime());

  return filtered.slice(0, options.limit);
}

export async function runUpcomingH2HBackfill(
  options: UpcomingH2HBackfillOptions,
  dependencies: UpcomingH2HBackfillDependencies,
  configs: readonly ManualLeagueReviewConfig[] = manualLeagueConfigs
): Promise<UpcomingH2HBackfillReport> {
  const league = resolveManualLeagueConfig(options.countryId, options.leagueId, configs);
  const targets = await dependencies.loadUpcomingMatches(options);
  const reports: UpcomingH2HMatchReport[] = [];

  for (const target of targets) {
    try {
      const plan = await dependencies.runOneMatch({
        matchId: target.matchId,
        execute: options.execute,
        allowPartial: options.allowPartial,
        minimumCleanRows: options.minimumCleanRows
      });
      const executed = options.execute && plan.executeSafe;
      reports.push({
        matchId: target.matchId,
        matchLabel: target.matchLabel,
        kickoffAt: target.kickoffAt,
        providerTeamIdsPresent: Boolean(plan.target.homeProviderTeamId && plan.target.awayProviderTeamId),
        totalH2hRows: plan.totalH2hRows,
        cleanRows: plan.cleanRows,
        skippedRows: plan.skippedRows,
        skippedReasons: plan.skippedReasons,
        executeSafe: plan.executeSafe,
        blockReason: plan.blockReason,
        executed,
        matchesWritten: executed ? plan.matchesInsertedOrUpdated : 0,
        scoreRowsWritten: executed ? plan.footballMatchScoresInsertedOrUpdated : 0,
        providerMappingsCreated: executed ? plan.providerMatchMappingsCreated : 0,
        providerMappingsReused: executed ? plan.providerMatchMappingsReused : 0,
        credentialLabel: plan.credentialLabel
      });
    } catch (error) {
      reports.push({
        matchId: target.matchId,
        matchLabel: target.matchLabel,
        kickoffAt: target.kickoffAt,
        providerTeamIdsPresent: false,
        totalH2hRows: 0,
        cleanRows: 0,
        skippedRows: 0,
        skippedReasons: {},
        executeSafe: false,
        executed: false,
        matchesWritten: 0,
        scoreRowsWritten: 0,
        providerMappingsCreated: 0,
        providerMappingsReused: 0,
        errorMessage: sanitizeErrorMessage(error instanceof Error ? error.message : "APIFootball.com upcoming H2H match failed.")
      });
    }
  }

  const report: UpcomingH2HBackfillReport = {
    provider: providerName,
    mode: options.execute ? "execute" : "dry-run",
    countryId: options.countryId,
    leagueId: options.leagueId,
    leagueName: league?.leagueName,
    from: options.from,
    to: options.to,
    windowHours: options.windowHours,
    limit: options.limit,
    allowPartial: options.allowPartial,
    minimumCleanRows: options.minimumCleanRows,
    matches: reports,
    matchesConsidered: reports.length,
    h2hDryRunsSuccessful: reports.filter((report) => !report.errorMessage).length,
    executeSafeMatches: reports.filter((report) => report.executeSafe).length,
    executedMatches: reports.filter((report) => report.executed).length,
    skippedMatches: reports.filter((report) => !report.executed).length,
    totalCleanRows: reports.reduce((sum, report) => sum + report.cleanRows, 0),
    totalSkippedRows: reports.reduce((sum, report) => sum + report.skippedRows, 0),
    secretExposureCheck: "clean",
    nextRecommendedFeatureRefreshTargets: reports
      .filter((report) => (options.execute ? report.executed : report.executeSafe))
      .map((report) => ({ matchId: report.matchId, matchLabel: report.matchLabel }))
  };
  dependencies.log?.(JSON.stringify(report, null, 2));
  return report;
}

async function loadUpcomingMatchesFromDb(pool: pg.Pool, options: UpcomingH2HBackfillOptions): Promise<UpcomingH2HMatchTarget[]> {
  const result = await pool.query<UpcomingH2HMatchTarget>(
    `
      select
        m.id as "matchId",
        concat(home.name, ' vs ', away.name) as "matchLabel",
        m.scheduled_start_at::text as "kickoffAt"
      from matches m
      join teams home on home.id = m.home_team_id
      join teams away on away.id = m.away_team_id
      join provider_mappings pm on pm.internal_entity_id = m.competition_id
      where pm.provider = $1
        and pm.entity_type = 'competition'
        and pm.provider_entity_id = $2
        and m.status = 'not_started'
      order by m.scheduled_start_at asc
    `,
    [providerName, options.leagueId]
  );
  return selectUpcomingH2HMatches(result.rows, options);
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
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${flag} must be a positive integer.`);
  return parsed;
}

function parseDateOnly(value: string, flag: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`APIFootball.com upcoming H2H backfill requires ${flag}=YYYY-MM-DD.`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`APIFootball.com upcoming H2H backfill received invalid ${flag} date.`);
  return date;
}

function startOfDateOnly(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function endOfDateOnly(value: string) {
  return new Date(`${value}T23:59:59.999Z`);
}

function sanitizeErrorMessage(message: string) {
  return message.replace(/APIkey=[^&\s]+/gi, "APIkey=<redacted>");
}

async function main() {
  const options = parseUpcomingH2HBackfillArgs(process.argv.slice(2));
  validateUpcomingH2HBackfillOptions(options, process.env);
  const readiness = await checkDatabaseReadiness({
    databaseUrl: process.env.DATABASE_URL,
    nodeEnv: process.env.NODE_ENV,
    dbExecutionTarget: process.env.DB_EXECUTION_TARGET,
    allowRemoteTestDb: process.env.ALLOW_REMOTE_TEST_DB,
    neonBranchName: process.env.NEON_BRANCH_NAME
  });
  if (readiness.status !== "ready") {
    throw new Error(`Database readiness check failed before H2H backfill.\n${formatDatabaseReadinessResult(readiness)}`);
  }

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    await runUpcomingH2HBackfill(options, {
      loadUpcomingMatches: (runOptions) => loadUpcomingMatchesFromDb(pool, runOptions),
      runOneMatch: (runOptions) => runAPIFootballH2HIngest(runOptions, process.env),
      log: (message) => console.log(message)
    });
  } finally {
    await pool.end();
  }
}

const isDirectRun = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "APIFootball.com upcoming H2H backfill failed.");
    process.exitCode = 1;
  });
}
