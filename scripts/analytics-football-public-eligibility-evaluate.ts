import "dotenv/config";
import { pathToFileURL } from "node:url";
import { FootballPublicEligibilityEvaluator } from "@sports-data/analysis";
import type { FootballPublicEligibilityInput, FootballPublicEligibilityResult } from "@sports-data/analysis";
import { createDatabase } from "@sports-data/database";
import type { Database } from "@sports-data/database";
import { sql } from "drizzle-orm";
import { checkDatabaseReadiness, formatDatabaseReadinessResult } from "./db-readiness.js";

const reportProvider = "manual-football-public-eligibility-evaluator";

export interface FootballPublicEligibilityRunnerOptions {
  json: boolean;
  matchId?: string;
  predictionId?: string;
}

export interface FootballPublicEligibilityEnvironment {
  NODE_ENV?: string;
  DATABASE_URL?: string;
  DB_EXECUTION_TARGET?: string;
  ALLOW_REMOTE_TEST_DB?: string | boolean;
  NEON_BRANCH_NAME?: string;
}

export interface FootballPublicEligibilityDependencies {
  listContextsByMatchId(matchId: string): Promise<FootballPublicEligibilityInput[]>;
  findContextByPredictionId(predictionId: string): Promise<FootballPublicEligibilityInput | undefined>;
  log?(message: string): void;
}

export interface FootballPublicEligibilityRunReport {
  provider: typeof reportProvider;
  mode: "dry-run";
  selected_target: {
    type: "match" | "prediction";
    match_id?: string;
    prediction_id?: string;
  };
  evaluated_outputs_count: number;
  eligible_count: number;
  excluded_count: number;
  written_rows_count: 0;
  eligible: PublicEligibilityReportItem[];
  excluded: PublicEligibilityReportItem[];
  warnings: string[];
  started_at: string;
  finished_at: string;
  duration_ms: number;
  safe_sanitized_command_context: {
    command: "analytics:football:public-eligibility:evaluate";
    mode: "dry-run";
    match_id?: string;
    prediction_id?: string;
    json: boolean;
  };
}

export interface FootballPublicEligibilityRunResult {
  mode: "dry-run";
  report: FootballPublicEligibilityRunReport;
}

export interface PublicEligibilityReportItem {
  predictionOutputId: string;
  matchId: string;
  eligible: boolean;
  predictionType: string;
  predictionValue: string;
  recommendationTier?: string | null;
  consistencyStatus: string;
  outputStatus: string;
  settlementStatus?: string;
  auditOnly: boolean;
  blockers: string[];
  warnings: string[];
  reasons: string[];
  suggestedPublicTitle?: string;
  suggestedPublicSummary?: string;
}

export function parseFootballPublicEligibilityArgs(argv: string[]): FootballPublicEligibilityRunnerOptions {
  const options: FootballPublicEligibilityRunnerOptions = {
    json: false
  };

  for (const arg of argv) {
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--execute" || arg === "--persist" || arg === "--publish") {
      throw new Error("Football public eligibility evaluation is dry-run only; no execute, persist, or publish mode exists.");
    }

    const [key, value] = parseFlag(arg);
    switch (key) {
      case "--match-id":
        options.matchId = requiredFlagValue(key, value);
        break;
      case "--prediction-id":
        options.predictionId = requiredFlagValue(key, value);
        break;
      default:
        throw new Error(`Unknown football public eligibility flag "${key}".`);
    }
  }

  return options;
}

export function validateFootballPublicEligibilityOptions(
  options: FootballPublicEligibilityRunnerOptions,
  env: FootballPublicEligibilityEnvironment
) {
  if (env.NODE_ENV === "production") {
    throw new Error("Football public eligibility evaluation is forbidden in production.");
  }
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for football public eligibility evaluation.");
  }
  if (options.matchId && options.predictionId) {
    throw new Error("Use either --match-id or --prediction-id, not both.");
  }
  if (!options.matchId && !options.predictionId) {
    throw new Error("Football public eligibility evaluation requires --match-id or --prediction-id.");
  }
  if (options.matchId && !isUuid(options.matchId)) {
    throw new Error("--match-id must be a UUID.");
  }
  if (options.predictionId && !isUuid(options.predictionId)) {
    throw new Error("--prediction-id must be a UUID.");
  }
}

