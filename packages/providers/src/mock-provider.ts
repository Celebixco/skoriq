import type { SportsDataProvider } from "./sports-data-provider.js";
import type { ProviderFetchResult } from "./provider-result.js";

export class MockSportsDataProvider implements SportsDataProvider {
  readonly name = "mock";

  constructor(options: { environment?: { nodeEnv?: string } } = {}) {
    const nodeEnv = options.environment?.nodeEnv ?? process.env.NODE_ENV;
    if (nodeEnv === "production") {
      throw new Error("Mock sports data provider is forbidden in production.");
    }
  }

  async getSports() {
    return this.result("getSports", {}, [{ providerEntityId: "football", name: "Football", slug: "football" }]);
  }

  async getCountries() {
    return this.result("getCountries", {}, [{ providerEntityId: "england", name: "England", code: "GB-ENG" }]);
  }

  async getCompetitions(params = {}) {
    return this.result("getCompetitions", params, [
      { providerEntityId: "premier-league", sportProviderId: "football", countryProviderId: "england", name: "Premier League", slug: "premier-league" }
    ]);
  }

  async getSeasons(competitionId: string) {
    return this.result("getSeasons", { competitionId }, [{ providerEntityId: `${competitionId}:2025-2026`, competitionProviderId: competitionId, name: "2025/2026", isCurrent: true }], competitionId);
  }

  async getTeams(params = {}) {
    return this.result("getTeams", params, []);
  }

  async getPlayers(teamId: string) {
    return this.result("getPlayers", { teamId }, [], teamId);
  }

  async getUpcomingMatches(params = {}) {
    return this.result("getUpcomingMatches", params, []);
  }

  async getFinishedMatches(params = {}) {
    return this.result("getFinishedMatches", params, []);
  }

  async getMatchDetails(matchId: string) {
    return this.result("getMatchDetails", { matchId }, {
      providerEntityId: matchId,
      sportProviderId: "football",
      competitionProviderId: "premier-league",
      homeTeamProviderId: "home",
      awayTeamProviderId: "away",
      scheduledStartAt: new Date().toISOString(),
      status: "scheduled" as const
    }, matchId);
  }

  async getMatchEvents(matchId: string) {
    return this.result("getMatchEvents", { matchId }, [], matchId);
  }

  async getMatchStatistics(matchId: string) {
    return this.result("getMatchStatistics", { matchId }, [], matchId);
  }

  async getStandings(params = { competitionProviderId: "premier-league", seasonProviderId: "premier-league:2025-2026" }) {
    return this.result("getStandings", params, []);
  }

  private result<TData>(endpoint: string, requestParams: Record<string, unknown>, data: TData, providerEntityId?: string): ProviderFetchResult<TData> {
    const fetchedAt = new Date().toISOString();
    return {
      data,
      rawPayload: data,
      metadata: {
        provider: this.name,
        endpoint,
        requestParams,
        requestParamsHashInput: requestParams,
        providerEntityId,
        durationMs: 0,
        fetchedAt
      }
    };
  }
}
