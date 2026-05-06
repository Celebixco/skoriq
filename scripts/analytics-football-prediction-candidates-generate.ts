import "dotenv/config";
import { pathToFileURL } from "node:url";
import { FootballPredictionCandidateGenerator, FootballPredictionConsistencyEngine } from "@sports-data/analysis";
import { resolveFootballPrematchWindowPolicy } from "@sports-data/shared";
import type {
  FootballPredictionCandidate,
  FootballPredictionAnalysisWindowReport,
  FootballPredictionCandidateFeature,
  FootballPredictionCandidateReport,
  FootballPredictionConsistencyBundleResult,
  FootballPredictionConsistencyConflict
} from "@sports-data/analysis";
import { createDatabase, FootballMatchPredictionFeatureRepository, FootballPredictionOutputRepository } from "@sports-data/database";
import type { Database } from "@sports-data/database";
import { checkDatabaseReadiness, formatDatabaseReadinessResult } from "./db-readiness.js";

export interface FootballPredictionCandidateOptions {
  matchId?: string;
  formWindowSize: number;
  h2hWindowSize: number;
  checkConsistency: boolean;
  persistDraft: boolean;
  windowHours: number;
  minimumLeadMinutes: number;
  enforceWindow: boolean;
}

export interface FootballPredictionCandidateEnvironment {
  NODE_ENV?: string;
  DATABASE_URL?: string;
  DB_EXECUTION_TARGET?: string;
  ALLOW_REMOTE_TEST_DB?: string | boolean;
  NEON_BRANCH_NAME?: string;
}

export interface FootballPredictionCandidateDependencies {
  findFeature(matchId: string, formWindowSize: number, h2hWindowSize: number): Promise<FootballPredictionCandidateFeature | undefined>;
  findMatchKickoffAt?(matchId: string): Promise<Date | string | null | undefined>;
  listExistingGeneratedAt?(matchId: string): Promise<Array<Date | string>>;
  persistDrafts?(input: PersistFootballPredictionDraftsInput): Promise<PersistFootballPredictionDraftsResult>;
  now?(): Date;
  log?(message: string): void;
}

export interface FootballPredictionCandidateRunResult {
  mode: "dry_run";
  report: FootballPredictionCandidateReport;
  persistence?: PersistFootballPredictionDraftsResult;
}

export interface PersistFootballPredictionDraftsInput {
  report: FootballPredictionCandidateReport;
  consistency: FootballPredictionConsistencyBundleResult;
  generatedAt: Date;
}

export interface PersistFootballPredictionDraftsResult {
  persistedOutputsCount: number;
  outputIds: string[];
  statusValues: string[];
  consistencyStatuses: string[];
  recommendationTiers: string[];
  conflictsPersistedCount: number;
  memberVisibleCount: number;
}

export function parseFootballPredictionCandidateArgs(argv: string[]): FootballPredictionCandidateOptions {
  const policy = resolveFootballPrematchWindowPolicy();
  const options: FootballPredictionCandidateOptions = {
    formWindowSize: 5,
    h2hWindowSize: 5,
    checkConsistency: false,
    persistDraft: false,
    windowHours: policy.windowHours,
    minimumLeadMinutes: policy.minimumLeadMinutes,
    enforceWindow: false
  };

  for (const arg of argv) {
    if (arg === "--execute" || arg === "--persist-draft") {
      if (arg === "--execute") throw new Error("Football prediction candidate generation does not support --execute; use --persist-draft for draft-only storage.");
    }
    const [key, value] = parseFlag(arg);
    switch (key) {
      case "--check-consistency":
        options.checkConsistency = true;
        break;
      case "--persist-draft":
        options.persistDraft = true;
        options.checkConsistency = true;
        break;
      case "--enforce-window":
        options.enforceWindow = true;
        break;
      case "--match-id":
        options.matchId = requiredFlagValue(key, value);
        break;
      case "--form-window-size":
        options.formWindowSize = parsePositiveInteger(key, value);
        break;
      case "--h2h-window-size":
        options.h2hWindowSize = parsePositiveInteger(key, value);
        break;
      case "--window-hours":
        options.windowHours = parsePositiveInteger(key, value);
        break;
      case "--minimum-lead-minutes":
        options.minimumLeadMinutes = parsePositiveInteger(key, value);
        break;
      default:
        throw new Error(`Unknown football prediction candidate flag "${key}".`);
    }
  }

  return options;
}

