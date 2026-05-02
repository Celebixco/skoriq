import { describe, expect, it, vi } from "vitest";
import { checkDatabaseReadiness } from "./db-readiness.js";
import { parseFootballMatchReasoningArgs, runFootballMatchReasoning, validateFootballMatchReasoningOptions } from "./analytics-football-reasoning-build.js";
import type { FootballMatchReasoningDependencies, FootballMatchReasoningOptions } from "./analytics-football-reasoning-build.js";

const baseOptions: FootballMatchReasoningOptions = {
  matchId: "match-1",
  formWindowSize: 5,
  h2hWindowSize: 5,
  reportJson: false
};

const baseEnv = {
  NODE_ENV: "development",
  DATABASE_URL: "postgres://user:secret@localhost:5432/sports_data"
};

describe("football match reasoning runner", () => {
  it("parses match id and defaults to read-only dry-run windows", () => {
    expect(parseFootballMatchReasoningArgs(["--match-id=match-1"])).toMatchObject({
      matchId: "match-1",
      formWindowSize: 5,
      h2hWindowSize: 5,
      reportJson: false
    });
  });

  it("parses custom windows and report-json", () => {
    expect(parseFootballMatchReasoningArgs(["--match-id=match-1", "--form-window-size=10", "--h2h-window-size=3", "--report-json"])).toMatchObject({
      matchId: "match-1",
      formWindowSize: 10,
      h2hWindowSize: 3,
      reportJson: true
    });
  });

  it("rejects execute because reasoning is read-only", () => {
    expect(() => parseFootballMatchReasoningArgs(["--match-id=match-1", "--execute"])).toThrow("Football match reasoning is read-only; --execute is not supported.");
  });

  it("requires match id and blocks production", () => {
    expect(() => validateFootballMatchReasoningOptions({ ...baseOptions, matchId: undefined }, baseEnv)).toThrow("Football match reasoning requires --match-id.");
    expect(() => validateFootballMatchReasoningOptions(baseOptions, { ...baseEnv, NODE_ENV: "production" })).toThrow(
      "Football match reasoning runner is forbidden in production."
    );
  });

  it("keeps unsafe remote databases blocked through shared readiness logic", async () => {
    const result = await checkDatabaseReadiness({
      databaseUrl: "postgres://user:secret@db.example.internal/sports_data",
      nodeEnv: "development",
      connect: async () => ({ tableNames: [] })
    });

    expect(result).toMatchObject({ status: "not_ready", reason: "unsafe_target" });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("builds a reasoning report without writing or calling providers", async () => {
    const dependencies = mockDependencies();

    const result = await runFootballMatchReasoning(baseOptions, dependencies);

    expect(dependencies.findPredictionFeature).toHaveBeenCalledWith("match-1", 5, 5);
    expect(result.report.reasoning).toMatchObject({
      match_id: "match-1",
      feature_status: "ready",
      prediction_eligible: true,
      kupon_eligible: false,
      confidence_ceiling: 65
    });
    expect(result.report.result).toBe("success");
  });

  it("reports missing prediction feature as failed without secrets", async () => {
    const log = vi.fn();
    const result = await runFootballMatchReasoning(baseOptions, mockDependencies({ findPredictionFeature: vi.fn().mockResolvedValue(undefined), log }));

    expect(result.report.result).toBe("failed");
    expect(result.report.warnings).toContain("No football_match_prediction_features row found for the selected match/windows.");
    expect(log.mock.calls.join("\n")).not.toContain("postgres://");
    expect(log.mock.calls.join("\n")).not.toContain("secret");
  });

  it("persists a sanitized JSON report when requested", async () => {
    const persistRunReport = vi.fn();
    const log = vi.fn();

    await runFootballMatchReasoning({ ...baseOptions, reportJson: true }, mockDependencies({ persistRunReport, log }));

    expect(persistRunReport).toHaveBeenCalledOnce();
    expect(log.mock.calls.join("\n")).not.toContain("DATABASE_URL");
  });
});

function mockDependencies(overrides: Partial<FootballMatchReasoningDependencies> = {}): FootballMatchReasoningDependencies {
  return {
    findPredictionFeature: vi.fn().mockResolvedValue({
      matchId: "match-1",
      featureStatus: "ready",
      homeFormFeatureId: "home-form-1",
      awayFormFeatureId: "away-form-1",
      h2hFeatureId: "h2h-1",
      homeFormCoverageScore: 70,
      awayFormCoverageScore: 58,
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
    }),
    log: vi.fn(),
    ...overrides
  };
}
