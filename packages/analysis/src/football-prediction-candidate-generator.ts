import { buildFootballMatchReasoning } from "./football-match-reasoning-builder.js";
import type {
  FootballBttsProfile,
  FootballFirstHalfGoalProfile,
  FootballGoalProfile,
  FootballMatchPredictionFeatureStatus,
  FootballTeamGoalProfile
} from "./football-match-prediction-feature-builder.js";

export type FootballPredictionRecommendationTier = "primary" | "try" | "alternative" | "avoid";
export type FootballPredictionCandidateConsistencyStatus = "unchecked" | "passed" | "warning" | "blocked";
export type FootballPredictionFamily =
  | "match_result"
  | "scoreline"
  | "total_goals"
  | "first_half_goals"
  | "both_teams_to_score"
  | "team_total_goals"
  | "double_chance"
  | "score_range";

export interface FootballPredictionCandidateFeature {
  id: string;
  matchId: string;
  featureStatus: FootballMatchPredictionFeatureStatus;
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
  goalProfile?: FootballGoalProfile | null;
  firstHalfGoalProfile?: FootballFirstHalfGoalProfile | null;
  bttsProfile?: FootballBttsProfile | null;
  homeTeamGoalProfile?: FootballTeamGoalProfile | null;
  awayTeamGoalProfile?: FootballTeamGoalProfile | null;
  standingsPositionDiff?: number | null;
  standingsPointsDiff?: number | null;
  standingsGoalDifferenceDiff?: number | null;
  metadataJson?: Record<string, unknown> | null;
}

export interface FootballPredictionCandidate {
  prediction_type: string;
  prediction_value: string;
  prediction_family: FootballPredictionFamily;
  confidence_score: number;
  risk_level: "low" | "medium" | "high" | "unknown";
  recommendation_tier: FootballPredictionRecommendationTier;
  display_label: "Tahminim" | "Denenir" | "Alternatif" | "Uzak Dur";
  reasoning_summary: string;
  consistency_status: FootballPredictionCandidateConsistencyStatus;
  metadata: Record<string, unknown>;
}

export interface FootballPredictionCandidateReport {
  matchId: string;
  featureSnapshotId: string;
  generationMode: "dry_run";
  analysisWindow?: FootballPredictionAnalysisWindowReport;
  candidates: FootballPredictionCandidate[];
  warnings: string[];
  blockedReasons: string[];
  summary: string;
  conflicts?: unknown[];
  blockingConflictCount?: number;
  warningConflictCount?: number;
  consistencySummary?: string;
  canonicalExpectation?: unknown;
}

export type FootballPredictionAnalysisWindowStatus = "within_window" | "too_early" | "too_late" | "stale" | "unknown";

export interface FootballPredictionAnalysisWindowReport {
  kickoffAt: string | null;
  evaluatedAt: string;
  generatedAt?: string;
  leadTimeMinutes: number | null;
  windowHours: number;
  minimumLeadMinutes: number;
  analysisWindowStatus: FootballPredictionAnalysisWindowStatus;
  requiresRebuild: boolean;
  dataCompletenessNotes: string[];
}

export class FootballPredictionCandidateGenerator {
  generate(feature: FootballPredictionCandidateFeature): FootballPredictionCandidateReport {
    return generateFootballPredictionCandidates(feature);
  }
}

