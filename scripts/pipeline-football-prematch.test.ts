import { describe, expect, it } from "vitest";
import {
  assertReviewedTargets,
  parseFootballPrematchPipelineArgs,
  runFootballPrematchPipeline,
  selectMatchesInsideWindow,
  mapCalculatedFeatureForCandidates,
  shouldPersistDraftForCandidateRun,
  validateFootballPrematchPipelineOptions
} from "./pipeline-football-prematch.js";
import type { FootballPrematchPipelineMatchReport, FootballPrematchPipelineMatchTarget } from "./pipeline-football-prematch.js";
import type { ManualLeagueReviewConfig } from "./provider-apifootball-manual-ingest.js";
import type { FootballPredictionCandidateRunResult } from "./analytics-football-prediction-candidates-generate.js";

const reviewedLeague: ManualLeagueReviewConfig = {
  provider: "apifootball-com",
  sport: "football",
  countryId: "44",
  leagueId: "152",
  countryName: "England",
  leagueName: "Premier League",
  enabled: true,
  reviewed: true,
  dryRunAllowed: true,
  priority: "high",
  notes: "Test reviewed league."
};

const reviewCandidate: ManualLeagueReviewConfig = {
  ...reviewedLeague,
  countryId: "111",
  leagueId: "322",
  enabled: false,
  reviewed: false,
  notes: "Test review candidate."
};

describe("football pre-match pipeline runner", () => {
  it("parses dry-run defaults and execute options", () => {
    expect(parseFootballPrematchPipelineArgs(["--country-id=44", "--league-id=152"])).toMatchObject({
      countryId: "44",
      leagueId: "152",
      windowHours: 36,
      minimumLeadMinutes: 30,
      limit: 20,
      execute: false
    });
    expect(parseFootballPrematchPipelineArgs(["--match-id=match-1", "--window-hours=12", "--minimum-lead-minutes=45", "--limit=3", "--execute"])).toMatchObject({
      matchId: "match-1",
      windowHours: 12,
      minimumLeadMinutes: 45,
      limit: 3,
      execute: true
    });
  });

  it("requires reviewed/enabled league scope and blocks review candidates", () => {
    expect(() => validateFootballPrematchPipelineOptions(baseOptions(), baseEnv(), [reviewedLeague])).not.toThrow();
    expect(() => validateFootballPrematchPipelineOptions({ ...baseOptions(), countryId: "111", leagueId: "322" }, baseEnv(), [reviewCandidate])).toThrow(
      "requires reviewed=true and enabled=true"
    );
    expect(() => validateFootballPrematchPipelineOptions({ ...baseOptions(), countryId: "1", leagueId: "1" }, baseEnv(), [reviewedLeague])).toThrow(
      "limited to configured reviewed and enabled leagues"
    );
  });

  it("execute requires a safe DB target label", () => {
    expect(() => validateFootballPrematchPipelineOptions({ ...baseOptions(), execute: true }, { ...baseEnv(), DB_EXECUTION_TARGET: "production" }, [reviewedLeague])).toThrow(
      "execute requires DB_EXECUTION_TARGET=local or DB_EXECUTION_TARGET=neon-test"
    );
  });

  it("selects only matches inside the configured window and respects limit", () => {
    const selected = selectMatchesInsideWindow(sampleMatches(), { ...baseOptions(), windowHours: 36, minimumLeadMinutes: 30, limit: 1 }, new Date("2026-05-01T12:00:00.000Z"));
    expect(selected.map((match) => match.matchId)).toEqual(["inside-1"]);
  });

  it("dry-run writes nothing and reports no matches inside the pre-match window", async () => {
    let pipelineCalls = 0;
    const report = await runFootballPrematchPipeline(baseOptions(), {
      now: () => new Date("2026-05-01T00:00:00.000Z"),
      loadMatches: async () => [],
      runMatchPipeline: async () => {
        pipelineCalls += 1;
        return readyMatchReport("unexpected", false, 0);
      }
    });

    expect(report.message).toBe("No matches inside pre-match window.");
    expect(report.draftsPersisted).toBe(0);
    expect(pipelineCalls).toBe(0);
  });

  it("skips a match outside the window before running builders", async () => {
    let pipelineCalls = 0;
    const report = await runFootballPrematchPipeline(baseOptions(), {
      now: () => new Date("2026-05-01T00:00:00.000Z"),
      loadMatches: async () => [sampleMatches()[2]],
      runMatchPipeline: async () => {
        pipelineCalls += 1;
        return readyMatchReport("too-early", false, 0);
      }
    });

    expect(report.matches[0].skipReason).toContain("too_early");
    expect(report.processedMatches).toBe(0);
    expect(pipelineCalls).toBe(0);
  });

  it("processes an inside-window match and only persists drafts when execute report says so", async () => {
    const report = await runFootballPrematchPipeline({ ...baseOptions(), execute: true }, {
      now: () => new Date("2026-05-01T12:00:00.000Z"),
      loadMatches: async () => [sampleMatches()[0]],
      runMatchPipeline: async () => readyMatchReport("inside-1", true, 3)
    });

    expect(report.matchesInsideWindow).toBe(1);
    expect(report.processedMatches).toBe(1);
    expect(report.readyMatches).toBe(1);
    expect(report.draftsPersisted).toBe(3);
  });

  it("partial features do not persist drafts", async () => {
    const report = await runFootballPrematchPipeline({ ...baseOptions(), execute: true }, {
      now: () => new Date("2026-05-01T12:00:00.000Z"),
      loadMatches: async () => [sampleMatches()[0]],
      runMatchPipeline: async () => ({ ...readyMatchReport("inside-1", false, 0), featureStatus: "partial", predictionEligible: false, skipReason: "Feature status is not ready; draft persistence blocked." })
    });

    expect(report.readyMatches).toBe(0);
    expect(report.draftsPersisted).toBe(0);
    expect(report.skippedMatches).toBe(1);
  });

  it("blocked-only candidates are not treated as persistable recommendations", () => {
    expect(shouldPersistDraftForCandidateRun({ execute: true, featureStatus: "ready", candidate: fakeCandidateRun("blocked") })).toBe(false);
    expect(shouldPersistDraftForCandidateRun({ execute: true, featureStatus: "ready", candidate: fakeCandidateRun("warning") })).toBe(true);
    expect(shouldPersistDraftForCandidateRun({ execute: false, featureStatus: "ready", candidate: fakeCandidateRun("warning") })).toBe(false);
  });

  it("maps dry-run calculated feature snapshots into candidate generator input without a persisted id", () => {
    const feature = mapCalculatedFeatureForCandidates({
      matchId: "match-1",
      competitionId: "competition-1",
      homeTeamId: "home",
      awayTeamId: "away",
      asOfDate: new Date("2026-05-01T12:00:00.000Z"),
      formWindowSize: 5,
      h2hWindowSize: 5,
      combinedCoverageScore: 70,
      expectedTotalGoalsProxy: 3.2,
      goalProfile: "high_goal",
      featureStatus: "ready",
      metadataJson: { h2hMissing: true }
    });

    expect(feature).toMatchObject({
      id: "dry-run-calculated-feature",
      matchId: "match-1",
      featureStatus: "ready",
      combinedCoverageScore: 70,
      expectedTotalGoalsProxy: 3.2,
      metadataJson: { h2hMissing: true }
    });
  });

  it("validates reviewed targets for match-id mode", () => {
    expect(() => assertReviewedTargets([{ ...sampleMatches()[0], countryId: "44", leagueId: "152" }], [reviewedLeague])).not.toThrow();
    expect(() => assertReviewedTargets([{ ...sampleMatches()[0], countryId: "111", leagueId: "322" }], [reviewCandidate])).toThrow("not reviewed=true and enabled=true");
  });
});