export async function runFootballPublicEligibilityEvaluation(
  options: FootballPublicEligibilityRunnerOptions,
  dependencies: FootballPublicEligibilityDependencies
): Promise<FootballPublicEligibilityRunResult> {
  const started = new Date();
  const contexts = options.predictionId
    ? compact([await dependencies.findContextByPredictionId(options.predictionId)])
    : await dependencies.listContextsByMatchId(options.matchId!);
  const evaluator = new FootballPublicEligibilityEvaluator();
  const results = evaluator.evaluateMany(contexts);
  const items = results.map((result, index) => toReportItem(result, contexts[index]!));
  const eligible = items.filter((item) => item.eligible);
  const excluded = items.filter((item) => !item.eligible);
  const finished = new Date();
  const warnings = [
    "Dry-run only; no football_prediction_outputs statuses were changed.",
    "No public_successful_predictions rows were created.",
    "Eligible means candidate-only; internal review and a future publishing step are still required."
  ];
  if (contexts.length === 0) warnings.push("No settled prediction outputs were found for the selected target.");

  const report: FootballPublicEligibilityRunReport = {
    provider: reportProvider,
    mode: "dry-run",
    selected_target: {
      type: options.predictionId ? "prediction" : "match",
      match_id: options.matchId,
      prediction_id: options.predictionId
    },
    evaluated_outputs_count: contexts.length,
    eligible_count: eligible.length,
    excluded_count: excluded.length,
    written_rows_count: 0,
    eligible,
    excluded,
    warnings,
    started_at: started.toISOString(),
    finished_at: finished.toISOString(),
    duration_ms: finished.getTime() - started.getTime(),
    safe_sanitized_command_context: {
      command: "analytics:football:public-eligibility:evaluate",
      mode: "dry-run",
      match_id: options.matchId,
      prediction_id: options.predictionId,
      json: options.json
    }
  };

  dependencies.log?.(JSON.stringify({ mode: "dry-run", report }, null, 2));
  return { mode: "dry-run", report };
}

function createDependencies(database: Database): FootballPublicEligibilityDependencies {
  return {
    listContextsByMatchId: async (matchId) => listContexts(database, "match", matchId),
    findContextByPredictionId: async (predictionId) => (await listContexts(database, "prediction", predictionId))[0],
    log: (message) => console.log(message)
  };
}

async function listContexts(database: Database, targetType: "match" | "prediction", targetId: string): Promise<FootballPublicEligibilityInput[]> {
  const whereClause =
    targetType === "match"
      ? sql`p.match_id = ${targetId}`
      : sql`p.id = ${targetId}`;
  const queryResult = await database.execute(sql`
    select
      p.id as prediction_output_id,
      p.match_id,
      p.status as output_status,
      p.prediction_type,
      p.prediction_value,
      p.recommendation_tier,
      p.display_label,
      p.confidence_score,
      p.consistency_status,
      p.blocking_conflict_count,
      p.generated_at,
      p.metadata_json as prediction_metadata,
      s.settlement_status,
      s.actual_result,
      s.settlement_metadata,
      m.id as match_id,
      m.scheduled_start_at,
      home.name as home_team_name,
      away.name as away_team_name,
      c.name as competition_name
    from football_prediction_outputs p
    inner join football_prediction_settlements s on s.prediction_output_id = p.id
    inner join matches m on m.id = p.match_id
    inner join teams home on home.id = m.home_team_id
    inner join teams away on away.id = m.away_team_id
    inner join competitions c on c.id = m.competition_id
    where ${whereClause}
    order by p.created_at asc
  `);

  const rows = extractRows<EligibilityContextRow>(queryResult);
  const contexts: FootballPublicEligibilityInput[] = [];
  for (const row of rows) {
    contexts.push({
      prediction: {
        id: row.prediction_output_id,
        matchId: row.match_id,
        status: row.output_status,
        predictionType: row.prediction_type,
        predictionValue: row.prediction_value,
        recommendationTier: row.recommendation_tier,
        displayLabel: row.display_label,
        confidenceScore: numberOrNull(row.confidence_score),
        consistencyStatus: row.consistency_status,
        blockingConflictCount: row.blocking_conflict_count,
        generatedAt: row.generated_at,
        metadataJson: recordOrEmpty(row.prediction_metadata)
      },
      settlement: {
        settlementStatus: row.settlement_status,
        actualResult: row.actual_result,
        settlementMetadata: recordOrEmpty(row.settlement_metadata)
      },
      match: {
        id: row.match_id,
        kickoffAt: row.scheduled_start_at,
        homeTeamName: row.home_team_name,
        awayTeamName: row.away_team_name,
        competitionName: row.competition_name
      },
      conflicts: await listConflicts(database, row.prediction_output_id)
    });
  }
  return contexts;
}