export function generateFootballPredictionCandidates(feature: FootballPredictionCandidateFeature): FootballPredictionCandidateReport {
  const warnings: string[] = ["Dry-run candidate preview only; not member-visible and not settlement-ready."];
  const blockedReasons: string[] = [];
  const reasoning = buildFootballMatchReasoning({
    matchId: feature.matchId,
    featureStatus: feature.featureStatus,
    homeFormFeatureId: feature.homeFormFeatureId,
    awayFormFeatureId: feature.awayFormFeatureId,
    h2hFeatureId: feature.h2hFeatureId,
    homeFormCoverageScore: feature.homeFormCoverageScore,
    awayFormCoverageScore: feature.awayFormCoverageScore,
    h2hCoverageScore: feature.h2hCoverageScore,
    combinedCoverageScore: feature.combinedCoverageScore,
    metadataJson: feature.metadataJson
  });
  const confidenceCeiling = reasoning.confidence_ceiling;
  const sampleSizes = reasoning.metadata.sampleSizes;
  const playerContext = extractPlayerContext(feature.metadataJson);

  if (feature.featureStatus !== "ready") {
    blockedReasons.push(`Feature snapshot is ${feature.featureStatus}; candidate generation requires ready.`);
    return buildReport(feature, [], warnings, blockedReasons, "Analysis-only: feature snapshot is not ready.");
  }

  if (reasoning.metadata.h2hMissing) {
    warnings.push("H2H sample is missing; confidence is capped and candidates require extra caution.");
  }
  if (playerContext?.playerContextRiskLevel === "high") {
    warnings.push("Oyuncu eksikliği riski yüksek; güven tavanı aşağı çekildi.");
  }

  const expectedHomeGoals = valueOrUndefined(feature.expectedHomeGoalsProxy) ?? expectedTeamGoals(feature.homeAvgGoalsFor ?? feature.homeAttackStrengthProxy, feature.awayAvgGoalsAgainst ?? feature.awayDefenseStrengthProxy);
  const expectedAwayGoals = valueOrUndefined(feature.expectedAwayGoalsProxy) ?? expectedTeamGoals(feature.awayAvgGoalsFor ?? feature.awayAttackStrengthProxy, feature.homeAvgGoalsAgainst ?? feature.homeDefenseStrengthProxy);
  const expectedTotalGoals =
    valueOrUndefined(feature.expectedTotalGoalsProxy) ??
    (expectedHomeGoals !== undefined && expectedAwayGoals !== undefined ? round(expectedHomeGoals + expectedAwayGoals, 2) : undefined);
  const expectationSnapshot = {
    expected_home_goals: expectedHomeGoals ?? null,
    expected_away_goals: expectedAwayGoals ?? null,
    expected_total_goals: expectedTotalGoals ?? null,
    goal_profile: feature.goalProfile ?? "unknown",
    first_half_goal_profile: feature.firstHalfGoalProfile ?? "unknown",
    btts_profile: feature.bttsProfile ?? "unknown",
    home_team_goal_profile: feature.homeTeamGoalProfile ?? "unknown",
    away_team_goal_profile: feature.awayTeamGoalProfile ?? "unknown",
    home_goal_signal_score: feature.homeGoalSignalScore ?? null,
    away_goal_signal_score: feature.awayGoalSignalScore ?? null,
    first_half_goal_signal_score: feature.firstHalfGoalSignalScore ?? null,
    btts_signal_score: feature.bttsSignalScore ?? null,
    h2h_missing: reasoning.metadata.h2hMissing,
    confidence_ceiling: confidenceCeiling,
    player_context_risk_level: playerContext?.playerContextRiskLevel ?? "unknown",
    home_lineup_confirmed: playerContext?.homeLineupConfirmed ?? false,
    away_lineup_confirmed: playerContext?.awayLineupConfirmed ?? false
  };

  const candidates: FootballPredictionCandidate[] = [];
  const matchResultCandidate = buildMatchResultCandidate(feature, confidenceCeiling, expectationSnapshot);
  if (matchResultCandidate) candidates.push(matchResultCandidate);

  const doubleChanceCandidate = buildDoubleChanceCandidate(feature, confidenceCeiling, expectationSnapshot, matchResultCandidate);
  if (doubleChanceCandidate) candidates.push(doubleChanceCandidate);

  const totalGoalCandidate = buildTotalGoalCandidate(feature, confidenceCeiling, expectedTotalGoals, expectationSnapshot);
  if (totalGoalCandidate) candidates.push(totalGoalCandidate);

  const bttsCandidate = buildBothTeamsToScoreCandidate(feature, confidenceCeiling, expectedHomeGoals, expectedAwayGoals, expectationSnapshot);
  if (bttsCandidate) candidates.push(bttsCandidate);

  const firstHalfCandidate = buildFirstHalfGoalCandidate(feature, confidenceCeiling, expectationSnapshot, sampleSizes, playerContext);
  if (firstHalfCandidate) candidates.push(firstHalfCandidate);

  const finalCandidates = enforceTierRules(candidates);
  if (!finalCandidates.some((item) => item.recommendation_tier === "primary")) {
    warnings.push("No primary candidate reached the dry-run threshold.");
  }
  if (finalCandidates.length === 0) {
    blockedReasons.push("No candidate had enough deterministic support.");
  }

  return buildReport(feature, finalCandidates, warnings, blockedReasons, summarizeCandidates(finalCandidates));
}

