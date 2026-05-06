import "dotenv/config";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { createDatabase } from "@sports-data/database";
import { resolveFootballPrematchWindowPolicy } from "@sports-data/shared";
import type { FootballMatchPredictionFeatureInput, FootballPredictionCandidate, FootballPredictionCandidateFeature } from "@sports-data/analysis";
import { manualLeagueConfigs, providerName, resolveManualLeagueConfig } from "./apifootball-manual-league-config.js";
import type { ManualLeagueReviewConfig } from "./apifootball-manual-league-config.js";
import { checkDatabaseReadiness, formatDatabaseReadinessResult } from "./db-readiness.js";
import { createFootballTeamFormBuilderDependencies, runFootballTeamFormAnalytics } from "./analytics-football-team-form-build.js";
import { createFootballH2HBuilderDependencies, runFootballH2HAnalytics } from "./analytics-football-h2h-build.js";
import { createFootballMatchPredictionBuilderDependencies, runFootballMatchPredictionAnalytics } from "./analytics-football-match-prediction-features-build.js";
import { createFootballMatchReasoningDependencies, runFootballMatchReasoning } from "./analytics-football-reasoning-build.js";
import {
  createFootballPredictionCandidateDependencies,
  evaluatePreMatchAnalysisWindow,
  runFootballPredictionCandidateGeneration
} from "./analytics-football-prediction-candidates-generate.js";
import type { FootballPredictionCandidateRunResult } from "./analytics-football-prediction-candidates-generate.js";

const defaultLimit = 20;

export interface FootballPrematchPipelineOptions {
  countryId?: string;
  leagueId?: string;
  competitionId?: string;
  matchId?: string;
  windowHours: number;
  minimumLeadMinutes: number;
  limit: number;
  execute: boolean;
}

export interface FootballPrematchPipelineMatchTarget {
  matchId: string;
  matchLabel: string;
  kickoffAt: string;
  status: string;
  competitionId: string;
  leagueId?: string | null;
  countryId?: string | null;
}

export interface FootballPrematchPipelineMatchReport {
  matchId: string;
  matchLabel: string;
  kickoffAt: string;
  analysisWindowStatus: string;
  teamFormBuildResult?: string;
  h2hSampleSize?: number | null;
  h2hCoverageScore?: number | null;
  h2hBuildResult?: string;
  matchPredictionFeatureResult?: string;
  featureStatus?: string | null;
  combinedCoverageScore?: number | null;
  predictionEligible: boolean;
  confidenceCeiling?: number | null;
  candidates: CandidateGroups;
  consistencySummary?: string;
  candidateSummary?: string;
  candidateBlockedReasons: string[];
  candidateWarnings: string[];
  persistDraftAttempted: boolean;
  persistedCount: number;
  skipReason?: string;
  errorMessage?: string;
}

export interface CandidateGroups {
  Tahminim: CandidateSummary[];
  Denenir: CandidateSummary[];
  Alternatif: CandidateSummary[];
  UzakDur: CandidateSummary[];
}

export interface CandidateSummary {
  type: string;
  value: string;
  confidence: number;
  risk: string;
  consistency: string;
}

export interface FootballPrematchPipelineReport {
  provider: "manual-football-prematch-pipeline";
  mode: "dry-run" | "execute";
  countryId?: string;
  leagueId?: string;
  competitionId?: string;
  matchId?: string;
  windowHours: number;
  minimumLeadMinutes: number;
  limit: number;
  matches: FootballPrematchPipelineMatchReport[];
  matchesConsidered: number;
  matchesInsideWindow: number;
  processedMatches: number;
  skippedMatches: number;
  readyMatches: number;
  draftsPersisted: number;
  failedMatches: number;
  message?: string;
  safetyConfirmation: string;
  secretExposureCheck: "clean";
}

