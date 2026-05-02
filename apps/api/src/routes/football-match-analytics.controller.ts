import { BadRequestException, Controller, Get, Inject, Param, Query, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard.js";
import { FootballMatchAnalyticsService } from "./football-match-analytics.service.js";
import type { FootballMatchAnalyticsListFilters } from "./football-match-analytics.service.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const featureStatuses = ["ready", "partial", "insufficient_data"] as const;
const defaultLimit = 20;
const maxLimit = 100;

interface FootballMatchAnalyticsListQuery {
  featureStatus?: string;
  predictionEligible?: string;
  kuponEligible?: string;
  competitionId?: string;
  teamId?: string;
  limit?: string;
  offset?: string;
  debug?: string;
}

@Controller("analytics/football/matches")
@UseGuards(AuthGuard)
export class FootballMatchAnalyticsController {
  constructor(@Inject(FootballMatchAnalyticsService) private readonly analyticsService: FootballMatchAnalyticsService) {}

  @Get()
  async listFootballMatchAnalytics(@Query() query: FootballMatchAnalyticsListQuery) {
    return this.analyticsService.listMatchAnalytics(parseListQuery(query));
  }

  @Get(":matchId")
  async getFootballMatchAnalytics(@Param("matchId") matchId: string, @Query("debug") debug?: string) {
    if (!uuidPattern.test(matchId)) {
      throw new BadRequestException("matchId must be a valid UUID.");
    }

    return this.analyticsService.getMatchAnalytics(matchId, parseOptionalBoolean("debug", debug) ?? false);
  }
}

export function parseListQuery(query: FootballMatchAnalyticsListQuery): FootballMatchAnalyticsListFilters {
  const featureStatus = parseFeatureStatus(query.featureStatus);
  const competitionId = parseOptionalUuid("competitionId", query.competitionId);
  const teamId = parseOptionalUuid("teamId", query.teamId);
  const predictionEligible = parseOptionalBoolean("predictionEligible", query.predictionEligible);
  const kuponEligible = parseOptionalBoolean("kuponEligible", query.kuponEligible);
  const limit = parseLimit(query.limit);
  const offset = parseOffset(query.offset);
  const debug = parseOptionalBoolean("debug", query.debug) ?? false;

  return {
    featureStatus,
    competitionId,
    teamId,
    predictionEligible,
    kuponEligible,
    limit,
    offset,
    debug
  };
}

function parseFeatureStatus(value: string | undefined): FootballMatchAnalyticsListFilters["featureStatus"] {
  if (value === undefined) return undefined;
  if (!featureStatuses.includes(value as (typeof featureStatuses)[number])) {
    throw new BadRequestException("featureStatus must be ready, partial, or insufficient_data.");
  }
  return value as FootballMatchAnalyticsListFilters["featureStatus"];
}

function parseOptionalUuid(name: string, value: string | undefined) {
  if (value === undefined) return undefined;
  if (!uuidPattern.test(value)) {
    throw new BadRequestException(`${name} must be a valid UUID.`);
  }
  return value;
}

function parseOptionalBoolean(name: string, value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new BadRequestException(`${name} must be true or false.`);
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
