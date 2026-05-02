import { describe, expect, it } from "vitest";
import { buildRawPayloadProcessingJobKey, buildSyncJobKey } from "./job-types.js";

describe("buildSyncJobKey", () => {
  it("uses stable hashing for equivalent params with different key order", () => {
    const first = buildSyncJobKey({
      provider: "mock",
      entityType: "match",
      operation: "getUpcomingMatches",
      params: { to: "2026-05-02", from: "2026-05-01" }
    });

    const second = buildSyncJobKey({
      provider: "mock",
      entityType: "match",
      operation: "getUpcomingMatches",
      params: { from: "2026-05-01", to: "2026-05-02" }
    });

    expect(first).toBe(second);
  });
});

describe("buildRawPayloadProcessingJobKey", () => {
  it("includes entity type and raw payload id", () => {
    expect(
      buildRawPayloadProcessingJobKey({
        rawPayloadId: "raw-1",
        entityType: "match",
        syncJobId: "sync-1"
      })
    ).toBe("raw-payload:match:raw-1:sync-1");
  });
});
