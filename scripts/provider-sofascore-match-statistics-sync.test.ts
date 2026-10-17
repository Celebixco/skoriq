import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseMatchStatisticsArgs, runMatchStatisticsSync } from "./provider-sofascore-match-statistics-sync.js";

const captureMatch = {
  eventId: 16483697,
  homeTeamId: 3052,
  awayTeamId: 6362,
  statistics: {
    home: { possessionPercent: 59, shotsTotal: 24, shotsOnTarget: 7, expectedGoals: 3.77, passes: 532, accuratePasses: 476, passAccuracyPercent: 89.47 },
    away: { possessionPercent: 41, shotsTotal: 13, shotsOnTarget: 5, expectedGoals: 0.99, passes: 365, accuratePasses: 313, passAccuracyPercent: 85.75 }
  }
};

describe("SofaScore match statistics importer", () => {
  it("parses capture and execute flags", () => {
    expect(parseMatchStatisticsArgs(["--capture=stats.json", "--execute", "--no-log-run"])).toEqual({ execute: true, capturePath: "stats.json" });
    expect(() => parseMatchStatisticsArgs([])).toThrow("--capture");
  });

  it("upserts both team rows with mapped statistics and metadata", async () => {
    const data = await fixture();
    const report = await runMatchStatisticsSync({ execute: true, capturePath: data.capturePath }, data.dependencies);

    expect(report).toMatchObject({ mode: "execute", matches: 1, writtenMatches: 1, counts: { updated: 1 } });
    expect(data.writes).toHaveLength(2);
    const home = data.writes[0]!;
    expect(home.text).toContain("INSERT INTO football_match_team_statistics");
    expect(home.text).toContain("ON CONFLICT (match_id, team_id)");
    expect(home.params.slice(0, 7)).toEqual(["match-1", "home-1", "away-1", true, 59, 24, 7]);
    const metadata = JSON.parse(String(home.params.at(-1))) as Record<string, unknown>;
    expect(metadata).toMatchObject({ source: "sofascore", providerEventId: 16483697, providerHomeTeamId: 3052 });
    const away = data.writes[1]!;
    expect(away.params.slice(0, 5)).toEqual(["match-1", "away-1", "home-1", false, 41]);
  });

  it("does not write in dry-run mode", async () => {
    const data = await fixture();
    const report = await runMatchStatisticsSync({ execute: false, capturePath: data.capturePath }, data.dependencies);
    expect(report.counts).toMatchObject({ planned: 1 });
    expect(data.writes).toHaveLength(0);
  });

  it("skips unknown matches and mismatched provider teams", async () => {
    const unknown = await fixture({ matchRow: null });
    expect((await runMatchStatisticsSync({ execute: true, capturePath: unknown.capturePath }, unknown.dependencies)).counts).toMatchObject({ unknown_match: 1 });
    expect(unknown.writes).toHaveLength(0);

    const mismatch = await fixture({ mappings: [
      { internal_entity_id: "home-1", provider_entity_id: "9999" },
      { internal_entity_id: "away-1", provider_entity_id: "8888" }
    ] });
    expect((await runMatchStatisticsSync({ execute: true, capturePath: mismatch.capturePath }, mismatch.dependencies)).counts).toMatchObject({ team_mismatch: 1 });
    expect(mismatch.writes).toHaveLength(0);
  });

  it("swaps sides when the provider event ordering is inverted", async () => {
    const data = await fixture({
      capture: { ...captureMatch, homeTeamId: 6362, awayTeamId: 3052 },
      mappings: [
        { internal_entity_id: "home-1", provider_entity_id: "3052" },
        { internal_entity_id: "away-1", provider_entity_id: "6362" }
      ]
    });
    await runMatchStatisticsSync({ execute: true, capturePath: data.capturePath }, data.dependencies);
    expect(data.writes[0]!.params.slice(0, 5)).toEqual(["match-1", "home-1", "away-1", true, 41]);
    expect(data.writes[1]!.params.slice(0, 5)).toEqual(["match-1", "away-1", "home-1", false, 59]);
  });
});

async function fixture(options: { matchRow?: unknown; mappings?: unknown[]; capture?: typeof captureMatch } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "skoriq-match-stats-"));
  const capturePath = join(directory, "capture.json");
  await writeFile(capturePath, JSON.stringify({
    source: "sofascore-match-statistics",
    capturedAt: "2026-10-18T00:00:00.000Z",
    matches: [options.capture ?? captureMatch]
  }));
  const writes: Array<{ text: string; params: unknown[] }> = [];
  const matchRow = options.matchRow === undefined
    ? { id: "match-1", home_team_id: "home-1", away_team_id: "away-1" }
    : options.matchRow;  const mappings = options.mappings ?? [
    { internal_entity_id: "home-1", provider_entity_id: "3052" },
    { internal_entity_id: "away-1", provider_entity_id: "6362" }
  ];
  const database = {
    query: async (text: string, params: unknown[] = []) => {
      if (text.includes("FROM matches m")) return { rows: matchRow ? [matchRow] : [] };
      if (text.includes("FROM provider_mappings")) return { rows: mappings };
      if (text.includes("INSERT INTO football_match_team_statistics")) {
        writes.push({ text, params });
        return { rows: [] };
      }
      return { rows: [] };
    }
  };
  return {
    capturePath,
    writes,
    dependencies: { env: { DATABASE_URL: "postgres://user:pass@localhost:5432/sports_data" }, database }
  };
}
