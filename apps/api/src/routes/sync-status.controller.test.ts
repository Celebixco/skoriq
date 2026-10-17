import { beforeEach, describe, expect, it, vi } from "vitest";

const { queries, close, syncJobRows } = vi.hoisted(() => ({
  queries: [] as string[],
  close: vi.fn(),
  syncJobRows: { value: [] as unknown[] }
}));

vi.mock("@sports-data/config", () => ({
  loadConfig: () => ({ DATABASE_URL: "postgres://fixture@localhost/skoriq_test" })
}));
vi.mock("pg", () => ({
  default: {
    Pool: class {
      async query(query: string) {
        queries.push(query);
        if (query.includes("FROM sync_jobs")) {
          return { rows: syncJobRows.value };
        }
        return { rows: [{ total: 0, with_stats: 0, finished: 0, scheduled: 0, matches_with_stats: 0, total_records: 0 }] };
      }
      end = close;
    }
  }
}));

import { SyncStatusController } from "./sync-status.controller.js";

describe("SyncStatusController", () => {
  beforeEach(() => {
    queries.length = 0;
    syncJobRows.value = [];
    close.mockReset().mockResolvedValue(undefined);
  });

  it("counts seasonal telemetry saved under either supported provider metadata key", async () => {
    await new SyncStatusController().getSyncStatus();
    const teamQuery = queries.find((query) => query.includes("FROM teams"));
    expect(teamQuery).toContain("metadata_json->'seasonStatistics'");
    expect(teamQuery).toContain("metadata_json->'season_statistics'");
    expect(teamQuery).toContain("metadata_json->'competitionSeasonStatistics'");
    expect(teamQuery).toContain("jsonb_typeof");
  });

  it("does not announce an active daemon without evidence of a running process", async () => {
    const result = await new SyncStatusController().getSyncStatus();
    expect(result.automation).toMatchObject({ daemonEnabled: null, mode: "not_verified", intervalHours: null });
    expect(result.syncRuns).toEqual([]);
    expect(close).toHaveBeenCalledOnce();
  });

  it("reports scheduled service evidence from recorded sync runs", async () => {
    syncJobRows.value = [{
      job_key: "sofascore.finished-matches",
      job_name: "finished-matches-sync",
      status: "succeeded",
      attempt_count: 4,
      last_error: null,
      started_at: "2026-10-16T12:00:00.000Z",
      finished_at: "2026-10-16T12:01:00.000Z",
      duration_ms: 60000,
      latest_log: { message: "finished-matches dry_run run: 240 events", metadata: { mode: "dry_run", counts: { planned_update: 12 } }, createdAt: "2026-10-16T12:01:00.000Z" },
      recent_logs: [
        { message: "finished-matches dry_run run: 240 events", metadata: { mode: "dry_run", counts: { planned_update: 12 } }, createdAt: "2026-10-16T12:01:00.000Z" },
        { message: "fetch_completed", metadata: { tournamentId: 52 }, createdAt: "2026-10-16T12:00:30.000Z" }
      ]
    }];
    const result = await new SyncStatusController().getSyncStatus();
    expect(result.automation).toMatchObject({
      mode: "scheduled_service",
      source: "sofascore_api",
      lastRunStatus: "succeeded",
      lastRunAt: "2026-10-16T12:01:00.000Z"
    });
    expect(result.syncRuns[0]).toMatchObject({
      jobKey: "sofascore.finished-matches",
      status: "succeeded",
      attemptCount: 4,
      lastMessage: "finished-matches dry_run run: 240 events",
      lastMetadata: { mode: "dry_run", counts: { planned_update: 12 } }
    });
    const firstRun = result.syncRuns[0];
    expect(firstRun).toBeDefined();
    expect(firstRun?.recentLogs).toHaveLength(2);
    expect(firstRun?.recentLogs?.[1]).toMatchObject({ message: "fetch_completed" });
  });

  it("scopes the sync run query to the sync service queue", async () => {
    await new SyncStatusController().getSyncStatus();
    const runQuery = queries.find((query) => query.includes("FROM sync_jobs"));
    expect(runQuery).toContain("queue_name = 'sync-service'");
    expect(runQuery).toContain("FROM sync_job_logs");
  });
});
