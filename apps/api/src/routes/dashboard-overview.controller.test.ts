import "reflect-metadata";
import { UnauthorizedException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { AuthGuard } from "../auth/auth.guard.js";
import type { AuthService } from "../auth/auth.service.js";
import { DashboardOverviewController } from "./dashboard-overview.controller.js";
import { DashboardOverviewService } from "./dashboard-overview.service.js";

const memberUser = { id: "member-1", email: "member@example.test", role: "member" as const, status: "active" as const };
const adminUser = { id: "admin-1", email: "admin@example.test", role: "admin" as const, status: "active" as const };

describe("DashboardOverviewController", () => {
  it("requires authentication for the overview endpoint", async () => {
    expect(Reflect.getMetadata("__guards__", DashboardOverviewController)).toContain(AuthGuard);
    expect(Reflect.getMetadata("__guards__", DashboardOverviewController.prototype.getOverview)).toEqual([AuthGuard]);

    await expect(runAuthGuard(null)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(runAuthGuard(memberUser)).resolves.toBe(true);
    await expect(runAuthGuard(adminUser)).resolves.toBe(true);
  });

  it("returns member overview without admin fields", async () => {
    const controller = new DashboardOverviewController(
      mockService({
        getOverview: vi.fn().mockResolvedValue({
          user: { email: memberUser.email, role: "member" },
          overview: emptyOverview(),
          upcomingMatches: [],
          analysisDistribution: { ready: 0, partial: 0, insufficient: 0, unknown: 0 },
          coverageSummary: { averageCombinedCoverageScore: null, averageHomeFormCoverage: null, averageAwayFormCoverage: null, averageH2hCoverage: null },
          predictionPreview: { status: "not_available", items: [] },
          dataStatus: { analyticsApi: "empty", teamsCatalog: "empty", competitionsCatalog: "empty", predictionPreview: "empty" }
        })
      })
    );

    const response = await controller.getOverview({ headers: {}, user: memberUser });

    expect(response.user.role).toBe("member");
    expect("admin" in response).toBe(false);
  });
});

describe("DashboardOverviewService", () => {
  it("maps overview counts and upcoming match identity safely for members", async () => {
    const database = createDatabaseMock([
      [overviewRow()],
      [upcomingRow()],
      [previewRow()],
      [{ teams_count: "18", competitions_count: "2" }]
    ]);
    const service = new DashboardOverviewService(database as never);

    const response = await service.getOverview(memberUser);

    expect(response.overview).toMatchObject({
      analyzedMatchesCount: 12,
      readyMatchesCount: 7,
      partialMatchesCount: 3,
      insufficientMatchesCount: 2,
      averageCombinedCoverageScore: 63.5,
      predictionEligibleCount: 7,
      h2hMissingCount: 4
    });
    expect(response.upcomingMatches[0]).toMatchObject({
      matchId: "match-1",
      competition: { id: "competition-1", name: "Bundesliga", country: "Germany" },
      homeTeam: { id: "home-1", name: "Bayer Leverkusen", logoUrl: "https://cdn.test/home.png" },
      awayTeam: { id: "away-1", name: "RB Leipzig", logoUrl: "https://cdn.test/away.png" },
      featureStatus: "ready",
      predictionEligible: true,
      hasPredictionPreview: true
    });
    expect(response.predictionPreview.status).toBe("available");
    expect(response.predictionPreview.items[0]).toMatchObject({
      matchId: "match-1",
      matchLabel: "Bayer Leverkusen vs RB Leipzig",
      displayLabel: "MS 2.5 Üst",
      recommendationTier: "try",
      confidenceScore: 64,
      riskLevel: "medium"
    });
    expect(response.dataStatus).toEqual({ analyticsApi: "ok", teamsCatalog: "ok", competitionsCatalog: "ok", predictionPreview: "ok" });
    expect(JSON.stringify(response)).not.toContain("admin");
    expect(JSON.stringify(response)).not.toContain("metadata");
    expect(JSON.stringify(response)).not.toContain("raw_payload");
    expect(JSON.stringify(response)).not.toContain("postgres://");
  });

  it("adds admin summary only for admins", async () => {
    const service = new DashboardOverviewService(
      createDatabaseMock([
        [overviewRow()],
        [],
        [],
        [{ teams_count: "18", competitions_count: "2" }],
        [
          {
            draft_prediction_count: "5",
            settlement_count: "4",
            public_eligibility_eligible_count: "1",
            public_eligibility_excluded_count: "3",
            rebuild_required_count: "2"
          }
        ]
      ]) as never
    );

    const response = await service.getOverview(adminUser);

    expect(response.user.role).toBe("admin");
    expect(response.admin).toEqual({
      draftPredictionCount: 5,
      settlementCount: 4,
      publicEligibilityEligibleCount: 1,
      publicEligibilityExcludedCount: 3,
      rebuildRequiredCount: 2
    });
  });

  it("returns stale prediction preview without normal items when safe candidates are stale", async () => {
    const service = new DashboardOverviewService(
      createDatabaseMock([
        [overviewRow()],
        [],
        [previewRow({ analysis_window_status: "stale" })],
        [{ teams_count: "18", competitions_count: "2" }]
      ]) as never
    );

    const response = await service.getOverview(memberUser);

    expect(response.predictionPreview).toEqual({ status: "stale", items: [] });
  });

  it("uses read-only database calls", async () => {
    const database = {
      execute: vi.fn().mockResolvedValue({ rows: [] }),
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn()
    };
    const service = new DashboardOverviewService(database as never);

    await service.getOverview(adminUser);

    expect(database.execute).toHaveBeenCalled();
    expect(database.insert).not.toHaveBeenCalled();
    expect(database.update).not.toHaveBeenCalled();
    expect(database.delete).not.toHaveBeenCalled();
  });
});

function mockService(overrides: Partial<DashboardOverviewService> = {}): DashboardOverviewService {
  return {
    getOverview: vi.fn(),
    ...overrides
  } as unknown as DashboardOverviewService;
}

async function runAuthGuard(user: typeof memberUser | typeof adminUser | null) {
  const authService = {
    enabled: true,
    currentUserFromRequest: vi.fn().mockResolvedValue(user)
  } as unknown as AuthService;
  const context = { switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }) };
  return new AuthGuard(authService).canActivate(context as never);
}

