import type { MatchStatus } from "@sports-data/shared";
import { canonicalizePair } from "./football-head-to-head-feature-builder.js";
import type { AnalysisFeatureBuilder, AnalysisFeatureBuildRequest, AnalysisFeatureBuildResult } from "./feature-builder.js";

const DEFAULT_FORM_WINDOW_SIZE = 5;
const DEFAULT_H2H_WINDOW_SIZE = 5;

export type FootballMatchPredictionFeatureStatus = "ready" | "partial" | "insufficient_data";
export type FootballGoalProfile = "low_goal" | "medium_goal" | "high_goal" | "unknown";
export type FootballFirstHalfGoalProfile = "low_goal" | "likely_goal" | "unknown";
export type FootballBttsProfile = "yes_lean" | "no_lean" | "balanced" | "unknown";
export type FootballTeamGoalProfile = "weak" | "moderate" | "strong" | "unknown";

export interface FootballPredictionMatch {
  id: string;
  competitionId: string;
  seasonId?: string | null;
  scheduledStartAt: Date;
  status: MatchStatus;
  homeTeamId: string;
  awayTeamId: string;
}

export interface FootballPredictionTeamFormFeature {
  id: string;
  teamId: string;
  competitionId?: string | null;
  seasonId?: string | null;
  asOfMatchId?: string | null;
  asOfDate: Date;
  windowSize: number;
  scope: "overall" | "home" | "away";
  points: number;
  avgGoalsFor?: number | null;
  avgGoalsAgainst?: number | null;
  scoredRate?: number | null;
  concededRate?: number | null;
  teamOver05Rate?: number | null;
  teamOver15Rate?: number | null;
  under25Rate?: number | null;
  firstHalfOver05Rate?: number | null;
  firstHalfAvgGoalsFor?: number | null;
  firstHalfAvgGoalsAgainst?: number | null;
  avgShots?: number | null;
  avgExpectedGoals?: number | null;
  standingsPosition?: number | null;
  standingsPoints?: number | null;
  standingsGoalDifference?: number | null;
  sampleSize: number;
  coverageScore: number;
}

export interface FootballPredictionH2HFeature {
  id: string;
  teamAId: string;
  teamBId: string;
  competitionId?: string | null;
  seasonId?: string | null;
  asOfMatchId?: string | null;
  asOfDate: Date;
  windowSize: number;
  avgTotalGoals?: number | null;
  bothTeamsToScoreRate?: number | null;
  over25Rate?: number | null;
  sampleSize: number;
  coverageScore: number;
}

export interface FootballMatchPredictionFeatureInput {
  matchId: string;
  competitionId: string;
  seasonId?: string | null;
  homeTeamId: string;
  awayTeamId: string;
  asOfDate: Date;
  formWindowSize: number;
  h2hWindowSize: number;
  homeFormFeatureId?: string;
  awayFormFeatureId?: string;
  h2hFeatureId?: string;
  homeFormCoverageScore?: number;
  awayFormCoverageScore?: number;
  h2hCoverageScore?: number;
  combinedCoverageScore: number;
  homeRecentPoints?: number;
  awayRecentPoints?: number;
  homeAvgGoalsFor?: number;
  homeAvgGoalsAgainst?: number;
  awayAvgGoalsFor?: number;
  awayAvgGoalsAgainst?: number;
  homeAttackStrengthProxy?: number;
  awayAttackStrengthProxy?: number;
  homeDefenseStrengthProxy?: number;
  awayDefenseStrengthProxy?: number;
  h2hAvgTotalGoals?: number;
  h2hBttsRate?: number;
  h2hOver25Rate?: number;
  expectedTotalGoalsProxy?: number;
  expectedHomeGoalsProxy?: number;
  expectedAwayGoalsProxy?: number;
  homeGoalSignalScore?: number;
  awayGoalSignalScore?: number;
  firstHalfGoalSignalScore?: number;
  bttsSignalScore?: number;
  goalProfile?: FootballGoalProfile;
  firstHalfGoalProfile?: FootballFirstHalfGoalProfile;
  bttsProfile?: FootballBttsProfile;
  homeTeamGoalProfile?: FootballTeamGoalProfile;
  awayTeamGoalProfile?: FootballTeamGoalProfile;
  standingsPositionDiff?: number;
  standingsPointsDiff?: number;
  standingsGoalDifferenceDiff?: number;
  featureStatus: FootballMatchPredictionFeatureStatus;
  metadataJson?: Record<string, unknown>;
}

