import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { seedInitialData } from "./db-seed.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required to run migrations.");
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(__dirname, "../packages/database/migrations");

console.log(`Applying Drizzle migrations from: ${migrationsFolder}`);

const pool = new pg.Pool({
  connectionString: databaseUrl,
  max: 2
});

const db = drizzle(pool);

try {
  await migrate(db, { migrationsFolder });
  console.log("Migrations successfully applied to database.");

  // Check if matches exist or SEED_INITIAL_DATA is requested
  const matchesCountRes = await pool.query("SELECT count(*)::int as c FROM matches");
  const matchesCount = matchesCountRes.rows[0]?.c ?? 0;
  const shouldSeed = matchesCount === 0 || process.env.SEED_INITIAL_DATA === "true";

  if (shouldSeed) {
    console.log(`Database has ${matchesCount} matches. Running initial seed...`);
    await seedInitialData(pool);
  } else {
    const adminEmail = (process.env.ADMIN_EMAIL || "admin@skoriq.local").trim().toLowerCase();
    await pool.query("UPDATE users SET role = 'admin', status = 'active', updated_at = now() WHERE lower(email) = $1", [adminEmail]);
    console.log(`Admin user ${adminEmail} promoted to admin.`);
  }
} catch (error) {
  console.error("Migration/seed failed:", error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
