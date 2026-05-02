import type { ProviderEntityType } from "@sports-data/shared";
import { buildProviderFetchResult, emptyProviderCapabilities } from "./provider-adapter.js";
import type {
  ProviderAdapter,
  ProviderCapabilities,
  ProviderEndpointMetadata,
  ProviderHealthCheckResult,
  ProviderOperation,
  ProviderRequestContext,
  ProviderSportDomain
} from "./provider-adapter.js";
import type { ProviderFetchResult } from "./provider-result.js";
import { APIFootballComHttpClient } from "./apifootball-com-http.js";
import type { APIFootballComHttpClientOptions } from "./apifootball-com-http.js";
import { createAPIFootballCredentialResolver } from "./apifootball-com-credentials.js";
import type { APIFootballCredentialResolver, APIFootballCredentialResolverInput, APIFootballCredentialAction } from "./apifootball-com-credentials.js";
import {
  mapCountryToProviderCountry,
  mapEventToProviderFootballMatchScore,
  mapEventToProviderMatch,
  mapLeagueToProviderCompetition,
  mapStandingToProviderFootballStanding,
  mapTeamToProviderTeamResult
} from "./apifootball-com-mappers.js";
import type { APIFootballComCountry, APIFootballComEvent, APIFootballComLeague, APIFootballComStanding, APIFootballComTeam } from "./apifootball-com-types.js";

export const APIFOOTBALL_COM_ADAPTER_NAME = "apifootball-com";

export interface APIFootballComAdapterEnvironment {
  nodeEnv: "development" | "test" | "production";
}

export interface APIFootballComAdapterOptions {
  enabled: boolean;
  apiKey?: string;
  apiKeys?: APIFootballCredentialResolverInput;
  credentialResolver?: APIFootballCredentialResolver;
  baseUrl: string;
  timeoutMs: number;
  environment: APIFootballComAdapterEnvironment;
  fetchImpl?: typeof fetch;
}

const capabilities: ProviderCapabilities = {
  ...emptyProviderCapabilities,
  supportsFootball: true,
  supportsBasketball: false,
  supportsFixtures: true,
  supportsFinishedMatches: true,
  supportsScores: true,
  supportsTeamStatistics: false,
  supportsStandings: true,
  supportsPreMatchData: true,
  supportsPostMatchData: true,
  supportsRateLimitMetadata: false
};

const endpointMetadata: readonly ProviderEndpointMetadata[] = [
  { operation: "list_countries", entityType: "country", priority: "P0", timing: "static", normalizedTarget: "countries", rawOnly: false, notes: "APIFootball.com action get_countries." },
  {
    operation: "list_competitions",
    sport: "football",
    entityType: "competition",
    priority: "P0",
    timing: "static",
    normalizedTarget: "competitions",
    rawOnly: false,
    notes: "APIFootball.com action get_leagues."
  },
  {
    operation: "list_teams",
    sport: "football",
    entityType: "team",
    priority: "P0",
    timing: "periodic",
    normalizedTarget: "teams",
    rawOnly: false,
    notes: "APIFootball.com action get_teams; logo fields map to ProviderTeam.logoUrl when present."
  },
  {
    operation: "list_upcoming_matches",
    sport: "football",
    entityType: "match",
    priority: "P0",
    timing: "pre_match",
    normalizedTarget: "matches",
    rawOnly: false,
    notes: "APIFootball.com action get_events; no live polling."
  },
  {
    operation: "list_finished_matches",
    sport: "football",
    entityType: "match",
    priority: "P0",
    timing: "post_match",
    normalizedTarget: "matches",
    rawOnly: false,
    notes: "APIFootball.com action get_events for finished date ranges."
  },
  {
    operation: "get_match_details",
    sport: "football",
    entityType: "match",
    priority: "P0",
    timing: "post_match",
    normalizedTarget: "matches",
    rawOnly: false,
    notes: "APIFootball.com action get_events filtered by match_id."
  },
  {
    operation: "get_football_match_score",
    sport: "football",
    entityType: "football_match_score",
    priority: "P0",
    timing: "post_match",
    normalizedTarget: "football_match_scores",
    rawOnly: false,
    notes: "APIFootball.com score fields from action get_events."
  },
  {
    operation: "get_football_standings",
    sport: "football",
    entityType: "football_standing",
    priority: "P0",
    timing: "periodic",
    normalizedTarget: "football_standings",
    rawOnly: false,
    notes: "APIFootball.com action get_standings; rows without stable team IDs are unresolved."
  }
];

