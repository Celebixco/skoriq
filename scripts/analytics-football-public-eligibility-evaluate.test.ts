import { describe, expect, it, vi } from "vitest";
import {
  parseFootballPublicEligibilityArgs,
  runFootballPublicEligibilityEvaluation,
  validateFootballPublicEligibilityOptions
} from "./analytics-football-public-eligibility-evaluate.js";
import type { FootballPublicEligibilityDependencies, FootballPublicEligibilityRunnerOptions } from "./analytics-football-public-eligibility-evaluate.js";

const matchId = "89759e35-758d-416e-b0d3-ad07436c8a9b";
const predictionId = "11111111-1111-4111-8111-111111111111";
const baseOptions: FootballPublicEligibilityRunnerOptions = {
  json: false,
  matchId
};
const baseEnv = {
  NODE_ENV: "development",
  DATABASE_URL: "postgres://user:secret@localhost:5432/sports_data"
};

describe("football public eligibility evaluator runner", () => {
  it("parses dry-run-only options", () => {
    expect(parseFootballPublicEligibilityArgs([`--match-id=${matchId}`])).toEqual(baseOptions);
    expect(parseFootballPublicEligibilityArgs([`--prediction-id=${predictionId}`, "--json"])).toEqual({ json: true, predictionId });
    expect(() => parseFootballPublicEligibilityArgs([`--match-id=${matchId}`, "--execute"])).toThrow("dry-run only");
  });

  it("validates target, UUIDs, and production safety", () => {
    expect(() => validateFootballPublicEligibilityOptions({ json: false }, baseEnv)).toThrow("requires --match-id or --prediction-id");
    expect(() => validateFootballPublicEligibilityOptions({ ...baseOptions, predictionId }, baseEnv)).toThrow("not both");
    expect(() => validateFootballPublicEligibilityOptions({ ...baseOptions, matchId: "not-a-uuid" }, baseEnv)).toThrow("must be a UUID");
    expect(() => validateFootballPublicEligibilityOptions(baseOptions, { ...baseEnv, NODE_ENV: "production" })).toThrow("forbidden in production");
  });

  it("evaluates eligible and excluded outputs without writing rows or calling providers", async () => {
    const dependencies = mockDependencies();

    const result = await runFootballPublicEligibilityEvaluation(baseOptions, dependencies);

    expect(dependencies.listContextsByMatchId).toHaveBeenCalledWith(matchId);
    expect(result.report.written_rows_count).toBe(0);
    expect(result.report.eligible_count).toBe(1);
    expect(result.report.excluded_count).toBe(2);
    expect(result.report.eligible[0]?.suggestedPublicTitle).toContain("Borussia Dortmund");
    expect(result.report.excluded.map((item) => item.predictionValue)).toEqual(["yes", "avoid_missing_first_half_evidence"]);
    expect(JSON.stringify(result)).not.toContain("postgres://");
  });

  it("evaluates a single prediction-id target", async () => {
    const dependencies = mockDependencies();

    await runFootballPublicEligibilityEvaluation({ json: false, predictionId }, dependencies);

    expect(dependencies.findContextByPredictionId).toHaveBeenCalledWith(predictionId);
    expect(dependencies.listContextsByMatchId).not.toHaveBeenCalled();
  });

  it("reports missing settled outputs without writes", async () => {
    const dependencies = mockDependencies({ listContextsByMatchId: vi.fn().mockResolvedValue([]) });

    const result = await runFootballPublicEligibilityEvaluation(baseOptions, dependencies);

    expect(result.report.evaluated_outputs_count).toBe(0);
    expect(result.report.warnings).toContain("No settled prediction outputs were found for the selected target.");
    expect(result.report.written_rows_count).toBe(0);
  });
});

function mockDependencies(overrides: Partial<FootballPublicEligibilityDependencies> = {}): FootballPublicEligibilityDependencies {
  return {
    listContextsByMatchId: vi.fn().mockResolvedValue([eligibleContext(), failedContext(), avoidContext()]),
    findContextByPredictionId: vi.fn().mockResolvedValue(eligibleContext()),
    log: vi.fn(),
    ...overrides
  };
}

function eligibleContext() {
  return {
    prediction: {
      id: predictionId,
      matchId,
      status: "settled_success",
      predictionType: "match_result_1x2",
      predictionValue: "1",
      recommendationTier: "primary",
      displayLabel: "Tahminim",
      confidenceScore: 65,
      consistencyStatus: "warning",
      blockingConflictCount: 0,
      generatedAt: "2026-04-26T10:00:00.000Z",
      metadataJson: { source: "unit-test" }
    },
    settlement: {
      settlementStatus: "settled_success",
      actualResult: "fulltime=3-2; result=1",
      settlementMetadata: {}
    },
    match: {
      id: matchId,
      kickoffAt: "2026-04-26T17:30:00.000Z",
      homeTeamName: "Borussia Dortmund",
      awayTeamName: "Freiburg",
      competitionName: "Bundesliga"
    },
    conflicts: [{ severity: "warning", conflictType: "h2h_missing_warning", reason: "H2H missing." }]
  };
}

function failedContext() {
  return {
    ...eligibleContext(),
    prediction: {
      ...eligibleContext().prediction,
      id: "22222222-2222-4222-8222-222222222222",
      predictionType: "both_teams_to_score",
      predictionValue: "yes",
      recommendationTier: "try",
      status: "settled_failed"
    },
    settlement: {
      settlementStatus: "settled_failed",
      actualResult: "btts=no",
      settlementMetadata: {}
    }
  };
}

function avoidContext() {
  return {
    ...eligibleContext(),
    prediction: {
      ...eligibleContext().prediction,
      id: "33333333-3333-4333-8333-333333333333",
      predictionType: "first_half_over_0_5",
      predictionValue: "avoid_missing_first_half_evidence",
      recommendationTier: "avoid",
      consistencyStatus: "blocked",
      status: "settled_success"
    },
    settlement: {
      settlementStatus: "settled_success",
      actualResult: "halftime_total=1",
      settlementMetadata: { blockedOrAvoidAuditOnly: true }
    },
    conflicts: [{ severity: "blocking", conflictType: "first_half_goal_conflict", reason: "First-half evidence missing." }]
  };
}
