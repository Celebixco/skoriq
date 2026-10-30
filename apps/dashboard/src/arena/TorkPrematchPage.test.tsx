import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TorkPrematchItem } from "../types";
import { TorkPredictionCard, TorkUpcomingPage } from "./TorkPrematchPage";
import { torkCouponCandidate } from "./coupon-model";

const publication = vi.hoisted(() => ({ data: null as unknown }));
vi.mock("./use-tork-publication", () => ({
  useTorkPublication: () => ({ data: publication.data, error: null, loading: false })
}));
beforeEach(() => { publication.data = null; });

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
  tork: { predictionId: "prediction-tork", predictionText: "Karşılıklı gol var (%61 olasılık)", pBtts: 0.612, selectionProbability: 0.612, decisionPolicyVersion: null, decisionThreshold: null, modelHash: "test-hash", expectedBttsGoals: 1.22, pick: "btts_yes", pickLabel: "Karşılıklı gol var", modelId: "TORK-A", modelVersion: "tork-stage1-logistic-blend", modelLabel: "Tork", generatedAt: "2026-10-21T15:26:45Z", publishedAt: "2026-10-21T18:40:00Z" },
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
    expect(html).toContain("%61");
    expect(html).toContain("Karşılıklı gol var");
    expect(html).toContain("TSİ");
    expect(html).toContain("Maç detayı");
  });

  it("distinguishes published KG Var and KG Yok picks rather than treating a probability band as safe", () => {
    const yesHtml = renderToStaticMarkup(<TorkPredictionCard item={item} navigate={() => {}} />);
    expect(yesHtml).toContain('data-tork-selection="btts_yes"');
    expect(yesHtml).not.toContain("tork-card__pick--risky");

    const no: TorkPrematchItem = {
      ...item,
      tork: { ...item.tork, pBtts: 0.61, pick: "btts_no", selectionProbability: 0.39 }
    };
    const noHtml = renderToStaticMarkup(<TorkPredictionCard item={no} navigate={() => {}} />);
    expect(noHtml).toContain('data-tork-selection="btts_no"');
    expect(noHtml).toContain("tork-card--risky");
    expect(noHtml).toContain("Karşılıklı gol yok (%39 olasılık)");
    expect(noHtml).not.toContain("Karşılıklı gol var");
  });

  it.each([0.5, 0.52, 0.54])("keeps the published binary KG Var pick at p=%s instead of reapplying 0.55", (pBtts) => {
    const variant: TorkPrematchItem = { ...item, tork: { ...item.tork, pBtts, selectionProbability: pBtts, pick: "btts_yes", decisionThreshold: 0.5 } };
    const html = renderToStaticMarkup(<TorkPredictionCard item={variant} />);
    expect(html).toContain("Karşılıklı gol var");
    expect(html).not.toContain("tork-card--risky");
  });

  it("never leaks the internal threshold value to members", () => {
    for (const pBtts of [0.41, 0.54, 0.612]) {
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
    expect(candidate.confidenceScore).toBe(61);
    expect(candidate.riskLevel).toBe("medium");
  });

  it("builds a legacy KG Yok coupon with the complement and a cautious risk label", () => {
    const legacy: TorkPrematchItem = { ...item, tork: { ...item.tork, pBtts: 0.61, pick: "btts_no", selectionProbability: 0.39 } };
    const candidate = torkCouponCandidate(legacy);
    expect(candidate.predictionValue).toBe("btts_no");
    expect(candidate.displayLabel).toBe("Karşılıklı gol yok (%39 olasılık)");
    expect(candidate.confidenceScore).toBe(39);
    expect(candidate.riskLevel).toBe("high");
  });

  it.each([
    { pBtts: null }, { pBtts: Number.NaN }, { pBtts: -0.1 }, { pBtts: 1.1 }, { pick: null }, { pick: "invalid" }
  ])("fails closed for malformed Tork data without displaying or offering a KG Yok coupon: %j", (invalid) => {
    const malformed = { ...item, tork: { ...item.tork, ...invalid } } as TorkPrematchItem;
    expect(renderToStaticMarkup(<TorkPredictionCard item={malformed} />)).toBe("");
    expect(() => torkCouponCandidate(malformed)).toThrow(/invalid_tork/);
  });

  it("counts KG Var publications rather than making a strong-signal or performance claim", () => {
    publication.data = {
      items: [
        { ...item, performanceNote: "Unsupported backtest success claim", tork: { ...item.tork, pBtts: 0.5, pick: "btts_yes", predictionId: "yes" } },
        { ...item, matchId: "match-2", tork: { ...item.tork, pBtts: 0.61, pick: "btts_no", predictionId: "no" } }
      ]
    };
    const html = renderToStaticMarkup(<TorkUpcomingPage navigate={() => {}} />);
    expect(html).toContain('aria-label="KG Var tahmin sayısı"><strong>1</strong>');
    expect(html).toContain("KG Var tahmini");
    expect(html).not.toContain("güçlü sinyal");
    expect(html).not.toContain("Unsupported backtest");
    expect(html).toContain("Tahminler kesin sonuç garantisi değildir.");
  });
});
