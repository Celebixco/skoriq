import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { FootballPredictionSettlementEngine } from "@sports-data/analysis";
import type { FootballPredictionSettlementResult } from "@sports-data/analysis";
import { createDatabase, FootballPredictionOutputRepository } from "@sports-data/database";
import type { Database } from "@sports-data/database";
import { sql } from "drizzle-orm";
import { manualLeagueConfigs, providerName } from "./apifootball-manual-league-config.js";
import { checkDatabaseReadiness, formatDatabaseReadinessResult } from "./db-readiness.js";

const reportProvider = "manual-football-prediction-settlement";
const settleableStatuses = ["draft", "generated", "member_visible", "locked", "settlement_pending"] as const;

export interface FootballPredictionSettlementRunnerOptions {
  execute: boolean;
  reportJson: boolean;
  matchId?: string;
  predictionId?: string;
  lookbackHours: number;
  allReviewedEnabled: boolean;
}

export interface FootballPredictionSettlementEnvironment {
  NODE_ENV?: string;
  DATABASE_URL?: string;
  DB_EXECUTION_TARGET?: string;
  ALLOW_REMOTE_TEST_DB?: string | boolean;
  NEON_BRANCH_NAME?: string;
}

export interface FootballPredictionSettlementContext {
  predictionOutput: {
    id: string;
    matchId: string;
    predictionType: string;
    predictionValue: string;
    status: string;
    consistencyStatus?: string | null;
    recommendationTier?: string | null;
    generatedAt?: Date | string | null;
    generationWindowStatus?: string | null;
    rebuildRequired?: boolean | null;
    staleAt?: Date | string | null;
  };
  match: {
    id: string;
    status: string;
    scheduledStartAt?: Date | string | null;
  };
  score?: {
    homeScoreFulltime?: number | null;
    awayScoreFulltime?: number | null;
    homeScoreHalftime?: number | null;
    awayScoreHalftime?: number | null;
    status?: string | null;
  } | null;
}

export interface FootballPredictionSettlementDependencies {
  listContextsByMatchId(matchId: string): Promise<FootballPredictionSettlementContext[]>;
  listContextsForReviewedEnabled?(lookbackHours: number): Promise<FootballPredictionSettlementContext[]>;
  findContextByPredictionId(predictionId: string): Promise<FootballPredictionSettlementContext | undefined>;
  persistSettlement?(settlement: FootballPredictionSettlementResult): Promise<void>;
  persistRunReport?(report: FootballPredictionSettlementRunReport): Promise<void>;
  log?(message: string): void;
}

export interface FootballPredictionSettlementRunReport {
  provider: typeof reportProvider;
  mode: "dry-run" | "execute";
  selected_target: {
    type: "match" | "prediction";
    match_id?: string;
    prediction_id?: string;
  };
  settleable_statuses: readonly string[];
  evaluated_outputs_count: number;
  written_settlements_count: number;
  results_by_status: Record<string, number>;
  settlements: FootballPredictionSettlementResult[];
  started_at: string;
  finished_at: string;
  duration_ms: number;
  result: "success" | "partial" | "failed";
  warnings: string[];
  safe_sanitized_command_context: {
    command: "analytics:football:predictions:settle";
    mode: "dry-run" | "execute";
    match_id?: string;
    prediction_id?: string;
    report_json: boolean;
  };
}

export interface FootballPredictionSettlementRunResult {
  mode: "dry-run" | "execute";
  report: FootballPredictionSettlementRunReport;
}

export function parseFootballPredictionSettlementArgs(argv: string[]): FootballPredictionSettlementRunnerOptions {
  const options: FootballPredictionSettlementRunnerOptions = {
    execute: false,
    reportJson: false,
    lookbackHours: 96,
    allReviewedEnabled: false
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
    if (arg === "--all-reviewed-enabled") {
      options.allReviewedEnabled = true;
      continue;
    }

    const [key, value] = parseFlag(arg);
    switch (key) {
      case "--match-id":
        options.matchId = requiredFlagValue(key, value);
        break;
      case "--prediction-id":
        options.predictionId = requiredFlagValue(key, value);
        break;
      case "--lookback-hours":
        options.lookbackHours = parsePositiveInteger(key, value);
        break;
      default:
        throw new Error(`Unknown football prediction settlement flag "${key}".`);
    }
  }

  return options;
}

export function validateFootballPredictionSettlementOptions(
  options: FootballPredictionSettlementRunnerOptions,
  env: FootballPredictionSettlementEnvironment
) {
  if (env.NODE_ENV === "production") {
    throw new Error("Football prediction settlement is forbidden in production.");
  }
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for football prediction settlement.");
  }
  if (options.matchId && options.predictionId) {
    throw new Error("Use either --match-id or --prediction-id, not both.");
  }
  if (!options.matchId && !options.predictionId && !options.allReviewedEnabled) {
    throw new Error("Football prediction settlement requires --match-id, --prediction-id, or --all-reviewed-enabled.");
  }
}