export interface FootballPrematchPipelineDependencies {
  loadMatches(options: FootballPrematchPipelineOptions, now: Date): Promise<FootballPrematchPipelineMatchTarget[]>;
  runMatchPipeline(input: { target: FootballPrematchPipelineMatchTarget; options: FootballPrematchPipelineOptions; now: Date }): Promise<FootballPrematchPipelineMatchReport>;
  log?(message: string): void;
  now?(): Date;
}

export function parseFootballPrematchPipelineArgs(argv: string[]): FootballPrematchPipelineOptions {
  const policy = resolveFootballPrematchWindowPolicy();
  const options: FootballPrematchPipelineOptions = {
    windowHours: policy.windowHours,
    minimumLeadMinutes: policy.minimumLeadMinutes,
    limit: defaultLimit,
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

    const [key, value] = parseFlag(arg);
    switch (key) {
      case "--country-id":
        options.countryId = requiredFlagValue(key, value);
        break;
      case "--league-id":
        options.leagueId = requiredFlagValue(key, value);
        break;
      case "--competition-id":
        options.competitionId = requiredFlagValue(key, value);
        break;
      case "--match-id":
        options.matchId = requiredFlagValue(key, value);
        break;
      case "--window-hours":
        options.windowHours = parsePositiveInteger(key, value);
        break;
      case "--minimum-lead-minutes":
        options.minimumLeadMinutes = parsePositiveInteger(key, value);
        break;
      case "--limit":
        options.limit = parsePositiveInteger(key, value);
        break;
      default:
        throw new Error(`Unknown football pre-match pipeline flag "${key}".`);
    }
  }

  return options;
}

export function validateFootballPrematchPipelineOptions(
  options: FootballPrematchPipelineOptions,
  env: NodeJS.ProcessEnv,
  configs: readonly ManualLeagueReviewConfig[] = manualLeagueConfigs
) {
  if (env.NODE_ENV === "production") throw new Error("Football pre-match pipeline is forbidden in production.");
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL is required for football pre-match pipeline.");
  if (options.execute && env.DB_EXECUTION_TARGET && !["local", "neon-test"].includes(env.DB_EXECUTION_TARGET)) {
    throw new Error("Football pre-match pipeline execute requires DB_EXECUTION_TARGET=local or DB_EXECUTION_TARGET=neon-test.");
  }
  if (options.matchId && (options.countryId || options.leagueId || options.competitionId)) {
    throw new Error("Football pre-match pipeline accepts --match-id alone or league/competition scope, not both.");
  }
  if (!options.matchId && !options.competitionId && !(options.countryId && options.leagueId)) {
    throw new Error("Football pre-match pipeline requires --match-id, --competition-id, or --country-id plus --league-id.");
  }
  if (options.countryId || options.leagueId) {
    if (!options.countryId || !options.leagueId) throw new Error("Football pre-match pipeline requires --country-id and --league-id together.");
    const league = resolveManualLeagueConfig(options.countryId, options.leagueId, configs);
    if (!league) throw new Error("Football pre-match pipeline is limited to configured reviewed and enabled leagues.");
    if (!league.reviewed || !league.enabled) throw new Error("Football pre-match pipeline requires reviewed=true and enabled=true.");
  }
}

export function selectMatchesInsideWindow(matches: FootballPrematchPipelineMatchTarget[], options: FootballPrematchPipelineOptions, now: Date) {
  const minimumLeadMs = options.minimumLeadMinutes * 60 * 1000;
  return matches
    .filter((match) => ["not_started", "scheduled"].includes(match.status))
    .filter((match) => {
      const kickoff = new Date(match.kickoffAt);
      if (Number.isNaN(kickoff.getTime())) return false;
      return kickoff.getTime() > now.getTime() + minimumLeadMs;
    })
    .sort((a, b) => new Date(a.kickoffAt).getTime() - new Date(b.kickoffAt).getTime())
    .slice(0, options.limit);
}

