import "dotenv/config";
import { pathToFileURL } from "node:url";
import { sql } from "drizzle-orm";
import { buildFootballMatchReasoning } from "../packages/analysis/src/football-match-reasoning-builder.js";
import type { FootballMatchReasoningPredictionFeature, FootballMatchReasoningSnapshot } from "../packages/analysis/src/football-match-reasoning-builder.js";
import { createDatabase } from "@sports-data/database";
import type { Database } from "@sports-data/database";
import { checkDatabaseReadiness, formatDatabaseReadinessResult } from "./db-readiness.js";

export interface FootballMatchViewOptions {
  matchId?: string;
  json: boolean;
  debug: boolean;
  formWindowSize: number;
  h2hWindowSize: number;
}

export interface FootballMatchViewEnvironment {
  NODE_ENV?: string;
  DATABASE_URL?: string;
  DB_EXECUTION_TARGET?: string;
  ALLOW_REMOTE_TEST_DB?: string | boolean;
  NEON_BRANCH_NAME?: string;
}

export interface FootballMatchIdentity {
  id: string;
  competition_id: string;
  competition: string;
  country: string | null;
  kickoff: string;
  status: string;
  home_team_id: string;
  home_team: string;
  away_team_id: string;
  away_team: string;
}

export interface FootballMatchAnalyticsReport {
  match?: FootballMatchIdentity;
  feature_snapshot?: {
    feature_status: string;
    combined_coverage_score: number;
    home_form_coverage_score: number | null;
    away_form_coverage_score: number | null;
    h2h_coverage_score: number | null;
  };
  reasoning?: FootballMatchReasoningSnapshot;
  debug?: {
    source_feature_ids: {
      home_form_feature_id?: string | null;
      away_form_feature_id?: string | null;
      h2h_feature_id?: string | null;
    };
  };
  warnings: string[];
}

export interface FootballMatchViewDependencies {
  loadReport(options: FootballMatchViewOptions): Promise<FootballMatchAnalyticsReport>;
  log?(message: string): void;
}

export function parseFootballMatchViewArgs(argv: string[]): FootballMatchViewOptions {
  const options: FootballMatchViewOptions = {
    json: false,
    debug: false,
    formWindowSize: 5,
    h2hWindowSize: 5
  };

  for (const arg of argv) {
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--debug") {
      options.debug = true;
      continue;
    }
    if (arg === "--execute") {
      throw new Error("Football match analytics viewer is read-only; --execute is not supported.");
    }
    if (arg === "--rebuild") {
      throw new Error("Football match analytics viewer does not rebuild stored features; run the dedicated builders first.");
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
        throw new Error(`Unknown football match analytics viewer flag "${key}".`);
    }
  }

  return options;
}

export function validateFootballMatchViewOptions(options: FootballMatchViewOptions, env: FootballMatchViewEnvironment) {
  if (env.NODE_ENV === "production") {
    throw new Error("Football match analytics viewer is forbidden in production.");
  }
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for football match analytics viewer.");
  }
  if (!options.matchId) {
    throw new Error("Football match analytics viewer requires --match-id.");
  }
}

export async function runFootballMatchView(options: FootballMatchViewOptions, dependencies: FootballMatchViewDependencies): Promise<FootballMatchAnalyticsReport> {
  const report = await dependencies.loadReport(options);
  dependencies.log?.(options.json ? JSON.stringify(report, null, 2) : formatTextReport(report, options));
  return report;
}

function createFootballMatchViewDependencies(database: Database): FootballMatchViewDependencies {
  return {
    loadReport: (options) => queryFootballMatchAnalyticsReport(database, options),
    log: (message) => console.log(message)
  };
}