async function listConflicts(database: Database, predictionOutputId: string) {
  const queryResult = await database.execute(sql`
    select severity, conflict_type, reason
    from football_prediction_conflicts
    where prediction_output_id = ${predictionOutputId}
    order by created_at asc
  `);
  return extractRows<{ severity: string; conflict_type: string | null; reason: string | null }>(queryResult).map((row) => ({
    severity: row.severity,
    conflictType: row.conflict_type,
    reason: row.reason
  }));
}

function toReportItem(result: FootballPublicEligibilityResult, context: FootballPublicEligibilityInput): PublicEligibilityReportItem {
  return {
    predictionOutputId: result.predictionOutputId,
    matchId: result.matchId,
    eligible: result.eligible,
    predictionType: context.prediction.predictionType,
    predictionValue: context.prediction.predictionValue,
    recommendationTier: context.prediction.recommendationTier,
    consistencyStatus: context.prediction.consistencyStatus,
    outputStatus: context.prediction.status,
    settlementStatus: context.settlement?.settlementStatus,
    auditOnly: result.sourceClassification.auditOnly,
    blockers: result.blockers,
    warnings: result.warnings,
    reasons: result.reasons,
    suggestedPublicTitle: result.suggestedPublicTitle,
    suggestedPublicSummary: result.suggestedPublicSummary
  };
}

function extractRows<T>(queryResult: unknown): T[] {
  if (Array.isArray(queryResult)) return queryResult as T[];
  if (queryResult && typeof queryResult === "object" && Array.isArray((queryResult as { rows?: unknown[] }).rows)) {
    return (queryResult as { rows: T[] }).rows;
  }
  return [];
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function numberOrNull(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseFlag(arg: string): [string, string | undefined] {
  const index = arg.indexOf("=");
  return index === -1 ? [arg, undefined] : [arg.slice(0, index), arg.slice(index + 1)];
}

function requiredFlagValue(flag: string, value: string | undefined): string {
  if (!value) throw new Error(`Flag ${flag} requires a value.`);
  return value;
}

function compact<T>(items: Array<T | undefined>): T[] {
  return items.filter((item): item is T => item !== undefined);
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

interface EligibilityContextRow {
  prediction_output_id: string;
  match_id: string;
  output_status: string;
  prediction_type: string;
  prediction_value: string;
  recommendation_tier: string | null;
  display_label: string | null;
  confidence_score: number | string | null;
  consistency_status: string;
  blocking_conflict_count: number | null;
  generated_at: Date | string;
  prediction_metadata: unknown;
  settlement_status: string;
  actual_result: string | null;
  settlement_metadata: unknown;
  scheduled_start_at: Date | string;
  home_team_name: string | null;
  away_team_name: string | null;
  competition_name: string | null;
}

async function main() {
  const options = parseFootballPublicEligibilityArgs(process.argv.slice(2));
  validateFootballPublicEligibilityOptions(options, process.env);

  const readiness = await checkDatabaseReadiness({
    databaseUrl: process.env.DATABASE_URL,
    nodeEnv: process.env.NODE_ENV,
    dbExecutionTarget: process.env.DB_EXECUTION_TARGET,
    allowRemoteTestDb: process.env.ALLOW_REMOTE_TEST_DB,
    neonBranchName: process.env.NEON_BRANCH_NAME
  });
  if (readiness.status !== "ready") {
    throw new Error(`Database readiness check failed before football public eligibility evaluation.\n${formatDatabaseReadinessResult(readiness)}`);
  }

  const database = createDatabase(process.env.DATABASE_URL!);
  await runFootballPublicEligibilityEvaluation(options, createDependencies(database));
}

const isDirectRun = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Football public eligibility evaluation failed.");
    process.exitCode = 1;
  });
}
