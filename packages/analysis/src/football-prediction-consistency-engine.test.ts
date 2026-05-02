import { describe, expect, it } from "vitest";
import { generateFootballPredictionCandidates } from "./football-prediction-candidate-generator.js";
import { FootballPredictionConsistencyEngine } from "./football-prediction-consistency-engine.js";
import type { FootballPredictionCandidate, FootballPredictionCandidateFeature } from "./football-prediction-candidate-generator.js";

const engine = new FootballPredictionConsistencyEngine();

describe("FootballPredictionConsistencyEngine", () => {
  it("blocks goal-required candidates for a 0-0 expectation", () => {
    const result = engine.checkCandidateBundle(bundle([candidate("over_under_goals", "over_2_5", "total_goals"), candidate("both_teams_to_score", "yes", "both_teams_to_score")], "0-0"));

    expect(result.candidates.every((item) => item.consistency_status === "blocked")).toBe(true);
    expect(result.blockingConflictCount).toBeGreaterThanOrEqual(2);
  });

  it("blocks BTTS yes and over 2.5 for a 1-0 expectation", () => {
    const result = engine.checkCandidateBundle(bundle([candidate("both_teams_to_score", "yes", "both_teams_to_score"), candidate("over_under_goals", "over_2_5", "total_goals")], "1-0"));

    expect(result.candidates.every((item) => item.consistency_status === "blocked")).toBe(true);
  });

  it("blocks BTTS no and under 1.5 for a 2-1 expectation", () => {
    const result = engine.checkCandidateBundle(bundle([candidate("both_teams_to_score", "no", "both_teams_to_score"), candidate("over_under_goals", "under_1_5", "total_goals")], "2-1"));

    expect(result.candidates.every((item) => item.consistency_status === "blocked")).toBe(true);
  });

  it("moves blocked recommendation candidates to avoid so they are not presented as recommendations", () => {
    const result = engine.checkCandidateBundle(
      bundle([candidate("both_teams_to_score", "no", "both_teams_to_score", 52, "alternative")], "2-1")
    );

    expect(result.candidates[0]).toMatchObject({
      consistency_status: "blocked",
      recommendation_tier: "avoid",
      display_label: "Uzak Dur",
      risk_level: "high"
    });
    expect(result.candidates[0]?.reasoning_summary).toContain("tutarlılık kontrolünden geçmediği için öneri olarak gösterilmez");
    expect(result.candidates.filter((item) => ["primary", "try", "alternative"].includes(item.recommendation_tier) && item.consistency_status === "blocked")).toHaveLength(0);
  });

  it("blocks BTTS yes when under 1.5 is in the same bundle", () => {
    const result = engine.checkCandidateBundle(bundle([candidate("both_teams_to_score", "yes", "both_teams_to_score"), candidate("over_under_goals", "under_1_5", "total_goals")], undefined, 1.2));

    expect(result.conflicts).toEqual(expect.arrayContaining([expect.objectContaining({ conflictType: "btts_scoreline_conflict", severity: "blocking" })]));
  });

  it("blocks 1X when a strong away-win candidate exists", () => {
    const result = engine.checkCandidateBundle(
      bundle([candidate("double_chance", "1X", "double_chance", 62), candidate("match_result_1x2", "2", "match_result", 68)], undefined, 2.2)
    );

    expect(result.candidates.find((item) => item.prediction_type === "double_chance")?.consistency_status).toBe("blocked");
  });

  it("blocks avoid first-half candidates with missing evidence", () => {
    const result = engine.checkCandidateBundle(bundle([candidate("first_half_over_0_5", "avoid_missing_first_half_evidence", "first_half_goals", 45, "avoid")]));

    expect(result.candidates[0]?.consistency_status).toBe("blocked");
    expect(result.conflicts[0]?.reason).toBe("First-half evidence is missing; candidate must not be recommended.");
  });

  it("marks missing H2H as warning, not blocking", () => {
    const result = engine.checkCandidateBundle(bundle([candidate("match_result_1x2", "1", "match_result")], undefined, 2.4, true));

    expect(result.candidates[0]?.consistency_status).toBe("warning");
    expect(result.blockingConflictCount).toBe(0);
    expect(result.warningConflictCount).toBe(1);
  });

  it("uses high goal profile to support over 2.5 and warn under 2.5", () => {
    const overResult = engine.checkCandidateBundle(
      bundleWithMetadata([candidate("over_under_goals", "over_2_5", "total_goals")], {
        goal_profile: "high_goal",
        expected_total_goals: 3.1
      })
    );
    const underResult = engine.checkCandidateBundle(
      bundleWithMetadata([candidate("over_under_goals", "under_2_5", "total_goals")], {
        goal_profile: "high_goal",
        expected_total_goals: 3.1
      })
    );

    expect(overResult.candidates[0]?.consistency_status).toBe("passed");
    expect(underResult.candidates[0]?.consistency_status).toBe("warning");
  });

  it("blocks over 2.5 for low goal profile and low expected total", () => {
    const result = engine.checkCandidateBundle(
      bundleWithMetadata([candidate("over_under_goals", "over_2_5", "total_goals")], {
        goal_profile: "low_goal",
        expected_total_goals: 1.4
      })
    );

    expect(result.candidates[0]?.consistency_status).toBe("blocked");
    expect(result.conflicts).toEqual(expect.arrayContaining([expect.objectContaining({ conflictType: "low_goal_high_goal_conflict", severity: "blocking" })]));
  });

  it("supports over 1.5 but warns over 2.5 for medium goal profile", () => {
    const over15Result = engine.checkCandidateBundle(
      bundleWithMetadata([candidate("over_under_goals", "over_1_5", "total_goals")], {
        goal_profile: "medium_goal",
        expected_total_goals: 2.1
      })
    );
    const over25Result = engine.checkCandidateBundle(
      bundleWithMetadata([candidate("over_under_goals", "over_2_5", "total_goals", 60)], {
        goal_profile: "medium_goal",
        expected_total_goals: 2.1
      })
    );

    expect(over15Result.candidates[0]?.consistency_status).toBe("passed");
    expect(over25Result.candidates[0]?.consistency_status).toBe("warning");
  });

  it("blocks recommended first_half_over_0_5 when first-half profile is unknown", () => {
    const result = engine.checkCandidateBundle(
      bundleWithMetadata([candidate("first_half_over_0_5", "over_0_5", "first_half_goals")], {
        first_half_goal_profile: "unknown"
      })
    );

    expect(result.candidates[0]?.consistency_status).toBe("blocked");
  });

  it("allows recommended first_half_over_0_5 when first-half profile is likely", () => {
    const result = engine.checkCandidateBundle(
      bundleWithMetadata([candidate("first_half_over_0_5", "over_0_5", "first_half_goals")], {
        first_half_goal_profile: "likely_goal"
      })
    );

    expect(result.candidates[0]?.consistency_status).toBe("passed");
  });

  it("warns BTTS yes for balanced profile", () => {
    const result = engine.checkCandidateBundle(
      bundleWithMetadata([candidate("both_teams_to_score", "yes", "both_teams_to_score")], {
        btts_profile: "balanced",
        expected_home_goals: 1.4,
        expected_away_goals: 1.1
      })
    );

    expect(result.candidates[0]?.consistency_status).toBe("warning");
    expect(result.conflicts).toEqual(expect.arrayContaining([expect.objectContaining({ conflictType: "missing_evidence_warning", severity: "warning" })]));
  });

  it("blocks BTTS yes for no-lean profile", () => {
    const result = engine.checkCandidateBundle(
      bundleWithMetadata([candidate("both_teams_to_score", "yes", "both_teams_to_score", 60)], {
        btts_profile: "no_lean",
        expected_home_goals: 1.4,
        expected_away_goals: 1.1
      })
    );

    expect(result.candidates[0]?.consistency_status).toBe("blocked");
  });

  it("warns BTTS yes when one expected team-goal proxy is very low", () => {
    const result = engine.checkCandidateBundle(
      bundleWithMetadata([candidate("both_teams_to_score", "yes", "both_teams_to_score", 54)], {
        btts_profile: "yes_lean",
        expected_home_goals: 1.7,
        expected_away_goals: 0.7
      })
    );

    expect(result.candidates[0]?.consistency_status).toBe("warning");
  });

  it("warns weak away team total candidates", () => {
    const result = engine.checkCandidateBundle(
      bundleWithMetadata([candidate("team_total_goals", "away_team_over_0_5", "team_total_goals", 54)], {
        away_team_goal_profile: "weak",
        expected_away_goals: 0.9
      })
    );

    expect(result.candidates[0]?.consistency_status).toBe("warning");
  });

  it("validates Dortmund vs Freiburg dry-run candidates with warnings and first-half block", () => {
    const report = generateFootballPredictionCandidates(dortmundVsFreiburgFeature);
    const result = engine.checkCandidateBundle(report);

    expect(result.candidates.find((item) => item.prediction_type === "match_result_1x2")?.consistency_status).toMatch(/passed|warning/);
    expect(result.candidates.find((item) => item.prediction_type === "double_chance")?.consistency_status).toMatch(/passed|warning/);
    expect(result.candidates.find((item) => item.prediction_value === "over_2_5")?.consistency_status).toBe("warning");
    expect(result.candidates.find((item) => item.prediction_type === "both_teams_to_score")?.recommendation_tier).not.toBe("try");
    expect(result.candidates.find((item) => item.prediction_type === "both_teams_to_score")?.consistency_status).toMatch(/passed|warning/);
    expect(result.candidates.find((item) => item.prediction_type === "first_half_over_0_5")?.consistency_status).toBe("blocked");
    expect(result.candidates.find((item) => item.prediction_type === "first_half_over_0_5")?.recommendation_tier).toBe("avoid");
    expect(result.blockingConflictCount).toBeGreaterThanOrEqual(1);
    expect(result.warningConflictCount).toBeGreaterThanOrEqual(1);
  });

  it("keeps Arsenal/Fulham-like blocked BTTS no under Uzak Dur instead of Alternatif", () => {
    const report = generateFootballPredictionCandidates(arsenalFulhamLikeFeature);
    const result = engine.checkCandidateBundle(report);
    const bttsNo = result.candidates.find((item) => item.prediction_type === "both_teams_to_score" && item.prediction_value === "no");

    expect(bttsNo).toMatchObject({
      consistency_status: "blocked",
      recommendation_tier: "avoid",
      display_label: "Uzak Dur"
    });
    expect(result.candidates.filter((item) => ["primary", "try", "alternative"].includes(item.recommendation_tier) && item.consistency_status === "blocked")).toHaveLength(0);
  });
});