function buildMatchResultCandidate(feature: FootballPredictionCandidateFeature, ceiling: number, expectationSnapshot: Record<string, unknown>) {
  const pointsEdge = (feature.homeRecentPoints ?? 0) - (feature.awayRecentPoints ?? 0);
  const goalEdge = (feature.homeAttackStrengthProxy ?? feature.homeAvgGoalsFor ?? 0) - (feature.awayAttackStrengthProxy ?? feature.awayAvgGoalsFor ?? 0);
  const expectedGoalEdge = (feature.expectedHomeGoalsProxy ?? 0) - (feature.expectedAwayGoalsProxy ?? 0);
  const goalSignalEdge = ((feature.homeGoalSignalScore ?? 0) - (feature.awayGoalSignalScore ?? 0)) / 20;
  const standingsEdge = invertNullable(feature.standingsPositionDiff);
  const edgeScore = pointsEdge * 2 + goalEdge * 10 + expectedGoalEdge * 4 + goalSignalEdge + (standingsEdge ?? 0) * 0.7 + (feature.standingsPointsDiff ?? 0) * 0.3;

  if (Math.abs(edgeScore) < 4) return undefined;

  const homeLean = edgeScore > 0;
  const confidence = capConfidence(58 + Math.min(12, Math.abs(edgeScore)), ceiling);
  return candidate({
    predictionType: "match_result_1x2",
    predictionValue: homeLean ? "1" : "2",
    predictionFamily: "match_result",
    confidenceScore: confidence,
    recommendationTier: tierForConfidence(confidence),
    reasoningSummary: homeLean
      ? "Ev sahibi formda ve gol sinyalinde önde; güçlü ev sahibi gol profili MS 1 tarafını destekliyor."
      : "Deplasman tarafı formda ve gol sinyalinde önde; deplasman sonuç profili destek buluyor.",
    metadata: { ...expectationSnapshot, edgeScore: round(edgeScore, 2) }
  });
}

function buildDoubleChanceCandidate(
  feature: FootballPredictionCandidateFeature,
  ceiling: number,
  expectationSnapshot: Record<string, unknown>,
  primary: FootballPredictionCandidate | undefined
) {
  const pointsEdge = (feature.homeRecentPoints ?? 0) - (feature.awayRecentPoints ?? 0);
  const value = pointsEdge >= 0 ? "1X" : "X2";
  if (primary?.prediction_family === "match_result" && ((primary.prediction_value === "1" && value === "X2") || (primary.prediction_value === "2" && value === "1X"))) {
    return undefined;
  }

  const confidence = capConfidence(56 + Math.min(8, Math.abs(pointsEdge) * 2), ceiling);
  return candidate({
    predictionType: "double_chance",
    predictionValue: value,
    predictionFamily: "double_chance",
    confidenceScore: confidence,
    recommendationTier: tierForConfidence(confidence, "try"),
    reasoningSummary: `${value} daha temkinli bir sonuç profili sunuyor; birincil sonuç adayına göre daha korumalıdır.`,
    metadata: { ...expectationSnapshot, pointsEdge }
  });
}

