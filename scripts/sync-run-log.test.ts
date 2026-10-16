import { describe, expect, it } from "vitest";
import { parseSyncRunLogArgs, writeSyncRunLog } from "./sync-run-log.js";

describe("sync run log helper", () => {
  it("parses all required flags", () => {
    const options = parseSyncRunLogArgs(["--job", "finished-matches", "--status", "fetch_failed", "--mode", "dry_run", "--summary", '{"a":1}', "--error", "fetch_failed"]);
    expect(options).toEqual({ job: "finished-matches", status: "fetch_failed", mode: "dry_run", summary: '{"a":1}', error: "fetch_failed" });
  });

  it.each([
    [[]],
    [["--job", "finished-matches"]],
    [["--job", "finished-matches", "--status", "succeeded", "--mode", "dry_run"]],
    [["--job", "finished-matches", "--status", "succeeded", "--mode", "dry_run", "--summary", "{}", "--bogus", "x"]]
  ])("rejects incomplete argument sets %#", (args) => {
    expect(() => parseSyncRunLogArgs(args)).toThrow();
  });

  it.each([
    ["unknown job", { job: "other", status: "succeeded", mode: "dry_run", summary: "{}" }, /unknown job/i],
    ["bad summary", { job: "finished-matches", status: "succeeded", mode: "dry_run", summary: "{not json" }, /summary/i],
    ["missing error for failure", { job: "finished-matches", status: "fetch_failed", mode: "dry_run", summary: "{}" }, /error/i]
  ])("validates before touching the database: %s", async (_label, options, pattern) => {
    await expect(writeSyncRunLog(options, "postgres://unused@localhost/unused")).rejects.toThrow(pattern);
  });
});