export class APIFootballComAdapter implements ProviderAdapter {
  readonly name = APIFOOTBALL_COM_ADAPTER_NAME;
  readonly version = "0.1.0-poc";
  readonly capabilities = capabilities;
  private readonly client?: APIFootballComHttpClient;
  private readonly credentialResolver: APIFootballCredentialResolver;

  constructor(private readonly options: APIFootballComAdapterOptions) {
    this.credentialResolver =
      options.credentialResolver ??
      createAPIFootballCredentialResolver({
        legacyApiKey: options.apiKey,
        ...options.apiKeys
      });

    if (options.environment.nodeEnv === "production" && options.enabled) {
      throw new Error("APIFootball.com adapter is blocked in production until explicit production provider approval exists.");
    }

    if (options.enabled && !this.credentialResolver.hasAnyCredential()) {
      throw new Error("APIFootball.com adapter requires at least one APIFOOTBALL_COM_API_KEY* value when enabled.");
    }

    if (options.enabled) {
      this.client = new APIFootballComHttpClient({
        baseUrl: options.baseUrl,
        credentialResolver: this.credentialResolver,
        timeoutMs: options.timeoutMs,
        fetchImpl: options.fetchImpl
      });
    }
  }

  async healthCheck(): Promise<ProviderHealthCheckResult> {
    if (!this.options.enabled) {
      return {
        provider: this.name,
        status: "not_configured",
        checkedAt: new Date().toISOString(),
        capabilities: this.capabilities,
        message: "APIFootball.com adapter is disabled. No external provider call was made."
      };
    }

    if (!this.credentialResolver.hasAnyCredential()) {
      return {
        provider: this.name,
        status: "unavailable",
        checkedAt: new Date().toISOString(),
        capabilities: this.capabilities,
        message: "APIFootball.com adapter is enabled but API key is missing."
      };
    }

    return {
      provider: this.name,
      status: "available",
      checkedAt: new Date().toISOString(),
      capabilities: this.capabilities,
      message: "APIFootball.com adapter is configured. Health check does not call external provider URLs."
    };
  }

  listSupportedSports(): ProviderSportDomain[] {
    return ["football"];
  }

  listSupportedEntities(): ProviderEntityType[] {
    return [...new Set(endpointMetadata.map((metadata) => metadata.entityType))];
  }

  listEndpointMetadata(): ProviderEndpointMetadata[] {
    return [...endpointMetadata];
  }

  async fetch<TData = unknown>(context: ProviderRequestContext): Promise<ProviderFetchResult<TData>> {
    if (context.provider !== this.name) {
      throw new Error(`Provider request context provider "${context.provider}" does not match adapter "${this.name}".`);
    }

    const metadata = endpointMetadata.find((entry) => entry.operation === context.operation);
    if (!metadata) {
      throw new Error(`APIFootball.com adapter does not support provider operation "${context.operation}".`);
    }

    if (context.entityType !== metadata.entityType) {
      throw new Error(`Provider operation "${context.operation}" must target entity type "${metadata.entityType}".`);
    }

    const data = await this.fetchOperation(context.operation, context.params);
    return data as ProviderFetchResult<TData>;
  }

  async getCountries(params: Record<string, unknown> = {}) {
    return this.requestAndMap("list_countries", "country", "get_countries", params, (payload: APIFootballComCountry[]) => payload.map(mapCountryToProviderCountry));
  }

  async getLeagues(params: Record<string, unknown> = {}) {
    return this.requestAndMap("list_competitions", "competition", "get_leagues", params, (payload: APIFootballComLeague[]) => payload.map(mapLeagueToProviderCompetition));
  }

  async getTeams(params: Record<string, unknown> = {}) {
    return this.requestAndMap("list_teams", "team", "get_teams", params, (payload: APIFootballComTeam[]) =>
      payload.map(mapTeamToProviderTeamResult).filter((result) => result.status === "mapped").map((result) => result.data)
    );
  }

