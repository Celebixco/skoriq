import "dotenv/config";
import { pathToFileURL } from "node:url";
import { and, count, eq, inArray } from "drizzle-orm";
import {
  createDatabase,
  competitions,
  footballPredictionOutputs,
  FootballPredictionOutputRepository,
  matches,
  sports,
  teams
} from "@sports-data/database";
import type { Database } from "@sports-data/database";
import type { MatchStatus } from "@sports-data/shared";
import {
  createFootballH2HBuilderDependencies,
  runFootballH2HAnalytics
} from "./analytics-football-h2h-build.js";
import {
  createFootballMatchPredictionBuilderDependencies,
  runFootballMatchPredictionAnalytics
} from "./analytics-football-match-prediction-features-build.js";
import {
  createFootballMatchReasoningDependencies,
  runFootballMatchReasoning
} from "./analytics-football-reasoning-build.js";
import {
  createFootballPredictionCandidateDependencies,
  evaluatePreMatchAnalysisWindow,
  runFootballPredictionCandidateGeneration
} from "./analytics-football-prediction-candidates-generate.js";
import {
  createFootballTeamFormBuilderDependencies,
  runFootballTeamFormAnalytics
} from "./analytics-football-team-form-build.js";
import { checkDatabaseReadiness, formatDatabaseReadinessResult } from "./db-readiness.js";

export interface FootballStaleDraftRebuildOptions {
  matchId?: string;
  execute: boolean;
  windowHours: number;
  minimumLeadMinutes: number;
}

export interface FootballStaleDraftRebuildEnvironment {
  NODE_ENV?: string;
  DATABASE_URL?: string;
  DB_EXECUTION_TARGET?: string;
  ALLOW_REMOTE_TEST_DB?: string | boolean;
  NEON_BRANCH_NAME?: string;
}

export interface FootballStaleDraftMatchSummary {
  matchId: string;
  sportSlug: string;
  competitionName: string;
  homeTeamName: string;
  awayTeamName: string;
  kickoffAt: string | null;
  status: MatchStatus;
}

export interface FootballStaleDraftOutputSummary {
  predictionOutputId: string;
  predictionType: string;
  predictionValue: string;
  recommendationTier: string | null;
  status: string;
  generatedAt: string;
  generationWindowStatus: string | null;
  generatedLeadTimeMinutes: number | null;
  rebuildRequired: boolean;
  staleAt: string | null;
  rebuildReason: string | null;
  isStale: boolean;
  staleReasons: string[];
}

export interface FootballStaleDraftRebuildDependencies {
  findMatch(matchId: string): Promise<FootballStaleDraftMatchSummary | undefined>;
  listDraftOutputs(matchId: string): Promise<FootballStaleDraftOutputSummary[]>;
  runTeamForm(matchId: string): Promise<unknown>;
  runH2H(matchId: string): Promise<unknown>;
  runMatchPredictionFeatures(matchId: string): Promise<unknown>;
  runReasoning(matchId: string): Promise<unknown>;
  runCandidatePersistence(input: {
    matchId: string;
    windowHours: number;
    minimumLeadMinutes: number;
    now: Date;
  }): Promise<{
    outputIds: string[];
    persistedOutputsCount: number;
    candidatesByTier: Record<string, Array<{ predictionType: string; predictionValue: string; confidenceScore: number; consistencyStatus: string }>>;
  }>;
  updateWindowMetadataForOutputs(outputIds: string[], metadata: {
    generationWindowStatus: "within_window";
    generatedLeadTimeMinutes: number | null;
    rebuildRequired: false;
    staleAt: null;
    rebuildReason: string;
    lastRebuiltAt: Date;
  }): Promise<number>;
  countMemberVisible(matchId: string): Promise<number>;
  countPublicStatuses(matchId: string): Promise<number>;
  now?(): Date;
  log?(message: string): void;
}

export interface FootballStaleDraftRebuildReport {
  mode: "dry-run" | "execute";
  match?: FootballStaleDraftMatchSummary;
  analysisWindow: ReturnType<typeof evaluatePreMatchAnalysisWindow>;
  existingDraftCount: number;
  staleDraftCount: number;
  existingDrafts: FootballStaleDraftOutputSummary[];
  wouldRunRebuild: boolean;
  rebuildRan: boolean;
  rebuiltCandidateCount: number;
  generatedCandidatesByTier: Record<string, Array<{ predictionType: string; predictionValue: string; confidenceScore: number; consistencyStatus: string }>>;
  metadataUpdatedCount: number;
  memberVisibleCount: number;
  publicStatusCount: number;
  warnings: string[];
  blockedReasons: string[];
}

