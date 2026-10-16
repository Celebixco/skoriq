import { describe, expect, it } from "vitest";
import { parseSofaScoreMatchesArgs, runSofaScoreMatchesSync } from "./provider-sofascore-matches-sync.js";
import type { SofaScoreMatchesDependencies } from "./provider-sofascore-matches-sync.js";

const NOW = new Date("2026-10-16T12:00:00.000Z");
const RECENT_TS = Math.floor(Date.parse("2026-10-15T18:00:00.000Z") / 1000);
const FUTURE_TS = Math.floor(Date.parse("2026-10-20T18:00:00.000Z") / 1000);
const env = { DATABASE_URL: "postgres://postgres:postgres@localhost:5432/sports_data" };

function event(overrides: Record<string, unknown> = {}) {
  return {
    sofascore_id: 6001,
    start_timestamp: RECENT_TS,
    status_type: "finished",
    round: 7,
    home_team_id: 101,
    away_team_id: 202,
    home_score: 2,
    away_score: 1,
    home_score_halftime: 1,
    away_score_halftime: 0,
    ...overrides
  };
}

function capture(events: unknown[] = [event()]) {
  return {
    source: "sofascore",
    capturedAt: "2026-10-16T12:00:00.000Z",
    tournaments: [{ sofascore_tournament_id: 52, season_id: 98080, season_detected: false, events }]
  };
}

interface FixtureOptions {
  env?: NodeJS.ProcessEnv;
  captureDocument?: unknown;
  competitionRows?: unknown[];
  seasonRows?: unknown[];
  teamRows?: (providerTeamId: string) => unknown[];
  matchRows?: unknown[];
  updateRows?: unknown[];
  loggingFailure?: boolean;
}

const scheduledExisting = [{
  id: "match-1",
  status: "scheduled",
  winner_team_id: null,
  metadata_json: { sofascoreId: 6001, statistics: { someMetric: 12 } },
  home_score_current: null,
  away_score_current: null,
  home_score_halftime: null,
  away_score_halftime: null
}];

function fixture(options: FixtureOptions = {}) {
  const reads: string[] = [];
  const writes: { text: string; params: unknown[] }[] = [];
  const dependencies: SofaScoreMatchesDependencies = {
    env: options.env ?? env,
    now: () => NOW,
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
          return { rows: providerTeamId === "101"
            ? [{ kind: "mapping", id: "home-team", internal_entity_type: "team", team_exists: true }]
            : [{ kind: "metadata", id: "away-team", team_exists: true }] };
        }
        if (/FROM matches m/.test(text)) {
          reads.push(text);
          return { rows: options.matchRows ?? [] };
        }
        writes.push({ text, params });
        if (/INSERT INTO sync_jobs/.test(text)) {
          if (options.loggingFailure) throw new Error("sync job logging is down");
          return { rows: [{ id: "job-1" }] };
        }
        if (/UPDATE sync_jobs/.test(text)) return { rows: [{ id: "job-1" }] };
        if (/UPDATE matches/.test(text)) return { rows: options.updateRows ?? [{ id: "match-1" }] };
        if (/INSERT INTO matches/.test(text)) return { rows: [{ id: "match-new" }] };
        return { rows: [] };
      }
    }
  };
  return { dependencies, reads, writes };
}

