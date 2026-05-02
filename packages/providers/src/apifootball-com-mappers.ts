import type { MatchStatus } from "@sports-data/shared";
import type {
  ProviderCountry,
  ProviderCompetition,
  ProviderFootballMatchScore,
  ProviderFootballStanding,
  ProviderMatch,
  ProviderTeam
} from "./provider-dtos.js";
import type {
  APIFootballComCountry,
  APIFootballComEvent,
  APIFootballComLeague,
  APIFootballComMappingResult,
  APIFootballComStanding,
  APIFootballComTeam
} from "./apifootball-com-types.js";

export const APIFOOTBALL_COM_PROVIDER_NAME = "apifootball-com";
export const APIFOOTBALL_COM_FOOTBALL_SPORT_ID = "football";

export function mapCountryToProviderCountry(input: APIFootballComCountry): ProviderCountry {
  const providerEntityId = requiredString(input.country_id, "country_id");
  const name = requiredString(input.country_name, "country_name");

  return {
    providerEntityId,
    name,
    metadata: {
      source: APIFOOTBALL_COM_PROVIDER_NAME
    },
    raw: input
  };
}

export function mapLeagueToProviderCompetition(input: APIFootballComLeague): ProviderCompetition {
  const providerEntityId = requiredString(input.league_id, "league_id");
  const name = requiredString(input.league_name, "league_name");

  return {
    providerEntityId,
    sportProviderId: APIFOOTBALL_COM_FOOTBALL_SPORT_ID,
    countryProviderId: optionalString(input.country_id),
    name,
    metadata: {
      source: APIFOOTBALL_COM_PROVIDER_NAME,
      countryName: optionalString(input.country_name)
    },
    raw: input
  };
}

export function mapEventToProviderMatch(input: APIFootballComEvent): APIFootballComMappingResult<ProviderMatch> {
  const homeTeamProviderId = optionalString(input.match_hometeam_id);
  const awayTeamProviderId = optionalString(input.match_awayteam_id);

  if (!homeTeamProviderId || !awayTeamProviderId) {
    return unresolved("event is missing stable home or away team provider ID", {
      matchId: optionalString(input.match_id),
      homeTeamName: optionalString(input.match_hometeam_name),
      awayTeamName: optionalString(input.match_awayteam_name)
    });
  }

  try {
    const status = mapAPIFootballComStatus(input.match_status);
    return {
      status: "mapped",
      data: {
        providerEntityId: requiredString(input.match_id, "match_id"),
        sportProviderId: APIFOOTBALL_COM_FOOTBALL_SPORT_ID,
        competitionProviderId: requiredString(input.league_id, "league_id"),
        homeTeamProviderId,
        awayTeamProviderId,
        scheduledStartAt: parseScheduledStartAt(input.match_date, input.match_time),
        status,
        roundName: optionalString(input.match_round),
        venueName: optionalString(input.match_stadium),
        refereeName: optionalString(input.match_referee),
        homeScoreCurrent: parseOptionalInteger(input.match_hometeam_score),
        awayScoreCurrent: parseOptionalInteger(input.match_awayteam_score),
        homeScoreHalfTime: parseOptionalInteger(input.match_hometeam_halftime_score),
        awayScoreHalfTime: parseOptionalInteger(input.match_awayteam_halftime_score),
        metadata: {
          source: APIFOOTBALL_COM_PROVIDER_NAME,
          countryProviderId: optionalString(input.country_id),
          countryName: optionalString(input.country_name),
          leagueName: optionalString(input.league_name),
          matchLive: optionalString(input.match_live),
          homeSystem: optionalString(input.match_hometeam_system),
          awaySystem: optionalString(input.match_awayteam_system),
          rawStatus: optionalString(input.match_status),
          homeTeamName: optionalString(input.match_hometeam_name),
          awayTeamName: optionalString(input.match_awayteam_name),
          homeTeamBadge: optionalString(input.team_home_badge),
          awayTeamBadge: optionalString(input.team_away_badge)
        },
        raw: input
      }
    };
  } catch (error) {
    return unresolved(error instanceof Error ? error.message : "event could not be mapped", {
      matchId: optionalString(input.match_id),
      rawStatus: optionalString(input.match_status)
    });
  }
}

