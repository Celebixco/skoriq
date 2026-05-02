import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { count } from "drizzle-orm";
import { FootballMatchPredictionFeatureBuilder } from "@sports-data/analysis";
import type { BuildFootballMatchPredictionFeatureOptions, FootballMatchPredictionFeatureInput } from "@sports-data/analysis";
import { createDatabase, footballMatchPredictionFeatures, FootballMatchPredictionFeatureRepository } from "@sports-data/database";
import type { Database } from "@sports-data/database";
import { checkDatabaseReadiness, formatDatabaseReadinessResult } from "./db-readiness.js";

const reportProvider = "manual-football-match-prediction-features";

export interface FootballMatchPredictionAnalyticsOptions {
  execute: boolean;
  reportJson: boolean;
  matchId?: string;
  competitionId?: string;
  formWindowSize: number;
  h2hWindowSize: number;
}

export interface FootballMatchPredictionAnalyticsEnvironment {
  NODE_ENV?: string;
  DATABASE_URL?: string;
  DB_EXECUTION_TARGET?: string;
  ALLOW_REMOTE_TEST_DB?: string | boolean;
  NEON_BRANCH_NAME?: string;
}

export interface FootballMatchPredictionBuildExecutionResult {
  changedFeatureRows: number;
  skippedReason?: string;
  calculatedFeatures: FootballMatchPredictionFeatureInput[];
}

export interface FootballMatchPredictionAnalyticsDependencies {
  buildForMatch(matchId: string, options: BuildFootballMatchPredictionFeatureOptions): Promise<FootballMatchPredictionBuildExecutionResult>;
  queryPostRunVerification?(): Promise<FootballMatchPredictionAnalyticsVerification>;
  persistRunReport?(report: FootballMatchPredictionAnalyticsRunReport): Promise<void>;
  log?(message: string): void;
}

export interface FootballMatchPredictionAnalyticsVerification {
  footballMatchPredictionFeaturesCount: number;
}

export interface FootballMatchPredictionAnalyticsRunReport {
  provider: typeof reportProvider;
  mode: "dry-run" | "execute";
  selected_target: {
    type: "match";
    match_id: string;
  };
  features_calculated: number;
  features_written: number;
  form_window_size: number;
  h2h_window_size: number;
  feature_status_counts: Record<string, number>;
  combined_coverage_scores: number[];
  missing_source_feature_count: number;
  post_run_verification?: FootballMatchPredictionAnalyticsVerification;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  result: "success" | "partial" | "failed";
  warnings: string[];
  safe_sanitized_command_context: {
    command: "analytics:football:match-prediction-features:build";
    mode: "dry-run" | "execute";
    match_id: string;
    form_window_size: number;
    h2h_window_size: number;
    report_json: boolean;
  };
}

export interface FootballMatchPredictionAnalyticsRunResult {
  mode: "dry-run" | "execute";
  report: FootballMatchPredictionAnalyticsRunReport;
}

export function parseFootballMatchPredictionAnalyticsArgs(argv: string[]): FootballMatchPredictionAnalyticsOptions {
  const options: FootballMatchPredictionAnalyticsOptions = {
    execute: false,
    reportJson: false,
    formWindowSize: 5,
    h2hWindowSize: 5
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

    const [key, value] = parseFlag(arg);
    switch (key) {
      case "--match-id":
        options.matchId = requiredFlagValue(key, value);
        break;
      case "--competition-id":
        options.competitionId = requiredFlagValue(key, value);
        break;
      case "--form-window-size":
        options.formWindowSize = parsePositiveInteger(key, value);
        break;
      case "--h2h-window-size":
        options.h2hWindowSize = parsePositiveInteger(key, value);
        break;
      default:
        throw new Error(`Unknown football match prediction feature flag "${key}".`);
    }
  }

  return options;
}

export function validateFootballMatchPredictionAnalyticsOptions(options: FootballMatchPredictionAnalyticsOptions, env: FootballMatchPredictionAnalyticsEnvironment) {
  if (env.NODE_ENV === "production") {
    throw new Error("Football match prediction feature runner is forbidden in production.");
  }
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for football match prediction feature analytics.");
  }
  if (!options.matchId) {
    throw new Error("Football match prediction feature analytics requires --match-id.");
  }
  if (options.competitionId) {
    throw new Error("Competition-level football match prediction feature builds are not implemented yet; use --match-id.");
  }
}

