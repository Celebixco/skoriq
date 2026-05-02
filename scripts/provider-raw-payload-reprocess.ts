import "dotenv/config";
import { pathToFileURL } from "node:url";
import { and, eq, inArray } from "drizzle-orm";
import { loadConfig } from "@sports-data/config";
import {
  RawProviderPayloadRepository,
  SyncJobRepository,
  createDatabase,
  providerMappings
} from "@sports-data/database";
import type { Database } from "@sports-data/database";
import { NormalizerRegistry, RawPayloadProcessor, createPipelineNormalizers, createStaticNormalizerRepositories } from "@sports-data/pipeline";
import type { RawPayloadProcessingJobPayload } from "@sports-data/queue";
import type { ProviderEntityType, RawPayloadStatus } from "@sports-data/shared";
import { checkDatabaseReadiness, formatDatabaseReadinessResult } from "./db-readiness.js";

export interface RawPayloadReprocessOptions {
  rawPayloadId?: string;
  execute: boolean;
}

export interface RawPayloadReprocessDependencies {
  loadRawPayload(id: string): Promise<RawPayloadRecord | undefined>;
  markRawPayloadReceivedForRetry?(id: string): Promise<unknown>;
  processRawPayload?(payload: RawPayloadProcessingJobPayload): Promise<{ status: string; normalizationStatus?: string }>;
  countProviderMappings(provider: string, entityType: ProviderEntityType, providerEntityIds: string[]): Promise<number>;
}

export interface RawPayloadRecord {
  id: string;
  provider: string;
  entityType: ProviderEntityType;
  providerEntityId?: string | null;
  endpoint: string;
  status: RawPayloadStatus;
  payloadJson: unknown;
  receivedAt: Date;
  processedAt?: Date | null;
  normalizationError?: string | null;
  deleteAfter?: Date | null;
}

export interface RawPayloadReprocessReport {
  mode: "dry-run" | "execute";
  rawPayload: {
    id: string;
    provider: string;
    entityType: ProviderEntityType;
    providerEntityId?: string | null;
    endpoint: string;
    status: RawPayloadStatus;
    receivedAt: string;
    processedAt?: string | null;
    errorMessage?: string | null;
  };
  scope: {
    competitionProviderIds: string[];
    teamProviderIdsCount: number;
  };
  dependencyCheck: {
    competitionMappingsRequired: number;
    competitionMappingsFound: number;
    teamMappingsRequired: number;
    teamMappingsFound: number;
    likelySafe: boolean;
  };
  result: "would_reprocess" | "processed";
  writes: number;
  warnings: string[];
}

const supportedProvider = "apifootball-com";
const supportedEntityType = "football_standing";

export function parseRawPayloadReprocessArgs(args: string[]): RawPayloadReprocessOptions {
  const options: RawPayloadReprocessOptions = { execute: false };

  for (const arg of args) {
    if (arg === "--execute") {
      options.execute = true;
      continue;
    }
    if (arg === "--dry-run") {
      options.execute = false;
      continue;
    }
    if (arg.startsWith("--raw-payload-id=")) {
      options.rawPayloadId = requiredFlagValue("--raw-payload-id", arg.slice("--raw-payload-id=".length));
      continue;
    }
    throw new Error(`Unknown raw payload reprocess flag "${arg}".`);
  }

  return options;
}

export function validateRawPayloadReprocessOptions(options: RawPayloadReprocessOptions) {
  if (!options.rawPayloadId) {
    throw new Error("Raw payload reprocess requires --raw-payload-id=<uuid>.");
  }
}

export class RawProviderPayloadReprocessor {
  constructor(private readonly dependencies: RawPayloadReprocessDependencies) {}

