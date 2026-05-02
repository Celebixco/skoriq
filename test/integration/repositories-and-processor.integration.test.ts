import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { providerMappings, rawProviderPayloads, sports } from "@sports-data/database";
import { NormalizerRegistry, RawPayloadProcessor, createPipelineNormalizers } from "@sports-data/pipeline";
import { clearPublicTables, createIntegrationDatabase } from "../../scripts/test-database.js";
import {
  createRepositorySet,
  createTransactionBackedStaticRepositories,
  findMapping,
  findRawPayload,
  isUniqueViolation
} from "./integration-test-helpers.js";

const integrationDatabase = createIntegrationDatabase();

describe("repository transactions and raw payload processor against PostgreSQL", () => {
  beforeEach(async () => {
    await clearPublicTables(integrationDatabase.db);
  });

  afterAll(async () => {
    await integrationDatabase.close();
  });

  it("commits canonical upsert and provider mapping creation inside one transaction", async () => {
    await integrationDatabase.db.transaction(async (transaction) => {
      const repositories = createRepositorySet(transaction);
      const sport = await repositories.sports.upsertSport({ slug: "football", name: "Football" });
      await repositories.providerMappings.findOrCreateProviderMapping({
        provider: "integration",
        entityType: "sport",
        providerEntityId: "football",
        internalEntityType: "sport",
        internalEntityId: sport.id
      });
    });

    expect(await integrationDatabase.db.select().from(sports)).toHaveLength(1);
    expect(await findMapping(integrationDatabase.db, "integration", "football")).toBeDefined();
  });

  it("rolls back canonical and mapping writes when a transaction fails", async () => {
    await expect(
      integrationDatabase.db.transaction(async (transaction) => {
        const repositories = createRepositorySet(transaction);
        const sport = await repositories.sports.upsertSport({ slug: "football", name: "Football" });
        await repositories.providerMappings.findOrCreateProviderMapping({
          provider: "integration",
          entityType: "sport",
          providerEntityId: "football",
          internalEntityType: "sport",
          internalEntityId: sport.id
        });
        throw new Error("forced rollback");
      })
    ).rejects.toThrow("forced rollback");

    expect(await integrationDatabase.db.select().from(sports)).toHaveLength(0);
    expect(await integrationDatabase.db.select().from(providerMappings)).toHaveLength(0);
  });

  it("keeps provider mapping find-or-create idempotent and blocks direct duplicates", async () => {
    const repositories = createRepositorySet(integrationDatabase.db);
    const sport = await repositories.sports.upsertSport({ slug: "football", name: "Football" });
    const input = {
      provider: "integration",
      entityType: "sport" as const,
      providerEntityId: "football",
      internalEntityType: "sport" as const,
      internalEntityId: sport.id
    };

    const first = await repositories.providerMappings.findOrCreateProviderMapping(input);
    const second = await repositories.providerMappings.findOrCreateProviderMapping(input);

    expect(second?.id).toBe(first?.id);
    expect(await integrationDatabase.db.select().from(providerMappings)).toHaveLength(1);

    try {
      await repositories.providerMappings.createProviderMapping(input);
      throw new Error("Expected duplicate provider mapping insert to fail.");
    } catch (error) {
      expect(isUniqueViolation(error)).toBe(true);
    }
  });

  it("updates updated_at on repository update paths", async () => {
    const repositories = createRepositorySet(integrationDatabase.db);
    const sport = await repositories.sports.upsertSport({ slug: "football", name: "Football" });
    await new Promise((resolve) => setTimeout(resolve, 5));

    const updated = await repositories.sports.updateSport(sport.id, { slug: "football", name: "Association Football" });

    expect(updated?.updatedAt.getTime()).toBeGreaterThanOrEqual(sport.updatedAt.getTime());
    expect(updated?.name).toBe("Association Football");
  });

  it("processes a static raw payload into canonical data and remains idempotent", async () => {
    const repositories = createRepositorySet(integrationDatabase.db);
    const rawPayload = await repositories.rawPayloads.insertRawPayload({
      provider: "integration",
      endpoint: "sports",
      entityType: "sport",
      providerEntityId: "football",
      requestParams: { entity: "sport" },
      payloadJson: { providerEntityId: "football", name: "Football" }
    });
    const processor = createRawPayloadProcessor();

    const first = await processor.process({ rawPayloadId: rawPayload.id, entityType: "sport" });
    const second = await processor.process({ rawPayloadId: rawPayload.id, entityType: "sport" });

    expect(first.normalizationStatus).toBe("normalized");
    expect(second.normalizationStatus).toBe("already_processed");
    expect(await integrationDatabase.db.select().from(sports)).toHaveLength(1);
    expect(await integrationDatabase.db.select().from(providerMappings).where(eq(providerMappings.entityType, "sport"))).toHaveLength(1);
    expect((await findRawPayload(integrationDatabase.db, rawPayload.id))?.status).toBe("processed");
  });

  it("marks invalid static raw payloads failed without canonical writes", async () => {
    const repositories = createRepositorySet(integrationDatabase.db);
    const rawPayload = await repositories.rawPayloads.insertRawPayload({
      provider: "integration",
      endpoint: "sports",
      entityType: "sport",
      providerEntityId: "football",
      requestParams: { entity: "sport", invalid: true },
      payloadJson: { providerEntityId: "football" }
    });
    const processor = createRawPayloadProcessor();

    await expect(processor.process({ rawPayloadId: rawPayload.id, entityType: "sport" })).rejects.toThrow("Missing required field sport.name.");

    const storedPayload = await integrationDatabase.db.select().from(rawProviderPayloads).where(eq(rawProviderPayloads.id, rawPayload.id)).limit(1);
    expect(storedPayload[0]?.status).toBe("failed");
    expect(storedPayload[0]?.normalizationError).toBe("Missing required field sport.name.");
    expect(await integrationDatabase.db.select().from(sports)).toHaveLength(0);
  });
});

function createRawPayloadProcessor() {
  const repositories = createRepositorySet(integrationDatabase.db);
  const staticRepositories = createTransactionBackedStaticRepositories(integrationDatabase.db);
  const registry = new NormalizerRegistry(createPipelineNormalizers(staticRepositories));

  return new RawPayloadProcessor(repositories.rawPayloads, repositories.syncJobs, registry);
}