export function mapEventToProviderFootballMatchScore(input: APIFootballComEvent): APIFootballComMappingResult<ProviderFootballMatchScore> {
  try {
    const status = mapAPIFootballComStatus(input.match_status);
    const fullTimeHome = parseOptionalInteger(input.match_hometeam_ft_score) ?? parseOptionalInteger(input.match_hometeam_score);
    const fullTimeAway = parseOptionalInteger(input.match_awayteam_ft_score) ?? parseOptionalInteger(input.match_awayteam_score);

    return {
      status: "mapped",
      data: {
        providerEntityId: requiredString(input.match_id, "match_id"),
        matchProviderId: requiredString(input.match_id, "match_id"),
        homeScoreCurrent: parseOptionalInteger(input.match_hometeam_score),
        awayScoreCurrent: parseOptionalInteger(input.match_awayteam_score),
        homeScoreHalfTime: parseOptionalInteger(input.match_hometeam_halftime_score),
        awayScoreHalfTime: parseOptionalInteger(input.match_awayteam_halftime_score),
        homeScoreFullTime: fullTimeHome,
        awayScoreFullTime: fullTimeAway,
        homeScoreExtraTime: parseOptionalInteger(input.match_hometeam_extra_score),
        awayScoreExtraTime: parseOptionalInteger(input.match_awayteam_extra_score),
        homeScorePenalties: parseOptionalInteger(input.match_hometeam_penalty_score),
        awayScorePenalties: parseOptionalInteger(input.match_awayteam_penalty_score),
        status,
        metadata: {
          source: APIFOOTBALL_COM_PROVIDER_NAME,
          rawStatus: optionalString(input.match_status)
        },
        raw: input
      }
    };
  } catch (error) {
    return unresolved(error instanceof Error ? error.message : "event score could not be mapped", {
      matchId: optionalString(input.match_id),
      rawStatus: optionalString(input.match_status)
    });
  }
}

export function mapStandingToProviderFootballStanding(input: APIFootballComStanding): APIFootballComMappingResult<ProviderFootballStanding> {
  const teamProviderId = optionalString(input.team_id);
  if (!teamProviderId) {
    return unresolved("standing is missing stable team provider ID", {
      teamName: optionalString(input.team_name),
      leagueId: optionalString(input.league_id)
    });
  }

  try {
    const goalsFor = requiredInteger(input.overall_league_GF, "overall_league_GF");
    const goalsAgainst = requiredInteger(input.overall_league_GA, "overall_league_GA");

    return {
      status: "mapped",
      data: {
        providerEntityId: `${requiredString(input.league_id, "league_id")}:${teamProviderId}`,
        competitionProviderId: requiredString(input.league_id, "league_id"),
        teamProviderId,
        position: requiredInteger(input.overall_league_position, "overall_league_position"),
        played: requiredInteger(input.overall_league_payed, "overall_league_payed"),
        wins: requiredInteger(input.overall_league_W, "overall_league_W"),
        draws: requiredInteger(input.overall_league_D, "overall_league_D"),
        losses: requiredInteger(input.overall_league_L, "overall_league_L"),
        goalsFor,
        goalsAgainst,
        goalDifference: goalsFor - goalsAgainst,
        points: requiredInteger(input.overall_league_PTS, "overall_league_PTS"),
        homePlayed: parseOptionalInteger(input.home_league_payed),
        homeWins: parseOptionalInteger(input.home_league_W),
        homeDraws: parseOptionalInteger(input.home_league_D),
        homeLosses: parseOptionalInteger(input.home_league_L),
        homeGoalsFor: parseOptionalInteger(input.home_league_GF),
        homeGoalsAgainst: parseOptionalInteger(input.home_league_GA),
        awayPlayed: parseOptionalInteger(input.away_league_payed),
        awayWins: parseOptionalInteger(input.away_league_W),
        awayDraws: parseOptionalInteger(input.away_league_D),
        awayLosses: parseOptionalInteger(input.away_league_L),
        awayGoalsFor: parseOptionalInteger(input.away_league_GF),
        awayGoalsAgainst: parseOptionalInteger(input.away_league_GA),
        metadata: {
          source: APIFOOTBALL_COM_PROVIDER_NAME,
          countryName: optionalString(input.country_name),
          leagueName: optionalString(input.league_name),
          teamName: optionalString(input.team_name)
        }
      }
    };
  } catch (error) {
    return unresolved(error instanceof Error ? error.message : "standing could not be mapped", {
      teamId: teamProviderId,
      teamName: optionalString(input.team_name),
      leagueId: optionalString(input.league_id)
    });
  }
}

