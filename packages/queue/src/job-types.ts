import type { ProviderEntityType } from "@sports-data/shared";
import { sha256Hash } from "@sports-data/shared";
import type { QueueName } from "./queue-names.js";

export interface SyncJobPayload {
  provider: string;
  entityType: ProviderEntityType;
  operation: string;
  providerEntityId?: string;
  params?: Record<string, unknown>;
}

export interface RawPayloadProcessingJobPayload {
  rawPayloadId: string;
  entityType: ProviderEntityType;
  syncJobId?: string;
}

export interface NormalizationJobPayload {
  rawPayloadId: string;
  provider: string;
  entityType: ProviderEntityType;
  syncJobId?: string;
}

export interface AnalysisFeatureBuildJobPayload {
  reason: string;
  matchId?: string;
  teamId?: string;
  competitionId?: string;
  seasonId?: string;
}

export interface CleanupJobPayload {
  requestedBy: "scheduler" | "admin";
}

export interface QueueRetryPolicy {
  attempts: number;
  backoffMs: number;
}

export const defaultRetryPolicy: QueueRetryPolicy = {
  attempts: 5,
  backoffMs: 30_000
};

export function buildSyncJobKey(payload: SyncJobPayload): string {
  const paramsHash = payload.params ? sha256Hash(payload.params) : "no-params";
  return [payload.provider, payload.entityType, payload.operation, payload.providerEntityId ?? "collection", paramsHash].join(":");
}

export function buildRawPayloadProcessingJobKey(payload: RawPayloadProcessingJobPayload): string {
  return ["raw-payload", payload.entityType, payload.rawPayloadId, payload.syncJobId ?? "no-sync-job"].join(":");
}

export interface QueueRegistration {
  name: QueueName;
  concurrency: number;
}