export interface FootballStaleDraftRebuildRunResult {
  mode: "dry-run" | "execute";
  report: FootballStaleDraftRebuildReport;
}

const allowedMatchStatuses = new Set<MatchStatus>(["scheduled", "not_started"]);

export function parseFootballStaleDraftRebuildArgs(argv: string[]): FootballStaleDraftRebuildOptions {
  const options: FootballStaleDraftRebuildOptions = {
    execute: false,
    windowHours: 24,
    minimumLeadMinutes: 30
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

    const [key, value] = parseFlag(arg);
    switch (key) {
      case "--match-id":
        options.matchId = requiredFlagValue(key, value);
        break;
      case "--window-hours":
        options.windowHours = parsePositiveInteger(key, value);
        break;
      case "--minimum-lead-minutes":
        options.minimumLeadMinutes = parsePositiveInteger(key, value);
        break;
      default:
        throw new Error(`Unknown football stale draft rebuild flag "${key}".`);
    }
  }

  return options;
}

export function validateFootballStaleDraftRebuildOptions(options: FootballStaleDraftRebuildOptions, env: FootballStaleDraftRebuildEnvironment) {
  if (env.NODE_ENV === "production") {
    throw new Error("Football stale draft rebuild is forbidden in production.");
  }
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for football stale draft rebuild.");
  }
  if (!options.matchId) {
    throw new Error("Football stale draft rebuild requires --match-id.");
  }
}

export async function runFootballStaleDraftRebuild(
  options: FootballStaleDraftRebuildOptions,
  dependencies: FootballStaleDraftRebuildDependencies
): Promise<FootballStaleDraftRebuildRunResult> {
  const now = dependencies.now?.() ?? new Date();
  const mode = options.execute ? "execute" : "dry-run";
  const warnings = ["Manual stale draft rebuild is local/admin-controlled only."];
  const blockedReasons: string[] = [];
  const match = await dependencies.findMatch(options.matchId!);

  if (!match) {
    blockedReasons.push("Match was not found.");
  } else {
    if (match.sportSlug !== "football") blockedReasons.push("Target match is not a football match.");
    if (!match.kickoffAt) blockedReasons.push("Target match is missing kickoff time.");
    if (!allowedMatchStatuses.has(match.status)) blockedReasons.push(`Target match status is ${match.status}; only scheduled/not_started matches can be rebuilt.`);
  }

  const analysisWindow = evaluatePreMatchAnalysisWindow({
    kickoffAt: match?.kickoffAt ?? null,
    evaluatedAt: now,
    generatedAt: now,
    windowHours: options.windowHours,
    minimumLeadMinutes: options.minimumLeadMinutes
  });

  const drafts = match ? await dependencies.listDraftOutputs(options.matchId!) : [];
  const staleDrafts = drafts.map((draft) => markDraftStaleness(draft, match?.kickoffAt ?? null, options.windowHours));
  if (analysisWindow.analysisWindowStatus !== "within_window") {
    blockedReasons.push(`Analysis window status is ${analysisWindow.analysisWindowStatus}; execute is allowed only within_window.`);
  }
  if (staleDrafts.length === 0) {
    warnings.push("No draft outputs were found for the target match.");
  }
  const staleDraftCount = staleDrafts.filter((draft) => draft.isStale).length;
  if (staleDraftCount === 0) {
    warnings.push("No stale draft outputs were detected; rebuild is not needed.");
  }

  const wouldRunRebuild = blockedReasons.length === 0 && staleDraftCount > 0;
  let rebuiltCandidateCount = 0;
  let metadataUpdatedCount = 0;
  let generatedCandidatesByTier: FootballStaleDraftRebuildReport["generatedCandidatesByTier"] = {};
  let rebuildRan = false;

  if (options.execute && wouldRunRebuild) {
    rebuildRan = true;
    await dependencies.runTeamForm(options.matchId!);
    await dependencies.runH2H(options.matchId!);
    await dependencies.runMatchPredictionFeatures(options.matchId!);
    await dependencies.runReasoning(options.matchId!);
    const persistence = await dependencies.runCandidatePersistence({
      matchId: options.matchId!,
      windowHours: options.windowHours,
      minimumLeadMinutes: options.minimumLeadMinutes,
      now
    });
    rebuiltCandidateCount = persistence.persistedOutputsCount;
    generatedCandidatesByTier = persistence.candidatesByTier;
    metadataUpdatedCount = await dependencies.updateWindowMetadataForOutputs(persistence.outputIds, {
      generationWindowStatus: "within_window",
      generatedLeadTimeMinutes: analysisWindow.leadTimeMinutes,
      rebuildRequired: false,
      staleAt: null,
      rebuildReason: "manual_stale_rebuild",
      lastRebuiltAt: now
    });
  }

  if (options.execute && !wouldRunRebuild) {
    warnings.push("Execute requested, but rebuild did not run because the match is blocked or has no stale drafts.");
  }
  if (!options.execute && wouldRunRebuild) {
    warnings.push("Dry-run only; rebuild chain was not executed and no rows were changed.");
  }

  const report: FootballStaleDraftRebuildReport = {
    mode,
    match,
    analysisWindow,
    existingDraftCount: staleDrafts.length,
    staleDraftCount,
    existingDrafts: staleDrafts,
    wouldRunRebuild,
    rebuildRan,
    rebuiltCandidateCount,
    generatedCandidatesByTier,
    metadataUpdatedCount,
    memberVisibleCount: match ? await dependencies.countMemberVisible(options.matchId!) : 0,
    publicStatusCount: match ? await dependencies.countPublicStatuses(options.matchId!) : 0,
    warnings,
    blockedReasons
  };

  const result = { mode, report };
  dependencies.log?.(JSON.stringify(result, null, 2));
  return result;
}