function createDatabaseMock(results: unknown[][]) {
  return {
    execute: vi.fn(async () => ({ rows: results.shift() ?? [] }))
  };
}

function emptyOverview() {
  return {
    analyzedMatchesCount: 0,
    readyMatchesCount: 0,
    partialMatchesCount: 0,
    insufficientMatchesCount: 0,
    averageCombinedCoverageScore: null,
    predictionEligibleCount: 0,
    h2hMissingCount: 0
  };
}

function overviewRow() {
  return {
    analyzed_matches_count: "12",
    ready_matches_count: "7",
    partial_matches_count: "3",
    insufficient_matches_count: "2",
    unknown_matches_count: "0",
    average_combined_coverage_score: "63.50",
    average_home_form_coverage: "72.25",
    average_away_form_coverage: "70.75",
    average_h2h_coverage: "48.00",
    prediction_eligible_count: "7",
    h2h_missing_count: "4"
  };
}

function upcomingRow() {
  return {
    match_id: "match-1",
    competition_id: "competition-1",
    competition: "Bundesliga",
    country: "Germany",
    kickoff_at: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
    status: "not_started",
    home_team_id: "home-1",
    home_team: "Bayer Leverkusen",
    home_team_logo_url: "https://cdn.test/home.png",
    away_team_id: "away-1",
    away_team: "RB Leipzig",
    away_team_logo_url: "https://cdn.test/away.png",
    feature_status: "ready",
    combined_coverage_score: "64",
    stale_preview_exists: false,
    safe_preview_exists: true
  };
}

function previewRow(overrides: Record<string, unknown> = {}) {
  return {
    match_id: "match-1",
    match_label: "Bayer Leverkusen vs RB Leipzig",
    prediction_type: "over_under_goals",
    prediction_value: "over_2_5",
    recommendation_tier: "try",
    display_label: "MS 2.5 Üst",
    confidence_score: "64",
    risk_level: "medium",
    generated_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    kickoff_at: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
    analysis_window_status: "within_window",
    ...overrides
  };
}
