import { describe, expect, it, vi } from "vitest";
import { RawProviderPayloadReprocessor, parseRawPayloadReprocessArgs, validateRawPayloadReprocessOptions } from "./provider-raw-payload-reprocess.js";
import type { RawPayloadRecord, RawPayloadReprocessDependencies } from "./provider-raw-payload-reprocess.js";

const failedStandingPayload = rawPayload({
  status: "failed",
  payloadJson: [
    {
      providerEntityId: "322:192",
      competitionProviderId: "322",
      teamProviderId: "192",
      position: 1,
      played: 1,
      wins: 1,
      draws: 0,
      losses: 0,
      goalsFor: 2,
      goalsAgainst: 1,
      goalDifference: 1,
      points: 3
    }
  ]
});

describe("raw provider payload reprocess command", () => {
  it("parses dry-run by default", () => {
    expect(parseRawPayloadReprocessArgs(["--raw-payload-id=raw-1"])).toEqual({
      rawPayloadId: "raw-1",
      execute: false
    });
  });

  it("requires raw payload id", () => {
    expect(() => validateRawPayloadReprocessOptions({ execute: false })).toThrow("Raw payload reprocess requires --raw-payload-id=<uuid>.");
  });

  it("dry-run validates dependencies without writes", async () => {
    const dependencies = dependenciesFor(failedStandingPayload);
    const report = await new RawProviderPayloadReprocessor(dependencies).run({ rawPayloadId: "raw-1", execute: false });

    expect(report).toMatchObject({
      mode: "dry-run",
      result: "would_reprocess",
      writes: 0,
      dependencyCheck: {
        competitionMappingsRequired: 1,
        competitionMappingsFound: 1,
        teamMappingsRequired: 1,
        teamMappingsFound: 1,
        likelySafe: true
      }
    });
    expect(dependencies.markRawPayloadReceivedForRetry).not.toHaveBeenCalled();
    expect(dependencies.processRawPayload).not.toHaveBeenCalled();
  });

  it("execute refuses non-failed payload", async () => {
    const dependencies = dependenciesFor(rawPayload({ status: "processed" }));

    await expect(new RawProviderPayloadReprocessor(dependencies).run({ rawPayloadId: "raw-1", execute: true })).rejects.toThrow(
      'Raw payload reprocess requires status=failed; current status is "processed".'
    );
  });

  it("execute refuses unsupported provider", async () => {
    const dependencies = dependenciesFor(rawPayload({ provider: "mock" }));

    await expect(new RawProviderPayloadReprocessor(dependencies).run({ rawPayloadId: "raw-1", execute: true })).rejects.toThrow(
      'Raw payload reprocess MVP supports provider "apifootball-com" only.'
    );
  });

  it("execute refuses unsupported entity type", async () => {
    const dependencies = dependenciesFor(rawPayload({ entityType: "team" }));

    await expect(new RawProviderPayloadReprocessor(dependencies).run({ rawPayloadId: "raw-1", execute: true })).rejects.toThrow(
      'Raw payload reprocess MVP supports entity_type "football_standing" only.'
    );
  });

  it("execute refuses expired payload", async () => {
    const dependencies = dependenciesFor(rawPayload({ deleteAfter: new Date("2020-01-01T00:00:00.000Z") }));

    await expect(new RawProviderPayloadReprocessor(dependencies).run({ rawPayloadId: "raw-1", execute: true })).rejects.toThrow(
      "Raw payload reprocess refuses expired payloads."
    );
  });

  it("standings reprocess succeeds after competition and team mappings exist", async () => {
    const dependencies = dependenciesFor(failedStandingPayload);
    const report = await new RawProviderPayloadReprocessor(dependencies).run({ rawPayloadId: "raw-1", execute: true });

    expect(dependencies.markRawPayloadReceivedForRetry).toHaveBeenCalledWith("raw-1");
    expect(dependencies.processRawPayload).toHaveBeenCalledWith({
      rawPayloadId: "raw-1",
      entityType: "football_standing"
    });
    expect(report).toMatchObject({
      mode: "execute",
      result: "processed",
      writes: 1
    });
  });

  it("standings reprocess fails safely if competition mapping is missing", async () => {
    const dependencies = dependenciesFor(failedStandingPayload, { competitionMappingsFound: 0 });

    await expect(new RawProviderPayloadReprocessor(dependencies).run({ rawPayloadId: "raw-1", execute: true })).rejects.toThrow(
      "Raw payload reprocess execute is blocked because dependency checks are incomplete."
    );
    expect(dependencies.markRawPayloadReceivedForRetry).not.toHaveBeenCalled();
    expect(dependencies.processRawPayload).not.toHaveBeenCalled();
  });

  it("does not call providers", async () => {
    const dependencies = dependenciesFor(failedStandingPayload);
    await new RawProviderPayloadReprocessor(dependencies).run({ rawPayloadId: "raw-1", execute: false });

    expect(Object.keys(dependencies)).not.toContain("fetchProviderResult");
  });
});

function dependenciesFor(payload: RawPayloadRecord, counts: { competitionMappingsFound?: number; teamMappingsFound?: number } = {}): RawPayloadReprocessDependencies {
  return {
    loadRawPayload: vi.fn().mockResolvedValue(payload),
    markRawPayloadReceivedForRetry: vi.fn().mockResolvedValue(undefined),
    processRawPayload: vi.fn().mockResolvedValue({ status: "processed", normalizationStatus: "normalized" }),
    countProviderMappings: vi.fn(async (_provider, entityType) => {
      if (entityType === "competition") {
        return counts.competitionMappingsFound ?? 1;
      }
      if (entityType === "team") {
        return counts.teamMappingsFound ?? 1;
      }
      return 0;
    })
  };
}

function rawPayload(overrides: Partial<RawPayloadRecord> = {}): RawPayloadRecord {
  return {
    id: "raw-1",
    provider: "apifootball-com",
    entityType: "football_standing",
    providerEntityId: undefined,
    endpoint: "get_football_standings",
    status: "failed",
    payloadJson: [],
    receivedAt: new Date("2026-04-30T20:00:00.000Z"),
    processedAt: new Date("2026-04-30T20:01:00.000Z"),
    normalizationError: 'Cannot normalize football standing "322:192" without competition mapping "322".',
    deleteAfter: new Date("2026-05-30T20:00:00.000Z"),
    ...overrides
  };
}
