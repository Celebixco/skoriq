import { loadConfig } from "@sports-data/config";
import { createDatabase } from "@sports-data/database";
import type { Database } from "@sports-data/database";
import { sql } from "drizzle-orm";
import { hashPassword } from "../apps/api/src/auth/password.js";

export interface AdminBootstrapEnv {
  NODE_ENV?: string;
  ADMIN_EMAIL?: string;
  ADMIN_PASSWORD?: string;
}

export interface AdminBootstrapResult {
  email: string;
  action: "created" | "updated";
}

export async function createOrUpdateAdmin(database: Database, env: AdminBootstrapEnv = process.env): Promise<AdminBootstrapResult> {
  if (env.NODE_ENV === "production") {
    throw new Error("auth:create-admin refuses NODE_ENV=production.");
  }
  const email = normalizeAdminEmail(env.ADMIN_EMAIL);
  const password = env.ADMIN_PASSWORD;
  if (!email) {
    throw new Error("ADMIN_EMAIL is required.");
  }
  if (!password || password.length < 12) {
    throw new Error("ADMIN_PASSWORD is required and must be at least 12 characters.");
  }

  const passwordHash = await hashPassword(password);
  const existing = await executeRows<{ id: string }>(database, sql`select id from users where email = ${email} limit 1`);
  if (existing[0]) {
    await database.execute(
      sql`
        update users
        set password_hash = ${passwordHash},
            role = 'admin',
            status = 'active',
            updated_at = now()
        where email = ${email}
      `
    );
    return { email, action: "updated" };
  }

  await database.execute(
    sql`
      insert into users (email, password_hash, role, status)
      values (${email}, ${passwordHash}, 'admin', 'active')
    `
  );
  return { email, action: "created" };
}

function normalizeAdminEmail(value: string | undefined) {
  return value?.trim().toLowerCase();
}

async function executeRows<T>(database: Database, query: ReturnType<typeof sql>): Promise<T[]> {
  const result = await database.execute(query);
  if (Array.isArray(result)) {
    return result as T[];
  }
  if (result && typeof result === "object" && "rows" in result && Array.isArray(result.rows)) {
    return result.rows as T[];
  }
  return [];
}

async function main() {
  const config = loadConfig();
  const database = createDatabase(config.DATABASE_URL);
  const result = await createOrUpdateAdmin(database);
  console.log(`Admin user ${result.action}: ${result.email}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Failed to create admin user.");
    process.exitCode = 1;
  });
}
