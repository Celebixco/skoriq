import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { DashboardOverviewResponse } from "../types";
import { ArenaHome } from "./ArenaHome";
import { CouponProvider } from "./CouponProvider";
import { availablePredictions, confidenceValue } from "./home-data";

function response(): DashboardOverviewResponse {
  return {
    user: { email: "member@example.test", role: "member" },
    overview: { analyzedMatchesCount: 1, readyMatchesCount: 1, partialMatchesCount: 0, insufficientMatchesCount: 0, averageCombinedCoverageScore: 70, predictionEligibleCount: 1, h2hMissingCount: 0 },
    upcomingMatches: [{
      matchId: "match-1", competition: { id: "league-1", name: "Test Ligi", country: "TR" },
      kickoffAt: "2026-10-19T17:00:00Z", status: "scheduled",
      homeTeam: { id: "home-1", name: "Ankara Kuzey" }, awayTeam: { id: "away-1", name: "İzmir Güney" },
      featureStatus: "ready", predictionEligible: true, combinedCoverageScore: 70,
      analysisWindowStatus: "within_window", hasPredictionPreview: true
    }],
    analysisDistribution: { ready: 1, partial: 0, insufficient: 0, unknown: 0 },
    coverageSummary: { averageCombinedCoverageScore: 70, averageHomeFormCoverage: 70, averageAwayFormCoverage: 70, averageH2hCoverage: 70 },
    predictionPreview: { status: "available", items: [{ matchId: "match-1", matchLabel: "Ankara Kuzey - İzmir Güney", displayLabel: "MS 2,5 Üst", recommendationTier: "primary", confidenceScore: 64, riskLevel: "medium" }] },
    dataStatus: { analyticsApi: "ok", teamsCatalog: "ok", competitionsCatalog: "ok", predictionPreview: "ok" }
  };
}

function render(data: DashboardOverviewResponse | null, authenticated = true, error: string | null = null, loading = false) {
  return renderToStaticMarkup(<ArenaHome overview={{ data, loading, error }} authenticated={authenticated} navigate={vi.fn()} />);
}

function renderWithCoupon(data: DashboardOverviewResponse | null, authenticated = true) {
  return renderToStaticMarkup(<CouponProvider userId="member-home-test"><ArenaHome overview={{ data, loading: false, error: null }} authenticated={authenticated} navigate={vi.fn()} /></CouponProvider>);
}