export interface FindFootballPredictionTeamFormFeatureInput {
  teamId: string;
  competitionId: string;
  seasonId?: string | null;
  asOfMatchId: string;
  asOfDate: Date;
  windowSize: number;
  scope: "home" | "away";
}

export interface FindFootballPredictionH2HFeatureInput {
  teamAId: string;
  teamBId: string;
  competitionId: string;
  seasonId?: string | null;
  asOfMatchId: string;
  asOfDate: Date;
  windowSize: number;
}

export interface FootballMatchPredictionFeatureRepository {
  upsertFeature(input: FootballMatchPredictionFeatureInput): Promise<unknown>;
}

export interface FootballMatchPredictionSourceRepository {
  findMatchById(matchId: string): Promise<FootballPredictionMatch | undefined>;
  findBestTeamFormFeature(input: FindFootballPredictionTeamFormFeatureInput): Promise<FootballPredictionTeamFormFeature | undefined>;
  findBestHeadToHeadFeature(input: FindFootballPredictionH2HFeatureInput): Promise<FootballPredictionH2HFeature | undefined>;
}

export interface FootballMatchPredictionFeatureBuilderRepositories {
  features: FootballMatchPredictionFeatureRepository;
  sources: FootballMatchPredictionSourceRepository;
}

export interface BuildFootballMatchPredictionFeatureOptions {
  formWindowSize?: number;
  h2hWindowSize?: number;
}

export class FootballMatchPredictionFeatureBuilder implements AnalysisFeatureBuilder {
  constructor(private readonly repositories: FootballMatchPredictionFeatureBuilderRepositories) {}

  async build(request: AnalysisFeatureBuildRequest): Promise<AnalysisFeatureBuildResult> {
    if (!request.matchId) {
      return { changedFeatureRows: 0, skippedReason: "matchId is required for football match prediction feature snapshots" };
    }
    return this.buildForMatch(request.matchId);
  }

  async buildForMatch(matchId: string, options: BuildFootballMatchPredictionFeatureOptions = {}): Promise<AnalysisFeatureBuildResult> {
    const match = await this.repositories.sources.findMatchById(matchId);
    if (!match) {
      return { changedFeatureRows: 0, skippedReason: `match "${matchId}" not found` };
    }

    const feature = await this.calculateForMatch(match, {
      formWindowSize: options.formWindowSize ?? DEFAULT_FORM_WINDOW_SIZE,
      h2hWindowSize: options.h2hWindowSize ?? DEFAULT_H2H_WINDOW_SIZE
    });
    await this.repositories.features.upsertFeature(feature);

    return { changedFeatureRows: 1 };
  }

  async calculateForMatch(match: FootballPredictionMatch, options: Required<BuildFootballMatchPredictionFeatureOptions>): Promise<FootballMatchPredictionFeatureInput> {
    const seasonId = match.seasonId ?? null;
    const homeForm = await this.repositories.sources.findBestTeamFormFeature({
      teamId: match.homeTeamId,
      competitionId: match.competitionId,
      seasonId,
      asOfMatchId: match.id,
      asOfDate: match.scheduledStartAt,
      windowSize: options.formWindowSize,
      scope: "home"
    });
    const awayForm = await this.repositories.sources.findBestTeamFormFeature({
      teamId: match.awayTeamId,
      competitionId: match.competitionId,
      seasonId,
      asOfMatchId: match.id,
      asOfDate: match.scheduledStartAt,
      windowSize: options.formWindowSize,
      scope: "away"
    });
    const pair = canonicalizePair(match.homeTeamId, match.awayTeamId);
    const h2h = await this.repositories.sources.findBestHeadToHeadFeature({
      teamAId: pair.teamAId,
      teamBId: pair.teamBId,
      competitionId: match.competitionId,
      seasonId,
      asOfMatchId: match.id,
      asOfDate: match.scheduledStartAt,
      windowSize: options.h2hWindowSize
    });

    return calculateFootballMatchPredictionFeature({
      match,
      homeForm,
      awayForm,
      h2h,
      formWindowSize: options.formWindowSize,
      h2hWindowSize: options.h2hWindowSize
    });
  }
}

