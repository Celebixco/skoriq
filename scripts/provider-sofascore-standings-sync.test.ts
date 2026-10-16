import { describe, expect, it } from "vitest";
import { parseSofaScoreStandingsArgs, runSofaScoreStandingsSync } from "./provider-sofascore-standings-sync.js";
import type { SofaScoreStandingsDependencies } from "./provider-sofascore-standings-sync.js";

const env = { DATABASE_URL: "postgres://postgres:postgres@localhost:5432/sports_data" };

function row(overrides: Record<string, unknown> = {}) {
  return { position: 1, team_id: 101, played: 8, wins: 6, draws: 1, losses: 1, goals_for: 18, goals_against: 6, points: 19, form: "WWDWL", ...overrides };
}

function capture(rows: unknown[] = [row()]) {
  return { source: "sofascore-standings", capturedAt: "2026-10-16T12:00:00.000Z",
           tournaments: [{ sofascore_tournament_id: 52, season_id: 98080, standings: rows }] };
}

const existingStanding = [{ id: "standing-1", position: 1, played: 7, wins: 5, draws: 1, losses: 1, goals_for: 15, goals_against: 6, points: 16 }];

interface FixtureOptions {
  env?: NodeJS.ProcessEnv;
  captureDocument?: unknown;
  competitionRows?: unknown[];
  seasonRows?: unknown[];
  teamRows?: (providerTeamId: string) => unknown[];
  existingRows?: unknown[];
  loggingFailure?: boolean;
}

function fixture(options: FixtureOptions = {}) {
  const writes: { text: string; params: unknown[] }[] = [];
  const reads: string[] = [];
  const dependencies: SofaScoreStandingsDependencies = {
    env: options.env ?? env,
    now: () => new Date("2026-10-16T12:00:00.000Z"),
    readCapture: async () => options.captureDocument ?? capture(),
    database: {
      async query(text: string, params: unknown[] = []) {
        if (/FROM provider_mappings pm\s+JOIN competitions c/.test(text)) {
          reads.push(text);
          return { rows: options.competitionRows ?? [{ id: "comp-1" }] };
        }
        if (/FROM seasons/.test(text)) {
          reads.push(text);
          return { rows: options.seasonRows ?? [{ id: "season-1" }] };
        }
        if (/pm\.entity_type = 'team'/.test(text)) {
          reads.push(text);
          const providerTeamId = String(params[0]);
          if (options.teamRows) return { rows: options.teamRows(providerTeamId) };
          return { rows: [{ kind: "metadata", id: `team-${providerTeamId}`, team_exists: true }] };
        }
        if (/FROM football_standings s/.test(text)) {
          reads.push(text);
          return { rows: options.existingRows ?? [] };
        }
        writes.push({ text, params });
        if (/INSERT INTO sync_jobs/.test(text)) {
          if (options.loggingFailure) throw new Error("sync job logging is down");
          return { rows: [{ id: "job-1" }] };
        }
        if (/UPDATE sync_jobs/.test(text)) return { rows: [{ id: "job-1" }] };
        if (/INSERT INTO football_standings/.test(text) || /UPDATE football_standings/.test(text)) return { rows: [{ id: "standing-1" }] };
        return { rows: [] };
      }
    }
  };
  return { dependencies, reads, writes };
}

