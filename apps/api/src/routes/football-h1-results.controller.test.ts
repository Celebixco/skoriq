import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { parseH1ResultsQuery } from "./football-h1-results.controller.js";
import { resolveH1SettlementStatus } from "./football-h1-results.service.js";

describe("parseH1ResultsQuery", () => {
  it("applies safe defaults", () => {
    expect(parseH1ResultsQuery({})).toEqual({ countryId: undefined, competitionId: undefined, teamId: undefined, matchId: undefined, status: undefined, search: undefined, from: undefined, to: undefined, limit: 50, offset: 0 });
  });

  it("rejects invalid filters", () => {
    expect(() => parseH1ResultsQuery({ status: "cashback" })).toThrow(/status/);
    expect(() => parseH1ResultsQuery({ limit: "0" })).toThrow(/limit/);
    expect(() => parseH1ResultsQuery({ limit: "101" })).toThrow(/limit/);
    expect(() => parseH1ResultsQuery({ offset: "-1" })).toThrow(/offset/);
    expect(() => parseH1ResultsQuery({ matchId: "nope" })).toThrow(/matchId/);
    expect(() => parseH1ResultsQuery({ from: "not-a-date" })).toThrow(/from/);
    expect(() => parseH1ResultsQuery({ search: "x".repeat(81) })).toThrow(/search/);
  });

  it("accepts valid filters", () => {
    const parsed = parseH1ResultsQuery({ status: "won", limit: "25", offset: "50", matchId: "11111111-1111-4111-8111-111111111111" });
    expect(parsed.status).toBe("won");
    expect(parsed.limit).toBe(25);
    expect(parsed.offset).toBe(50);
    expect(parsed.matchId).toBe("11111111-1111-4111-8111-111111111111");
  });
});

describe("resolveH1SettlementStatus", () => {
  it("pending until a halftime result exists", () => {
    expect(resolveH1SettlementStatus({ halftime_status: null, result_label: null, pick: "over_0_5" })).toBe("pending");
  });

  it("won/lost follows the label vs pick comparison", () => {
    expect(resolveH1SettlementStatus({ halftime_status: "verified_halftime", result_label: "over_0_5", pick: "over_0_5" })).toBe("won");
    expect(resolveH1SettlementStatus({ halftime_status: "verified_halftime", result_label: "under_0_5", pick: "over_0_5" })).toBe("lost");
  });

  it("void when halftime could not be verified", () => {
    expect(resolveH1SettlementStatus({ halftime_status: "unresolved_halftime", result_label: null, pick: "under_0_5" })).toBe("void");
  });
});
