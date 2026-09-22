import "dotenv/config";
import pg from "pg";
import { seedInitialData } from "./db-seed.js";

async function run() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is required.");
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
  try {
    await seedInitialData(pool);
  } finally {
    await pool.end();
  }
}

run().catch(console.error);
