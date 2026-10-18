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

describe("OverviewDashboardView arena", () => {
  it("uses actual fixture and model preview data in the featured card", () => {
    const html = renderOverview(overviewResponse());
    expect(html).toContain("BU GECE,");
    expect(html).toContain("Ankara Kuzey");
    expect(html).toContain("Izmir Güney");
    expect(html).toContain("MS 2.5 Üst");
    expect(html).toContain("64");
    expect(html).toContain("Risk: Orta");
    expect(html).not.toContain("Galatasaray");
    expect(html).not.toContain("Örnek analiz");
  });

  it("keeps admin data hidden for member accounts even if a malformed payload includes it", () => {
    const html = renderOverview(overviewResponse({admin: {draftPredictionCount:5,settlementCount:3,publicEligibilityEligibleCount:2,publicEligibilityExcludedCount:1,rebuildRequiredCount:0}}));
    expect(html).not.toContain("İç Denetim Özeti");
    expect(html).not.toContain("Draft Tahminler");
  });

  it("retains an optional internal summary for authenticated admins", () => {
    const html = renderOverview(overviewResponse({admin: {draftPredictionCount:5,settlementCount:3,publicEligibilityEligibleCount:2,publicEligibilityExcludedCount:1,rebuildRequiredCount:0}}), adminUser);
    expect(html).toContain("İç Denetim Özeti");
    expect(html).toContain("Draft Tahminler: 5");
    expect(html).toContain("Tahmin Sonuçları: 3");
  });

  it("does not replace unavailable previews with fabricated predictions", () => {
    const html = renderOverview(overviewResponse({predictionPreview:{status:"not_available",items:[]}}));
    expect(html).toContain("Maçın hikâyesi hazırlanıyor");
    expect(html).not.toContain("MS 2.5 Üst");
    expect(html).not.toContain("Örnek analiz");
  });

  it("shows a data error instead of stale content or public demonstration fixtures", () => {
    const html = renderOverview(overviewResponse(), memberUser, "failed");
    expect(html).toContain("Maçlar şu anda yüklenemedi");
    expect(html).not.toContain("Ankara Kuzey");
    expect(html).not.toContain("Galatasaray");
  });

  it("retains confidence meaning and the report disclaimer", () => {
    const html = renderOverview(overviewResponse());
    expect(html).toContain("Güven skoru kazanma olasılığı değildir.");
    expect(html).toContain("Bu bir maç analizi raporudur, nihai tahmin değildir.");
    expect(html).not.toContain("Canlı veri");
  });
});
