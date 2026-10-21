import { describe, expect, it } from "vitest";
import type { FootballMemberPredictionPreviewCandidate, FootballMemberPredictionPreviewResponse } from "../types";
import {
  addCouponSelection, couponStorageKey, deserializeCoupon, expireCouponSelections,
  formatCouponText, loadCoupon, reconcileCouponStorageChange, reconcileCouponValidation, serializeCoupon, validateCouponSelections,
  type CouponMatch, type CouponSelection
} from "./coupon-model";

const now = Date.parse("2026-10-18T10:00:00Z");
const match: CouponMatch = {
  matchId: "match-1", kickoffAt: "2026-10-18T12:00:00Z", status: "scheduled",
  competition: { name: "Süper Lig" }, homeTeam: { id: "home", name: "Ankara Kuzey" }, awayTeam: { id: "away", name: "İzmir Güney" }
};
const candidate: FootballMemberPredictionPreviewCandidate = {
  predictionId: "prediction-1", displayLabel: "MS 2,5 Üst", predictionType: "total_goals", predictionValue: "over_2_5",
  recommendationTier: "primary", confidenceScore: 64, riskLevel: "medium", reasoningSummary: "Form verileri.",
  generatedAt: "2026-10-18T09:00:00Z", kickoffAt: "2026-10-18T12:00:00Z", isFresh: true, analysisWindowStatus: "within_window"
};
function selection(id = "match-1"): CouponSelection {
  return { match: { ...match, matchId: id }, prediction: { ...candidate, predictionId: `prediction-${id}` }, minimumLeadMinutes: 10, addedAt: "2026-10-18T09:59:00Z" };
}
function preview(prediction = candidate): FootballMemberPredictionPreviewResponse {
  return { matchId: "match-1", status: "available", reasonCode: "available", message: "Hazır", analysisWindow: { status: "within_window", windowHours: 24, minimumLeadMinutes: 15 }, groups: { primary: [prediction], try: [], alternative: [] }, summary: "Özet", warnings: [] };
}

describe("coupon draft edits", () => {
  it("adds one candidate per match, ignores duplicates and replaces in the original position", () => {
    const first = addCouponSelection([], match, candidate, 10, now);
    expect(first.outcome).toBe("added");
    const second = addCouponSelection(first.selections, { ...match, matchId: "match-2" }, candidate, 10, now);
    const duplicate = addCouponSelection(second.selections, match, candidate, 10, now);
    expect(duplicate.outcome).toBe("duplicate");
    expect(duplicate.selections).toBe(second.selections);
    const replacement = addCouponSelection(second.selections, match, { ...candidate, predictionId: "other" }, 10, now);
    expect(replacement.outcome).toBe("replaced");
    expect(replacement.selections.map((item) => [item.match.matchId, item.prediction.predictionId])).toEqual([["match-1", "other"], ["match-2", "prediction-1"]]);
  });

  it("limits unique matches to twenty while still allowing a replacement", () => {
    const twenty = Array.from({ length: 20 }, (_, index) => selection(`match-${index}`));
    expect(addCouponSelection(twenty, { ...match, matchId: "extra" }, candidate, 10, now).outcome).toBe("limit");
    expect(addCouponSelection(twenty, match, candidate, 10, now).outcome).toBe("replaced");
  });

  it("expires at the candidate kickoff minus policy lead time, including the exact boundary", () => {
    const shifted = { ...candidate, kickoffAt: "2026-10-18T10:20:00Z" };
    const result = addCouponSelection([], match, shifted, 10, now);
    expect(result.selections[0]?.match.kickoffAt).toBe("2026-10-18T10:20:00Z");
    expect(expireCouponSelections(result.selections, now + 599_999)).toHaveLength(1);
    expect(expireCouponSelections(result.selections, now + 600_000)).toEqual([]);
    expect(addCouponSelection([], match, shifted, 20, now).outcome).toBe("expired");
  });

  it.each([
    { isFresh: false }, { analysisWindowStatus: "unknown" }, { analysisWindowStatus: "stale" },
    { confidenceScore: NaN }, { confidenceScore: Infinity }, { confidenceScore: -1 }, { confidenceScore: 101 },
    { kickoffAt: "invalid" }, { kickoffAt: "2026-10-18T09:00:00Z" }
  ])("rejects unsafe candidate fields %j", (fields) => {
    expect(addCouponSelection([], match, { ...candidate, ...fields }, 10, now).outcome).toBe("expired");
  });

  it("allows a fresh unknown confidence and rejects live matches or invalid policy", () => {
    expect(addCouponSelection([], match, { ...candidate, confidenceScore: null, analysisWindowStatus: null }, 0, now).outcome).toBe("added");
    expect(addCouponSelection([], { ...match, status: "live" }, candidate, 0, now).outcome).toBe("expired");
    expect(addCouponSelection([], match, candidate, -10, now).outcome).toBe("expired");
    expect(addCouponSelection([], match, candidate, NaN, now).outcome).toBe("expired");
  });

  it("normalizes nonessential blank reasoning and truncates long reasoning without rejecting a valid pick", () => {
    const blank = addCouponSelection([], match, { ...candidate, reasoningSummary: "" }, 10, now);
    expect(blank.outcome).toBe("added");
    expect(blank.selections[0]?.prediction.reasoningSummary).toBeNull();
    const long = addCouponSelection([], match, { ...candidate, reasoningSummary: "a".repeat(2_050) }, 10, now);
    expect(long.outcome).toBe("added");
    expect(long.selections[0]?.prediction.reasoningSummary).toHaveLength(2_000);
    expect(addCouponSelection([], match, { ...candidate, displayLabel: "" }, 10, now).outcome).toBe("expired");
  });
});

