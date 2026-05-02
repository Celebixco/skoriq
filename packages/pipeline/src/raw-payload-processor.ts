import type { RawProviderPayloadRepository, SyncJobRepository } from "@sports-data/database";
import type { RawPayloadProcessingJobPayload } from "@sports-data/queue";
import type { ProviderEntityType } from "@sports-data/shared";
import { providerEntityTypes } from "@sports-data/shared";
import { NormalizerRegistry } from "./normalizers.js";

export interface RawPayloadProcessorResult {
  rawPayloadId: string;
  status: "processed" | "skipped";
  normalizationStatus?: string;
}

export class RawPayloadProcessor {
  constructor(
    private readonly rawPayloads: RawProviderPayloadRepository,
    private readonly syncJobs: SyncJobRepository,
    private readonly normalizers = new NormalizerRegistry()
  ) {}

  async process(jobPayload: RawPayloadProcessingJobPayload): Promise<RawPayloadProcessorResult> {
    this.assertEntityType(jobPayload.entityType);

    const rawPayload = await this.rawPayloads.findRawPayloadById(jobPayload.rawPayloadId);
    if (!rawPayload) {
      throw new Error(`Raw payload "${jobPayload.rawPayloadId}" was not found.`);
    }

    if (rawPayload.status === "processed") {
      await this.log(jobPayload.syncJobId, "info", "Raw payload already processed", { rawPayloadId: rawPayload.id });
      return {
        rawPayloadId: rawPayload.id,
        status: "skipped",
        normalizationStatus: "already_processed"
      };
    }

    if (rawPayload.status !== "received") {
      throw new Error(`Raw payload "${rawPayload.id}" has invalid processing status "${rawPayload.status}".`);
    }

    await this.log(jobPayload.syncJobId, "info", "Raw payload processing started", { rawPayloadId: rawPayload.id, entityType: rawPayload.entityType });

    try {
      const normalizer = this.normalizers.get(rawPayload.entityType);
      const result = await normalizer.normalize(rawPayload.payloadJson, {
        provider: rawPayload.provider,
        rawPayloadId: rawPayload.id,
        entityType: rawPayload.entityType
      });

      await this.rawPayloads.markRawPayloadProcessed(rawPayload.id);
      await this.log(jobPayload.syncJobId, "info", "Raw payload processing completed", {
        rawPayloadId: rawPayload.id,
        normalizationStatus: result.status,
        entityType: result.entityType
      });

      return {
        rawPayloadId: rawPayload.id,
        status: "processed",
        normalizationStatus: result.status
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown raw payload processing error";
      await this.rawPayloads.markRawPayloadFailed(rawPayload.id, message);
      await this.log(jobPayload.syncJobId, "error", "Raw payload processing failed", {
        rawPayloadId: rawPayload.id,
        error: message
      });
      throw error;
    }
  }

  private assertEntityType(entityType: ProviderEntityType) {
    if (!providerEntityTypes.includes(entityType)) {
      throw new Error(`Unknown provider entity type "${entityType}".`);
    }
  }

  private async log(syncJobId: string | undefined, level: "info" | "error", message: string, metadataJson: Record<string, unknown>) {
    if (!syncJobId) {
      return;
    }

    await this.syncJobs.createSyncJobLog({
      syncJobId,
      level,
      message,
      metadataJson
    });
  }
}
