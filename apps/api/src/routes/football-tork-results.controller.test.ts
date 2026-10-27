import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { parseTorkResultsQuery } from "./football-tork-results.controller.js";
import { resolveTorkSettlementStatus } from "./football-tork-results.service.js";

describe("parseTorkResultsQuery", () => {
  it("applies safe defaults", () => {
    expect(parseTorkResultsQuery({})).toEqual({ countryId: undefined, competitionId: undefined, teamId: undefined, matchId: undefined, status: undefined, search: undefined, from: undefined, to: undefined, limit: 50, offset: 0 });
  });

  it("rejects invalid filters", () => {
    expect(() => parseTorkResultsQuery({ status: "cashback" })).toThrow(/status/);
    expect(() => parseTorkResultsQuery({ limit: "0" })).toThrow(/limit/);
    expect(() => parseTorkResultsQuery({ limit: "101" })).toThrow(/limit/);
    expect(() => parseTorkResultsQuery({ offset: "-1" })).toThrow(/offset/);
    expect(() => parseTorkResultsQuery({ matchId: "nope" })).toThrow(/matchId/);
    expect(() => parseTorkResultsQuery({ from: "not-a-date" })).toThrow(/from/);
    expect(() => parseTorkResultsQuery({ search: "x".repeat(81) })).toThrow(/search/);
  });

  it("accepts valid filters", () => {
    const parsed = parseTorkResultsQuery({ status: "won", limit: "25", offset: "50", matchId: "11111111-1111-4111-8111-111111111111" });
    expect(parsed.status).toBe("won");
    expect(parsed.limit).toBe(25);
    expect(parsed.offset).toBe(50);
    expect(parsed.matchId).toBe("11111111-1111-4111-8111-111111111111");
  });
});

describe("resolveTorkSettlementStatus", () => {
  it("pending until a halftime result exists", () => {
    expect(resolveTorkSettlementStatus({ fulltime_status: null, result_label: null, pick: "btts_yes" })).toBe("pending");
  });

  it("won/lost follows the label vs pick comparison", () => {
    expect(resolveTorkSettlementStatus({ fulltime_status: "verified_normal_time", result_label: "btts_yes", pick: "btts_yes" })).toBe("won");
    expect(resolveTorkSettlementStatus({ fulltime_status: "verified_normal_time", result_label: "btts_no", pick: "btts_yes" })).toBe("lost");
  });

  it("void when halftime could not be verified", () => {
    expect(resolveTorkSettlementStatus({ fulltime_status: "after_extra_time", result_label: null, pick: "btts_no" })).toBe("void");
  });
});
