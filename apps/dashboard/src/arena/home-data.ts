import type { DashboardOverviewResponse, DashboardPredictionPreviewItem, DashboardUpcomingMatch } from "../types";

export type LoadState<T> = { data: T | null; loading: boolean; error: string | null };
export type ArenaMatch = DashboardUpcomingMatch & { demo?: boolean };
export type ArenaPrediction = DashboardPredictionPreviewItem;

const sampleMatch = (id: string, home: string, away: string, competition: string, ready = true): ArenaMatch => ({
  matchId: id,
  competition: { id: `sample-${competition}`, name: competition, country: null },
  kickoffAt: "",
  status: "sample",
  homeTeam: { id: `${id}-home`, name: home },
  awayTeam: { id: `${id}-away`, name: away },
  featureStatus: ready ? "ready" : null,
  predictionEligible: ready,
  combinedCoverageScore: ready ? 84 : null,
  analysisWindowStatus: null,
  hasPredictionPreview: ready,
  demo: true
});

export const sampleFeaturedMatch = sampleMatch("sample-derby", "Galatasaray", "Fenerbahçe", "Süper Lig");
export const sampleMatches = [
  sampleMatch("sample-besiktas", "Beşiktaş", "Trabzonspor", "Süper Lig"),
  sampleMatch("sample-arsenal", "Arsenal", "Chelsea", "Premier League"),
  sampleMatch("sample-milan", "Milan", "Napoli", "Serie A", false)
];
export const samplePrediction: ArenaPrediction = {
  matchId: sampleFeaturedMatch.matchId,
  matchLabel: "Galatasaray - Fenerbahçe",
  displayLabel: "MS 2,5 Üst",
  recommendationTier: "primary",
  confidenceScore: 82,
  riskLevel: "medium"
};

export function availablePredictions(data: DashboardOverviewResponse | null): Map<string, ArenaPrediction> {
  if (data?.predictionPreview.status !== "available" || data.dataStatus.predictionPreview !== "ok") return new Map();
  const fixtures = new Set(data.upcomingMatches.filter((match) => match.hasPredictionPreview && match.predictionEligible && match.analysisWindowStatus === "within_window").map((match) => match.matchId));
  const items = [...data.predictionPreview.items].sort((a, b) => Number(b.recommendationTier === "primary") - Number(a.recommendationTier === "primary"));
  const previews = new Map<string, ArenaPrediction>();
  for (const item of items) if (fixtures.has(item.matchId) && !previews.has(item.matchId)) previews.set(item.matchId, item);
  return previews;
}

export function confidenceValue(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

export function riskText(value: string): string {
  return ({ low: "Düşük", medium: "Orta", high: "Yüksek" } as Record<string, string>)[value] ?? "Belirtilmedi";
}

export function kickoffText(match: ArenaMatch): string {
  if (match.demo) return "Örnek karşılaşma";
  const date = new Date(match.kickoffAt);
  if (Number.isNaN(date.getTime())) return "Saat açıklanmadı";
  return new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" }).format(date);
}