function bundle(candidates: FootballPredictionCandidate[], expectedScoreline?: string, expectedTotalGoals = 2.4, h2hMissing = false) {
  return bundleWithMetadata(candidates, {
    expected_scoreline: expectedScoreline,
    expected_home_goals: expectedScoreline ? Number(expectedScoreline.split("-")[0]) : 1.2,
    expected_away_goals: expectedScoreline ? Number(expectedScoreline.split("-")[1]) : 1.2,
    expected_total_goals: expectedTotalGoals,
    h2h_missing: h2hMissing
  });
}

function bundleWithMetadata(candidates: FootballPredictionCandidate[], metadata: Record<string, unknown>) {
  return {
    matchId: "match-1",
    featureSnapshotId: "feature-1",
    generationMode: "dry_run" as const,
    candidates: candidates.map((item) => ({
      ...item,
      metadata: {
        ...item.metadata,
        ...metadata
      }
    })),
    warnings: [],
    blockedReasons: [],
    summary: "test"
  };
}

function candidate(
  predictionType: string,
  predictionValue: string,
  predictionFamily: FootballPredictionCandidate["prediction_family"],
  confidenceScore = 62,
  tier: FootballPredictionCandidate["recommendation_tier"] = "try"
): FootballPredictionCandidate {
  return {
    prediction_type: predictionType,
    prediction_value: predictionValue,
    prediction_family: predictionFamily,
    confidence_score: confidenceScore,
    risk_level: tier === "avoid" ? "high" : "medium",
    recommendation_tier: tier,
    display_label: tier === "avoid" ? "Uzak Dur" : tier === "primary" ? "Tahminim" : tier === "try" ? "Denenir" : "Alternatif",
    reasoning_summary: "test candidate",
    consistency_status: "unchecked",
    metadata: {}
  };
}

