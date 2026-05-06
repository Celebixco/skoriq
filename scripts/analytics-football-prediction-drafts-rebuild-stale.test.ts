import { describe, expect, it, vi } from "vitest";
import {
  parseFootballStaleDraftRebuildArgs,
  runFootballStaleDraftRebuild,
  validateFootballStaleDraftRebuildOptions
} from "./analytics-football-prediction-drafts-rebuild-stale.js";
import type {
  FootballStaleDraftRebuildDependencies,
  FootballStaleDraftRebuildOptions,
  FootballStaleDraftOutputSummary
} from "./analytics-football-prediction-drafts-rebuild-stale.js";

const baseOptions: FootballStaleDraftRebuildOptions = {
  matchId: "match-1",
  execute: false,
  windowHours: 36,
  minimumLeadMinutes: 30
};

const baseEnv = {
  NODE_ENV: "development",
  DATABASE_URL: "postgres://user:secret@localhost:5432/sports_data",
  DB_EXECUTION_TARGET: "local"
};

describe("football stale draft rebuild runner", () => {
  it("parses required match id and defaults to dry-run", () => {
    expect(parseFootballStaleDraftRebuildArgs(["--match-id=match-1"])).toEqual(baseOptions);
  });

  it("parses execute and window flags", () => {
    expect(parseFootballStaleDraftRebuildArgs(["--match-id=match-1", "--execute", "--window-hours=48", "--minimum-lead-minutes=45"])).toEqual({
      ...baseOptions,
      execute: true,
      windowHours: 48,
      minimumLeadMinutes: 45
    });
  });

  it("blocks without match id and in production/unsafe env", () => {
    expect(() => validateFootballStaleDraftRebuildOptions({ ...baseOptions, matchId: undefined }, baseEnv)).toThrow("requires --match-id");
    expect(() => validateFootballStaleDraftRebuildOptions(baseOptions, { ...baseEnv, NODE_ENV: "production" })).toThrow("forbidden in production");
    expect(() => validateFootballStaleDraftRebuildOptions(baseOptions, { ...baseEnv, DATABASE_URL: undefined })).toThrow("DATABASE_URL is required");
  });

  it("dry-run detects stale drafts without writes", async () => {
    const dependencies = mockDependencies({
      listDraftOutputs: vi.fn().mockResolvedValue([draft({ generatedAt: "2026-04-29T10:00:00.000Z" })])
    });

    const result = await runFootballStaleDraftRebuild(baseOptions, dependencies);

    expect(result.report.mode).toBe("dry-run");
    expect(result.report.analysisWindow.analysisWindowStatus).toBe("within_window");
    expect(result.report.existingDraftCount).toBe(1);
    expect(result.report.staleDraftCount).toBe(1);
    expect(result.report.wouldRunRebuild).toBe(true);
    expect(result.report.rebuildRan).toBe(false);
    expect(dependencies.runTeamForm).not.toHaveBeenCalled();
    expect(dependencies.updateWindowMetadataForOutputs).not.toHaveBeenCalled();
  });

  it("allows execute eligibility when the old 36h upper cap no longer applies", async () => {
    const dependencies = mockDependencies({
      findMatch: vi.fn().mockResolvedValue(match({ kickoffAt: "2026-05-02T18:30:00.000Z" })),
      listDraftOutputs: vi.fn().mockResolvedValue([draft({ generatedAt: "2026-04-30T10:00:00.000Z" })])
    });

    const result = await runFootballStaleDraftRebuild({ ...baseOptions, execute: true }, dependencies);

    expect(result.report.analysisWindow.analysisWindowStatus).toBe("within_window");
    expect(result.report.blockedReasons).not.toContain("Analysis window status is too_early; execute is allowed only within_window.");
  });

  it("blocks execute when too late", async () => {
    const dependencies = mockDependencies({
      findMatch: vi.fn().mockResolvedValue(match({ kickoffAt: "2026-04-30T12:20:00.000Z" })),
      listDraftOutputs: vi.fn().mockResolvedValue([draft({ generatedAt: "2026-04-29T10:00:00.000Z" })])
    });

    const result = await runFootballStaleDraftRebuild({ ...baseOptions, execute: true }, dependencies);

    expect(result.report.analysisWindow.analysisWindowStatus).toBe("too_late");
    expect(result.report.rebuildRan).toBe(false);
    expect(dependencies.runCandidatePersistence).not.toHaveBeenCalled();
  });

  it("allows execute path when within window and stale drafts exist", async () => {
    const dependencies = mockDependencies({
      listDraftOutputs: vi.fn().mockResolvedValue([draft({ generatedAt: "2026-04-29T10:00:00.000Z" })])
    });

    const result = await runFootballStaleDraftRebuild({ ...baseOptions, execute: true }, dependencies);

    expect(result.report.rebuildRan).toBe(true);
    expect(dependencies.runTeamForm).toHaveBeenCalledWith("match-1");
    expect(dependencies.runH2H).toHaveBeenCalledWith("match-1");
    expect(dependencies.runMatchPredictionFeatures).toHaveBeenCalledWith("match-1");
    expect(dependencies.runReasoning).toHaveBeenCalledWith("match-1");
    expect(dependencies.runCandidatePersistence).toHaveBeenCalled();
    expect(result.report.rebuiltCandidateCount).toBe(2);
    expect(result.report.metadataUpdatedCount).toBe(2);
  });

  it("detects stale drafts by generation_window_status", async () => {
    const result = await runFootballStaleDraftRebuild(
      baseOptions,
      mockDependencies({
        listDraftOutputs: vi.fn().mockResolvedValue([draft({ generatedAt: "2026-04-30T13:00:00.000Z", generationWindowStatus: "stale" })])
      })
    );

    expect(result.report.staleDraftCount).toBe(1);
    expect(result.report.existingDrafts[0]?.staleReasons).toContain("generation_window_status_stale");
  });

  it("detects stale drafts by rebuild_required", async () => {
    const result = await runFootballStaleDraftRebuild(
      baseOptions,
      mockDependencies({
        listDraftOutputs: vi.fn().mockResolvedValue([draft({ generatedAt: "2026-04-30T13:00:00.000Z", rebuildRequired: true })])
      })
    );

    expect(result.report.staleDraftCount).toBe(1);
    expect(result.report.existingDrafts[0]?.staleReasons).toContain("rebuild_required_true");
  });

  it("updates only window metadata after execute and keeps member/public counts unchanged", async () => {
    const updateWindowMetadataForOutputs = vi.fn().mockResolvedValue(2);
    const dependencies = mockDependencies({
      listDraftOutputs: vi.fn().mockResolvedValue([draft({ generatedAt: "2026-04-29T10:00:00.000Z" })]),
      updateWindowMetadataForOutputs
    });

    const result = await runFootballStaleDraftRebuild({ ...baseOptions, execute: true }, dependencies);

    expect(updateWindowMetadataForOutputs).toHaveBeenCalledWith(
      ["output-1", "output-2"],
      expect.objectContaining({
        generationWindowStatus: "within_window",
        generatedLeadTimeMinutes: 1320,
        rebuildRequired: false,
        staleAt: null,
        rebuildReason: "manual_stale_rebuild"
      })
    );
    expect(result.report.memberVisibleCount).toBe(0);
    expect(result.report.publicStatusCount).toBe(0);
  });

  it("does not run rebuild when there are no stale drafts", async () => {
    const dependencies = mockDependencies({
      listDraftOutputs: vi.fn().mockResolvedValue([draft({ generatedAt: "2026-04-30T13:00:00.000Z" })])
    });

    const result = await runFootballStaleDraftRebuild({ ...baseOptions, execute: true }, dependencies);

    expect(result.report.staleDraftCount).toBe(0);
    expect(result.report.rebuildRan).toBe(false);
    expect(dependencies.runTeamForm).not.toHaveBeenCalled();
  });
});

