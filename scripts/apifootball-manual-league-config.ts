export const providerName = "apifootball-com";

export interface ManualLeagueReviewConfig {
  provider: typeof providerName;
  sport: "football";
  countryId: string;
  leagueId: string;
  countryName: string;
  leagueName: string;
  enabled: boolean;
  reviewed: boolean;
  dryRunAllowed: boolean;
  priority: "high" | "medium" | "low";
  notes: string;
}

export const manualLeagueConfigs = [
  {
    provider: providerName,
    sport: "football",
    countryId: "4",
    leagueId: "171",
    countryName: "Germany",
    leagueName: "2. Bundesliga",
    enabled: true,
    reviewed: true,
    dryRunAllowed: true,
    priority: "high",
    notes: "Reviewed APIFootball ingestion slice."
  },
  {
    provider: providerName,
    sport: "football",
    countryId: "4",
    leagueId: "175",
    countryName: "Germany",
    leagueName: "Bundesliga",
    enabled: true,
    reviewed: true,
    dryRunAllowed: true,
    priority: "high",
    notes: "Reviewed APIFootball ingestion slice."
  },
  {
    provider: providerName,
    sport: "football",
    countryId: "111",
    leagueId: "322",
    countryName: "Turkey",
    leagueName: "Süper Lig",
    enabled: true,
    reviewed: true,
    dryRunAllowed: true,
    priority: "high",
    notes: "Reviewed via teams/standings/events dry-run; 2 team names enriched from standings, 2 logos missing/non-fatal; execute allowed after this config change."
  },
  {
    provider: providerName,
    sport: "football",
    countryId: "44",
    leagueId: "152",
    countryName: "England",
    leagueName: "Premier League",
    enabled: true,
    reviewed: true,
    dryRunAllowed: true,
    priority: "high",
    notes: "Reviewed via teams/standings/events/scores dry-runs; teams/logos 20/20, standings 20/20, events/scores 10/10, unresolved 0; countries/leagues execute required before data execute."
  },
  {
    provider: providerName,
    sport: "football",
    countryId: "6",
    leagueId: "302",
    countryName: "Spain",
    leagueName: "La Liga",
    enabled: true,
    reviewed: true,
    dryRunAllowed: true,
    priority: "high",
    notes: "Reviewed via teams/standings/events/scores dry-runs; teams/logos 20/20, standings 20/20, upcoming events 10/10, recent finished events/scores 10/10, FT/HT scores 10/10, unresolved 0; countries/leagues execute required before data execute."
  },
  {
    provider: providerName,
    sport: "football",
    countryId: "5",
    leagueId: "207",
    countryName: "Italy",
    leagueName: "Serie A",
    enabled: true,
    reviewed: true,
    dryRunAllowed: true,
    priority: "high",
    notes:
      "Reviewed via teams/standings/events/scores dry-runs; teams/logos 20/20 with 19/20 logos and 1 standings-name enrichment, standings 20/20, recent finished events/scores 10/10 with FT/HT 10/10, upcoming events/scores 9/10 with one safely skipped live numeric status; countries/leagues execute required before data execute."
  },
  {
    provider: providerName,
    sport: "football",
    countryId: "3",
    leagueId: "168",
    countryName: "France",
    leagueName: "Ligue 1",
    enabled: true,
    reviewed: true,
    dryRunAllowed: true,
    priority: "high",
    notes:
      "Reviewed via teams/standings/events/scores dry-runs; teams/logos 18/18, standings 18/18, upcoming events 9/9, recent finished events/scores 9/9, FT/HT scores 9/9, unresolved 0; countries/leagues execute required before data execute."
  },
  {
    provider: providerName,
    sport: "football",
    countryId: "82",
    leagueId: "244",
    countryName: "Netherlands",
    leagueName: "Eredivisie",
    enabled: true,
    reviewed: true,
    dryRunAllowed: true,
    priority: "high",
    notes:
      "Reviewed via teams/standings/recent finished events evidence; teams 22/22, logos 21/22 with 1 missing non-fatal, 1 standings-name enrichment, standings 18/18, recent finished events/scores 8/8 with FT/HT 8/8, upcoming events/scores 10/11 with one safely skipped After Pen. non-standard status; After Pen. remains skipped unless explicit policy is added; countries/leagues execute required before data execute."
  }
] as const satisfies readonly ManualLeagueReviewConfig[];

export function resolveManualLeagueConfig(
  countryId?: string,
  leagueId?: string,
  configs: readonly ManualLeagueReviewConfig[] = manualLeagueConfigs
): ManualLeagueReviewConfig | undefined {
  if (leagueId) {
    return configs.find((league) => league.countryId === countryId && league.leagueId === leagueId);
  }

  return configs.find((league) => league.countryId === countryId);
}
