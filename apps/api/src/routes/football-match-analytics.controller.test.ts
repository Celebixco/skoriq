import { BadRequestException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { FootballMatchAnalyticsController, parseListQuery } from "./football-match-analytics.controller.js";
import { mapAnalyticsRow } from "./football-match-analytics.service.js";
import type { FootballMatchAnalyticsResponse, FootballMatchAnalyticsService } from "./football-match-analytics.service.js";

const matchId = "89759e35-758d-416e-b0d3-ad07436c8a9b";

describe("FootballMatchAnalyticsController", () => {
  it("lists read-only analytics summaries", async () => {
    const service = mockService();
    const controller = new FootballMatchAnalyticsController(service);

    const response = await controller.listFootballMatchAnalytics({});

    expect(service.listMatchAnalytics).toHaveBeenCalledWith({
      featureStatus: undefined,
      status: "upcoming",
      analysisWindowStatus: undefined,
      countryId: undefined,
      competitionId: undefined,
      teamId: undefined,
      search: undefined,
      predictionEligible: undefined,
      kuponEligible: undefined,
      hasH2h: undefined,
      hasPrediction: undefined,
      limit: 20,
      offset: 0,
      debug: false
    });
    expect(response.items).toHaveLength(1);
    expect(response.items[0]).toMatchObject({ featureStatus: "ready", predictionEligible: true, kuponEligible: false });
  });

  it("parses list filters for readiness, eligibility, search, competition, team, pagination, and debug", async () => {
    const service = mockService();
    const controller = new FootballMatchAnalyticsController(service);
    const countryId = "a91bf32e-3683-49f6-8077-6247889e58a5";
    const competitionId = "e91bf32e-3683-49f6-8077-6247889e58a5";
    const teamId = "b4235ef3-4d8c-4461-aeec-37e9abef3130";

    await controller.listFootballMatchAnalytics({
      featureStatus: "ready",
      status: "upcoming",
      analysisWindowStatus: "within_window",
      predictionEligible: "true",
      kuponEligible: "false",
      hasH2h: "true",
      hasPrediction: "true",
      countryId,
      competitionId,
      teamId,
      search: " Arsenal ",
      limit: "10",
      offset: "5",
      debug: "true"
    });

    expect(service.listMatchAnalytics).toHaveBeenCalledWith({
      featureStatus: "ready",
      status: "upcoming",
      analysisWindowStatus: "within_window",
      predictionEligible: true,
      kuponEligible: false,
      hasH2h: true,
      hasPrediction: true,
      countryId,
      competitionId,
      teamId,
      search: "Arsenal",
      limit: 10,
      offset: 5,
      debug: true
    });
  });

  it("accepts expanded list requests for frontend quick filters", () => {
    expect(parseListQuery({ limit: "200", offset: "0" })).toMatchObject({
      status: "upcoming",
      limit: 200,
      offset: 0
    });
  });

  it("rejects invalid list query values", () => {
    expect(() => parseListQuery({ competitionId: "not-a-uuid" })).toThrow(BadRequestException);
    expect(() => parseListQuery({ teamId: "not-a-uuid" })).toThrow(BadRequestException);
    expect(() => parseListQuery({ countryId: "not-a-uuid" })).toThrow(BadRequestException);
    expect(() => parseListQuery({ featureStatus: "excellent" })).toThrow(BadRequestException);
    expect(() => parseListQuery({ status: "finished" })).toThrow(BadRequestException);
    expect(() => parseListQuery({ analysisWindowStatus: "next_week" })).toThrow(BadRequestException);
    expect(() => parseListQuery({ predictionEligible: "yes" })).toThrow(BadRequestException);
    expect(() => parseListQuery({ kuponEligible: "maybe" })).toThrow(BadRequestException);
    expect(() => parseListQuery({ hasH2h: "yes" })).toThrow(BadRequestException);
    expect(() => parseListQuery({ hasPrediction: "maybe" })).toThrow(BadRequestException);
    expect(() => parseListQuery({ search: "x".repeat(81) })).toThrow(BadRequestException);
    expect(() => parseListQuery({ limit: "201" })).toThrow(BadRequestException);
    expect(() => parseListQuery({ offset: "-1" })).toThrow(BadRequestException);
  });

  it("returns a read-only analytics report for a valid match", async () => {
    const service = mockService();
    const controller = new FootballMatchAnalyticsController(service);

    const response = await controller.getFootballMatchAnalytics(matchId);

    expect(service.getMatchAnalytics).toHaveBeenCalledWith(matchId, false);
    expect(response).toMatchObject({
      featureStatus: "ready",
      predictionEligible: true,
      kuponEligible: false,
      confidenceCeiling: 65
    });
  });

  it("returns 400 for invalid UUID", async () => {
    const controller = new FootballMatchAnalyticsController(mockService());

    await expect(controller.getFootballMatchAnalytics("not-a-uuid")).rejects.toBeInstanceOf(BadRequestException);
  });

  it("passes debug=true through to include source references", async () => {
    const service = mockService();
    const controller = new FootballMatchAnalyticsController(service);

    await controller.getFootballMatchAnalytics(matchId, "true");

    expect(service.getMatchAnalytics).toHaveBeenCalledWith(matchId, true);
  });

  it("propagates missing match and missing snapshot domain errors as 404", async () => {
    const missingMatchService = mockService({ getMatchAnalytics: vi.fn().mockRejectedValue(new NotFoundException("Football match not found.")) });
    const missingSnapshotService = mockService({
      getMatchAnalytics: vi.fn().mockRejectedValue(new NotFoundException("Football match analytics feature snapshot not found. Build the feature snapshot first."))
    });

    await expect(new FootballMatchAnalyticsController(missingMatchService).getFootballMatchAnalytics(matchId)).rejects.toBeInstanceOf(NotFoundException);
    await expect(new FootballMatchAnalyticsController(missingSnapshotService).getFootballMatchAnalytics(matchId)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("mapAnalyticsRow", () => {
  it("excludes source IDs by default and keeps kupon eligibility false", () => {
    const response = mapAnalyticsRow(baseRow(), false);

    expect(response.debug).toBeUndefined();
    expect(JSON.stringify(response)).not.toContain("home-form-1");
    expect(response.kuponEligible).toBe(false);
  });

  it("includes source IDs and metadata only with debug=true", () => {
    const response = mapAnalyticsRow(baseRow(), true);

    expect(response.debug).toMatchObject({
      sourceFeatureIds: {
        homeFormFeatureId: "home-form-1",
        awayFormFeatureId: "away-form-1",
        h2hFeatureId: "h2h-1"
      }
    });
  });

  it("does not include secrets, raw provider payloads, or credentials", () => {
    const response = mapAnalyticsRow(baseRow(), true);
    const serialized = JSON.stringify(response);

    expect(serialized).not.toContain("APIFOOTBALL_COM_API_KEY");
    expect(serialized).not.toContain("DATABASE_URL");
    expect(serialized).not.toContain("postgres://");
    expect(serialized).not.toContain("raw_provider_payload");
  });

  it("maps competition object and list-safe response fields", () => {
    const response = mapAnalyticsRow(baseRow(), false);

    expect(response.match.competition).toEqual({
      id: "competition-1",
      name: "Bundesliga",
      country: "Germany"
    });
    expect(response.homeForm).toMatchObject({ sampleSize: 5, coverageScore: 70, scope: "home", windowSize: 5 });
    expect(response.awayForm).toMatchObject({ sampleSize: 4, coverageScore: 58, scope: "away", windowSize: 5 });
  });
});

function mockService(overrides: Partial<FootballMatchAnalyticsService> = {}): FootballMatchAnalyticsService {
  return {
    getMatchAnalytics: vi.fn().mockResolvedValue(baseResponse),
    listMatchAnalytics: vi.fn().mockResolvedValue({
      items: [baseResponse],
      pagination: {
        limit: 20,
        offset: 0,
        total: 1
      }
    }),
    ...overrides
  } as unknown as FootballMatchAnalyticsService;
}

const baseResponse: FootballMatchAnalyticsResponse = {
  match: {
    matchId,
    competition: {
      id: "competition-1",
      name: "Bundesliga",
      country: "Germany"
    },
    kickoffAt: "2026-04-26T17:30:00.000Z",
    status: "not_started",
    homeTeam: {
      id: "team-home",
      name: "Borussia Dortmund",
      logoUrl: "https://example.test/dortmund.png"
    },
    awayTeam: {
      id: "team-away",
      name: "Freiburg",
      logoUrl: "https://example.test/freiburg.png"
    }
  },
  featureStatus: "ready",
  predictionEligible: true,
  kuponEligible: false,
  confidenceCeiling: 65,
  combinedCoverageScore: 64,
  homeForm: {
    sampleSize: 5,
    coverageScore: 70,
    scope: "home",
    windowSize: 5
  },
  awayForm: {
    sampleSize: 4,
    coverageScore: 58,
    scope: "away",
    windowSize: 5
  },
  h2h: {
    sampleSize: 0,
    coverageScore: 0,
    h2hMissing: true
  },
  positiveSignals: ["Minimum MVP feature readiness is satisfied."],
  riskFactors: ["Head-to-head history is missing or zero-sample, so confidence is capped."],
  missingDataWarnings: ["Head-to-head sample is unavailable for this matchup."],
  summary: "Feature readiness is ready; team-form coverage is sufficient for MVP prediction analysis, but missing H2H caps confidence at 65."
};

function baseRow() {
  return {
    match_id: matchId,
    competition_id: "competition-1",
    competition: "Bundesliga",
    country: "Germany",
    kickoff_at: new Date("2026-04-26T17:30:00.000Z"),
    status: "not_started",
    home_team_id: "team-home",
    home_team: "Borussia Dortmund",
    home_team_logo_url: "https://example.test/dortmund.png",
    away_team_id: "team-away",
    away_team: "Freiburg",
    away_team_logo_url: "https://example.test/freiburg.png",
    feature_status: "ready",
    home_form_feature_id: "home-form-1",
    away_form_feature_id: "away-form-1",
    h2h_feature_id: "h2h-1",
    home_form_coverage_score: "70.00",
    away_form_coverage_score: "58.00",
    h2h_coverage_score: "0.00",
    combined_coverage_score: "64.00",
    metadata_json: {
      h2hMissing: true,
      sampleSizes: {
        homeForm: 5,
        awayForm: 4,
        h2h: 0
      },
      coverageFormula: "team_form_only_h2h_missing"
    },
    home_form_scope: "home",
    home_form_window_size: 5,
    away_form_scope: "away",
    away_form_window_size: 5
  };
}