  async run(options: RawPayloadReprocessOptions): Promise<RawPayloadReprocessReport> {
    validateRawPayloadReprocessOptions(options);
    const payload = await this.loadAndValidate(options.rawPayloadId!);
    const scope = extractStandingScope(payload.payloadJson);
    const dependencyCheck = await this.checkStandingDependencies(payload.provider, scope);
    const warnings = [
      "Manual raw payload reprocess is narrow and targets one failed payload only.",
      "No provider fetch is performed.",
      "No raw payload deletion or broad cleanup is performed."
    ];
    const baseReport = buildBaseReport(options, payload, scope, dependencyCheck, warnings);

    if (!dependencyCheck.likelySafe) {
      warnings.push("Dependency check is incomplete; execute should not be run until required provider mappings exist.");
    }

    if (!options.execute) {
      return baseReport;
    }

    if (!dependencyCheck.likelySafe) {
      throw new Error("Raw payload reprocess execute is blocked because dependency checks are incomplete.");
    }
    if (!this.dependencies.markRawPayloadReceivedForRetry || !this.dependencies.processRawPayload) {
      throw new Error("Raw payload reprocess execute dependencies are not configured.");
    }

    await this.dependencies.markRawPayloadReceivedForRetry(payload.id);
    await this.dependencies.processRawPayload({
      rawPayloadId: payload.id,
      entityType: payload.entityType
    });

    return {
      ...baseReport,
      mode: "execute",
      result: "processed",
      writes: 1
    };
  }

  private async loadAndValidate(id: string): Promise<RawPayloadRecord> {
    const payload = await this.dependencies.loadRawPayload(id);
    if (!payload) {
      throw new Error(`Raw payload "${id}" was not found.`);
    }
    if (payload.status !== "failed") {
      throw new Error(`Raw payload reprocess requires status=failed; current status is "${payload.status}".`);
    }
    if (payload.provider !== supportedProvider) {
      throw new Error(`Raw payload reprocess MVP supports provider "${supportedProvider}" only.`);
    }
    if (payload.entityType !== supportedEntityType) {
      throw new Error(`Raw payload reprocess MVP supports entity_type "${supportedEntityType}" only.`);
    }
    if (payload.deleteAfter && payload.deleteAfter.getTime() < Date.now()) {
      throw new Error("Raw payload reprocess refuses expired payloads.");
    }
    return payload;
  }

  private async checkStandingDependencies(provider: string, scope: RawPayloadReprocessReport["scope"]): Promise<RawPayloadReprocessReport["dependencyCheck"]> {
    const competitionMappingsFound = await this.dependencies.countProviderMappings(provider, "competition", scope.competitionProviderIds);
    const teamProviderIds = extractStandingTeamProviderIds(scope);
    const teamMappingsFound = await this.dependencies.countProviderMappings(provider, "team", teamProviderIds);

    return {
      competitionMappingsRequired: scope.competitionProviderIds.length,
      competitionMappingsFound,
      teamMappingsRequired: teamProviderIds.length,
      teamMappingsFound,
      likelySafe: competitionMappingsFound === scope.competitionProviderIds.length && teamMappingsFound === teamProviderIds.length
    };
  }
}

function extractStandingScope(payloadJson: unknown): RawPayloadReprocessReport["scope"] & { teamProviderIds: string[] } {
  const rows = asArray(payloadJson);
  const competitionProviderIds = uniqueStrings(rows.map((row) => asString(asObject(row).competitionProviderId)));
  const teamProviderIds = uniqueStrings(rows.map((row) => asString(asObject(row).teamProviderId)));
  return {
    competitionProviderIds,
    teamProviderIds,
    teamProviderIdsCount: teamProviderIds.length
  };
}

function extractStandingTeamProviderIds(scope: RawPayloadReprocessReport["scope"] & { teamProviderIds?: string[] }) {
  return scope.teamProviderIds ?? [];
}

