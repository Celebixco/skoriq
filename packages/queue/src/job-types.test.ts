import { describe, expect, it } from "vitest";
import { Job } from "bullmq";
import type { MinimalQueue } from "bullmq";
import { buildRawPayloadProcessingJobKey, buildSyncJobKey } from "./job-types.js";
import type { RawPayloadProcessingJobPayload } from "./job-types.js";

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
  const payload: RawPayloadProcessingJobPayload = {
    rawPayloadId: "raw-1",
    entityType: "match",
    syncJobId: "sync-1"
  };

  it.each([
    payload,
    { ...payload, syncJobId: undefined },
    { ...payload, rawPayloadId: "raw:1", syncJobId: "sync:1" }
  ])("produces an ID accepted by BullMQ for %j", (input) => {
    const jobId = buildRawPayloadProcessingJobKey(input);
    // Validation is local; this queue context opens no Redis connection.
    const queue = {
      qualifiedName: "bull:raw-payload-processing-queue",
      toKey: (key: string) => `bull:raw-payload-processing-queue:${key}`,
      keys: {}
    } as MinimalQueue;
    const job = new ValidatedRawPayloadJob(queue, "process-raw-payload", input, { jobId });

    expect(() => job.validate()).not.toThrow();
    expect(jobId).not.toContain(":");
  });

  it("reuses the ID for retries of the same payload", () => {
    expect(buildRawPayloadProcessingJobKey({ ...payload })).toBe(buildRawPayloadProcessingJobKey(payload));
  });

  it("distinguishes raw payloads, sync jobs, and entity types", () => {
    const keys = [
      payload,
      { ...payload, rawPayloadId: "raw-2" },
      { ...payload, syncJobId: "sync-2" },
      { ...payload, entityType: "team" as const }
    ].map(buildRawPayloadProcessingJobKey);

    expect(new Set(keys).size).toBe(keys.length);
  });

  it("distinguishes IDs containing separators at different field boundaries", () => {
    expect(buildRawPayloadProcessingJobKey({ ...payload, rawPayloadId: "raw:1", syncJobId: "sync" }))
      .not.toBe(buildRawPayloadProcessingJobKey({ ...payload, rawPayloadId: "raw", syncJobId: "1:sync" }));
  });

  it("distinguishes an omitted sync job from a literal fallback-like ID", () => {
    expect(buildRawPayloadProcessingJobKey({ ...payload, syncJobId: undefined }))
      .not.toBe(buildRawPayloadProcessingJobKey({ ...payload, syncJobId: "no-sync-job" }));
  });
});

class ValidatedRawPayloadJob extends Job<RawPayloadProcessingJobPayload> {
  validate() {
    this.validateOptions(this.asJSON());
  }
}