function buildTotalGoalCandidate(
  feature: FootballPredictionCandidateFeature,
  ceiling: number,
  expectedTotalGoals: number | undefined,
  expectationSnapshot: Record<string, unknown>
) {
  if (expectedTotalGoals === undefined) return undefined;

  if (feature.goalProfile === "high_goal" && expectedTotalGoals >= 2.8) {
    const confidence = capConfidence(58 + Math.min(6, (expectedTotalGoals - 2.8) * 4) + ((feature.h2hOver25Rate ?? 0) / 100) * 2, ceiling);
    return candidate({
      predictionType: "over_under_goals",
      predictionValue: "over_2_5",
      predictionFamily: "total_goals",
      confidenceScore: confidence,
      recommendationTier: tierForConfidence(confidence, "try"),
      reasoningSummary: "Toplam gol profili yüksek; ev sahibi gol yolu güçlü olduğu için MS 2.5 Üst denenebilir, fakat bu bir olasılık değil proxy sinyaldir.",
      metadata: { ...expectationSnapshot }
    });
  }

  if (feature.goalProfile === "medium_goal" && expectedTotalGoals >= 1.8) {
    const confidence = capConfidence(56 + (expectedTotalGoals - 1.5) * 7, ceiling);
    return candidate({
      predictionType: "over_under_goals",
      predictionValue: "over_1_5",
      predictionFamily: "total_goals",
      confidenceScore: confidence,
      recommendationTier: tierForConfidence(confidence, "alternative"),
      reasoningSummary: "Beklenen toplam gol profili 1.5 üstü için sınırlı ama kullanılabilir sinyal veriyor.",
      metadata: { ...expectationSnapshot }
    });
  }

  if (feature.goalProfile === "low_goal") {
    const confidence = capConfidence(58 + Math.min(6, (1.75 - expectedTotalGoals) * 5), ceiling);
    return candidate({
      predictionType: "over_under_goals",
      predictionValue: "under_2_5",
      predictionFamily: "total_goals",
      confidenceScore: confidence,
      recommendationTier: tierForConfidence(confidence, "try"),
      reasoningSummary: "Düşük gol profili 2.5 Alt tarafını destekliyor; yüksek toplam gol adaylarıyla çelişir.",
      metadata: { ...expectationSnapshot }
    });
  }

  return undefined;
}

function buildBothTeamsToScoreCandidate(
  feature: FootballPredictionCandidateFeature,
  ceiling: number,
  expectedHomeGoals: number | undefined,
  expectedAwayGoals: number | undefined,
  expectationSnapshot: Record<string, unknown>
) {
  if (expectedHomeGoals === undefined || expectedAwayGoals === undefined || feature.bttsProfile === "unknown") return undefined;
  if (feature.bttsProfile === "no_lean" || expectedHomeGoals < 0.9 || expectedAwayGoals < 0.9) {
    return candidate({
      predictionType: "both_teams_to_score",
      predictionValue: feature.bttsProfile === "no_lean" ? "no" : "avoid_btts_yes",
      predictionFamily: "both_teams_to_score",
      confidenceScore: capConfidence(feature.bttsProfile === "no_lean" ? 52 : 44, ceiling),
      recommendationTier: feature.bttsProfile === "no_lean" ? "alternative" : "avoid",
      reasoningSummary: "Karşılıklı gol için iki taraflı destek zayıf; KG Var önerilmez.",
      metadata: { ...expectationSnapshot }
    });
  }

  if (feature.bttsProfile === "balanced") {
    const signal = feature.bttsSignalScore ?? 0;
    if (signal < 55) return undefined;
    return candidate({
      predictionType: "both_teams_to_score",
      predictionValue: "yes",
      predictionFamily: "both_teams_to_score",
      confidenceScore: capConfidence(52 + Math.min(5, (signal - 55) / 2), ceiling),
      recommendationTier: "alternative",
      reasoningSummary: "KG Var profili dengeli ama güçlü değil; özellikle deplasman gol sinyali sınırlı olduğu için yalnızca alternatif kalır.",
      metadata: { ...expectationSnapshot }
    });
  }

  const confidence = capConfidence(58 + Math.min(5, ((feature.bttsSignalScore ?? 65) - 65) / 2) + ((feature.h2hBttsRate ?? 0) / 100) * 2, ceiling);
  return candidate({
    predictionType: "both_teams_to_score",
    predictionValue: "yes",
    predictionFamily: "both_teams_to_score",
    confidenceScore: confidence,
    recommendationTier: tierForConfidence(confidence, "alternative"),
    reasoningSummary: "İki takımın scoring/conceding profili KG Var için doğrudan destek veriyor.",
    metadata: { ...expectationSnapshot }
  });
}

