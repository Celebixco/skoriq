import "dotenv/config";
import { pathToFileURL } from "node:url";
import pg from "pg";

const localHosts = new Set(["localhost", "127.0.0.1", "::1", "postgres", "postgres-test"]);
const productionNamePattern = /(^|[-_.])(?:main|prod|production)(?:[-_.]|$)/i;
const expectedTables = [
  "raw_provider_payloads",
  "provider_mappings",
  "sports",
  "countries",
  "competitions",
  "teams",
  "matches",
  "football_match_scores",
  "football_standings"
] as const;

export type DatabaseExecutionTarget = "local" | "neon-test";
export type DatabaseClassification = "local" | "neon-test" | "remote-unsafe" | "unknown";
export type DatabaseReadinessStatus = "ready" | "not_ready";
export type DatabaseReadinessReason = "missing_url" | "unsafe_target" | "connection_refused" | "auth_failed" | "database_missing" | "migrations_missing" | "query_failed";

export interface SafeDatabaseTarget {
  host: string;
  port: string;
  database: string;
  ssl: "yes" | "no" | "unknown";
  classification: DatabaseClassification;
  neonBranchName?: string;
}

export interface DatabaseReadinessResult {
  status: DatabaseReadinessStatus;
  target?: SafeDatabaseTarget;
  reason?: DatabaseReadinessReason;
  message: string;
  missingTables?: string[];
}

export interface CheckDatabaseReadinessOptions {
  databaseUrl?: string;
  nodeEnv?: string;
  dbExecutionTarget?: string;
  allowRemoteTestDb?: string | boolean;
  neonBranchName?: string;
  connect?: (databaseUrl: string) => Promise<DatabaseProbeResult>;
}

export interface DatabaseProbeResult {
  tableNames: string[];
}

export async function checkDatabaseReadiness(options: CheckDatabaseReadinessOptions = {}): Promise<DatabaseReadinessResult> {
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV;
  const dbExecutionTarget = options.dbExecutionTarget ?? process.env.DB_EXECUTION_TARGET ?? "local";
  const allowRemoteTestDb = normalizeBoolean(options.allowRemoteTestDb ?? process.env.ALLOW_REMOTE_TEST_DB);
  const neonBranchName = options.neonBranchName ?? process.env.NEON_BRANCH_NAME;

  if (!databaseUrl) {
    return {
      status: "not_ready",
      reason: "missing_url",
      message: "DATABASE_URL is required."
    };
  }

  const target = parseSafeDatabaseTarget(databaseUrl, { dbExecutionTarget, allowRemoteTestDb, neonBranchName });
  const targetSafetyError = validateTargetSafety(target, { dbExecutionTarget, allowRemoteTestDb, neonBranchName, databaseUrl });
  if (targetSafetyError) {
    return {
      status: "not_ready",
      target,
      reason: "unsafe_target",
      message: targetSafetyError
    };
  }

  if (nodeEnv === "production" && target.classification !== "neon-test") {
    return {
      status: "not_ready",
      target,
      reason: "unsafe_target",
      message: "Database readiness checks refuse NODE_ENV=production unless the target is an explicitly approved Neon test branch."
    };
  }

  try {
    const probe = await (options.connect ?? defaultProbe)(databaseUrl);
    const missingTables = expectedTables.filter((tableName) => !probe.tableNames.includes(tableName));
    if (missingTables.length > 0) {
      return {
        status: "not_ready",
        target,
        reason: "migrations_missing",
        message: `Database is reachable, but expected tables are missing. Run migrations before ingestion.`,
        missingTables
      };
    }

    return {
      status: "ready",
      target,
      message: "Database is reachable and expected tables exist."
    };
  } catch (error) {
    return {
      status: "not_ready",
      target,
      reason: classifyDatabaseError(error),
      message: formatDatabaseReadinessError(error)
    };
  }
}

export function parseSafeDatabaseTarget(
  databaseUrl: string,
  options: { dbExecutionTarget?: string; allowRemoteTestDb?: boolean; neonBranchName?: string } = {}
): SafeDatabaseTarget {
  const parsed = new URL(databaseUrl);
  const sslValue = parsed.searchParams.get("sslmode") ?? parsed.searchParams.get("ssl");
  const database = parsed.pathname.replace(/^\//, "");
  const host = parsed.hostname;
  const classification = classifyDatabaseUrl(parsed, databaseUrl, options);

  return {
    host,
    port: parsed.port || "5432",
    database,
    ssl: sslValue ? sslModeToLabel(sslValue) : "unknown",
    classification,
    neonBranchName: options.neonBranchName || undefined
  };
}

export function formatDatabaseReadinessResult(result: DatabaseReadinessResult): string {
  return JSON.stringify(
    {
      status: result.status,
      target: result.target,
      reason: result.reason,
      message: result.message,
      missingTables: result.missingTables
    },
    null,
    2
  );
}

async function defaultProbe(databaseUrl: string): Promise<DatabaseProbeResult> {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 1
  });

  try {
    await pool.query("select 1");
    const tables = await pool.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public'"
    );
    return {
      tableNames: tables.rows.map((row) => row.table_name)
    };
  } finally {
    await pool.end();
  }
}