describe("account scoped coupon storage", () => {
  it("restores only whitelisted fields in the same account and drops expired rows", () => {
    const saved = JSON.stringify({ version: 1, userId: "user/a", selections: [{ ...selection(), secret: "discard", match: { ...match, adminMetadata: "discard" }, prediction: { ...candidate, secret: "discard" } }, { ...selection("old"), prediction: { ...candidate, kickoffAt: "2026-10-18T10:10:00Z" } }] });
    const restored = deserializeCoupon(saved, "user/a", now);
    expect(restored).toHaveLength(1);
    expect(JSON.stringify(restored)).not.toContain("discard");
    expect(deserializeCoupon(saved, "user/b", now)).toEqual([]);
    expect(couponStorageKey("user/a")).toBe("skoriq:coupon:v1:user%2Fa");
    expect(deserializeCoupon(serializeCoupon("user/a", restored), "user/a", now)).toEqual(restored);
  });

  it.each(["bad-json", "null", "[]", '{"version":2,"userId":"u","selections":[]}', '{"version":1,"userId":"u","selections":[null,{}, {"__proto__":{"admin":true}}]}'])
  ("handles invalid or hostile storage safely: %s", (saved) => {
    expect(deserializeCoupon(saved, "u", now)).toEqual([]);
  });

  it("enforces stored row validation and unique-match limits", () => {
    const rows = Array.from({ length: 23 }, (_, index) => selection(`match-${index}`));
    rows.unshift(selection("match-0"));
    rows.push({ ...selection("invalid"), prediction: { ...candidate, isFresh: false } });
    const restored = deserializeCoupon(JSON.stringify({ version: 1, userId: "u", selections: rows }), "u", now);
    expect(restored).toHaveLength(20);
    expect(new Set(restored.map((item) => item.match.matchId)).size).toBe(20);
  });

  it("survives blocked storage and reads only the current account key", () => {
    expect(loadCoupon({ getItem() { throw new Error("Blocked"); } }, "u", now)).toEqual([]);
    const values = new Map([[couponStorageKey("a"), serializeCoupon("a", [selection()])]]);
    expect(loadCoupon({ getItem: (key) => values.get(key) ?? null }, "a", now)).toHaveLength(1);
    expect(loadCoupon({ getItem: (key) => values.get(key) ?? null }, "b", now)).toEqual([]);
  });

  it("imports same-account local-storage edits but ignores other accounts and session storage", () => {
    const storage = { getItem: () => null };
    const event = { key: "skoriq:coupon:v1:a", newValue: serializeCoupon("a", [selection()]), storageArea: storage };
    const imported = reconcileCouponStorageChange([], event, storage, "a", now);
    expect(imported).toHaveLength(1);
    expect(reconcileCouponStorageChange([], event, storage, "b", now)).toBeNull();
    expect(reconcileCouponStorageChange([], { ...event, storageArea: { getItem: () => null } }, storage, "a", now)).toBeNull();
    expect(reconcileCouponStorageChange([], event, null, "a", now)).toBeNull();
  });

  it("ignores equivalent serialized content and imports removals without a storage ping-pong", () => {
    const current = [selection()];
    const storage = { getItem: () => null };
    const event = { key: "skoriq:coupon:v1:a", newValue: serializeCoupon("a", current), storageArea: storage };
    expect(reconcileCouponStorageChange(current, event, storage, "a", now)).toBeNull();
    const withMetadata = JSON.parse(event.newValue);
    withMetadata.selections[0].extra = "ignored";
    expect(reconcileCouponStorageChange(current, { ...event, newValue: JSON.stringify(withMetadata) }, storage, "a", now)).toBeNull();
    expect(reconcileCouponStorageChange(current, { ...event, newValue: null }, storage, "a", now)).toEqual([]);
    expect(reconcileCouponStorageChange(current, { ...event, key: null, newValue: null }, storage, "a", now)).toEqual([]);
    expect(reconcileCouponStorageChange([], { ...event, newValue: null }, storage, "a", now)).toBeNull();
  });
});