function buildFirstHalfGoalCandidate(
  feature: FootballPredictionCandidateFeature,
  ceiling: number,
  expectationSnapshot: Record<string, unknown>,
  sampleSizes: { homeForm: number; awayForm: number; h2h: number },
  playerContext: ReturnType<typeof extractPlayerContext>
) {
  if (playerContext && (!playerContext.homeLineupConfirmed || !playerContext.awayLineupConfirmed)) {
    return candidate({
      predictionType: "first_half_over_0_5",
      predictionValue: "avoid_unconfirmed_lineups",
      predictionFamily: "first_half_goals",
      confidenceScore: Math.min(42, ceiling),
      recommendationTier: "avoid",
      reasoningSummary: "İlk 11 verisi onaylı olmadığı için ilk yarı tahmininde aşırı güven kullanılmadı.",
      metadata: { ...expectationSnapshot, missingEvidence: "unconfirmed_lineups" }
    });
  }

  if (feature.firstHalfGoalProfile === "likely_goal" && (feature.firstHalfGoalSignalScore ?? 0) >= 65) {
    const confidence = capConfidence(58 + Math.min(5, ((feature.firstHalfGoalSignalScore ?? 65) - 65) / 3), ceiling);
    return candidate({
      predictionType: "first_half_over_0_5",
      predictionValue: "over_0_5",
      predictionFamily: "first_half_goals",
      confidenceScore: confidence,
      recommendationTier: tierForConfidence(confidence, "try"),
      reasoningSummary: "İlk yarı gol profili doğrudan destek veriyor; bu aday fulltime gol verisinden değil ilk yarı sinyalinden geliyor.",
      metadata: { ...expectationSnapshot }
    });
  }

  if (feature.firstHalfGoalProfile === "low_goal" || feature.firstHalfGoalProfile === "unknown" || sampleSizes.homeForm < 5 || sampleSizes.awayForm < 5) {
    return candidate({
      predictionType: "first_half_over_0_5",
      predictionValue: "avoid_missing_first_half_evidence",
      predictionFamily: "first_half_goals",
      confidenceScore: Math.min(45, ceiling),
      recommendationTier: "avoid",
      reasoningSummary: "İlk yarı gol kanıtı yeterince güçlü ve dengeli değil; İY 0.5 Üst önerilmedi.",
      metadata: { ...expectationSnapshot, missingEvidence: "first_half_goal_tendency" }
    });
  }

  return undefined;
}

function candidate(input: {
  predictionType: string;
  predictionValue: string;
  predictionFamily: FootballPredictionFamily;
  confidenceScore: number;
  recommendationTier: FootballPredictionRecommendationTier;
  reasoningSummary: string;
  metadata: Record<string, unknown>;
}): FootballPredictionCandidate {
  return {
    prediction_type: input.predictionType,
    prediction_value: input.predictionValue,
    prediction_family: input.predictionFamily,
    confidence_score: round(input.confidenceScore, 2),
    risk_level: riskForTier(input.recommendationTier),
    recommendation_tier: input.recommendationTier,
    display_label: displayLabel(input.recommendationTier),
    reasoning_summary: input.reasoningSummary,
    consistency_status: "unchecked",
    metadata: input.metadata
  };
}

function enforceTierRules(candidates: FootballPredictionCandidate[]) {
  const sorted = [...candidates].sort((left, right) => right.confidence_score - left.confidence_score);
  let primaryUsed = false;
  const tiered = sorted.map((candidateItem) => {
    if (candidateItem.recommendation_tier === "primary") {
      if (!primaryUsed) {
        primaryUsed = true;
        return candidateItem;
      }
      return { ...candidateItem, recommendation_tier: "try" as const, display_label: "Denenir" as const, risk_level: "medium" as const };
    }
    return candidateItem;
  });
  return limitCandidateBundle(tiered);
}