describe("SofaScore standings refresh", () => {
  it("defaults to dry-run and requires a capture", () => {
    expect(parseSofaScoreStandingsArgs(["--capture", "c.json"])).toEqual({ execute: false, capturePath: "c.json", logRun: true });
    expect(() => parseSofaScoreStandingsArgs([])).toThrow(/capture/i);
    expect(() => parseSofaScoreStandingsArgs(["--capture", "c.json", "--nope"])).toThrow(/unknown/i);
  });

  it("validates captures without a database", async () => {
    const data = fixture({ env: {} });
    const report = await runSofaScoreStandingsSync({ execute: false, capturePath: "c.json", logRun: true }, data.dependencies);
    expect(report.entries[0]).toMatchObject({ providerTeamId: "101", action: "capture_validated" });
    expect(data.writes).toHaveLength(0);
  });

  it("plans an update without writing in dry-run", async () => {
    const data = fixture({ existingRows: existingStanding });
    const report = await runSofaScoreStandingsSync({ execute: false, capturePath: "c.json", logRun: false }, data.dependencies);
    expect(report.entries[0]).toMatchObject({ action: "planned_update" });
    expect(data.writes).toHaveLength(0);
  });

  it("keeps identical rows unchanged", async () => {
    const same = [{ ...existingStanding[0], played: 8, wins: 6, goals_for: 18, points: 19 }];
    const data = fixture({ existingRows: same });
    const report = await runSofaScoreStandingsSync({ execute: true, capturePath: "c.json", logRun: false }, data.dependencies);
    expect(report.entries[0]).toMatchObject({ action: "unchanged" });
    expect(data.writes).toHaveLength(0);
  });

  it("executes the guarded upsert on update", async () => {
    const data = fixture({ existingRows: existingStanding });
    const report = await runSofaScoreStandingsSync({ execute: true, capturePath: "c.json", logRun: false }, data.dependencies);
    expect(report.entries[0]).toMatchObject({ action: "updated" });
    const update = data.writes.find((write) => /UPDATE football_standings/.test(write.text));
    expect(update?.text).toMatch(/IS DISTINCT FROM/);
    expect(update?.params.slice(0, 13)).toEqual(["comp-1", "season-1", "team-101", 1, 8, 6, 1, 1, 18, 6, 12, 19, JSON.stringify({ sofascore: true, form: "WWDWL" })]);
  });

  it("inserts a missing standing row on execute", async () => {
    const data = fixture({ existingRows: [] });
    const report = await runSofaScoreStandingsSync({ execute: true, capturePath: "c.json", logRun: false }, data.dependencies);
    expect(report.entries[0]).toMatchObject({ action: "inserted" });
    const insert = data.writes.find((write) => /INSERT INTO football_standings/.test(write.text));
    expect(insert?.text).toContain("football_standings_competition_season_team_uidx");
  });

  it("skips unresolvable identities", async () => {
    const cases: Array<[FixtureOptions, string]> = [
      [{ competitionRows: [] }, "unknown_competition"],
      [{ seasonRows: [] }, "unknown_season"],
      [{ teamRows: () => [] }, "unknown_team"],
      [{ teamRows: () => [{ kind: "metadata", id: "a", team_exists: true }, { kind: "metadata", id: "b", team_exists: true }] }, "identity_conflict"]
    ];
    for (const [options, reason] of cases) {
      const data = fixture({ existingRows: existingStanding, ...options });
      const report = await runSofaScoreStandingsSync({ execute: true, capturePath: "c.json", logRun: false }, data.dependencies);
      expect(report.entries[0]).toMatchObject({ action: "skipped", reason });
      expect(data.writes).toHaveLength(0);
    }
  });

  it("memoizes competition resolution across rows", async () => {
    const data = fixture({ existingRows: existingStanding, captureDocument: capture([row(), row({ team_id: 202 })]) });
    await runSofaScoreStandingsSync({ execute: false, capturePath: "c.json", logRun: false }, data.dependencies);
    const competitionReads = data.reads.filter((text) => /from provider_mappings pm\s+join competitions/i.test(text));
    expect(competitionReads).toHaveLength(1);
  });

  it("records run rows and tolerates logging failures", async () => {
    const data = fixture({ existingRows: existingStanding });
    const report = await runSofaScoreStandingsSync({ execute: false, capturePath: "c.json", logRun: true }, data.dependencies);
    expect(report.syncJobLogged).toBe(true);
    const begin = data.writes.find((write) => /INSERT INTO sync_jobs/.test(write.text));
    expect(begin?.params[0]).toBe("standings-sync");
    expect(begin?.params[1]).toBe("sofascore.standings");
    const failing = fixture({ existingRows: existingStanding, loggingFailure: true });
    const failingReport = await runSofaScoreStandingsSync({ execute: false, capturePath: "c.json", logRun: true }, failing.dependencies);
    expect(failingReport.syncJobLogged).toBe(false);
    expect(failingReport.loggingError).toBe("sync job logging is down");
    expect(failingReport.entries[0]).toMatchObject({ action: "planned_update" });
  });

  it("bounds a wedged row with a timeout and keeps processing", async () => {
    let lookups = 0;
    const data = fixture({ captureDocument: capture([row(), row({ team_id: 202 })]) });
    data.dependencies.database = {
      async query(text: string, params: unknown[] = []) {
        if (/FROM provider_mappings pm\s+JOIN competitions/.test(text)) return { rows: [{ id: "comp-1" }] };
        if (/FROM seasons/.test(text)) return { rows: [{ id: "season-1" }] };
        if (/pm\.entity_type = 'team'/.test(text)) return { rows: [{ kind: "metadata", id: `team-${params[0]}`, team_exists: true }] };
        if (/FROM football_standings s/.test(text)) {
          lookups++;
          if (lookups === 1) return new Promise(() => {});
          return { rows: existingStanding };
        }
        return { rows: [] };
      }
    };
    data.dependencies.rowTimeoutMs = 50;
    const report = await runSofaScoreStandingsSync({ execute: false, capturePath: "c.json", logRun: false }, data.dependencies);
    expect(report.entries[0]).toMatchObject({ action: "query_failed" });
    expect(report.entries[1]).toMatchObject({ action: "planned_update" });
  });

  it.each([
    [{ source: "other", capturedAt: "2026-10-16T12:00:00.000Z", tournaments: [] }, /source/i],
    [{ source: "sofascore-standings", capturedAt: "nope", tournaments: [] }, /capturedAt/i],
    [capture([row({ position: 99 })]), /position/i],
    [capture([row({ played: -1 })]), /played/i],
    [{ source: "sofascore-standings", capturedAt: "2026-10-16T12:00:00.000Z", tournaments: [{ sofascore_tournament_id: 52, standings: [] }] }, /no importable/i]
  ])("rejects malformed captures %#", async (captureDocument, pattern) => {
    const data = fixture({ captureDocument });
    await expect(runSofaScoreStandingsSync({ execute: false, capturePath: "c.json", logRun: false }, data.dependencies)).rejects.toThrow(pattern);
  });
});