async function queryFootballMatchAnalyticsReport(database: Database, options: FootballMatchViewOptions): Promise<FootballMatchAnalyticsReport> {
  const warnings = ["Read-only football match analytics viewer. No provider calls, ingestion, analytics writes, scheduler work, predictions, or kupons were run."];
  const match = await queryMatchIdentity(database, options.matchId!);
  if (!match) {
    warnings.push(`No football match found for match_id=${options.matchId}.`);
    return { warnings };
  }

  const feature = await queryPredictionFeature(database, options);
  if (!feature) {
    warnings.push("No football_match_prediction_features row found for the selected match/windows. Build the feature snapshot first.");
    return { match, warnings };
  }

  const reasoning = buildFootballMatchReasoning(feature);
  const report: FootballMatchAnalyticsReport = {
    match,
    feature_snapshot: {
      feature_status: feature.featureStatus,
      combined_coverage_score: feature.combinedCoverageScore,
      home_form_coverage_score: feature.homeFormCoverageScore ?? null,
      away_form_coverage_score: feature.awayFormCoverageScore ?? null,
      h2h_coverage_score: feature.h2hCoverageScore ?? null
    },
    reasoning,
    warnings
  };

  if (options.debug) {
    report.debug = {
      source_feature_ids: {
        home_form_feature_id: feature.homeFormFeatureId,
        away_form_feature_id: feature.awayFormFeatureId,
        h2h_feature_id: feature.h2hFeatureId
      }
    };
  }

  return report;
}

async function queryMatchIdentity(database: Database, matchId: string): Promise<FootballMatchIdentity | undefined> {
  const rows = await executeRows<{
    id: string;
    competition_id: string;
    competition: string;
    country: string | null;
    kickoff: Date | string;
    status: string;
    home_team_id: string;
    home_team: string;
    away_team_id: string;
    away_team: string;
  }>(
    database,
    sql`
      select
        m.id,
        m.competition_id,
        c.name as competition,
        co.name as country,
        m.scheduled_start_at as kickoff,
        m.status,
        home.id as home_team_id,
        home.name as home_team,
        away.id as away_team_id,
        away.name as away_team
      from matches m
      inner join sports s on s.id = m.sport_id and s.slug = 'football'
      inner join competitions c on c.id = m.competition_id
      left join countries co on co.id = c.country_id
      inner join teams home on home.id = m.home_team_id
      inner join teams away on away.id = m.away_team_id
      where m.id = ${matchId}
      limit 1
    `
  );

  const row = rows[0];
  if (!row) return undefined;
  return {
    ...row,
    kickoff: row.kickoff instanceof Date ? row.kickoff.toISOString() : new Date(row.kickoff).toISOString()
  };
}

async function queryPredictionFeature(database: Database, options: FootballMatchViewOptions): Promise<FootballMatchReasoningPredictionFeature | undefined> {
  const rows = await executeRows<{
    match_id: string;
    feature_status: string;
    home_form_feature_id: string | null;
    away_form_feature_id: string | null;
    h2h_feature_id: string | null;
    home_form_coverage_score: string | number | null;
    away_form_coverage_score: string | number | null;
    h2h_coverage_score: string | number | null;
    combined_coverage_score: string | number;
    metadata_json: unknown;
  }>(
    database,
    sql`
      select
        match_id,
        feature_status,
        home_form_feature_id,
        away_form_feature_id,
        h2h_feature_id,
        home_form_coverage_score,
        away_form_coverage_score,
        h2h_coverage_score,
        combined_coverage_score,
        metadata_json
      from football_match_prediction_features
      where match_id = ${options.matchId}
        and form_window_size = ${options.formWindowSize}
        and h2h_window_size = ${options.h2hWindowSize}
      limit 1
    `
  );

  const row = rows[0];
  if (!row) return undefined;
  return {
    matchId: row.match_id,
    featureStatus: row.feature_status as FootballMatchReasoningPredictionFeature["featureStatus"],
    homeFormFeatureId: row.home_form_feature_id,
    awayFormFeatureId: row.away_form_feature_id,
    h2hFeatureId: row.h2h_feature_id,
    homeFormCoverageScore: numberOrNull(row.home_form_coverage_score),
    awayFormCoverageScore: numberOrNull(row.away_form_coverage_score),
    h2hCoverageScore: numberOrNull(row.h2h_coverage_score),
    combinedCoverageScore: Number(row.combined_coverage_score),
    metadataJson: isRecord(row.metadata_json) ? row.metadata_json : {}
  };
}