function limitCandidateBundle(candidates: FootballPredictionCandidate[]) {
  const result: FootballPredictionCandidate[] = [];
  const primary = candidates.find((candidateItem) => candidateItem.recommendation_tier === "primary");
  if (primary) result.push(primary);

  result.push(...candidates.filter((candidateItem) => candidateItem.recommendation_tier === "try").sort((left, right) => tryPriority(left) - tryPriority(right)).slice(0, 2));
  result.push(...candidates.filter((candidateItem) => candidateItem.recommendation_tier === "alternative").slice(0, 1));

  const firstHalfAvoid = candidates.find((candidateItem) => candidateItem.recommendation_tier === "avoid" && candidateItem.prediction_type === "first_half_over_0_5");
  const firstAvoid = firstHalfAvoid ?? candidates.find((candidateItem) => candidateItem.recommendation_tier === "avoid");
  if (firstAvoid) result.push(firstAvoid);

  return result;
}

function tryPriority(candidateItem: FootballPredictionCandidate) {
  if (candidateItem.prediction_family === "total_goals") return 1;
  if (candidateItem.prediction_family === "first_half_goals") return 2;
  if (candidateItem.prediction_family === "team_total_goals") return 3;
  if (candidateItem.prediction_family === "double_chance") return 4;
  return 5;
}

function tierForConfidence(confidence: number, fallback: FootballPredictionRecommendationTier = "alternative"): FootballPredictionRecommendationTier {
  if (confidence >= 65) return "primary";
  if (confidence >= 58) return "try";
  if (confidence >= 50) return "alternative";
  return fallback === "try" ? "alternative" : fallback;
}

function displayLabel(tier: FootballPredictionRecommendationTier) {
  if (tier === "primary") return "Tahminim";
  if (tier === "try") return "Denenir";
  if (tier === "alternative") return "Alternatif";
  return "Uzak Dur";
}

function riskForTier(tier: FootballPredictionRecommendationTier) {
  if (tier === "primary") return "medium";
  if (tier === "try") return "medium";
  if (tier === "alternative") return "high";
  return "high";
}

function expectedTeamGoals(attack: number | null | undefined, opponentDefense: number | null | undefined): number | undefined {
  const values = [attack, opponentDefense].filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (values.length === 0) return undefined;
  return round(values.reduce((sum, value) => sum + value, 0) / values.length, 2);
}

function valueOrUndefined(value: number | null | undefined): number | undefined {
  return value === null ? undefined : value;
}

function capConfidence(confidence: number, ceiling: number) {
  return Math.max(0, Math.min(confidence, ceiling));
}

function invertNullable(value: number | null | undefined): number | undefined {
  if (value === null || value === undefined) return undefined;
  return -value;
}

function buildReport(
  feature: FootballPredictionCandidateFeature,
  candidates: FootballPredictionCandidate[],
  warnings: string[],
  blockedReasons: string[],
  summary: string
): FootballPredictionCandidateReport {
  return {
    matchId: feature.matchId,
    featureSnapshotId: feature.id,
    generationMode: "dry_run",
    candidates,
    warnings,
    blockedReasons,
    summary
  };
}

function summarizeCandidates(candidates: FootballPredictionCandidate[]) {
  const primary = candidates.find((candidateItem) => candidateItem.recommendation_tier === "primary");
  if (primary) return `Dry-run aday üretildi; birincil aday: ${primary.display_label} ${primary.prediction_type}=${primary.prediction_value}.`;
  if (candidates.length > 0) return "Dry-run aday üretildi; birincil eşik aşılmadı, adaylar analiz amaçlıdır.";
  return "Dry-run aday üretilemedi; veri desteği yeterli değil.";
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractPlayerContext(metadata: Record<string, unknown> | null | undefined) {
  if (!isRecord(metadata) || !isRecord(metadata.playerContext)) return null;
  const playerContext = metadata.playerContext;
  return {
    playerContextRiskLevel: typeof playerContext.playerContextRiskLevel === "string" ? playerContext.playerContextRiskLevel : "unknown",
    homeLineupConfirmed: playerContext.homeLineupConfirmed === true,
    awayLineupConfirmed: playerContext.awayLineupConfirmed === true
  };
}
