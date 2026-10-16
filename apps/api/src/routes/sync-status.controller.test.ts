import { beforeEach, describe, expect, it, vi } from "vitest";

const { queries, close } = vi.hoisted(() => ({ queries: [] as string[], close: vi.fn() }));

vi.mock("@sports-data/config", () => ({
  loadConfig: () => ({ DATABASE_URL: "postgres://fixture@localhost/skoriq_test" })
}));
vi.mock("pg", () => ({
  default: {
    Pool: class {
      async query(query: string) {
        queries.push(query);
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
    close.mockReset().mockResolvedValue(undefined);
  });

  it("counts seasonal telemetry saved under either supported provider metadata key", async () => {
    await new SyncStatusController().getSyncStatus();
    const teamQuery = queries.find((query) => query.includes("FROM teams"));
    expect(teamQuery).toContain("metadata_json->'seasonStatistics'");
    expect(teamQuery).toContain("metadata_json->'season_statistics'");
    expect(teamQuery).toContain("jsonb_typeof");
  });

  it("does not announce an active daemon without evidence of a running process", async () => {
    const result = await new SyncStatusController().getSyncStatus();
    expect(result.automation).toMatchObject({ daemonEnabled: null, mode: "not_verified", intervalHours: null });
    expect(close).toHaveBeenCalledOnce();
  });
});
