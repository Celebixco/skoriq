export type ProviderErrorCategory = "timeout" | "rate_limit" | "unavailable" | "schema_changed" | "invalid_response" | "auth_error" | "unknown";

export interface ProviderRateLimitMetadata {
  limit?: number;
  remaining?: number;
  resetAt?: string;
  retryAfterMs?: number;
}

export interface ProviderResponseMetadata {
  statusCode?: number;
  headers?: Record<string, string>;
  rateLimit?: ProviderRateLimitMetadata;
}

export interface ProviderFetchMetadata {
  provider: string;
  endpoint: string;
  requestParams: Record<string, unknown>;
  requestParamsHashInput: unknown;
  providerEntityId?: string;
  credentialLabel?: string;
  response?: ProviderResponseMetadata;
  durationMs: number;
  fetchedAt: string;
}

export interface ProviderFetchResult<TData> {
  data: TData;
  metadata: ProviderFetchMetadata;
  rawPayload?: unknown;
}

export class ProviderError extends Error {
  constructor(
    readonly category: ProviderErrorCategory,
    message: string,
    readonly metadata?: Partial<ProviderFetchMetadata>,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
