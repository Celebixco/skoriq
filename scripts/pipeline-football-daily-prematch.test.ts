import { afterEach, describe, expect, it, vi } from "vitest";
import { parseDailyPrematchArgs, runDailyPrematchScan } from "./pipeline-football-daily-prematch.js";
import type { FootballPrematchPipelineMatchReport, FootballPrematchPipelineMatchTarget } from "./pipeline-football-prematch.js";

describe("daily football pre-match scan", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("parses bounded dry-run defaults and debug flags", () => {
    expect(parseDailyPrematchArgs(["--country-id=44", "--league-id=152"])).toMatchObject({
      countryId: "44",
      leagueId: "152",
      execute: false,
      windowHours: 36,
      minimumLeadMinutes: 30,
      limit: 50,
      maxRuntimeSeconds: 300,
      perMatchTimeoutSeconds: 45,
      continueOnError: true,
      verbose: false
    });
    expect(
      parseDailyPrematchArgs([
        "--match-id=match-1",
        "--window-hours=12",
        "--minimum-lead-minutes=45",
        "--limit=3",
        "--max-runtime-seconds=9",
        "--per-match-timeout-seconds=2",
        "--continue-on-error=false",
        "--verbose"
      ])
    ).toMatchObject({
      matchId: "match-1",
      windowHours: 12,
      minimumLeadMinutes: 45,
      limit: 3,
      maxRuntimeSeconds: 9,
      perMatchTimeoutSeconds: 2,
      continueOnError: false,
      verbose: true
    });
  });

  it("requires exactly one supported scope", () => {
    expect(() => parseDailyPrematchArgs([])).toThrow("exactly one scope");
    expect(() => parseDailyPrematchArgs(["--all-reviewed-enabled", "--country-id=44", "--league-id=152"])).toThrow("exactly one scope");
    expect(() => parseDailyPrematchArgs(["--country-id=44"])).toThrow("country-id and --league-id together");
  });

  it("prints startup, league, match, and final progress while writing no drafts in dry-run", async () => {
    const logs: string[] = [];
    const report = await runDailyPrematchScan(baseOptions(), "postgres://localhost/test", new Date("2026-05-01T12:00:00.000Z"), {
      log: (message) => logs.push(message),
      loadMatches: async () => [insideMatch("inside-1")],
      runMatchPipeline: async ({ target }) => readyMatchReport(target.matchId, false, 0)
    });

    expect(logs.some((line) => line.includes("startup"))).toBe(true);
    expect(logs.some((line) => line.includes("league 1/1"))).toBe(true);
    expect(logs.some((line) => line.includes("match 1/1"))).toBe(true);
    expect(logs.some((line) => line.includes("final"))).toBe(true);
    expect(report.matchesInsideWindow).toBe(1);
    expect(report.draftsThatWouldBePersisted).toBe(1);
    expect(report.draftsPersisted).toBe(0);
    expect(report.dbWrites).toBe(0);
  });

  it("returns a clean report when no matches are inside the window", async () => {
    const report = await runDailyPrematchScan(baseOptions(), "postgres://localhost/test", new Date("2026-05-01T12:00:00.000Z"), {
      loadMatches: async () => [],
      runMatchPipeline: async () => readyMatchReport("unexpected", false, 0)
    });

    expect(report.matchesConsidered).toBe(0);
    expect(report.draftsPersisted).toBe(0);
    expect(report.dbWrites).toBe(0);
  });

  it("passes limit and country/league scope to match loading", async () => {
    const seen: unknown[] = [];
    await runDailyPrematchScan({ ...baseOptions(), limit: 7 }, "postgres://localhost/test", new Date("2026-05-01T12:00:00.000Z"), {
      loadMatches: async (options) => {
        seen.push(options);
        return [];
      },
      runMatchPipeline: async () => readyMatchReport("unexpected", false, 0)
    });

    expect(seen).toEqual([expect.objectContaining({ countryId: "44", leagueId: "152", limit: 7 })]);
  });

  it("stops gracefully when max runtime is exceeded before work starts", async () => {
    vi.spyOn(Date, "now").mockReturnValueOnce(0).mockReturnValue(1001);
    let loadCalls = 0;
    const report = await runDailyPrematchScan({ ...baseOptions(), maxRuntimeSeconds: 1 }, "postgres://localhost/test", new Date("2026-05-01T12:00:00.000Z"), {
      loadMatches: async () => {
        loadCalls += 1;
        return [insideMatch("inside-1")];
      },
      runMatchPipeline: async ({ target }) => readyMatchReport(target.matchId, false, 0)
    });

    expect(loadCalls).toBe(0);
    expect(report.stoppedReason).toBe("max_runtime_exceeded");
    expect(report.matchesConsidered).toBe(0);
  });

  it("marks a timed-out match skipped and continues in dry-run", async () => {
    vi.useFakeTimers();
    const scan = runDailyPrematchScan({ ...baseOptions(), perMatchTimeoutSeconds: 1 }, "postgres://localhost/test", new Date("2026-05-01T12:00:00.000Z"), {
      loadMatches: async () => [insideMatch("slow")],
      runMatchPipeline: async () => new Promise<FootballPrematchPipelineMatchReport>(() => undefined)
    });

    await vi.advanceTimersByTimeAsync(1100);
    const report = await scan;

    expect(report.reports[0]?.matches[0]?.skipReason).toBe("per_match_timeout");
    expect(report.failedMatches).toBe(1);
    expect(report.dbWrites).toBe(0);
  });

  it("continues after one failing match by default", async () => {
    const report = await runDailyPrematchScan(baseOptions(), "postgres://localhost/test", new Date("2026-05-01T12:00:00.000Z"), {
      loadMatches: async () => [insideMatch("bad"), insideMatch("good")],
      runMatchPipeline: async ({ target }) => {
        if (target.matchId === "bad") throw new Error("synthetic failure with postgres://secret@example/db");
        return readyMatchReport(target.matchId, false, 0);
      }
    });

    expect(report.failedMatches).toBe(1);
    expect(report.readyMatches).toBe(1);
    expect(JSON.stringify(report)).not.toContain("postgres://secret");
  });
});

