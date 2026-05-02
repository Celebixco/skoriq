import { describe, expect, it } from "vitest";
import { cleanupAllowedTables } from "./cleanup.js";

describe("cleanupAllowedTables", () => {
  it("limits cleanup to temporary pipeline tables only", () => {
    expect(cleanupAllowedTables).toEqual(["raw_provider_payloads", "sync_job_logs"]);
    expect(cleanupAllowedTables).not.toContain("matches");
    expect(cleanupAllowedTables).not.toContain("provider_mappings");
    expect(cleanupAllowedTables).not.toContain("teams");
    expect(cleanupAllowedTables).not.toContain("standings");
  });
});