export function validateFootballPredictionCandidateOptions(options: FootballPredictionCandidateOptions, env: FootballPredictionCandidateEnvironment) {
  if (env.NODE_ENV === "production") {
    throw new Error("Football prediction candidate generator is forbidden in production.");
  }
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for football prediction candidate generation.");
  }
  if (!options.matchId) {
    throw new Error("Football prediction candidate generation requires --match-id.");
  }
  if (options.persistDraft && options.checkConsistency !== true) {
    throw new Error("--persist-draft requires consistency checks.");
  }
}

export async function runFootballPredictionCandidateGeneration(
  options: FootballPredictionCandidateOptions,
  dependencies: FootballPredictionCandidateDependencies
): Promise<FootballPredictionCandidateRunResult> {
  const feature = await dependencies.findFeature(options.matchId!, options.formWindowSize, options.h2hWindowSize);
  const evaluatedAt = dependencies.now?.() ?? new Date();
  const kickoffAt = (await dependencies.findMatchKickoffAt?.(options.matchId!)) ?? null;
  const existingGeneratedAt = (await dependencies.listExistingGeneratedAt?.(options.matchId!)) ?? [];
  const generator = new FootballPredictionCandidateGenerator();
  const report: FootballPredictionCandidateReport = feature
    ? generator.generate(feature)
    : {
        matchId: options.matchId!,
        featureSnapshotId: "",
        generationMode: "dry_run" as const,
        candidates: [],
        warnings: [],
        blockedReasons: ["No football_match_prediction_features row found for the selected match/windows."],
        summary: "Analysis-only: feature snapshot is missing."
      };
  report.analysisWindow = evaluatePreMatchAnalysisWindow({
    kickoffAt,
    evaluatedAt,
    generatedAt: evaluatedAt,
    existingGeneratedAt,
    windowHours: options.windowHours,
    minimumLeadMinutes: options.minimumLeadMinutes
  });
  appendAnalysisWindowWarnings(report, report.analysisWindow);
  if (options.enforceWindow && report.analysisWindow.analysisWindowStatus !== "within_window") {
    const blockReason = `Pre-match analysis window enforcement blocked candidate generation: ${report.analysisWindow.analysisWindowStatus}.`;
    report.candidates = [];
    report.blockedReasons.push(blockReason);
    report.summary = "Analysis-only: pre-match analysis window enforcement blocked candidate generation.";
    report.warnings.push("Window enforcement is enabled; no candidates were generated or persisted.");
    const result = { mode: "dry_run" as const, report };
    dependencies.log?.(JSON.stringify(result, null, 2));
    return result;
  }
  const consistency = options.checkConsistency && report.candidates.length > 0 ? applyConsistency(report) : undefined;
  const persistence =
    options.persistDraft && consistency
      ? await dependencies.persistDrafts?.({
          report,
          consistency,
          generatedAt: evaluatedAt
        })
      : undefined;
  if (options.persistDraft && !dependencies.persistDrafts) {
    throw new Error("Draft persistence dependencies are not configured.");
  }
  if (persistence) {
    report.warnings.push("Draft persistence stored audit candidates only; no predictions were made member-visible, settled, public, or kupon-ready.");
  }
  const result = { mode: "dry_run" as const, report, persistence };
  dependencies.log?.(JSON.stringify(result, null, 2));
  return result;
}

function applyConsistency(report: FootballPredictionCandidateReport) {
  const consistency = new FootballPredictionConsistencyEngine().checkCandidateBundle(report);
  report.candidates = consistency.candidates;
  report.conflicts = consistency.conflicts;
  report.blockingConflictCount = consistency.blockingConflictCount;
  report.warningConflictCount = consistency.warningConflictCount;
  report.consistencySummary = consistency.consistencySummary;
  report.canonicalExpectation = consistency.canonicalExpectation;
  report.warnings.push("Consistency check ran in memory only; no candidates were made member-visible.");
  report.summary = `${report.summary} ${consistency.consistencySummary}`;
  return consistency;
}

export interface FootballPredictionCandidateDatabaseDependencyOptions {
  ignoreExistingGeneratedAt?: boolean;
}

