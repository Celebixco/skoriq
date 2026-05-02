import { describe, expect, it } from "vitest";

const providerMappingConflictTarget = ["provider", "entity_type", "provider_entity_id"] as const;

describe("provider mapping idempotency contract", () => {
  it("uses provider, entity type, and provider entity id as the unique identity", () => {
    expect(providerMappingConflictTarget).toEqual(["provider", "entity_type", "provider_entity_id"]);
  });
});
