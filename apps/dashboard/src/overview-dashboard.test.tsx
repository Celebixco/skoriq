import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { OverviewDashboardView } from "./App";
import type { AuthUser, DashboardOverviewResponse } from "./types";

const memberUser: AuthUser = {
  id: "member-1",
  email: "member@example.test",
  role: "member",
  status: "active"
};

const adminUser: AuthUser = {
  ...memberUser,
  id: "admin-1",
  email: "admin@example.test",
  role: "admin"
};

function loadState(data: DashboardOverviewResponse | null, error: string | null = null) {
  return { data, loading: false, error };
}

function overviewResponse(patch: Partial<DashboardOverviewResponse> = {}): DashboardOverviewResponse {
  return {
    user: { email: "member@example.test", role: "member" },
    overview: {
      analyzedMatchesCount: 2,
      readyMatchesCount: 1,
      partialMatchesCount: 1,
      insufficientMatchesCount: 0,
      averageCombinedCoverageScore: 60,
      predictionEligibleCount: 1,
      h2hMissingCount: 1
    },
    upcomingMatches: [
      {
        matchId: "match-1",
        competition: { id: "competition-1", name: "Dynamic League", country: "TR" },
        kickoffAt: "2026-05-02T18:30:00.000Z",
        status: "scheduled",
        homeTeam: { id: "home-1", name: "Ankara Kuzey", logoUrl: null },
        awayTeam: { id: "away-1", name: "Izmir Güney", logoUrl: null },
        featureStatus: "ready",
        predictionEligible: true,
        combinedCoverageScore: 70,
        analysisWindowStatus: "within_window",
        hasPredictionPreview: true
      }
    ],
    analysisDistribution: { ready: 1, partial: 1, insufficient: 0, unknown: 0 },
    coverageSummary: {
      averageCombinedCoverageScore: 60,
      averageHomeFormCoverage: 80,
      averageAwayFormCoverage: 60,
      averageH2hCoverage: 40
    },
    predictionPreview: {
      status: "available",
      items: [
        {
          matchId: "match-1",
          matchLabel: "Ankara Kuzey vs Izmir Güney",
          displayLabel: "MS 2.5 Üst",
          recommendationTier: "try",
          confidenceScore: 64,
          riskLevel: "medium"
        }
      ]
    },
    dataStatus: {
      analyticsApi: "ok",
      teamsCatalog: "ok",
      competitionsCatalog: "ok",
      predictionPreview: "ok"
    },
    ...patch
  };
}

function renderOverview(data: DashboardOverviewResponse | null, user: AuthUser = memberUser, error: string | null = null) {
  return renderToStaticMarkup(<OverviewDashboardView user={user} overview={loadState(data, error)} navigate={vi.fn()} />);
}

describe("OverviewDashboardView", () => {
  it("renders KPI cards and matches from the dashboard overview endpoint payload", () => {
    const html = renderOverview(overviewResponse());

    expect(html).toContain("Analiz Edilen Maç");
    expect(html).toContain(">2<");
    expect(html).toContain("Hazır Analiz");
    expect(html).toContain("60%");
    expect(html).toContain("Ankara Kuzey");
    expect(html).toContain("Izmir Güney");
    expect(html).toContain("MS 2.5 Üst");
    expect(html).not.toContain("128");
    expect(html).not.toContain("%62");
    expect(html).not.toContain(">28<");
  });

  it("renders compact match rows with a visible detail action and window status", () => {
    const html = renderOverview(
      overviewResponse({
        upcomingMatches: [
          {
            matchId: "match-quiet",
            competition: { id: "competition-1", name: "Dynamic League", country: "TR" },
            kickoffAt: "2026-05-02T18:30:00.000Z",
            status: "scheduled",
            homeTeam: { id: "home-1", name: "Uzun Takım Adı", logoUrl: null },
            awayTeam: { id: "away-1", name: "Başka Takım Adı", logoUrl: null },
            featureStatus: null,
            predictionEligible: false,
            combinedCoverageScore: null,
            analysisWindowStatus: "too_early",
            hasPredictionPreview: false
          }
        ]
      })
    );

    expect(html).toContain("Uzun Takım Adı");
    expect(html).toContain("Başka Takım Adı");
    expect(html).toContain('role="button"');
    expect(html).toContain("Uzun Takım Adı - Başka Takım Adı maç analizini aç");
    expect(html).not.toContain("Analizi aç");
    expect(html).not.toContain("Analiz yok");
    expect(html).not.toContain("Veri yok");
    expect(html).not.toContain("Beklemede");
    expect(html).not.toContain("Erken");
  });

  it("does not render the match list heading or open-all button", () => {
    const html = renderOverview(overviewResponse());

    expect(html).not.toContain("Yaklaşan Maçlar");
    expect(html).not.toContain("Tümünü aç");
  });

  it("does not render admin section for member responses", () => {
    const html = renderOverview(overviewResponse());

    expect(html).not.toContain("İç Denetim Özeti");
    expect(html).not.toContain("Draft Tahminler");
  });

  it("renders admin summary and quick links when backend returns admin payload", () => {
    const html = renderOverview(
      overviewResponse({
        user: { email: "admin@example.test", role: "admin" },
        admin: {
          draftPredictionCount: 5,
          settlementCount: 3,
          publicEligibilityEligibleCount: 2,
          publicEligibilityExcludedCount: 1,
          rebuildRequiredCount: 0
        }
      }),
      adminUser
    );

    expect(html).toContain("İç Denetim Özeti");
    expect(html).toContain("Draft Tahminler");
    expect(html).toContain("Tahmin Sonuçları");
    expect(html).toContain("Public Uygunluk");
    expect(html).toContain(">5<");
  });

  it("renders not_available prediction preview empty state", () => {
    const html = renderOverview(
      overviewResponse({
        predictionPreview: { status: "not_available", items: [] }
      })
    );

    expect(html).toContain("Henüz yayınlanabilir tahmin yorumu yok.");
  });

  it("renders data status from the endpoint", () => {
    const html = renderOverview(
      overviewResponse({
        dataStatus: {
          analyticsApi: "ok",
          teamsCatalog: "empty",
          competitionsCatalog: "error",
          predictionPreview: "empty"
        }
      })
    );

    expect(html).toContain("Analiz API");
    expect(html).toContain("Bağlı");
    expect(html).toContain("Boş");
    expect(html).toContain("Erişilemedi");
  });

  it("handles dashboard overview API error gracefully", () => {
    const html = renderOverview(null, memberUser, "failed");

    expect(html).toContain("Dashboard özeti yüklenemedi.");
  });

  it("does not render betting language", () => {
    const html = renderOverview(overviewResponse());

    expect(html.toLocaleLowerCase("tr-TR")).not.toContain("bahis");
    expect(html.toLocaleLowerCase("tr-TR")).not.toContain("banko");
    expect(html.toLocaleLowerCase("tr-TR")).not.toContain("kesin kazanır");
  });
});
