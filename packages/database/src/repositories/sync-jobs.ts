import { and, desc, eq, lt } from "drizzle-orm";
import type { LogLevel, ProviderEntityType } from "@sports-data/shared";
import type { QueueName } from "@sports-data/queue";
import { syncJobLogs, syncJobs } from "../schema.js";
import { subtractDays } from "./types.js";
import type { RepositoryExecutor } from "./types.js";

export interface CreateSyncJobInput {
  queueName: QueueName;
  jobName: string;
  jobKey: string;
  provider: string;
  entityType: ProviderEntityType;
  entityId?: string;
  providerEntityId?: string;
}

export interface CreateSyncJobLogInput {
  syncJobId: string;
  level: LogLevel;
  message: string;
  metadataJson?: Record<string, unknown>;
}

export class SyncJobRepository {
  constructor(private readonly db: RepositoryExecutor) {}

  async createSyncJob(input: CreateSyncJobInput) {
    const inserted = await this.db
      .insert(syncJobs)
      .values({
        ...input,
        status: "queued"
      })
      .onConflictDoNothing()
      .returning();

    if (inserted[0]) {
      return inserted[0];
    }

    const rows = await this.db.select().from(syncJobs).where(eq(syncJobs.jobKey, input.jobKey)).limit(1);
    return rows[0];
  }

  async markSyncJobRunning(syncJobId: string) {
    const now = new Date();
    const rows = await this.db
      .update(syncJobs)
      .set({
        status: "running",
        startedAt: now,
        updatedAt: now
      })
      .where(eq(syncJobs.id, syncJobId))
      .returning();
    return rows[0];
  }

  async markSyncJobSucceeded(syncJobId: string) {
    return this.finishSyncJob(syncJobId, "succeeded");
  }

  async markSyncJobFailed(syncJobId: string, reason: string) {
    return this.finishSyncJob(syncJobId, "failed", reason);
  }

  async createSyncJobLog(input: CreateSyncJobLogInput) {
    const rows = await this.db
      .insert(syncJobLogs)
      .values({
        syncJobId: input.syncJobId,
        level: input.level,
        message: input.message,
        metadataJson: input.metadataJson ?? {}
      })
      .returning();
    return rows[0];
  }

  async listRecentSyncJobs(limit = 50) {
    return this.db.select().from(syncJobs).orderBy(desc(syncJobs.updatedAt)).limit(limit);
  }

  async listFailedSyncJobs(limit = 50) {
    return this.db.select().from(syncJobs).where(eq(syncJobs.status, "failed")).orderBy(desc(syncJobs.updatedAt)).limit(limit);
  }

  async cleanupOldSyncJobLogs(retentionDays: number, now = new Date()) {
    const cutoff = subtractDays(now, retentionDays);
    const deleted = await this.db.delete(syncJobLogs).where(lt(syncJobLogs.createdAt, cutoff)).returning({ id: syncJobLogs.id });
    return deleted.length;
  }

  private async finishSyncJob(syncJobId: string, status: "succeeded" | "failed", reason?: string) {
    const current = await this.db.select().from(syncJobs).where(eq(syncJobs.id, syncJobId)).limit(1);
    const now = new Date();
    const startedAt = current[0]?.startedAt;
    const durationMs = startedAt ? Math.max(0, now.getTime() - startedAt.getTime()) : undefined;

    const rows = await this.db
      .update(syncJobs)
      .set({
        status,
        lastError: reason,
        finishedAt: now,
        durationMs,
        updatedAt: now
      })
      .where(and(eq(syncJobs.id, syncJobId)))
      .returning();
    return rows[0];
  }
}