export function createFootballPredictionCandidateDependencies(
  database: Database,
  options: FootballPredictionCandidateDatabaseDependencyOptions = {}
): FootballPredictionCandidateDependencies {
  const featureRepository = new FootballMatchPredictionFeatureRepository(database);
  const predictionRepository = new FootballPredictionOutputRepository(database);
  return {
    findFeature: async (matchId, formWindowSize, h2hWindowSize) => {
      const rows = await featureRepository.listByMatchId(matchId);
      const row = rows.find((candidate) => candidate.formWindowSize === formWindowSize && candidate.h2hWindowSize === h2hWindowSize);
      return row ? mapFeatureRow(row) : undefined;
    },
    findMatchKickoffAt: async (matchId) => {
      const match = await featureRepository.findMatchById(matchId);
      return match?.scheduledStartAt ?? null;
    },
    listExistingGeneratedAt: async (matchId) => {
      if (options.ignoreExistingGeneratedAt) return [];
      const outputs = await predictionRepository.listByMatchId(matchId);
      return outputs.map((output) => output.generatedAt).filter((value): value is Date | string => value !== null && value !== undefined);
    },
    persistDrafts: (input) => persistDraftCandidates(input, predictionRepository),
    log: (message) => console.log(message)
  };
}

export function evaluatePreMatchAnalysisWindow(input: {
  kickoffAt: Date | string | null | undefined;
  evaluatedAt: Date;
  generatedAt?: Date;
  existingGeneratedAt?: Array<Date | string>;
  windowHours: number;
  minimumLeadMinutes: number;
}): FootballPredictionAnalysisWindowReport {
  const notes: string[] = [];
  const kickoff = parseDate(input.kickoffAt);
  const generatedAt = input.generatedAt ?? input.evaluatedAt;
  if (!kickoff) {
    return {
      kickoffAt: null,
      evaluatedAt: input.evaluatedAt.toISOString(),
      generatedAt: generatedAt.toISOString(),
      leadTimeMinutes: null,
      windowHours: input.windowHours,
      minimumLeadMinutes: input.minimumLeadMinutes,
      analysisWindowStatus: "unknown",
      requiresRebuild: false,
      dataCompletenessNotes: ["Kickoff time is missing; analysis window cannot be evaluated."]
    };
  }

  const minimumLeadMs = input.minimumLeadMinutes * 60 * 1000;
  const leadTimeMinutes = Math.round((kickoff.getTime() - input.evaluatedAt.getTime()) / 60000);

  let analysisWindowStatus: FootballPredictionAnalysisWindowReport["analysisWindowStatus"];
  if (kickoff.getTime() <= input.evaluatedAt.getTime() + minimumLeadMs) {
    analysisWindowStatus = "too_late";
  } else {
    analysisWindowStatus = "within_window";
  }

  if (analysisWindowStatus === "too_late") notes.push("Kickoff has passed or is inside the configured minimum lead-time cutoff.");
  if (analysisWindowStatus === "within_window") notes.push("Kickoff is outside the minimum lead-time cutoff and remains eligible for pre-match analysis.");

  return {
    kickoffAt: kickoff.toISOString(),
    evaluatedAt: input.evaluatedAt.toISOString(),
    generatedAt: generatedAt.toISOString(),
    leadTimeMinutes,
    windowHours: input.windowHours,
    minimumLeadMinutes: input.minimumLeadMinutes,
    analysisWindowStatus,
    requiresRebuild: analysisWindowStatus === "stale",
    dataCompletenessNotes: notes
  };
}

function appendAnalysisWindowWarnings(report: FootballPredictionCandidateReport, analysisWindow: FootballPredictionAnalysisWindowReport) {
  if (analysisWindow.analysisWindowStatus === "within_window") return;
  report.warnings.push(`Pre-match analysis window status: ${analysisWindow.analysisWindowStatus}. Reporting-only; generation and draft persistence are not blocked yet.`);
  report.warnings.push(...analysisWindow.dataCompletenessNotes);
}