describe("ArenaHome data integrity", () => {
  it("offers separate coupon controls on the featured and fixture prediction for members", () => {
    const html = renderWithCoupon(response());
    expect(html.match(/class="arena-coupon-add"/g)).toHaveLength(2);
    expect(html).toContain('class="arena-match-coupon-label">MS 2,5 Üst</span>');
    expect(html).toContain('aria-label="Ankara Kuzey - İzmir Güney maç analizini aç"');
    expect(render(response())).not.toContain("Kupona ekle");
  });

  it("does not offer coupon actions for demo, stale, failed, unmatched or ineligible previews", () => {
    const stale = response();
    stale.predictionPreview.status = "stale";
    const failed = response();
    failed.dataStatus.predictionPreview = "error";
    const unmatched = response();
    unmatched.predictionPreview.items[0]!.matchId = "orphan-preview";
    const ineligible = response();
    ineligible.upcomingMatches[0]!.predictionEligible = false;
    for (const data of [stale, failed, unmatched, ineligible]) expect(renderWithCoupon(data)).not.toContain("Kupona ekle");
    expect(renderWithCoupon(null, false)).not.toContain("Kupona ekle");
  });

  it.each([["primary", "Tahminim"], ["try", "Denenir"], ["alternative", "Alternatif"]] as const)("preserves the visible recommendation tier: %s", (tier, label) => {
    const data = response();
    data.predictionPreview.items[0]!.recommendationTier = tier;
    expect(render(data)).toContain(`SkorIQ · ${label}`);
  });

  it("uses actual paired fixture and preview data with separate confidence and risk", () => {
    const html = render(response());
    expect(html).toContain("Ankara Kuzey");
    expect(html).toContain("İzmir Güney");
    expect(html).toContain("MS 2,5 Üst");
    expect(html).toContain('aria-valuenow="64"');
    expect(html).toContain("Risk: Orta");
    expect(html).toContain("Güven skoru kazanma olasılığı değildir.");
    expect(html).not.toContain("Galatasaray");
    expect(html).not.toContain("Örnek analiz");
    expect(html).not.toContain("Gol profili destekliyor");
    expect(html).toContain("Ankara Kuzey logosu yok");
  });

  it("does not turn unavailable or failed member data into sample predictions", () => {
    for (const html of [render(null), render(response(), true, "offline"), render(null, true, null, true)]) {
      expect(html).not.toContain("Galatasaray");
      expect(html).not.toContain('aria-valuenow="82"');
      expect(html).not.toContain("MS 2,5 Üst");
    }
    expect(render(null)).toContain("Henüz gösterilecek karşılaşma yok.");
    expect(render(null, true, "offline")).toContain('role="alert"');
    expect(render(null, true, null, true)).toContain("Günün maçları yükleniyor");
  });

  it("marks public concept fixtures as samples and never presents a fabricated kickoff", () => {
    const html = render(null, false);
    expect(html).toContain("Örnek analiz");
    expect(html).toContain("Örnek karşılaşma");
    expect(html).toContain("Örnek veriler");
    expect(html).not.toContain("Bugün 21:45");
    expect(html).not.toContain("Canlı");
    expect(render(null, false, "offline")).not.toContain("Galatasaray");
  });

  it("hides stale, failed and unmatched forecasts", () => {
    const stale = response();
    stale.predictionPreview.status = "stale";
    expect(availablePredictions(stale).size).toBe(0);
    expect(render(stale)).not.toContain("MS 2,5 Üst");
    const failed = response();
    failed.dataStatus.predictionPreview = "error";
    expect(availablePredictions(failed).size).toBe(0);
    const unmatched = response();
    unmatched.predictionPreview.items[0]!.matchId = "orphan-preview";
    expect(availablePredictions(unmatched).size).toBe(0);
    const ineligible = response();
    ineligible.upcomingMatches[0]!.predictionEligible = false;
    expect(availablePredictions(ineligible).size).toBe(0);
  });

  it.each(["too_early", "too_late", "stale", "unknown", null] as const)("does not publish an available preview outside the safe fixture window: %s", (windowStatus) => {
    const data = response();
    data.upcomingMatches[0]!.analysisWindowStatus = windowStatus;
    expect(availablePredictions(data).size).toBe(0);
    expect(render(data)).not.toContain("MS 2,5 Üst");
    expect(render(data)).not.toContain('aria-valuenow="64"');
  });

  it("shows invalid confidence as unavailable rather than inventing a boundary score", () => {
    for (const score of [-1, 100.1, 125, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(confidenceValue(score)).toBeNull();
      const data = response();
      data.predictionPreview.items[0]!.confidenceScore = score;
      const html = render(data);
      expect(html).toContain('aria-valuetext="Henüz belirlenmedi"');
      expect(html).not.toContain('aria-valuenow="100"');
      expect(html).not.toContain('aria-valuenow="0"');
    }
    expect(confidenceValue(0)).toBe(0);
    expect(confidenceValue(100)).toBe(100);
    expect(confidenceValue(64.3)).toBe(64.3);
  });

  it("uses explicitly labelled demo monograms without claiming official logos", () => {
    const html = render(null, false);
    for (const monogram of ["GS", "FB", "BJK", "TS", "ARS", "CHE", "MIL", "NAP"]) expect(html).toContain(`>${monogram}<`);
    expect(html).toContain('aria-label="Galatasaray örnek monogramı"');
    expect(html).not.toContain("Galatasaray logosu yok");
  });
});