const dortmundVsFreiburgFeature: FootballPredictionCandidateFeature = {
  id: "feature-1",
  matchId: "match-1",
  featureStatus: "ready",
  homeFormFeatureId: "home-form-1",
  awayFormFeatureId: "away-form-1",
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

const arsenalFulhamLikeFeature: FootballPredictionCandidateFeature = {
  id: "feature-arsenal-fulham",
  matchId: "match-arsenal-fulham",
  featureStatus: "ready",
  homeFormFeatureId: "arsenal-home-form",
  awayFormFeatureId: "fulham-away-form",
  h2hFeatureId: "arsenal-fulham-h2h",
  homeFormCoverageScore: 58,
  awayFormCoverageScore: 46,
  h2hCoverageScore: 0,
  combinedCoverageScore: 52,
  homeRecentPoints: 10,
  awayRecentPoints: 3,
  homeAvgGoalsFor: 1.75,
  homeAvgGoalsAgainst: 0.75,
  awayAvgGoalsFor: 0,
  awayAvgGoalsAgainst: 0.67,
  homeAttackStrengthProxy: 1.75,
  awayAttackStrengthProxy: 0,
  homeDefenseStrengthProxy: 0.75,
  awayDefenseStrengthProxy: 0.67,
  expectedTotalGoalsProxy: 2.517,
  expectedHomeGoalsProxy: 1.867,
  expectedAwayGoalsProxy: 0.65,
  homeGoalSignalScore: 60.83,
  awayGoalSignalScore: 20,
  firstHalfGoalSignalScore: 54.17,
  bttsSignalScore: 23.75,
  goalProfile: "medium_goal",
  firstHalfGoalProfile: "unknown",
  bttsProfile: "no_lean",
  homeTeamGoalProfile: "moderate",
  awayTeamGoalProfile: "weak",
  standingsPositionDiff: -5,
  standingsPointsDiff: 7,
  metadataJson: {
    h2hMissing: true,
    sampleSizes: {
      homeForm: 4,
      awayForm: 3,
      h2h: 0
    }
  }
};
