import { describe, expect, it } from "vitest";
import { sha256Hash } from "@sports-data/shared";
import { buildRawPayloadInsertValues } from "./raw-provider-payloads.js";

describe("buildRawPayloadInsertValues", () => {
  it("computes stable request and payload hashes", () => {
    const values = buildRawPayloadInsertValues(
      {
        provider: "mock",
        entityType: "match",
        endpoint: "getMatchDetails",
        requestParams: { b: 2, a: 1 },
        payloadJson: { id: "provider-match-1" },
        receivedAt: new Date("2026-01-01T00:00:00.000Z")
      },
      {
        successRetentionDays: 7,
        failedRetentionDays: 30
      }
    );

    expect(values.requestParamsHash).toBe(sha256Hash({ a: 1, b: 2 }));
    expect(values.payloadHash).toBe(sha256Hash({ id: "provider-match-1" }));
    expect(values.status).toBe("received");
    expect(values.deleteAfter.toISOString()).toBe("2026-01-08T00:00:00.000Z");
  });

  it("uses failed retention for failed raw payloads", () => {
    const values = buildRawPayloadInsertValues(
      {
        provider: "mock",
        entityType: "team",
        endpoint: "getTeams",
        payloadJson: { error: true },
        status: "failed",
        receivedAt: new Date("2026-01-01T00:00:00.000Z")
      },
      {
        successRetentionDays: 7,
        failedRetentionDays: 30
      }
    );

    expect(values.deleteAfter.toISOString()).toBe("2026-01-31T00:00:00.000Z");
  });
});