export async function persistDraftCandidates(
  input: PersistFootballPredictionDraftsInput,
  repository: FootballPredictionOutputRepository
): Promise<PersistFootballPredictionDraftsResult> {
  const outputIds: string[] = [];
  const statusValues: string[] = [];
  const consistencyStatuses: string[] = [];
  const recommendationTiers: string[] = [];
  let conflictsPersistedCount = 0;
  let memberVisibleCount = 0;

  for (const candidate of input.report.candidates) {
    const candidateConflicts = conflictsForCandidate(candidate, input.consistency.conflicts);
    const output = await repository.upsertPredictionOutput({
      matchId: input.report.matchId,
      featureSnapshotId: input.report.featureSnapshotId,
      predictionType: candidate.prediction_type,
      predictionValue: candidate.prediction_value,
      predictionFamily: candidate.prediction_family,
      recommendationTier: candidate.recommendation_tier,
      displayLabel: candidate.display_label,
      reasoningSummary: candidate.reasoning_summary,
      confidenceScore: candidate.confidence_score,
      confidenceCeiling: numberFromMetadata(candidate.metadata.confidence_ceiling),
      riskLevel: candidate.risk_level,
      status: "draft",
      consistencyStatus: candidate.consistency_status === "unchecked" ? "warning" : candidate.consistency_status,
      consistencyCheckedAt: input.generatedAt,
      consistencySummary: input.consistency.consistencySummary,
      expectationSnapshot: input.consistency.canonicalExpectation as unknown as Record<string, unknown>,
      conflictCount: candidateConflicts.length,
      blockingConflictCount: candidateConflicts.filter((conflict) => conflict.severity === "blocking").length,
      warningConflictCount: candidateConflicts.filter((conflict) => conflict.severity === "warning").length,
      generatedAt: input.generatedAt,
      rebuildRequired: input.report.analysisWindow?.requiresRebuild ?? false,
      generationWindowStatus: input.report.analysisWindow?.analysisWindowStatus,
      generatedLeadTimeMinutes: input.report.analysisWindow?.leadTimeMinutes ?? undefined,
      metadataJson: {
        ...candidate.metadata,
        recommendationTier: candidate.recommendation_tier,
        displayLabel: candidate.display_label,
        reasoningSummary: candidate.reasoning_summary,
        analysisWindow: input.report.analysisWindow,
        draftPersistencePolicy: candidate.recommendation_tier === "avoid" ? "audit_only_blocked_not_recommended" : "draft_only_not_member_visible"
      }
    });
    if (!output?.id) continue;
    outputIds.push(output.id);
    statusValues.push(output.status ?? "draft");
    consistencyStatuses.push(output.consistencyStatus ?? candidate.consistency_status);
    recommendationTiers.push(candidate.recommendation_tier);
    if (output.status === "member_visible") memberVisibleCount += 1;

    const persistedConflicts = await repository.replaceConflictsForPrediction(
      output.id,
      candidateConflicts.map((conflict) => ({
        predictionOutputId: output.id,
        matchId: input.report.matchId,
        conflictType: conflict.conflictType,
        severity: conflict.severity,
        sourcePredictionType: conflict.sourcePredictionType,
        conflictingPredictionType: conflict.conflictingPredictionType,
        reason: conflict.reason,
        metadataJson: {
          candidatePredictionType: conflict.candidatePredictionType,
          candidatePredictionValue: conflict.candidatePredictionValue
        }
      }))
    );
    conflictsPersistedCount += persistedConflicts.length;
  }

  return {
    persistedOutputsCount: outputIds.length,
    outputIds,
    statusValues: [...new Set(statusValues)],
    consistencyStatuses: [...new Set(consistencyStatuses)],
    recommendationTiers: [...new Set(recommendationTiers)],
    conflictsPersistedCount,
    memberVisibleCount
  };
}

function conflictsForCandidate(candidate: FootballPredictionCandidate, conflicts: FootballPredictionConsistencyConflict[]) {
  return conflicts.filter((conflict) => conflict.candidatePredictionType === candidate.prediction_type && conflict.candidatePredictionValue === candidate.prediction_value);
}