export async function runFootballPrematchPipeline(
  options: FootballPrematchPipelineOptions,
  dependencies: FootballPrematchPipelineDependencies
): Promise<FootballPrematchPipelineReport> {
  const now = dependencies.now?.() ?? new Date();
  const targets = await dependencies.loadMatches(options, now);
  const reports: FootballPrematchPipelineMatchReport[] = [];

  for (const target of targets) {
    const window = evaluatePreMatchAnalysisWindow({
      kickoffAt: target.kickoffAt,
      evaluatedAt: now,
      windowHours: options.windowHours,
      minimumLeadMinutes: options.minimumLeadMinutes
    });
    if (window.analysisWindowStatus !== "within_window") {
      reports.push({
        matchId: target.matchId,
        matchLabel: target.matchLabel,
        kickoffAt: target.kickoffAt,
        analysisWindowStatus: window.analysisWindowStatus,
        predictionEligible: false,
        candidates: emptyCandidateGroups(),
        candidateBlockedReasons: [],
        candidateWarnings: [],
        persistDraftAttempted: false,
        persistedCount: 0,
        skipReason: `Match is outside the pre-match window: ${window.analysisWindowStatus}.`
      });
      continue;
    }

    try {
      reports.push(await dependencies.runMatchPipeline({ target, options, now }));
    } catch (error) {
      reports.push({
        matchId: target.matchId,
        matchLabel: target.matchLabel,
        kickoffAt: target.kickoffAt,
        analysisWindowStatus: window.analysisWindowStatus,
        predictionEligible: false,
        candidates: emptyCandidateGroups(),
        candidateBlockedReasons: [],
        candidateWarnings: [],
        persistDraftAttempted: false,
        persistedCount: 0,
        errorMessage: sanitizeErrorMessage(error instanceof Error ? error.message : "Football pre-match pipeline match failed.")
      });
    }
  }

  const report: FootballPrematchPipelineReport = {
    provider: "manual-football-prematch-pipeline",
    mode: options.execute ? "execute" : "dry-run",
    countryId: options.countryId,
    leagueId: options.leagueId,
    competitionId: options.competitionId,
    matchId: options.matchId,
    windowHours: options.windowHours,
    minimumLeadMinutes: options.minimumLeadMinutes,
    limit: options.limit,
    matches: reports,
    matchesConsidered: reports.length,
    matchesInsideWindow: reports.filter((report) => report.analysisWindowStatus === "within_window").length,
    processedMatches: reports.filter((report) => !report.skipReason && !report.errorMessage).length,
    skippedMatches: reports.filter((report) => Boolean(report.skipReason)).length,
    readyMatches: reports.filter((report) => report.featureStatus === "ready").length,
    draftsPersisted: reports.reduce((sum, report) => sum + report.persistedCount, 0),
    failedMatches: reports.filter((report) => Boolean(report.errorMessage)).length,
    message: reports.length === 0 ? "No matches inside pre-match window." : undefined,
    safetyConfirmation: "No provider, ingestion, settlement, public/member-visible, or tahmin kombini flows were run.",
    secretExposureCheck: "clean"
  };

  if (reports.length === 0) report.message = "No matches inside pre-match window.";
  dependencies.log?.(JSON.stringify(report, null, 2));
  return report;
}

export async function loadPrematchMatchesFromDb(pool: pg.Pool, options: FootballPrematchPipelineOptions, now: Date): Promise<FootballPrematchPipelineMatchTarget[]> {
  const rows = options.matchId ? await loadSingleMatch(pool, options.matchId) : await loadScopedMatches(pool, options, now);
  return options.matchId ? rows : selectMatchesInsideWindow(rows, options, now);
}

