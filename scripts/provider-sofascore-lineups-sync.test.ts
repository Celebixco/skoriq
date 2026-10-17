import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseLineupsArgs, runLineupsSync } from "./provider-sofascore-lineups-sync.js";

const capture = {
  source: "sofascore-lineups",
  capturedAt: "2026-10-18T00:00:00.000Z",
  matches: [{
    eventId: 16483697,
    homeTeamId: 3052,
    awayTeamId: 6362,
    lineups: {
      confirmed: true,
      home: {
        formation: "4-2-3-1",
        players: [
          { playerId: 254491, name: "Ederson", position: "G", shirtNumber: 31, substitute: false, orderIndex: 0, rating: 8.6 },
          { playerId: 1001, name: "Home Substitute", position: "M", shirtNumber: 10, substitute: true, orderIndex: 1, rating: null }
        ]
      },
      away: {
        formation: "4-4-2",
        players: [
          { playerId: 2001, name: "Away Player", position: "D", shirtNumber: 4, substitute: false, orderIndex: 0, rating: 7.1 }
        ]
      }
    }
  }]
};

describe("SofaScore lineups importer", () => {
  it("parses capture and execute flags", () => {
    expect(parseLineupsArgs(["--capture=lineups.json", "--execute", "--no-log-run"])).toEqual({ execute: true, capturePath: "lineups.json" });
    expect(() => parseLineupsArgs([])).toThrow("--capture");
  });

  it("upserts both lineups and only creates unknown players", async () => {
    const data = await fixture();
    const report = await runLineupsSync({ execute: true, capturePath: data.capturePath }, data.dependencies);

    expect(report).toMatchObject({ mode: "execute", matches: 1, writtenMatches: 1, playersInserted: 2, counts: { updated: 1 } });
    expect(data.lineups).toHaveLength(2);
    expect(data.deletedLineups).toEqual(["lineup-1", "lineup-2"]);
    expect(data.lineupPlayers).toHaveLength(3);
    expect(data.lineupPlayers[0]).toMatchObject({ role: "starting", position: "G", shirtNumber: 31, orderIndex: 0 });
    expect(data.lineupPlayers[1]).toMatchObject({ role: "substitute", shirtNumber: 10 });
    expect(data.playerInserts).toHaveLength(2);
    expect(data.playerInserts[0]!.name).toBe("Home Substitute");
    expect(data.mappings).toHaveLength(2);
  });

  it("does not write in dry-run mode", async () => {
    const data = await fixture();
    const report = await runLineupsSync({ execute: false, capturePath: data.capturePath }, data.dependencies);
    expect(report.counts).toMatchObject({ planned: 1 });
    expect(data.lineups).toHaveLength(0);
    expect(data.playerInserts).toHaveLength(0);
  });

  it("skips unknown matches and mismatched provider teams", async () => {
    const unknown = await fixture({ matchRow: null });
    expect((await runLineupsSync({ execute: true, capturePath: unknown.capturePath }, unknown.dependencies)).counts).toMatchObject({ unknown_match: 1 });
    expect(unknown.lineups).toHaveLength(0);

    const mismatch = await fixture({ mappings: [
      { internal_entity_id: "home-1", provider_entity_id: "9999" },
      { internal_entity_id: "away-1", provider_entity_id: "8888" }
    ] });
    expect((await runLineupsSync({ execute: true, capturePath: mismatch.capturePath }, mismatch.dependencies)).counts).toMatchObject({ team_mismatch: 1 });
    expect(mismatch.lineups).toHaveLength(0);
  });

  it("swaps provider sides when the event ordering is inverted", async () => {
    const data = await fixture({
      capture: { ...capture, matches: [{ ...capture.matches[0]!, homeTeamId: 6362, awayTeamId: 3052 }] }
    });
    await runLineupsSync({ execute: true, capturePath: data.capturePath }, data.dependencies);
    expect(data.lineups[0]).toMatchObject({ teamId: "home-1", formation: "4-4-2" });
    expect(data.lineups[1]).toMatchObject({ teamId: "away-1", formation: "4-2-3-1" });
  });
});

async function fixture(options: { matchRow?: unknown; mappings?: unknown[]; capture?: typeof capture } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "skoriq-lineups-"));
  const capturePath = join(directory, "capture.json");
  await writeFile(capturePath, JSON.stringify(options.capture ?? capture));
  const lineups: Array<Record<string, unknown>> = [];
  const deletedLineups: string[] = [];
  const lineupPlayers: Array<Record<string, unknown>> = [];
  const playerInserts: Array<{ name: string }> = [];
  const mappings: Array<Record<string, unknown>> = [];
  let lineupCounter = 0;
  let playerCounter = 0;
  const matchRow = options.matchRow === undefined ? { id: "match-1", home_team_id: "home-1", away_team_id: "away-1" } : options.matchRow;
  const teamMappings = options.mappings ?? [
    { internal_entity_id: "home-1", provider_entity_id: "3052" },
    { internal_entity_id: "away-1", provider_entity_id: "6362" }
  ];
  const database = {
    query: async (text: string, params: unknown[] = []) => {
      if (text === "BEGIN" || text === "COMMIT" || text === "ROLLBACK") return { rows: [] };
      if (text.includes("INSERT INTO football_match_lineup_players")) {
        const [matchLineupId, matchId, teamId, playerId, role, position, shirtNumber, orderIndex] = params;
        lineupPlayers.push({ matchLineupId, matchId, teamId, playerId, role, position, shirtNumber, orderIndex });
        return { rows: [] };
      }
      if (text.includes("DELETE FROM football_match_lineup_players")) {
        deletedLineups.push(String(params[0]));
        return { rows: [] };
      }
      if (text.includes("INSERT INTO football_match_lineups")) {
        const lineup = { id: `lineup-${++lineupCounter}`, teamId: params[1], formation: params[2] };
        lineups.push(lineup);
        return { rows: [{ id: lineup.id }] };
      }
      if (text.includes("INSERT INTO players")) {
        playerCounter += 1;
        playerInserts.push({ name: String(params[2]) });
        return { rows: [{ id: `new-player-${playerCounter}` }] };
      }
      if (text.includes("INSERT INTO provider_mappings")) {
        mappings.push({ providerEntityId: params[0], playerId: params[1] });
        return { rows: [] };
      }
      if (text.includes("FROM sports")) return { rows: [{ id: "sport-1" }] };
      if (text.includes("FROM matches m")) return { rows: matchRow ? [matchRow] : [] };
      if (text.includes("entity_type = 'team'")) return { rows: teamMappings };
      if (text.includes("entity_type = 'player'")) {
        return { rows: params[0] === "254491" ? [{ id: "existing-player" }] : [] };
      }
      return { rows: [] };
    }
  };
  return {
    capturePath,
    lineups,
    deletedLineups,
    lineupPlayers,
    playerInserts,
    mappings,
    dependencies: { env: { DATABASE_URL: "postgres://user:pass@localhost:5432/sports_data" }, database }
  };
}
