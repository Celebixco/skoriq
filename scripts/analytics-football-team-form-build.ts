import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { count } from "drizzle-orm";
import { FootballTeamFormFeatureBuilder } from "@sports-data/analysis";
import type { BuildFootballTeamFormOptions, FootballTeamFormFeatureInput } from "@sports-data/analysis";
import { createDatabase, footballTeamFormFeatures, FootballTeamFormFeatureRepository } from "@sports-data/database";
import type { Database } from "@sports-data/database";
import { footballTeamFormScopes } from "@sports-data/shared";
import type { FootballTeamFormScope } from "@sports-data/shared";
import { checkDatabaseReadiness, formatDatabaseReadinessResult } from "./db-readiness.js";

const reportProvider = "manual-football-team-form";
const defaultWindowSizes = [5, 10] as const;
const defaultScopes = footballTeamFormScopes;

export interface FootballTeamFormAnalyticsOptions {
  execute: boolean;
  reportJson: boolean;
  teamId?: string;
  matchId?: string;
  competitionId?: string;
  seasonId?: string | null;
  allApprovedFootball: boolean;
  allowNullSeason: boolean;
  windowSizes: number[];
  scopes: FootballTeamFormScope[];
}

export interface FootballTeamFormAnalyticsEnvironment {
  NODE_ENV?: string;
  DATABASE_URL?: string;
  DB_EXECUTION_TARGET?: string;
  ALLOW_REMOTE_TEST_DB?: string | boolean;
  NEON_BRANCH_NAME?: string;
}

export interface FootballTeamFormBuildExecutionResult {
  changedFeatureRows: number;
  skippedReason?: string;
  calculatedFeatures: FootballTeamFormFeatureInput[];
}

export interface FootballTeamFormAnalyticsDependencies {
  buildForTeam(teamId: string, options: BuildFootballTeamFormOptions): Promise<FootballTeamFormBuildExecutionResult>;
  buildForMatch(matchId: string, options: Pick<BuildFootballTeamFormOptions, "windowSizes" | "scopes">): Promise<FootballTeamFormBuildExecutionResult>;
  buildForCompetitionSeason(
    competitionId: string,
    seasonId: string | null,
    options: Pick<BuildFootballTeamFormOptions, "windowSizes" | "scopes">
  ): Promise<FootballTeamFormBuildExecutionResult>;
  queryPostRunVerification?(): Promise<FootballTeamFormAnalyticsVerification>;
  persistRunReport?(report: FootballTeamFormAnalyticsRunReport): Promise<void>;
  log?(message: string): void;
}

export interface FootballTeamFormAnalyticsVerification {
  footballTeamFormFeaturesCount: number;
}

export interface FootballTeamFormAnalyticsRunReport {
  provider: typeof reportProvider;
  mode: "dry-run" | "execute";
  selected_target: {
    type: "team" | "match" | "competition-season";
    team_id?: string;
    match_id?: string;
    competition_id?: string;
    season_id?: string | null;
    all_approved_football: boolean;
    allow_null_season: boolean;
  };
  teams_considered: number;
  features_calculated: number;
  features_written: number;
  window_sizes: number[];
  scopes: FootballTeamFormScope[];
  missing_source_data_count: number;
  post_run_verification?: FootballTeamFormAnalyticsVerification;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  result: "success" | "partial" | "failed";
  warnings: string[];
  safe_sanitized_command_context: {
    command: "analytics:football:team-form:build";
    mode: "dry-run" | "execute";
    team_id?: string;
    match_id?: string;
    competition_id?: string;
    season_id?: string | null;
    all_approved_football: boolean;
    allow_null_season: boolean;
    window_sizes: number[];
    scopes: FootballTeamFormScope[];
    report_json: boolean;
  };
}

export interface FootballTeamFormAnalyticsRunResult {
  mode: "dry-run" | "execute";
  report: FootballTeamFormAnalyticsRunReport;
}

export function parseFootballTeamFormAnalyticsArgs(argv: string[]): FootballTeamFormAnalyticsOptions {
  const options: FootballTeamFormAnalyticsOptions = {
    execute: false,
    reportJson: false,
    allApprovedFootball: false,
    allowNullSeason: false,
    windowSizes: [...defaultWindowSizes],
    scopes: [...defaultScopes]
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

    if (arg === "--all-approved-football") {
      options.allApprovedFootball = true;
      continue;
    }

    if (arg === "--allow-null-season") {
      options.allowNullSeason = true;
      continue;
    }

    const [key, value] = parseFlag(arg);
    switch (key) {
      case "--team-id":
        options.teamId = requiredFlagValue(key, value);
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
      case "--scopes":
        options.scopes = parseScopes(value);
        break;
      default:
        throw new Error(`Unknown football team form analytics flag "${key}".`);
    }
  }

  return options;
}

