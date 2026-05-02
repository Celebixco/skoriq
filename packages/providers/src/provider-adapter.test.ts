import { describe, expect, it, vi } from "vitest";
import { getProviderOperationMetadata } from "./provider-adapter.js";
import { LocalNoopProviderAdapter } from "./noop-provider-adapter.js";
import { ProviderRegistry } from "./provider-registry.js";

describe("provider adapter shell", () => {
  it("registers adapters and returns capabilities", () => {
    const adapter = new LocalNoopProviderAdapter({ environment: { nodeEnv: "test" } });
    const registry = new ProviderRegistry();

    registry.register(adapter);

    expect(registry.get("local-noop")).toBe(adapter);
    expect(registry.listProviderNames()).toEqual(["local-noop"]);
    expect(registry.listCapabilities()["local-noop"]).toMatchObject({
      supportsFootball: true,
      supportsBasketball: true,
      supportsScores: true,
      supportsTeamStatistics: true,
      supportsStandings: true
    });
  });

  it("fails clearly for duplicate and unknown providers", () => {
    const adapter = new LocalNoopProviderAdapter({ environment: { nodeEnv: "test" } });
    const registry = new ProviderRegistry();
    registry.register(adapter);

    expect(() => registry.register(adapter)).toThrow('Provider adapter "local-noop" is already registered.');
    expect(() => registry.get("missing")).toThrow('Unknown provider adapter "missing".');
  });

  it("blocks local no-op provider construction in production", () => {
    expect(() => new LocalNoopProviderAdapter({ environment: { nodeEnv: "production" } })).toThrow("Local no-op provider adapter is forbidden in production.");
  });

  it("maps operations to expected entity types", () => {
    expect(getProviderOperationMetadata("get_football_match_score")).toMatchObject({
      sport: "football",
      entityType: "football_match_score",
      normalizedTarget: "football_match_scores",
      rawOnly: false
    });
    expect(getProviderOperationMetadata("get_basketball_period_scores")).toMatchObject({
      sport: "basketball",
      entityType: "basketball_period_score",
      normalizedTarget: "basketball_period_scores"
    });
    expect(getProviderOperationMetadata("get_football_standings")).toMatchObject({
      entityType: "football_standing",
      normalizedTarget: "football_standings"
    });
  });

  it("builds provider fetch results without external HTTP calls", async () => {
    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.fn();
    Object.defineProperty(globalThis, "fetch", { configurable: true, writable: true, value: fetchSpy });

    try {
      const adapter = new LocalNoopProviderAdapter({
        environment: { nodeEnv: "test" },
        responses: {
          list_sports: [{ providerEntityId: "football", name: "Football" }]
        }
      });

      const result = await adapter.fetch({
        provider: adapter.name,
        operation: "list_sports",
        entityType: "sport",
        params: { source: "unit-test" }
      });

      expect(result.data).toEqual([{ providerEntityId: "football", name: "Football" }]);
      expect(result.rawPayload).toEqual(result.data);
      expect(result.metadata).toMatchObject({
        provider: "local-noop",
        endpoint: "list_sports",
        requestParams: { source: "unit-test" }
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(globalThis, "fetch", { configurable: true, writable: true, value: originalFetch });
    }
  });

  it("fails clearly when an operation is routed to the wrong entity type", async () => {
    const adapter = new LocalNoopProviderAdapter({ environment: { nodeEnv: "test" } });

    await expect(
      adapter.fetch({
        provider: adapter.name,
        operation: "get_football_match_score",
        entityType: "basketball_match_score",
        params: {}
      })
    ).rejects.toThrow('Provider operation "get_football_match_score" must target entity type "football_match_score".');
  });
});

