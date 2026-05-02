import { formatTestDatabaseCommandError, migrateTestDatabase } from "./test-database.js";

try {
  await migrateTestDatabase();
  console.log("Applied migrations to TEST_DATABASE_URL.");
} catch (error) {
  console.error(formatTestDatabaseCommandError(error, "apply migrations"));
  process.exitCode = 1;
}
