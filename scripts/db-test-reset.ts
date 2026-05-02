import { formatTestDatabaseCommandError, resetTestDatabase } from "./test-database.js";

try {
  await resetTestDatabase();
  console.log("Reset local integration test database schema.");
} catch (error) {
  console.error(formatTestDatabaseCommandError(error, "reset schema"));
  process.exitCode = 1;
}
