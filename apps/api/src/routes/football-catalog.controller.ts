import { BadRequestException, Controller, Get, Inject, Param, Query, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard.js";
import { FootballCatalogService } from "./football-catalog.service.js";
import type { FootballCompetitionsFilters, FootballTeamsFilters } from "./football-catalog.service.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const teamsDefaultLimit = 50;
const listDefaultLimit = 50;
const maxLimit = 100;

interface FootballTeamsQuery {
  competitionId?: string;
  search?: string;
  limit?: string;
  offset?: string;
}

interface FootballCompetitionsQuery {
  limit?: string;
  offset?: string;
}

@Controller("football")
@UseGuards(AuthGuard)
export class FootballCatalogController {
  constructor(@Inject(FootballCatalogService) private readonly catalogService: FootballCatalogService) {}

  @Get("teams")
  async listFootballTeams(@Query() query: FootballTeamsQuery) {
    return this.catalogService.listTeams(parseTeamsQuery(query));
  }

  @Get("teams/:teamId/profile")
  async getFootballTeamProfile(@Param("teamId") teamId: string) {
    validateUuid("teamId", teamId);
    return this.catalogService.getTeamProfile(teamId);
  }

  @Get("teams/:teamId/availability")
  async getFootballTeamAvailability(@Param("teamId") teamId: string) {
    validateUuid("teamId", teamId);
    return this.catalogService.getTeamAvailability(teamId);
  }

  @Get("teams/:teamId/players")
  async getFootballTeamPlayers(@Param("teamId") teamId: string) {
    validateUuid("teamId", teamId);
    return this.catalogService.getTeamPlayers(teamId);
  }

  @Get("teams/:teamId")
  async getFootballTeam(@Param("teamId") teamId: string) {
    validateUuid("teamId", teamId);
    return this.catalogService.getTeam(teamId);
  }

  @Get("countries")
  async listFootballCountries() {
    return this.catalogService.listCountries();
  }

  @Get("countries/:countryId/competitions")
  async listFootballCountryCompetitions(@Param("countryId") countryId: string) {
    validateUuid("countryId", countryId);
    return this.catalogService.listCompetitionsForCountry(countryId);
  }

  @Get("competitions")
  async listFootballCompetitions(@Query() query: FootballCompetitionsQuery) {
    return this.catalogService.listCompetitions(parseCompetitionsQuery(query));
  }

  @Get("competitions/:competitionId/profile")
  async getFootballCompetitionProfile(@Param("competitionId") competitionId: string) {
    validateUuid("competitionId", competitionId);
    return this.catalogService.getCompetitionProfile(competitionId);
  }

  @Get("competitions/:competitionId")
  async getFootballCompetition(@Param("competitionId") competitionId: string) {
    validateUuid("competitionId", competitionId);
    return this.catalogService.getCompetition(competitionId);
  }

  @Get("matches/:matchId/player-availability")
  async getFootballMatchPlayerAvailability(@Param("matchId") matchId: string) {
    validateUuid("matchId", matchId);
    return this.catalogService.getMatchPlayerAvailability(matchId);
  }

  @Get("matches/:matchId/lineups")
  async getFootballMatchLineups(@Param("matchId") matchId: string) {
    validateUuid("matchId", matchId);
    return this.catalogService.getMatchLineups(matchId);
  }
}

export function parseTeamsQuery(query: FootballTeamsQuery): FootballTeamsFilters {
  return {
    competitionId: parseOptionalUuid("competitionId", query.competitionId),
    search: parseSearch(query.search),
    limit: parseLimit(query.limit, teamsDefaultLimit),
    offset: parseOffset(query.offset)
  };
}

export function parseCompetitionsQuery(query: FootballCompetitionsQuery): FootballCompetitionsFilters {
  return {
    limit: parseLimit(query.limit, listDefaultLimit),
    offset: parseOffset(query.offset)
  };
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

function parseSearch(value: string | undefined) {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.length > 80) {
    throw new BadRequestException("search must be 80 characters or fewer.");
  }
  return trimmed;
}

function parseLimit(value: string | undefined, fallback: number) {
  if (value === undefined) return fallback;
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
