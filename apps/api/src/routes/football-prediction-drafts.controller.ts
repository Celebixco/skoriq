import { BadRequestException, Controller, Get, Inject, Param, Query, UseGuards } from "@nestjs/common";
import { footballPredictionConsistencyStatuses, footballPredictionStatuses } from "@sports-data/shared";
import { AdminGuard } from "../auth/admin.guard.js";
import { AuthGuard } from "../auth/auth.guard.js";
import { FootballPredictionDraftsService } from "./football-prediction-drafts.service.js";
import type { FootballPredictionDraftFilters } from "./football-prediction-drafts.service.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const recommendationTiers = ["primary", "try", "alternative", "avoid"] as const;
const defaultLimit = 20;
const maxLimit = 100;

interface FootballPredictionDraftsQuery {
  matchId?: string;
  status?: string;
  consistencyStatus?: string;
  recommendationTier?: string;
  predictionType?: string;
  limit?: string;
  offset?: string;
}

@Controller("football")
@UseGuards(AuthGuard, AdminGuard)
export class FootballPredictionDraftsController {
  constructor(@Inject(FootballPredictionDraftsService) private readonly draftsService: FootballPredictionDraftsService) {}

  @Get("predictions/drafts")
  @UseGuards(AuthGuard, AdminGuard)
  async listDrafts(@Query() query: FootballPredictionDraftsQuery) {
    return this.draftsService.listDrafts(parseDraftsQuery(query));
  }

  @Get("predictions/drafts/:predictionId")
  @UseGuards(AuthGuard, AdminGuard)
  async getDraft(@Param("predictionId") predictionId: string) {
    validateUuid("predictionId", predictionId);
    return this.draftsService.getDraft(predictionId);
  }

  @Get("matches/:matchId/prediction-drafts")
  @UseGuards(AuthGuard, AdminGuard)
  async listMatchDrafts(@Param("matchId") matchId: string) {
    validateUuid("matchId", matchId);
    return this.draftsService.listMatchDrafts(matchId);
  }
}

export function parseDraftsQuery(query: FootballPredictionDraftsQuery): FootballPredictionDraftFilters {
  return {
    matchId: parseOptionalUuid("matchId", query.matchId),
    status: parseStatus(query.status),
    consistencyStatus: parseConsistencyStatus(query.consistencyStatus),
    recommendationTier: parseRecommendationTier(query.recommendationTier),
    predictionType: parsePredictionType(query.predictionType),
    limit: parseLimit(query.limit),
    offset: parseOffset(query.offset)
  };
}

function parseStatus(value: string | undefined) {
  if (value === undefined) return "draft";
  if (!footballPredictionStatuses.includes(value as (typeof footballPredictionStatuses)[number])) {
    throw new BadRequestException("status must be a valid football prediction status.");
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

function parsePredictionType(value: string | undefined) {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.length > 80) {
    throw new BadRequestException("predictionType must be 80 characters or fewer.");
  }
  return trimmed;
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
