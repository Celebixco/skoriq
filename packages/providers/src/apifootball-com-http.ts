import type { APIFootballComAction } from "./apifootball-com-types.js";
import type { APIFootballCredentialAction, APIFootballCredentialLabel, APIFootballCredentialResolver } from "./apifootball-com-credentials.js";

export const APIFOOTBALL_COM_API_KEY_QUERY_PARAM = "APIkey";

export interface APIFootballComHttpClientOptions {
  baseUrl: string;
  apiKey?: string;
  credentialResolver?: APIFootballCredentialResolver;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

export interface APIFootballComRequestInput {
  action: APIFootballComAction;
  credentialAction?: APIFootballCredentialAction;
  params?: Record<string, string | number | boolean | undefined>;
}

export interface APIFootballComHttpResult<TPayload = unknown> {
  payload: TPayload;
  metadata: {
    provider: "apifootball-com";
    operation: APIFootballComAction;
    durationMs: number;
    fetchedAt: string;
    params: Record<string, string>;
    status?: number;
    credentialLabel: APIFootballCredentialLabel;
  };
}

export type APIFootballComProviderErrorKind = "authentication" | "rate_limit_or_plan" | "provider_error" | "http_error";

export interface APIFootballComSanitizedProviderError {
  kind: APIFootballComProviderErrorKind;
  action: APIFootballComAction;
  message: string;
  safeRequestUrl: string;
  credentialLabel: APIFootballCredentialLabel;
  status?: number;
  responseBody?: unknown;
}

export class APIFootballComHttpError extends Error {
  constructor(readonly details: APIFootballComSanitizedProviderError) {
    super(formatProviderErrorMessage(details));
    this.name = "APIFootballComHttpError";
  }
}

export class APIFootballComHttpClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: APIFootballComHttpClientOptions) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  buildRequestUrl(input: APIFootballComRequestInput): URL {
    const url = new URL(this.options.baseUrl);
    const credential = this.resolveCredential(input);
    url.searchParams.set("action", input.action);
    url.searchParams.set(APIFOOTBALL_COM_API_KEY_QUERY_PARAM, credential.apiKey);

    for (const [key, value] of Object.entries(input.params ?? {})) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }

    return url;
  }

  buildSafeRequestUrl(input: APIFootballComRequestInput): string {
    const url = this.buildRequestUrl(input);
    url.searchParams.set(APIFOOTBALL_COM_API_KEY_QUERY_PARAM, "<redacted>");
    return url.toString().replace("APIkey=%3Credacted%3E", "APIkey=<redacted>");
  }

  async requestJson<TPayload = unknown>(input: APIFootballComRequestInput): Promise<APIFootballComHttpResult<TPayload>> {
    const startedAt = Date.now();
    const fetchedAt = new Date().toISOString();
    const credential = this.resolveCredential(input);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);

    try {
      const response = await this.fetchImpl(this.buildRequestUrl(input), {
        method: "GET",
        signal: controller.signal
      });
      const payload = (await parseResponseBody(response)) as TPayload;
      const sanitizedPayload = sanitizeProviderPayload(payload, credential.apiKey);

      if (!response.ok) {
        throw new APIFootballComHttpError({
          kind: classifyProviderError(sanitizedPayload, response.status),
          action: input.action,
          message: providerErrorMessage(sanitizedPayload) ?? `HTTP ${response.status}`,
          safeRequestUrl: this.buildSafeRequestUrl(input),
          credentialLabel: credential.credentialLabel,
          status: response.status,
          responseBody: sanitizedPayload
        });
      }

      const providerError = providerErrorMessage(sanitizedPayload);
      if (providerError) {
        throw new APIFootballComHttpError({
          kind: classifyProviderError(sanitizedPayload, response.status),
          action: input.action,
          message: providerError,
          safeRequestUrl: this.buildSafeRequestUrl(input),
          credentialLabel: credential.credentialLabel,
          status: response.status,
          responseBody: sanitizedPayload
        });
      }

      return {
        payload,
        metadata: {
          provider: "apifootball-com",
          operation: input.action,
          durationMs: Date.now() - startedAt,
          fetchedAt,
          params: sanitizeParams(input.params),
          credentialLabel: credential.credentialLabel,
          status: response.status
        }
      };
    } catch (error) {
      if (error instanceof APIFootballComHttpError) {
        throw error;
      }

      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`APIFootball.com request timed out for action "${input.action}".`);
      }

      if (error instanceof Error) {
        throw new Error(redactSecrets(error.message, credential.apiKey));
      }

      throw new Error(`APIFootball.com request failed for action "${input.action}".`);
    } finally {
      clearTimeout(timeout);
    }
  }

  private resolveCredential(input: APIFootballComRequestInput) {
    if (this.options.credentialResolver) {
      return this.options.credentialResolver.resolveForAction(input.credentialAction ?? input.action);
    }
    if (this.options.apiKey) {
      return { apiKey: this.options.apiKey, credentialLabel: "legacy" as const };
    }
    throw new Error("No APIFootball.com API key configured for HTTP request.");
  }
}