function createDependencies(database: Database): FootballStaleDraftRebuildDependencies {
  const predictionRepository = new FootballPredictionOutputRepository(database);

  return {
    findMatch: async (matchId) => {
      const rows = await database
        .select({
          matchId: matches.id,
          sportSlug: sports.slug,
          competitionName: competitions.name,
          homeTeamName: teams.name,
          awayTeamName: {
            name: teams.name
          },
          kickoffAt: matches.scheduledStartAt,
          status: matches.status
        })
        .from(matches)
        .innerJoin(sports, eq(matches.sportId, sports.id))
        .innerJoin(competitions, eq(matches.competitionId, competitions.id))
        .innerJoin(teams, eq(matches.homeTeamId, teams.id))
        .where(eq(matches.id, matchId))
        .limit(1);
      const row = rows[0] as unknown as {
        matchId: string;
        sportSlug: string;
        competitionName: string;
        homeTeamName: string;
        awayTeamName?: { name?: string };
        kickoffAt: Date;
        status: MatchStatus;
      } | undefined;
      if (!row) return undefined;

      const awayRows = await database
        .select({ name: teams.name })
        .from(matches)
        .innerJoin(teams, eq(matches.awayTeamId, teams.id))
        .where(eq(matches.id, matchId))
        .limit(1);

      return {
        matchId: row.matchId,
        sportSlug: row.sportSlug,
        competitionName: row.competitionName,
        homeTeamName: row.homeTeamName,
        awayTeamName: awayRows[0]?.name ?? "Unknown",
        kickoffAt: row.kickoffAt?.toISOString() ?? null,
        status: row.status
      };
    },
    listDraftOutputs: async (matchId) => {
      const rows = await predictionRepository.listByMatchId(matchId);
      return rows
        .filter((row) => row.status === "draft")
        .map((row) => ({
          predictionOutputId: row.id,
          predictionType: row.predictionType,
          predictionValue: row.predictionValue,
          recommendationTier: row.recommendationTier,
          status: row.status,
          generatedAt: row.generatedAt.toISOString(),
          generationWindowStatus: row.generationWindowStatus,
          generatedLeadTimeMinutes: row.generatedLeadTimeMinutes,
          rebuildRequired: row.rebuildRequired,
          staleAt: row.staleAt?.toISOString() ?? null,
          rebuildReason: row.rebuildReason,
          isStale: false,
          staleReasons: []
        }));
    },
    runTeamForm: async (matchId) =>
      runFootballTeamFormAnalytics(
        { execute: true, reportJson: false, matchId, allApprovedFootball: false, allowNullSeason: false, windowSizes: [5, 10], scopes: ["overall", "home", "away"] },
        { ...createFootballTeamFormBuilderDependencies(database, true), log: undefined }
      ),
    runH2H: async (matchId) =>
      runFootballH2HAnalytics(
        { execute: true, reportJson: false, matchId, allowNullSeason: false, allApprovedFootball: false, windowSizes: [5, 10] },
        { ...createFootballH2HBuilderDependencies(database, true), log: undefined }
      ),
    runMatchPredictionFeatures: async (matchId) =>
      runFootballMatchPredictionAnalytics(
        { execute: true, reportJson: false, matchId, formWindowSize: 5, h2hWindowSize: 5 },
        { ...createFootballMatchPredictionBuilderDependencies(database, true), log: undefined }
      ),
    runReasoning: async (matchId) =>
      runFootballMatchReasoning(
        { reportJson: false, matchId, formWindowSize: 5, h2hWindowSize: 5 },
        { ...createFootballMatchReasoningDependencies(database), log: undefined }
      ),
    runCandidatePersistence: async ({ matchId, windowHours, minimumLeadMinutes, now }) => {
      const result = await runFootballPredictionCandidateGeneration(
        { matchId, formWindowSize: 5, h2hWindowSize: 5, checkConsistency: true, persistDraft: true, windowHours, minimumLeadMinutes, enforceWindow: true },
        { ...createFootballPredictionCandidateDependencies(database, { ignoreExistingGeneratedAt: true }), now: () => now, log: undefined }
      );
      return {
        outputIds: result.persistence?.outputIds ?? [],
        persistedOutputsCount: result.persistence?.persistedOutputsCount ?? 0,
        candidatesByTier: groupCandidatesByTier(result.report.candidates)
      };
    },
    updateWindowMetadataForOutputs: async (outputIds, metadata) => {
      let countUpdated = 0;
      for (const outputId of outputIds) {
        const updated = await predictionRepository.updateWindowMetadata(outputId, metadata);
        if (updated) countUpdated += 1;
      }
      return countUpdated;
    },
    countMemberVisible: (matchId) => countOutputsByStatuses(database, matchId, ["member_visible"]),
    countPublicStatuses: (matchId) => countOutputsByStatuses(database, matchId, ["public_eligible", "public_published"]),
    log: (message) => console.log(message)
  };
}

