import type { FeatureStatus } from "./types";

export function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

export function formatDate(value: string): string {
  return new Intl.DateTimeFormat("tr-TR", {
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(new Date(value));
}

export function formatPercent(value: number | null): string {
  return value === null ? "Veri yok" : `${value.toFixed(0)}%`;
}

export function formatRatePercent(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${value.toFixed(0)}%`;
}

export function formatDecimal(value: number | null | undefined, digits = 2): string {
  return value === null || value === undefined ? "—" : value.toFixed(digits);
}

export function formatEligibility(value: boolean): string {
  return value ? "Uygun" : "Uygun değil";
}

export function statusLabel(status: FeatureStatus): string {
  if (status === "ready") return "Hazır";
  if (status === "partial") return "Kısmi";
  return "Yetersiz";
}
