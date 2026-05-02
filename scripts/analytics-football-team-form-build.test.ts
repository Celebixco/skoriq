import { describe, expect, it, vi } from "vitest";
import { checkDatabaseReadiness } from "./db-readiness.js";
import {
  parseFootballTeamFormAnalyticsArgs,
  runFootballTeamFormAnalytics,
  validateFootballTeamFormAnalyticsOptions
} from "./analytics-football-team-form-build.js";
import type {
  FootballTeamFormAnalyticsDependencies,
  FootballTeamFormAnalyticsOptions
} from "./analytics-football-team-form-build.js";

const baseOptions: FootballTeamFormAnalyticsOptions = {
  execute: false,
  reportJson: false,
  teamId: "team-1",
  allApprovedFootball: false,
  allowNullSeason: false,
  windowSizes: [5, 10],
  scopes: ["overall", "home", "away"]
};

const baseEnv = {
  NODE_ENV: "development",
  DATABASE_URL: "postgres://user:secret@localhost:5432/sports_data"
};

describe("football team form analytics runner", () => {
  it("defaults to dry-run with last-5/last-10 overall/home/away scopes", () => {
    expect(parseFootballTeamFormAnalyticsArgs(["--team-id=team-1"])).toMatchObject({
      execute: false,
      reportJson: false,
      teamId: "team-1",
      allowNullSeason: false,
      windowSizes: [5, 10],
      scopes: ["overall", "home", "away"]
    });
  });

  it("parses execute, JSON report, window size, and scope flags", () => {
    expect(parseFootballTeamFormAnalyticsArgs(["--execute", "--report-json", "--allow-null-season", "--match-id=match-1", "--window-sizes=3,5", "--scopes=overall,home"])).toMatchObject({
      execute: true,
      reportJson: true,
      allowNullSeason: true,
      matchId: "match-1",
      windowSizes: [3, 5],
      scopes: ["overall", "home"]
    });
  });

  it("requires an explicit target instead of running broadly", () => {
    expect(() => validateFootballTeamFormAnalyticsOptions({ ...baseOptions, teamId: undefined }, baseEnv)).toThrow(
      "Football team form analytics requires --team-id, --match-id, or --competition-id."
    );
  });

  it("requires exactly one target mode", () => {
    expect(() => validateFootballTeamFormAnalyticsOptions({ ...baseOptions, matchId: "match-1" }, baseEnv)).toThrow(
      "Football team form analytics accepts exactly one target mode."
    );
  });

  it("guards competition-season builds behind --all-approved-football", () => {
    expect(() =>
      validateFootballTeamFormAnalyticsOptions(
        { ...baseOptions, teamId: undefined, competitionId: "competition-1", seasonId: "season-1", allApprovedFootball: false },
        baseEnv
      )
    ).toThrow("Competition-level football team form builds require --all-approved-football.");
  });

  it("blocks missing season id for competition builds unless null season is explicitly allowed", () => {
    expect(() =>
      validateFootballTeamFormAnalyticsOptions(
        { ...baseOptions, teamId: undefined, competitionId: "competition-1", seasonId: undefined, allApprovedFootball: true, allowNullSeason: false },
        baseEnv
      )
    ).toThrow("Competition-level football team form builds require --season-id or explicit --allow-null-season.");
  });

  it("allows nullable-season competition builds when explicitly flagged", () => {
    expect(() =>
      validateFootballTeamFormAnalyticsOptions(
        { ...baseOptions, teamId: undefined, competitionId: "competition-1", seasonId: undefined, allApprovedFootball: true, allowNullSeason: true },
        baseEnv
      )
    ).not.toThrow();
  });

  it("blocks nullable-season flag outside competition-level builds", () => {
    expect(() => validateFootballTeamFormAnalyticsOptions({ ...baseOptions, allowNullSeason: true }, baseEnv)).toThrow(
      "--allow-null-season is only valid for competition-level football team form builds."
    );
  });

  it("blocks combining season id and nullable-season mode", () => {
    expect(() =>
      validateFootballTeamFormAnalyticsOptions(
        { ...baseOptions, teamId: undefined, competitionId: "competition-1", seasonId: "season-1", allApprovedFootball: true, allowNullSeason: true },
        baseEnv
      )
    ).toThrow("--allow-null-season cannot be combined with --season-id.");
  });

  it("blocks production usage", () => {
    expect(() => validateFootballTeamFormAnalyticsOptions(baseOptions, { ...baseEnv, NODE_ENV: "production" })).toThrow(
      "Football team form analytics runner is forbidden in production."
    );
  });

  it("blocks missing DATABASE_URL", () => {
    expect(() => validateFootballTeamFormAnalyticsOptions(baseOptions, { ...baseEnv, DATABASE_URL: undefined })).toThrow(
      "DATABASE_URL is required for football team form analytics."
    );
  });

  it("does not require provider credentials or provider calls", async () => {
    expect(() => validateFootballTeamFormAnalyticsOptions(baseOptions, baseEnv)).not.toThrow();

    const providerCall = vi.fn();
    await runFootballTeamFormAnalytics(baseOptions, mockDependencies());

    expect(providerCall).not.toHaveBeenCalled();
  });

  it("keeps remote unsafe databases blocked through shared readiness logic", async () => {
    const result = await checkDatabaseReadiness({
      databaseUrl: "postgres://user:secret@db.example.internal/sports_data",
      nodeEnv: "development",
      connect: async () => ({ tableNames: [] })
    });

    expect(result).toMatchObject({
      status: "not_ready",
      reason: "unsafe_target",
      target: {
        classification: "unknown"
      }
    });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("dry-run calculates features without reporting writes", async () => {
    const dependencies = mockDependencies();

    const result = await runFootballTeamFormAnalytics(baseOptions, dependencies);

    expect(dependencies.buildForTeam).toHaveBeenCalledWith("team-1", {
      competitionId: undefined,
      seasonId: undefined,
      windowSizes: [5, 10],
      scopes: ["overall", "home", "away"]
    });
    expect(result.report).toMatchObject({
      mode: "dry-run",
      features_calculated: 2,
      features_written: 0,
      teams_considered: 1,
      missing_source_data_count: 1,
      result: "partial"
    });
  });

  it("execute mode reports written rows and post-run verification", async () => {
    const dependencies = mockDependencies({
      queryPostRunVerification: vi.fn().mockResolvedValue({ footballTeamFormFeaturesCount: 12 })
    });

    const result = await runFootballTeamFormAnalytics({ ...baseOptions, execute: true }, dependencies);

    expect(result.report).toMatchObject({
      mode: "execute",
      features_written: 2,
      post_run_verification: {
        footballTeamFormFeaturesCount: 12
      }
    });
  });

  it("buildForMatch path calls the match builder", async () => {
    const dependencies = mockDependencies();

    await runFootballTeamFormAnalytics({ ...baseOptions, teamId: undefined, matchId: "match-1" }, dependencies);

    expect(dependencies.buildForMatch).toHaveBeenCalledWith("match-1", {
      windowSizes: [5, 10],
      scopes: ["overall", "home", "away"]
    });
    expect(dependencies.buildForTeam).not.toHaveBeenCalled();
  });

  it("competition-season path calls the competition season builder", async () => {
    const dependencies = mockDependencies();

    await runFootballTeamFormAnalytics(
      { ...baseOptions, teamId: undefined, competitionId: "competition-1", seasonId: "season-1", allApprovedFootball: true },
      dependencies
    );

    expect(dependencies.buildForCompetitionSeason).toHaveBeenCalledWith("competition-1", "season-1", {
      windowSizes: [5, 10],
      scopes: ["overall", "home", "away"]
    });
  });

  it("nullable-season competition path passes null season to the builder", async () => {
    const dependencies = mockDependencies();

    await runFootballTeamFormAnalytics(
      { ...baseOptions, teamId: undefined, competitionId: "competition-1", seasonId: undefined, allApprovedFootball: true, allowNullSeason: true },
      dependencies
    );

    expect(dependencies.buildForCompetitionSeason).toHaveBeenCalledWith("competition-1", null, {
      windowSizes: [5, 10],
      scopes: ["overall", "home", "away"]
    });
  });

  it("persists a JSON report only when requested", async () => {
    const persistRunReport = vi.fn();

    await runFootballTeamFormAnalytics({ ...baseOptions, reportJson: true }, mockDependencies({ persistRunReport }));

    expect(persistRunReport).toHaveBeenCalledOnce();
    expect(persistRunReport.mock.calls[0][0]).toMatchObject({
      provider: "manual-football-team-form",
      mode: "dry-run"
    });
  });

  it("does not print database credentials in the structured report", async () => {
    const log = vi.fn();

    await runFootballTeamFormAnalytics(baseOptions, mockDependencies({ log }));

    const output = log.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(output).not.toContain("postgres://");
    expect(output).not.toContain("secret");
    expect(output).not.toContain("DATABASE_URL");
  });
});

function mockDependencies(overrides: Partial<FootballTeamFormAnalyticsDependencies> = {}): FootballTeamFormAnalyticsDependencies {
  return {
    buildForTeam: vi.fn().mockResolvedValue(mockBuildResult()),
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
        teamId: "team-1",
        competitionId: "competition-1",
        seasonId: "season-1",
        asOfMatchId: "match-1",
        asOfDate: new Date("2026-04-24T16:00:00.000Z"),
        windowSize: 5,
        scope: "overall",
        matchesPlayed: 5,
        wins: 3,
        draws: 1,
        losses: 1,
        points: 10,
        goalsFor: 8,
        goalsAgainst: 4,
        goalDifference: 4,
        avgGoalsFor: 1.6,
        avgGoalsAgainst: 0.8,
        cleanSheetRate: 0.4,
        failedToScoreRate: 0,
        bothTeamsToScoreRate: 0.6,
        over15Rate: 0.8,
        over25Rate: 0.4,
        over35Rate: 0.2,
        sampleSize: 5,
        coverageScore: 1,
        metadataJson: { matchIds: ["match-a"] }
      },
      {
        teamId: "team-1",
        competitionId: "competition-1",
        seasonId: "season-1",
        asOfMatchId: "match-1",
        asOfDate: new Date("2026-04-24T16:00:00.000Z"),
        windowSize: 10,
        scope: "overall",
        matchesPlayed: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        points: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        goalDifference: 0,
        sampleSize: 0,
        coverageScore: 0,
        metadataJson: { matchIds: [] }
      }
    ]
  };
}
