import { describe, expect, it, vi } from "vitest";
import { LocalNoopProviderAdapter } from "@sports-data/providers";
import { ProviderAdapterIngestionBridge } from "./provider-adapter-ingestion-bridge.js";

describe("ProviderAdapterIngestionBridge", () => {
  it("hands provider adapter results to ProviderIngestionService", async () => {
    const adapter = new LocalNoopProviderAdapter({
      environment: { nodeEnv: "test" },
      responses: {
        get_football_match_score: [{ providerEntityId: "score-1", matchProviderId: "match-1", homeScoreFullTime: 2, awayScoreFullTime: 1 }]
      }
    });
    const ingestProviderResult = vi.fn().mockResolvedValue({
      rawPayloadId: "raw-1",
      syncJobId: "sync-1",
      enqueuedJobKey: "raw-payload:raw-1"
    });
    const bridge = new ProviderAdapterIngestionBridge({ ingestProviderResult });

    const result = await bridge.executeAndIngest({
      adapter,
      operation: "get_football_match_score",
      params: { matchProviderId: "match-1" },
      syncJobId: "sync-1",
      correlationId: "corr-1"
    });

    expect(result.rawPayloadId).toBe("raw-1");
    expect(ingestProviderResult).toHaveBeenCalledWith({
      entityType: "football_match_score",
      result: expect.objectContaining({
        data: [{ providerEntityId: "score-1", matchProviderId: "match-1", homeScoreFullTime: 2, awayScoreFullTime: 1 }],
        metadata: expect.objectContaining({
          provider: "local-noop",
          endpoint: "get_football_match_score",
          requestParams: { matchProviderId: "match-1" }
        })
      }),
      syncJobId: "sync-1"
    });
  });

  it("fails clearly when caller overrides an operation with the wrong entity type", async () => {
    const adapter = new LocalNoopProviderAdapter({ environment: { nodeEnv: "test" } });
    const bridge = new ProviderAdapterIngestionBridge({ ingestProviderResult: vi.fn() });

    await expect(
      bridge.executeAndIngest({
        adapter,
        operation: "get_basketball_standings",
        entityType: "football_standing"
      })
    ).rejects.toThrow('Provider operation "get_basketball_standings" must ingest entity type "basketball_standing".');
  });
});

