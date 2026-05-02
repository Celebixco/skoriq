import { and, asc, eq, lt } from "drizzle-orm";
import { sha256Hash } from "@sports-data/shared";
import type { ProviderEntityType, RawPayloadStatus } from "@sports-data/shared";
import { rawProviderPayloads } from "../schema.js";
import { addDays } from "./types.js";
import type { RepositoryExecutor } from "./types.js";

export interface RawPayloadRetentionConfig {
  successRetentionDays: number;
  failedRetentionDays: number;
}

export interface InsertRawPayloadInput {
  provider: string;
  entityType: ProviderEntityType;
  providerEntityId?: string;
  endpoint: string;
  requestParams?: unknown;
  requestParamsHash?: string;
  payloadJson: unknown;
  payloadHash?: string;
  status?: RawPayloadStatus;
  receivedAt?: Date;
  deleteAfter?: Date;
}

export function buildRawPayloadInsertValues(input: InsertRawPayloadInput, retention: RawPayloadRetentionConfig) {
  const status = input.status ?? "received";
  const receivedAt = input.receivedAt ?? new Date();
  const retentionDays = status === "failed" ? retention.failedRetentionDays : retention.successRetentionDays;

  return {
    provider: input.provider,
    entityType: input.entityType,
    providerEntityId: input.providerEntityId,
    endpoint: input.endpoint,
    requestParamsHash: input.requestParamsHash ?? sha256Hash(input.requestParams ?? {}),
    payloadHash: input.payloadHash ?? sha256Hash(input.payloadJson),
    payloadJson: input.payloadJson,
    status,
    receivedAt,
    deleteAfter: input.deleteAfter ?? addDays(receivedAt, retentionDays)
  };
}

export class RawProviderPayloadRepository {
  constructor(
    private readonly db: RepositoryExecutor,
    private readonly retention: RawPayloadRetentionConfig
  ) {}

  async insertRawPayload(input: InsertRawPayloadInput) {
    const values = buildRawPayloadInsertValues(input, this.retention);
    const inserted = await this.db.insert(rawProviderPayloads).values(values).onConflictDoNothing().returning();

    if (inserted[0]) {
      return inserted[0];
    }

    return this.findRawPayloadByDedupeKey(values.provider, values.endpoint, values.requestParamsHash, values.payloadHash);
  }

  async findRawPayloadById(id: string) {
    const rows = await this.db.select().from(rawProviderPayloads).where(eq(rawProviderPayloads.id, id)).limit(1);
    return rows[0];
  }

  async findRawPayloadByDedupeKey(provider: string, endpoint: string, requestParamsHash: string, payloadHash: string) {
    const rows = await this.db
      .select()
      .from(rawProviderPayloads)
      .where(
        and(
          eq(rawProviderPayloads.provider, provider),
          eq(rawProviderPayloads.endpoint, endpoint),
          eq(rawProviderPayloads.requestParamsHash, requestParamsHash),
          eq(rawProviderPayloads.payloadHash, payloadHash)
        )
      )
      .limit(1);
    return rows[0];
  }

  async findPendingRawPayloads(limit = 100) {
    return this.db.select().from(rawProviderPayloads).where(eq(rawProviderPayloads.status, "received")).orderBy(asc(rawProviderPayloads.receivedAt)).limit(limit);
  }

  async updateRawPayloadStatus(id: string, status: RawPayloadStatus, normalizationError?: string) {
    const rows = await this.db
      .update(rawProviderPayloads)
      .set({
        status,
        normalizationError,
        processedAt: status === "processed" || status === "failed" ? new Date() : undefined
      })
      .where(eq(rawProviderPayloads.id, id))
      .returning();
    return rows[0];
  }

  async markRawPayloadProcessed(id: string) {
    const now = new Date();
    const rows = await this.db
      .update(rawProviderPayloads)
      .set({
        status: "processed",
        normalizationError: null,
        processedAt: now,
        deleteAfter: addDays(now, this.retention.successRetentionDays)
      })
      .where(eq(rawProviderPayloads.id, id))
      .returning();
    return rows[0];
  }

  async markRawPayloadFailed(id: string, errorMessage: string) {
    const now = new Date();
    const rows = await this.db
      .update(rawProviderPayloads)
      .set({
        status: "failed",
        normalizationError: errorMessage,
        processedAt: now,
        deleteAfter: addDays(now, this.retention.failedRetentionDays)
      })
      .where(eq(rawProviderPayloads.id, id))
      .returning();
    return rows[0];
  }

  async markRawPayloadReceivedForRetry(id: string) {
    const rows = await this.db
      .update(rawProviderPayloads)
      .set({
        status: "received",
        normalizationError: null,
        processedAt: null
      })
      .where(eq(rawProviderPayloads.id, id))
      .returning();
    return rows[0];
  }

  async cleanupExpiredSuccessfulRawPayloads(now = new Date()) {
    const deleted = await this.db
      .delete(rawProviderPayloads)
      .where(and(eq(rawProviderPayloads.status, "processed"), lt(rawProviderPayloads.deleteAfter, now)))
      .returning({ id: rawProviderPayloads.id });
    return deleted.length;
  }

  async cleanupExpiredFailedRawPayloads(now = new Date()) {
    const deleted = await this.db
      .delete(rawProviderPayloads)
      .where(and(eq(rawProviderPayloads.status, "failed"), lt(rawProviderPayloads.deleteAfter, now)))
      .returning({ id: rawProviderPayloads.id });
    return deleted.length;
  }
}
