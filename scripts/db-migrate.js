import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

async function main() {
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
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Unhandled error in db-migrate:", err);
  process.exit(1);
});
