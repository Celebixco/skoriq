import { describe, expect, it, vi } from "vitest";
import {
  evaluatePreMatchAnalysisWindow,
  parseFootballPredictionCandidateArgs,
  persistDraftCandidates,
  runFootballPredictionCandidateGeneration,
  validateFootballPredictionCandidateOptions
} from "./analytics-football-prediction-candidates-generate.js";
import { FootballPredictionConsistencyEngine } from "@sports-data/analysis";
import type { FootballPredictionCandidateDependencies, FootballPredictionCandidateOptions } from "./analytics-football-prediction-candidates-generate.js";

const baseOptions: FootballPredictionCandidateOptions = {
  matchId: "match-1",
  formWindowSize: 5,
  h2hWindowSize: 5,
  checkConsistency: false,
  persistDraft: false,
  windowHours: 36,
  minimumLeadMinutes: 30,
  enforceWindow: false
};

const baseEnv = {
  NODE_ENV: "development",
  DATABASE_URL: "postgres://user:secret@localhost:5432/sports_data"
};

describe("football prediction candidate runner", () => {
  it("parses match id and defaults to dry-run windows", () => {
    expect(parseFootballPredictionCandidateArgs(["--match-id=match-1"])).toEqual(baseOptions);
  });

  it("parses optional in-memory consistency checks", () => {
    expect(parseFootballPredictionCandidateArgs(["--match-id=match-1", "--check-consistency"])).toEqual({ ...baseOptions, checkConsistency: true });
  });

  it("parses pre-match analysis window flags", () => {
    expect(parseFootballPredictionCandidateArgs(["--match-id=match-1", "--window-hours=48", "--minimum-lead-minutes=45", "--enforce-window"])).toEqual({
      ...baseOptions,
      windowHours: 48,
      minimumLeadMinutes: 45,
      enforceWindow: true
    });
  });

  it("rejects execute and persist-draft flags", () => {
    expect(() => parseFootballPredictionCandidateArgs(["--match-id=match-1", "--execute"])).toThrow("does not support --execute");
    expect(parseFootballPredictionCandidateArgs(["--match-id=match-1", "--persist-draft"])).toEqual({ ...baseOptions, checkConsistency: true, persistDraft: true });
  });

  it("requires match id and blocks production", () => {
    expect(() => validateFootballPredictionCandidateOptions({ ...baseOptions, matchId: undefined }, baseEnv)).toThrow("requires --match-id");
    expect(() => validateFootballPredictionCandidateOptions(baseOptions, { ...baseEnv, NODE_ENV: "production" })).toThrow("forbidden in production");
  });

  it("generates dry-run candidates without writes or provider calls", async () => {
    const dependencies = mockDependencies();

    const result = await runFootballPredictionCandidateGeneration(baseOptions, dependencies);

    expect(dependencies.findFeature).toHaveBeenCalledWith("match-1", 5, 5);
    expect(result.mode).toBe("dry_run");
    expect(result.report.candidates.length).toBeGreaterThan(0);
    expect(result.report.candidates.every((candidate) => candidate.consistency_status === "unchecked")).toBe(true);
    expect(result.report.analysisWindow).toMatchObject({
      analysisWindowStatus: "within_window",
      windowHours: 36,
      minimumLeadMinutes: 30
    });
    expect(JSON.stringify(result)).not.toContain("postgres://");
  });

  it("does not persist drafts without --persist-draft", async () => {
    const persistDrafts = vi.fn();

    await runFootballPredictionCandidateGeneration(baseOptions, mockDependencies({ persistDrafts }));

    expect(persistDrafts).not.toHaveBeenCalled();
  });

  it("runs consistency checks in memory when requested", async () => {
    const result = await runFootballPredictionCandidateGeneration({ ...baseOptions, checkConsistency: true }, mockDependencies());

    expect(result.report.candidates.some((candidate) => candidate.consistency_status !== "unchecked")).toBe(true);
    expect(result.report.consistencySummary).toContain("Consistency dry-run complete");
    expect(result.report.blockingConflictCount).toBeGreaterThanOrEqual(0);
    expect(result.report.warnings).toContain("Consistency check ran in memory only; no candidates were made member-visible.");
  });

  it("persists draft outputs only when requested", async () => {
    const persistDrafts = vi.fn().mockResolvedValue({
      persistedOutputsCount: 5,
      outputIds: ["prediction-1"],
      statusValues: ["draft"],
      consistencyStatuses: ["warning", "blocked"],
      recommendationTiers: ["primary", "try", "avoid"],
      conflictsPersistedCount: 11,
      memberVisibleCount: 0
    });

    const result = await runFootballPredictionCandidateGeneration({ ...baseOptions, persistDraft: true, checkConsistency: true }, mockDependencies({ persistDrafts }));

    expect(persistDrafts).toHaveBeenCalled();
    expect(persistDrafts).toHaveBeenCalledWith(
      expect.objectContaining({
        report: expect.objectContaining({
          analysisWindow: expect.objectContaining({ analysisWindowStatus: "within_window" })
        })
      })
    );
    expect(result.persistence?.persistedOutputsCount).toBe(5);
    expect(result.persistence?.statusValues).toEqual(["draft"]);
    expect(result.persistence?.memberVisibleCount).toBe(0);
    expect(result.report.candidates.some((candidate) => candidate.consistency_status === "blocked")).toBe(true);
  });

  it("maps draft persistence through repository upserts and conflict replacement", async () => {
    const report = (await runFootballPredictionCandidateGeneration({ ...baseOptions, checkConsistency: true }, mockDependencies())).report;
    const consistency = new FootballPredictionConsistencyEngine().checkCandidateBundle(report);
    const upsertPredictionOutput = vi.fn(async (input) => ({
      id: `output-${input.predictionType}-${input.predictionValue}`,
      status: input.status,
      consistencyStatus: input.consistencyStatus
    }));
    const replaceConflictsForPrediction = vi.fn(async (_id, conflicts) => conflicts.map((conflict: unknown, index: number) => ({ id: `conflict-${index}`, ...conflict })));

    const result = await persistDraftCandidates(
      {
        report,
        consistency,
        generatedAt: new Date("2026-04-30T12:00:00.000Z")
      },
      { upsertPredictionOutput, replaceConflictsForPrediction } as never
    );

    expect(upsertPredictionOutput).toHaveBeenCalledTimes(report.candidates.length);
    expect(upsertPredictionOutput).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "draft",
        recommendationTier: expect.any(String),
        displayLabel: expect.any(String),
        reasoningSummary: expect.any(String),
        generationWindowStatus: "within_window",
        generatedLeadTimeMinutes: 1320,
        rebuildRequired: false
      })
    );
    expect(replaceConflictsForPrediction).toHaveBeenCalledTimes(report.candidates.length);
    expect(result.memberVisibleCount).toBe(0);
    expect(result.consistencyStatuses).toEqual(expect.arrayContaining(["warning", "blocked"]));
    expect(result.recommendationTiers).toEqual(expect.arrayContaining(["primary", "try", "avoid"]));
  });

  it("returns blocked report when feature snapshot is missing", async () => {
    const result = await runFootballPredictionCandidateGeneration(baseOptions, mockDependencies({ findFeature: vi.fn().mockResolvedValue(undefined) }));

    expect(result.report.candidates).toHaveLength(0);
    expect(result.report.blockedReasons).toContain("No football_match_prediction_features row found for the selected match/windows.");
    expect(result.report.analysisWindow?.analysisWindowStatus).toBe("within_window");
  });

  it("keeps generation eligible even when kickoff is well beyond the former 36h window", async () => {
    const result = await runFootballPredictionCandidateGeneration(
      baseOptions,
      mockDependencies({
        now: () => new Date("2026-04-30T12:00:00.000Z"),
        findMatchKickoffAt: vi.fn().mockResolvedValue(new Date("2026-05-02T18:30:00.000Z"))
      })
    );

    expect(result.report.analysisWindow?.analysisWindowStatus).toBe("within_window");
    expect(result.report.candidates.length).toBeGreaterThan(0);
    expect(result.report.warnings).not.toContain(expect.stringContaining("too_early"));
  });

  it("does not mark existing outputs stale only because they were generated well ahead of kickoff", async () => {
    const persistDrafts = vi.fn().mockResolvedValue({
      persistedOutputsCount: 2,
      outputIds: ["prediction-1", "prediction-2"],
      statusValues: ["draft"],
      consistencyStatuses: ["warning"],
      recommendationTiers: ["try"],
      conflictsPersistedCount: 4,
      memberVisibleCount: 0
    });

    const result = await runFootballPredictionCandidateGeneration(
      { ...baseOptions, persistDraft: true, checkConsistency: true },
      mockDependencies({
        persistDrafts,
        now: () => new Date("2026-04-30T12:00:00.000Z"),
        findMatchKickoffAt: vi.fn().mockResolvedValue(new Date("2026-05-02T18:30:00.000Z")),
        listExistingGeneratedAt: vi.fn().mockResolvedValue([new Date("2026-04-30T10:00:00.000Z")])
      })
    );

    expect(result.report.analysisWindow?.analysisWindowStatus).toBe("within_window");
    expect(result.report.analysisWindow?.requiresRebuild).toBe(false);
    expect(result.persistence?.persistedOutputsCount).toBe(2);
  });

  it("allows generation with --enforce-window when inside the analysis window", async () => {
    const result = await runFootballPredictionCandidateGeneration({ ...baseOptions, enforceWindow: true }, mockDependencies());

    expect(result.report.analysisWindow?.analysisWindowStatus).toBe("within_window");
    expect(result.report.candidates.length).toBeGreaterThan(0);
    expect(result.report.blockedReasons).not.toContain(expect.stringContaining("enforcement blocked"));
  });

  it("does not block with --enforce-window when kickoff is simply far in the future", async () => {
    const result = await runFootballPredictionCandidateGeneration(
      { ...baseOptions, enforceWindow: true },
      mockDependencies({
        now: () => new Date("2026-04-30T12:00:00.000Z"),
        findMatchKickoffAt: vi.fn().mockResolvedValue(new Date("2026-05-02T18:30:00.000Z"))
      })
    );

    expect(result.report.analysisWindow?.analysisWindowStatus).toBe("within_window");
    expect(result.report.candidates.length).toBeGreaterThan(0);
    expect(result.report.blockedReasons).not.toContain(expect.stringContaining("too_early"));
  });

  it("blocks too_late with --enforce-window", async () => {
    const result = await runFootballPredictionCandidateGeneration(
      { ...baseOptions, enforceWindow: true },
      mockDependencies({
        now: () => new Date("2026-04-30T12:00:00.000Z"),
        findMatchKickoffAt: vi.fn().mockResolvedValue(new Date("2026-04-30T12:20:00.000Z"))
      })
    );

    expect(result.report.analysisWindow?.analysisWindowStatus).toBe("too_late");
    expect(result.report.candidates).toHaveLength(0);
    expect(result.report.blockedReasons).toContain("Pre-match analysis window enforcement blocked candidate generation: too_late.");
  });

  it("does not block with --enforce-window just because an older draft exists", async () => {
    const result = await runFootballPredictionCandidateGeneration(
      { ...baseOptions, enforceWindow: true },
      mockDependencies({
        now: () => new Date("2026-04-30T12:00:00.000Z"),
        findMatchKickoffAt: vi.fn().mockResolvedValue(new Date("2026-05-02T18:30:00.000Z")),
        listExistingGeneratedAt: vi.fn().mockResolvedValue([new Date("2026-04-30T10:00:00.000Z")])
      })
    );

    expect(result.report.analysisWindow?.analysisWindowStatus).toBe("within_window");
    expect(result.report.analysisWindow?.requiresRebuild).toBe(false);
    expect(result.report.candidates.length).toBeGreaterThan(0);
    expect(result.report.blockedReasons).not.toContain(expect.stringContaining("stale"));
  });

  it("blocks unknown with --enforce-window", async () => {
    const result = await runFootballPredictionCandidateGeneration(
      { ...baseOptions, enforceWindow: true },
      mockDependencies({
        findMatchKickoffAt: vi.fn().mockResolvedValue(null)
      })
    );

    expect(result.report.analysisWindow?.analysisWindowStatus).toBe("unknown");
    expect(result.report.candidates).toHaveLength(0);
    expect(result.report.blockedReasons).toContain("Pre-match analysis window enforcement blocked candidate generation: unknown.");
  });

  it("still writes drafts with --persist-draft when kickoff is far away but minimum lead is respected", async () => {
    const persistDrafts = vi.fn();
    const result = await runFootballPredictionCandidateGeneration(
      { ...baseOptions, persistDraft: true, checkConsistency: true, enforceWindow: true },
      mockDependencies({
        persistDrafts,
        now: () => new Date("2026-04-30T12:00:00.000Z"),
        findMatchKickoffAt: vi.fn().mockResolvedValue(new Date("2026-05-02T18:30:00.000Z")),
        listExistingGeneratedAt: vi.fn().mockResolvedValue([new Date("2026-04-30T10:00:00.000Z")])
      })
    );

    expect(persistDrafts).toHaveBeenCalled();
    expect(result.report.candidates.length).toBeGreaterThan(0);
  });
});

