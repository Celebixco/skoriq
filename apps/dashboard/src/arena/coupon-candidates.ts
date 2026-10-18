import type { FootballMemberPredictionPreviewCandidate, FootballMemberPredictionPreviewResponse } from "../types";

/** Only the member API's currently published, open-window choices can enter a draft. */
export function selectableCouponPredictions(data: FootballMemberPredictionPreviewResponse, now = Date.now()): FootballMemberPredictionPreviewCandidate[] {
  if (data.status !== "available" || data.analysisWindow.status !== "within_window") return [];
  const lead = data.analysisWindow.minimumLeadMinutes;
  if (!Number.isFinite(lead) || lead < 0) return [];
  const seen = new Set<string>();
  return ["primary", "try", "alternative"].flatMap((tier) => data.groups[tier as keyof typeof data.groups] ?? []).filter((item) => {
    const deadline = Date.parse(item.kickoffAt) - lead * 60_000;
    if (!item.predictionId || seen.has(item.predictionId) || !item.displayLabel?.trim() || !item.isFresh || !Number.isFinite(deadline) || deadline <= now) return false;
    if (item.analysisWindowStatus !== null && item.analysisWindowStatus !== "within_window") return false;
    if (item.confidenceScore !== null && (!Number.isFinite(item.confidenceScore) || item.confidenceScore < 0 || item.confidenceScore > 100)) return false;
    seen.add(item.predictionId);
    return true;
  });
}