function classifyDatabaseUrl(
  parsed: URL,
  rawUrl: string,
  options: { dbExecutionTarget?: string; allowRemoteTestDb?: boolean; neonBranchName?: string }
): DatabaseClassification {
  const normalized = rawUrl.toLowerCase();
  const isNeon = looksLikeNeon(parsed, rawUrl);

  if (localHosts.has(parsed.hostname)) {
    return "local";
  }

  if (isNeon) {
    return options.dbExecutionTarget === "neon-test" && options.allowRemoteTestDb ? "neon-test" : "remote-unsafe";
  }

  if (/prod|production|supabase|railway|render|amazonaws|azure|gcp|cloud/.test(normalized)) {
    return "remote-unsafe";
  }

  return "unknown";
}

function validateTargetSafety(
  target: SafeDatabaseTarget,
  options: { dbExecutionTarget: string; allowRemoteTestDb: boolean; neonBranchName?: string; databaseUrl: string }
): string | undefined {
  const parsed = new URL(options.databaseUrl);
  const isNeon = looksLikeNeon(parsed, options.databaseUrl);

  if (target.classification === "local") {
    return undefined;
  }

  if (isNeon) {
    if (options.dbExecutionTarget !== "neon-test") {
      return "DATABASE_URL looks like Neon. Set DB_EXECUTION_TARGET=neon-test for an explicitly approved Neon test branch.";
    }

    if (!options.allowRemoteTestDb) {
      return "Neon test branch execution requires ALLOW_REMOTE_TEST_DB=true.";
    }

    if (looksProductionLike(parsed, options.neonBranchName)) {
      return "DATABASE_URL or NEON_BRANCH_NAME looks like main/prod/production. Refusing Neon production/main targets.";
    }

    return undefined;
  }

  if (target.classification === "remote-unsafe") {
    return "DATABASE_URL looks like a production or remote managed database. Refusing by default.";
  }

  return "DATABASE_URL is remote or unknown. Only local databases or explicitly approved Neon test branches are allowed.";
}

function looksLikeNeon(parsed: URL, rawUrl: string): boolean {
  return parsed.hostname.includes("neon.tech") || /neon/i.test(rawUrl);
}

function looksProductionLike(parsed: URL, neonBranchName: string | undefined): boolean {
  const database = parsed.pathname.replace(/^\//, "");
  const candidates = [database, parsed.hostname, neonBranchName ?? ""];
  return candidates.some((value) => productionNamePattern.test(value));
}

function normalizeBoolean(value: string | boolean | undefined): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  return value === "true";
}

function sslModeToLabel(value: string): SafeDatabaseTarget["ssl"] {
  const normalized = value.toLowerCase();
  if (["1", "true", "require", "verify-ca", "verify-full"].includes(normalized)) {
    return "yes";
  }

  if (["0", "false", "disable"].includes(normalized)) {
    return "no";
  }

  return "unknown";
}

function classifyDatabaseError(error: unknown): DatabaseReadinessReason {
  const code = errorCode(error);
  if (code === "ECONNREFUSED") {
    return "connection_refused";
  }

  if (code === "28P01" || code === "28000") {
    return "auth_failed";
  }

  if (code === "3D000") {
    return "database_missing";
  }

  return "query_failed";
}

function formatDatabaseReadinessError(error: unknown): string {
  const reason = classifyDatabaseError(error);
  switch (reason) {
    case "connection_refused":
      return "Could not connect to DATABASE_URL. Start local PostgreSQL or point DATABASE_URL at a disposable local database.";
    case "auth_failed":
      return "DATABASE_URL authentication failed. Check local PostgreSQL username and password.";
    case "database_missing":
      return "DATABASE_URL database does not exist. Create the local database before running ingestion.";
    case "query_failed":
    case "missing_url":
    case "unsafe_target":
    case "migrations_missing":
      return error instanceof Error ? error.message : "Database readiness query failed.";
  }
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  if ("code" in error && typeof error.code === "string") {
    return error.code;
  }

  if ("cause" in error) {
    return errorCode(error.cause);
  }

  return undefined;
}

const isDirectRun = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (isDirectRun) {
  checkDatabaseReadiness()
    .then((result) => {
      console.log(formatDatabaseReadinessResult(result));
      if (result.status !== "ready") {
        process.exitCode = 1;
      }
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : "Database readiness check failed.");
      process.exitCode = 1;
    });
}
