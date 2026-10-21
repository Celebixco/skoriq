import { describe, expect, it } from "vitest";
import type { RcPrematchItem } from "../types";
import { addCouponSelection, formatCouponText, rcCouponCandidate, type CouponMatch } from "./coupon-model";

const item: RcPrematchItem = {
  matchId: "rc-match-1",
  competitionId: "competition-1",
  league: "Premier League",
  kickoffAt: "2027-10-23T17:00:00Z",
  homeTeam: "Ipswich Town",
  awayTeam: "Nottingham Forest",
  homeTeamId: "team-home",
  awayTeamId: "team-away",
  homeTeamLogoUrl: "https://img.example.test/home.png",
  awayTeamLogoUrl: null,
  rc: { predictionId: "rc-prediction-1", predictionText: "Tahmin: Ipswich Town kazanır", p1: 0.47, px: 0.26, p2: 0.27, pick: "1", pickLabel: "Ev sahibi", modelId: "R-C", modelVersion: "stage11-fixed-R-A-R-C", modelLabel: "R-C • Beta", generatedAt: "2026-10-21T19:50:47Z", publishedAt: "2026-10-21T19:50:47Z" },
  ra: { predictionId: "ra-prediction-1", predictionText: "Tahmin: Ipswich Town kazanır", p1: 0.46, px: 0.28, p2: 0.26, pick: "1", pickLabel: "Ev sahibi", modelId: "R-A", modelVersion: "stage11-fixed-R-A-R-C", modelLabel: "R-A", generatedAt: "2026-10-21T19:50:47Z", publishedAt: "2026-10-21T19:50:47Z" },
  modelsDisagree: false,
  historyHomeN: 10,
  historyAwayN: 10,
  scopeLevel: "last10_available_unverified",
  historyCompleteness: "unverified",
  dataWarning: null,
  evaluationGroup: "multi_league_unassessed",
  performanceNote: "Bu ligde model performansı henüz değerlendirilmedi.",
  disclaimer: "Tahminler kesin sonuç garantisi değildir."
};

const match: CouponMatch = {
  matchId: item.matchId,
  kickoffAt: item.kickoffAt,
  status: "scheduled",
  competition: { name: item.league },
  homeTeam: { id: item.homeTeamId, name: item.homeTeam, logoUrl: item.homeTeamLogoUrl },
  awayTeam: { id: item.awayTeamId, name: item.awayTeam, logoUrl: item.awayTeamLogoUrl }
};

describe("R-C coupon selection", () => {
  it("keeps a stable prediction reference and does not duplicate the same match", () => {
    const candidate = rcCouponCandidate(item);
    const first = addCouponSelection([], match, candidate, 0);
    expect(first.outcome).toBe("added");
    expect(first.selections[0]?.prediction.predictionId).toBe("rc-prediction-1");
    expect(first.selections[0]?.prediction.selectionSource).toBe("rc_beta");
    const second = addCouponSelection(first.selections, match, candidate, 0);
    expect(second.outcome).toBe("duplicate");
    expect(second.selections).toHaveLength(1);
  });

  it("asks for confirmation instead of silently replacing a different pick", () => {
    const candidate = rcCouponCandidate(item);
    const first = addCouponSelection([], match, candidate, 0);
    const different = { ...candidate, predictionId: "rc-prediction-2", predictionText: "Tahmin: Beraberlik", predictionValue: "X" };
    const result = addCouponSelection(first.selections, match, different, 0);
    expect(result.outcome).toBe("conflict");
    expect(result.selections[0]?.prediction.predictionId).toBe("rc-prediction-1");
  });

  it("copies only readable fixture and selection text", () => {
    const first = addCouponSelection([], match, rcCouponCandidate(item), 0);
    const text = formatCouponText(first.selections);
    expect(text).toContain("Ipswich Town - Nottingham Forest");
    expect(text).toContain("Tahmin: Ipswich Town kazanır");
    expect(text).not.toMatch(/R-C|R-A|Beta|Güven|Risk|stage11/);
    expect(text).toContain("Tahminler kesin sonuç garantisi değildir.");
  });
});
