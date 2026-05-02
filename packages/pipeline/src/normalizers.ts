import type { ProviderEntityType } from "@sports-data/shared";
import type { StaticNormalizerRepositories } from "./static-normalizers.js";
import { createStaticEntityNormalizers } from "./static-normalizers.js";

export type NormalizationStatus = "validated_only" | "not_implemented" | "failed" | "normalized";

export interface NormalizationContext {
  provider: string;
  rawPayloadId: string;
  entityType: ProviderEntityType;
}

export interface NormalizationResult {
  status: NormalizationStatus;
  entityType: ProviderEntityType;
  changed: boolean;
  internalEntityIds: string[];
  message?: string;
}

export interface PipelineNormalizer {
  readonly entityType: ProviderEntityType;
  normalize(payload: unknown, context: NormalizationContext): Promise<NormalizationResult>;
}

export class ValidatedOnlyNormalizer implements PipelineNormalizer {
  constructor(readonly entityType: ProviderEntityType) {}

  async normalize(payload: unknown, context: NormalizationContext): Promise<NormalizationResult> {
    if (payload === null || payload === undefined) {
      throw new Error(`Raw payload for ${context.entityType} is empty.`);
    }

    return {
      status: "validated_only",
      entityType: this.entityType,
      changed: false,
      internalEntityIds: [],
      message: "Payload envelope validated only; canonical upsert is not implemented yet."
    };
  }
}

export class NormalizerRegistry {
  private readonly normalizers: Map<ProviderEntityType, PipelineNormalizer>;

  constructor(normalizers: PipelineNormalizer[] = createDefaultNormalizerShells()) {
    this.normalizers = new Map(normalizers.map((normalizer) => [normalizer.entityType, normalizer]));
  }

  get(entityType: ProviderEntityType): PipelineNormalizer {
    const normalizer = this.normalizers.get(entityType);
    if (!normalizer) {
      throw new Error(`No normalizer shell is registered for entity type "${entityType}".`);
    }

    return normalizer;
  }
}

export function createDefaultNormalizerShells(): PipelineNormalizer[] {
  return [
    "sport",
    "country",
    "competition",
    "season",
    "team",
    "player",
    "match",
    "football_match_score",
    "basketball_match_score",
    "basketball_period_score",
    "football_match_team_statistics",
    "basketball_team_match_statistics",
    "football_standing",
    "basketball_standing",
    "match_score",
    "match_event",
    "match_statistics",
    "standing"
  ].map((entityType) => new ValidatedOnlyNormalizer(entityType as ProviderEntityType));
}

export function createPipelineNormalizers(repositories: StaticNormalizerRepositories): PipelineNormalizer[] {
  const staticNormalizers = createStaticEntityNormalizers(repositories);
  const staticEntityTypes = new Set(staticNormalizers.map((normalizer) => normalizer.entityType));
  const remainingShells = createDefaultNormalizerShells().filter((normalizer) => !staticEntityTypes.has(normalizer.entityType));

  return [...staticNormalizers, ...remainingShells];
}
