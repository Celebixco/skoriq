import type { FootballMatchPredictionFeatureStatus } from "./football-match-prediction-feature-builder.js";

export type FootballMatchReasoningStatus = "ready_for_prediction_analysis" | "analysis_only" | "not_enough_data";

export interface FootballMatchReasoningPredictionFeature {
  matchId: string;
  featureStatus: FootballMatchPredictionFeatureStatus;
  homeFormFeatureId?: string | null;
  awayFormFeatureId?: string | null;
  h2hFeatureId?: string | null;
  homeFormCoverageScore?: number | null;
  awayFormCoverageScore?: number | null;
  h2hCoverageScore?: number | null;
  combinedCoverageScore: number;
  metadataJson?: Record<string, unknown> | null;
}

export interface FootballMatchReasoningSnapshot {
  match_id: string;
  feature_status: FootballMatchPredictionFeatureStatus;
  reasoning_status: FootballMatchReasoningStatus;
  positive_signals: string[];
  negative_signals: string[];
  risk_factors: string[];
  missing_data_warnings: string[];
  confidence_ceiling: number;
  prediction_eligible: boolean;
  kupon_eligible: boolean;
  summary: string;
  metadata: {
    h2hMissing: boolean;
    sampleSizes: {
      homeForm: number;
      awayForm: number;
      h2h: number;
    };
    coverage: {
      homeForm: number | null;
      awayForm: number | null;
      h2h: number | null;
      combined: number;
    };
    sourceFeatureIds: {
      homeFormFeatureId?: string | null;
      awayFormFeatureId?: string | null;
      h2hFeatureId?: string | null;
    };
    policy: {
      predictionEligibility: "ready_rows_only";
      kuponEligibility: "disabled_no_kupon_engine";
    };
  };
}

export class FootballMatchReasoningBuilder {
  buildFromPredictionFeature(feature: FootballMatchReasoningPredictionFeature): FootballMatchReasoningSnapshot {
    return buildFootballMatchReasoning(feature);
  }
}

