import { describe, expect, it } from "vitest";
import { buildFootballMatchReasoning } from "./football-match-reasoning-builder.js";
import type { FootballMatchReasoningPredictionFeature } from "./football-match-reasoning-builder.js";

const readyFeature: FootballMatchReasoningPredictionFeature = {
  matchId: "match-1",
  featureStatus: "ready",
  homeFormFeatureId: "home-form-1",
  awayFormFeatureId: "away-form-1",
  h2hFeatureId: "h2h-1",
  homeFormCoverageScore: 78,
  awayFormCoverageScore: 74,
  h2hCoverageScore: 60,
  combinedCoverageScore: 72.4,
  metadataJson: {
    h2hMissing: false,
    sampleSizes: {
      homeForm: 5,
      awayForm: 5,
      h2h: 3
    }
  }
};

describe("football match reasoning builder", () => {
  it("marks ready rows with H2H as prediction-eligible but not kupon-eligible", () => {
    const reasoning = buildFootballMatchReasoning(readyFeature);

    expect(reasoning).toMatchObject({
      feature_status: "ready",
      reasoning_status: "ready_for_prediction_analysis",
      prediction_eligible: true,
      kupon_eligible: false,
      confidence_ceiling: 80
    });
    expect(reasoning.positive_signals).toContain("Minimum MVP feature readiness is satisfied.");
    expect(reasoning.risk_factors).not.toContain("Head-to-head history is missing or zero-sample, so confidence is capped.");
  });

  it("caps confidence and records H2H risk when ready row has missing H2H", () => {
    const reasoning = buildFootballMatchReasoning({
      ...readyFeature,
      h2hCoverageScore: 0,
      combinedCoverageScore: 64,
      metadataJson: {
        h2hMissing: true,
        sampleSizes: {
          homeForm: 5,
          awayForm: 4,
          h2h: 0
        }
      }
    });

    expect(reasoning.prediction_eligible).toBe(true);
    expect(reasoning.kupon_eligible).toBe(false);
    expect(reasoning.confidence_ceiling).toBe(65);
    expect(reasoning.metadata.h2hMissing).toBe(true);
    expect(reasoning.risk_factors).toContain("Head-to-head history is missing or zero-sample, so confidence is capped.");
    expect(reasoning.missing_data_warnings).toContain("Head-to-head sample is unavailable for this matchup.");
  });

  it("keeps partial rows in analysis-only mode", () => {
    const reasoning = buildFootballMatchReasoning({
      ...readyFeature,
      featureStatus: "partial",
      combinedCoverageScore: 42,
      metadataJson: {
        sampleSizes: {
          homeForm: 2,
          awayForm: 3,
          h2h: 0
        }
      }
    });

    expect(reasoning).toMatchObject({
      reasoning_status: "analysis_only",
      prediction_eligible: false,
      kupon_eligible: false,
      confidence_ceiling: 50
    });
    expect(reasoning.negative_signals).toContain("Feature snapshot is partial; keep this match in analysis-only mode.");
  });

  it("excludes insufficient rows and scales the confidence ceiling by coverage", () => {
    const reasoning = buildFootballMatchReasoning({
      ...readyFeature,
      featureStatus: "insufficient_data",
      homeFormFeatureId: null,
      awayFormFeatureId: null,
      h2hFeatureId: null,
      homeFormCoverageScore: 0,
      awayFormCoverageScore: 0,
      h2hCoverageScore: 0,
      combinedCoverageScore: 12,
      metadataJson: {
        sampleSizes: {
          homeForm: 0,
          awayForm: 0,
          h2h: 0
        }
      }
    });

    expect(reasoning).toMatchObject({
      reasoning_status: "not_enough_data",
      prediction_eligible: false,
      kupon_eligible: false,
      confidence_ceiling: 12
    });
    expect(reasoning.missing_data_warnings).toEqual(
      expect.arrayContaining(["Home team form feature is missing.", "Away team form feature is missing.", "Head-to-head sample is unavailable for this matchup."])
    );
  });

  it("adds strong home and away form signals", () => {
    const reasoning = buildFootballMatchReasoning(readyFeature);

    expect(reasoning.positive_signals).toEqual(
      expect.arrayContaining([
        "Home team form coverage is strong: sample_size=5, coverage=78.00.",
        "Away team form coverage is strong: sample_size=5, coverage=74.00."
      ])
    );
  });
});