function mockDependencies(overrides: Partial<FootballStaleDraftRebuildDependencies> = {}): FootballStaleDraftRebuildDependencies {
  return {
    findMatch: vi.fn().mockResolvedValue(match()),
    listDraftOutputs: vi.fn().mockResolvedValue([]),
    runTeamForm: vi.fn().mockResolvedValue({}),
    runH2H: vi.fn().mockResolvedValue({}),
    runMatchPredictionFeatures: vi.fn().mockResolvedValue({}),
    runReasoning: vi.fn().mockResolvedValue({}),
    runCandidatePersistence: vi.fn().mockResolvedValue({
      outputIds: ["output-1", "output-2"],
      persistedOutputsCount: 2,
      candidatesByTier: {
        try: [
          { predictionType: "over_under_goals", predictionValue: "over_2_5", confidenceScore: 64, consistencyStatus: "warning" },
          { predictionType: "first_half_over_0_5", predictionValue: "over_0_5", confidenceScore: 62.17, consistencyStatus: "warning" }
        ]
      }
    }),
    updateWindowMetadataForOutputs: vi.fn().mockResolvedValue(2),
    countMemberVisible: vi.fn().mockResolvedValue(0),
    countPublicStatuses: vi.fn().mockResolvedValue(0),
    now: () => new Date("2026-04-30T12:00:00.000Z"),
    log: vi.fn(),
    ...overrides
  };
}

function match(overrides: Partial<ReturnType<typeof match>> = {}) {
  return {
    matchId: "match-1",
    sportSlug: "football",
    competitionName: "Bundesliga",
    homeTeamName: "Bayer Leverkusen",
    awayTeamName: "RB Leipzig",
    kickoffAt: "2026-05-01T10:00:00.000Z",
    status: "not_started" as const,
    ...overrides
  };
}

function draft(overrides: Partial<FootballStaleDraftOutputSummary> = {}): FootballStaleDraftOutputSummary {
  return {
    predictionOutputId: "output-1",
    predictionType: "over_under_goals",
    predictionValue: "over_2_5",
    recommendationTier: "try",
    status: "draft",
    generatedAt: "2026-04-30T13:00:00.000Z",
    generationWindowStatus: null,
    generatedLeadTimeMinutes: null,
    rebuildRequired: false,
    staleAt: null,
    rebuildReason: null,
    isStale: false,
    staleReasons: [],
    ...overrides
  };
}
