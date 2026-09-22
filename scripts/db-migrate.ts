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

  console.log("Ensuring initial football data seed and predictive features...");
  await seedInitialData(pool);
} catch (error) {
  console.error("Migration/seed failed:", error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
