import type { ProviderEntityType } from "@sports-data/shared";

export interface NormalizationContext {
  provider: string;
  rawPayloadId: string;
}

export interface NormalizationResult {
  entityType: ProviderEntityType;
  internalEntityIds: string[];
  changed: boolean;
  errors: string[];
}

export interface Normalizer<TProviderDto> {
  readonly entityType: ProviderEntityType;
  normalize(dto: TProviderDto, context: NormalizationContext): Promise<NormalizationResult>;
}
