import { BadRequestException, Controller, Get, Inject, Param, Query, UseGuards } from "@nestjs/common";
import { footballPredictionConsistencyStatuses, footballPredictionSettlementStatuses } from "@sports-data/shared";
import { AdminGuard } from "../auth/admin.guard.js";
import { AuthGuard } from "../auth/auth.guard.js";
import { FootballPublicEligibilityService } from "./football-public-eligibility.service.js";
import type { FootballPublicEligibilityFilters } from "./football-public-eligibility.service.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const recommendationTiers = ["primary", "try", "alternative", "avoid"] as const;
const defaultLimit = 20;
const maxLimit = 100;

interface FootballPublicEligibilityQuery {
  matchId?: string;
  predictionId?: string;
  settlementStatus?: string;
  recommendationTier?: string;
  consistencyStatus?: string;
  limit?: string;
  offset?: string;
}

@Controller("football")
@UseGuards(AuthGuard, AdminGuard)
export class FootballPublicEligibilityController {
  constructor(@Inject(FootballPublicEligibilityService) private readonly publicEligibilityService: FootballPublicEligibilityService) {}

  @Get("public-eligibility/evaluate")
  @UseGuards(AuthGuard, AdminGuard)
  async evaluate(@Query() query: FootballPublicEligibilityQuery) {
    return this.publicEligibilityService.evaluate(parsePublicEligibilityQuery(query));
  }

  @Get("matches/:matchId/public-eligibility")
  @UseGuards(AuthGuard, AdminGuard)
  async evaluateMatch(@Param("matchId") matchId: string) {
    validateUuid("matchId", matchId);
    return this.publicEligibilityService.evaluateMatch(matchId);
  }
}

export function parsePublicEligibilityQuery(query: FootballPublicEligibilityQuery): FootballPublicEligibilityFilters {
  return {
    matchId: parseOptionalUuid("matchId", query.matchId),
    predictionId: parseOptionalUuid("predictionId", query.predictionId),
    settlementStatus: parseSettlementStatus(query.settlementStatus),
    recommendationTier: parseRecommendationTier(query.recommendationTier),
    consistencyStatus: parseConsistencyStatus(query.consistencyStatus),
    limit: parseLimit(query.limit),
    offset: parseOffset(query.offset)
  };
}

function parseSettlementStatus(value: string | undefined) {
  if (value === undefined) return undefined;
  if (!footballPredictionSettlementStatuses.includes(value as (typeof footballPredictionSettlementStatuses)[number])) {
    throw new BadRequestException("settlementStatus must be settled_success, settled_failed, or settled_void.");
  }
  return value;
}

function parseConsistencyStatus(value: string | undefined) {
  if (value === undefined) return undefined;
  if (!footballPredictionConsistencyStatuses.includes(value as (typeof footballPredictionConsistencyStatuses)[number])) {
    throw new BadRequestException("consistencyStatus must be unchecked, passed, warning, or blocked.");
  }
  return value;
}

function parseRecommendationTier(value: string | undefined) {
  if (value === undefined) return undefined;
  if (!recommendationTiers.includes(value as (typeof recommendationTiers)[number])) {
    throw new BadRequestException("recommendationTier must be primary, try, alternative, or avoid.");
  }
  return value;
}

function parseOptionalUuid(name: string, value: string | undefined) {
  if (value === undefined) return undefined;
  validateUuid(name, value);
  return value;
}

function validateUuid(name: string, value: string) {
  if (!uuidPattern.test(value)) {
    throw new BadRequestException(`${name} must be a valid UUID.`);
  }
}

function parseLimit(value: string | undefined) {
  if (value === undefined) return defaultLimit;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maxLimit) {
    throw new BadRequestException(`limit must be between 1 and ${maxLimit}.`);
  }
  return parsed;
}

function parseOffset(value: string | undefined) {
  if (value === undefined) return 0;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new BadRequestException("offset must be a non-negative integer.");
  }
  return parsed;
}
