import fs from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import type pg from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { seedInitialData as seedTypeScript } from "./db-seed.ts";
import { seedInitialData as seedJavaScript } from "./db-seed.js";

const localTestUrl = "postgres://postgres:postgres@localhost:55432/sports_data_test";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function allowLocalTestRebuild() {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("DATABASE_URL", localTestUrl);
  vi.stubEnv("DB_EXECUTION_TARGET", "local");
  vi.stubEnv("ALLOW_DESTRUCTIVE_SEED", "true");
  vi.stubEnv("FORCE_SEED", "true");
  vi.spyOn(console, "log").mockImplementation(() => undefined);
}

describe.each([
  ["TypeScript", seedTypeScript],
  ["JavaScript", seedJavaScript]
])("legacy %s seed safety", (_name, seed) => {
  it.each([
    ["production", { NODE_ENV: "production" }, localTestUrl, /production/i],
    ["remote managed target", { DB_EXECUTION_TARGET: "neon-test", ALLOW_REMOTE_TEST_DB: "true" }, "postgres://user:password@branch.neon.tech/sports_data_test", /local/i],
    ["non-disposable local database", {}, "postgres://postgres:postgres@localhost/sports_data", /disposable/i],
    ["production-named local database", {}, "postgres://postgres:postgres@localhost/sports_data_test_prod", /disposable/i],
    ["missing rebuild consent", { ALLOW_DESTRUCTIVE_SEED: "false" }, localTestUrl, /ALLOW_DESTRUCTIVE_SEED/i],
    ["missing explicit local target", { DB_EXECUTION_TARGET: "" }, localTestUrl, /DB_EXECUTION_TARGET/i],
    ["connection host override", {}, `${localTestUrl}?host=remote.example.com`, /override/i]
  ])("rejects %s before querying the supplied pool", async (_case, overrides, connectionString, message) => {
    allowLocalTestRebuild();
    for (const [key, value] of Object.entries(overrides)) vi.stubEnv(key, value);
    const query = vi.fn().mockRejectedValue(new Error("Unexpected database operation"));
    const pool = { options: { connectionString }, query } as unknown as pg.Pool;

    await expect(seed(pool)).rejects.toThrow(message);
    expect(query).not.toHaveBeenCalled();
  });

  it("checks the actual pool target even when the environment names an allowed database", async () => {
    allowLocalTestRebuild();
    const query = vi.fn().mockRejectedValue(new Error("Unexpected database operation"));
    const pool = { options: { connectionString: "postgres://user:password@remote.example.com/sports_data_test" }, query } as unknown as pg.Pool;

    await expect(seed(pool)).rejects.toThrow(/local/i);
    expect(query).not.toHaveBeenCalled();
  });

  it("allows a consenting disposable local rebuild without creating or changing users", async () => {
    allowLocalTestRebuild();
    // An empty catalog keeps this regression focused on seed side effects, with no provider access.
    vi.spyOn(fs, "readFileSync").mockReturnValue("[]");
    const statements: string[] = [];
    const pool = {
      options: { connectionString: localTestUrl },
      async query(statement: string) {
        statements.push(statement);
        if (statement.includes("SELECT count(*)")) return { rows: [{ count: "0" }] };
        if (statement.includes("INSERT INTO sports")) return { rows: [{ id: "football" }] };
        return { rows: [] };
      }
    } as unknown as pg.Pool;

    await seed(pool);

    expect(statements.some((sql) => /TRUNCATE TABLE/i.test(sql))).toBe(true);
    expect(statements.some((sql) => /\busers\b/i.test(sql))).toBe(false);
  });
});

const pythonAvailable = spawnSync("python", ["--version"]).status === 0;

it.skipIf(!pythonAvailable)("daemon refuses an unsafe rebuild before any provider subprocess starts", () => {
  const script = [
    "import importlib.util, json, os, subprocess, types",
    "spec = importlib.util.spec_from_file_location('legacy_daemon', 'scripts/sofascore_sync_daemon.py')",
    "daemon = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(daemon)",
    "original_run = subprocess.run",
    "provider_calls = []",
    "def controlled_run(command, **kwargs):",
    "    if command[0] in ('node', 'node.exe'):",
    "        return original_run(command, **kwargs)",
    "    provider_calls.append(command)",
    "    return types.SimpleNamespace(returncode=0, stdout='fixture only', stderr='')",
    "daemon.subprocess.run = controlled_run",
    "result = daemon.run_sync()",
    "print(json.dumps({'result': result, 'providerCalls': len(provider_calls)}))"
  ].join("\n");
  const output = execFileSync("python", ["-c", script], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, NODE_ENV: "production", DATABASE_URL: localTestUrl, DB_EXECUTION_TARGET: "local", ALLOW_DESTRUCTIVE_SEED: "true", FORCE_SEED: "true" }
  });

  expect(JSON.parse(output.trim().split("\n").at(-1)!)).toEqual({ result: false, providerCalls: 0 });
});
