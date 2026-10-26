import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { H1PrematchItem } from "../types";
import { H1PredictionCard } from "./H1PrematchPage";
import { h1CouponCandidate } from "./coupon-model";

const item: H1PrematchItem = {
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
  h1: { predictionId: "prediction-h1", predictionText: "İlk yarıda en az 1 gol (%78 olasılık)", pGoal: 0.7812, expectedH1Goals: 1.52, pick: "over_0_5", pickLabel: "İlk yarıda gol var", modelId: "H1-A", modelVersion: "h1-stage1-logistic-blend", modelLabel: "Volt", generatedAt: "2026-10-21T15:26:45Z", publishedAt: "2026-10-21T18:40:00Z" },
  historyHomeN: 10,
  historyAwayN: 9,
  scopeLevel: "last10_available_unverified",
  historyCompleteness: "unverified",
  evaluationGroup: "h1_stage1_retrospective",
  performanceNote: null,
  disclaimer: "Tahminler kesin sonuç garantisi değildir."
};

describe("first-half goal prediction card", () => {
  it("shows teams, logos, time, probability and expectation", () => {
    const html = renderToStaticMarkup(<H1PredictionCard item={item} navigate={() => {}} />);
    expect(html).toContain("Alanyaspor");
    expect(html).toContain("Kocaelispor");
    expect(html).toContain('alt="Alanyaspor logo"');
    expect(html).toContain("%78");
    expect(html).toContain("İlk yarıda en az 1 gol");
    expect(html).toContain("1.52");
    expect(html).toContain("TSİ");
    expect(html).toContain("Maç detayı");
  });

  it("marks strong signals with the high tone", () => {
    const html = renderToStaticMarkup(<H1PredictionCard item={item} navigate={() => {}} />);
    expect(html).toContain('data-tone="high"');
  });

  it("marks low probabilities with the low tone and risky verdict styling", () => {
    const low: H1PrematchItem = {
      ...item,
      h1: { ...item.h1, pGoal: 0.44, pick: "under_0_5", predictionText: "Tehlikeli — İY gol olasılığı %44" }
    };
    const html = renderToStaticMarkup(<H1PredictionCard item={low} navigate={() => {}} />);
    expect(html).toContain('data-tone="low"');
    expect(html).toContain("h1-pick--risky");
    expect(html).toContain("Tehlikeli");
  });

  it("labels 75%+ matches as a safe goal call and below as dangerous", () => {
    const mid: H1PrematchItem = {
      ...item,
      h1: { ...item.h1, pGoal: 0.729, predictionText: "Tehlikeli — İY gol olasılığı %73" }
    };
    const riskyHtml = renderToStaticMarkup(<H1PredictionCard item={mid} navigate={() => {}} />);
    expect(riskyHtml).toContain("Tehlikeli");
    expect(riskyHtml).toContain("h1-pick--risky");
    expect(riskyHtml).not.toContain('data-tone="high"');

    const safeHtml = renderToStaticMarkup(<H1PredictionCard item={item} navigate={() => {}} />);
    expect(safeHtml).toContain("En az 1 gol");
    expect(safeHtml).not.toContain("Tehlikeli");
    expect(safeHtml).toContain('data-tone="high"');
  });

  it("never leaks the internal threshold value to members", () => {
    for (const pGoal of [0.44, 0.729, 0.7812]) {
      const variant: H1PrematchItem = { ...item, h1: { ...item.h1, pGoal } };
      const html = renderToStaticMarkup(<H1PredictionCard item={variant} navigate={() => {}} />);
      expect(html).not.toContain("eşik");
      expect(html).not.toContain("Eşik");
    }
  });

  it("does not leak internal model ids onto the member card", () => {
    const html = renderToStaticMarkup(<H1PredictionCard item={item} navigate={() => {}} />);
    expect(html).not.toContain("H1-A");
    expect(html).not.toContain("h1-stage1");
    expect(html).not.toContain("logit");
  });

  it("builds a coupon candidate with the beta source flag", () => {
    const candidate = h1CouponCandidate(item);
    expect(candidate.selectionSource).toBe("h1_beta");
    expect(candidate.predictionType).toBe("h1_first_half_goals");
    expect(candidate.predictionValue).toBe("over_0_5");
    expect(candidate.confidenceScore).toBe(78);
  });
});
