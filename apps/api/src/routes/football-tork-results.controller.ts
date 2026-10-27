import { BadRequestException, Controller, Get, Inject, Query, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard.js";
import { FootballTorkResultsService } from "./football-tork-results.service.js";
import type { TorkResultsFilters, TorkResultStatus } from "./football-tork-results.service.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const statuses = ["won", "lost", "pending", "void"] as const;

interface TorkResultsQuery {
  countryId?: string;
  competitionId?: string;
  teamId?: string;
  matchId?: string;
  status?: string;
  search?: string;
  from?: string;
  to?: string;
  limit?: string;
  offset?: string;
}

@Controller("member/football")
@UseGuards(AuthGuard)
export class FootballTorkResultsController {
  constructor(@Inject(FootballTorkResultsService) private readonly service: FootballTorkResultsService) {}

  @Get("tork-prediction-results")
  async listPredictionResults(@Query() query: TorkResultsQuery) {
    return this.service.listResults(parseTorkResultsQuery(query));
  }

  @Get("tork-prediction-results/summary")
  async predictionResultsSummary(@Query() query: TorkResultsQuery) {
    return this.service.getResultsSummary(parseTorkResultsQuery(query));
  }
}

export function parseTorkResultsQuery(query: TorkResultsQuery): TorkResultsFilters {
  return {
    countryId: parseOptionalUuid("countryId", query.countryId),
    competitionId: parseOptionalUuid("competitionId", query.competitionId),
    teamId: parseOptionalUuid("teamId", query.teamId),
    matchId: parseOptionalUuid("matchId", query.matchId),
    status: parseOptionalStatus(query.status),
    search: parseSearch(query.search),
    from: parseOptionalDate("from", query.from),
    to: parseOptionalDate("to", query.to),
    limit: parseLimit(query.limit),
    offset: parseOffset(query.offset)
  };
}

function parseOptionalStatus(value: string | undefined): TorkResultStatus | undefined {
  if (value === undefined || value === "") return undefined;
  if (!statuses.includes(value as (typeof statuses)[number])) throw new BadRequestException("status is not supported.");
  return value as TorkResultStatus;
}

function parseSearch(value: string | undefined) {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (normalized.length > 80) throw new BadRequestException("search must be 80 characters or fewer.");
  return normalized || undefined;
}

function parseOptionalUuid(name: string, value: string | undefined) {
  if (value === undefined || value === "") return undefined;
  if (!uuidPattern.test(value)) throw new BadRequestException(`${name} must be a valid UUID.`);
  return value;
}

function parseOptionalDate(name: string, value: string | undefined) {
  if (value === undefined || value === "") return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new BadRequestException(`${name} must be a valid date.`);
  return date.toISOString();
}

function parseLimit(value: string | undefined) {
  if (value === undefined || value === "") return 50;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) throw new BadRequestException("limit must be between 1 and 100.");
  return parsed;
}

function parseOffset(value: string | undefined) {
  if (value === undefined || value === "") return 0;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new BadRequestException("offset must be a non-negative integer.");
  return parsed;
}
