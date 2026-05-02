import { describe, expect, it, vi } from "vitest";
import { checkDatabaseReadiness } from "./db-readiness.js";
import {
  parseFootballH2HAnalyticsArgs,
  runFootballH2HAnalytics,
  validateFootballH2HAnalyticsOptions
} from "./analytics-football-h2h-build.js";
import type { FootballH2HAnalyticsDependencies, FootballH2HAnalyticsOptions } from "./analytics-football-h2h-build.js";

const baseOptions: FootballH2HAnalyticsOptions = {
  execute: false,
  reportJson: false,
  teamAId: "team-b",
  teamBId: "team-a",
  allowNullSeason: false,
  allApprovedFootball: false,
  windowSizes: [5, 10]
};

const baseEnv = {
  NODE_ENV: "development",
  DATABASE_URL: "postgres://user:secret@localhost:5432/sports_data"
};

describe("football H2H analytics runner", () => {
  it("defaults to dry-run with last-5/last-10 windows", () => {
    expect(parseFootballH2HAnalyticsArgs(["--team-a-id=team-a", "--team-b-id=team-b"])).toMatchObject({
      execute: false,
      reportJson: false,
      teamAId: "team-a",
      teamBId: "team-b",
      windowSizes: [5, 10]
    });
  });

  it("parses execute, JSON report, nullable season, and windows", () => {
    expect(parseFootballH2HAnalyticsArgs(["--execute", "--report-json", "--allow-null-season", "--all-approved-football", "--competition-id=competition-1", "--window-sizes=3,5"])).toMatchObject({
      execute: true,
      reportJson: true,
      allowNullSeason: true,
      allApprovedFootball: true,
      competitionId: "competition-1",
      windowSizes: [3, 5]
    });
  });

  it("requires an explicit target", () => {
    expect(() => validateFootballH2HAnalyticsOptions({ ...baseOptions, teamAId: undefined, teamBId: undefined }, baseEnv)).toThrow(
      "Football H2H analytics requires --team-a-id plus --team-b-id, --match-id, or --competition-id."
    );
  });

  it("requires both team IDs for pair mode", () => {
    expect(() => validateFootballH2HAnalyticsOptions({ ...baseOptions, teamBId: undefined }, baseEnv)).toThrow("Pair mode requires both --team-a-id and --team-b-id.");
  });

  it("blocks production usage", () => {
    expect(() => validateFootballH2HAnalyticsOptions(baseOptions, { ...baseEnv, NODE_ENV: "production" })).toThrow("Football H2H analytics runner is forbidden in production.");
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

  it("blocks competition builds without season or nullable-season flag", () => {
    expect(() =>
      validateFootballH2HAnalyticsOptions(
        { ...baseOptions, teamAId: undefined, teamBId: undefined, competitionId: "competition-1", allApprovedFootball: true },
        baseEnv
      )
    ).toThrow("Competition-level football H2H builds require --season-id or explicit --allow-null-season.");
  });

  it("allows nullable-season competition builds when explicitly flagged", () => {
    expect(() =>
      validateFootballH2HAnalyticsOptions(
        { ...baseOptions, teamAId: undefined, teamBId: undefined, competitionId: "competition-1", allApprovedFootball: true, allowNullSeason: true },
        baseEnv
      )
    ).not.toThrow();
  });

  it("dry-run calculates features without reporting writes", async () => {
    const dependencies = mockDependencies();

    const result = await runFootballH2HAnalytics(baseOptions, dependencies);

    expect(dependencies.buildForPair).toHaveBeenCalledWith("team-a", "team-b", {
      competitionId: undefined,
      seasonId: undefined,
      windowSizes: [5, 10]
    });
    expect(result.report).toMatchObject({
      mode: "dry-run",
      pairs_considered: 1,
      features_calculated: 2,
      features_written: 0
    });
  });

  it("execute mode reports written rows and post-run verification", async () => {
    const result = await runFootballH2HAnalytics(
      { ...baseOptions, execute: true },
      mockDependencies({ queryPostRunVerification: vi.fn().mockResolvedValue({ footballHeadToHeadFeaturesCount: 2 }) })
    );

    expect(result.report).toMatchObject({
      mode: "execute",
      features_written: 2,
      post_run_verification: {
        footballHeadToHeadFeaturesCount: 2
      }
    });
  });

  it("match path calls buildForMatch", async () => {
    const dependencies = mockDependencies();

    await runFootballH2HAnalytics({ ...baseOptions, teamAId: undefined, teamBId: undefined, matchId: "match-1" }, dependencies);

    expect(dependencies.buildForMatch).toHaveBeenCalledWith("match-1", { windowSizes: [5, 10] });
  });

  it("nullable-season competition path passes null season", async () => {
    const dependencies = mockDependencies();

    await runFootballH2HAnalytics(
      { ...baseOptions, teamAId: undefined, teamBId: undefined, competitionId: "competition-1", allApprovedFootball: true, allowNullSeason: true },
      dependencies
    );

    expect(dependencies.buildForCompetitionSeason).toHaveBeenCalledWith("competition-1", null, { windowSizes: [5, 10] });
  });

  it("persists a sanitized JSON report when requested", async () => {
    const persistRunReport = vi.fn();
    const log = vi.fn();

    await runFootballH2HAnalytics({ ...baseOptions, reportJson: true }, mockDependencies({ persistRunReport, log }));

    expect(persistRunReport).toHaveBeenCalledOnce();
    const output = log.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(output).not.toContain("postgres://");
    expect(output).not.toContain("secret");
    expect(output).not.toContain("DATABASE_URL");
  });
});

function mockDependencies(overrides: Partial<FootballH2HAnalyticsDependencies> = {}): FootballH2HAnalyticsDependencies {
  return {
    buildForPair: vi.fn().mockResolvedValue(mockBuildResult()),
    buildForMatch: vi.fn().mockResolvedValue(mockBuildResult()),
    buildForCompetitionSeason: vi.fn().mockResolvedValue(mockBuildResult()),
    log: vi.fn(),
    ...overrides
  };
}

function mockBuildResult() {
  return {
    changedFeatureRows: 2,
    calculatedFeatures: [
      {
        teamAId: "team-a",
        teamBId: "team-b",
        asOfDate: new Date("2026-04-24T16:00:00.000Z"),
        windowSize: 5,
        matchesPlayed: 1,
        teamAWins: 1,
        teamBWins: 0,
        draws: 0,
        teamAGoalsFor: 2,
        teamBGoalsFor: 0,
        teamAHomeMatches: 1,
        teamBHomeMatches: 0,
        teamAHomeWins: 1,
        teamBHomeWins: 0,
        sampleSize: 1,
        coverageScore: 36,
        metadataJson: { matchIds: ["match-a"] }
      },
      {
        teamAId: "team-a",
        teamBId: "team-b",
        asOfDate: new Date("2026-04-24T16:00:00.000Z"),
        windowSize: 10,
        matchesPlayed: 0,
        teamAWins: 0,
        teamBWins: 0,
        draws: 0,
        teamAGoalsFor: 0,
        teamBGoalsFor: 0,
        teamAHomeMatches: 0,
        teamBHomeMatches: 0,
        teamAHomeWins: 0,
        teamBHomeWins: 0,
        sampleSize: 0,
        coverageScore: 0,
        metadataJson: { matchIds: [] }
      }
    ]
  };
}
