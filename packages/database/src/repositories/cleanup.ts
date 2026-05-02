import { RawProviderPayloadRepository, type RawPayloadRetentionConfig } from "./raw-provider-payloads.js";
import { SyncJobRepository } from "./sync-jobs.js";
import type { RepositoryExecutor } from "./types.js";

export const cleanupAllowedTables = ["raw_provider_payloads", "sync_job_logs"] as const;

export interface CleanupConfig extends RawPayloadRetentionConfig {
  syncLogRetentionDays: number;
}

export interface CleanupResult {
  successfulRawPayloadsDeleted: number;
  failedRawPayloadsDeleted: number;
  syncJobLogsDeleted: number;
}

export class CleanupRepository {
  private readonly rawPayloads: RawProviderPayloadRepository;
  private readonly syncJobs: SyncJobRepository;

  constructor(
    db: RepositoryExecutor,
    private readonly config: CleanupConfig
  ) {
    this.rawPayloads = new RawProviderPayloadRepository(db, config);
    this.syncJobs = new SyncJobRepository(db);
  }

  async runExpiredDataCleanup(now = new Date()): Promise<CleanupResult> {
    const successfulRawPayloadsDeleted = await this.rawPayloads.cleanupExpiredSuccessfulRawPayloads(now);
    const failedRawPayloadsDeleted = await this.rawPayloads.cleanupExpiredFailedRawPayloads(now);
    const syncJobLogsDeleted = await this.syncJobs.cleanupOldSyncJobLogs(this.config.syncLogRetentionDays, now);

    return {
      successfulRawPayloadsDeleted,
      failedRawPayloadsDeleted,
      syncJobLogsDeleted
    };
  }
}