function numberFromMetadata(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function mapFeatureRow(row: {
  id: string;
  matchId: string;
  featureStatus: string;
  homeFormFeatureId?: string | null;
  awayFormFeatureId?: string | null;
  h2hFeatureId?: string | null;
  homeFormCoverageScore?: number | null;
  awayFormCoverageScore?: number | null;
  h2hCoverageScore?: number | null;
  combinedCoverageScore: number;
  homeRecentPoints?: number | null;
  awayRecentPoints?: number | null;
  homeAvgGoalsFor?: number | null;
  homeAvgGoalsAgainst?: number | null;
  awayAvgGoalsFor?: number | null;
  awayAvgGoalsAgainst?: number | null;
  homeAttackStrengthProxy?: number | null;
  awayAttackStrengthProxy?: number | null;
  homeDefenseStrengthProxy?: number | null;
  awayDefenseStrengthProxy?: number | null;
  h2hAvgTotalGoals?: number | null;
  h2hBttsRate?: number | null;
  h2hOver25Rate?: number | null;
  expectedTotalGoalsProxy?: number | null;
  expectedHomeGoalsProxy?: number | null;
  expectedAwayGoalsProxy?: number | null;
  homeGoalSignalScore?: number | null;
  awayGoalSignalScore?: number | null;
  firstHalfGoalSignalScore?: number | null;
  bttsSignalScore?: number | null;
  goalProfile?: string | null;
  firstHalfGoalProfile?: string | null;
  bttsProfile?: string | null;
  homeTeamGoalProfile?: string | null;
  awayTeamGoalProfile?: string | null;
  standingsPositionDiff?: number | null;
  standingsPointsDiff?: number | null;
  standingsGoalDifferenceDiff?: number | null;
  metadataJson?: unknown;
}): FootballPredictionCandidateFeature {
  return {
    id: row.id,
    matchId: row.matchId,
    featureStatus: row.featureStatus as FootballPredictionCandidateFeature["featureStatus"],
    homeFormFeatureId: row.homeFormFeatureId,
    awayFormFeatureId: row.awayFormFeatureId,
    h2hFeatureId: row.h2hFeatureId,
    homeFormCoverageScore: row.homeFormCoverageScore,
    awayFormCoverageScore: row.awayFormCoverageScore,
    h2hCoverageScore: row.h2hCoverageScore,
    combinedCoverageScore: row.combinedCoverageScore,
    homeRecentPoints: row.homeRecentPoints,
    awayRecentPoints: row.awayRecentPoints,
    homeAvgGoalsFor: row.homeAvgGoalsFor,
    homeAvgGoalsAgainst: row.homeAvgGoalsAgainst,
    awayAvgGoalsFor: row.awayAvgGoalsFor,
    awayAvgGoalsAgainst: row.awayAvgGoalsAgainst,
    homeAttackStrengthProxy: row.homeAttackStrengthProxy,
    awayAttackStrengthProxy: row.awayAttackStrengthProxy,
    homeDefenseStrengthProxy: row.homeDefenseStrengthProxy,
    awayDefenseStrengthProxy: row.awayDefenseStrengthProxy,
    h2hAvgTotalGoals: row.h2hAvgTotalGoals,
    h2hBttsRate: row.h2hBttsRate,
    h2hOver25Rate: row.h2hOver25Rate,
    expectedTotalGoalsProxy: row.expectedTotalGoalsProxy,
    expectedHomeGoalsProxy: row.expectedHomeGoalsProxy,
    expectedAwayGoalsProxy: row.expectedAwayGoalsProxy,
    homeGoalSignalScore: row.homeGoalSignalScore,
    awayGoalSignalScore: row.awayGoalSignalScore,
    firstHalfGoalSignalScore: row.firstHalfGoalSignalScore,
    bttsSignalScore: row.bttsSignalScore,
    goalProfile: row.goalProfile as FootballPredictionCandidateFeature["goalProfile"],
    firstHalfGoalProfile: row.firstHalfGoalProfile as FootballPredictionCandidateFeature["firstHalfGoalProfile"],
    bttsProfile: row.bttsProfile as FootballPredictionCandidateFeature["bttsProfile"],
    homeTeamGoalProfile: row.homeTeamGoalProfile as FootballPredictionCandidateFeature["homeTeamGoalProfile"],
    awayTeamGoalProfile: row.awayTeamGoalProfile as FootballPredictionCandidateFeature["awayTeamGoalProfile"],
    standingsPositionDiff: row.standingsPositionDiff,
    standingsPointsDiff: row.standingsPointsDiff,
    standingsGoalDifferenceDiff: row.standingsGoalDifferenceDiff,
    metadataJson: isRecord(row.metadataJson) ? row.metadataJson : {}
  };
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

function parseDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function main() {
  const options = parseFootballPredictionCandidateArgs(process.argv.slice(2));
  validateFootballPredictionCandidateOptions(options, process.env);

  const readiness = await checkDatabaseReadiness({
    databaseUrl: process.env.DATABASE_URL,
    nodeEnv: process.env.NODE_ENV,
    dbExecutionTarget: process.env.DB_EXECUTION_TARGET,
    allowRemoteTestDb: process.env.ALLOW_REMOTE_TEST_DB,
    neonBranchName: process.env.NEON_BRANCH_NAME
  });
  if (readiness.status !== "ready") {
    throw new Error(`Database readiness check failed before football prediction candidate generation.\n${formatDatabaseReadinessResult(readiness)}`);
  }

  const database = createDatabase(process.env.DATABASE_URL!);
  await runFootballPredictionCandidateGeneration(options, createFootballPredictionCandidateDependencies(database));
}

const isDirectRun = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Football prediction candidate generation failed.");
    process.exitCode = 1;
  });
}
