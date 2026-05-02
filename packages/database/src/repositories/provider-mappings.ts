import { and, eq } from "drizzle-orm";
import type { ProviderEntityType } from "@sports-data/shared";
import { providerMappings } from "../schema.js";
import type { RepositoryExecutor } from "./types.js";

export interface CreateProviderMappingInput {
  provider: string;
  entityType: ProviderEntityType;
  providerEntityId: string;
  internalEntityType: ProviderEntityType;
  internalEntityId: string;
  metadataJson?: Record<string, unknown>;
}

export class ProviderMappingRepository {
  constructor(private readonly db: RepositoryExecutor) {}

  async findProviderMapping(provider: string, entityType: ProviderEntityType, providerEntityId: string) {
    const rows = await this.db
      .select()
      .from(providerMappings)
      .where(and(eq(providerMappings.provider, provider), eq(providerMappings.entityType, entityType), eq(providerMappings.providerEntityId, providerEntityId)))
      .limit(1);
    return rows[0];
  }

  async createProviderMapping(input: CreateProviderMappingInput) {
    const rows = await this.db
      .insert(providerMappings)
      .values({
        ...input,
        metadataJson: input.metadataJson ?? {}
      })
      .returning();
    return rows[0];
  }

  async findOrCreateProviderMapping(input: CreateProviderMappingInput) {
    const inserted = await this.db
      .insert(providerMappings)
      .values({
        ...input,
        metadataJson: input.metadataJson ?? {}
      })
      .onConflictDoNothing()
      .returning();

    if (inserted[0]) {
      return inserted[0];
    }

    return this.findProviderMapping(input.provider, input.entityType, input.providerEntityId);
  }

  async findMappingsByInternalEntity(internalEntityType: ProviderEntityType, internalEntityId: string) {
    return this.db
      .select()
      .from(providerMappings)
      .where(and(eq(providerMappings.internalEntityType, internalEntityType), eq(providerMappings.internalEntityId, internalEntityId)));
  }
}
