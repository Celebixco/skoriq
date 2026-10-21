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
  rc: { p1: 0.4667, px: 0.2634, p2: 0.2699, pick: "1", pickLabel: "Ev sahibi", modelId: "R-C", modelVersion: "stage11-fixed-R-A-R-C", modelLabel: "R-C • Beta", generatedAt: "2026-10-21T15:26:45Z", publishedAt: "2026-10-21T18:40:00Z" },
  ra: { p1: 0.4904, px: 0.2729, p2: 0.2367, pick: "1", pickLabel: "Ev sahibi", modelId: "R-A", modelVersion: "stage11-fixed-R-A-R-C", modelLabel: "R-A", generatedAt: "2026-10-21T15:26:45Z", publishedAt: "2026-10-21T18:40:00Z" },
  modelsDisagree: false,
  historyHomeN: 10,
  historyAwayN: 10,
  scopeLevel: "last10_available_unverified",
  historyCompleteness: "unverified",
  dataWarning: "Geçmiş pencere tam doğrulanmadı.",
  evaluationGroup: "stage12_1",
  performanceNote: null,
  disclaimer: "Deneysel model olasılıklarıdır; sonuç garantisi değildir."
};

describe("R-C beta prediction card", () => {
  it("renders the beta label, probabilities, comparison and disclaimer", () => {
    const html = renderToStaticMarkup(<RcPredictionCard item={item} />);
    expect(html).toContain("R-C • Beta");
    expect(html).toContain("Alanyaspor");
    expect(html).toContain("Kocaelispor");
    expect(html).toContain("46.7%");
    expect(html).toContain("Model karşılaştırması");
    expect(html).toContain("R-A seçimi: <strong>Ev sahibi</strong>");
    expect(html).toContain("Deneysel model olasılıklarıdır");
  });

  it("shows disagreement explicitly", () => {
    const html = renderToStaticMarkup(<RcPredictionCard item={{ ...item, modelsDisagree: true, ra: { ...item.ra, pick: "2", pickLabel: "Deplasman" } }} />);
    expect(html).toContain("Modeller farklı değerlendiriyor");
  });
});
