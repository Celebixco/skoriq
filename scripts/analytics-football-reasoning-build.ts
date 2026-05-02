import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { buildFootballMatchReasoning } from "../packages/analysis/src/football-match-reasoning-builder.js";
import type { FootballMatchReasoningPredictionFeature, FootballMatchReasoningSnapshot } from "../packages/analysis/src/football-match-reasoning-builder.js";
import { createDatabase, FootballMatchPredictionFeatureRepository } from "@sports-data/database";
import type { Database } from "@sports-data/database";
import { checkDatabaseReadiness, formatDatabaseReadinessResult } from "./db-readiness.js";

const reportProvider = "manual-football-match-reasoning";

export interface FootballMatchReasoningOptions {
  matchId?: string;
  formWindowSize: number;
  h2hWindowSize: number;
  reportJson: boolean;
}

export interface FootballMatchReasoningEnvironment {
  NODE_ENV?: string;
  DATABASE_URL?: string;
  DB_EXECUTION_TARGET?: string;
  ALLOW_REMOTE_TEST_DB?: string | boolean;
  NEON_BRANCH_NAME?: string;
}

export interface FootballMatchReasoningDependencies {
  findPredictionFeature(matchId: string, formWindowSize: number, h2hWindowSize: number): Promise<FootballMatchReasoningPredictionFeature | undefined>;
  persistRunReport?(report: FootballMatchReasoningRunReport): Promise<void>;
  log?(message: string): void;
}

export interface FootballMatchReasoningRunReport {
  provider: typeof reportProvider;
  mode: "dry-run";
  selected_target: {
    type: "match";
    match_id: string;
    form_window_size: number;
    h2h_window_size: number;
  };
  reasoning?: FootballMatchReasoningSnapshot;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  result: "success" | "failed";
  warnings: string[];
  safe_sanitized_command_context: {
    command: "analytics:football:reasoning:build";
    mode: "dry-run";
    match_id: string;
    form_window_size: number;
    h2h_window_size: number;
    report_json: boolean;
  };
}

export interface FootballMatchReasoningRunResult {
  mode: "dry-run";
  report: FootballMatchReasoningRunReport;
}

export function parseFootballMatchReasoningArgs(argv: string[]): FootballMatchReasoningOptions {
  const options: FootballMatchReasoningOptions = {
    formWindowSize: 5,
    h2hWindowSize: 5,
    reportJson: false
  };

  for (const arg of argv) {
    if (arg === "--report-json") {
      options.reportJson = true;
      continue;
    }
    if (arg === "--execute") {
      throw new Error("Football match reasoning is read-only; --execute is not supported.");
    }

    const [key, value] = parseFlag(arg);
    switch (key) {
      case "--match-id":
        options.matchId = requiredFlagValue(key, value);
        break;
      case "--form-window-size":
        options.formWindowSize = parsePositiveInteger(key, value);
        break;
      case "--h2h-window-size":
        options.h2hWindowSize = parsePositiveInteger(key, value);
        break;
      default:
        throw new Error(`Unknown football match reasoning flag "${key}".`);
    }
  }

  return options;
}

export function validateFootballMatchReasoningOptions(options: FootballMatchReasoningOptions, env: FootballMatchReasoningEnvironment) {
  if (env.NODE_ENV === "production") {
    throw new Error("Football match reasoning runner is forbidden in production.");
  }
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for football match reasoning.");
  }
  if (!options.matchId) {
    throw new Error("Football match reasoning requires --match-id.");
  }
}

export async function runFootballMatchReasoning(
  options: FootballMatchReasoningOptions,
  dependencies: FootballMatchReasoningDependencies
): Promise<FootballMatchReasoningRunResult> {
  const startedAt = new Date();
  const warnings = ["Football match reasoning is a local/manual read-only explanation layer; it does not generate predictions or kupons."];
  const feature = await dependencies.findPredictionFeature(options.matchId!, options.formWindowSize, options.h2hWindowSize);
  const reasoning = feature ? buildFootballMatchReasoning(feature) : undefined;
  if (!feature) {
    warnings.push("No football_match_prediction_features row found for the selected match/windows.");
  }
  const finishedAt = new Date();
  const report = buildRunReport(options, reasoning, warnings, startedAt, finishedAt);

  if (options.reportJson) {
    await dependencies.persistRunReport?.(report);
  }

  const result = { mode: "dry-run" as const, report };
  dependencies.log?.(JSON.stringify(result, null, 2));
  return result;
}

