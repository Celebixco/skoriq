import { describe, expect, it } from "vitest";
import { generateFootballPredictionCandidates } from "./football-prediction-candidate-generator.js";
import type { FootballPredictionCandidateFeature } from "./football-prediction-candidate-generator.js";

const readyFeature: FootballPredictionCandidateFeature = {
  id: "feature-1",
  matchId: "match-1",
  featureStatus: "ready",
  homeFormFeatureId: "home-form-1",
  awayFormFeatureId: "away-form-1",
  h2hFeatureId: "h2h-1",
  homeFormCoverageScore: 70,
  awayFormCoverageScore: 58,
  h2hCoverageScore: 0,
  combinedCoverageScore: 64,
  homeRecentPoints: 12,
  awayRecentPoints: 7,
  homeAvgGoalsFor: 1.9,
  homeAvgGoalsAgainst: 0.9,
  awayAvgGoalsFor: 1.1,
  awayAvgGoalsAgainst: 1.6,
  homeAttackStrengthProxy: 1.9,
  awayAttackStrengthProxy: 1.1,
  homeDefenseStrengthProxy: 0.9,
  awayDefenseStrengthProxy: 1.6,
  expectedTotalGoalsProxy: 3.605,
  expectedHomeGoalsProxy: 2.215,
  expectedAwayGoalsProxy: 1.39,
  homeGoalSignalScore: 78,
  awayGoalSignalScore: 47.75,
  firstHalfGoalSignalScore: 62.5,
  bttsSignalScore: 57.88,
  goalProfile: "high_goal",
  firstHalfGoalProfile: "unknown",
  bttsProfile: "balanced",
  homeTeamGoalProfile: "strong",
  awayTeamGoalProfile: "moderate",
  standingsPositionDiff: -4,
  standingsPointsDiff: 8,
  metadataJson: {
    h2hMissing: true,
    sampleSizes: {
      homeForm: 5,
      awayForm: 4,
      h2h: 0
    }
  }
};