export function sanitizeParams(params: Record<string, string | number | boolean | undefined> | undefined): Record<string, string> {
  return Object.fromEntries(Object.entries(params ?? {}).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]));
}

export function redactApiKey(message: string, apiKey: string): string {
  return redactSecrets(message, apiKey);
}

export function redactSecrets(message: string, apiKey: string): string {
  const withoutDirectKey = apiKey ? message.split(apiKey).join("<redacted>") : message;
  return withoutDirectKey.replace(/([?&]APIkey=)[^&\s]+/gi, "$1<redacted>");
}

export function sanitizeProviderPayload(payload: unknown, apiKey: string): unknown {
  if (typeof payload === "string") {
    return redactSecrets(payload, apiKey);
  }

  if (Array.isArray(payload)) {
    return payload.map((item) => sanitizeProviderPayload(item, apiKey));
  }

  if (payload && typeof payload === "object") {
    return Object.fromEntries(
      Object.entries(payload).map(([key, value]) => [
        key,
        shouldRedactProviderField(key) ? "<redacted>" : sanitizeProviderPayload(value, apiKey)
      ])
    );
  }

  return payload;
}

function shouldRedactProviderField(key: string): boolean {
  return /api[-_]?key|apikey|token|secret|password|authorization|auth/i.test(key);
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function providerErrorMessage(payload: unknown): string | undefined {
  const message = extractTopLevelProviderErrorMessage(payload);
  if (!message) {
    return undefined;
  }

  return message;
}

function extractTopLevelProviderErrorMessage(payload: unknown): string | undefined {
  if (typeof payload === "string") {
    return looksLikeProviderError(payload) ? payload : undefined;
  }

  if (Array.isArray(payload)) {
    // APIFootball data endpoints normally return arrays of rows. A malformed
    // row should be handled by the mapper, not by treating arbitrary row fields
    // such as badge URLs or team names as provider-level errors.
    return undefined;
  }

  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const directMessage = topLevelErrorString(record, true);
    if (directMessage) {
      return directMessage;
    }

    if (isExplicitFailureStatus(record)) {
      return topLevelErrorString(record, false);
    }
  }

  return undefined;
}

function topLevelErrorString(record: Record<string, unknown>, requireErrorLikeText: boolean): string | undefined {
  for (const key of ["error", "message", "msg", "warning"]) {
    const value = record[key];
    if (typeof value === "string" && (!requireErrorLikeText || looksLikeProviderError(value))) {
      return value;
    }
    if (key === "error" && value && typeof value === "object" && !Array.isArray(value)) {
      const nested = value as Record<string, unknown>;
      for (const nestedKey of ["message", "msg", "warning"]) {
        const nestedValue = nested[nestedKey];
        if (typeof nestedValue === "string" && (!requireErrorLikeText || looksLikeProviderError(nestedValue))) {
          return nestedValue;
        }
      }
    }
  }

  return undefined;
}

function isExplicitFailureStatus(record: Record<string, unknown>): boolean {
  const success = record.success;
  if (success === false || success === 0 || success === "0") {
    return true;
  }
  if (typeof success === "string" && success.toLowerCase() === "false") {
    return true;
  }

  const status = record.status;
  if (status === false || status === 0 || status === "0") {
    return true;
  }
  if (typeof status === "string" && /^(false|fail|failed|error)$/i.test(status)) {
    return true;
  }

  return false;
}

function looksLikeProviderError(value: string): boolean {
  return /api\s*key|apikey|auth|unauthori[sz]ed|forbidden|invalid|inactive|subscription|plan|quota|limit|exhausted|access denied|not found/i.test(value);
}

function classifyProviderError(payload: unknown, status?: number): APIFootballComProviderErrorKind {
  const text = (providerErrorMessage(payload) ?? "").toLowerCase();

  if (status === 401 || status === 403 || /api\s*key|apikey|auth|unauthori[sz]ed|forbidden|invalid|inactive|access denied/.test(text)) {
    return "authentication";
  }

  if (status === 429 || /subscription|plan|quota|limit|exhausted|free/.test(text)) {
    return "rate_limit_or_plan";
  }

  return status && status >= 400 ? "http_error" : "provider_error";
}

function formatProviderErrorMessage(details: APIFootballComSanitizedProviderError): string {
  const status = details.status ? ` status ${details.status}` : "";
  return `APIFootball.com ${details.kind} failure for action "${details.action}" using credential label "${details.credentialLabel}"${status}: ${details.message}. Request URL: ${details.safeRequestUrl}`;
}
