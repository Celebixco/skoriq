import { describe, expect, it } from "vitest";
import { FootballPredictionSettlementEngine } from "./football-prediction-settlement-engine.js";

const engine = new FootballPredictionSettlementEngine();

const baseInput = {
  prediction: {
    id: "prediction-1",
    matchId: "match-1",
    predictionType: "match_result_1x2",
    predictionValue: "1",
    consistencyStatus: "warning",
    recommendationTier: "primary"
  },
  match: {
    id: "match-1",
    status: "finished" as const
  },
  score: {
    homeScoreFulltime: 2,
    awayScoreFulltime: 1,
    homeScoreHalftime: 1,
    awayScoreHalftime: 0
  },
  evaluatedAt: new Date("2026-04-30T12:00:00.000Z")
};

describe("FootballPredictionSettlementEngine", () => {
  it("settles match_result_1x2 success and failure", () => {
    expect(engine.settle(baseInput)).toMatchObject({
      settlementStatus: "settled_success",
      actualResult: "fulltime=2-1; result=1"
    });

    expect(engine.settle({ ...baseInput, prediction: { ...baseInput.prediction, predictionValue: "2" } })).toMatchObject({
      settlementStatus: "settled_failed"
    });
  });

  it("settles double chance outcomes", () => {
    expect(engine.settle({ ...baseInput, prediction: { ...baseInput.prediction, predictionType: "double_chance", predictionValue: "1X" } })).toMatchObject({
      settlementStatus: "settled_success"
    });

    expect(engine.settle({ ...baseInput, prediction: { ...baseInput.prediction, predictionType: "double_chance", predictionValue: "X2" } })).toMatchObject({
      settlementStatus: "settled_failed"
    });
  });

  it("settles over and under goals", () => {
    expect(engine.settle({ ...baseInput, prediction: { ...baseInput.prediction, predictionType: "over_under_goals", predictionValue: "over_2_5" } })).toMatchObject({
      settlementStatus: "settled_success"
    });

    expect(engine.settle({ ...baseInput, prediction: { ...baseInput.prediction, predictionType: "over_under_goals", predictionValue: "under_2_5" } })).toMatchObject({
      settlementStatus: "settled_failed"
    });
  });

  it("settles both teams to score", () => {
    expect(engine.settle({ ...baseInput, prediction: { ...baseInput.prediction, predictionType: "both_teams_to_score", predictionValue: "yes" } })).toMatchObject({
      settlementStatus: "settled_success"
    });

    expect(engine.settle({ ...baseInput, prediction: { ...baseInput.prediction, predictionType: "both_teams_to_score", predictionValue: "no" } })).toMatchObject({
      settlementStatus: "settled_failed"
    });
  });

  it("settles first_half_over_0_5 and voids missing halftime scores", () => {
    expect(engine.settle({ ...baseInput, prediction: { ...baseInput.prediction, predictionType: "first_half_over_0_5", predictionValue: "avoid_missing_first_half_evidence" } })).toMatchObject({
      settlementStatus: "settled_success",
      actualResult: "halftime=1-0; halftime_total=1"
    });

    expect(
      engine.settle({
        ...baseInput,
        prediction: { ...baseInput.prediction, predictionType: "first_half_over_0_5", predictionValue: "avoid_missing_first_half_evidence" },
        score: { ...baseInput.score, homeScoreHalftime: null }
      })
    ).toMatchObject({
      settlementStatus: "settled_void",
      actualResult: "missing_halftime_score"
    });
  });

  it("voids missing final score, unsupported type, unsupported value, and non-final match", () => {
    expect(engine.settle({ ...baseInput, score: { ...baseInput.score, homeScoreFulltime: null } })).toMatchObject({
      settlementStatus: "settled_void",
      actualResult: "missing_final_score"
    });

    expect(engine.settle({ ...baseInput, prediction: { ...baseInput.prediction, predictionType: "exact_score", predictionValue: "2-1" } })).toMatchObject({
      settlementStatus: "settled_void",
      actualResult: "unsupported_prediction_type"
    });

    expect(engine.settle({ ...baseInput, prediction: { ...baseInput.prediction, predictionType: "double_chance", predictionValue: "home_or_draw" } })).toMatchObject({
      settlementStatus: "settled_void",
      actualResult: "unsupported_prediction_value"
    });

    expect(engine.settle({ ...baseInput, match: { ...baseInput.match, status: "scheduled" } })).toMatchObject({
      settlementStatus: "settled_void",
      actualResult: "match_not_final"
    });
  });

  it("marks blocked/avoid outputs as audit-only metadata without blocking internal settlement", () => {
    const result = engine.settle({
      ...baseInput,
      prediction: {
        ...baseInput.prediction,
        consistencyStatus: "blocked",
        recommendationTier: "avoid"
      }
    });

    expect(result.settlementStatus).toBe("settled_success");
    expect(result.settlementMetadata.blockedOrAvoidAuditOnly).toBe(true);
  });
});