function buildBaseReport(
  options: RawPayloadReprocessOptions,
  payload: RawPayloadRecord,
  scope: RawPayloadReprocessReport["scope"] & { teamProviderIds?: string[] },
  dependencyCheck: RawPayloadReprocessReport["dependencyCheck"],
  warnings: string[]
): RawPayloadReprocessReport {
  return {
    mode: options.execute ? "execute" : "dry-run",
    rawPayload: {
      id: payload.id,
      provider: payload.provider,
      entityType: payload.entityType,
      providerEntityId: payload.providerEntityId,
      endpoint: payload.endpoint,
      status: payload.status,
      receivedAt: payload.receivedAt.toISOString(),
      processedAt: payload.processedAt?.toISOString() ?? null,
      errorMessage: sanitizeError(payload.normalizationError)
    },
    scope: {
      competitionProviderIds: scope.competitionProviderIds,
      teamProviderIdsCount: scope.teamProviderIdsCount
    },
    dependencyCheck,
    result: "would_reprocess",
    writes: 0,
    warnings
  };
}

function createDatabaseDependencies(config: ReturnType<typeof loadConfig>): RawPayloadReprocessDependencies {
  const database = createDatabase(config.DATABASE_URL);
  const rawPayloadRepository = new RawProviderPayloadRepository(database, {
    successRetentionDays: config.RAW_PAYLOAD_SUCCESS_RETENTION_DAYS,
    failedRetentionDays: config.RAW_PAYLOAD_FAILED_RETENTION_DAYS
  });
  const syncJobRepository = new SyncJobRepository(database);
  const normalizerRegistry = new NormalizerRegistry(
    createPipelineNormalizers(
      createStaticNormalizerRepositories(database, (work) =>
        database.transaction((transaction) => work(createStaticNormalizerRepositories(transaction)))
      )
    )
  );
  const rawPayloadProcessor = new RawPayloadProcessor(rawPayloadRepository, syncJobRepository, normalizerRegistry);

  return {
    loadRawPayload: (id) => rawPayloadRepository.findRawPayloadById(id) as Promise<RawPayloadRecord | undefined>,
    markRawPayloadReceivedForRetry: (id) => rawPayloadRepository.markRawPayloadReceivedForRetry(id),
    processRawPayload: (payload) => rawPayloadProcessor.process(payload),
    countProviderMappings: (provider, entityType, providerEntityIds) => countProviderMappings(database, provider, entityType, providerEntityIds)
  };
}

async function countProviderMappings(database: Database, provider: string, entityType: ProviderEntityType, providerEntityIds: string[]) {
  if (providerEntityIds.length === 0) {
    return 0;
  }
  const rows = await database
    .select({ id: providerMappings.id })
    .from(providerMappings)
    .where(and(eq(providerMappings.provider, provider), eq(providerMappings.entityType, entityType), inArray(providerMappings.providerEntityId, providerEntityIds)));
  return rows.length;
}

async function main() {
  const options = parseRawPayloadReprocessArgs(process.argv.slice(2));
  validateRawPayloadReprocessOptions(options);
  const config = loadConfig();
  const readiness = await checkDatabaseReadiness({
    databaseUrl: config.DATABASE_URL,
    nodeEnv: config.NODE_ENV,
    dbExecutionTarget: config.DB_EXECUTION_TARGET,
    allowRemoteTestDb: config.ALLOW_REMOTE_TEST_DB,
    neonBranchName: config.NEON_BRANCH_NAME
  });
  if (readiness.status !== "ready") {
    throw new Error(`Database readiness check failed before raw payload reprocess.\n${formatDatabaseReadinessResult(readiness)}`);
  }

  const reprocessor = new RawProviderPayloadReprocessor(createDatabaseDependencies(config));
  const report = await reprocessor.run(options);
  console.log(JSON.stringify(report, null, 2));
}

function requiredFlagValue(flag: string, value: string) {
  if (!value) {
    throw new Error(`Raw payload reprocess requires ${flag}=<value>.`);
  }
  return value;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function uniqueStrings(values: Array<string | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function sanitizeError(value: string | null | undefined) {
  return value?.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "<redacted-id>") ?? null;
}

const isDirectRun = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Raw payload reprocess failed.");
    process.exitCode = 1;
  });
}
