import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { AuthGuard } from "../auth/auth.guard.js";
import { FootballPredictionResultsController, parsePredictionResultsQuery } from "./football-prediction-results.controller.js";

const uuid = "89759e35-758d-416e-b0d3-ad07436c8a9b";

describe("FootballPredictionResultsController", () => {
  it("is protected by member auth only and calls safe result services", async () => {
    const guards = Reflect.getMetadata("__guards__", FootballPredictionResultsController);
    expect(guards).toContain(AuthGuard);
    const service = {
      listPredictionResults: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 10, offset: 0 }),
      getPredictionResultsSummary: vi.fn().mockResolvedValue({ totalSettled: 0, won: 0, lost: 0, pending: 0, byCountry: [], byLeague: [], byTier: [], byMarketType: [] })
    };
    const controller = new FootballPredictionResultsController(service as never);

    await controller.listPredictionResults({ competitionId: uuid, status: "won", tier: "primary", search: " Arsenal ", limit: "10", offset: "5" });
    await controller.predictionResultsSummary({ competitionId: uuid, status: "won", tier: "primary", search: " Arsenal " });

    expect(service.listPredictionResults).toHaveBeenCalledWith(expect.objectContaining({ competitionId: uuid, status: "won", tier: "primary", search: "Arsenal", limit: 10, offset: 5 }));
    expect(service.getPredictionResultsSummary).toHaveBeenCalledWith(expect.objectContaining({ competitionId: uuid, status: "won", tier: "primary", search: "Arsenal" }));
    expect(JSON.stringify(service.listPredictionResults.mock.calls)).not.toContain("provider_entity_id");
  });

  it("rejects unsafe or malformed filters", () => {
    expect(() => parsePredictionResultsQuery({ competitionId: "not-a-uuid" })).toThrow(BadRequestException);
    expect(() => parsePredictionResultsQuery({ status: "settled_success" })).toThrow(BadRequestException);
    expect(() => parsePredictionResultsQuery({ tier: "avoid" })).toThrow(BadRequestException);
    expect(() => parsePredictionResultsQuery({ search: "x".repeat(81) })).toThrow(BadRequestException);
    expect(() => parsePredictionResultsQuery({ limit: "1000" })).toThrow(BadRequestException);
    expect(() => parsePredictionResultsQuery({ offset: "-1" })).toThrow(BadRequestException);
  });
});
