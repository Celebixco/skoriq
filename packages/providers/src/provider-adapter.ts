import type { ProviderEntityType } from "@sports-data/shared";
import type { ProviderFetchResult, ProviderResponseMetadata } from "./provider-result.js";

export const providerOperations = [
  "list_sports",
  "list_countries",
  "list_competitions",
  "list_seasons",
  "list_teams",
  "list_players",
  "list_upcoming_matches",
  "list_finished_matches",
  "get_match_details",
  "get_football_match_score",
  "get_basketball_match_score",
  "get_basketball_period_scores",
  "get_football_team_statistics",
  "get_basketball_team_statistics",
  "get_football_standings",
  "get_basketball_standings"
] as const;

export type ProviderOperation = (typeof providerOperations)[number];
export type ProviderSportDomain = "football" | "basketball";
export type ProviderFieldPriority = "P0" | "P1" | "P2";
export type ProviderOperationTiming = "pre_match" | "post_match" | "periodic" | "static";
export type ProviderHealthStatus = "available" | "unavailable" | "not_configured";

export interface ProviderCapabilities {
  supportsFootball: boolean;
  supportsBasketball: boolean;
  supportsFixtures: boolean;
  supportsFinishedMatches: boolean;
  supportsScores: boolean;
  supportsTeamStatistics: boolean;
  supportsStandings: boolean;
  supportsPlayers: boolean;
  supportsLineups: boolean;
  supportsEvents: boolean;
  supportsPlayerStatistics: boolean;
  supportsShotMaps: boolean;
  supportsBasketballBoxScores: boolean;
  supportsPreMatchData: boolean;
  supportsPostMatchData: boolean;
  supportsRateLimitMetadata: boolean;
}

export interface ProviderEndpointMetadata {
  operation: ProviderOperation;
  sport?: ProviderSportDomain;
  entityType: ProviderEntityType;
  priority: ProviderFieldPriority;
  timing: ProviderOperationTiming;
  normalizedTarget: string;
  rawOnly: boolean;
  notes?: string;
}

export interface ProviderRequestContext {
  provider: string;
  operation: ProviderOperation;
  sport?: ProviderSportDomain;
  entityType: ProviderEntityType;
  params: Record<string, unknown>;
  requestHashInput?: unknown;
  syncJobId?: string;
  correlationId?: string;
}

export interface ProviderHealthCheckResult {
  provider: string;
  status: ProviderHealthStatus;
  checkedAt: string;
  capabilities: ProviderCapabilities;
  message?: string;
  metadata?: Record<string, unknown>;
}

export interface ProviderAdapter {
  readonly name: string;
  readonly version?: string;
  readonly capabilities: ProviderCapabilities;

  healthCheck(): Promise<ProviderHealthCheckResult>;
  listSupportedSports(): ProviderSportDomain[];
  listSupportedEntities(): ProviderEntityType[];
  listEndpointMetadata(): ProviderEndpointMetadata[];
  fetch<TData = unknown>(context: ProviderRequestContext): Promise<ProviderFetchResult<TData>>;
}

export interface BuildProviderFetchResultInput<TData> {
  context: ProviderRequestContext;
  data: TData;
  rawPayload?: unknown;
  providerEntityId?: string;
  credentialLabel?: string;
  durationMs?: number;
  fetchedAt?: string;
  response?: ProviderResponseMetadata;
}

export const emptyProviderCapabilities: ProviderCapabilities = {
  supportsFootball: false,
  supportsBasketball: false,
  supportsFixtures: false,
  supportsFinishedMatches: false,
  supportsScores: false,
  supportsTeamStatistics: false,
  supportsStandings: false,
  supportsPlayers: false,
  supportsLineups: false,
  supportsEvents: false,
  supportsPlayerStatistics: false,
  supportsShotMaps: false,
  supportsBasketballBoxScores: false,
  supportsPreMatchData: false,
  supportsPostMatchData: false,
  supportsRateLimitMetadata: false
};

