import { describe, expect, it, vi } from "vitest";
import {
  parseFootballPredictionSettlementArgs,
  runFootballPredictionSettlement,
  validateFootballPredictionSettlementOptions
} from "./analytics-football-predictions-settle.js";
import type { FootballPredictionSettlementDependencies, FootballPredictionSettlementRunnerOptions } from "./analytics-football-predictions-settle.js";

const baseOptions: FootballPredictionSettlementRunnerOptions = {
  execute: false,
  reportJson: false,
  matchId: "match-1"
};

const baseEnv = {
  NODE_ENV: "development",
  DATABASE_URL: "postgres://user:secret@localhost:5432/sports_data"
};

describe("football prediction settlement runner", () => {
  it("parses dry-run and execute options", () => {
    expect(parseFootballPredictionSettlementArgs(["--match-id=match-1"])).toEqual(baseOptions);
    expect(parseFootballPredictionSettlementArgs(["--prediction-id=prediction-1", "--execute", "--report-json"])).toEqual({
      execute: true,
      reportJson: true,
      predictionId: "prediction-1"
    });
  });

  it("validates target and production safety", () => {
    expect(() => validateFootballPredictionSettlementOptions({ execute: false, reportJson: false }, baseEnv)).toThrow("requires --match-id or --prediction-id");
    expect(() => validateFootballPredictionSettlementOptions({ ...baseOptions, predictionId: "prediction-1" }, baseEnv)).toThrow("not both");
    expect(() => validateFootballPredictionSettlementOptions(baseOptions, { ...baseEnv, NODE_ENV: "production" })).toThrow("forbidden in production");
  });

  it("runs dry-run settlement without writes or provider calls", async () => {
    const dependencies = mockDependencies();

    const result = await runFootballPredictionSettlement(baseOptions, dependencies);

    expect(dependencies.listContextsByMatchId).toHaveBeenCalledWith("match-1");
    expect(dependencies.persistSettlement).not.toHaveBeenCalled();
    expect(result.report.evaluated_outputs_count).toBe(2);
    expect(result.report.written_settlements_count).toBe(0);
    expect(result.report.results_by_status).toEqual({ settled_success: 2 });
    expect(JSON.stringify(result)).not.toContain("postgres://");
  });

  it("executes settlement writes only with --execute", async () => {
    const dependencies = mockDependencies();

    const result = await runFootballPredictionSettlement({ ...baseOptions, execute: true }, dependencies);

    expect(dependencies.persistSettlement).toHaveBeenCalledTimes(2);
    expect(result.report.written_settlements_count).toBe(2);
    expect(result.report.warnings).toContain(
      "Settlement execute updated internal output statuses only; no member visibility, public publishing, or tahmin kombini action was performed."
    );
  });

  it("settles one prediction-id target", async () => {
    const dependencies = mockDependencies();

    await runFootballPredictionSettlement({ execute: false, reportJson: false, predictionId: "prediction-1" }, dependencies);

    expect(dependencies.findContextByPredictionId).toHaveBeenCalledWith("prediction-1");
    expect(dependencies.listContextsByMatchId).not.toHaveBeenCalled();
  });

  it("reports voids for missing source data without writing in dry-run", async () => {
    const dependencies = mockDependencies({
      listContextsByMatchId: vi.fn().mockResolvedValue([
        {
          ...baseContext,
          predictionOutput: { ...baseContext.predictionOutput, id: "prediction-void", predictionType: "over_under_goals", predictionValue: "over_2_5" },
          score: null
        }
      ])
    });

    const result = await runFootballPredictionSettlement(baseOptions, dependencies);

    expect(result.report.results_by_status).toEqual({ settled_void: 1 });
    expect(result.report.settlements[0]?.actualResult).toBe("missing_score");
    expect(dependencies.persistSettlement).not.toHaveBeenCalled();
  });
});

const baseContext = {
  predictionOutput: {
    id: "prediction-1",
    matchId: "match-1",
    predictionType: "match_result_1x2",
    predictionValue: "1",
    status: "draft",
    consistencyStatus: "warning",
    recommendationTier: "primary"
  },
  match: {
    id: "match-1",
    status: "finished"
  },
  score: {
    homeScoreFulltime: 2,
    awayScoreFulltime: 1,
    homeScoreHalftime: 1,
    awayScoreHalftime: 0
  }
};

function mockDependencies(overrides: Partial<FootballPredictionSettlementDependencies> = {}): FootballPredictionSettlementDependencies {
  return {
    listContextsByMatchId: vi.fn().mockResolvedValue([
      baseContext,
      {
        ...baseContext,
        predictionOutput: {
          ...baseContext.predictionOutput,
          id: "prediction-2",
          predictionType: "double_chance",
          predictionValue: "1X",
          recommendationTier: "try"
        }
      }
    ]),
    findContextByPredictionId: vi.fn().mockResolvedValue(baseContext),
    persistSettlement: vi.fn().mockResolvedValue(undefined),
    log: vi.fn(),
    ...overrides
  };
}