export async function runFootballPredictionSettlement(
  options: FootballPredictionSettlementRunnerOptions,
  dependencies: FootballPredictionSettlementDependencies
): Promise<FootballPredictionSettlementRunResult> {
  const started = new Date();
  const warnings: string[] = [];
  const contexts = options.predictionId
    ? compact([await dependencies.findContextByPredictionId(options.predictionId)])
    : options.matchId
      ? await dependencies.listContextsByMatchId(options.matchId)
      : await dependencies.listContextsForReviewedEnabled?.(options.lookbackHours) ?? [];

  if (contexts.length === 0) {
    warnings.push("No settleable prediction outputs were found for the selected target.");
  }

  const engine = new FootballPredictionSettlementEngine();
  const settlements = contexts.map((context) =>
    engine.settle({
      prediction: {
        id: context.predictionOutput.id,
        matchId: context.predictionOutput.matchId,
        predictionType: context.predictionOutput.predictionType,
        predictionValue: context.predictionOutput.predictionValue,
        consistencyStatus: context.predictionOutput.consistencyStatus,
        recommendationTier: context.predictionOutput.recommendationTier,
        generatedAt: context.predictionOutput.generatedAt,
        kickoffAt: context.match.scheduledStartAt,
        generationWindowStatus: context.predictionOutput.generationWindowStatus,
        rebuildRequired: context.predictionOutput.rebuildRequired,
        staleAt: context.predictionOutput.staleAt
      },
      match: {
        id: context.match.id,
        status: context.match.status as never
      },
      score: context.score as never,
      evaluatedAt: new Date()
    })
  );

  if (options.execute && !dependencies.persistSettlement) {
    throw new Error("Settlement execute dependencies are not configured.");
  }

  let writtenSettlementsCount = 0;
  if (options.execute) {
    for (const settlement of settlements) {
      await dependencies.persistSettlement!(settlement);
      writtenSettlementsCount += 1;
    }
    warnings.push("Settlement execute updated internal output statuses only; no member visibility, public publishing, or tahmin kombini action was performed.");
  } else {
    warnings.push("Dry-run settlement only; no football_prediction_settlements rows were written and no prediction output statuses were changed.");
  }

  const finished = new Date();
  const report: FootballPredictionSettlementRunReport = {
    provider: reportProvider,
    mode: options.execute ? "execute" : "dry-run",
    selected_target: {
      type: options.predictionId ? "prediction" : "match",
      match_id: options.matchId,
      prediction_id: options.predictionId
    },
    settleable_statuses: settleableStatuses,
    evaluated_outputs_count: contexts.length,
    written_settlements_count: writtenSettlementsCount,
    results_by_status: countBy(settlements.map((settlement) => settlement.settlementStatus)),
    settlements,
    started_at: started.toISOString(),
    finished_at: finished.toISOString(),
    duration_ms: finished.getTime() - started.getTime(),
    result: warnings.length > 0 && contexts.length === 0 ? "partial" : "success",
    warnings,
    safe_sanitized_command_context: {
      command: "analytics:football:predictions:settle",
      mode: options.execute ? "execute" : "dry-run",
      match_id: options.matchId,
      prediction_id: options.predictionId,
      report_json: options.reportJson
    }
  };

  if (options.reportJson) {
    await dependencies.persistRunReport?.(report);
  }

  dependencies.log?.(JSON.stringify({ mode: report.mode, report }, null, 2));
  return { mode: report.mode, report };
}

function createDependencies(database: Database): FootballPredictionSettlementDependencies {
  const repository = new FootballPredictionOutputRepository(database);
  return {
    listContextsByMatchId: (matchId) => repository.listPredictionOutputSettlementContextsByMatchId(matchId),
    listContextsForReviewedEnabled: (lookbackHours) => listReviewedEnabledSettlementContexts(database, lookbackHours),
    findContextByPredictionId: (predictionId) => repository.findPredictionOutputSettlementContextById(predictionId),
    persistSettlement: (settlement) =>
      repository.settlePredictionOutput({
        predictionOutputId: settlement.predictionOutputId,
        matchId: settlement.matchId,
        settlementStatus: settlement.settlementStatus,
        actualResult: settlement.actualResult,
        evaluatedAt: settlement.evaluatedAt,
        settlementReason: settlement.settlementReason,
        settlementMetadata: settlement.settlementMetadata
      }),
    persistRunReport: persistSettlementReport,
    log: (message) => console.log(message)
  };
}