export const mvpProviderOperationMetadata: readonly ProviderEndpointMetadata[] = [
  { operation: "list_sports", entityType: "sport", priority: "P0", timing: "static", normalizedTarget: "sports", rawOnly: false },
  { operation: "list_countries", entityType: "country", priority: "P0", timing: "static", normalizedTarget: "countries", rawOnly: false },
  { operation: "list_competitions", entityType: "competition", priority: "P0", timing: "static", normalizedTarget: "competitions", rawOnly: false },
  { operation: "list_seasons", entityType: "season", priority: "P0", timing: "static", normalizedTarget: "seasons", rawOnly: false },
  { operation: "list_teams", entityType: "team", priority: "P0", timing: "periodic", normalizedTarget: "teams", rawOnly: false },
  { operation: "list_players", entityType: "player", priority: "P1", timing: "periodic", normalizedTarget: "players", rawOnly: false },
  { operation: "list_upcoming_matches", entityType: "match", priority: "P0", timing: "pre_match", normalizedTarget: "matches", rawOnly: false },
  { operation: "list_finished_matches", entityType: "match", priority: "P0", timing: "post_match", normalizedTarget: "matches", rawOnly: false },
  { operation: "get_match_details", entityType: "match", priority: "P0", timing: "pre_match", normalizedTarget: "matches", rawOnly: false },
  {
    operation: "get_football_match_score",
    sport: "football",
    entityType: "football_match_score",
    priority: "P0",
    timing: "post_match",
    normalizedTarget: "football_match_scores",
    rawOnly: false
  },
  {
    operation: "get_basketball_match_score",
    sport: "basketball",
    entityType: "basketball_match_score",
    priority: "P0",
    timing: "post_match",
    normalizedTarget: "basketball_match_scores",
    rawOnly: false
  },
  {
    operation: "get_basketball_period_scores",
    sport: "basketball",
    entityType: "basketball_period_score",
    priority: "P0",
    timing: "post_match",
    normalizedTarget: "basketball_period_scores",
    rawOnly: false
  },
  {
    operation: "get_football_team_statistics",
    sport: "football",
    entityType: "football_match_team_statistics",
    priority: "P0",
    timing: "post_match",
    normalizedTarget: "football_match_team_statistics",
    rawOnly: false
  },
  {
    operation: "get_basketball_team_statistics",
    sport: "basketball",
    entityType: "basketball_team_match_statistics",
    priority: "P0",
    timing: "post_match",
    normalizedTarget: "basketball_team_match_statistics",
    rawOnly: false
  },
  {
    operation: "get_football_standings",
    sport: "football",
    entityType: "football_standing",
    priority: "P0",
    timing: "periodic",
    normalizedTarget: "football_standings",
    rawOnly: false
  },
  {
    operation: "get_basketball_standings",
    sport: "basketball",
    entityType: "basketball_standing",
    priority: "P0",
    timing: "periodic",
    normalizedTarget: "basketball_standings",
    rawOnly: false
  }
];

export function getProviderOperationMetadata(operation: ProviderOperation): ProviderEndpointMetadata {
  const metadata = mvpProviderOperationMetadata.find((entry) => entry.operation === operation);
  if (!metadata) {
    throw new Error(`Unsupported provider operation "${operation}".`);
  }

  return metadata;
}

export function buildProviderFetchResult<TData>(input: BuildProviderFetchResultInput<TData>): ProviderFetchResult<TData> {
  const requestHashInput =
    input.context.requestHashInput ??
    {
      operation: input.context.operation,
      sport: input.context.sport,
      entityType: input.context.entityType,
      params: input.context.params
    };

  return {
    data: input.data,
    rawPayload: input.rawPayload ?? input.data,
    metadata: {
      provider: input.context.provider,
      endpoint: input.context.operation,
      requestParams: input.context.params,
      requestParamsHashInput: requestHashInput,
      providerEntityId: input.providerEntityId,
      credentialLabel: input.credentialLabel,
      response: input.response,
      durationMs: input.durationMs ?? 0,
      fetchedAt: input.fetchedAt ?? new Date().toISOString()
    }
  };
}
