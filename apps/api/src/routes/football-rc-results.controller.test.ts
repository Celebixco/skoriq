import "reflect-metadata";
import { BadRequestException, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { AuthGuard } from "../auth/auth.guard.js";
import { FootballRcResultsController, parseRcResultsQuery } from "./football-rc-results.controller.js";
import { FootballRcResultsService, resolveRcSettlementStatus } from "./football-rc-results.service.js";

describe("FootballRcResultsController", () => {
  it("is protected by the existing auth guard", async () => {
    expect(Reflect.getMetadata("__guards__", FootballRcResultsController)).toContain(AuthGuard);
    await expect(runAuthGuard(null)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(runAuthGuard({ id: "member-1", email: "member@example.test", role: "member", status: "active" })).resolves.toBe(true);
  });

  it("fails closed when the feature switch is off", async () => {
    const previous = process.env.RC_PREMATCH_ENABLED;
    process.env.RC_PREMATCH_ENABLED = "false";
    try {
      const service = new FootballRcResultsService({} as never);
      await expect(service.listResults({ limit: 50, offset: 0 })).rejects.toBeInstanceOf(ServiceUnavailableException);
      await expect(service.getResultsSummary()).rejects.toBeInstanceOf(ServiceUnavailableException);
    } finally {
      if (previous === undefined) delete process.env.RC_PREMATCH_ENABLED;
      else process.env.RC_PREMATCH_ENABLED = previous;
    }
  });

  it("validates filters and applies safe defaults", () => {
    expect(parseRcResultsQuery({})).toEqual({ countryId: undefined, competitionId: undefined, teamId: undefined, matchId: undefined, status: undefined, search: undefined, from: undefined, to: undefined, limit: 50, offset: 0 });
    expect(parseRcResultsQuery({ status: "won", limit: "20", offset: "40", search: "  Arsenal " }).status).toBe("won");
    expect(parseRcResultsQuery({ search: "  Arsenal " }).search).toBe("Arsenal");
    expect(() => parseRcResultsQuery({ status: "not_settleable" })).toThrow(BadRequestException);
    expect(() => parseRcResultsQuery({ countryId: "not-a-uuid" })).toThrow(BadRequestException);
    expect(() => parseRcResultsQuery({ limit: "101" })).toThrow(BadRequestException);
    expect(() => parseRcResultsQuery({ offset: "-1" })).toThrow(BadRequestException);
    expect(() => parseRcResultsQuery({ from: "not-a-date" })).toThrow(BadRequestException);
  });

  it("delegates list and summary calls to the service", async () => {
    const service = {
      listResults: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 }),
      getResultsSummary: vi.fn().mockResolvedValue({ total: 0, won: 0, lost: 0, pending: 0, void: 0 })
    } as unknown as FootballRcResultsService;
    const controller = new FootballRcResultsController(service);
    await expect(controller.listPredictionResults({})).resolves.toEqual({ items: [], total: 0, limit: 50, offset: 0 });
    await expect(controller.predictionResultsSummary({})).resolves.toEqual({ total: 0, won: 0, lost: 0, pending: 0, void: 0 });
    expect(service.listResults).toHaveBeenCalledTimes(1);
    expect(service.getResultsSummary).toHaveBeenCalledTimes(1);
  });
});

describe("resolveRcSettlementStatus", () => {
  it("maps verified normal-time results to won or lost by comparing pick and outcome", () => {
    expect(resolveRcSettlementStatus({ pick: "1", result_label: "1", normal_time_status: "verified_normal_time" })).toBe("won");
    expect(resolveRcSettlementStatus({ pick: "X", result_label: "2", normal_time_status: "verified_normal_time" })).toBe("lost");
  });

  it("treats missing settlements as pending and non-normal-time finishes as void", () => {
    expect(resolveRcSettlementStatus({ pick: "1", result_label: null, normal_time_status: null })).toBe("pending");
    expect(resolveRcSettlementStatus({ pick: "1", result_label: null, normal_time_status: "after_extra_time" })).toBe("void");
    expect(resolveRcSettlementStatus({ pick: "1", result_label: null, normal_time_status: "unknown_normal_time" })).toBe("void");
  });
});

async function runAuthGuard(user: { id: string; email: string; role: "member" | "admin"; status: "active" } | null) {
  const auth = {
    enabled: true,
    currentUserFromRequest: vi.fn().mockResolvedValue(user)
  };
  const guard = new AuthGuard(auth as never);
  const request = { headers: { cookie: user ? "betify_auth=test" : "" } } as never;
  return guard.canActivate({ switchToHttp: () => ({ getRequest: () => request }) } as never);
}
