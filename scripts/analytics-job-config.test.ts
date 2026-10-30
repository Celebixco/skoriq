import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { INTERVAL_JOBS, JOBS } from "./analytics-job-config.mjs";

describe("automatic analytics job configuration", () => {
  it("never schedules historical simulation backfills, including fresh-volume bootstrap jobs", () => {
    for (const job of [...JOBS, ...INTERVAL_JOBS]) {
      expect(job.key).not.toMatch(/backfill|rebuild/i);
      expect(job.script).not.toMatch(/backfill|rebuild/i);
      expect(job.args).not.toContain("--tork-only");
    }
    expect(JOBS.map((job) => job.key)).toEqual([
      "prematch", "finished-sync", "rc-prematch", "h1-prematch", "tork-prematch", "settlement", "model-shadow"
    ]);
    expect(INTERVAL_JOBS.map((job) => job.key)).toEqual([
      "settlement", "finished-sync-interval", "rc-prematch-interval", "h1-prematch-interval",
      "tork-prematch-interval", "rc-settlement", "h1-settlement", "tork-settlement"
    ]);
  });

  it("preserves production prediction and settlement script names, arguments and schedules", () => {
    for (const [engine, minute] of [["rc", 20], ["h1", 25], ["tork", 35]] as const) {
      expect(JOBS.find((job) => job.key === `${engine}-prematch`)).toEqual({
        key: `${engine}-prematch`, hour: 9, minute,
        script: `scripts/football-${engine}-prematch.ts`, args: ["--execute"], timeoutSeconds: 600
      });
      expect(INTERVAL_JOBS.find((job) => job.key === `${engine}-prematch-interval`)).toEqual({
        key: `${engine}-prematch-interval`, intervalMinutes: 360,
        script: `scripts/football-${engine}-prematch.ts`, args: ["--execute"], timeoutSeconds: 600
      });
      expect(INTERVAL_JOBS.find((job) => job.key === `${engine}-settlement`)).toEqual({
        key: `${engine}-settlement`, intervalMinutes: 15,
        script: `scripts/football-${engine}-settle.ts`, args: [], timeoutSeconds: 300
      });
    }
    expect(JOBS.find((job) => job.key === "settlement")).toEqual({
      key: "settlement", hour: 9, minute: 30,
      script: "scripts/analytics-football-predictions-settle.ts",
      args: ["--all-competitions", "--lookback-hours=96", "--execute"], timeoutSeconds: 900
    });
  });

  it("uses the same safe config for daily execution and bootstrap without changing the Node entrypoint", async () => {
    // Do not import the daemon: its production entrypoint intentionally starts immediately.
    const service = await readFile(new URL("./analytics-daily-service.mjs", import.meta.url), "utf8");
    expect(service).toMatch(/import\s*\{\s*JOBS,\s*INTERVAL_JOBS\s*\}\s*from\s*["']\.\/analytics-job-config\.mjs["']/);
    expect(service).toContain("for (const job of [...JOBS].reverse())");
    expect(service).toContain("for (const job of JOBS)");
    expect(service).toContain("for (const job of INTERVAL_JOBS)");
    expect(service).toContain("main().catch(");
    expect(service).not.toContain("football-engines-backfill");
  });
});