export function validateFootballTeamFormAnalyticsOptions(options: FootballTeamFormAnalyticsOptions, env: FootballTeamFormAnalyticsEnvironment) {
  if (env.NODE_ENV === "production") {
    throw new Error("Football team form analytics runner is forbidden in production.");
  }

  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for football team form analytics.");
  }

  const hasTeamTarget = Boolean(options.teamId);
  const hasMatchTarget = Boolean(options.matchId);
  const hasCompetitionTarget = Boolean(options.competitionId && !options.teamId && !options.matchId);
  const targetCount = [hasTeamTarget, hasMatchTarget, hasCompetitionTarget].filter(Boolean).length;
  if (targetCount === 0) {
    throw new Error("Football team form analytics requires --team-id, --match-id, or --competition-id.");
  }

  if (targetCount > 1) {
    throw new Error("Football team form analytics accepts exactly one target mode.");
  }

  if (options.allowNullSeason && !hasCompetitionTarget) {
    throw new Error("--allow-null-season is only valid for competition-level football team form builds.");
  }

  if (hasCompetitionTarget && !options.allApprovedFootball) {
    throw new Error("Competition-level football team form builds require --all-approved-football.");
  }

  if (options.allApprovedFootball && !hasCompetitionTarget) {
    throw new Error("--all-approved-football requires a competition-level target.");
  }

  if (hasCompetitionTarget && !options.seasonId && !options.allowNullSeason) {
    throw new Error("Competition-level football team form builds require --season-id or explicit --allow-null-season.");
  }

  if (hasCompetitionTarget && options.seasonId && options.allowNullSeason) {
    throw new Error("--allow-null-season cannot be combined with --season-id.");
  }
}