function buildRunReport(
  options: FootballMatchReasoningOptions,
  reasoning: FootballMatchReasoningSnapshot | undefined,
  warnings: string[],
  startedAt: Date,
  finishedAt: Date
): FootballMatchReasoningRunReport {
  return {
    provider: reportProvider,
    mode: "dry-run",
    selected_target: {
      type: "match",
      match_id: options.matchId!,
      form_window_size: options.formWindowSize,
      h2h_window_size: options.h2hWindowSize
    },
    reasoning,
    started_at: startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
    duration_ms: finishedAt.getTime() - startedAt.getTime(),
    result: reasoning ? "success" : "failed",
    warnings,
    safe_sanitized_command_context: {
      command: "analytics:football:reasoning:build",
      mode: "dry-run",
      match_id: options.matchId!,
      form_window_size: options.formWindowSize,
      h2h_window_size: options.h2hWindowSize,
      report_json: options.reportJson
    }
  };
}

export function createFootballMatchReasoningDependencies(database: Database): FootballMatchReasoningDependencies {
  const repository = new FootballMatchPredictionFeatureRepository(database);
  return {
    findPredictionFeature: async (matchId, formWindowSize, h2hWindowSize) => {
      const rows = await repository.listByMatchId(matchId);
      const row = rows.find((candidate) => candidate.formWindowSize === formWindowSize && candidate.h2hWindowSize === h2hWindowSize);
      return row ? mapPredictionFeatureRow(row) : undefined;
    },
    persistRunReport: writeRunReportFile,
    log: (message) => console.log(message)
  };
}

function mapPredictionFeatureRow(row: {
  matchId: string;
  featureStatus: string;
  homeFormFeatureId?: string | null;
  awayFormFeatureId?: string | null;
  h2hFeatureId?: string | null;
  homeFormCoverageScore?: number | null;
  awayFormCoverageScore?: number | null;
  h2hCoverageScore?: number | null;
  combinedCoverageScore: number;
  metadataJson?: unknown;
}): FootballMatchReasoningPredictionFeature {
  return {
    matchId: row.matchId,
    featureStatus: row.featureStatus as FootballMatchReasoningPredictionFeature["featureStatus"],
    homeFormFeatureId: row.homeFormFeatureId,
    awayFormFeatureId: row.awayFormFeatureId,
    h2hFeatureId: row.h2hFeatureId,
    homeFormCoverageScore: row.homeFormCoverageScore,
    awayFormCoverageScore: row.awayFormCoverageScore,
    h2hCoverageScore: row.h2hCoverageScore,
    combinedCoverageScore: row.combinedCoverageScore,
    metadataJson: isRecord(row.metadataJson) ? row.metadataJson : {}
  };
}

async function writeRunReportFile(report: FootballMatchReasoningRunReport) {
  const outputDir = path.join(process.cwd(), ".provider-runs", "analytics");
  await mkdir(outputDir, { recursive: true });
  const startedAt = report.started_at.replace(/[:.]/g, "-");
  const filename = `${startedAt}-football-match-reasoning-${report.selected_target.match_id}.json`;
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

function parsePositiveInteger(flag: string, value: string | undefined): number {
  const parsed = Number(requiredFlagValue(flag, value));
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${flag} must be a positive integer.`);
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function main() {
  const options = parseFootballMatchReasoningArgs(process.argv.slice(2));
  validateFootballMatchReasoningOptions(options, process.env);

  const readiness = await checkDatabaseReadiness({
    databaseUrl: process.env.DATABASE_URL,
    nodeEnv: process.env.NODE_ENV,
    dbExecutionTarget: process.env.DB_EXECUTION_TARGET,
    allowRemoteTestDb: process.env.ALLOW_REMOTE_TEST_DB,
    neonBranchName: process.env.NEON_BRANCH_NAME
  });
  if (readiness.status !== "ready") {
    throw new Error(`Database readiness check failed before football match reasoning.\n${formatDatabaseReadinessResult(readiness)}`);
  }

  const database = createDatabase(process.env.DATABASE_URL!);
  await runFootballMatchReasoning(options, createFootballMatchReasoningDependencies(database));
}

const isDirectRun = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Football match reasoning failed.");
    process.exitCode = 1;
  });
}