function formatTextReport(report: FootballMatchAnalyticsReport, options: FootballMatchViewOptions): string {
  const lines = ["Football match analytics report", ""];
  if (!report.match) {
    lines.push("Match: not found");
    appendWarnings(lines, report.warnings);
    return lines.join("\n");
  }

  lines.push(`Match: ${report.match.home_team} vs ${report.match.away_team}`);
  lines.push(`Match ID: ${report.match.id}`);
  lines.push(`Competition: ${report.match.competition}${report.match.country ? ` (${report.match.country})` : ""}`);
  lines.push(`Kickoff: ${report.match.kickoff}`);
  lines.push(`Status: ${report.match.status}`);

  if (!report.reasoning || !report.feature_snapshot) {
    lines.push("", "Feature snapshot: not found");
    appendWarnings(lines, report.warnings);
    return lines.join("\n");
  }

  lines.push("", "Readiness:");
  lines.push(`- feature_status: ${report.reasoning.feature_status}`);
  lines.push(`- prediction_eligible: ${report.reasoning.prediction_eligible ? "yes" : "no"}`);
  lines.push(`- kupon_eligible: ${report.reasoning.kupon_eligible ? "yes" : "no"}`);
  lines.push(`- confidence_ceiling: ${report.reasoning.confidence_ceiling}`);
  lines.push(`- combined_coverage_score: ${formatNumber(report.feature_snapshot.combined_coverage_score)}`);

  lines.push("", "Coverage:");
  lines.push(`- home form: sample=${report.reasoning.metadata.sampleSizes.homeForm} coverage=${formatNullable(report.feature_snapshot.home_form_coverage_score)}`);
  lines.push(`- away form: sample=${report.reasoning.metadata.sampleSizes.awayForm} coverage=${formatNullable(report.feature_snapshot.away_form_coverage_score)}`);
  lines.push(`- H2H: sample=${report.reasoning.metadata.sampleSizes.h2h} coverage=${formatNullable(report.feature_snapshot.h2h_coverage_score)}`);

  appendList(lines, "Positive signals", report.reasoning.positive_signals);
  appendList(lines, "Risk factors", report.reasoning.risk_factors);
  appendList(lines, "Missing data warnings", report.reasoning.missing_data_warnings);

  lines.push("", "Summary:");
  lines.push(report.reasoning.summary);

  if (options.debug && report.debug) {
    lines.push("", "Debug source feature IDs:");
    lines.push(`- home_form_feature_id: ${report.debug.source_feature_ids.home_form_feature_id ?? "none"}`);
    lines.push(`- away_form_feature_id: ${report.debug.source_feature_ids.away_form_feature_id ?? "none"}`);
    lines.push(`- h2h_feature_id: ${report.debug.source_feature_ids.h2h_feature_id ?? "none"}`);
  }

  appendWarnings(lines, report.warnings);
  return lines.join("\n");
}

function appendList(lines: string[], title: string, items: string[]) {
  lines.push("", `${title}:`);
  if (items.length === 0) {
    lines.push("- none");
    return;
  }
  for (const item of items) {
    lines.push(`- ${item}`);
  }
}

function appendWarnings(lines: string[], warnings: string[]) {
  if (warnings.length === 0) return;
  lines.push("", "Warnings:");
  for (const warning of warnings) {
    lines.push(`- ${warning}`);
  }
}

async function executeRows<T>(database: Database, query: ReturnType<typeof sql>): Promise<T[]> {
  const result = await database.execute(query);
  if (Array.isArray(result)) {
    return result as T[];
  }
  if (result && typeof result === "object" && "rows" in result && Array.isArray(result.rows)) {
    return result.rows as T[];
  }
  return [];
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

function numberOrNull(value: string | number | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatNullable(value: number | null) {
  return value === null ? "n/a" : formatNumber(value);
}

function formatNumber(value: number) {
  return value.toFixed(2);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function main() {
  const options = parseFootballMatchViewArgs(process.argv.slice(2));
  validateFootballMatchViewOptions(options, process.env);

  const readiness = await checkDatabaseReadiness({
    databaseUrl: process.env.DATABASE_URL,
    nodeEnv: process.env.NODE_ENV,
    dbExecutionTarget: process.env.DB_EXECUTION_TARGET,
    allowRemoteTestDb: process.env.ALLOW_REMOTE_TEST_DB,
    neonBranchName: process.env.NEON_BRANCH_NAME
  });
  if (readiness.status !== "ready") {
    throw new Error(`Database readiness check failed before football match analytics viewer.\n${formatDatabaseReadinessResult(readiness)}`);
  }

  const database = createDatabase(process.env.DATABASE_URL!);
  await runFootballMatchView(options, createFootballMatchViewDependencies(database));
}

const isDirectRun = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Football match analytics viewer failed.");
    process.exitCode = 1;
  });
}