function baseOptions() {
  return {
    countryId: "44",
    leagueId: "152",
    execute: false,
    windowHours: 36,
    minimumLeadMinutes: 30,
    limit: 50,
    allReviewedEnabled: false,
    timezone: "Europe/Istanbul",
    maxRuntimeSeconds: 300,
    perMatchTimeoutSeconds: 45,
    continueOnError: true,
    verbose: false
  };
}

function insideMatch(matchId: string): FootballPrematchPipelineMatchTarget {
  return {
    matchId,
    matchLabel: "Team A vs Team B",
    kickoffAt: "2026-05-01T18:00:00.000Z",
    status: "not_started",
    competitionId: "competition-1",
    countryId: "44",
    leagueId: "152"
  };
}

function readyMatchReport(matchId: string, persistDraftAttempted: boolean, persistedCount: number): FootballPrematchPipelineMatchReport {
  return {
    matchId,
    matchLabel: "Team A vs Team B",
    kickoffAt: "2026-05-01T18:00:00.000Z",
    analysisWindowStatus: "within_window",
    teamFormBuildResult: "success",
    h2hSampleSize: 5,
    h2hCoverageScore: 100,
    h2hBuildResult: "success",
    matchPredictionFeatureResult: "success",
    featureStatus: "ready",
    combinedCoverageScore: 76,
    predictionEligible: true,
    confidenceCeiling: 80,
    candidates: {
      Tahminim: [{ type: "match_result_1x2", value: "1", confidence: 70, risk: "medium", consistency: "warning" }],
      Denenir: [],
      Alternatif: [],
      UzakDur: []
    },
    consistencySummary: "Consistency dry-run complete.",
    candidateSummary: "Dry-run aday üretildi.",
    candidateBlockedReasons: [],
    candidateWarnings: [],
    persistDraftAttempted,
    persistedCount
  };
}
