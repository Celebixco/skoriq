import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { count } from "drizzle-orm";
import { FootballHeadToHeadFeatureBuilder, canonicalizePair } from "@sports-data/analysis";
import type { BuildFootballHeadToHeadOptions, FootballHeadToHeadFeatureInput } from "@sports-data/analysis";
import { createDatabase, footballHeadToHeadFeatures, FootballHeadToHeadFeatureRepository } from "@sports-data/database";
import type { Database } from "@sports-data/database";
import { checkDatabaseReadiness, formatDatabaseReadinessResult } from "./db-readiness.js";

const reportProvider = "manual-football-h2h";
const defaultWindowSizes = [5, 10] as const;

export interface FootballH2HAnalyticsOptions {
  execute: boolean;
  reportJson: boolean;
  teamAId?: string;
  teamBId?: string;
  matchId?: string;
  competitionId?: string;
  seasonId?: string | null;
  allowNullSeason: boolean;
  allApprovedFootball: boolean;
  windowSizes: number[];
}

export interface FootballH2HAnalyticsEnvironment {
  NODE_ENV?: string;
  DATABASE_URL?: string;
  DB_EXECUTION_TARGET?: string;
  ALLOW_REMOTE_TEST_DB?: string | boolean;
  NEON_BRANCH_NAME?: string;
}

export interface FootballH2HBuildExecutionResult {
  changedFeatureRows: number;
  skippedReason?: string;
  calculatedFeatures: FootballHeadToHeadFeatureInput[];
}

export interface FootballH2HAnalyticsDependencies {
  buildForPair(teamAId: string, teamBId: string, options: BuildFootballHeadToHeadOptions): Promise<FootballH2HBuildExecutionResult>;
  buildForMatch(matchId: string, options: Pick<BuildFootballHeadToHeadOptions, "windowSizes">): Promise<FootballH2HBuildExecutionResult>;
  buildForCompetitionSeason(competitionId: string, seasonId: string | null, options: Pick<BuildFootballHeadToHeadOptions, "windowSizes">): Promise<FootballH2HBuildExecutionResult>;
  queryPostRunVerification?(): Promise<FootballH2HAnalyticsVerification>;
  persistRunReport?(report: FootballH2HAnalyticsRunReport): Promise<void>;
  log?(message: string): void;
}

export interface FootballH2HAnalyticsVerification {
  footballHeadToHeadFeaturesCount: number;
}

export interface FootballH2HAnalyticsRunReport {
  provider: typeof reportProvider;
  mode: "dry-run" | "execute";
  selected_target: {
    type: "pair" | "match" | "competition-season";
    team_a_id?: string;
    team_b_id?: string;
    match_id?: string;
    competition_id?: string;
    season_id?: string | null;
    allow_null_season: boolean;
    all_approved_football: boolean;
  };
  pairs_considered: number;
  features_calculated: number;
  features_written: number;
  window_sizes: number[];
  sample_sizes: number[];
  coverage_scores: number[];
  missing_source_data_count: number;
  post_run_verification?: FootballH2HAnalyticsVerification;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  result: "success" | "partial" | "failed";
  warnings: string[];
  safe_sanitized_command_context: {
    command: "analytics:football:h2h:build";
    mode: "dry-run" | "execute";
    team_a_id?: string;
    team_b_id?: string;
    match_id?: string;
    competition_id?: string;
    season_id?: string | null;
    allow_null_season: boolean;
    all_approved_football: boolean;
    window_sizes: number[];
    report_json: boolean;
  };
}

export interface FootballH2HAnalyticsRunResult {
  mode: "dry-run" | "execute";
  report: FootballH2HAnalyticsRunReport;
}

