import type { FootballMemberPredictionPreviewCandidate, FootballMemberPredictionPreviewResponse } from "../types";

export interface CouponMatch {
  matchId: string;
  kickoffAt: string;
  status: string;
  competition: { name: string };
  homeTeam: { id: string; name: string; logoUrl?: string | null };
  awayTeam: { id: string; name: string; logoUrl?: string | null };
}

export interface CouponSelection {
  match: CouponMatch;
  prediction: FootballMemberPredictionPreviewCandidate;
  minimumLeadMinutes: number;
  addedAt: string;
}

export type CouponAddOutcome = "added" | "replaced" | "duplicate" | "expired" | "limit";
export const MAX_COUPON_SELECTIONS = 20;

type JsonRecord = Record<string, unknown>;
type CouponStorageReader = Pick<Storage, "getItem">;
type CouponStorageChange = { key: string | null; newValue: string | null; storageArea: CouponStorageReader | null };
type CouponValidationResult = {
  original: CouponSelection;
} & ({ status: "available"; prediction: FootballMemberPredictionPreviewCandidate; minimumLeadMinutes: number } | { status: "unavailable" | "error" });

function record(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonRecord : null;
}

function text(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 2_000;
}

function date(value: unknown): value is string {
  return text(value) && Number.isFinite(Date.parse(value));
}