describe("coupon preview validation", () => {
  it("refreshes the same prediction and adopts the server kickoff and lead policy", async () => {
    const item = { ...selection(), prediction: candidate };
    const results = await validateCouponSelections([item], async () => preview({ ...candidate, confidenceScore: 71, kickoffAt: "2026-10-18T13:00:00Z" }));
    const result = reconcileCouponValidation([item], results, now);
    expect(result.selections[0]?.prediction.confidenceScore).toBe(71);
    expect(result.selections[0]?.match.kickoffAt).toBe("2026-10-18T13:00:00Z");
    expect(result.selections[0]?.minimumLeadMinutes).toBe(15);
    expect(result.failedCount).toBe(0);
  });

  it("removes unavailable predictions but retains them on a network error", async () => {
    const item = { ...selection(), prediction: candidate };
    const unavailable = await validateCouponSelections([item], async () => ({ ...preview(), status: "closed" }));
    const closed = reconcileCouponValidation([item], unavailable, now);
    expect(closed.selections).toEqual([]);
    expect(closed.removedCount).toBe(1);
    const errors = await validateCouponSelections([item], async () => { throw new Error("Offline"); });
    const offline = reconcileCouponValidation([item], errors, now);
    expect(offline.selections).toEqual([item]);
    expect(offline.failedCount).toBe(1);
  });

  it("does not resurrect removals or overwrite replacements and additions made in flight", async () => {
    const original = { ...selection(), prediction: candidate };
    const results = await validateCouponSelections([original], async () => preview({ ...candidate, confidenceScore: 90 }));
    const replacement = { ...original, prediction: { ...candidate, predictionId: "replacement" } };
    const newItem = selection("new");
    expect(reconcileCouponValidation([], results, now).selections).toEqual([]);
    const current = reconcileCouponValidation([replacement, newItem], results, now);
    expect(current.selections).toEqual([replacement, newItem]);
    expect(current.failedCount).toBe(0);
  });

  it.each(["wrong-match", "missing-prediction", "unsafe-window", "stale-candidate", "lead-deadline"])
  ("removes a selection when revalidation returns %s", async (scenario) => {
    const item = { ...selection(), prediction: candidate };
    const response = preview();
    if (scenario === "wrong-match") response.matchId = "other";
    if (scenario === "missing-prediction") response.groups.primary = [];
    if (scenario === "unsafe-window") response.analysisWindow.status = "unknown";
    if (scenario === "stale-candidate") response.groups.primary = [{ ...candidate, isFresh: false }];
    if (scenario === "lead-deadline") response.analysisWindow.minimumLeadMinutes = 120;
    const results = await validateCouponSelections([item], async () => response);
    expect(reconcileCouponValidation([item], results, now).selections).toEqual([]);
  });
});

describe("coupon text", () => {
  it("summarizes individual match picks without model, confidence or odds", () => {
    const text = formatCouponText([{ ...selection(), prediction: candidate }]);
    expect(text).toContain("1 maçlık seçim");
    expect(text).toContain("Ankara Kuzey - İzmir Güney");
    expect(text).toContain("MS 2,5 Üst");
    expect(text).toContain("Tahmin: MS 2,5 Üst");
    expect(text).not.toContain("Güven");
    expect(text).not.toContain("Risk");
    expect(text).toContain("18.10.2026");
    expect(text).toContain("Tahminler kesin sonuç garantisi değildir.");
    expect(text).not.toMatch(/oran|toplam güven|kazanma olasılığı/i);
  });
});
