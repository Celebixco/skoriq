import { describe, expect, it } from "vitest";
import {
  checkDatabaseReadiness,
  parseSafeDatabaseTarget
} from "./db-readiness.js";

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
];

describe("database readiness checks", () => {
  it("sanitizes connection targets without credentials", () => {
    const target = parseSafeDatabaseTarget("postgres://user:secret@localhost:5432/sports_data?sslmode=disable");

    expect(target).toEqual({
      host: "localhost",
      port: "5432",
      database: "sports_data",
      ssl: "no",
      classification: "local"
    });
    expect(JSON.stringify(target)).not.toContain("secret");
  });

  it("refuses Neon database URLs by default", async () => {
    const result = await checkDatabaseReadiness({
      databaseUrl: "postgres://user:secret@ep-test-branch.neon.tech/sports_data_test?sslmode=require",
      nodeEnv: "development",
      connect: async () => ({ tableNames: expectedTables })
    });

    expect(result).toMatchObject({
      status: "not_ready",
      reason: "unsafe_target",
      target: {
        classification: "remote-unsafe",
        host: "ep-test-branch.neon.tech",
        database: "sports_data_test",
        ssl: "yes"
      }
    });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("allows Neon only with explicit neon-test flags", async () => {
    const result = await checkDatabaseReadiness({
      databaseUrl: "postgres://user:secret@ep-review-123.neon.tech/sports_data_test?sslmode=require",
      nodeEnv: "development",
      dbExecutionTarget: "neon-test",
      allowRemoteTestDb: "true",
      neonBranchName: "apifootball-manual-ingest-test",
      connect: async () => ({ tableNames: expectedTables })
    });

    expect(result).toMatchObject({
      status: "ready",
      target: {
        classification: "neon-test",
        host: "ep-review-123.neon.tech",
        database: "sports_data_test",
        ssl: "yes",
        neonBranchName: "apifootball-manual-ingest-test"
      }
    });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("allows production runtime checks only for explicitly approved Neon test targets", async () => {
    const result = await checkDatabaseReadiness({
      databaseUrl: "postgres://user:secret@ep-review-123.neon.tech/sports_data_test?sslmode=require",
      nodeEnv: "production",
      dbExecutionTarget: "neon-test",
      allowRemoteTestDb: "true",
      neonBranchName: "skoriq-ingestion-test",
      connect: async () => ({ tableNames: expectedTables })
    });

    expect(result).toMatchObject({
      status: "ready",
      target: {
        classification: "neon-test",
        neonBranchName: "skoriq-ingestion-test"
      }
    });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("still blocks production runtime checks for local targets", async () => {
    const result = await checkDatabaseReadiness({
      databaseUrl: "postgres://postgres:postgres@localhost:5432/sports_data",
      nodeEnv: "production",
      connect: async () => ({ tableNames: expectedTables })
    });

    expect(result).toMatchObject({
      status: "not_ready",
      reason: "unsafe_target",
      target: {
        classification: "local"
      }
    });
  });

  it("blocks production or main-looking Neon targets even with explicit flags", async () => {
    const result = await checkDatabaseReadiness({
      databaseUrl: "postgres://user:secret@ep-main.neon.tech/production?sslmode=require",
      nodeEnv: "development",
      dbExecutionTarget: "neon-test",
      allowRemoteTestDb: "true",
      neonBranchName: "main",
      connect: async () => ({ tableNames: expectedTables })
    });

    expect(result).toMatchObject({
      status: "not_ready",
      reason: "unsafe_target",
      target: {
        classification: "neon-test"
      }
    });
  });

  it("blocks unknown remote databases", async () => {
    const result = await checkDatabaseReadiness({
      databaseUrl: "postgres://user:secret@db.example.internal/sports_data",
      nodeEnv: "development",
      connect: async () => ({ tableNames: expectedTables })
    });

    expect(result).toMatchObject({
      status: "not_ready",
      reason: "unsafe_target",
      target: {
        classification: "unknown"
      }
    });
  });

  it("reports missing migration tables", async () => {
    const result = await checkDatabaseReadiness({
      databaseUrl: "postgres://postgres:postgres@localhost:5432/sports_data",
      nodeEnv: "development",
      connect: async () => ({ tableNames: ["sports"] })
    });

    expect(result).toMatchObject({
      status: "not_ready",
      reason: "migrations_missing"
    });
    expect(result.missingTables).toContain("raw_provider_payloads");
  });

  it("classifies ECONNREFUSED clearly", async () => {
    const error = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    const result = await checkDatabaseReadiness({
      databaseUrl: "postgres://postgres:postgres@localhost:5432/sports_data",
      nodeEnv: "development",
      connect: async () => {
        throw error;
      }
    });

    expect(result).toMatchObject({
      status: "not_ready",
      reason: "connection_refused"
    });
  });

  it("passes when local database is reachable and expected tables exist", async () => {
    const result = await checkDatabaseReadiness({
      databaseUrl: "postgres://postgres:postgres@localhost:5432/sports_data",
      nodeEnv: "development",
      connect: async () => ({ tableNames: expectedTables })
    });

    expect(result).toMatchObject({
      status: "ready",
      message: "Database is reachable and expected tables exist."
    });
  });
});
