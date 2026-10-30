import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(), release: vi.fn(), end: vi.fn(), connect: vi.fn(),
  resolveCompetitionScope: vi.fn(), featureVector: vi.fn(), torkFeaturesFor: vi.fn()
}));

// These are isolated runner tests: no environment files, model files, database,
// providers or production prediction algorithms are read or executed.
vi.mock("dotenv/config", () => ({}));
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(async (path: string) => JSON.stringify(path.endsWith("football-rc-model.json") ? {
    modelVersion: "rc-test", displayVersion: "Trey", models: { "R-C": { modelHash: "rc-hash" } }
  } : {
    modelVersion: "tork-test", displayVersion: "Tork", tuning: {}, weights: {}, leagueConstants: {},
    globalFallback: { btts: 0.5, gfHome: 1.5, gfAway: 1.2 }
  }))
}));
vi.mock("pg", () => ({
  default: {
    Pool: vi.fn(function () {
      return { connect: mocks.connect, end: mocks.end };
    })
  }
}));
vi.mock("./football-rc-scope.js", () => ({ resolveCompetitionScope: mocks.resolveCompetitionScope }));
vi.mock("./football-rc-prematch.js", () => ({
  validateModelArtifact: vi.fn(), featureVector: mocks.featureVector,
  applyPreprocessor: vi.fn(() => [0]), predict: vi.fn(() => [0.5, 0.3, 0.2]), pick: vi.fn(() => "home")
}));
vi.mock("./football-tork-prematch.js", () => ({
  validateModelArtifact: vi.fn(), leagueKeyFor: vi.fn(() => ({ key: "test-league", constants: {} })),
  torkFeaturesFor: mocks.torkFeaturesFor, scopeLevelFor: vi.fn(() => "team_history"),
  predictTork: vi.fn(() => ({ pBtts: 0.6, expectedBttsGoals: 1.7, pick: "btts_yes" }))
}));

import { runEnginesBackfill } from "./football-engines-backfill.js";

type Engine = "rc" | "tork";
interface StoredPrediction {
  matchId: string;
  modelVersion: string;
  evaluationGroup: string;
  status: string;
  metadata: Record<string, unknown>;
}

const originalArgv = process.argv;
let predictions: Record<Engine, Map<string, StoredPrediction>>;
let results: Record<Engine, Map<string, { outcome: string }>>;
let log: ReturnType<typeof vi.spyOn>;

function key(matchId: string, version: string): string {
  return `${matchId}|${version}`;
}

function seed(engine: Engine, matchId: string, evaluationGroup = "live_prematch") {
  const version = `${engine}-test`;
  predictions[engine].set(key(matchId, version), {
    matchId, modelVersion: version, evaluationGroup, status: "published",
    metadata: { original: true, probabilities: [0.123, 0.877] }
  });
  results[engine].set(matchId, { outcome: "won" });
}

function snapshot() {
  return structuredClone({ predictions, results });
}

function lastReport(): Record<string, unknown> {
  return JSON.parse(String(log.mock.calls.at(-1)?.[0])) as Record<string, unknown>;
}

function target(matchId: string) {
  return {
    match_id: matchId, competition_id: "competition-1", competition_name: "Test League",
    country: "", season: "2026", kickoff_at: new Date("2026-01-01T12:00:00Z"), status: "finished",
    home_id: "home", home_team: "Home", away_id: "away", away_team: "Away",
    home_score: 1, away_score: 1, home_ht: 0, away_ht: 0,
    home_extra: null, away_extra: null, home_pen: null, away_pen: null
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-02-01T00:00:00Z"));
  vi.stubEnv("DATABASE_URL", "postgresql://test.invalid/unit-test-never-connects");
  process.argv = [originalArgv[0]!, "unit-test", "--execute", "--tork-only"];
  predictions = { rc: new Map(), tork: new Map() };
  results = { rc: new Map(), tork: new Map() };
  log = vi.spyOn(console, "log").mockImplementation(() => {});
  mocks.connect.mockResolvedValue({ query: mocks.query, release: mocks.release });
  mocks.end.mockResolvedValue(undefined);
  mocks.resolveCompetitionScope.mockResolvedValue({ approved: [{ competitionId: "competition-1" }] });
  mocks.featureVector.mockReturnValue({ features: { form: 1 }, homeN: 4, awayN: 4, scope: "team_history" });
  mocks.torkFeaturesFor.mockReturnValue({ features: { form: 1 }, homeN: 4, awayN: 4, lambdaHome: 1.5, lambdaAway: 1.2 });
  mocks.query.mockImplementation(async (sql: string, values: unknown[] = []) => {
    const normalized = sql.trim().replace(/\s+/g, " ");
    if (/^(begin|commit|rollback)$/i.test(normalized)) return { rows: [], rowCount: 0 };
    // Fail closed: a future deletion/update or results write immediately fails these tests.
    if (/\b(delete|truncate|update|drop|alter)\b/i.test(normalized)) throw new Error(`destructive query: ${normalized}`);
    if (normalized.startsWith("select count(*)")) {
      return { rows: [{ n: String([...predictions.rc.values()].filter((row) => row.evaluationGroup === values[0]).length) }], rowCount: 1 };
    }
    if (normalized.startsWith("select m.id as match_id")) {
      expect(values).toEqual([["competition-1"], "2025-08-01"]);
      return { rows: [target("live-existing"), target("simulation-existing"), target("missing")], rowCount: 3 };
    }
    const insert = /^insert into football_(rc|tork)_prematch_predictions\b/.exec(normalized);
    if (insert) {
      expect(normalized).toContain("on conflict (match_id, model_id, model_version) do nothing");
      const engine = insert[1] as Engine;
      const matchId = String(values[0]);
      const modelVersion = String(values[2]);
      const id = key(matchId, modelVersion);
      if (predictions[engine].has(id)) return { rows: [], rowCount: 0 };
      const evaluationGroup = String(values.at(-2));
      const metadata = JSON.parse(String(values.at(-1))) as Record<string, unknown>;
      expect(evaluationGroup).toBe("simulation_backfill");
      expect(metadata.simulation).toBe(true);
      predictions[engine].set(id, { matchId, modelVersion, evaluationGroup, metadata, status: "published" });
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`unexpected query: ${normalized}`);
  });
});