describe("evaluatePreMatchAnalysisWindow", () => {
  const evaluatedAt = new Date("2026-04-30T12:00:00.000Z");

  it("reports within_window 37h before kickoff once the upper time limit is removed", () => {
    expect(
      evaluatePreMatchAnalysisWindow({
        kickoffAt: "2026-05-02T01:00:00.000Z",
        evaluatedAt,
        windowHours: 36,
        minimumLeadMinutes: 30
      }).analysisWindowStatus
    ).toBe("within_window");
  });

  it("reports within_window 20h before kickoff and beyond minimum lead", () => {
    expect(
      evaluatePreMatchAnalysisWindow({
        kickoffAt: "2026-05-01T08:00:00.000Z",
        evaluatedAt,
        windowHours: 36,
        minimumLeadMinutes: 30
      }).analysisWindowStatus
    ).toBe("within_window");
  });

  it("reports within_window when kickoff is beyond the former window but still before kickoff", () => {
    expect(
      evaluatePreMatchAnalysisWindow({
        kickoffAt: "2026-05-02T18:30:00.000Z",
        evaluatedAt,
        windowHours: 36,
        minimumLeadMinutes: 30
      }).analysisWindowStatus
    ).toBe("within_window");
  });

  it("reports too_late when kickoff is inside minimum lead time", () => {
    expect(
      evaluatePreMatchAnalysisWindow({
        kickoffAt: "2026-04-30T12:20:00.000Z",
        evaluatedAt,
        windowHours: 36,
        minimumLeadMinutes: 30
      }).analysisWindowStatus
    ).toBe("too_late");
  });

  it("reports too_late when kickoff has passed", () => {
    expect(
      evaluatePreMatchAnalysisWindow({
        kickoffAt: "2026-04-30T11:59:00.000Z",
        evaluatedAt,
        windowHours: 36,
        minimumLeadMinutes: 30
      }).analysisWindowStatus
    ).toBe("too_late");
  });

  it("reports unknown when kickoff is missing", () => {
    const report = evaluatePreMatchAnalysisWindow({
      kickoffAt: null,
      evaluatedAt,
      windowHours: 36,
      minimumLeadMinutes: 30
    });

    expect(report.analysisWindowStatus).toBe("unknown");
    expect(report.leadTimeMinutes).toBeNull();
  });

  it("uses flag overrides for window and minimum lead", () => {
    const report = evaluatePreMatchAnalysisWindow({
      kickoffAt: "2026-05-02T10:00:00.000Z",
      evaluatedAt,
      windowHours: 48,
      minimumLeadMinutes: 45
    });

    expect(report.analysisWindowStatus).toBe("within_window");
    expect(report.windowHours).toBe(48);
    expect(report.minimumLeadMinutes).toBe(45);
  });
});