function baseOptions() {
  return {
    countryId: "44",
    leagueId: "152",
    windowHours: 36,
    minimumLeadMinutes: 30,
    limit: 20,
    execute: false
  };
}

function baseEnv(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "development",
    DATABASE_URL: "postgres://localhost/test",
    DB_EXECUTION_TARGET: "local"
  };
}

function sampleMatches(): FootballPrematchPipelineMatchTarget[] {
  return [
    {
      matchId: "inside-1",
      matchLabel: "Team A vs Team B",
      kickoffAt: "2026-05-01T18:00:00.000Z",
      status: "not_started",
      competitionId: "competition-1",
      countryId: "44",
      leagueId: "152"
    },
    {
      matchId: "inside-2",
      matchLabel: "Team C vs Team D",
      kickoffAt: "2026-05-01T20:00:00.000Z",
      status: "scheduled",
      competitionId: "competition-1",
      countryId: "44",
      leagueId: "152"
    },
    {
      matchId: "too-early",
      matchLabel: "Team E vs Team F",
      kickoffAt: "2026-05-03T18:00:00.000Z",
      status: "not_started",
      competitionId: "competition-1",
      countryId: "44",
      leagueId: "152"
    }
  ];
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

function fakeCandidateRun(status: "warning" | "blocked"): FootballPredictionCandidateRunResult {
  return {
    mode: "dry_run",
    report: {
      matchId: "match-1",
      featureSnapshotId: "feature-1",
      generationMode: "dry_run",
      candidates: [
        {
          prediction_type: status === "blocked" ? "both_teams_to_score" : "match_result_1x2",
          prediction_value: status === "blocked" ? "no" : "1",
          prediction_family: status === "blocked" ? "both_teams_to_score" : "match_result",
          recommendation_tier: status === "blocked" ? "avoid" : "primary",
          display_label: status === "blocked" ? "Uzak Dur" : "Tahminim",
          reasoning_summary: "Test candidate.",
          confidence_score: 60,
          risk_level: status === "blocked" ? "high" : "medium",
          consistency_status: status,
          metadata: {}
        }
      ],
      warnings: [],
      blockedReasons: [],
      summary: "Test report.",
      analysisWindow: {
        kickoffAt: "2026-05-01T18:00:00.000Z",
        evaluatedAt: "2026-05-01T12:00:00.000Z",
        generatedAt: "2026-05-01T12:00:00.000Z",
        leadTimeMinutes: 360,
        windowHours: 36,
        minimumLeadMinutes: 30,
        analysisWindowStatus: "within_window",
        requiresRebuild: false,
        dataCompletenessNotes: []
      }
    }
  };
}