export function parseFootballH2HAnalyticsArgs(argv: string[]): FootballH2HAnalyticsOptions {
  const options: FootballH2HAnalyticsOptions = {
    execute: false,
    reportJson: false,
    allowNullSeason: false,
    allApprovedFootball: false,
    windowSizes: [...defaultWindowSizes]
  };

  for (const arg of argv) {
    if (arg === "--execute") {
      options.execute = true;
      continue;
    }
    if (arg === "--report-json") {
      options.reportJson = true;
      continue;
    }
    if (arg === "--allow-null-season") {
      options.allowNullSeason = true;
      continue;
    }
    if (arg === "--all-approved-football") {
      options.allApprovedFootball = true;
      continue;
    }

    const [key, value] = parseFlag(arg);
    switch (key) {
      case "--team-a-id":
        options.teamAId = requiredFlagValue(key, value);
        break;
      case "--team-b-id":
        options.teamBId = requiredFlagValue(key, value);
        break;
      case "--match-id":
        options.matchId = requiredFlagValue(key, value);
        break;
      case "--competition-id":
        options.competitionId = requiredFlagValue(key, value);
        break;
      case "--season-id":
        options.seasonId = requiredFlagValue(key, value);
        break;
      case "--window-sizes":
        options.windowSizes = parseWindowSizes(value);
        break;
      default:
        throw new Error(`Unknown football H2H analytics flag "${key}".`);
    }
  }

  return options;
}

export function validateFootballH2HAnalyticsOptions(options: FootballH2HAnalyticsOptions, env: FootballH2HAnalyticsEnvironment) {
  if (env.NODE_ENV === "production") {
    throw new Error("Football H2H analytics runner is forbidden in production.");
  }
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for football H2H analytics.");
  }

  const hasPairTarget = Boolean(options.teamAId || options.teamBId);
  const hasCompletePairTarget = Boolean(options.teamAId && options.teamBId);
  const hasMatchTarget = Boolean(options.matchId);
  const hasCompetitionTarget = Boolean(options.competitionId && !hasPairTarget && !hasMatchTarget);
  const targetCount = [hasPairTarget, hasMatchTarget, hasCompetitionTarget].filter(Boolean).length;
  if (targetCount === 0) {
    throw new Error("Football H2H analytics requires --team-a-id plus --team-b-id, --match-id, or --competition-id.");
  }
  if (targetCount > 1) {
    throw new Error("Football H2H analytics accepts exactly one target mode.");
  }
  if (hasPairTarget && !hasCompletePairTarget) {
    throw new Error("Pair mode requires both --team-a-id and --team-b-id.");
  }
  if (hasCompletePairTarget && options.teamAId === options.teamBId) {
    throw new Error("Pair mode requires two different teams.");
  }
  if (options.allowNullSeason && !hasCompetitionTarget) {
    throw new Error("--allow-null-season is only valid for competition-level football H2H builds.");
  }
  if (hasCompetitionTarget && !options.allApprovedFootball) {
    throw new Error("Competition-level football H2H builds require --all-approved-football.");
  }
  if (options.allApprovedFootball && !hasCompetitionTarget) {
    throw new Error("--all-approved-football requires a competition-level target.");
  }
  if (hasCompetitionTarget && !options.seasonId && !options.allowNullSeason) {
    throw new Error("Competition-level football H2H builds require --season-id or explicit --allow-null-season.");
  }
  if (hasCompetitionTarget && options.seasonId && options.allowNullSeason) {
    throw new Error("--allow-null-season cannot be combined with --season-id.");
  }
}

export async function runFootballH2HAnalytics(options: FootballH2HAnalyticsOptions, dependencies: FootballH2HAnalyticsDependencies): Promise<FootballH2HAnalyticsRunResult> {
  const startedAt = new Date();
  const mode = options.execute ? "execute" : "dry-run";
  let execution: FootballH2HBuildExecutionResult;

  if (options.teamAId && options.teamBId) {
    const pair = canonicalizePair(options.teamAId, options.teamBId);
    execution = await dependencies.buildForPair(pair.teamAId, pair.teamBId, {
      competitionId: options.competitionId,
      seasonId: options.seasonId,
      windowSizes: options.windowSizes
    });
  } else if (options.matchId) {
    execution = await dependencies.buildForMatch(options.matchId, { windowSizes: options.windowSizes });
  } else {
    const seasonId = options.allowNullSeason ? null : options.seasonId!;
    execution = await dependencies.buildForCompetitionSeason(options.competitionId!, seasonId, { windowSizes: options.windowSizes });
  }

  const postRunVerification = options.execute ? await dependencies.queryPostRunVerification?.() : undefined;
  const finishedAt = new Date();
  const report = buildRunReport(options, execution, mode, startedAt, finishedAt, postRunVerification);

  if (options.reportJson) {
    await dependencies.persistRunReport?.(report);
  }

  const result = { mode, report };
  dependencies.log?.(JSON.stringify(result, null, 2));
  return result;
}

