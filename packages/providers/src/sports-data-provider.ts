import type {
  ProviderCompetition,
  ProviderCompetitionParams,
  ProviderCountry,
  ProviderMatch,
  ProviderMatchDetail,
  ProviderMatchEvent,
  ProviderMatchQuery,
  ProviderMatchStatistics,
  ProviderPlayer,
  ProviderSeason,
  ProviderSport,
  ProviderStanding,
  ProviderStandingParams,
  ProviderTeam,
  ProviderTeamParams
} from "./provider-dtos.js";
import type { ProviderFetchResult } from "./provider-result.js";

export interface SportsDataProvider {
  name: string;

  getSports(): Promise<ProviderFetchResult<ProviderSport[]>>;
  getCountries(): Promise<ProviderFetchResult<ProviderCountry[]>>;
  getCompetitions(params: ProviderCompetitionParams): Promise<ProviderFetchResult<ProviderCompetition[]>>;
  getSeasons(competitionId: string): Promise<ProviderFetchResult<ProviderSeason[]>>;
  getTeams(params: ProviderTeamParams): Promise<ProviderFetchResult<ProviderTeam[]>>;
  getPlayers(teamId: string): Promise<ProviderFetchResult<ProviderPlayer[]>>;
  getUpcomingMatches(params: ProviderMatchQuery): Promise<ProviderFetchResult<ProviderMatch[]>>;
  getFinishedMatches(params: ProviderMatchQuery): Promise<ProviderFetchResult<ProviderMatch[]>>;
  getMatchDetails(matchId: string): Promise<ProviderFetchResult<ProviderMatchDetail>>;
  getMatchEvents(matchId: string): Promise<ProviderFetchResult<ProviderMatchEvent[]>>;
  getMatchStatistics(matchId: string): Promise<ProviderFetchResult<ProviderMatchStatistics[]>>;
  getStandings(params: ProviderStandingParams): Promise<ProviderFetchResult<ProviderStanding[]>>;
}
