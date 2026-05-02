import { BadRequestException, ForbiddenException, NotFoundException, UnauthorizedException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { AdminGuard } from "../auth/admin.guard.js";
import { AuthGuard } from "../auth/auth.guard.js";
import type { AuthService } from "../auth/auth.service.js";
import { FootballPredictionDraftsController, parseDraftsQuery } from "./football-prediction-drafts.controller.js";
import { FootballPredictionDraftsService, mapDraftDetailRow, mapDraftListRow } from "./football-prediction-drafts.service.js";

const matchId = "89759e35-758d-416e-b0d3-ad07436c8a9b";
const predictionId = "db2b0842-117b-46b3-aa4f-c4ae68304e64";

describe("FootballPredictionDraftsController", () => {
  it("is protected by the auth guard", () => {
    const guards = Reflect.getMetadata("__guards__", FootballPredictionDraftsController);

    expect(guards).toContain(AuthGuard);
    expect(guards).toContain(AdminGuard);
    expect(Reflect.getMetadata("__guards__", FootballPredictionDraftsController.prototype.listDrafts)).toEqual([AuthGuard, AdminGuard]);
    expect(Reflect.getMetadata("__guards__", FootballPredictionDraftsController.prototype.getDraft)).toEqual([AuthGuard, AdminGuard]);
    expect(Reflect.getMetadata("__guards__", FootballPredictionDraftsController.prototype.listMatchDrafts)).toEqual([AuthGuard, AdminGuard]);
  });

  it("enforces auth and admin role before match draft access", async () => {
    const controller = new FootballPredictionDraftsController(mockService());

    await expect(runAdminGuardChain(null)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(runAdminGuardChain({ id: "member-1", email: "member@example.test", role: "member", status: "active" })).rejects.toBeInstanceOf(ForbiddenException);

    await expect(runAdminGuardChain({ id: "admin-1", email: "admin@example.test", role: "admin", status: "active" })).resolves.toBe(true);
    await expect(controller.listMatchDrafts(matchId)).resolves.toMatchObject({
      memberVisible: false
    });
  });

  it("lists draft predictions with safe filters", async () => {
    const service = mockService();
    const controller = new FootballPredictionDraftsController(service);

    await controller.listDrafts({
      matchId,
      consistencyStatus: "warning",
      recommendationTier: "primary",
      predictionType: " match_result_1x2 ",
      limit: "10",
      offset: "5"
    });

    expect(service.listDrafts).toHaveBeenCalledWith({
      matchId,
      status: "draft",
      consistencyStatus: "warning",
      recommendationTier: "primary",
      predictionType: "match_result_1x2",
      limit: 10,
      offset: 5
    });
  });

  it("returns draft detail and match grouped drafts", async () => {
    const service = mockService();
    const controller = new FootballPredictionDraftsController(service);

    await controller.getDraft(predictionId);
    await controller.listMatchDrafts(matchId);

    expect(service.getDraft).toHaveBeenCalledWith(predictionId);
    expect(service.listMatchDrafts).toHaveBeenCalledWith(matchId);
  });

  it("rejects invalid query values and UUIDs", async () => {
    const controller = new FootballPredictionDraftsController(mockService());

    await expect(controller.getDraft("not-a-uuid")).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.listMatchDrafts("not-a-uuid")).rejects.toBeInstanceOf(BadRequestException);
    expect(() => parseDraftsQuery({ matchId: "not-a-uuid" })).toThrow(BadRequestException);
    expect(() => parseDraftsQuery({ status: "published_now" })).toThrow(BadRequestException);
    expect(() => parseDraftsQuery({ consistencyStatus: "maybe" })).toThrow(BadRequestException);
    expect(() => parseDraftsQuery({ recommendationTier: "banko" })).toThrow(BadRequestException);
    expect(() => parseDraftsQuery({ predictionType: "x".repeat(81) })).toThrow(BadRequestException);
    expect(() => parseDraftsQuery({ limit: "101" })).toThrow(BadRequestException);
    expect(() => parseDraftsQuery({ offset: "-1" })).toThrow(BadRequestException);
  });

  it("propagates missing prediction and match as 404", async () => {
    const service = mockService({
      getDraft: vi.fn().mockRejectedValue(new NotFoundException("Football prediction draft not found.")),
      listMatchDrafts: vi.fn().mockRejectedValue(new NotFoundException("Football match not found."))
    });
    const controller = new FootballPredictionDraftsController(service);

    await expect(controller.getDraft(predictionId)).rejects.toBeInstanceOf(NotFoundException);
    await expect(controller.listMatchDrafts(matchId)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("football prediction draft response mappers", () => {
  it("maps list rows without raw payloads or secrets", () => {
    const response = mapDraftListRow(baseRow());
    const serialized = JSON.stringify(response);

    expect(response).toMatchObject({
      predictionId,
      predictionType: "match_result_1x2",
      recommendationTier: "primary",
      status: "draft",
      consistencyStatus: "warning"
    });
    expect(serialized).not.toContain("APIFOOTBALL_COM_API_KEY");
    expect(serialized).not.toContain("DATABASE_URL");
    expect(serialized).not.toContain("postgres://");
    expect(serialized).not.toContain("raw_provider_payload");
  });

  it("maps detail conflicts and sanitizes metadata", () => {
    const response = mapDraftDetailRow(
      {
        ...baseRow(),
        metadata_json: {
          safe: "kept",
          AUTH_JWT_SECRET: "remove-me",
          nested: {
            DATABASE_URL: "postgres://secret"
          }
        }
      },
      [
        {
          conflict_type: "h2h_missing_warning",
          severity: "warning",
          source_prediction_type: "match_result_1x2",
          conflicting_prediction_type: null,
          reason: "H2H sample is missing."
        }
      ]
    );

    expect(response.conflicts).toHaveLength(1);
    expect(response.metadata).toEqual({ safe: "kept", nested: {} });
    expect(JSON.stringify(response)).not.toContain("remove-me");
    expect(JSON.stringify(response)).not.toContain("postgres://secret");
  });
});

describe("FootballPredictionDraftsService read-only behavior", () => {
  it("uses read queries only for draft listing", async () => {
    const database = {
      execute: vi.fn().mockResolvedValueOnce({ rows: [baseRow()] }).mockResolvedValueOnce({ rows: [{ count: "1" }] }),
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn()
    };
    const service = new FootballPredictionDraftsService(database as never);

    await service.listDrafts({ status: "draft", limit: 20, offset: 0 });

    expect(database.execute).toHaveBeenCalledTimes(2);
    expect(database.insert).not.toHaveBeenCalled();
    expect(database.update).not.toHaveBeenCalled();
    expect(database.delete).not.toHaveBeenCalled();
  });
});

function mockService(overrides: Partial<FootballPredictionDraftsService> = {}): FootballPredictionDraftsService {
  const item = mapDraftListRow(baseRow());
  return {
    listDrafts: vi.fn().mockResolvedValue({ items: [item], pagination: { limit: 20, offset: 0, total: 1 } }),
    getDraft: vi.fn().mockResolvedValue(mapDraftDetailRow(baseRow(), [])),
    listMatchDrafts: vi.fn().mockResolvedValue({
      match: item.match,
      outputsByRecommendationTier: {
        primary: { label: "Tahminim", items: [item] },
        try: { label: "Denenir", items: [] },
        alternative: { label: "Alternatif", items: [] },
        avoid: { label: "Uzak Dur", items: [] }
      },
      conflictsSummary: { total: 2, blocking: 0, warning: 2, info: 0 },
      memberVisible: false,
      note: "Draft only."
    }),
    ...overrides
  } as unknown as FootballPredictionDraftsService;
}

async function runAdminGuardChain(user: { id: string; email: string; role: "admin" | "member"; status: "active" } | null) {
  const request = { headers: {} };
  const authService = {
    enabled: true,
    currentUserFromRequest: vi.fn().mockResolvedValue(user)
  } as unknown as AuthService;
  const context = mockExecutionContext(request);

  await new AuthGuard(authService).canActivate(context);
  return new AdminGuard(authService).canActivate(context);
}

function mockExecutionContext(request: object) {
  return {
    switchToHttp: () => ({
      getRequest: () => request
    })
  } as ExecutionContext;
}

function baseRow() {
  return {
    prediction_id: predictionId,
    match_id: matchId,
    competition_id: "e91bf32e-3683-49f6-8077-6247889e58a5",
    competition: "Bundesliga",
    country: "Germany",
    kickoff_at: "2026-04-26T17:30:00.000Z",
    match_status: "finished",
    home_team_id: "b4235ef3-4d8c-4461-aeec-37e9abef3130",
    home_team: "Borussia Dortmund",
    home_team_logo_url: "https://example.test/dortmund.png",
    away_team_id: "team-away",
    away_team: "Freiburg",
    away_team_logo_url: "https://example.test/freiburg.png",
    prediction_type: "match_result_1x2",
    prediction_value: "1",
    prediction_family: "match_result",
    recommendation_tier: "primary",
    display_label: "Tahminim",
    confidence_score: "65.00",
    confidence_ceiling: "65.00",
    risk_level: "medium",
    status: "draft",
    consistency_status: "warning",
    consistency_summary: "Consistency dry-run complete.",
    expectation_snapshot: { expectedScoreline: "2-1" },
    conflict_count: 2,
    blocking_conflict_count: 0,
    warning_conflict_count: 2,
    reasoning_summary: "Ev sahibi form ve güç göstergelerinde önde görünüyor.",
    metadata_json: { safe: true },
    generated_at: "2026-04-30T00:00:00.000Z",
    created_at: "2026-04-30T00:00:00.000Z"
  };
}
