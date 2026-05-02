import { describe, expect, it, vi } from "vitest";
import { checkDatabaseReadiness } from "./db-readiness.js";
import {
  parseFootballMatchPredictionAnalyticsArgs,
  runFootballMatchPredictionAnalytics,
  validateFootballMatchPredictionAnalyticsOptions
} from "./analytics-football-match-prediction-features-build.js";
import type {
  FootballMatchPredictionAnalyticsDependencies,
  FootballMatchPredictionAnalyticsOptions
} from "./analytics-football-match-prediction-features-build.js";

const baseOptions: FootballMatchPredictionAnalyticsOptions = {
  execute: false,
  reportJson: false,
  matchId: "match-1",
  formWindowSize: 5,
  h2hWindowSize: 5
};

const baseEnv = {
  NODE_ENV: "development",
  DATABASE_URL: "postgres://user:secret@localhost:5432/sports_data"
};

describe("football match prediction feature runner", () => {
  it("defaults to dry-run with 5-match form and H2H windows", () => {
    expect(parseFootballMatchPredictionAnalyticsArgs(["--match-id=match-1"])).toMatchObject({
      execute: false,
      reportJson: false,
      matchId: "match-1",
      formWindowSize: 5,
      h2hWindowSize: 5
    });
  });

  it("parses execute, JSON report, and custom windows", () => {
    expect(parseFootballMatchPredictionAnalyticsArgs(["--execute", "--report-json", "--match-id=match-1", "--form-window-size=10", "--h2h-window-size=3"])).toMatchObject({
      execute: true,
      reportJson: true,
      matchId: "match-1",
      formWindowSize: 10,
      h2hWindowSize: 3
    });
  });

  it("requires match mode for now", () => {
    expect(() => validateFootballMatchPredictionAnalyticsOptions({ ...baseOptions, matchId: undefined }, baseEnv)).toThrow(
      "Football match prediction feature analytics requires --match-id."
    );
  });

  it("blocks competition mode until it is explicitly implemented", () => {
    expect(() => validateFootballMatchPredictionAnalyticsOptions({ ...baseOptions, competitionId: "competition-1" }, baseEnv)).toThrow(
      "Competition-level football match prediction feature builds are not implemented yet; use --match-id."
    );
  });

  it("blocks production usage", () => {
    expect(() => validateFootballMatchPredictionAnalyticsOptions(baseOptions, { ...baseEnv, NODE_ENV: "production" })).toThrow(
      "Football match prediction feature runner is forbidden in production."
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

  it("dry-run calculates features without reporting writes", async () => {
    const dependencies = mockDependencies();

    const result = await runFootballMatchPredictionAnalytics(baseOptions, dependencies);

    expect(dependencies.buildForMatch).toHaveBeenCalledWith("match-1", {
      formWindowSize: 5,
      h2hWindowSize: 5
    });
    expect(result.report).toMatchObject({
      mode: "dry-run",
      features_calculated: 1,
      features_written: 0,
      feature_status_counts: { partial: 1 }
    });
  });

  it("execute mode reports written rows and post-run verification", async () => {
    const result = await runFootballMatchPredictionAnalytics(
      { ...baseOptions, execute: true },
      mockDependencies({ queryPostRunVerification: vi.fn().mockResolvedValue({ footballMatchPredictionFeaturesCount: 1 }) })
    );

    expect(result.report).toMatchObject({
      mode: "execute",
      features_written: 1,
      post_run_verification: {
        footballMatchPredictionFeaturesCount: 1
      }
    });
  });

  it("persists a sanitized JSON report when requested", async () => {
    const persistRunReport = vi.fn();
    const log = vi.fn();

    await runFootballMatchPredictionAnalytics({ ...baseOptions, reportJson: true }, mockDependencies({ persistRunReport, log }));

    expect(persistRunReport).toHaveBeenCalledOnce();
    const output = log.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(output).not.toContain("postgres://");
    expect(output).not.toContain("secret");
    expect(output).not.toContain("DATABASE_URL");
  });
});

function mockDependencies(overrides: Partial<FootballMatchPredictionAnalyticsDependencies> = {}): FootballMatchPredictionAnalyticsDependencies {
  return {
    buildForMatch: vi.fn().mockResolvedValue({
      changedFeatureRows: 1,
      calculatedFeatures: [
        {
          matchId: "match-1",
          competitionId: "competition-1",
          seasonId: null,
          homeTeamId: "team-home",
          awayTeamId: "team-away",
          asOfDate: new Date("2026-04-24T18:30:00.000Z"),
          formWindowSize: 5,
          h2hWindowSize: 5,
          homeFormFeatureId: "home-form-1",
          awayFormFeatureId: "away-form-1",
          combinedCoverageScore: 53.33,
          featureStatus: "partial",
          metadataJson: {}
        }
      ]
    }),
    log: vi.fn(),
    ...overrides
  };
}