function markDraftStaleness(draft: FootballStaleDraftOutputSummary, kickoffAt: string | null, windowHours: number): FootballStaleDraftOutputSummary {
  const reasons: string[] = [];
  const kickoff = parseDate(kickoffAt);
  const generatedAt = parseDate(draft.generatedAt);
  if (kickoff && generatedAt && kickoff.getTime() - generatedAt.getTime() > windowHours * 60 * 60 * 1000) {
    reasons.push("generated_before_analysis_window");
  }
  if (draft.generationWindowStatus === "stale") reasons.push("generation_window_status_stale");
  if (draft.rebuildRequired) reasons.push("rebuild_required_true");
  return {
    ...draft,
    isStale: reasons.length > 0,
    staleReasons: reasons
  };
}

function groupCandidatesByTier(candidates: Array<{ recommendation_tier: string; prediction_type: string; prediction_value: string; confidence_score: number; consistency_status: string }>) {
  return candidates.reduce<Record<string, Array<{ predictionType: string; predictionValue: string; confidenceScore: number; consistencyStatus: string }>>>((groups, candidate) => {
    groups[candidate.recommendation_tier] ??= [];
    groups[candidate.recommendation_tier]!.push({
      predictionType: candidate.prediction_type,
      predictionValue: candidate.prediction_value,
      confidenceScore: candidate.confidence_score,
      consistencyStatus: candidate.consistency_status
    });
    return groups;
  }, {});
}

async function countOutputsByStatuses(database: Database, matchId: string, statuses: string[]) {
  const rows = await database
    .select({ count: count() })
    .from(footballPredictionOutputs)
    .where(and(eq(footballPredictionOutputs.matchId, matchId), inArray(footballPredictionOutputs.status, statuses as never)));
  return normalizeCount(rows[0]?.count);
}

function normalizeCount(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") return Number(value);
  return 0;
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

async function main() {
  const options = parseFootballStaleDraftRebuildArgs(process.argv.slice(2));
  validateFootballStaleDraftRebuildOptions(options, process.env);

  const readiness = await checkDatabaseReadiness({
    databaseUrl: process.env.DATABASE_URL,
    nodeEnv: process.env.NODE_ENV,
    dbExecutionTarget: process.env.DB_EXECUTION_TARGET,
    allowRemoteTestDb: process.env.ALLOW_REMOTE_TEST_DB,
    neonBranchName: process.env.NEON_BRANCH_NAME
  });
  if (readiness.status !== "ready") {
    throw new Error(`Database readiness check failed before stale draft rebuild.\n${formatDatabaseReadinessResult(readiness)}`);
  }

  const database = createDatabase(process.env.DATABASE_URL!);
  await runFootballStaleDraftRebuild(options, createDependencies(database));
}

const isDirectRun = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Football stale draft rebuild failed.");
    process.exitCode = 1;
  });
}