export function buildFootballMatchReasoning(feature: FootballMatchReasoningPredictionFeature): FootballMatchReasoningSnapshot {
  const metadata = feature.metadataJson ?? {};
  const sampleSizes = extractSampleSizes(metadata);
  const h2hMissing = metadata.h2hMissing === true || sampleSizes.h2h === 0;
  const positiveSignals: string[] = [];
  const negativeSignals: string[] = [];
  const riskFactors: string[] = [];
  const missingDataWarnings: string[] = [];

  if (feature.featureStatus === "ready") {
    positiveSignals.push("Minimum MVP feature readiness is satisfied.");
  }
  if (sampleSizes.homeForm >= 3 && (feature.homeFormCoverageScore ?? 0) >= 50) {
    positiveSignals.push(`Home team form coverage is strong: sample_size=${sampleSizes.homeForm}, coverage=${formatScore(feature.homeFormCoverageScore)}.`);
  }
  if (sampleSizes.awayForm >= 3 && (feature.awayFormCoverageScore ?? 0) >= 50) {
    positiveSignals.push(`Away team form coverage is strong: sample_size=${sampleSizes.awayForm}, coverage=${formatScore(feature.awayFormCoverageScore)}.`);
  }
  if (feature.combinedCoverageScore >= 50) {
    positiveSignals.push(`Combined feature coverage is usable for MVP analysis: ${formatScore(feature.combinedCoverageScore)}.`);
  }
  if (!h2hMissing) {
    positiveSignals.push(`Head-to-head context is available: sample_size=${sampleSizes.h2h}, coverage=${formatScore(feature.h2hCoverageScore)}.`);
  }

  if (!feature.homeFormFeatureId) {
    missingDataWarnings.push("Home team form feature is missing.");
  }
  if (!feature.awayFormFeatureId) {
    missingDataWarnings.push("Away team form feature is missing.");
  }
  if (h2hMissing) {
    riskFactors.push("Head-to-head history is missing or zero-sample, so confidence is capped.");
    missingDataWarnings.push("Head-to-head sample is unavailable for this matchup.");
  }
  if (sampleSizes.homeForm > 0 && sampleSizes.homeForm < 3) {
    negativeSignals.push(`Home team form sample is below MVP threshold: sample_size=${sampleSizes.homeForm}.`);
  }
  if (sampleSizes.awayForm > 0 && sampleSizes.awayForm < 3) {
    negativeSignals.push(`Away team form sample is below MVP threshold: sample_size=${sampleSizes.awayForm}.`);
  }
  if (feature.combinedCoverageScore < 20) {
    riskFactors.push(`Combined coverage is very low: ${formatScore(feature.combinedCoverageScore)}.`);
  } else if (feature.combinedCoverageScore < 50) {
    riskFactors.push(`Combined coverage is below MVP ready threshold: ${formatScore(feature.combinedCoverageScore)}.`);
  }
  if (feature.featureStatus === "partial") {
    negativeSignals.push("Feature snapshot is partial; keep this match in analysis-only mode.");
  }
  if (feature.featureStatus === "insufficient_data") {
    negativeSignals.push("Feature snapshot is insufficient; critical data is missing or too weak.");
  }

  const predictionEligible = feature.featureStatus === "ready";
  const kuponEligible = false;
  const confidenceCeiling = resolveConfidenceCeiling(feature.featureStatus, feature.combinedCoverageScore, h2hMissing);
  const reasoningStatus = resolveReasoningStatus(feature.featureStatus);

  return {
    match_id: feature.matchId,
    feature_status: feature.featureStatus,
    reasoning_status: reasoningStatus,
    positive_signals: positiveSignals,
    negative_signals: negativeSignals,
    risk_factors: riskFactors,
    missing_data_warnings: missingDataWarnings,
    confidence_ceiling: confidenceCeiling,
    prediction_eligible: predictionEligible,
    kupon_eligible: kuponEligible,
    summary: summarize(feature.featureStatus, predictionEligible, h2hMissing, confidenceCeiling),
    metadata: {
      h2hMissing,
      sampleSizes,
      coverage: {
        homeForm: feature.homeFormCoverageScore ?? null,
        awayForm: feature.awayFormCoverageScore ?? null,
        h2h: feature.h2hCoverageScore ?? null,
        combined: feature.combinedCoverageScore
      },
      sourceFeatureIds: {
        homeFormFeatureId: feature.homeFormFeatureId,
        awayFormFeatureId: feature.awayFormFeatureId,
        h2hFeatureId: feature.h2hFeatureId
      },
      policy: {
        predictionEligibility: "ready_rows_only",
        kuponEligibility: "disabled_no_kupon_engine"
      }
    }
  };
}

function extractSampleSizes(metadata: Record<string, unknown>) {
  const sampleSizes = isRecord(metadata.sampleSizes) ? metadata.sampleSizes : {};
  return {
    homeForm: numberFromUnknown(sampleSizes.homeForm),
    awayForm: numberFromUnknown(sampleSizes.awayForm),
    h2h: numberFromUnknown(sampleSizes.h2h)
  };
}

function resolveConfidenceCeiling(status: FootballMatchPredictionFeatureStatus, combinedCoverageScore: number, h2hMissing: boolean) {
  if (status === "ready") return h2hMissing ? 65 : 80;
  if (status === "partial") return 50;
  return Math.max(0, Math.min(30, Math.round(combinedCoverageScore)));
}

function resolveReasoningStatus(status: FootballMatchPredictionFeatureStatus): FootballMatchReasoningStatus {
  if (status === "ready") return "ready_for_prediction_analysis";
  if (status === "partial") return "analysis_only";
  return "not_enough_data";
}

function summarize(status: FootballMatchPredictionFeatureStatus, predictionEligible: boolean, h2hMissing: boolean, confidenceCeiling: number) {
  if (predictionEligible && h2hMissing) {
    return `Feature readiness is ${status}; team-form coverage is sufficient for MVP prediction analysis, but missing H2H caps confidence at ${confidenceCeiling}.`;
  }
  if (predictionEligible) {
    return `Feature readiness is ${status}; required sources are available and confidence is capped at ${confidenceCeiling}.`;
  }
  if (status === "partial") {
    return `Feature readiness is partial; useful context exists, but this match remains analysis-only.`;
  }
  return "Feature readiness is insufficient; this match should be excluded from prediction and kupon consideration.";
}

function formatScore(value: number | null | undefined) {
  return (value ?? 0).toFixed(2);
}

function numberFromUnknown(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
