import { describe, expect, it } from "vitest";
import { FootballPublicEligibilityEvaluator } from "./football-public-eligibility-evaluator.js";
import type { FootballPublicEligibilityInput } from "./football-public-eligibility-evaluator.js";

const evaluator = new FootballPublicEligibilityEvaluator();

describe("FootballPublicEligibilityEvaluator", () => {
  it("marks settled_success primary warning predictions as eligible candidates", () => {
    const result = evaluator.evaluate(baseInput());

    expect(result.eligible).toBe(true);
    expect(result.suggestedPublicTitle).toContain("Borussia Dortmund");
    expect(result.warnings).toContain("Consistency warning requires internal review before public eligibility.");
  });

  it("marks settled_success try warning predictions as eligible candidates", () => {
    const result = evaluator.evaluate(
      baseInput({
        prediction: { recommendationTier: "try", predictionType: "double_chance", predictionValue: "1X", displayLabel: "Denenir" }
      })
    );

    expect(result.eligible).toBe(true);
    expect(result.sourceClassification.recommendationTier).toBe("try");
  });

  it("excludes settled_failed predictions", () => {
    const result = evaluator.evaluate(
      baseInput({
        prediction: { status: "settled_failed" },
        settlement: { settlementStatus: "settled_failed" }
      })
    );

    expect(result.eligible).toBe(false);
    expect(result.blockers).toContain("Prediction output status is not settled_success.");
    expect(result.blockers).toContain("Settlement status is not settled_success.");
  });

  it("excludes avoid and audit-only predictions even when settlement succeeded", () => {
    const result = evaluator.evaluate(
      baseInput({
        prediction: { recommendationTier: "avoid", consistencyStatus: "blocked" },
        settlement: { settlementMetadata: { blockedOrAvoidAuditOnly: true } }
      })
    );

    expect(result.eligible).toBe(false);
    expect(result.blockers).toContain("Prediction is audit-only and cannot become public.");
    expect(result.blockers).toContain("Consistency status is not passed or warning.");
  });

  it("excludes predictions with blocking conflicts", () => {
    const result = evaluator.evaluate(
      baseInput({
        conflicts: [{ severity: "blocking", conflictType: "first_half_goal_conflict", reason: "Missing evidence." }]
      })
    );

    expect(result.eligible).toBe(false);
    expect(result.blockers).toContain("Prediction has blocking conflicts.");
  });

  it("excludes predictions generated after kickoff", () => {
    const result = evaluator.evaluate(
      baseInput({
        prediction: { generatedAt: "2026-04-26T18:00:00.000Z" }
      })
    );

    expect(result.eligible).toBe(false);
    expect(result.blockers).toContain("Prediction was generated after match kickoff.");
  });

  it("excludes unsafe metadata without leaking it into public summaries", () => {
    const result = evaluator.evaluate(
      baseInput({
        prediction: { metadataJson: { database_url: "postgres://secret" } }
      })
    );

    expect(result.eligible).toBe(false);
    expect(result.blockers).toContain("Metadata contains unsafe or raw internal fields.");
    expect(JSON.stringify(result)).not.toContain("postgres://secret");
  });
});

function baseInput(overrides: {
  prediction?: Partial<FootballPublicEligibilityInput["prediction"]>;
  settlement?: Partial<NonNullable<FootballPublicEligibilityInput["settlement"]>>;
  conflicts?: FootballPublicEligibilityInput["conflicts"];
} = {}): FootballPublicEligibilityInput {
  return {
    prediction: {
      id: "prediction-1",
      matchId: "match-1",
      status: "settled_success",
      predictionType: "match_result_1x2",
      predictionValue: "1",
      recommendationTier: "primary",
      displayLabel: "Tahminim",
      confidenceScore: 65,
      consistencyStatus: "warning",
      blockingConflictCount: 0,
      generatedAt: "2026-04-26T10:00:00.000Z",
      metadataJson: { source: "unit-test" },
      ...overrides.prediction
    },
    settlement: {
      settlementStatus: "settled_success",
      actualResult: "fulltime=3-2; result=1",
      settlementMetadata: {},
      ...overrides.settlement
    },
    match: {
      id: "match-1",
      kickoffAt: "2026-04-26T17:30:00.000Z",
      homeTeamName: "Borussia Dortmund",
      awayTeamName: "Freiburg",
      competitionName: "Bundesliga"
    },
    conflicts: overrides.conflicts ?? []
  };
}