export async function runFootballTeamFormAnalytics(
  options: FootballTeamFormAnalyticsOptions,
  dependencies: FootballTeamFormAnalyticsDependencies
): Promise<FootballTeamFormAnalyticsRunResult> {
  const startedAt = new Date();
  const mode = options.execute ? "execute" : "dry-run";
  let execution: FootballTeamFormBuildExecutionResult;

  if (options.teamId) {
    execution = await dependencies.buildForTeam(options.teamId, {
      competitionId: options.competitionId,
      seasonId: options.seasonId,
      windowSizes: options.windowSizes,
      scopes: options.scopes
    });
  } else if (options.matchId) {
    execution = await dependencies.buildForMatch(options.matchId, {
      windowSizes: options.windowSizes,
      scopes: options.scopes
    });
  } else {
    const seasonId = options.allowNullSeason ? null : options.seasonId!;
    execution = await dependencies.buildForCompetitionSeason(options.competitionId!, seasonId, {
      windowSizes: options.windowSizes,
      scopes: options.scopes
    });
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
  options: FootballTeamFormAnalyticsOptions,
  execution: FootballTeamFormBuildExecutionResult,
  mode: "dry-run" | "execute",
  startedAt: Date,
  finishedAt: Date,
  postRunVerification?: FootballTeamFormAnalyticsVerification
): FootballTeamFormAnalyticsRunReport {
  const warnings = buildWarnings(execution);
  const uniqueTeamIds = new Set(execution.calculatedFeatures.map((feature) => feature.teamId));
  const missingSourceDataCount = execution.calculatedFeatures.filter((feature) => feature.sampleSize === 0).length;

  return {
    provider: reportProvider,
    mode,
    selected_target: selectedTarget(options),
    teams_considered: uniqueTeamIds.size,
    features_calculated: execution.calculatedFeatures.length || execution.changedFeatureRows,
    features_written: mode === "execute" ? execution.changedFeatureRows : 0,
    window_sizes: options.windowSizes,
    scopes: options.scopes,
    missing_source_data_count: missingSourceDataCount,
    post_run_verification: postRunVerification,
    started_at: startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
    duration_ms: finishedAt.getTime() - startedAt.getTime(),
    result: execution.skippedReason ? "partial" : missingSourceDataCount > 0 ? "partial" : "success",
    warnings,
    safe_sanitized_command_context: {
      command: "analytics:football:team-form:build",
      mode,
      team_id: options.teamId,
      match_id: options.matchId,
      competition_id: options.competitionId,
      season_id: options.allowNullSeason ? null : options.seasonId,
      all_approved_football: options.allApprovedFootball,
      allow_null_season: options.allowNullSeason,
      window_sizes: options.windowSizes,
      scopes: options.scopes,
      report_json: options.reportJson
    }
  };
}

function selectedTarget(options: FootballTeamFormAnalyticsOptions): FootballTeamFormAnalyticsRunReport["selected_target"] {
  if (options.teamId) {
    return {
      type: "team",
      team_id: options.teamId,
      competition_id: options.competitionId,
      season_id: options.seasonId,
      all_approved_football: options.allApprovedFootball,
      allow_null_season: options.allowNullSeason
    };
  }
  if (options.matchId) {
    return { type: "match", match_id: options.matchId, all_approved_football: options.allApprovedFootball, allow_null_season: options.allowNullSeason };
  }
  return {
    type: "competition-season",
    competition_id: options.competitionId,
    season_id: options.allowNullSeason ? null : options.seasonId,
    all_approved_football: options.allApprovedFootball,
    allow_null_season: options.allowNullSeason
  };
}

function buildWarnings(execution: FootballTeamFormBuildExecutionResult) {
  const warnings = ["Football team form analytics runner is local/manual only."];
  if (execution.skippedReason) {
    warnings.push(execution.skippedReason);
  }
  const missing = execution.calculatedFeatures.filter((feature) => feature.sampleSize === 0).length;
  if (missing > 0) {
    warnings.push(`${missing} calculated feature row(s) have sample_size=0.`);
  }
  return warnings;
}

function parseFlag(arg: string): [string, string | undefined] {
  const index = arg.indexOf("=");
  return index === -1 ? [arg, undefined] : [arg.slice(0, index), arg.slice(index + 1)];
}

function requiredFlagValue(flag: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Flag ${flag} requires a value.`);
  }
  return value;
}

function parseWindowSizes(value: string | undefined): number[] {
  const values = requiredFlagValue("--window-sizes", value)
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item) && item > 0);
  if (values.length === 0) {
    throw new Error("--window-sizes must include at least one positive integer.");
  }
  return values;
}

function parseScopes(value: string | undefined): FootballTeamFormScope[] {
  const scopes = requiredFlagValue("--scopes", value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (scopes.length === 0) {
    throw new Error("--scopes must include at least one scope.");
  }
  for (const scope of scopes) {
    if (!footballTeamFormScopes.includes(scope as FootballTeamFormScope)) {
      throw new Error(`Unsupported football team form scope "${scope}".`);
    }
  }
  return scopes as FootballTeamFormScope[];
}

export function createFootballTeamFormBuilderDependencies(database: Database, execute: boolean): FootballTeamFormAnalyticsDependencies {
  const repository = new FootballTeamFormFeatureRepository(database);
  const collectingRepository = new CollectingFootballTeamFormFeatureRepository(execute ? repository : undefined);
  const builder = new FootballTeamFormFeatureBuilder({
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
    buildForTeam: (teamId, options) => run(() => builder.buildForTeam(teamId, options)),
    buildForMatch: (matchId, options) => run(() => builder.buildForMatch(matchId, options)),
    buildForCompetitionSeason: (competitionId, seasonId, options) => run(() => builder.buildForCompetitionSeason(competitionId, seasonId, options)),
    queryPostRunVerification: createPostRunVerificationQuery(database),
    persistRunReport: writeRunReportFile,
    log: (message) => console.log(message)
  };
}

class CollectingFootballTeamFormFeatureRepository {
  readonly features: FootballTeamFormFeatureInput[] = [];

  constructor(private readonly delegate?: { upsertFeature(input: FootballTeamFormFeatureInput): Promise<unknown> }) {}

  clear() {
    this.features.length = 0;
  }

  async upsertFeature(input: FootballTeamFormFeatureInput) {
    this.features.push(input);
    return this.delegate ? this.delegate.upsertFeature(input) : input;
  }
}

function createPostRunVerificationQuery(database: Database): () => Promise<FootballTeamFormAnalyticsVerification> {
  return async () => ({
    footballTeamFormFeaturesCount: normalizeCount((await database.select({ count: count() }).from(footballTeamFormFeatures))[0]?.count)
  });
}

async function writeRunReportFile(report: FootballTeamFormAnalyticsRunReport) {
  const outputDir = path.join(process.cwd(), ".provider-runs", "analytics");
  await mkdir(outputDir, { recursive: true });
  const startedAt = report.started_at.replace(/[:.]/g, "-");
  const target = report.selected_target.team_id ?? report.selected_target.match_id ?? report.selected_target.competition_id ?? "unknown";
  const filename = `${startedAt}-football-team-form-${report.mode}-${target}.json`;
  await writeFile(path.join(outputDir, filename), `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function normalizeCount(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") return Number(value);
  return 0;
}

async function main() {
  const options = parseFootballTeamFormAnalyticsArgs(process.argv.slice(2));
  validateFootballTeamFormAnalyticsOptions(options, process.env);

  const readiness = await checkDatabaseReadiness({
    databaseUrl: process.env.DATABASE_URL,
    nodeEnv: process.env.NODE_ENV,
    dbExecutionTarget: process.env.DB_EXECUTION_TARGET,
    allowRemoteTestDb: process.env.ALLOW_REMOTE_TEST_DB,
    neonBranchName: process.env.NEON_BRANCH_NAME
  });
  if (readiness.status !== "ready") {
    throw new Error(`Database readiness check failed before analytics build.\n${formatDatabaseReadinessResult(readiness)}`);
  }

  const database = createDatabase(process.env.DATABASE_URL!);
  await runFootballTeamFormAnalytics(options, createFootballTeamFormBuilderDependencies(database, options.execute));
}

const isDirectRun = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Football team form analytics build failed.");
    process.exitCode = 1;
  });
}