export async function runFootballMatchPredictionAnalytics(
  options: FootballMatchPredictionAnalyticsOptions,
  dependencies: FootballMatchPredictionAnalyticsDependencies
): Promise<FootballMatchPredictionAnalyticsRunResult> {
  const startedAt = new Date();
  const mode = options.execute ? "execute" : "dry-run";
  const execution = await dependencies.buildForMatch(options.matchId!, {
    formWindowSize: options.formWindowSize,
    h2hWindowSize: options.h2hWindowSize
  });
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
  options: FootballMatchPredictionAnalyticsOptions,
  execution: FootballMatchPredictionBuildExecutionResult,
  mode: "dry-run" | "execute",
  startedAt: Date,
  finishedAt: Date,
  postRunVerification?: FootballMatchPredictionAnalyticsVerification
): FootballMatchPredictionAnalyticsRunReport {
  const featureStatusCounts = countByStatus(execution.calculatedFeatures);
  const missingSourceFeatureCount = execution.calculatedFeatures.reduce((total, feature) => {
    const missing = [feature.homeFormFeatureId, feature.awayFormFeatureId, feature.h2hFeatureId].filter((id) => !id).length;
    return total + missing;
  }, 0);
  const warnings = ["Football match prediction feature runner is local/manual only and does not generate predictions."];
  if (execution.skippedReason) warnings.push(execution.skippedReason);
  if (missingSourceFeatureCount > 0) warnings.push(`${missingSourceFeatureCount} source feature reference(s) are missing.`);

  return {
    provider: reportProvider,
    mode,
    selected_target: { type: "match", match_id: options.matchId! },
    features_calculated: execution.calculatedFeatures.length || execution.changedFeatureRows,
    features_written: mode === "execute" ? execution.changedFeatureRows : 0,
    form_window_size: options.formWindowSize,
    h2h_window_size: options.h2hWindowSize,
    feature_status_counts: featureStatusCounts,
    combined_coverage_scores: execution.calculatedFeatures.map((feature) => feature.combinedCoverageScore),
    missing_source_feature_count: missingSourceFeatureCount,
    post_run_verification: postRunVerification,
    started_at: startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
    duration_ms: finishedAt.getTime() - startedAt.getTime(),
    result: execution.skippedReason ? "partial" : featureStatusCounts.ready === execution.calculatedFeatures.length ? "success" : "partial",
    warnings,
    safe_sanitized_command_context: {
      command: "analytics:football:match-prediction-features:build",
      mode,
      match_id: options.matchId!,
      form_window_size: options.formWindowSize,
      h2h_window_size: options.h2hWindowSize,
      report_json: options.reportJson
    }
  };
}

export function createFootballMatchPredictionBuilderDependencies(database: Database, execute: boolean): FootballMatchPredictionAnalyticsDependencies {
  const repository = new FootballMatchPredictionFeatureRepository(database);
  const collectingRepository = new CollectingFootballMatchPredictionFeatureRepository(execute ? repository : undefined);
  const builder = new FootballMatchPredictionFeatureBuilder({
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
    buildForMatch: (matchId, options) => run(() => builder.buildForMatch(matchId, options)),
    queryPostRunVerification: createPostRunVerificationQuery(database),
    persistRunReport: writeRunReportFile,
    log: (message) => console.log(message)
  };
}

class CollectingFootballMatchPredictionFeatureRepository {
  readonly features: FootballMatchPredictionFeatureInput[] = [];

  constructor(private readonly delegate?: { upsertFeature(input: FootballMatchPredictionFeatureInput): Promise<unknown> }) {}

  clear() {
    this.features.length = 0;
  }

  async upsertFeature(input: FootballMatchPredictionFeatureInput) {
    this.features.push(input);
    return this.delegate ? this.delegate.upsertFeature(input) : input;
  }
}

function createPostRunVerificationQuery(database: Database): () => Promise<FootballMatchPredictionAnalyticsVerification> {
  return async () => ({
    footballMatchPredictionFeaturesCount: normalizeCount((await database.select({ count: count() }).from(footballMatchPredictionFeatures))[0]?.count)
  });
}

async function writeRunReportFile(report: FootballMatchPredictionAnalyticsRunReport) {
  const outputDir = path.join(process.cwd(), ".provider-runs", "analytics");
  await mkdir(outputDir, { recursive: true });
  const startedAt = report.started_at.replace(/[:.]/g, "-");
  const filename = `${startedAt}-football-match-prediction-features-${report.mode}-${report.selected_target.match_id}.json`;
  await writeFile(path.join(outputDir, filename), `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function countByStatus(features: FootballMatchPredictionFeatureInput[]): Record<string, number> {
  return features.reduce<Record<string, number>>((counts, feature) => {
    counts[feature.featureStatus] = (counts[feature.featureStatus] ?? 0) + 1;
    return counts;
  }, {});
}

function parseFlag(arg: string): [string, string | undefined] {
  const index = arg.indexOf("=");
  return index === -1 ? [arg, undefined] : [arg.slice(0, index), arg.slice(index + 1)];
}

function requiredFlagValue(flag: string, value: string | undefined): string {
  if (!value) throw new Error(`Flag ${flag} requires a value.`);
  return value;
}

function parsePositiveInteger(flag: string, value: string | undefined): number {
  const parsed = Number(requiredFlagValue(flag, value));
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${flag} must be a positive integer.`);
  return parsed;
}

function normalizeCount(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") return Number(value);
  return 0;
}

async function main() {
  const options = parseFootballMatchPredictionAnalyticsArgs(process.argv.slice(2));
  validateFootballMatchPredictionAnalyticsOptions(options, process.env);

  const readiness = await checkDatabaseReadiness({
    databaseUrl: process.env.DATABASE_URL,
    nodeEnv: process.env.NODE_ENV,
    dbExecutionTarget: process.env.DB_EXECUTION_TARGET,
    allowRemoteTestDb: process.env.ALLOW_REMOTE_TEST_DB,
    neonBranchName: process.env.NEON_BRANCH_NAME
  });
  if (readiness.status !== "ready") {
    throw new Error(`Database readiness check failed before football match prediction feature build.\n${formatDatabaseReadinessResult(readiness)}`);
  }

  const database = createDatabase(process.env.DATABASE_URL!);
  await runFootballMatchPredictionAnalytics(options, createFootballMatchPredictionBuilderDependencies(database, options.execute));
}

const isDirectRun = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Football match prediction feature build failed.");
    process.exitCode = 1;
  });
}