export interface CalculateFootballMatchPredictionFeatureInput {
  match: FootballPredictionMatch;
  homeForm?: FootballPredictionTeamFormFeature;
  awayForm?: FootballPredictionTeamFormFeature;
  h2h?: FootballPredictionH2HFeature;
  formWindowSize: number;
  h2hWindowSize: number;
}

export function calculateFootballMatchPredictionFeature(input: CalculateFootballMatchPredictionFeatureInput): FootballMatchPredictionFeatureInput {
  const { match, homeForm, awayForm, h2h } = input;
  const h2hHasSamples = (h2h?.sampleSize ?? 0) > 0;
  const h2hMissing = !h2hHasSamples;
  const combinedCoverageScore = calculateCombinedCoverageScore(homeForm, awayForm, h2h);
  const featureStatus = resolveFeatureStatus(homeForm, awayForm, h2h, combinedCoverageScore);
  const goalProfile = calculateMatchGoalProfile(homeForm, awayForm);

  return {
    matchId: match.id,
    competitionId: match.competitionId,
    seasonId: match.seasonId ?? null,
    homeTeamId: match.homeTeamId,
    awayTeamId: match.awayTeamId,
    asOfDate: match.scheduledStartAt,
    formWindowSize: input.formWindowSize,
    h2hWindowSize: input.h2hWindowSize,
    homeFormFeatureId: homeForm?.id,
    awayFormFeatureId: awayForm?.id,
    h2hFeatureId: h2h?.id,
    homeFormCoverageScore: homeForm?.coverageScore,
    awayFormCoverageScore: awayForm?.coverageScore,
    h2hCoverageScore: h2h?.coverageScore,
    combinedCoverageScore,
    homeRecentPoints: homeForm?.points,
    awayRecentPoints: awayForm?.points,
    homeAvgGoalsFor: valueOrUndefined(homeForm?.avgGoalsFor),
    homeAvgGoalsAgainst: valueOrUndefined(homeForm?.avgGoalsAgainst),
    awayAvgGoalsFor: valueOrUndefined(awayForm?.avgGoalsFor),
    awayAvgGoalsAgainst: valueOrUndefined(awayForm?.avgGoalsAgainst),
    homeAttackStrengthProxy: attackProxy(homeForm),
    awayAttackStrengthProxy: attackProxy(awayForm),
    homeDefenseStrengthProxy: valueOrUndefined(homeForm?.avgGoalsAgainst),
    awayDefenseStrengthProxy: valueOrUndefined(awayForm?.avgGoalsAgainst),
    h2hAvgTotalGoals: valueOrUndefined(h2h?.avgTotalGoals),
    h2hBttsRate: valueOrUndefined(h2h?.bothTeamsToScoreRate),
    h2hOver25Rate: valueOrUndefined(h2h?.over25Rate),
    expectedTotalGoalsProxy: goalProfile.expectedTotalGoalsProxy,
    expectedHomeGoalsProxy: goalProfile.expectedHomeGoalsProxy,
    expectedAwayGoalsProxy: goalProfile.expectedAwayGoalsProxy,
    homeGoalSignalScore: goalProfile.homeGoalSignalScore,
    awayGoalSignalScore: goalProfile.awayGoalSignalScore,
    firstHalfGoalSignalScore: goalProfile.firstHalfGoalSignalScore,
    bttsSignalScore: goalProfile.bttsSignalScore,
    goalProfile: goalProfile.goalProfile,
    firstHalfGoalProfile: goalProfile.firstHalfGoalProfile,
    bttsProfile: goalProfile.bttsProfile,
    homeTeamGoalProfile: goalProfile.homeTeamGoalProfile,
    awayTeamGoalProfile: goalProfile.awayTeamGoalProfile,
    standingsPositionDiff: diff(homeForm?.standingsPosition, awayForm?.standingsPosition),
    standingsPointsDiff: diff(homeForm?.standingsPoints, awayForm?.standingsPoints),
    standingsGoalDifferenceDiff: diff(homeForm?.standingsGoalDifference, awayForm?.standingsGoalDifference),
    featureStatus,
    metadataJson: {
      builder: "football_match_prediction_features",
      calculationVersion: 2,
      note: "Feature snapshot only; no prediction, score output, odds, or betting pick is generated.",
      coverageFormula: h2hHasSamples ? "weighted_team_form_h2h" : "team_form_only_h2h_missing",
      h2hMissing,
      goalProfileFormulaVersion: 1,
      goalProfileInputs: goalProfile.inputs,
      ...(h2hMissing ? { confidenceCapReason: "missing_h2h" } : {}),
      sourceFeatureIds: {
        homeFormFeatureId: homeForm?.id,
        awayFormFeatureId: awayForm?.id,
        h2hFeatureId: h2h?.id
      },
      sampleSizes: {
        homeForm: homeForm?.sampleSize ?? 0,
        awayForm: awayForm?.sampleSize ?? 0,
        h2h: h2h?.sampleSize ?? 0
      }
    }
  };
}

