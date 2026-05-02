import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import * as schema from "../packages/database/src/schema.js";

const allowedLocalHosts = new Set(["localhost", "127.0.0.1", "::1", "postgres-test"]);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsFolder = path.join(repoRoot, "packages/database/migrations");

export type IntegrationDatabase = ReturnType<typeof createIntegrationDatabase>;

export function getSafeTestDatabaseUrl(): string {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;
  if (!testDatabaseUrl) {
    throw new Error("TEST_DATABASE_URL is required for integration database commands.");
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("Integration database commands are forbidden when NODE_ENV=production.");
  }

  if (process.env.DATABASE_URL && normalizeUrl(testDatabaseUrl) === normalizeUrl(process.env.DATABASE_URL)) {
    throw new Error("TEST_DATABASE_URL must not equal DATABASE_URL.");
  }

  const parsed = new URL(testDatabaseUrl);
  if (!allowedLocalHosts.has(parsed.hostname)) {
    throw new Error(`TEST_DATABASE_URL must point to a local disposable PostgreSQL host. Refusing host "${parsed.hostname}".`);
  }

  if (parsed.hostname.includes("neon.tech")) {
    throw new Error("TEST_DATABASE_URL must never point at Neon or any production database.");
  }

  const databaseName = parsed.pathname.replace(/^\//, "");
  if (!databaseName || !databaseName.includes("test")) {
    throw new Error(`TEST_DATABASE_URL database name must clearly be a test database. Refusing database "${databaseName}".`);
  }

  return testDatabaseUrl;
}

export function createIntegrationDatabase(databaseUrl = getSafeTestDatabaseUrl()) {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 3
  });
  const db = drizzle(pool, { schema });

  return {
    db,
    pool,
    async close() {
      await pool.end();
    }
  };
}

export async function migrateTestDatabase(databaseUrl = getSafeTestDatabaseUrl()) {
  const integrationDatabase = createIntegrationDatabase(databaseUrl);
  try {
    await migrate(integrationDatabase.db, { migrationsFolder });
  } finally {
    await integrationDatabase.close();
  }
}

export async function resetTestDatabase(databaseUrl = getSafeTestDatabaseUrl()) {
  const integrationDatabase = createIntegrationDatabase(databaseUrl);
  try {
    await integrationDatabase.db.execute(sql`drop schema if exists drizzle cascade`);
    await integrationDatabase.db.execute(sql`drop schema if exists public cascade`);
    await integrationDatabase.db.execute(sql`create schema public`);
  } finally {
    await integrationDatabase.close();
  }
}

export async function clearPublicTables(database: IntegrationDatabase["db"]) {
  const rows = await database.execute<{ tablename: string }>(sql`
    select tablename
    from pg_tables
    where schemaname = 'public'
  `);
  const tableNames = rows.rows.map((row) => row.tablename).filter((tableName) => tableName !== "__drizzle_migrations");

  if (tableNames.length === 0) {
    return;
  }

  const quotedTables = tableNames.map((tableName) => `"public"."${tableName.replaceAll('"', '""')}"`).join(", ");
  await database.execute(sql.raw(`truncate table ${quotedTables} restart identity cascade`));
}

export function formatTestDatabaseCommandError(error: unknown, operation: string): string {
  if (hasErrorCode(error, "ECONNREFUSED")) {
    return `Could not connect to TEST_DATABASE_URL while trying to ${operation}. Start local test PostgreSQL with "npm run docker:test:up" or point TEST_DATABASE_URL at a disposable local PostgreSQL database.`;
  }

  return error instanceof Error ? error.message : `Unknown integration database error while trying to ${operation}.`;
}

function normalizeUrl(value: string): string {
  const parsed = new URL(value);
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

function hasErrorCode(error: unknown, code: string): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  if ("code" in error && error.code === code) {
    return true;
  }

  if ("cause" in error && hasErrorCode(error.cause, code)) {
    return true;
  }

  if ("errors" in error && Array.isArray(error.errors)) {
    return error.errors.some((nestedError) => hasErrorCode(nestedError, code));
  }

  return false;
}
