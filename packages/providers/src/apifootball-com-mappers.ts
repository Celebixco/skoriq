import type { MatchStatus } from "@sports-data/shared";
import type {
  ProviderCountry,
  ProviderCompetition,
  ProviderFootballMatchLineup,
  ProviderFootballMatchLineupPlayer,
  ProviderFootballPlayerAvailability,
  ProviderFootballMatchScore,
  ProviderFootballStanding,
  ProviderMatch,
  ProviderPlayer,
  ProviderTeam
} from "./provider-dtos.js";
import type {
  APIFootballComCountry,
  APIFootballComEvent,
  APIFootballComLeague,
  APIFootballComLineupPlayer,
  APIFootballComLineupResponse,
  APIFootballComLineupTeamBlock,
  APIFootballComMappingResult,
  APIFootballComStanding,
  APIFootballComTeam,
  APIFootballComTeamPlayer
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

export function mapTeamPlayerToProviderPlayer(team: APIFootballComTeam, input: APIFootballComTeamPlayer): APIFootballComMappingResult<ProviderPlayer> {
  const teamProviderId = optionalString(team.team_key) ?? optionalString(team.team_id);
  if (!teamProviderId) {
    return unresolved("team player cannot be mapped without stable team provider ID", {
      teamName: optionalString(team.team_name)
    });
  }

  const providerEntityId = optionalString(input.player_key) ?? optionalString(input.player_id);
  if (!providerEntityId) {
    return unresolved("team player is missing stable player provider ID", {
      teamProviderId,
      playerName: optionalString(input.player_name)
    });
  }

  try {
    const name = requiredString(input.player_name, "player_name");
    return {
      status: "mapped",
      data: {
        providerEntityId,
        sportProviderId: APIFOOTBALL_COM_FOOTBALL_SPORT_ID,
        currentTeamProviderId: teamProviderId,
        countryProviderId: optionalString(team.country_id),
        name,
        shortName: name,
        slug: name,
        dateOfBirth: normalizeOptionalDate(input.player_birthdate),
        age: parseOptionalInteger(input.player_age),
        position: optionalString(input.player_type),
        jerseyNumber: parseOptionalInteger(input.player_number),
        photoUrl: optionalString(input.player_image),
        metadata: {
          source: APIFOOTBALL_COM_PROVIDER_NAME,
          teamName: optionalString(team.team_name),
          teamProviderId,
          playerCountry: optionalString(input.player_country)
        },
        raw: input
      }
    };
  } catch (error) {
    return unresolved(error instanceof Error ? error.message : "team player could not be mapped", {
      teamProviderId,
      playerId: providerEntityId,
      playerName: optionalString(input.player_name)
    });
  }
}

export function mapTeamPlayerToProviderAvailability(
  team: APIFootballComTeam,
  input: APIFootballComTeamPlayer
): APIFootballComMappingResult<ProviderFootballPlayerAvailability> {
  const providerPlayerId = optionalString(input.player_key) ?? optionalString(input.player_id);
  const teamProviderId = optionalString(team.team_key) ?? optionalString(team.team_id);
  if (!teamProviderId) {
    return unresolved("team availability cannot be mapped without stable team provider ID", {
      teamName: optionalString(team.team_name)
    });
  }

  const status = mapAvailabilityStatus(input.player_injured);
  if (!status) {
    return unresolved("provider player row does not indicate an actionable availability status", {
      teamProviderId,
      playerId: providerPlayerId,
      playerName: optionalString(input.player_name)
    });
  }

  try {
    return {
      status: "mapped",
      data: {
        providerPlayerId,
        sportProviderId: APIFOOTBALL_COM_FOOTBALL_SPORT_ID,
        teamProviderId,
        playerName: requiredString(input.player_name, "player_name"),
        status,
        reason: optionalString(input.player_reason),
        injuryType: optionalString(input.injury_type),
        expectedReturnDate: normalizeOptionalDate(input.expected_return_date ?? input.expected_return),
        sourceQuality: "provider_explicit",
        metadata: {
          source: APIFOOTBALL_COM_PROVIDER_NAME,
          teamName: optionalString(team.team_name)
        }
      }
    };
  } catch (error) {
    return unresolved(error instanceof Error ? error.message : "team availability could not be mapped", {
      teamProviderId,
      playerId: providerPlayerId,
      playerName: optionalString(input.player_name)
    });
  }
}

export function mapLineupResponseToProviderLineups(input: APIFootballComLineupResponse): APIFootballComMappingResult<ProviderFootballMatchLineup>[] {
  const matchProviderId = optionalString(input.match_id);
  if (!matchProviderId) {
    return [unresolved("lineup response is missing stable match provider ID")];
  }

  return extractLineupBlocks(input).map((block) => mapLineupBlockToProviderLineup(matchProviderId, block));
}

export function mapLineupBlockToProviderLineup(
  matchProviderId: string,
  input: APIFootballComLineupTeamBlock
): APIFootballComMappingResult<ProviderFootballMatchLineup> {
  const teamProviderId = optionalString(input.team_key) ?? optionalString(input.team_id);
  if (!teamProviderId) {
    return unresolved("lineup block is missing stable team provider ID", {
      matchProviderId,
      teamName: optionalString(input.team_name)
    });
  }

  return {
    status: "mapped",
    data: {
      providerMatchId: matchProviderId,
      teamProviderId,
      teamName: optionalString(input.team_name),
      formation: optionalString(input.formation),
      confirmed: parseOptionalBoolean(input.lineup_confirmed) ?? parseOptionalBoolean(input.confirmed) ?? false,
      starting: normalizeLineupPlayers(input.starting_lineups ?? input.startingLineups, "starting"),
      substitutes: normalizeLineupPlayers(input.substitutes, "substitute"),
      unavailable: [
        ...normalizeLineupPlayers(input.unavailable_players ?? input.missing_players, "unavailable"),
        ...normalizeCoachRows(input.coach)
      ],
      metadata: {
        source: APIFOOTBALL_COM_PROVIDER_NAME
      }
    }
  };
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

function extractLineupBlocks(input: APIFootballComLineupResponse): APIFootballComLineupTeamBlock[] {
  if (Array.isArray(input.lineups) && input.lineups.length > 0) {
    return input.lineups;
  }

  const blocks: APIFootballComLineupTeamBlock[] = [];
  if (input.home && typeof input.home === "object") blocks.push(input.home);
  if (input.away && typeof input.away === "object") blocks.push(input.away);
  return blocks;
}

function normalizeLineupPlayers(
  players: APIFootballComLineupPlayer[] | undefined,
  role: "starting" | "substitute" | "unavailable"
): ProviderFootballMatchLineupPlayer[] {
  return (Array.isArray(players) ? players : []).reduce<ProviderFootballMatchLineupPlayer[]>((acc, player, index) => {
      const playerName = optionalString(player.player_name) ?? optionalString(player.player) ?? optionalString(player.lineup_player);
      if (!playerName) return acc;
      acc.push({
        providerPlayerId:
          optionalString(player.player_key) ?? optionalString(player.player_id) ?? optionalString(player.lineups_player_id),
        playerName,
        role,
        position: optionalString(player.player_position) ?? optionalString(player.lineup_position) ?? optionalString(player.player_type),
        shirtNumber: parseOptionalInteger(player.player_number) ?? parseOptionalInteger(player.lineup_number),
        orderIndex: index,
        metadata: {
          source: APIFOOTBALL_COM_PROVIDER_NAME
        }
      } satisfies ProviderFootballMatchLineupPlayer);
      return acc;
    }, []);
}

function normalizeCoachRows(coaches: unknown): ProviderFootballMatchLineupPlayer[] {
  return (Array.isArray(coaches) ? coaches : []).reduce<ProviderFootballMatchLineupPlayer[]>((acc, coach, index) => {
      const coachName =
        typeof coach === "object" && coach !== null
          ? optionalString((coach as Record<string, unknown>).coach_name) ?? optionalString((coach as Record<string, unknown>).coach)
          : undefined;
      if (!coachName) return acc;
      acc.push({
        playerName: coachName,
        role: "coach",
        orderIndex: index,
        metadata: {
          source: APIFOOTBALL_COM_PROVIDER_NAME
        }
      } satisfies ProviderFootballMatchLineupPlayer);
      return acc;
    }, []);
}

function parseOptionalBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "confirmed"].includes(normalized)) return true;
    if (["0", "false", "no", "unconfirmed"].includes(normalized)) return false;
  }
  return undefined;
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const normalized = String(value).trim();
  return normalized ? normalized : undefined;
}

function normalizeOptionalDate(value: unknown): string | undefined {
  const normalized = optionalString(value);
  if (!normalized) {
    return undefined;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return undefined;
  }
  return normalized;
}

function mapAvailabilityStatus(value: unknown): ProviderFootballPlayerAvailability["status"] | undefined {
  const normalized = optionalString(value)?.toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (["yes", "injured", "true", "1"].includes(normalized)) {
    return "injured";
  }
  if (normalized === "doubtful") {
    return "doubtful";
  }
  if (normalized === "questionable") {
    return "questionable";
  }
  if (["unavailable"].includes(normalized)) {
    return "unavailable";
  }
  return undefined;
}

function unresolved(reason: string, metadata?: Record<string, unknown>): APIFootballComMappingResult<never> {
  return { status: "unresolved", reason, metadata };
}