interface MatchGoalProfileResult {
  expectedTotalGoalsProxy?: number;
  expectedHomeGoalsProxy?: number;
  expectedAwayGoalsProxy?: number;
  homeGoalSignalScore?: number;
  awayGoalSignalScore?: number;
  firstHalfGoalSignalScore?: number;
  bttsSignalScore?: number;
  goalProfile: FootballGoalProfile;
  firstHalfGoalProfile: FootballFirstHalfGoalProfile;
  bttsProfile: FootballBttsProfile;
  homeTeamGoalProfile: FootballTeamGoalProfile;
  awayTeamGoalProfile: FootballTeamGoalProfile;
  inputs: Record<string, unknown>;
}

function calculateMatchGoalProfile(homeForm: FootballPredictionTeamFormFeature | undefined, awayForm: FootballPredictionTeamFormFeature | undefined): MatchGoalProfileResult {
  const homeGoalSignalScore = calculateTeamGoalSignalScore(homeForm, awayForm);
  const awayGoalSignalScore = calculateTeamGoalSignalScore(awayForm, homeForm);
  const expectedHomeGoalsProxy = calculateExpectedTeamGoalsProxy(homeForm, awayForm);
  const expectedAwayGoalsProxy = calculateExpectedTeamGoalsProxy(awayForm, homeForm);
  const expectedTotalGoalsProxy =
    expectedHomeGoalsProxy !== undefined && expectedAwayGoalsProxy !== undefined ? round(expectedHomeGoalsProxy + expectedAwayGoalsProxy, 3) : undefined;
  const firstHalfGoalSignalScore = calculateFirstHalfGoalSignalScore(homeForm, awayForm);
  const bttsSignalScore = calculateBttsSignalScore(homeForm, awayForm);
  const homeTeamGoalProfile = resolveTeamGoalProfile(homeGoalSignalScore);
  const awayTeamGoalProfile = resolveTeamGoalProfile(awayGoalSignalScore);

  return {
    expectedTotalGoalsProxy,
    expectedHomeGoalsProxy,
    expectedAwayGoalsProxy,
    homeGoalSignalScore,
    awayGoalSignalScore,
    firstHalfGoalSignalScore,
    bttsSignalScore,
    goalProfile: resolveGoalProfile(expectedTotalGoalsProxy, homeTeamGoalProfile, awayTeamGoalProfile),
    firstHalfGoalProfile: resolveFirstHalfGoalProfile(firstHalfGoalSignalScore),
    bttsProfile: resolveBttsProfile(bttsSignalScore, homeForm, awayForm),
    homeTeamGoalProfile,
    awayTeamGoalProfile,
    inputs: {
      home: summarizeGoalInputs(homeForm),
      away: summarizeGoalInputs(awayForm)
    }
  };
}

