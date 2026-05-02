export const apifootballCredentialLabels = [
  "countries",
  "leagues",
  "teams",
  "standings",
  "events",
  "results",
  "fixtures",
  "players",
  "statistics",
  "lineups",
  "injuries",
  "default",
  "legacy"
] as const;

export type APIFootballCredentialLabel = (typeof apifootballCredentialLabels)[number];

export type APIFootballCredentialAction =
  | "get_countries"
  | "get_leagues"
  | "get_teams"
  | "get_standings"
  | "get_events"
  | "get_H2H"
  | "get_results"
  | "get_fixtures"
  | "get_players"
  | "get_statistics"
  | "get_lineups"
  | "get_injuries"
  | APIFootballCredentialLabel;

export interface APIFootballCredentialResolverInput {
  legacyApiKey?: string;
  defaultApiKey?: string;
  countriesApiKey?: string;
  leaguesApiKey?: string;
  teamsApiKey?: string;
  standingsApiKey?: string;
  eventsApiKey?: string;
  resultsApiKey?: string;
  fixturesApiKey?: string;
  playersApiKey?: string;
  statisticsApiKey?: string;
  lineupsApiKey?: string;
  injuriesApiKey?: string;
}

export interface APIFootballResolvedCredential {
  apiKey: string;
  credentialLabel: APIFootballCredentialLabel;
}

export class APIFootballCredentialResolver {
  constructor(private readonly input: APIFootballCredentialResolverInput) {}

  resolveForAction(action: APIFootballCredentialAction): APIFootballResolvedCredential {
    const label = normalizeCredentialLabel(action);
    const specific = this.keyForLabel(label);
    if (specific) {
      return { apiKey: specific, credentialLabel: label };
    }
    if (this.input.defaultApiKey) {
      return { apiKey: this.input.defaultApiKey, credentialLabel: "default" };
    }
    if (this.input.legacyApiKey) {
      return { apiKey: this.input.legacyApiKey, credentialLabel: "legacy" };
    }

    throw new Error(`No APIFootball.com API key configured for credential label "${label}".`);
  }

  getSafeCredentialLabel(action: APIFootballCredentialAction): APIFootballCredentialLabel {
    return this.resolveForAction(action).credentialLabel;
  }

  hasCredentialForAction(action: APIFootballCredentialAction): boolean {
    try {
      this.resolveForAction(action);
      return true;
    } catch {
      return false;
    }
  }

  hasAnyCredential(): boolean {
    return apifootballCredentialLabels.some((label) => Boolean(this.keyForLabel(label)));
  }

  private keyForLabel(label: APIFootballCredentialLabel): string | undefined {
    switch (label) {
      case "countries":
        return this.input.countriesApiKey;
      case "leagues":
        return this.input.leaguesApiKey;
      case "teams":
        return this.input.teamsApiKey;
      case "standings":
        return this.input.standingsApiKey;
      case "events":
        return this.input.eventsApiKey;
      case "results":
        return this.input.resultsApiKey;
      case "fixtures":
        return this.input.fixturesApiKey;
      case "players":
        return this.input.playersApiKey;
      case "statistics":
        return this.input.statisticsApiKey;
      case "lineups":
        return this.input.lineupsApiKey;
      case "injuries":
        return this.input.injuriesApiKey;
      case "default":
        return this.input.defaultApiKey;
      case "legacy":
        return this.input.legacyApiKey;
    }
  }
}

export function createAPIFootballCredentialResolver(input: APIFootballCredentialResolverInput) {
  return new APIFootballCredentialResolver(input);
}

export function normalizeCredentialLabel(action: APIFootballCredentialAction): APIFootballCredentialLabel {
  switch (action) {
    case "get_countries":
    case "countries":
      return "countries";
    case "get_leagues":
    case "leagues":
      return "leagues";
    case "get_teams":
    case "teams":
      return "teams";
    case "get_standings":
    case "standings":
      return "standings";
    case "get_results":
    case "results":
      return "results";
    case "get_fixtures":
    case "fixtures":
      return "fixtures";
    case "get_players":
    case "players":
      return "players";
    case "get_statistics":
    case "statistics":
      return "statistics";
    case "get_lineups":
    case "lineups":
      return "lineups";
    case "get_injuries":
    case "injuries":
      return "injuries";
    case "get_events":
    case "get_H2H":
    case "events":
      return "events";
    case "legacy":
      return "legacy";
    case "default":
    default:
      return "default";
  }
}