export function mapTeamToProviderTeam(input: APIFootballComTeam): ProviderTeam {
  const providerEntityId = optionalString(input.team_key) ?? optionalString(input.team_id);
  if (!providerEntityId) {
    throw new Error("APIFootball.com team is missing team_key/team_id.");
  }

  const logoUrl = optionalString(input.team_badge) ?? optionalString(input.team_logo) ?? optionalString(input.logo) ?? optionalString(input.badge) ?? optionalString(input.image);

  return {
    providerEntityId,
    sportProviderId: APIFOOTBALL_COM_FOOTBALL_SPORT_ID,
    countryProviderId: optionalString(input.country_id),
    name: requiredString(input.team_name, "team_name"),
    logoUrl,
    venueName: optionalString(input.venue_name) ?? optionalString(input.team_venue),
    foundedYear: parseOptionalInteger(input.founded_year) ?? parseOptionalInteger(input.founded),
    metadata: {
      source: APIFOOTBALL_COM_PROVIDER_NAME,
      countryName: optionalString(input.country_name),
      logoMissing: !logoUrl
    },
    raw: input
  };
}

export function mapTeamToProviderTeamResult(input: APIFootballComTeam): APIFootballComMappingResult<ProviderTeam> {
  try {
    return {
      status: "mapped",
      data: mapTeamToProviderTeam(input)
    };
  } catch (error) {
    return unresolved(error instanceof Error ? error.message : "team could not be mapped", {
      teamId: optionalString(input.team_key) ?? optionalString(input.team_id),
      teamName: optionalString(input.team_name)
    });
  }
}

export function mapAPIFootballComStatus(status: unknown): MatchStatus {
  const normalized = String(status ?? "").trim().toLowerCase();

  if (!normalized || normalized === "-" || normalized === "not started" || normalized === "not_started") {
    return "not_started";
  }

  if (["finished", "ft", "full time", "fulltime"].includes(normalized)) {
    return "finished";
  }

  if (["after extra time", "aet", "extra time"].includes(normalized)) {
    return "after_extra_time";
  }

  if (["after penalties", "penalties", "pen."].includes(normalized)) {
    return "after_penalties";
  }

  if (["postponed", "pst"].includes(normalized)) {
    return "postponed";
  }

  if (["cancelled", "canceled", "cancel"].includes(normalized)) {
    return "cancelled";
  }

  if (["abandoned", "abd"].includes(normalized)) {
    return "abandoned";
  }

  if (["scheduled", "fixture"].includes(normalized)) {
    return "scheduled";
  }

  throw new Error(`Unsupported APIFootball.com match status "${String(status ?? "")}".`);
}

export function parseScheduledStartAt(matchDate: unknown, matchTime: unknown): string {
  const date = requiredString(matchDate, "match_date");
  const time = optionalString(matchTime) ?? "00:00";
  const isoCandidate = `${date}T${time.length === 5 ? `${time}:00` : time}+00:00`;
  const parsed = new Date(isoCandidate);

  if (Number.isNaN(parsed.getTime())) {
    throw new Error("APIFootball.com event has invalid match_date/match_time.");
  }

  return parsed.toISOString();
}

export function parseOptionalInteger(value: unknown): number | undefined {
  const normalized = optionalString(value);
  if (normalized === undefined) {
    return undefined;
  }

  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function requiredInteger(value: unknown, field: string): number {
  const parsed = parseOptionalInteger(value);
  if (parsed === undefined) {
    throw new Error(`APIFootball.com field "${field}" is required.`);
  }

  return parsed;
}

function requiredString(value: unknown, field: string): string {
  const normalized = optionalString(value);
  if (!normalized) {
    throw new Error(`APIFootball.com field "${field}" is required.`);
  }

  return normalized;
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const normalized = String(value).trim();
  return normalized ? normalized : undefined;
}

function unresolved(reason: string, metadata?: Record<string, unknown>): APIFootballComMappingResult<never> {
  return { status: "unresolved", reason, metadata };
}
