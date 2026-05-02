import type { ProviderEntityType } from "@sports-data/shared";
import {
  buildProviderFetchResult,
  emptyProviderCapabilities,
  getProviderOperationMetadata,
  mvpProviderOperationMetadata
} from "./provider-adapter.js";
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

export interface LocalNoopProviderEnvironment {
  nodeEnv: "development" | "test" | "production";
}

export interface LocalNoopProviderAdapterOptions {
  name?: string;
  version?: string;
  environment: LocalNoopProviderEnvironment;
  responses?: Partial<Record<ProviderOperation, unknown>>;
}

const noopCapabilities: ProviderCapabilities = {
  ...emptyProviderCapabilities,
  supportsFootball: true,
  supportsBasketball: true,
  supportsFixtures: true,
  supportsFinishedMatches: true,
  supportsScores: true,
  supportsTeamStatistics: true,
  supportsStandings: true,
  supportsPlayers: true,
  supportsPreMatchData: true,
  supportsPostMatchData: true
};

export class LocalNoopProviderAdapter implements ProviderAdapter {
  readonly name: string;
  readonly version?: string;
  readonly capabilities = noopCapabilities;
  private readonly responses: Partial<Record<ProviderOperation, unknown>>;

  constructor(options: LocalNoopProviderAdapterOptions) {
    if (options.environment.nodeEnv === "production") {
      throw new Error("Local no-op provider adapter is forbidden in production.");
    }

    this.name = options.name ?? "local-noop";
    this.version = options.version;
    this.responses = options.responses ?? {};
  }

  async healthCheck(): Promise<ProviderHealthCheckResult> {
    return {
      provider: this.name,
      status: "not_configured",
      checkedAt: new Date().toISOString(),
      capabilities: this.capabilities,
      message: "Local no-op provider adapter does not call external provider URLs."
    };
  }

  listSupportedSports(): ProviderSportDomain[] {
    return ["football", "basketball"];
  }

  listSupportedEntities(): ProviderEntityType[] {
    return [...new Set(mvpProviderOperationMetadata.map((metadata) => metadata.entityType))];
  }

  listEndpointMetadata(): ProviderEndpointMetadata[] {
    return [...mvpProviderOperationMetadata];
  }

  async fetch<TData = unknown>(context: ProviderRequestContext): Promise<ProviderFetchResult<TData>> {
    if (context.provider !== this.name) {
      throw new Error(`Provider request context provider "${context.provider}" does not match adapter "${this.name}".`);
    }

    const metadata = getProviderOperationMetadata(context.operation);
    if (metadata.entityType !== context.entityType) {
      throw new Error(`Provider operation "${context.operation}" must target entity type "${metadata.entityType}".`);
    }

    const data = (this.responses[context.operation] ?? []) as TData;
    return buildProviderFetchResult({
      context,
      data,
      rawPayload: data
    });
  }
}