afterEach(() => {
  process.argv = originalArgv;
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("append-only football engines backfill", () => {
  it("Tork-only preserves all existing published predictions and settlements, appending only missing simulations", async () => {
    for (const engine of ["rc", "tork"] as const) {
      seed(engine, "live-existing");
      seed(engine, "simulation-existing", "simulation_backfill");
    }
    const before = snapshot();

    await runEnginesBackfill();

    expect(predictions.rc).toEqual(before.predictions.rc);
    expect(results).toEqual(before.results);
    for (const [id, row] of before.predictions.tork) expect(predictions.tork.get(id)).toEqual(row);
    expect(predictions.tork.size).toBe(3);
    expect(predictions.tork.get(key("missing", "tork-test"))).toMatchObject({
      evaluationGroup: "simulation_backfill", metadata: { simulation: true }
    });
    expect(mocks.featureVector).not.toHaveBeenCalled();
    expect(lastReport()).toMatchObject({
      mode: "engines-backfill", execute: true, torkOnly: true,
      deleted: { rcResults: 0, rcPredictions: 0 }, inserted: { rc: 0, tork: 1 }
    });
    expect(mocks.query).toHaveBeenLastCalledWith("commit");
    expect(mocks.release).toHaveBeenCalledOnce();
    expect(mocks.end).toHaveBeenCalledOnce();
  });

  it("Tork-only is idempotent when rerun after a model rule change", async () => {
    seed("tork", "live-existing");
    seed("tork", "simulation-existing", "simulation_backfill");
    await runEnginesBackfill();
    const afterFirstRun = snapshot();
    mocks.torkFeaturesFor.mockReturnValue({ features: { changedRule: 9 }, homeN: 8, awayN: 8, lambdaHome: 2, lambdaAway: 2 });

    await runEnginesBackfill();

    expect(snapshot()).toEqual(afterFirstRun);
    expect(lastReport()).toMatchObject({ inserted: { rc: 0, tork: 0 } });
  });

  it("full mode preserves Trey and Tork live history while appending missing simulations", async () => {
    process.argv = [originalArgv[0]!, "unit-test", "--execute"];
    seed("rc", "live-existing");
    seed("tork", "live-existing");
    seed("tork", "simulation-existing", "simulation_backfill");
    const before = snapshot();

    await runEnginesBackfill();

    expect(results).toEqual(before.results);
    for (const engine of ["rc", "tork"] as const) {
      for (const [id, row] of before.predictions[engine]) expect(predictions[engine].get(id)).toEqual(row);
      expect(predictions[engine].size).toBe(3);
    }
    expect(lastReport()).toMatchObject({ torkOnly: false, deleted: { rcResults: 0, rcPredictions: 0 }, inserted: { rc: 2, tork: 1 } });
  });

  it("retains the full-mode already-backfilled guard without modifying either engine", async () => {
    process.argv = [originalArgv[0]!, "unit-test", "--execute"];
    seed("rc", "simulation-existing", "simulation_backfill");
    seed("tork", "live-existing");
    const before = snapshot();

    await runEnginesBackfill();

    expect(snapshot()).toEqual(before);
    expect(lastReport()).toMatchObject({ mode: "engines-backfill", skipped: "already_backfilled", existing: 1 });
    expect(mocks.query).toHaveBeenLastCalledWith("rollback");
    expect(mocks.torkFeaturesFor).not.toHaveBeenCalled();
  });

  it("requires explicit execution before creating a database connection", async () => {
    process.argv = [originalArgv[0]!, "unit-test", "--tork-only"];

    await expect(runEnginesBackfill()).rejects.toThrow("--execute is required");

    expect(mocks.connect).not.toHaveBeenCalled();
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("rolls back and releases resources when history loading fails", async () => {
    seed("tork", "live-existing");
    const before = snapshot();
    const normalQuery = mocks.query.getMockImplementation()!;
    mocks.query.mockImplementation(async (sql: string, values: unknown[] = []) => {
      if (sql.includes("select m.id as match_id")) throw new Error("history unavailable");
      return normalQuery(sql, values);
    });

    await expect(runEnginesBackfill()).rejects.toThrow("history unavailable");

    expect(snapshot()).toEqual(before);
    expect(mocks.query).toHaveBeenLastCalledWith("rollback");
    expect(mocks.release).toHaveBeenCalledOnce();
    expect(mocks.end).toHaveBeenCalledOnce();
  });
});
