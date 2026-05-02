import type { Queue } from "bullmq";
import type { RawProviderPayloadRepository, SyncJobRepository } from "@sports-data/database";
import type { ProviderFetchResult } from "@sports-data/providers";
import type { ProviderEntityType } from "@sports-data/shared";
import { sha256Hash } from "@sports-data/shared";
import { buildRawPayloadProcessingJobKey, queueNames } from "@sports-data/queue";
import type { QueueName, RawPayloadProcessingJobPayload } from "@sports-data/queue";

export interface ProviderIngestionRequest<TData> {
  entityType: ProviderEntityType;
  result: ProviderFetchResult<TData>;
  syncJobId?: string;
}

export interface ProviderIngestionEnvironment {
  nodeEnv: "development" | "test" | "production";
  mockProviderEnabled: boolean;
}

export interface ProviderIngestionResult {
  rawPayloadId: string;
  syncJobId?: string;
  enqueuedJobKey: string;
}

export class ProviderIngestionService {
  constructor(
    private readonly rawPayloads: RawProviderPayloadRepository,
    private readonly syncJobs: SyncJobRepository,
    private readonly rawPayloadProcessingQueue: Pick<Queue, "add">,
    private readonly environment: ProviderIngestionEnvironment
  ) {}

  async ingestProviderResult<TData>(request: ProviderIngestionRequest<TData>): Promise<ProviderIngestionResult> {
    this.assertProviderAllowed(request.result.metadata.provider);
    this.validateProviderResult(request);

    if (request.syncJobId) {
      await this.syncJobs.createSyncJobLog({
        syncJobId: request.syncJobId,
        level: "info",
        message: "Provider ingestion accepted",
        metadataJson: {
          provider: request.result.metadata.provider,
          endpoint: request.result.metadata.endpoint,
          entityType: request.entityType
        }
      });
    }

    const rawPayload = await this.rawPayloads.insertRawPayload({
      provider: request.result.metadata.provider,
      entityType: request.entityType,
      providerEntityId: request.result.metadata.providerEntityId,
      endpoint: request.result.metadata.endpoint,
      requestParams: request.result.metadata.requestParamsHashInput,
      requestParamsHash: sha256Hash(request.result.metadata.requestParamsHashInput),
      payloadJson: request.result.rawPayload ?? request.result.data,
      payloadHash: sha256Hash(request.result.rawPayload ?? request.result.data),
      status: "received",
      receivedAt: new Date(request.result.metadata.fetchedAt)
    });

    if (!rawPayload) {
      throw new Error("Failed to insert or find raw provider payload.");
    }

    const jobPayload: RawPayloadProcessingJobPayload = {
      rawPayloadId: rawPayload.id,
      entityType: request.entityType,
      syncJobId: request.syncJobId
    };
    const jobKey = buildRawPayloadProcessingJobKey(jobPayload);

    await this.rawPayloadProcessingQueue.add("process-raw-payload", jobPayload, {
      jobId: jobKey,
      removeOnComplete: true,
      removeOnFail: false
    });

    if (request.syncJobId) {
      await this.syncJobs.createSyncJobLog({
        syncJobId: request.syncJobId,
        level: "info",
        message: "Raw payload stored and processing job enqueued",
        metadataJson: {
          rawPayloadId: rawPayload.id,
          queueName: queueNames.rawPayloadProcessing,
          jobKey
        }
      });
    }

    return {
      rawPayloadId: rawPayload.id,
      syncJobId: request.syncJobId,
      enqueuedJobKey: jobKey
    };
  }

  private assertProviderAllowed(provider: string) {
    if (provider === "mock" && this.environment.nodeEnv === "production") {
      throw new Error("Mock provider ingestion is forbidden in production.");
    }

    if (provider === "mock" && !this.environment.mockProviderEnabled) {
      throw new Error("Mock provider ingestion requires MOCK_PROVIDER_ENABLED=true in development or test.");
    }
  }

  private validateProviderResult<TData>(request: ProviderIngestionRequest<TData>) {
    const metadata = request.result.metadata;
    if (!metadata.provider || !metadata.endpoint || !metadata.fetchedAt) {
      throw new Error("Provider result metadata must include provider, endpoint, and fetchedAt.");
    }

    if (!metadata.requestParams || metadata.requestParamsHashInput === undefined) {
      throw new Error("Provider result metadata must include request params and requestParamsHashInput.");
    }
  }
}

export type RawPayloadProcessingQueueName = Extract<QueueName, typeof queueNames.rawPayloadProcessing>;
