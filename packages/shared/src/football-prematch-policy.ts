export const DEFAULT_FOOTBALL_PREMATCH_WINDOW_HOURS = 36;
export const DEFAULT_FOOTBALL_PREMATCH_MINIMUM_LEAD_MINUTES = 30;

export interface FootballPrematchWindowPolicy {
  windowHours: number;
  minimumLeadMinutes: number;
}

export function resolveFootballPrematchWindowPolicy(env: Record<string, string | undefined> = process.env): FootballPrematchWindowPolicy {
  return {
    windowHours: positiveInteger(env.FOOTBALL_PREMATCH_WINDOW_HOURS, DEFAULT_FOOTBALL_PREMATCH_WINDOW_HOURS),
    minimumLeadMinutes: positiveInteger(env.FOOTBALL_PREMATCH_MINIMUM_LEAD_MINUTES, DEFAULT_FOOTBALL_PREMATCH_MINIMUM_LEAD_MINUTES)
  };
}

function positiveInteger(value: string | undefined, fallback: number) {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