describe("SofaScore finished matches refresh", () => {
  it("defaults to dry-run and requires an explicit capture file", () => {
    expect(parseSofaScoreMatchesArgs(["--capture", "capture.json"])).toEqual({ execute: false, capturePath: "capture.json", logRun: true });
    expect(parseSofaScoreMatchesArgs(["--capture=reviewed.json", "--execute", "--no-log-run"])).toEqual({ execute: true, capturePath: "reviewed.json", logRun: false });
    expect(() => parseSofaScoreMatchesArgs([])).toThrow(/capture/i);
    expect(() => parseSofaScoreMatchesArgs(["--capture", "x.json", "--bogus"])).toThrow(/unknown/i);
  });

  it("validates a capture without a database configuration", async () => {
    const data = fixture({ env: {} });
    const report = await runSofaScoreMatchesSync({ execute: false, capturePath: "capture.json", logRun: true }, data.dependencies);
    expect(report.entries).toEqual([expect.objectContaining({ providerMatchId: "6001", action: "capture_validated" })]);
    expect(report.databaseConfigured).toBe(false);
    expect(data.writes).toHaveLength(0);
    expect(data.reads).toHaveLength(0);
  });

  it("plans an update for an existing scheduled match without writing in dry-run", async () => {
    const data = fixture({ matchRows: scheduledExisting });
    const report = await runSofaScoreMatchesSync({ execute: false, capturePath: "capture.json", logRun: false }, data.dependencies);
    expect(report.entries[0]).toMatchObject({ action: "planned_update", matchId: "match-1" });
    expect(data.writes).toHaveLength(0);
  });

  it("flips status to finished, merges metadata and upserts scores on execute", async () => {
    const data = fixture({ matchRows: scheduledExisting });
    const report = await runSofaScoreMatchesSync({ execute: true, capturePath: "capture.json", logRun: false }, data.dependencies);
    expect(report.entries[0]).toMatchObject({ action: "updated", matchId: "match-1" });
    const update = data.writes.find((write) => /UPDATE matches/.test(write.text));
    const scores = data.writes.find((write) => /INSERT INTO football_match_scores/.test(write.text));
    expect(update?.text).toMatch(/status = 'finished'/);
    expect(update?.text).toMatch(/\|\| \$3::jsonb/);
    expect(update?.params[1]).toBe("home-team");
    expect(JSON.parse(String(update?.params[2]))).toEqual({ sofascoreId: 6001, homeScore: 2, awayScore: 1, round: 7 });
    expect(scores?.params).toEqual(["match-1", "home-team", "away-team", "home-team", 2, 1, 1, 0]);
    expect(scores?.text).toMatch(/ON CONFLICT \(match_id\)/);
  });

  it("keeps an already-finished match with identical scores unchanged", async () => {
    const finished = [{ ...scheduledExisting[0], status: "finished", winner_team_id: "home-team", home_score_current: 2, away_score_current: 1, home_score_halftime: 1, away_score_halftime: 0 }];
    const data = fixture({ matchRows: finished });
    const report = await runSofaScoreMatchesSync({ execute: true, capturePath: "capture.json", logRun: false }, data.dependencies);
    expect(report.entries[0]).toMatchObject({ action: "unchanged", matchId: "match-1" });
    expect(data.writes).toHaveLength(0);
  });

  it("inserts a new finished match with the natural-key guard and writes scores", async () => {
    const data = fixture({ matchRows: [] });
    const report = await runSofaScoreMatchesSync({ execute: true, capturePath: "capture.json", logRun: false }, data.dependencies);
    expect(report.entries[0]).toMatchObject({ action: "inserted", matchId: "match-new" });
    const insert = data.writes.find((write) => /INSERT INTO matches/.test(write.text));
    expect(insert?.text).toMatch(/ON CONFLICT ON CONSTRAINT "matches_natural_uidx" DO NOTHING/);
    expect(insert?.params).toEqual(["comp-1", "season-1", 7, "home-team", "away-team", RECENT_TS, "home-team", JSON.stringify({ sofascoreId: 6001, homeScore: 2, awayScore: 1, round: 7 })]);
    expect(report.counts.inserted).toBe(1);
  });

  it("plans inserts in dry-run and skips future kickoffs", async () => {
    const data = fixture({ matchRows: [] });
    const planned = await runSofaScoreMatchesSync({ execute: false, capturePath: "capture.json", logRun: false }, data.dependencies);
    expect(planned.entries[0]).toMatchObject({ action: "planned_insert" });
    const future = fixture({ matchRows: [], captureDocument: capture([event({ start_timestamp: FUTURE_TS })]) });
    const skipped = await runSofaScoreMatchesSync({ execute: true, capturePath: "capture.json", logRun: false }, future.dependencies);
    expect(skipped.entries[0]).toMatchObject({ action: "skipped", reason: "future_kickoff" });
    expect(future.writes).toHaveLength(0);
  });

  it("reports a concurrent natural-key insert as insert_conflict without scores", async () => {
    const data = fixture({ matchRows: [] });
    data.dependencies.database = {
      async query(text: string, params: unknown[] = []) {
        if (/FROM matches m/.test(text)) return { rows: [] };
        if (/FROM provider_mappings pm\s+JOIN competitions/.test(text)) return { rows: [{ id: "comp-1" }] };
        if (/FROM seasons/.test(text)) return { rows: [{ id: "season-1" }] };
        if (/pm\.entity_type = 'team'/.test(text)) {
          return { rows: [{ kind: "metadata", id: "team-x", team_exists: true }] };
        }
        data.writes.push({ text, params });
        if (/INSERT INTO matches/.test(text)) return { rows: [] };
        if (/INSERT INTO sync_jobs/.test(text)) return { rows: [{ id: "job-1" }] };
        return { rows: [] };
      }
    };
    const report = await runSofaScoreMatchesSync({ execute: true, capturePath: "capture.json", logRun: false }, data.dependencies);
    expect(report.entries[0]).toMatchObject({ action: "skipped", reason: "insert_conflict" });
    expect(data.writes.some((write) => /football_match_scores/.test(write.text))).toBe(false);
  });

  it("skips events with unresolvable identities", async () => {
    const cases: Array<[FixtureOptions, string]> = [
      [{ competitionRows: [] }, "unknown_competition"],
      [{ competitionRows: [{ id: "comp-1" }, { id: "comp-2" }] }, "identity_conflict"],
      [{ seasonRows: [] }, "unknown_season"],
      [{ teamRows: () => [] }, "unknown_team"],
      [{ teamRows: (id) => id === "101" ? [{ kind: "mapping", id: "home-team", internal_entity_type: "team", team_exists: true }, { kind: "metadata", id: "other-home", team_exists: true }] : [{ kind: "metadata", id: "away-team", team_exists: true }] }, "identity_conflict"],
      [{ teamRows: (id) => id === "101" ? [{ kind: "mapping", id: "home-team", internal_entity_type: "team", team_exists: false }] : [{ kind: "metadata", id: "away-team", team_exists: true }] }, "identity_conflict"]
    ];
    for (const [options, reason] of cases) {
      const data = fixture({ matchRows: scheduledExisting, ...options });
      const report = await runSofaScoreMatchesSync({ execute: true, capturePath: "capture.json", logRun: false }, data.dependencies);
      expect(report.entries[0]).toMatchObject({ action: "skipped", reason });
      expect(data.writes).toHaveLength(0);
    }
  });

  it("derives no winner on a draw and passes null so the merge keeps any existing winner", async () => {
    const data = fixture({ matchRows: scheduledExisting, captureDocument: capture([event({ home_score: 1, away_score: 1 })]) });
    await runSofaScoreMatchesSync({ execute: true, capturePath: "capture.json", logRun: false }, data.dependencies);
    const update = data.writes.find((write) => /UPDATE matches/.test(write.text));
    expect(update?.params[1]).toBeNull();
    expect(update?.text).toMatch(/COALESCE\(\$2::uuid, winner_team_id\)/);
  });

  it("dedupes repeated provider event ids in a capture", async () => {
    const data = fixture({ matchRows: scheduledExisting, captureDocument: capture([event(), event()]) });
    const report = await runSofaScoreMatchesSync({ execute: false, capturePath: "capture.json", logRun: false }, data.dependencies);
    expect(report.entries).toHaveLength(1);
  });

  it.each([
    [{ source: "other", capturedAt: "2026-10-16T12:00:00.000Z", tournaments: [] }, /source/i],
    [{ source: "sofascore", capturedAt: "not-a-date", tournaments: [] }, /capturedAt/i],
    [capture([event({ status_type: "inprogress" })]), /finished/i],
    [capture([event({ home_score: 99 })]), /scores/i],
    [capture([event({ home_team_id: 0 })]), /home team id/i],
    [{ source: "sofascore", capturedAt: "2026-10-16T12:00:00.000Z", tournaments: [{ sofascore_tournament_id: 52, season_id: 98080, events: [] }] }, /no importable events/i]
  ])("rejects malformed captures %#", async (captureDocument, pattern) => {
    const data = fixture({ captureDocument });
    await expect(runSofaScoreMatchesSync({ execute: false, capturePath: "capture.json", logRun: false }, data.dependencies)).rejects.toThrow(pattern);
    expect(data.writes).toHaveLength(0);
  });

  it.each([
    { DATABASE_URL: undefined, execute: true },
    { DATABASE_URL: "https://localhost/db", execute: true },
    { DATABASE_URL: "postgres://user:pass@localhost/db?host=remote.example.com", execute: true }
  ])("refuses unsafe database configurations %#", async (environment) => {
    const data = fixture({ env: environment as NodeJS.ProcessEnv, matchRows: scheduledExisting });
    await expect(runSofaScoreMatchesSync({ execute: true, capturePath: "capture.json", logRun: false }, data.dependencies)).rejects.toThrow(/DATABASE_URL|override/i);
    expect(data.writes).toHaveLength(0);
  });

  it("records a sync run row in both modes when logging is enabled", async () => {
    const data = fixture({ matchRows: scheduledExisting });
    const report = await runSofaScoreMatchesSync({ execute: false, capturePath: "capture.json", logRun: true }, data.dependencies);
    expect(report.syncJobLogged).toBe(true);
    const begin = data.writes.find((write) => /INSERT INTO sync_jobs/.test(write.text));
    expect(begin?.text).toContain("'running'");
    expect(begin?.text).toMatch(/ON CONFLICT \(job_key\)/);
    const finish = data.writes.find((write) => /UPDATE sync_jobs/.test(write.text));
    expect(finish?.params[1]).toBe("succeeded");
    const log = data.writes.find((write) => /INSERT INTO sync_job_logs/.test(write.text));
    expect(log?.params[1]).toBe("info");
    expect(String(log?.params[2])).toMatch(/dry_run run/);
    expect(JSON.parse(String(log?.params[3]))).toMatchObject({ mode: "dry_run", counts: expect.objectContaining({ planned_update: 1 }) });
  });

  it("writes progress markers for long runs", async () => {
    const many = Array.from({ length: 250 }, (_, index) => event({ sofascore_id: 7000 + index }));
    const data = fixture({ matchRows: scheduledExisting, captureDocument: capture(many) });
    await runSofaScoreMatchesSync({ execute: false, capturePath: "capture.json", logRun: true }, data.dependencies);
    const progress = data.writes.filter((write) => /INSERT INTO sync_job_logs/.test(write.text) && String(write.params[2]).includes("import_progress"));
    expect(progress.length).toBeGreaterThanOrEqual(2);
  });

  it("bounds a wedged event with a timeout and keeps processing", async () => {
    const data = fixture({ matchRows: scheduledExisting, captureDocument: capture([event(), event({ sofascore_id: 6002 })]) });
    let matchLookups = 0;
    data.dependencies.database = {
      async query(text: string, params: unknown[] = []) {
        if (/FROM matches m/.test(text)) {
          matchLookups++;
          if (matchLookups === 1) return new Promise(() => {});
          return { rows: scheduledExisting };
        }
        if (/FROM provider_mappings pm\s+JOIN competitions/.test(text)) return { rows: [{ id: "comp-1" }] };
        if (/FROM seasons/.test(text)) return { rows: [{ id: "season-1" }] };
        if (/pm\.entity_type = 'team'/.test(text)) return { rows: [{ kind: "metadata", id: String(params[0]), team_exists: true }] };
        return { rows: [] };
      }
    };
    data.dependencies.eventTimeoutMs = 50;
    const report = await runSofaScoreMatchesSync({ execute: false, capturePath: "capture.json", logRun: false }, data.dependencies);
    expect(report.entries[0]).toMatchObject({ action: "event_timeout", providerMatchId: "6001" });
    expect(report.entries[1]).toMatchObject({ action: "planned_update", providerMatchId: "6002" });
  });

  it("keeps the refresh result when run logging fails", async () => {
    const data = fixture({ matchRows: scheduledExisting, loggingFailure: true });
    const report = await runSofaScoreMatchesSync({ execute: false, capturePath: "capture.json", logRun: true }, data.dependencies);
    expect(report.syncJobLogged).toBe(false);
    expect(report.loggingError).toBe("sync job logging is down");
    expect(report.entries[0]).toMatchObject({ action: "planned_update" });
  });

  it("records a per-event query failure without aborting the refresh or leaking diagnostics", async () => {
    const data = fixture({ matchRows: scheduledExisting });
    data.dependencies.database = {
      async query(text: string) {
        if (/FROM provider_mappings pm\s+JOIN competitions/.test(text)) return { rows: [{ id: "comp-1" }] };
        if (/FROM seasons/.test(text)) throw new Error("relation broken with sensitive details");
        return { rows: [] };
      }
    };
    const report = await runSofaScoreMatchesSync({ execute: true, capturePath: "capture.json", logRun: false }, data.dependencies);
    expect(report.entries[0]).toMatchObject({ action: "query_failed", reason: "query_failed" });
    expect(JSON.stringify(report)).not.toContain("sensitive");
  });

  it("memoizes identity resolution across events in one run", async () => {
    const second = event({ sofascore_id: 6002 });
    const data = fixture({ matchRows: scheduledExisting, captureDocument: capture([event(), second]) });
    const report = await runSofaScoreMatchesSync({ execute: false, capturePath: "capture.json", logRun: false }, data.dependencies);
    const teamReads = data.reads.filter((text) => /pm\.entity_type = 'team'/.test(text));
    const competitionReads = data.reads.filter((text) => /from provider_mappings pm\s+join competitions/i.test(text));
    const seasonReads = data.reads.filter((text) => /from seasons/i.test(text));
    expect(report.entries).toHaveLength(2);
    expect(teamReads).toHaveLength(2);
    expect(competitionReads).toHaveLength(1);
    expect(seasonReads).toHaveLength(1);
    expect(report.queriesExecuted).toBeGreaterThan(0);
  });
});