function mockDependencies(overrides: Partial<FootballPredictionCandidateDependencies> = {}): FootballPredictionCandidateDependencies {
  return {
    findFeature: vi.fn().mockResolvedValue({
      id: "feature-1",
      matchId: "match-1",
      featureStatus: "ready",
      homeFormFeatureId: "home-form-1",
      awayFormFeatureId: "away-form-1",
      homeFormCoverageScore: 70,
      awayFormCoverageScore: 58,
      h2hCoverageScore: 0,
      combinedCoverageScore: 64,
      homeRecentPoints: 12,
      awayRecentPoints: 7,
      homeAvgGoalsFor: 1.9,
      homeAvgGoalsAgainst: 0.9,
      awayAvgGoalsFor: 1.1,
      awayAvgGoalsAgainst: 1.6,
      expectedTotalGoalsProxy: 3.605,
      expectedHomeGoalsProxy: 2.215,
      expectedAwayGoalsProxy: 1.39,
      homeGoalSignalScore: 78,
      awayGoalSignalScore: 47.75,
      firstHalfGoalSignalScore: 62.5,
      bttsSignalScore: 57.88,
      goalProfile: "high_goal",
      firstHalfGoalProfile: "unknown",
      bttsProfile: "balanced",
      homeTeamGoalProfile: "strong",
      awayTeamGoalProfile: "moderate",
      metadataJson: {
        h2hMissing: true,
        sampleSizes: {
          homeForm: 5,
          awayForm: 4,
          h2h: 0
        }
      }
    }),
    findMatchKickoffAt: vi.fn().mockResolvedValue(new Date("2026-05-01T10:00:00.000Z")),
    listExistingGeneratedAt: vi.fn().mockResolvedValue([]),
    now: () => new Date("2026-04-30T12:00:00.000Z"),
    log: vi.fn(),
    ...overrides
  };
}