  async getEventsAsMatches(operation: "list_upcoming_matches" | "list_finished_matches" | "get_match_details", params: Record<string, unknown> = {}) {
    return this.requestAndMap(operation, "match", "get_events", params, (payload: APIFootballComEvent[]) =>
      payload.map(mapEventToProviderMatch).filter((result) => result.status === "mapped").map((result) => result.data)
    );
  }

  async getEventsAsScores(params: Record<string, unknown> = {}) {
    return this.requestAndMap("get_football_match_score", "football_match_score", "get_events", params, (payload: APIFootballComEvent[]) =>
      payload.map(mapEventToProviderFootballMatchScore).filter((result) => result.status === "mapped").map((result) => result.data)
    );
  }

  async getStandings(params: Record<string, unknown> = {}) {
    return this.requestAndMap("get_football_standings", "football_standing", "get_standings", params, (payload: APIFootballComStanding[]) =>
      payload.map(mapStandingToProviderFootballStanding).filter((result) => result.status === "mapped").map((result) => result.data)
    );
  }

  private async fetchOperation(operation: ProviderOperation, params: Record<string, unknown>) {
    switch (operation) {
      case "list_countries":
        return this.getCountries(params);
      case "list_competitions":
        return this.getLeagues(params);
      case "list_teams":
        return this.getTeams(params);
      case "list_upcoming_matches":
      case "list_finished_matches":
      case "get_match_details":
        return this.getEventsAsMatches(operation, params);
      case "get_football_match_score":
        return this.getEventsAsScores(params);
      case "get_football_standings":
        return this.getStandings(params);
      default:
        throw new Error(`APIFootball.com adapter does not support provider operation "${operation}".`);
    }
  }

  private async requestAndMap<TPayload, TData>(
    operation: ProviderOperation,
    entityType: ProviderEntityType,
    action: "get_countries" | "get_leagues" | "get_events" | "get_standings" | "get_teams",
    params: Record<string, unknown>,
    mapper: (payload: TPayload) => TData
  ) {
    if (!this.client) {
      throw new Error("APIFootball.com adapter is disabled.");
    }

    const providerParams = toProviderParams(params);
    const result = await this.client.requestJson<TPayload>({ action, credentialAction: credentialActionForOperation(operation), params: providerParams });

    return buildProviderFetchResult({
      context: {
        provider: this.name,
        operation,
        sport: "football",
        entityType,
        params: providerParams
      },
      data: mapper(result.payload),
      rawPayload: result.payload,
      credentialLabel: result.metadata.credentialLabel,
      durationMs: result.metadata.durationMs,
      fetchedAt: result.metadata.fetchedAt,
      response: {
        statusCode: result.metadata.status
      }
    });
  }
}

function toProviderParams(params: Record<string, unknown>): Record<string, string | number | boolean | undefined> {
  return {
    country_id: normalizeParam(params.country_id ?? params.countryId),
    league_id: normalizeParam(params.league_id ?? params.leagueId),
    match_id: normalizeParam(params.match_id ?? params.matchId),
    team_id: normalizeParam(params.team_id ?? params.teamId),
    from: normalizeParam(params.from),
    to: normalizeParam(params.to),
    timezone: normalizeParam(params.timezone)
  };
}

function normalizeParam(value: unknown): string | number | boolean | undefined {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  return undefined;
}

export function buildAPIFootballComHttpClientOptions(options: APIFootballComAdapterOptions): APIFootballComHttpClientOptions | undefined {
  const credentialResolver =
    options.credentialResolver ??
    createAPIFootballCredentialResolver({
      legacyApiKey: options.apiKey,
      ...options.apiKeys
    });

  if (!options.enabled || !credentialResolver.hasAnyCredential()) {
    return undefined;
  }

  return {
    baseUrl: options.baseUrl,
    credentialResolver,
    timeoutMs: options.timeoutMs,
    fetchImpl: options.fetchImpl
  };
}

function credentialActionForOperation(operation: ProviderOperation): APIFootballCredentialAction {
  switch (operation) {
    case "list_countries":
      return "countries";
    case "list_competitions":
      return "leagues";
    case "list_teams":
      return "teams";
    case "get_football_standings":
      return "standings";
    case "list_upcoming_matches":
      return "fixtures";
    case "get_football_match_score":
      return "results";
    case "list_finished_matches":
    case "get_match_details":
      return "events";
    default:
      return "default";
  }
}
