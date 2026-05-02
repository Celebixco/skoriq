import { BadRequestException, Controller, Get, Inject, Query, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard.js";
import { FootballPredictionSettlementsService } from "./football-prediction-settlements.service.js";
import type { FootballPredictionResultsFilters } from "./football-prediction-settlements.service.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const statuses = ["won", "lost", "void", "pending", "not_settleable", "missing_score", "unsupported_market"] as const;
const tiers = ["primary", "try", "alternative"] as const;

interface PredictionResultsQuery {
  countryId?: string;
  competitionId?: string;
  teamId?: string;
  matchId?: string;
  status?: string;
  tier?: string;
  marketType?: string;
  from?: string;
  to?: string;
  limit?: string;
  offset?: string;
}

@Controller("football")
@UseGuards(AuthGuard)
export class FootballPredictionResultsController {
  constructor(@Inject(FootballPredictionSettlementsService) private readonly settlementsService: FootballPredictionSettlementsService) {}

  @Get("prediction-results")
  async listPredictionResults(@Query() query: PredictionResultsQuery) {
    return this.settlementsService.listPredictionResults(parsePredictionResultsQuery(query));
  }

  @Get("prediction-results/summary")
  async predictionResultsSummary(@Query() query: PredictionResultsQuery) {
    const parsed = parsePredictionResultsQuery(query);
    const filters = {
      countryId: parsed.countryId,
      competitionId: parsed.competitionId,
      teamId: parsed.teamId,
      matchId: parsed.matchId,
      status: parsed.status,
      tier: parsed.tier,
      marketType: parsed.marketType,
      from: parsed.from,
      to: parsed.to
    };
    return this.settlementsService.getPredictionResultsSummary(filters);
  }
}

export function parsePredictionResultsQuery(query: PredictionResultsQuery): FootballPredictionResultsFilters {
  return {
    countryId: parseOptionalUuid("countryId", query.countryId),
    competitionId: parseOptionalUuid("competitionId", query.competitionId),
    teamId: parseOptionalUuid("teamId", query.teamId),
    matchId: parseOptionalUuid("matchId", query.matchId),
    status: parseOptionalEnum("status", query.status, statuses),
    tier: parseOptionalEnum("tier", query.tier, tiers),
    marketType: query.marketType,
    from: parseOptionalDate("from", query.from),
    to: parseOptionalDate("to", query.to),
    limit: parseLimit(query.limit),
    offset: parseOffset(query.offset)
  };
}

function parseOptionalEnum<T extends readonly string[]>(name: string, value: string | undefined, allowed: T): T[number] | undefined {
  if (value === undefined) return undefined;
  if (!allowed.includes(value)) throw new BadRequestException(`${name} is not supported.`);
  return value;
}

function parseOptionalUuid(name: string, value: string | undefined) {
  if (value === undefined) return undefined;
  if (!uuidPattern.test(value)) throw new BadRequestException(`${name} must be a valid UUID.`);
  return value;
}

function parseOptionalDate(name: string, value: string | undefined) {
  if (value === undefined) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new BadRequestException(`${name} must be a valid date.`);
  return date.toISOString();
}

function parseLimit(value: string | undefined) {
  if (value === undefined) return 50;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) throw new BadRequestException("limit must be between 1 and 100.");
  return parsed;
}

function parseOffset(value: string | undefined) {
  if (value === undefined) return 0;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new BadRequestException("offset must be a non-negative integer.");
  return parsed;
}
