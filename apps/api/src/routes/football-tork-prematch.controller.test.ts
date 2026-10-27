import "reflect-metadata";
import { BadRequestException, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { AuthGuard } from "../auth/auth.guard.js";
import { FootballTorkPrematchController } from "./football-tork-prematch.controller.js";
import { FootballTorkPrematchService } from "./football-tork-prematch.service.js";

const matchId = "11111111-1111-4111-8111-111111111111";

describe("FootballTorkPrematchController", () => {
  it("is protected by the existing auth guard", async () => {
    expect(Reflect.getMetadata("__guards__", FootballTorkPrematchController)).toContain(AuthGuard);
    await expect(runAuthGuard(null)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(runAuthGuard({ id: "member-1", email: "member@example.test", role: "member", status: "active" })).resolves.toBe(true);
  });

  it("fails closed when the feature switch is off", async () => {
    const previous = process.env.TORK_PREMATCH_ENABLED;
    process.env.TORK_PREMATCH_ENABLED = "false";
    try {
      const service = new FootballTorkPrematchService({} as never);
      await expect(service.listUpcoming()).rejects.toBeInstanceOf(ServiceUnavailableException);
    } finally {
      if (previous === undefined) delete process.env.TORK_PREMATCH_ENABLED;
      else process.env.TORK_PREMATCH_ENABLED = previous;
    }
  });

  it("validates the match UUID and serves only the sanitized response", async () => {
    const service = {
      listUpcoming: vi.fn().mockResolvedValue({ count: 0, items: [] }),
      getMatch: vi.fn().mockResolvedValue({ matchId })
    } as unknown as FootballTorkPrematchService;
    const controller = new FootballTorkPrematchController(service);
    await expect(controller.match("not-a-uuid")).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.upcoming()).resolves.toEqual({ count: 0, items: [] });
    await expect(controller.match(matchId)).resolves.toEqual({ matchId });
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
