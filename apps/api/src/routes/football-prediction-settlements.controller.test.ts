import { BadRequestException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { AdminGuard } from "../auth/admin.guard.js";
import { AuthGuard } from "../auth/auth.guard.js";
import { FootballPredictionSettlementsController, parseSettlementsQuery } from "./football-prediction-settlements.controller.js";
import { FootballPredictionSettlementsService, mapSettlementDetailRow, mapSettlementListRow } from "./football-prediction-settlements.service.js";

const matchId = "89759e35-758d-416e-b0d3-ad07436c8a9b";
const predictionId = "db2b0842-117b-46b3-aa4f-c4ae68304e64";
const settlementId = "c7e2f83c-8d95-4d58-b7cb-7c8f2d3a75cd";

describe("FootballPredictionSettlementsController", () => {
  it("is protected by the auth guard", () => {
    const guards = Reflect.getMetadata("__guards__", FootballPredictionSettlementsController);

    expect(guards).toContain(AuthGuard);
    expect(guards).toContain(AdminGuard);
    expect(Reflect.getMetadata("__guards__", FootballPredictionSettlementsController.prototype.listSettlements)).toEqual([AuthGuard, AdminGuard]);
    expect(Reflect.getMetadata("__guards__", FootballPredictionSettlementsController.prototype.getSettlement)).toEqual([AuthGuard, AdminGuard]);
    expect(Reflect.getMetadata("__guards__", FootballPredictionSettlementsController.prototype.listMatchSettlements)).toEqual([AuthGuard, AdminGuard]);
  });

  it("lists settlements with safe filters", async () => {
    const service = mockService();
    const controller = new FootballPredictionSettlementsController(service);

    await controller.listSettlements({
      matchId,
      predictionId,
      settlementStatus: "settled_success",
      consistencyStatus: "warning",
      recommendationTier: "primary",
      auditOnly: "true",
      limit: "10",
      offset: "5"
    });

    expect(service.listSettlements).toHaveBeenCalledWith({
      matchId,
      predictionId,
      settlementStatus: "settled_success",
      consistencyStatus: "warning",
      recommendationTier: "primary",
      auditOnly: true,
      limit: 10,
      offset: 5
    });
  });

  it("returns settlement detail and match grouped settlements", async () => {
    const service = mockService();
    const controller = new FootballPredictionSettlementsController(service);

    await controller.getSettlement(settlementId);
    await controller.listMatchSettlements(matchId);

    expect(service.getSettlement).toHaveBeenCalledWith(settlementId);
    expect(service.listMatchSettlements).toHaveBeenCalledWith(matchId);
  });

  it("rejects invalid query values and UUIDs", async () => {
    const controller = new FootballPredictionSettlementsController(mockService());

    await expect(controller.getSettlement("not-a-uuid")).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.listMatchSettlements("not-a-uuid")).rejects.toBeInstanceOf(BadRequestException);
    expect(() => parseSettlementsQuery({ matchId: "not-a-uuid" })).toThrow(BadRequestException);
    expect(() => parseSettlementsQuery({ predictionId: "not-a-uuid" })).toThrow(BadRequestException);
    expect(() => parseSettlementsQuery({ settlementStatus: "won" })).toThrow(BadRequestException);
    expect(() => parseSettlementsQuery({ consistencyStatus: "maybe" })).toThrow(BadRequestException);
    expect(() => parseSettlementsQuery({ recommendationTier: "banko" })).toThrow(BadRequestException);
    expect(() => parseSettlementsQuery({ auditOnly: "yes" })).toThrow(BadRequestException);
    expect(() => parseSettlementsQuery({ limit: "101" })).toThrow(BadRequestException);
    expect(() => parseSettlementsQuery({ offset: "-1" })).toThrow(BadRequestException);
  });

  it("propagates missing settlement and match as 404", async () => {
    const service = mockService({
      getSettlement: vi.fn().mockRejectedValue(new NotFoundException("Football prediction settlement not found.")),
      listMatchSettlements: vi.fn().mockRejectedValue(new NotFoundException("Football match not found."))
    });
    const controller = new FootballPredictionSettlementsController(service);

    await expect(controller.getSettlement(settlementId)).rejects.toBeInstanceOf(NotFoundException);
    await expect(controller.listMatchSettlements(matchId)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("football prediction settlement response mappers", () => {
  it("maps list rows without raw payloads or secrets", () => {
    const response = mapSettlementListRow(baseRow());
    const serialized = JSON.stringify(response);

    expect(response).toMatchObject({
      settlementId,
      predictionId,
      settlementStatus: "settled_success",
      recommendationTier: "primary",
      consistencyStatus: "warning",
      auditOnly: false,
      memberVisible: false,
      publicStatus: {
        publicEligible: false,
        publicPublished: false
      }
    });
    expect(serialized).not.toContain("APIFOOTBALL_COM_API_KEY");
    expect(serialized).not.toContain("DATABASE_URL");
    expect(serialized).not.toContain("postgres://");
    expect(serialized).not.toContain("raw_provider_payload");
  });

  it("maps detail conflicts and sanitizes metadata", () => {
    const response = mapSettlementDetailRow(
      {
        ...baseRow(),
        settlement_metadata: {
          safe: "kept",
          blockedOrAvoidAuditOnly: true,
          AUTH_JWT_SECRET: "remove-me",
          nested: {
            DATABASE_URL: "postgres://secret"
          }
        },
        prediction_metadata_json: {
          reasoning: "kept",
          raw_provider_payload_id: "remove-this"
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
    expect(response.settlementMetadata).toEqual({ safe: "kept", blockedOrAvoidAuditOnly: true, nested: {} });
    expect(response.predictionMetadata).toEqual({ reasoning: "kept" });
    expect(response.guardNotes).toContain("Public başarılı tahmin olarak yayınlanmamıştır.");
    expect(JSON.stringify(response)).not.toContain("remove-me");
    expect(JSON.stringify(response)).not.toContain("postgres://secret");
    expect(JSON.stringify(response)).not.toContain("remove-this");
  });
});

describe("FootballPredictionSettlementsService read-only behavior", () => {
  it("uses read queries only for settlement listing", async () => {
    const database = {
      execute: vi.fn().mockResolvedValueOnce({ rows: [baseRow()] }).mockResolvedValueOnce({ rows: [{ count: "1" }] }),
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn()
    };
    const service = new FootballPredictionSettlementsService(database as never);

    await service.listSettlements({ settlementStatus: "settled_success", limit: 20, offset: 0 });

    expect(database.execute).toHaveBeenCalledTimes(2);
    expect(database.insert).not.toHaveBeenCalled();
    expect(database.update).not.toHaveBeenCalled();
    expect(database.delete).not.toHaveBeenCalled();
  });
});

function mockService(overrides: Partial<FootballPredictionSettlementsService> = {}): FootballPredictionSettlementsService {
  const item = mapSettlementListRow(baseRow());
  return {
    listSettlements: vi.fn().mockResolvedValue({ items: [item], pagination: { limit: 20, offset: 0, total: 1 } }),
    getSettlement: vi.fn().mockResolvedValue(mapSettlementDetailRow(baseRow(), [])),
    listMatchSettlements: vi.fn().mockResolvedValue({
      match: item.match,
      outputsByRecommendationTier: {
        primary: { label: "Tahminim", items: [item] },
        try: { label: "Denenir", items: [] },
        alternative: { label: "Alternatif", items: [] },
        avoid: { label: "Uzak Dur", items: [] }
      },
      settlementSummary: { success: 1, failed: 0, void: 0, auditOnly: 0, memberVisible: 0, publicEligible: 0, publicPublished: 0 },
      conflictsSummary: { total: 2, blocking: 0, warning: 2, info: 0 },
      note: "Settlement review only."
    }),
    ...overrides
  } as unknown as FootballPredictionSettlementsService;
}

function baseRow() {
  return {
    settlement_id: settlementId,
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
    status: "settled_success",
    consistency_status: "warning",
    consistency_summary: "Consistency dry-run complete.",
    expectation_snapshot: { expectedScoreline: "2-1" },
    conflict_count: 2,
    blocking_conflict_count: 0,
    warning_conflict_count: 2,
    reasoning_summary: "Ev sahibi form ve güç göstergelerinde önde görünüyor.",
    prediction_metadata_json: { safe: true },
    settlement_status: "settled_success",
    actual_result: "1-0",
    settlement_reason: "Home team won at full time.",
    settlement_metadata: { rule: "match_result_1x2" },
    audit_only: false,
    member_visible: false,
    public_eligible: false,
    public_published: false,
    evaluated_at: "2026-04-30T00:00:00.000Z",
    created_at: "2026-04-30T00:00:00.000Z"
  };
}
