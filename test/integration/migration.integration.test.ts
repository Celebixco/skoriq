import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { teams } from "@sports-data/database";
import { clearPublicTables, createIntegrationDatabase } from "../../scripts/test-database.js";
import { createRepositorySet, isUniqueViolation } from "./integration-test-helpers.js";

const integrationDatabase = createIntegrationDatabase();

describe("PostgreSQL migration compatibility", () => {
  beforeAll(async () => {
    await clearPublicTables(integrationDatabase.db);
  });

  beforeEach(async () => {
    await clearPublicTables(integrationDatabase.db);
  });

  afterAll(async () => {
    await integrationDatabase.close();
  });

  it("enables pgcrypto-backed UUID generation", async () => {
    const uuidResult = await integrationDatabase.db.execute<{ generated_id: string }>(sql`select gen_random_uuid()::text as generated_id`);
    const extensionResult = await integrationDatabase.db.execute<{ extname: string }>(sql`
      select extname
      from pg_extension
      where extname = 'pgcrypto'
    `);

    expect(uuidResult.rows[0]?.generated_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(extensionResult.rows[0]?.extname).toBe("pgcrypto");
  });

  it("enforces UNIQUE NULLS NOT DISTINCT constraints on nullable keys", async () => {
    const repositories = createRepositorySet(integrationDatabase.db);
    const sport = await repositories.sports.upsertSport({ slug: "football", name: "Football" });
    const teamA = await integrationDatabase.db.insert(teams).values({ sportId: sport.id, name: "Team A", slug: "team-a" }).returning();
    const teamB = await integrationDatabase.db.insert(teams).values({ sportId: sport.id, name: "Team B", slug: "team-b" }).returning();

    await integrationDatabase.db.execute(sql`
      insert into head_to_head_features (team_a_id, team_b_id, as_of_match_id, features_json)
      values (${teamA[0]?.id}, ${teamB[0]?.id}, null, '{}'::jsonb)
    `);

    try {
      await integrationDatabase.db.execute(sql`
        insert into head_to_head_features (team_a_id, team_b_id, as_of_match_id, features_json)
        values (${teamA[0]?.id}, ${teamB[0]?.id}, null, '{}'::jsonb)
      `);
      throw new Error("Expected duplicate nullable unique insert to fail.");
    } catch (error) {
      expect(isUniqueViolation(error)).toBe(true);
    }
  });
});
