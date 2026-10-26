import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RcPrematchItem } from "../types";
import { RcPredictionCard } from "./RcPrematchPage";

const item: RcPrematchItem = {
  matchId: "match-1",
  competitionId: "competition-1",
  league: "Trendyol Süper Lig",
  kickoffAt: "2026-10-23T17:00:00Z",
  homeTeam: "Alanyaspor",
  awayTeam: "Kocaelispor",
  homeTeamId: "team-home",
  awayTeamId: "team-away",
  homeTeamLogoUrl: "https://img.example.test/alanyaspor.png",
  awayTeamLogoUrl: null,
  rc: { predictionId: "prediction-rc", predictionText: "Tahmin: Alanyaspor kazanır", p1: 0.4667, px: 0.2634, p2: 0.2699, pick: "1", pickLabel: "Ev sahibi", modelId: "R-C", modelVersion: "stage11-fixed-R-A-R-C", modelLabel: "Trey", generatedAt: "2026-10-21T15:26:45Z", publishedAt: "2026-10-21T18:40:00Z" },
  ra: { predictionId: "prediction-ra", predictionText: "Tahmin: Alanyaspor kazanır", p1: 0.4904, px: 0.2729, p2: 0.2367, pick: "1", pickLabel: "Ev sahibi", modelId: "R-A", modelVersion: "stage11-fixed-R-A-R-C", modelLabel: "R-A", generatedAt: "2026-10-21T15:26:45Z", publishedAt: "2026-10-21T18:40:00Z" },
  modelsDisagree: false,
  historyHomeN: 10,
  historyAwayN: 10,
  scopeLevel: "last10_available_unverified",
  historyCompleteness: "unverified",
  dataWarning: "Geçmiş pencere tam doğrulanmadı.",
  evaluationGroup: "stage12_1",
  performanceNote: null,
  disclaimer: "Tahminler kesin sonuç garantisi değildir."
};

describe("simple prediction card", () => {
  it("shows teams, logos, time and one plain prediction", () => {
    const html = renderToStaticMarkup(<RcPredictionCard item={item} navigate={() => {}} />);
    expect(html).toContain("Alanyaspor");
    expect(html).toContain("Kocaelispor");
    expect(html).toContain('alt="Alanyaspor logo"');
    expect(html).toContain("Tahmin: Alanyaspor kazanır");
    expect(html).toContain("TSİ");
    expect(html).toContain("Maç detayı");
  });

  it("does not leak model, probability or comparison UI to the member card", () => {
    const html = renderToStaticMarkup(<RcPredictionCard item={item} navigate={() => {}} />);
    expect(html).not.toContain("R-C");
    expect(html).not.toContain("R-A");
    expect(html).not.toContain("Beta");
    expect(html).not.toContain("Model");
    expect(html).not.toContain("46.7%");
    expect(html).not.toContain("Model karşılaştırması");
  });

  it("carries the Trey engine branding in API metadata without leaking it onto the card", () => {
    expect(item.rc.modelLabel).toBe("Trey");
    const html = renderToStaticMarkup(<RcPredictionCard item={item} navigate={() => {}} />);
    expect(html).not.toContain("Trey");
  });
});
