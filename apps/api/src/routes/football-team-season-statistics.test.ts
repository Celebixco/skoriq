import { describe, expect, it } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { Database } from "@sports-data/database";
import { FootballCatalogService, mapTeamProfileIdentityRow } from "./football-catalog.service.js";
import type { TeamProfileIdentityRow } from "./football-catalog.service.js";
import { selectFootballTeamSeasonStatistics } from "./football-team-season-statistics.js";

const primary = { sofascoreTournamentId: 17, seasonName: "Premier League 26/27" };
const statistics = { matches: 5, goalsScored: 13, redCards: 0, goalsPrevented: -2.75 };
const scope = (overrides: Record<string, unknown> = {}) => ({
  statistics,
  provenance: { provider: "sofascore", providerTeamId: "17", tournamentId: "17", seasonId: "96668", seasonName: "Premier League 26/27", ...overrides }
});
const metadata = (scopes: unknown = { "17:96668": scope() }) => ({
  sofascoreId: 17, seasonStatistics: { matches: 1, goalsScored: 99 }, competitionSeasonStatistics: scopes
});

describe("verified primary-competition team season statistics", () => {
  it("selects the primary league instead of a cup or legacy flat snapshot", () => {
    const data = metadata({ "7:96518": scope({ tournamentId: "7", seasonId: "96518", seasonName: "UEFA Champions League 26/27" }), "17:96668": scope() });
    expect(selectFootballTeamSeasonStatistics(data, primary)).toEqual(statistics);
  });

  it("retains zero and signed metrics without filling missing measurements", () => {
    const result = selectFootballTeamSeasonStatistics(metadata(), primary);
    expect(result).toMatchObject({ redCards: 0, goalsPrevented: -2.75 });
    expect(result).not.toHaveProperty("corners");
  });

  it.each([
    { provider: "another" }, { providerTeamId: "18" }, { tournamentId: "7" },
    { seasonId: "96669" }, { seasonName: "Premier League 25/26" }, { seasonName: undefined }
  ])("refuses an unverifiable scope %#", (provenance) => {
    expect(selectFootballTeamSeasonStatistics(metadata({ "17:96668": scope(provenance) }), primary)).toBeNull();
  });

  it("refuses multiple matching seasons rather than choosing by insertion order", () => {
    expect(selectFootballTeamSeasonStatistics(metadata({ "17:96668": scope(), "17:96669": scope({ seasonId: "96669" }) }), primary)).toBeNull();
  });

  it("normalizes whitespace but does not infer the competition or season name", () => {
    expect(selectFootballTeamSeasonStatistics(metadata({ "17:96668": scope({ seasonName: " Premier   League 26/27 " }) }), primary)).toEqual(statistics);
    expect(selectFootballTeamSeasonStatistics(metadata(), { ...primary, seasonName: "26/27" })).toBeNull();
  });

  it.each([null, {}, [], { "7:96518": scope({ tournamentId: "7", seasonId: "96518" }) }])("does not fall back to flat data when scoped storage is present %#", (scopes) => {
    expect(selectFootballTeamSeasonStatistics(metadata(scopes), primary)).toBeNull();
  });

  it.each([{}, { matches: 0 }, { matches: 1.5 }, { matches: 5, shots: -1 }, { matches: 5, shots: Infinity }, { matches: 5, shots: "30" }])("refuses invalid scoped measurements %#", (invalid) => {
    expect(selectFootballTeamSeasonStatistics(metadata({ "17:96668": { ...scope(), statistics: invalid } }), primary)).toBeNull();
  });

  it("supports valid legacy camel and snake summaries only before scoped storage exists", () => {
    expect(selectFootballTeamSeasonStatistics({ seasonStatistics: statistics }, null)).toEqual(statistics);
    expect(selectFootballTeamSeasonStatistics({ season_statistics: statistics }, null)).toEqual(statistics);
    expect(selectFootballTeamSeasonStatistics({ seasonStatistics: [] }, null)).toBeNull();
  });

  it("requires verified primary competition metadata and a stable provider team identity", () => {
    expect(selectFootballTeamSeasonStatistics(metadata(), null)).toBeNull();
    expect(selectFootballTeamSeasonStatistics({ ...metadata(), sofascoreId: undefined }, primary)).toBeNull();
  });

  it("loads primary competition metadata through the identity query and keeps the profile contract", async () => {
    const row: TeamProfileIdentityRow = { team_id: "existing-team", name: "Manchester City", logo_url: null, country: "England",
      primary_competition_id: "existing-league", primary_competition_name: "Premier League", primary_competition_country: "England",
      metadata_json: metadata(), primary_competition_metadata_json: primary };
    const statements: { sql: string; params: unknown[] }[] = [];
    const database = { execute: async (query: SQL) => { statements.push(new PgDialect().sqlToQuery(query)); return { rows: [row] }; } } as unknown as Database;
    const service = new FootballCatalogService(database) as unknown as { findTeamProfileIdentity(teamId: string): Promise<TeamProfileIdentityRow> };
    const identity = await service.findTeamProfileIdentity("existing-team");
    expect(statements[0]?.sql).toContain("c.metadata_json as competition_metadata_json");
    expect(statements[0]?.sql).toContain("pc.competition_metadata_json as primary_competition_metadata_json");
    expect(statements[0]?.params).toEqual(["existing-team"]);
    const profile = mapTeamProfileIdentityRow(identity);
    expect(profile).toMatchObject({ id: "existing-team", primaryCompetition: { id: "existing-league", name: "Premier League" }, seasonStatistics: statistics });
    expect(profile).not.toHaveProperty("primary_competition_metadata_json");
  });
});
