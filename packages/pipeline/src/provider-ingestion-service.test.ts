import { describe, expect, it, vi } from "vitest";
import { ProviderIngestionService } from "./provider-ingestion-service.js";

describe("ProviderIngestionService", () => {
  it("refuses mock provider ingestion in production", async () => {
    const service = new ProviderIngestionService(
      { insertRawPayload: vi.fn() } as never,
      { createSyncJobLog: vi.fn() } as never,
      { add: vi.fn() } as never,
      { nodeEnv: "production", mockProviderEnabled: false }
    );

    await expect(
      service.ingestProviderResult({
        entityType: "sport",
        result: {
          data: [],
          rawPayload: [],
          metadata: {
            provider: "mock",
            endpoint: "getSports",
            requestParams: {},
            requestParamsHashInput: {},
            durationMs: 1,
            fetchedAt: "2026-01-01T00:00:00.000Z"
          }
        }
      })
    ).rejects.toThrow("Mock provider ingestion is forbidden in production.");
  });

  it("stores raw payloads and enqueues processing jobs for allowed providers", async () => {
    const insertRawPayload = vi.fn().mockResolvedValue({ id: "raw-1" });
    const markRawPayloadReceivedForRetry = vi.fn();
    const add = vi.fn().mockResolvedValue(undefined);
    const service = new ProviderIngestionService(
      { insertRawPayload, markRawPayloadReceivedForRetry } as never,
      { createSyncJobLog: vi.fn() } as never,
      { add } as never,
      { nodeEnv: "development", mockProviderEnabled: true }
    );

    const result = await service.ingestProviderResult({
      entityType: "sport",
      result: {
        data: [{ providerEntityId: "football", name: "Football" }],
        metadata: {
          provider: "mock",
          endpoint: "getSports",
          requestParams: {},
          requestParamsHashInput: {},
          durationMs: 1,
          fetchedAt: "2026-01-01T00:00:00.000Z"
        }
      }
    });

    expect(result.rawPayloadId).toBe("raw-1");
    expect(insertRawPayload).toHaveBeenCalledOnce();
    expect(markRawPayloadReceivedForRetry).not.toHaveBeenCalled();
    expect(add).toHaveBeenCalledWith(
      "process-raw-payload",
      expect.objectContaining({ rawPayloadId: "raw-1", entityType: "sport" }),
      expect.objectContaining({ removeOnComplete: true, removeOnFail: false })
    );
  });

  it("requeues failed raw payloads after resetting them for retry", async () => {
    const insertRawPayload = vi.fn().mockResolvedValue({ id: "raw-2", status: "failed" });
    const markRawPayloadReceivedForRetry = vi.fn().mockResolvedValue({ id: "raw-2", status: "received" });
    const add = vi.fn().mockResolvedValue(undefined);
    const service = new ProviderIngestionService(
      { insertRawPayload, markRawPayloadReceivedForRetry } as never,
      { createSyncJobLog: vi.fn() } as never,
      { add } as never,
      { nodeEnv: "development", mockProviderEnabled: true }
    );

    const result = await service.ingestProviderResult({
      entityType: "match",
      result: {
        data: [{ providerEntityId: "match-1" }],
        metadata: {
          provider: "apifootball-com",
          endpoint: "list_upcoming_matches",
          requestParams: { leagueId: "171" },
          requestParamsHashInput: { leagueId: "171" },
          durationMs: 1,
          fetchedAt: "2026-01-01T00:00:00.000Z"
        }
      }
    });

    expect(result.rawPayloadId).toBe("raw-2");
    expect(markRawPayloadReceivedForRetry).toHaveBeenCalledWith("raw-2");
    expect(add).toHaveBeenCalledWith(
      "process-raw-payload",
      expect.objectContaining({ rawPayloadId: "raw-2", entityType: "match" }),
      expect.objectContaining({ removeOnComplete: true, removeOnFail: false })
    );
  });
});