function calculateTeamGoalSignalScore(
  teamForm: FootballPredictionTeamFormFeature | undefined,
  opponentForm: FootballPredictionTeamFormFeature | undefined
): number | undefined {
  const teamOver05 = valueOrUndefined(teamForm?.teamOver05Rate);
  const teamOver15 = valueOrUndefined(teamForm?.teamOver15Rate);
  const opponentConceded = valueOrUndefined(opponentForm?.concededRate);
  if (teamOver05 === undefined || teamOver15 === undefined || opponentConceded === undefined) {
    return undefined;
  }

  return round(teamOver05 * 0.35 + teamOver15 * 0.25 + opponentConceded * 0.4, 2);
}

function calculateExpectedTeamGoalsProxy(
  teamForm: FootballPredictionTeamFormFeature | undefined,
  opponentForm: FootballPredictionTeamFormFeature | undefined
): number | undefined {
  const teamOver05 = valueOrUndefined(teamForm?.teamOver05Rate);
  const teamOver15 = valueOrUndefined(teamForm?.teamOver15Rate);
  const opponentConceded = valueOrUndefined(opponentForm?.concededRate);
  if (teamOver05 === undefined || teamOver15 === undefined || opponentConceded === undefined) {
    return undefined;
  }

  const opponentFirstHalfConcession = valueOrUndefined(opponentForm?.firstHalfAvgGoalsAgainst) ?? 0;
  const proxy = 0.2 + (teamOver05 / 100) * 0.8 + (teamOver15 / 100) * 1 + (opponentConceded / 100) * 0.7 + Math.min(opponentFirstHalfConcession, 2) * 0.2;
  return round(clamp(proxy, 0, 3), 3);
}

function calculateFirstHalfGoalSignalScore(homeForm: FootballPredictionTeamFormFeature | undefined, awayForm: FootballPredictionTeamFormFeature | undefined): number | undefined {
  const homeFirstHalf = valueOrUndefined(homeForm?.firstHalfOver05Rate);
  const awayFirstHalf = valueOrUndefined(awayForm?.firstHalfOver05Rate);
  if (homeFirstHalf === undefined || awayFirstHalf === undefined) {
    return undefined;
  }

  return round((homeFirstHalf + awayFirstHalf) / 2, 2);
}

function calculateBttsSignalScore(homeForm: FootballPredictionTeamFormFeature | undefined, awayForm: FootballPredictionTeamFormFeature | undefined): number | undefined {
  const homeScored = valueOrUndefined(homeForm?.scoredRate);
  const awayScored = valueOrUndefined(awayForm?.scoredRate);
  const homeConceded = valueOrUndefined(homeForm?.concededRate);
  const awayConceded = valueOrUndefined(awayForm?.concededRate);
  if (homeScored === undefined || awayScored === undefined || homeConceded === undefined || awayConceded === undefined) {
    return undefined;
  }

  const weakestScoringSide = Math.min(homeScored, awayScored);
  const weakestConcessionSide = Math.min(homeConceded, awayConceded);
  const balancedSupport = (homeScored + awayScored + homeConceded + awayConceded) / 4;
  return round(weakestScoringSide * 0.4 + weakestConcessionSide * 0.3 + balancedSupport * 0.3, 2);
}

function resolveTeamGoalProfile(score: number | undefined): FootballTeamGoalProfile {
  if (score === undefined) return "unknown";
  if (score >= 70) return "strong";
  if (score >= 45) return "moderate";
  return "weak";
}

function resolveGoalProfile(
  expectedTotalGoalsProxy: number | undefined,
  homeTeamGoalProfile: FootballTeamGoalProfile,
  awayTeamGoalProfile: FootballTeamGoalProfile
): FootballGoalProfile {
  if (expectedTotalGoalsProxy === undefined) return "unknown";
  if (expectedTotalGoalsProxy >= 2.75 || (homeTeamGoalProfile === "strong" && awayTeamGoalProfile === "strong")) return "high_goal";
  if (expectedTotalGoalsProxy >= 1.75) return "medium_goal";
  return "low_goal";
}

