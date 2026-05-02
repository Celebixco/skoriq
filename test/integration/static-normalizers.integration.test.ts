import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { competitions, countries, providerMappings, seasons, sports } from "@sports-data/database";
import { clearPublicTables, createIntegrationDatabase } from "../../scripts/test-database.js";
import { CompetitionNormalizer, CountryNormalizer, SeasonNormalizer, SportNormalizer } from "@sports-data/pipeline";
import { createTransactionBackedStaticRepositories } from "./integration-test-helpers.js";

const integrationDatabase = createIntegrationDatabase();

describe("static canonical normalizers against PostgreSQL", () => {
  beforeEach(async () => {
    await clearPublicTables(integrationDatabase.db);
  });

  afterAll(async () => {
    await integrationDatabase.close();
  });

  it("creates, maps, reuses, and idempotently updates sports", async () => {
    const repositories = createTransactionBackedStaticRepositories(integrationDatabase.db);
    const normalizer = new SportNormalizer(repositories);

    const first = await normalizer.normalize({ providerEntityId: "football", name: "Football" }, { provider: "integration", rawPayloadId: "raw-1", entityType: "sport" });
    const second = await normalizer.normalize({ providerEntityId: "football", name: "Association Football", slug: "football" }, { provider: "integration", rawPayloadId: "raw-2", entityType: "sport" });

    const sportRows = await integrationDatabase.db.select().from(sports);
    const mappingRows = await integrationDatabase.db.select().from(providerMappings).where(eq(providerMappings.entityType, "sport"));

    expect(first.internalEntityIds).toEqual(second.internalEntityIds);
    expect(sportRows).toHaveLength(1);
    expect(sportRows[0]?.name).toBe("Association Football");
    expect(mappingRows).toHaveLength(1);
    expect(mappingRows[0]?.internalEntityId).toBe(sportRows[0]?.id);
  });

  it("creates countries with code and slug fallback mappings", async () => {
    const repositories = createTransactionBackedStaticRepositories(integrationDatabase.db);
    const normalizer = new CountryNormalizer(repositories);

    await normalizer.normalize(
      [
        { providerEntityId: "us", name: "United States", code: "us" },
        { providerEntityId: "intl", name: "International" }
      ],
      { provider: "integration", rawPayloadId: "raw-1", entityType: "country" }
    );

    const countryRows = await integrationDatabase.db.select().from(countries).orderBy(countries.slug);
    const mappingRows = await integrationDatabase.db.select().from(providerMappings).where(eq(providerMappings.entityType, "country"));

    expect(countryRows).toHaveLength(2);
    expect(countryRows.map((country) => country.slug)).toEqual(["international", "us"]);
    expect(countryRows.find((country) => country.slug === "us")?.code).toBe("US");
    expect(countryRows.find((country) => country.slug === "international")?.code).toBeNull();
    expect(mappingRows).toHaveLength(2);
  });

  it("requires sport mapping and resolves optional country mapping for competitions", async () => {
    const repositories = createTransactionBackedStaticRepositories(integrationDatabase.db);
    const competitionNormalizer = new CompetitionNormalizer(repositories);

    await expect(
      competitionNormalizer.normalize(
        { providerEntityId: "premier-league", sportProviderId: "football", name: "Premier League" },
        { provider: "integration", rawPayloadId: "raw-1", entityType: "competition" }
      )
    ).rejects.toThrow('Cannot normalize competition "premier-league" without sport mapping "football".');

    await new SportNormalizer(repositories).normalize({ providerEntityId: "football", name: "Football" }, { provider: "integration", rawPayloadId: "raw-2", entityType: "sport" });
    await new CountryNormalizer(repositories).normalize({ providerEntityId: "england", name: "England", slug: "england" }, { provider: "integration", rawPayloadId: "raw-3", entityType: "country" });

    const first = await competitionNormalizer.normalize(
      { providerEntityId: "premier-league", sportProviderId: "football", countryProviderId: "england", name: "Premier League", metadata: { tier: 1 } },
      { provider: "integration", rawPayloadId: "raw-4", entityType: "competition" }
    );
    const second = await competitionNormalizer.normalize(
      { providerEntityId: "premier-league", sportProviderId: "football", countryProviderId: "england", name: "Premier League" },
      { provider: "integration", rawPayloadId: "raw-5", entityType: "competition" }
    );

    const competitionRows = await integrationDatabase.db.select().from(competitions);
    const mappingRows = await integrationDatabase.db.select().from(providerMappings).where(eq(providerMappings.entityType, "competition"));

    expect(first.internalEntityIds).toEqual(second.internalEntityIds);
    expect(competitionRows).toHaveLength(1);
    expect(competitionRows[0]?.countryId).not.toBeNull();
    expect(mappingRows).toHaveLength(1);
    expect(mappingRows[0]?.internalEntityId).toBe(competitionRows[0]?.id);
  });

  it("requires competition mapping and idempotently creates seasons", async () => {
    const repositories = createTransactionBackedStaticRepositories(integrationDatabase.db);
    const seasonNormalizer = new SeasonNormalizer(repositories);

    await expect(
      seasonNormalizer.normalize(
        { providerEntityId: "pl-2026", competitionProviderId: "premier-league", name: "2025/2026" },
        { provider: "integration", rawPayloadId: "raw-1", entityType: "season" }
      )
    ).rejects.toThrow('Cannot normalize season "pl-2026" without competition mapping "premier-league".');

    await new SportNormalizer(repositories).normalize({ providerEntityId: "football", name: "Football" }, { provider: "integration", rawPayloadId: "raw-2", entityType: "sport" });
    await new CompetitionNormalizer(repositories).normalize(
      { providerEntityId: "premier-league", sportProviderId: "football", name: "Premier League" },
      { provider: "integration", rawPayloadId: "raw-3", entityType: "competition" }
    );

    const first = await seasonNormalizer.normalize(
      { providerEntityId: "pl-2026", competitionProviderId: "premier-league", name: "2025/2026", startDate: "2025-08-01", isCurrent: true },
      { provider: "integration", rawPayloadId: "raw-4", entityType: "season" }
    );
    const second = await seasonNormalizer.normalize(
      { providerEntityId: "pl-2026", competitionProviderId: "premier-league", name: "2025/2026", endDate: "2026-05-31" },
      { provider: "integration", rawPayloadId: "raw-5", entityType: "season" }
    );

    const seasonRows = await integrationDatabase.db.select().from(seasons);
    const mappingRows = await integrationDatabase.db.select().from(providerMappings).where(eq(providerMappings.entityType, "season"));

    expect(first.internalEntityIds).toEqual(second.internalEntityIds);
    expect(seasonRows).toHaveLength(1);
    expect(seasonRows[0]?.endDate).toBe("2026-05-31");
    expect(mappingRows).toHaveLength(1);
  });
});