describe("generateFootballPredictionCandidates", () => {
  it("refuses non-ready feature snapshots", () => {
    const report = generateFootballPredictionCandidates({ ...readyFeature, featureStatus: "partial" });

    expect(report.candidates).toHaveLength(0);
    expect(report.blockedReasons).toContain("Feature snapshot is partial; candidate generation requires ready.");
  });

  it("generates at most one primary candidate", () => {
    const report = generateFootballPredictionCandidates(readyFeature);

    expect(report.candidates.filter((candidate) => candidate.recommendation_tier === "primary")).toHaveLength(1);
  });

  it("caps confidence by the reasoning confidence ceiling", () => {
    const report = generateFootballPredictionCandidates(readyFeature);

    expect(Math.max(...report.candidates.map((candidate) => candidate.confidence_score))).toBeLessThanOrEqual(65);
  });

  it("adds h2h missing warning and risk context", () => {
    const report = generateFootballPredictionCandidates(readyFeature);

    expect(report.warnings).toContain("H2H sample is missing; confidence is capped and candidates require extra caution.");
    expect(report.candidates.every((candidate) => candidate.consistency_status === "unchecked")).toBe(true);
  });

  it("does not generate first_half_over_0_5 without first-half evidence", () => {
    const report = generateFootballPredictionCandidates(readyFeature);
    const firstHalf = report.candidates.find((candidate) => candidate.prediction_type === "first_half_over_0_5");

    expect(firstHalf).toMatchObject({
      recommendation_tier: "avoid",
      display_label: "Uzak Dur",
      prediction_value: "avoid_missing_first_half_evidence"
    });
  });

  it("uses high goal profile to create over 2.5 as a secondary candidate", () => {
    const report = generateFootballPredictionCandidates(readyFeature);
    const totalGoals = report.candidates.find((candidate) => candidate.prediction_value === "over_2_5");

    expect(totalGoals).toMatchObject({
      prediction_type: "over_under_goals",
      recommendation_tier: "try",
      display_label: "Denenir"
    });
    expect(totalGoals?.reasoning_summary).toContain("Toplam gol profili yüksek");
  });

  it("uses medium goal profile for over 1.5 without over 2.5", () => {
    const report = generateFootballPredictionCandidates({
      ...readyFeature,
      expectedTotalGoalsProxy: 2.1,
      expectedHomeGoalsProxy: 1.2,
      expectedAwayGoalsProxy: 0.9,
      goalProfile: "medium_goal",
      homeGoalSignalScore: 58,
      awayGoalSignalScore: 50
    });

    expect(report.candidates.some((candidate) => candidate.prediction_value === "over_1_5")).toBe(true);
    expect(report.candidates.some((candidate) => candidate.prediction_value === "over_2_5")).toBe(false);
  });

  it("uses low goal profile for under 2.5", () => {
    const report = generateFootballPredictionCandidates({
      ...readyFeature,
      expectedTotalGoalsProxy: 1.55,
      expectedHomeGoalsProxy: 0.9,
      expectedAwayGoalsProxy: 0.65,
      goalProfile: "low_goal",
      homeGoalSignalScore: 38,
      awayGoalSignalScore: 34,
      homeTeamGoalProfile: "weak",
      awayTeamGoalProfile: "weak",
      bttsProfile: "no_lean",
      bttsSignalScore: 40
    });

    expect(report.candidates.some((candidate) => candidate.prediction_value === "under_2_5")).toBe(true);
    expect(report.candidates.some((candidate) => candidate.prediction_value === "over_2_5")).toBe(false);
  });

  it("generates first_half_over_0_5 only when first-half profile is likely", () => {
    const report = generateFootballPredictionCandidates({
      ...readyFeature,
      firstHalfGoalProfile: "likely_goal",
      firstHalfGoalSignalScore: 72
    });
    const firstHalf = report.candidates.find((candidate) => candidate.prediction_type === "first_half_over_0_5");

    expect(firstHalf).toMatchObject({
      prediction_value: "over_0_5",
      recommendation_tier: "try"
    });
  });

  it("does not promote balanced BTTS profile as Denenir", () => {
    const report = generateFootballPredictionCandidates(readyFeature);
    const btts = report.candidates.find((candidate) => candidate.prediction_type === "both_teams_to_score");

    expect(btts?.prediction_value).toBe("yes");
    expect(btts?.recommendation_tier).toBe("alternative");
  });

  it("can generate BTTS yes when profile is yes_lean", () => {
    const report = generateFootballPredictionCandidates({
      ...readyFeature,
      bttsProfile: "yes_lean",
      bttsSignalScore: 72,
      expectedHomeGoalsProxy: 1.8,
      expectedAwayGoalsProxy: 1.4,
      expectedTotalGoalsProxy: undefined,
      goalProfile: "unknown"
    });
    const btts = report.candidates.find((candidate) => candidate.prediction_type === "both_teams_to_score");

    expect(btts).toMatchObject({
      prediction_value: "yes",
      recommendation_tier: "try"
    });
  });

  it("enforces compact candidate counts", () => {
    const report = generateFootballPredictionCandidates(readyFeature);

    expect(report.candidates.filter((candidate) => candidate.recommendation_tier === "primary")).toHaveLength(1);
    expect(report.candidates.filter((candidate) => candidate.recommendation_tier === "try").length).toBeLessThanOrEqual(2);
    expect(report.candidates.filter((candidate) => candidate.recommendation_tier === "alternative").length).toBeLessThanOrEqual(1);
    expect(report.candidates.filter((candidate) => candidate.recommendation_tier === "avoid").length).toBeLessThanOrEqual(1);
    expect(report.candidates.length).toBeLessThanOrEqual(5);
  });

  it("keeps Dortmund/Freiburg-like output causal and compact", () => {
    const report = generateFootballPredictionCandidates(readyFeature);

    expect(report.candidates.find((candidate) => candidate.recommendation_tier === "primary")).toMatchObject({
      prediction_type: "match_result_1x2",
      prediction_value: "1"
    });
    expect(report.candidates.find((candidate) => candidate.prediction_value === "over_2_5")?.recommendation_tier).toMatch(/try|alternative/);
    expect(report.candidates.find((candidate) => candidate.prediction_type === "both_teams_to_score")?.recommendation_tier).not.toBe("try");
    expect(report.candidates.find((candidate) => candidate.prediction_type === "first_half_over_0_5")).toMatchObject({
      recommendation_tier: "avoid",
      prediction_value: "avoid_missing_first_half_evidence"
    });
    expect(report.warnings).toContain("H2H sample is missing; confidence is capped and candidates require extra caution.");
  });

  it("does not generate contradictory double chance against a primary match result", () => {
    const report = generateFootballPredictionCandidates(readyFeature);
    const primary = report.candidates.find((candidate) => candidate.recommendation_tier === "primary");
    const doubleChance = report.candidates.find((candidate) => candidate.prediction_type === "double_chance");

    if (primary?.prediction_value === "1") expect(doubleChance?.prediction_value).not.toBe("X2");
    if (primary?.prediction_value === "2") expect(doubleChance?.prediction_value).not.toBe("1X");
  });

  it("produces recommendation tiers and Turkish display labels", () => {
    const report = generateFootballPredictionCandidates(readyFeature);

    expect(report.candidates.map((candidate) => candidate.display_label)).toEqual(expect.arrayContaining(["Tahminim", "Denenir", "Uzak Dur"]));
  });

  it("returns analysis-only when no candidate reaches primary threshold", () => {
    const report = generateFootballPredictionCandidates({
      ...readyFeature,
      homeRecentPoints: 6,
      awayRecentPoints: 6,
      homeAvgGoalsFor: 1,
      awayAvgGoalsFor: 1,
      homeAttackStrengthProxy: 1,
      awayAttackStrengthProxy: 1,
      standingsPositionDiff: 0,
      standingsPointsDiff: 0,
      expectedTotalGoalsProxy: undefined,
      expectedHomeGoalsProxy: undefined,
      expectedAwayGoalsProxy: undefined,
      homeGoalSignalScore: undefined,
      awayGoalSignalScore: undefined,
      goalProfile: "unknown",
      bttsProfile: "unknown"
    });

    expect(report.candidates.some((candidate) => candidate.recommendation_tier === "primary")).toBe(false);
    expect(report.warnings).toContain("No primary candidate reached the dry-run threshold.");
  });
});
