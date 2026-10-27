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
  it("shows teams, logos, time and the prediction strip on the Trey card skeleton", () => {
    const html = renderToStaticMarkup(<H1PredictionCard item={item} navigate={() => {}} />);
    expect(html).toContain("rc-simple-card");
    expect(html).toContain("Alanyaspor");
    expect(html).toContain("Kocaelispor");
    expect(html).toContain('alt="Alanyaspor logo"');
    expect(html).toContain("%78");
    expect(html).toContain("İlk yarıda en az 1 gol");
    expect(html).toContain("TSİ");
    expect(html).toContain("Maç detayı");
  });

  it("styles risky calls with the amber strip, safe calls with the volt strip", () => {
    const safeHtml = renderToStaticMarkup(<H1PredictionCard item={item} navigate={() => {}} />);
    expect(safeHtml).toContain("h1-card__pick");
    expect(safeHtml).not.toContain("h1-card__pick--risky");
    expect(safeHtml).not.toContain("h1-card--risky");

    const risky: H1PrematchItem = {
      ...item,
      h1: { ...item.h1, pGoal: 0.44, pick: "under_0_5", predictionText: "Tehlikeli — İY gol olasılığı %44" }
    };
    const riskyHtml = renderToStaticMarkup(<H1PredictionCard item={risky} navigate={() => {}} />);
    expect(riskyHtml).toContain("h1-card--risky");
    expect(riskyHtml).toContain("Tehlikeli");
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
