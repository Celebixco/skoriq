import { describe, expect, it } from "vitest";
import type { FootballMemberPredictionPreviewCandidate, FootballMemberPredictionPreviewResponse } from "../types";
import { selectableCouponPredictions } from "./coupon-candidates";

const now = Date.parse("2026-10-18T12:00:00Z");
const candidate: FootballMemberPredictionPreviewCandidate = {
  predictionId: "published-1", displayLabel: "MS 2,5 Üst", predictionType: "over_under_goals", predictionValue: "over_2_5",
  recommendationTier: "primary", confidenceScore: 72, riskLevel: "medium", reasoningSummary: null,
  generatedAt: "2026-10-18T11:00:00Z", kickoffAt: "2026-10-18T15:00:00Z", isFresh: true, analysisWindowStatus: "within_window"
};
function response(patch: Partial<FootballMemberPredictionPreviewResponse> = {}): FootballMemberPredictionPreviewResponse {
  return { matchId: "match-1", status: "available", reasonCode: "available", message: "Hazır", analysisWindow: { status: "within_window", windowHours: 36, minimumLeadMinutes: 30 }, groups: { primary: [candidate], try: [], alternative: [] }, summary: "", warnings: [], ...patch };
}

describe("Coupon member prediction boundary", () => {
  it("uses current published candidates once, preserving recommendation groups", () => {
    const alternative = { ...candidate, predictionId: "published-2", recommendationTier: "alternative" as const, displayLabel: "KG Var" };
    expect(selectableCouponPredictions(response({ groups: { primary: [candidate], try: [candidate], alternative: [alternative] } }), now)).toEqual([candidate, alternative]);
  });

  it.each(["stale", "not_ready", "not_available", "closed"] as const)("does not reuse candidates from a %s response", (status) => {
    expect(selectableCouponPredictions(response({ status }), now)).toEqual([]);
  });

  it.each(["too_early", "too_late", "closed", "unknown"] as const)("rejects the %s analysis window", (status) => {
    expect(selectableCouponPredictions(response({ analysisWindow: { status, windowHours: 36, minimumLeadMinutes: 30 } }), now)).toEqual([]);
  });

  it.each([{ isFresh: false }, { analysisWindowStatus: "stale" }, { analysisWindowStatus: "unknown" }, { kickoffAt: "invalid" }, { displayLabel: "" }, { confidenceScore: Number.NaN }, { confidenceScore: 101 }])("excludes malformed or withdrawn candidates: %j", (patch) => {
    expect(selectableCouponPredictions(response({ groups: { primary: [{ ...candidate, ...patch }], try: [], alternative: [] } }), now)).toEqual([]);
  });

  it("closes exactly at the server's minimum lead-time deadline", () => {
    expect(selectableCouponPredictions(response(), Date.parse(candidate.kickoffAt) - 30 * 60_000)).toEqual([]);
    expect(selectableCouponPredictions(response(), Date.parse(candidate.kickoffAt) - 30 * 60_000 - 1)).toHaveLength(1);
  });

  it("allows unknown confidence without inventing a number and allows the legacy nullable window", () => {
    expect(selectableCouponPredictions(response({ groups: { primary: [{ ...candidate, confidenceScore: null, analysisWindowStatus: null }], try: [], alternative: [] } }), now)).toHaveLength(1);
  });
});