function buildRunReport(
  options: FootballH2HAnalyticsOptions,
  execution: FootballH2HBuildExecutionResult,
  mode: "dry-run" | "execute",
  startedAt: Date,
  finishedAt: Date,
  postRunVerification?: FootballH2HAnalyticsVerification
): FootballH2HAnalyticsRunReport {
  const pairKeys = new Set(execution.calculatedFeatures.map((feature) => `${feature.teamAId}|${feature.teamBId}`));
  const missingSourceDataCount = execution.calculatedFeatures.filter((feature) => feature.sampleSize === 0).length;
  const warnings = ["Football H2H analytics runner is local/manual only."];
  if (execution.skippedReason) warnings.push(execution.skippedReason);
  if (missingSourceDataCount > 0) warnings.push(`${missingSourceDataCount} calculated feature row(s) have sample_size=0.`);

  return {
    provider: reportProvider,
    mode,
    selected_target: selectedTarget(options),
    pairs_considered: pairKeys.size,
    features_calculated: execution.calculatedFeatures.length || execution.changedFeatureRows,
    features_written: mode === "execute" ? execution.changedFeatureRows : 0,
    window_sizes: options.windowSizes,
    sample_sizes: execution.calculatedFeatures.map((feature) => feature.sampleSize),
    coverage_scores: execution.calculatedFeatures.map((feature) => feature.coverageScore),
    missing_source_data_count: missingSourceDataCount,
    post_run_verification: postRunVerification,
    started_at: startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
    duration_ms: finishedAt.getTime() - startedAt.getTime(),
    result: execution.skippedReason ? "partial" : missingSourceDataCount > 0 ? "partial" : "success",
    warnings,
    safe_sanitized_command_context: {
      command: "analytics:football:h2h:build",
      mode,
      team_a_id: options.teamAId,
      team_b_id: options.teamBId,
      match_id: options.matchId,
      competition_id: options.competitionId,
      season_id: options.allowNullSeason ? null : options.seasonId,
      allow_null_season: options.allowNullSeason,
      all_approved_football: options.allApprovedFootball,
      window_sizes: options.windowSizes,
      report_json: options.reportJson
    }
  };
}

function selectedTarget(options: FootballH2HAnalyticsOptions): FootballH2HAnalyticsRunReport["selected_target"] {
  if (options.teamAId && options.teamBId) {
    const pair = canonicalizePair(options.teamAId, options.teamBId);
    return {
      type: "pair",
      team_a_id: pair.teamAId,
      team_b_id: pair.teamBId,
      competition_id: options.competitionId,
      season_id: options.seasonId,
      allow_null_season: options.allowNullSeason,
      all_approved_football: options.allApprovedFootball
    };
  }
  if (options.matchId) {
    return { type: "match", match_id: options.matchId, allow_null_season: options.allowNullSeason, all_approved_football: options.allApprovedFootball };
  }
  return {
    type: "competition-season",
    competition_id: options.competitionId,
    season_id: options.allowNullSeason ? null : options.seasonId,
    allow_null_season: options.allowNullSeason,
    all_approved_football: options.allApprovedFootball
  };
}

