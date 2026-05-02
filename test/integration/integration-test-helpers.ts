import { eq } from "drizzle-orm";
import {
  CompetitionRepository,
  CountryRepository,
  ProviderMappingRepository,
  RawProviderPayloadRepository,
  SeasonRepository,
  SportRepository,
  SyncJobRepository,
  providerMappings,
  rawProviderPayloads
} from "@sports-data/database";
import type { RepositoryDatabase, RepositoryExecutor } from "@sports-data/database";
import { createStaticNormalizerRepositories } from "@sports-data/pipeline";
import type { StaticNormalizerRepositories } from "@sports-data/pipeline";

export const testRetention = {
  successRetentionDays: 7,
  failedRetentionDays: 30
};

export function createTransactionBackedStaticRepositories(db: RepositoryDatabase): StaticNormalizerRepositories {
  return createStaticNormalizerRepositories(db, async (work) => db.transaction(async (transaction) => work(createStaticNormalizerRepositories(transaction))));
}

export function createRepositorySet(db: RepositoryExecutor) {
  return {
    sports: new SportRepository(db),
    countries: new CountryRepository(db),
    competitions: new CompetitionRepository(db),
    seasons: new SeasonRepository(db),
    providerMappings: new ProviderMappingRepository(db),
    rawPayloads: new RawProviderPayloadRepository(db, testRetention),
    syncJobs: new SyncJobRepository(db)
  };
}

export async function findMapping(db: RepositoryDatabase, provider: string, providerEntityId: string) {
  const rows = await db.select().from(providerMappings).where(eq(providerMappings.providerEntityId, providerEntityId));
  return rows.find((row) => row.provider === provider);
}

export async function findRawPayload(db: RepositoryDatabase, id: string) {
  const rows = await db.select().from(rawProviderPayloads).where(eq(rawProviderPayloads.id, id)).limit(1);
  return rows[0];
}

export function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}
