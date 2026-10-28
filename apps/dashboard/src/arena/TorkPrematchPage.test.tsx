import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { TorkPrematchItem } from "../types";
import { TorkPredictionCard } from "./TorkPrematchPage";
import { torkCouponCandidate } from "./coupon-model";

const item: TorkPrematchItem = {
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
  tork: { predictionId: "prediction-tork", predictionText: "Her iki takım da gol atar (%80 olasılık)", pBtts: 0.802, expectedBttsGoals: 1.6, pick: "btts_yes", pickLabel: "Her iki takım da gol atar", modelId: "TORK-A", modelVersion: "tork-stage1-logistic-blend", modelLabel: "Tork", generatedAt: "2026-10-21T15:26:45Z", publishedAt: "2026-10-21T18:40:00Z" },
  historyHomeN: 10,
  historyAwayN: 9,
  scopeLevel: "last10_available_unverified",
  historyCompleteness: "unverified",
  evaluationGroup: "tork_stage1_retrospective",
  performanceNote: null,
  disclaimer: "Tahminler kesin sonuç garantisi değildir."
};

describe("Tork BTTS prediction card", () => {
  it("shows teams, logos, time and the prediction strip on the shared card skeleton", () => {
    const html = renderToStaticMarkup(<TorkPredictionCard item={item} navigate={() => {}} />);
    expect(html).toContain("rc-simple-card");
    expect(html).toContain("Alanyaspor");
    expect(html).toContain("Kocaelispor");
    expect(html).toContain("%80");
    expect(html).toContain("Her iki takım da gol atar");
    expect(html).toContain("TSİ");
    expect(html).toContain("Maç detayı");
  });

  it("styles risky calls with the amber strip and keeps safe calls teal", () => {
    const safeHtml = renderToStaticMarkup(<TorkPredictionCard item={item} navigate={() => {}} />);
    expect(safeHtml).toContain("tork-card__pick");
    expect(safeHtml).not.toContain("tork-card__pick--risky");

    const risky: TorkPrematchItem = {
      ...item,
      tork: { ...item.tork, pBtts: 0.41, pick: "btts_no", predictionText: "İki takım da gol atmaz (%59 olasılık)" }
    };
    const riskyHtml = renderToStaticMarkup(<TorkPredictionCard item={risky} navigate={() => {}} />);
    expect(riskyHtml).toContain("tork-card--risky");
    expect(riskyHtml).toContain("İki takım da gol atmaz");
  });

  it("never leaks the internal threshold value to members", () => {
    for (const pBtts of [0.41, 0.55, 0.802]) {
      const variant: TorkPrematchItem = { ...item, tork: { ...item.tork, pBtts } };
      const html = renderToStaticMarkup(<TorkPredictionCard item={variant} navigate={() => {}} />);
      expect(html).not.toContain("eşik");
      expect(html).not.toContain("Eşik");
    }
  });

  it("does not leak internal model ids onto the member card", () => {
    const html = renderToStaticMarkup(<TorkPredictionCard item={item} navigate={() => {}} />);
    expect(html).not.toContain("TORK-A");
    expect(html).not.toContain("tork-stage1");
  });

  it("builds a coupon candidate with the tork beta source flag", () => {
    const candidate = torkCouponCandidate(item);
    expect(candidate.selectionSource).toBe("tork_beta");
    expect(candidate.predictionType).toBe("tork_btts");
    expect(candidate.predictionValue).toBe("btts_yes");
    expect(candidate.confidenceScore).toBe(80);
  });
});