function team(value: unknown): CouponMatch["homeTeam"] | null {
  const item = record(value);
  if (!item || !text(item.id) || !text(item.name)) return null;
  const result: CouponMatch["homeTeam"] = { id: item.id, name: item.name };
  if (item.logoUrl === null) result.logoUrl = null;
  else if (text(item.logoUrl) && /^https?:\/\//i.test(item.logoUrl)) result.logoUrl = item.logoUrl;
  return result;
}

/** This boundary also strips arbitrary metadata from local storage and API values. */
function normalizeSelection(value: unknown, now: number): CouponSelection | null {
  const item = record(value);
  const match = record(item?.match);
  const prediction = record(item?.prediction);
  const competition = record(match?.competition);
  const homeTeam = team(match?.homeTeam);
  const awayTeam = team(match?.awayTeam);
  if (!item || !match || !prediction || !competition || !homeTeam || !awayTeam) return null;
  if (!text(match.matchId) || !text(competition.name) || !date(match.kickoffAt)) return null;
  if (match.status !== "scheduled" && match.status !== "not_started") return null;
  if (!date(item.addedAt) || typeof item.minimumLeadMinutes !== "number" || !Number.isFinite(item.minimumLeadMinutes) || item.minimumLeadMinutes < 0) return null;
  if (!text(prediction.predictionId) || !text(prediction.displayLabel) || !text(prediction.predictionType) || !text(prediction.predictionValue) || !text(prediction.riskLevel)) return null;
  if (prediction.recommendationTier !== "primary" && prediction.recommendationTier !== "try" && prediction.recommendationTier !== "alternative") return null;
  if (!date(prediction.generatedAt) || !date(prediction.kickoffAt) || prediction.isFresh !== true) return null;
  if (prediction.analysisWindowStatus !== null && prediction.analysisWindowStatus !== "within_window") return null;
  const confidenceScore = prediction.confidenceScore;
  if (confidenceScore !== null && (typeof confidenceScore !== "number" || !Number.isFinite(confidenceScore) || confidenceScore < 0 || confidenceScore > 100)) return null;
  const deadline = Date.parse(prediction.kickoffAt) - item.minimumLeadMinutes * 60_000;
  if (!Number.isFinite(deadline) || deadline <= now) return null;
  return {
    match: { matchId: match.matchId, kickoffAt: prediction.kickoffAt, status: match.status, competition: { name: competition.name }, homeTeam, awayTeam },
    prediction: {
      predictionId: prediction.predictionId, displayLabel: prediction.displayLabel,
      predictionType: prediction.predictionType, predictionValue: prediction.predictionValue,
      recommendationTier: prediction.recommendationTier, confidenceScore, riskLevel: prediction.riskLevel,
      reasoningSummary: typeof prediction.reasoningSummary === "string" ? prediction.reasoningSummary.trim().slice(0, 2_000) || null : null, generatedAt: prediction.generatedAt,
      kickoffAt: prediction.kickoffAt, isFresh: true, analysisWindowStatus: prediction.analysisWindowStatus
    },
    minimumLeadMinutes: item.minimumLeadMinutes,
    addedAt: item.addedAt
  };
}

export function couponSelectionDeadline(selection: CouponSelection): number {
  return Date.parse(selection.prediction.kickoffAt) - selection.minimumLeadMinutes * 60_000;
}

export function expireCouponSelections(selections: CouponSelection[], now = Date.now()): CouponSelection[] {
  const fresh = selections.filter((selection) => couponSelectionDeadline(selection) > now);
  return fresh.length === selections.length ? selections : fresh;
}

export function addCouponSelection(selections: CouponSelection[], match: CouponMatch, prediction: FootballMemberPredictionPreviewCandidate, minimumLeadMinutes: number, now = Date.now()): { selections: CouponSelection[]; outcome: CouponAddOutcome } {
  const fresh = expireCouponSelections(selections, now);
  const next = normalizeSelection({ match, prediction, minimumLeadMinutes, addedAt: new Date(now).toISOString() }, now);
  if (!next) return { selections: fresh, outcome: "expired" };
  const index = fresh.findIndex((selection) => selection.match.matchId === next.match.matchId);
  if (index >= 0) {
    if (fresh[index]?.prediction.predictionId === next.prediction.predictionId) return { selections: fresh, outcome: "duplicate" };
    return { selections: fresh.map((selection, position) => position === index ? next : selection), outcome: "replaced" };
  }
  if (fresh.length >= MAX_COUPON_SELECTIONS) return { selections: fresh, outcome: "limit" };
  return { selections: [...fresh, next], outcome: "added" };
}

export function couponStorageKey(userId: string): string {
  return `skoriq:coupon:v1:${encodeURIComponent(userId)}`;
}

export function deserializeCoupon(saved: string | null, userId: string, now = Date.now()): CouponSelection[] {
  if (!saved) return [];
  try {
    const data = record(JSON.parse(saved));
    if (data?.version !== 1 || data.userId !== userId || !Array.isArray(data.selections)) return [];
    const selections: CouponSelection[] = [];
    const seen = new Set<string>();
    // Read only a bounded number of rows from a potentially altered storage value.
    for (const row of data.selections.slice(0, 200)) {
      const selection = normalizeSelection(row, now);
      if (!selection || seen.has(selection.match.matchId)) continue;
      selections.push(selection);
      seen.add(selection.match.matchId);
      if (selections.length === MAX_COUPON_SELECTIONS) break;
    }
    return selections;
  } catch {
    return [];
  }
}

export function loadCoupon(storage: CouponStorageReader | null, userId: string, now = Date.now()): CouponSelection[] {
  try {
    return deserializeCoupon(storage?.getItem(couponStorageKey(userId)) ?? null, userId, now);
  } catch {
    return [];
  }
}

export function serializeCoupon(userId: string, selections: CouponSelection[]): string {
  const safe = selections.map((selection) => normalizeSelection(selection, Number.NEGATIVE_INFINITY)).filter((selection): selection is CouponSelection => selection !== null).slice(0, MAX_COUPON_SELECTIONS);
  return JSON.stringify({ version: 1, userId, selections: safe });
}

/** A null result is an unrelated or already-applied event, including other accounts. */
export function reconcileCouponStorageChange(current: CouponSelection[], event: CouponStorageChange, storage: CouponStorageReader | null, userId: string, now = Date.now()): CouponSelection[] | null {
  if (storage === null || event.storageArea !== storage || (event.key !== null && event.key !== couponStorageKey(userId))) return null;
  const incoming = deserializeCoupon(event.key === null ? null : event.newValue, userId, now);
  return serializeCoupon(userId, incoming) === serializeCoupon(userId, current) ? null : incoming;
}

export async function validateCouponSelections(selections: CouponSelection[], fetchPreview: (matchId: string) => Promise<FootballMemberPredictionPreviewResponse>): Promise<CouponValidationResult[]> {
  return Promise.all(selections.map(async (original): Promise<CouponValidationResult> => {
    try {
      const response = await fetchPreview(original.match.matchId);
      if (response.matchId !== original.match.matchId || response.status !== "available" || response.analysisWindow?.status !== "within_window") return { original, status: "unavailable" };
      const prediction = [response.groups?.primary, response.groups?.try, response.groups?.alternative].flatMap((group) => Array.isArray(group) ? group : []).find((item) => item?.predictionId === original.prediction.predictionId);
      if (!prediction) return { original, status: "unavailable" };
      return { original, status: "available", prediction, minimumLeadMinutes: response.analysisWindow.minimumLeadMinutes };
    } catch {
      return { original, status: "error" };
    }
  }));
}

/** Apply only to the original objects still selected; edits made during fetch win. */
export function reconcileCouponValidation(current: CouponSelection[], results: CouponValidationResult[], now = Date.now()): { selections: CouponSelection[]; removedCount: number; failedCount: number } {
  const byOriginal = new Map(results.map((result) => [result.original, result]));
  const selections: CouponSelection[] = [];
  let removedCount = 0;
  let failedCount = 0;
  for (const selection of current) {
    const result = byOriginal.get(selection);
    if (couponSelectionDeadline(selection) <= now || result?.status === "unavailable") {
      removedCount++;
      continue;
    }
    if (result?.status === "available") {
      const updated = normalizeSelection({ ...selection, prediction: result.prediction, minimumLeadMinutes: result.minimumLeadMinutes }, now);
      if (updated) selections.push(updated);
      else removedCount++;
    } else {
      selections.push(selection);
      if (result?.status === "error") failedCount++;
    }
  }
  const unchanged = selections.length === current.length && selections.every((selection, index) => selection === current[index]);
  return { selections: unchanged ? current : selections, removedCount, failedCount };
}

const couponDate = new Intl.DateTimeFormat("tr-TR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Istanbul" });
const confidence = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 });

export function formatCouponText(selections: CouponSelection[]): string {
  const rows = selections.map((selection, index) => {
    const risk = ({ low: "Düşük", medium: "Orta", high: "Yüksek" } as Record<string, string>)[selection.prediction.riskLevel.toLowerCase()] ?? "Belirtilmedi";
    const score = selection.prediction.confidenceScore;
    return `${index + 1}. ${selection.match.homeTeam.name} - ${selection.match.awayTeam.name}\n${selection.match.competition.name} · ${couponDate.format(new Date(selection.prediction.kickoffAt))} (TSİ)\nSeçim: ${selection.prediction.displayLabel} · Güven: ${score === null ? "—" : `${confidence.format(score)}/100`} · Risk: ${risk}`;
  });
  return [`SkorIQ · ${selections.length} maçlık kombin`, ...rows, "Bu bir analiz taslağıdır. Sonuç garantisi içermez."].join("\n\n");
}