export function createFootballH2HBuilderDependencies(database: Database, execute: boolean): FootballH2HAnalyticsDependencies {
  const repository = new FootballHeadToHeadFeatureRepository(database);
  const collectingRepository = new CollectingFootballH2HFeatureRepository(execute ? repository : undefined);
  const builder = new FootballHeadToHeadFeatureBuilder({
    features: collectingRepository,
    sources: repository
  });

  const run = async (action: () => Promise<{ changedFeatureRows: number; skippedReason?: string }>) => {
    collectingRepository.clear();
    const result = await action();
    return {
      ...result,
      calculatedFeatures: collectingRepository.features
    };
  };

  return {
    buildForPair: (teamAId, teamBId, options) => run(() => builder.buildForPair(teamAId, teamBId, options)),
    buildForMatch: (matchId, options) => run(() => builder.buildForMatch(matchId, options)),
    buildForCompetitionSeason: (competitionId, seasonId, options) => run(() => builder.buildForCompetitionSeason(competitionId, seasonId, options)),
    queryPostRunVerification: createPostRunVerificationQuery(database),
    persistRunReport: writeRunReportFile,
    log: (message) => console.log(message)
  };
}

class CollectingFootballH2HFeatureRepository {
  readonly features: FootballHeadToHeadFeatureInput[] = [];

  constructor(private readonly delegate?: { upsertFeature(input: FootballHeadToHeadFeatureInput): Promise<unknown> }) {}

  clear() {
    this.features.length = 0;
  }

  async upsertFeature(input: FootballHeadToHeadFeatureInput) {
    this.features.push(input);
    return this.delegate ? this.delegate.upsertFeature(input) : input;
  }
}

function createPostRunVerificationQuery(database: Database): () => Promise<FootballH2HAnalyticsVerification> {
  return async () => ({
    footballHeadToHeadFeaturesCount: normalizeCount((await database.select({ count: count() }).from(footballHeadToHeadFeatures))[0]?.count)
  });
}

async function writeRunReportFile(report: FootballH2HAnalyticsRunReport) {
  const outputDir = path.join(process.cwd(), ".provider-runs", "analytics");
  await mkdir(outputDir, { recursive: true });
  const startedAt = report.started_at.replace(/[:.]/g, "-");
  const target = report.selected_target.match_id ?? report.selected_target.team_a_id ?? report.selected_target.competition_id ?? "unknown";
  const filename = `${startedAt}-football-h2h-${report.mode}-${target}.json`;
  await writeFile(path.join(outputDir, filename), `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function parseFlag(arg: string): [string, string | undefined] {
  const index = arg.indexOf("=");
  return index === -1 ? [arg, undefined] : [arg.slice(0, index), arg.slice(index + 1)];
}

function requiredFlagValue(flag: string, value: string | undefined): string {
  if (!value) throw new Error(`Flag ${flag} requires a value.`);
  return value;
}

function parseWindowSizes(value: string | undefined): number[] {
  const values = requiredFlagValue("--window-sizes", value)
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item) && item > 0);
  if (values.length === 0) throw new Error("--window-sizes must include at least one positive integer.");
  return values;
}

function normalizeCount(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") return Number(value);
  return 0;
}

async function main() {
  const options = parseFootballH2HAnalyticsArgs(process.argv.slice(2));
  validateFootballH2HAnalyticsOptions(options, process.env);

  const readiness = await checkDatabaseReadiness({
    databaseUrl: process.env.DATABASE_URL,
    nodeEnv: process.env.NODE_ENV,
    dbExecutionTarget: process.env.DB_EXECUTION_TARGET,
    allowRemoteTestDb: process.env.ALLOW_REMOTE_TEST_DB,
    neonBranchName: process.env.NEON_BRANCH_NAME
  });
  if (readiness.status !== "ready") {
    throw new Error(`Database readiness check failed before football H2H build.\n${formatDatabaseReadinessResult(readiness)}`);
  }

  const database = createDatabase(process.env.DATABASE_URL!);
  await runFootballH2HAnalytics(options, createFootballH2HBuilderDependencies(database, options.execute));
}

const isDirectRun = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Football H2H analytics build failed.");
    process.exitCode = 1;
  });
}
