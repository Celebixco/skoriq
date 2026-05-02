import { BadRequestException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { AdminGuard } from "../auth/admin.guard.js";
import { AuthGuard } from "../auth/auth.guard.js";
import { FootballPublicEligibilityController, parsePublicEligibilityQuery } from "./football-public-eligibility.controller.js";
import { FootballPublicEligibilityService } from "./football-public-eligibility.service.js";

const matchId = "89759e35-758d-416e-b0d3-ad07436c8a9b";
const predictionId = "db2b0842-117b-46b3-aa4f-c4ae68304e64";

describe("FootballPublicEligibilityController", () => {
  it("is protected by the auth guard", () => {
    const guards = Reflect.getMetadata("__guards__", FootballPublicEligibilityController);

    expect(guards).toContain(AuthGuard);
    expect(guards).toContain(AdminGuard);
    expect(Reflect.getMetadata("__guards__", FootballPublicEligibilityController.prototype.evaluate)).toEqual([AuthGuard, AdminGuard]);
    expect(Reflect.getMetadata("__guards__", FootballPublicEligibilityController.prototype.evaluateMatch)).toEqual([AuthGuard, AdminGuard]);
  });

  it("runs evaluator with safe filters", async () => {
    const service = mockService();
    const controller = new FootballPublicEligibilityController(service);

    await controller.evaluate({
      matchId,
      predictionId,
      settlementStatus: "settled_success",
      consistencyStatus: "warning",
      recommendationTier: "primary",
      limit: "10",
      offset: "5"
    });

    expect(service.evaluate).toHaveBeenCalledWith({
      matchId,
      predictionId,
      settlementStatus: "settled_success",
      consistencyStatus: "warning",
      recommendationTier: "primary",
      limit: 10,
      offset: 5
    });
  });

  it("runs match-specific evaluator", async () => {
    const service = mockService();
    const controller = new FootballPublicEligibilityController(service);

    await controller.evaluateMatch(matchId);

    expect(service.evaluateMatch).toHaveBeenCalledWith(matchId);
  });

  it("rejects invalid query values and UUIDs", async () => {
    const controller = new FootballPublicEligibilityController(mockService());

    await expect(controller.evaluateMatch("not-a-uuid")).rejects.toBeInstanceOf(BadRequestException);
    expect(() => parsePublicEligibilityQuery({ matchId: "not-a-uuid" })).toThrow(BadRequestException);
    expect(() => parsePublicEligibilityQuery({ predictionId: "not-a-uuid" })).toThrow(BadRequestException);
    expect(() => parsePublicEligibilityQuery({ settlementStatus: "won" })).toThrow(BadRequestException);
    expect(() => parsePublicEligibilityQuery({ consistencyStatus: "maybe" })).toThrow(BadRequestException);
    expect(() => parsePublicEligibilityQuery({ recommendationTier: "banko" })).toThrow(BadRequestException);
    expect(() => parsePublicEligibilityQuery({ limit: "101" })).toThrow(BadRequestException);
    expect(() => parsePublicEligibilityQuery({ offset: "-1" })).toThrow(BadRequestException);
  });

  it("propagates missing match as 404", async () => {
    const service = mockService({
      evaluateMatch: vi.fn().mockRejectedValue(new NotFoundException("Football match not found."))
    });
    const controller = new FootballPublicEligibilityController(service);

    await expect(controller.evaluateMatch(matchId)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("FootballPublicEligibilityService read-only behavior", () => {
  it("returns grouped evaluator results without writes or public rows", async () => {
    const database = {
      execute: vi
        .fn()
        .mockResolvedValueOnce({ rows: [eligibleLateRow(), failedRow(), avoidRow()] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ severity: "blocking", conflict_type: "first_half_goal_conflict", reason: "Missing evidence." }] })
        .mockResolvedValueOnce({ rows: [{ count: "3" }] }),
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn()
    };
    const service = new FootballPublicEligibilityService(database as never);

    const response = await service.evaluate({ matchId, limit: 20, offset: 0 });

    expect(response.eligible).toHaveLength(0);
    expect(response.excluded).toHaveLength(3);
    expect(response.summary).toMatchObject({
      eligibleCount: 0,
      excludedCount: 3,
      lateGeneratedCount: 3,
      auditOnlyCount: 1,
      failedCount: 1,
      blockedCount: 1
    });
    expect(response.excluded[0]?.blockers).toContain("generated_after_kickoff");
    expect(response.pagination?.total).toBe(3);
    expect(JSON.stringify(response)).not.toContain("postgres://");
    expect(JSON.stringify(response)).not.toContain("raw_provider_payload");
    expect(database.insert).not.toHaveBeenCalled();
    expect(database.update).not.toHaveBeenCalled();
    expect(database.delete).not.toHaveBeenCalled();
  });
});

function mockService(overrides: Partial<FootballPublicEligibilityService> = {}): FootballPublicEligibilityService {
  return {
    evaluate: vi.fn().mockResolvedValue({ eligible: [], excluded: [], summary: {}, publicSafetyNotes: [] }),
    evaluateMatch: vi.fn().mockResolvedValue({ match: {}, eligible: [], excluded: [], summary: {}, publicSafetyNotes: [] }),
    ...overrides
  } as unknown as FootballPublicEligibilityService;
}

function eligibleLateRow() {
  return {
    prediction_output_id: predictionId,
    match_id: matchId,
    output_status: "settled_success",
    prediction_type: "match_result_1x2",
    prediction_value: "1",
    recommendation_tier: "primary",
    display_label: "Tahminim",
    confidence_score: "65.00",
    consistency_status: "warning",
    blocking_conflict_count: 0,
    generated_at: "2026-04-30T00:00:00.000Z",
    prediction_metadata: { safe: true },
    settlement_status: "settled_success",
    actual_result: "fulltime=3-2",
    settlement_metadata: {},
    competition_id: "competition-1",
    competition: "Bundesliga",
    country: "Germany",
    kickoff_at: "2026-04-26T17:30:00.000Z",
    match_status: "finished",
    home_team_id: "home-1",
    home_team: "Borussia Dortmund",
    home_team_logo_url: null,
    away_team_id: "away-1",
    away_team: "Freiburg",
    away_team_logo_url: null
  };
}

function failedRow() {
  return {
    ...eligibleLateRow(),
    prediction_output_id: "22222222-2222-4222-8222-222222222222",
    prediction_type: "both_teams_to_score",
    prediction_value: "yes",
    recommendation_tier: "try",
    output_status: "settled_failed",
    settlement_status: "settled_failed"
  };
}

function avoidRow() {
  return {
    ...eligibleLateRow(),
    prediction_output_id: "33333333-3333-4333-8333-333333333333",
    prediction_type: "first_half_over_0_5",
    prediction_value: "avoid_missing_first_half_evidence",
    recommendation_tier: "avoid",
    consistency_status: "blocked",
    blocking_conflict_count: 1,
    settlement_metadata: { blockedOrAvoidAuditOnly: true }
  };
}