export function createPrematchMatchPipelineRunner(databaseUrl: string) {
  const database = createDatabase(databaseUrl);
  const candidateDeps = createFootballPredictionCandidateDependencies(database);
  const reasoningDeps = createFootballMatchReasoningDependencies(database);

  return async ({ target, options }: { target: FootballPrematchPipelineMatchTarget; options: FootballPrematchPipelineOptions; now: Date }) => {
    const noop = () => undefined;
    const teamFormDeps = createFootballTeamFormBuilderDependencies(database, options.execute);
    const h2hDeps = createFootballH2HBuilderDependencies(database, options.execute);
    const matchFeatureDeps = createFootballMatchPredictionBuilderDependencies(database, options.execute);
    const teamForm = await runFootballTeamFormAnalytics(
      { execute: options.execute, reportJson: false, matchId: target.matchId, allApprovedFootball: false, allowNullSeason: false, windowSizes: [5, 10], scopes: ["overall", "home", "away"] },
      { ...teamFormDeps, log: noop }
    );
    const h2h = await runFootballH2HAnalytics(
      { execute: options.execute, reportJson: false, matchId: target.matchId, allowNullSeason: false, allApprovedFootball: false, windowSizes: [5, 10] },
      { ...h2hDeps, log: noop }
    );
    const matchFeature = await runFootballMatchPredictionAnalytics(
      { execute: options.execute, reportJson: false, matchId: target.matchId, formWindowSize: 5, h2hWindowSize: 5 },
      { ...matchFeatureDeps, log: noop }
    );
    const dryRunCalculatedFeature = options.execute ? undefined : (await matchFeatureDeps.buildForMatch(target.matchId, { formWindowSize: 5, h2hWindowSize: 5 })).calculatedFeatures[0];
    await runFootballMatchReasoning({ matchId: target.matchId, formWindowSize: 5, h2hWindowSize: 5, reportJson: false }, { ...reasoningDeps, log: noop });
    const candidatePlanningDeps = options.execute
      ? candidateDeps
      : {
          ...candidateDeps,
          findFeature: async (matchId: string, formWindowSize: number, h2hWindowSize: number) => {
            if (dryRunCalculatedFeature && dryRunCalculatedFeature.matchId === matchId && dryRunCalculatedFeature.formWindowSize === formWindowSize && dryRunCalculatedFeature.h2hWindowSize === h2hWindowSize) {
              return mapCalculatedFeatureForCandidates(dryRunCalculatedFeature);
            }
            return candidateDeps.findFeature(matchId, formWindowSize, h2hWindowSize);
          }
        };
    const candidate = await runFootballPredictionCandidateGeneration(
      {
        matchId: target.matchId,
        formWindowSize: 5,
        h2hWindowSize: 5,
        checkConsistency: true,
        persistDraft: false,
        windowHours: options.windowHours,
        minimumLeadMinutes: options.minimumLeadMinutes,
        enforceWindow: false
      },
      { ...candidatePlanningDeps, log: noop }
    );

    const feature = matchFeature.report;
    const featureStatus = Object.entries(feature.feature_status_counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const h2hFeature = h2h.report;
    const canPersist = shouldPersistDraftForCandidateRun({ execute: options.execute, featureStatus, candidate });
    const persistence = canPersist
      ? await runFootballPredictionCandidateGeneration(
          {
            matchId: target.matchId,
            formWindowSize: 5,
            h2hWindowSize: 5,
            checkConsistency: true,
            persistDraft: true,
            windowHours: options.windowHours,
            minimumLeadMinutes: options.minimumLeadMinutes,
            enforceWindow: true
          },
          { ...candidateDeps, log: noop }
        )
      : undefined;

    return buildMatchReport({
      target,
      candidate,
      teamFormResult: teamForm.report.result,
      h2hResult: h2hFeature.result,
      h2hFeatures: h2hFeature,
      matchFeatureResult: feature.result,
      featureStatus,
      combinedCoverageScore: feature.combined_coverage_scores[0] ?? null,
      persistedCount: persistence?.persistence?.persistedOutputsCount ?? 0,
      persistDraftAttempted: Boolean(canPersist)
    });
  };
}

function buildMatchReport(input: {
  target: FootballPrematchPipelineMatchTarget;
  candidate: FootballPredictionCandidateRunResult;
  teamFormResult: string;
  h2hResult: string;
  h2hFeatures: { features_calculated: number; sample_sizes?: number[]; coverage_scores?: number[]; result: string };
  matchFeatureResult: string;
  featureStatus: string | null;
  combinedCoverageScore: number | null;
  persistedCount: number;
  persistDraftAttempted: boolean;
}): FootballPrematchPipelineMatchReport {
  const candidates = groupCandidates(input.candidate.report.candidates);
  return {
    matchId: input.target.matchId,
    matchLabel: input.target.matchLabel,
    kickoffAt: input.target.kickoffAt,
    analysisWindowStatus: input.candidate.report.analysisWindow?.analysisWindowStatus ?? "unknown",
    teamFormBuildResult: input.teamFormResult,
    h2hSampleSize: input.h2hFeatures.sample_sizes?.[0] ?? null,
    h2hCoverageScore: input.h2hFeatures.coverage_scores?.[0] ?? null,
    h2hBuildResult: input.h2hResult,
    matchPredictionFeatureResult: input.matchFeatureResult,
    featureStatus: input.featureStatus,
    combinedCoverageScore: input.combinedCoverageScore,
    predictionEligible: input.featureStatus === "ready",
    confidenceCeiling: confidenceCeiling(input.candidate.report.candidates),
    candidates,
    consistencySummary: input.candidate.report.consistencySummary,
    candidateSummary: input.candidate.report.summary,
    candidateBlockedReasons: input.candidate.report.blockedReasons,
    candidateWarnings: input.candidate.report.warnings,
    persistDraftAttempted: input.persistDraftAttempted,
    persistedCount: input.persistedCount,
    skipReason: input.featureStatus !== "ready" ? "Feature status is not ready; draft persistence blocked." : undefined
  };
}

export function mapCalculatedFeatureForCandidates(feature: FootballMatchPredictionFeatureInput): FootballPredictionCandidateFeature {
  return {
    id: "dry-run-calculated-feature",
    matchId: feature.matchId,
    featureStatus: feature.featureStatus,
    homeFormFeatureId: feature.homeFormFeatureId,
    awayFormFeatureId: feature.awayFormFeatureId,
    h2hFeatureId: feature.h2hFeatureId,
    homeFormCoverageScore: feature.homeFormCoverageScore,
    awayFormCoverageScore: feature.awayFormCoverageScore,
    h2hCoverageScore: feature.h2hCoverageScore,
    combinedCoverageScore: feature.combinedCoverageScore,
    homeRecentPoints: feature.homeRecentPoints,
    awayRecentPoints: feature.awayRecentPoints,
    homeAvgGoalsFor: feature.homeAvgGoalsFor,
    homeAvgGoalsAgainst: feature.homeAvgGoalsAgainst,
    awayAvgGoalsFor: feature.awayAvgGoalsFor,
    awayAvgGoalsAgainst: feature.awayAvgGoalsAgainst,
    homeAttackStrengthProxy: feature.homeAttackStrengthProxy,
    awayAttackStrengthProxy: feature.awayAttackStrengthProxy,
    homeDefenseStrengthProxy: feature.homeDefenseStrengthProxy,
    awayDefenseStrengthProxy: feature.awayDefenseStrengthProxy,
    h2hAvgTotalGoals: feature.h2hAvgTotalGoals,
    h2hBttsRate: feature.h2hBttsRate,
    h2hOver25Rate: feature.h2hOver25Rate,
    expectedTotalGoalsProxy: feature.expectedTotalGoalsProxy,
    expectedHomeGoalsProxy: feature.expectedHomeGoalsProxy,
    expectedAwayGoalsProxy: feature.expectedAwayGoalsProxy,
    homeGoalSignalScore: feature.homeGoalSignalScore,
    awayGoalSignalScore: feature.awayGoalSignalScore,
    firstHalfGoalSignalScore: feature.firstHalfGoalSignalScore,
    bttsSignalScore: feature.bttsSignalScore,
    goalProfile: feature.goalProfile,
    firstHalfGoalProfile: feature.firstHalfGoalProfile,
    bttsProfile: feature.bttsProfile,
    homeTeamGoalProfile: feature.homeTeamGoalProfile,
    awayTeamGoalProfile: feature.awayTeamGoalProfile,
    standingsPositionDiff: feature.standingsPositionDiff,
    standingsPointsDiff: feature.standingsPointsDiff,
    standingsGoalDifferenceDiff: feature.standingsGoalDifferenceDiff,
    metadataJson: feature.metadataJson
  };
}

export function shouldPersistDraftForCandidateRun(input: { execute: boolean; featureStatus: string | null; candidate: FootballPredictionCandidateRunResult }) {
  return (
    input.execute &&
    input.featureStatus === "ready" &&
    input.candidate.report.analysisWindow?.analysisWindowStatus === "within_window" &&
    input.candidate.report.candidates.some(isRecommendationCandidate)
  );
}

function isRecommendationCandidate(candidate: FootballPredictionCandidate) {
  return ["primary", "try", "alternative"].includes(candidate.recommendation_tier) && ["passed", "warning", "unchecked"].includes(candidate.consistency_status);
}

function groupCandidates(candidates: FootballPredictionCandidate[]): CandidateGroups {
  const groups = emptyCandidateGroups();
  for (const candidate of candidates) {
    const summary = {
      type: candidate.prediction_type,
      value: candidate.prediction_value,
      confidence: candidate.confidence_score,
      risk: candidate.risk_level,
      consistency: candidate.consistency_status
    };
    if (candidate.recommendation_tier === "primary") groups.Tahminim.push(summary);
    else if (candidate.recommendation_tier === "try") groups.Denenir.push(summary);
    else if (candidate.recommendation_tier === "alternative") groups.Alternatif.push(summary);
    else groups.UzakDur.push(summary);
  }
  return groups;
}

function emptyCandidateGroups(): CandidateGroups {
  return { Tahminim: [], Denenir: [], Alternatif: [], UzakDur: [] };
}

function confidenceCeiling(candidates: FootballPredictionCandidate[]) {
  for (const candidate of candidates) {
    const value = candidate.metadata?.confidence_ceiling;
    if (typeof value === "number") return value;
  }
  return null;
}

async function loadSingleMatch(pool: pg.Pool, matchId: string) {
  const result = await pool.query<FootballPrematchPipelineMatchTarget>(
    `
      select
        m.id as "matchId",
        concat(home.name, ' vs ', away.name) as "matchLabel",
        m.scheduled_start_at::text as "kickoffAt",
        m.status::text as "status",
        m.competition_id as "competitionId",
        league_pm.provider_entity_id as "leagueId",
        country_pm.provider_entity_id as "countryId"
      from matches m
      join teams home on home.id = m.home_team_id
      join teams away on away.id = m.away_team_id
      join competitions c on c.id = m.competition_id
      left join provider_mappings league_pm
        on league_pm.provider = $2
       and league_pm.entity_type = 'competition'
       and league_pm.internal_entity_id = m.competition_id
      left join provider_mappings country_pm
        on country_pm.provider = $2
       and country_pm.entity_type = 'country'
       and country_pm.internal_entity_id = c.country_id
      where m.id = $1
      limit 1
    `,
    [matchId, providerName]
  );
  return result.rows;
}

async function loadScopedMatches(pool: pg.Pool, options: FootballPrematchPipelineOptions, now: Date) {
  const minimumStart = new Date(now.getTime() + options.minimumLeadMinutes * 60 * 1000);
  const windowEnd = new Date(now.getTime() + options.windowHours * 60 * 60 * 1000);
  const params: unknown[] = [providerName, minimumStart.toISOString(), windowEnd.toISOString(), options.limit];
  const conditions = ["m.status in ('not_started', 'scheduled')", "m.scheduled_start_at > $2", "m.scheduled_start_at <= $3"];
  if (options.competitionId) {
    params.push(options.competitionId);
    conditions.push(`m.competition_id = $${params.length}`);
  }
  if (options.leagueId) {
    params.push(options.leagueId);
    conditions.push(`league_pm.provider_entity_id = $${params.length}`);
  }
  if (options.countryId) {
    params.push(options.countryId);
    conditions.push(`country_pm.provider_entity_id = $${params.length}`);
  }

  const result = await pool.query<FootballPrematchPipelineMatchTarget>(
    `
      select
        m.id as "matchId",
        concat(home.name, ' vs ', away.name) as "matchLabel",
        m.scheduled_start_at::text as "kickoffAt",
        m.status::text as "status",
        m.competition_id as "competitionId",
        league_pm.provider_entity_id as "leagueId",
        country_pm.provider_entity_id as "countryId"
      from matches m
      join teams home on home.id = m.home_team_id
      join teams away on away.id = m.away_team_id
      join competitions c on c.id = m.competition_id
      join provider_mappings league_pm
        on league_pm.provider = $1
       and league_pm.entity_type = 'competition'
       and league_pm.internal_entity_id = m.competition_id
      left join provider_mappings country_pm
        on country_pm.provider = $1
       and country_pm.entity_type = 'country'
       and country_pm.internal_entity_id = c.country_id
      where ${conditions.join(" and ")}
      order by m.scheduled_start_at asc
      limit $4
    `,
    params
  );
  return result.rows;
}

export function assertReviewedTargets(targets: FootballPrematchPipelineMatchTarget[], configs: readonly ManualLeagueReviewConfig[] = manualLeagueConfigs) {
  for (const target of targets) {
    const league = target.countryId && target.leagueId ? resolveManualLeagueConfig(target.countryId, target.leagueId, configs) : undefined;
    if (!league) throw new Error(`Football pre-match pipeline target ${target.matchId} is not mapped to a configured reviewed/enabled APIFootball league.`);
    if (!league.reviewed || !league.enabled) throw new Error(`Football pre-match pipeline target ${target.matchId} is not reviewed=true and enabled=true.`);
  }
}

function parseFlag(arg: string): [string, string | undefined] {
  const index = arg.indexOf("=");
  return index === -1 ? [arg, undefined] : [arg.slice(0, index), arg.slice(index + 1)];
}

function requiredFlagValue(flag: string, value: string | undefined) {
  if (!value) throw new Error(`Flag ${flag} requires a value.`);
  return value;
}

function parsePositiveInteger(flag: string, value: string | undefined) {
  const parsed = Number(requiredFlagValue(flag, value));
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${flag} must be a positive integer.`);
  return parsed;
}

function sanitizeErrorMessage(message: string) {
  return message.replace(/APIkey=[^&\s]+/gi, "APIkey=<redacted>").replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "DATABASE_URL=<redacted>");
}

async function main() {
  const options = parseFootballPrematchPipelineArgs(process.argv.slice(2));
  validateFootballPrematchPipelineOptions(options, process.env);
  const readiness = await checkDatabaseReadiness({
    databaseUrl: process.env.DATABASE_URL,
    nodeEnv: process.env.NODE_ENV,
    dbExecutionTarget: process.env.DB_EXECUTION_TARGET,
    allowRemoteTestDb: process.env.ALLOW_REMOTE_TEST_DB,
    neonBranchName: process.env.NEON_BRANCH_NAME
  });
  if (readiness.status !== "ready") {
    throw new Error(`Database readiness check failed before football pre-match pipeline.\n${formatDatabaseReadinessResult(readiness)}`);
  }

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const now = new Date();
    const targets = await loadPrematchMatchesFromDb(pool, options, now);
    assertReviewedTargets(targets);
    await runFootballPrematchPipeline(options, {
      now: () => now,
      loadMatches: async () => targets,
      runMatchPipeline: createPrematchMatchPipelineRunner(process.env.DATABASE_URL!),
      log: (message) => console.log(message)
    });
  } finally {
    await pool.end();
  }
}

const isDirectRun = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? sanitizeErrorMessage(error.message) : "Football pre-match pipeline failed.");
    process.exitCode = 1;
  });
}
