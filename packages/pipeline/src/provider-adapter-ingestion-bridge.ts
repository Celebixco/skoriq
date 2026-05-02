import type { ProviderAdapter, ProviderOperation, ProviderSportDomain } from "@sports-data/providers";
import { getProviderOperationMetadata } from "@sports-data/providers";
import type { ProviderEntityType } from "@sports-data/shared";
import type { ProviderIngestionResult, ProviderIngestionService } from "./provider-ingestion-service.js";

export interface ProviderAdapterIngestionRequest {
  adapter: ProviderAdapter;
  operation: ProviderOperation;
  sport?: ProviderSportDomain;
  entityType?: ProviderEntityType;
  params?: Record<string, unknown>;
  syncJobId?: string;
  correlationId?: string;
}

export class ProviderAdapterIngestionBridge {
  constructor(private readonly ingestionService: Pick<ProviderIngestionService, "ingestProviderResult">) {}

  async executeAndIngest<TData = unknown>(request: ProviderAdapterIngestionRequest): Promise<ProviderIngestionResult> {
    const operationMetadata = getProviderOperationMetadata(request.operation);
    const entityType = request.entityType ?? operationMetadata.entityType;

    if (entityType !== operationMetadata.entityType) {
      throw new Error(`Provider operation "${request.operation}" must ingest entity type "${operationMetadata.entityType}".`);
    }

    const result = await request.adapter.fetch<TData>({
      provider: request.adapter.name,
      operation: request.operation,
      sport: request.sport ?? operationMetadata.sport,
      entityType,
      params: request.params ?? {},
      requestHashInput: {
        provider: request.adapter.name,
        operation: request.operation,
        sport: request.sport ?? operationMetadata.sport,
        entityType,
        params: request.params ?? {}
      },
      syncJobId: request.syncJobId,
      correlationId: request.correlationId
    });

    return this.ingestionService.ingestProviderResult({
      entityType,
      result,
      syncJobId: request.syncJobId
    });
  }
}