function resolveFirstHalfGoalProfile(score: number | undefined): FootballFirstHalfGoalProfile {
  if (score === undefined) return "unknown";
  if (score >= 65) return "likely_goal";
  if (score < 45) return "low_goal";
  return "unknown";
}

function resolveBttsProfile(
  score: number | undefined,
  homeForm: FootballPredictionTeamFormFeature | undefined,
  awayForm: FootballPredictionTeamFormFeature | undefined
): FootballBttsProfile {
  if (score === undefined) return "unknown";
  const homeScored = valueOrUndefined(homeForm?.scoredRate);
  const awayScored = valueOrUndefined(awayForm?.scoredRate);
  const homeConceded = valueOrUndefined(homeForm?.concededRate);
  const awayConceded = valueOrUndefined(awayForm?.concededRate);
  const bothTeamsSupportBtts =
    homeScored !== undefined &&
    awayScored !== undefined &&
    homeConceded !== undefined &&
    awayConceded !== undefined &&
    homeScored >= 55 &&
    awayScored >= 55 &&
    homeConceded >= 55 &&
    awayConceded >= 55;
  if (score >= 65 && bothTeamsSupportBtts) return "yes_lean";
  if (score < 45) return "no_lean";
  return "balanced";
}

function summarizeGoalInputs(feature: FootballPredictionTeamFormFeature | undefined) {
  if (!feature) return undefined;
  return {
    scoredRate: valueOrUndefined(feature.scoredRate),
    concededRate: valueOrUndefined(feature.concededRate),
    teamOver05Rate: valueOrUndefined(feature.teamOver05Rate),
    teamOver15Rate: valueOrUndefined(feature.teamOver15Rate),
    under25Rate: valueOrUndefined(feature.under25Rate),
    firstHalfOver05Rate: valueOrUndefined(feature.firstHalfOver05Rate),
    firstHalfAvgGoalsFor: valueOrUndefined(feature.firstHalfAvgGoalsFor),
    firstHalfAvgGoalsAgainst: valueOrUndefined(feature.firstHalfAvgGoalsAgainst)
  };
}

function calculateCombinedCoverageScore(
  homeForm: FootballPredictionTeamFormFeature | undefined,
  awayForm: FootballPredictionTeamFormFeature | undefined,
  h2h: FootballPredictionH2HFeature | undefined
): number {
  const homeCoverage = homeForm?.coverageScore ?? 0;
  const awayCoverage = awayForm?.coverageScore ?? 0;
  if ((h2h?.sampleSize ?? 0) > 0) {
    return round(homeCoverage * 0.4 + awayCoverage * 0.4 + (h2h?.coverageScore ?? 0) * 0.2, 2);
  }

  return round(homeCoverage * 0.5 + awayCoverage * 0.5, 2);
}

function resolveFeatureStatus(
  homeForm: FootballPredictionTeamFormFeature | undefined,
  awayForm: FootballPredictionTeamFormFeature | undefined,
  _h2h: FootballPredictionH2HFeature | undefined,
  combinedCoverageScore: number
): FootballMatchPredictionFeatureStatus {
  const homeSampleSize = homeForm?.sampleSize ?? 0;
  const awaySampleSize = awayForm?.sampleSize ?? 0;
  if (!homeForm || !awayForm || (homeSampleSize === 0 && awaySampleSize === 0) || combinedCoverageScore < 20) {
    return "insufficient_data";
  }

  if (homeSampleSize >= 3 && awaySampleSize >= 3 && combinedCoverageScore >= 50) {
    return "ready";
  }

  return "partial";
}

function attackProxy(feature: FootballPredictionTeamFormFeature | undefined): number | undefined {
  if (!feature) return undefined;
  if (feature.avgExpectedGoals !== undefined && feature.avgExpectedGoals !== null) return feature.avgExpectedGoals;
  return valueOrUndefined(feature.avgGoalsFor);
}

function diff(left: number | null | undefined, right: number | null | undefined): number | undefined {
  if (left === undefined || left === null || right === undefined || right === null) return undefined;
  return left - right;
}

function valueOrUndefined(value: number | null | undefined): number | undefined {
  return value === null ? undefined : value;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