async function listReviewedEnabledSettlementContexts(database: Database, lookbackHours: number): Promise<FootballPredictionSettlementContext[]> {
  const reviewed = manualLeagueConfigs.filter((league) => league.reviewed && league.enabled);
  if (reviewed.length === 0) return [];
  const leagueIds = reviewed.map((league) => league.leagueId);
  const countryIds = reviewed.map((league) => league.countryId);
  const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString();
  const result = await database.execute(sql`
    select
      p.id as prediction_id,
      p.match_id,
      p.prediction_type,
      p.prediction_value,
      p.status as prediction_status,
      p.consistency_status,
      p.recommendation_tier,
      p.generated_at,
      p.generation_window_status,
      p.rebuild_required,
      p.stale_at,
      m.id as match_id,
      m.status as match_status,
      m.scheduled_start_at,
      fs.home_score_fulltime,
      fs.away_score_fulltime,
      fs.home_score_halftime,
      fs.away_score_halftime,
      fs.status as score_status
    from football_prediction_outputs p
    inner join matches m on m.id = p.match_id
    inner join sports s on s.id = m.sport_id and s.slug = 'football'
    inner join competitions c on c.id = m.competition_id
    left join football_match_scores fs on fs.match_id = m.id
    inner join provider_mappings league_pm
      on league_pm.provider = ${providerName}
     and league_pm.entity_type = 'competition'
     and league_pm.internal_entity_id = m.competition_id
    left join provider_mappings country_pm
      on country_pm.provider = ${providerName}
     and country_pm.entity_type = 'country'
     and country_pm.internal_entity_id = c.country_id
    where m.scheduled_start_at >= ${since}
      and p.status in ('draft', 'generated', 'member_visible', 'locked', 'settlement_pending')
      and p.recommendation_tier in ('primary', 'try', 'alternative')
      and p.consistency_status in ('passed', 'warning')
      and p.blocking_conflict_count = 0
      and league_pm.provider_entity_id in (${sql.join(
        leagueIds.map((leagueId) => sql`${leagueId}`),
        sql`, `
      )})
      and country_pm.provider_entity_id in (${sql.join(
        countryIds.map((countryId) => sql`${countryId}`),
        sql`, `
      )})
  `);
  const rows = Array.isArray(result) ? result : "rows" in result && Array.isArray(result.rows) ? result.rows : [];
  return rows.map((row) => {
    const record = row as Record<string, unknown>;
    return {
      predictionOutput: {
        id: String(record.prediction_id),
        matchId: String(record.match_id),
        predictionType: String(record.prediction_type),
        predictionValue: String(record.prediction_value),
        status: String(record.prediction_status),
        consistencyStatus: nullableString(record.consistency_status),
        recommendationTier: nullableString(record.recommendation_tier),
        generatedAt: record.generated_at as Date | string | null,
        generationWindowStatus: nullableString(record.generation_window_status),
        rebuildRequired: Boolean(record.rebuild_required),
        staleAt: record.stale_at as Date | string | null
      },
      match: {
        id: String(record.match_id),
        status: String(record.match_status),
        scheduledStartAt: record.scheduled_start_at as Date | string | null
      },
      score: {
        homeScoreFulltime: numberOrNull(record.home_score_fulltime),
        awayScoreFulltime: numberOrNull(record.away_score_fulltime),
        homeScoreHalftime: numberOrNull(record.home_score_halftime),
        awayScoreHalftime: numberOrNull(record.away_score_halftime),
        status: nullableString(record.score_status)
      }
    };
  });
}

async function persistSettlementReport(report: FootballPredictionSettlementRunReport) {
  const outputDir = path.join(process.cwd(), ".provider-runs", "analytics");
  await mkdir(outputDir, { recursive: true });
  const safeTarget = report.selected_target.prediction_id ?? report.selected_target.match_id ?? "unknown";
  const outputPath = path.join(outputDir, `football-prediction-settlement-${safeTarget}-${Date.now()}.json`);
  await writeFile(outputPath, JSON.stringify(report, null, 2));
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

function compact<T>(items: Array<T | undefined>): T[] {
  return items.filter((item): item is T => item !== undefined);
}

function countBy(values: string[]) {
  return values.reduce<Record<string, number>>((accumulator, value) => {
    accumulator[value] = (accumulator[value] ?? 0) + 1;
    return accumulator;
  }, {});
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function main() {
  const options = parseFootballPredictionSettlementArgs(process.argv.slice(2));
  validateFootballPredictionSettlementOptions(options, process.env);

  const readiness = await checkDatabaseReadiness({
    databaseUrl: process.env.DATABASE_URL,
    nodeEnv: process.env.NODE_ENV,
    dbExecutionTarget: process.env.DB_EXECUTION_TARGET,
    allowRemoteTestDb: process.env.ALLOW_REMOTE_TEST_DB,
    neonBranchName: process.env.NEON_BRANCH_NAME
  });
  if (readiness.status !== "ready") {
    throw new Error(`Database readiness check failed before football prediction settlement.\n${formatDatabaseReadinessResult(readiness)}`);
  }

  const database = createDatabase(process.env.DATABASE_URL!);
  await runFootballPredictionSettlement(options, createDependencies(database));
}

const isDirectRun = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Football prediction settlement failed.");
    process.exitCode = 1;
  });
}
