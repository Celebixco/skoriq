import { describe, expect, it, vi } from "vitest";
import { ProviderRegistry } from "./provider-registry.js";
import { APIFootballComAdapter } from "./apifootball-com-adapter.js";
import { createAPIFootballCredentialResolver } from "./apifootball-com-credentials.js";
import { APIFOOTBALL_COM_API_KEY_QUERY_PARAM, APIFootballComHttpClient, APIFootballComHttpError, redactApiKey } from "./apifootball-com-http.js";
import {
  mapCountryToProviderCountry,
  mapEventToProviderFootballMatchScore,
  mapEventToProviderMatch,
  mapLeagueToProviderCompetition,
  mapStandingToProviderFootballStanding,
  mapTeamToProviderTeam
} from "./apifootball-com-mappers.js";

const apiKey = "placeholder";

describe("APIFootball.com adapter POC", () => {
  it("is disabled by default and does not call HTTP during health checks", async () => {
    const fetchSpy = vi.fn();
    const adapter = new APIFootballComAdapter({
      enabled: false,
      baseUrl: "https://apiv3.apifootball.com/",
      timeoutMs: 15000,
      environment: { nodeEnv: "test" },
      fetchImpl: fetchSpy
    });

    await expect(adapter.healthCheck()).resolves.toMatchObject({
      provider: "apifootball-com",
      status: "not_configured"
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("requires a key when enabled and blocks production usage", () => {
    expect(
      () =>
        new APIFootballComAdapter({
          enabled: true,
          baseUrl: "https://apiv3.apifootball.com/",
          timeoutMs: 15000,
          environment: { nodeEnv: "test" }
        })
    ).toThrow("APIFootball.com adapter requires at least one APIFOOTBALL_COM_API_KEY* value when enabled.");

    expect(
      () =>
        new APIFootballComAdapter({
          enabled: true,
          apiKey,
          baseUrl: "https://apiv3.apifootball.com/",
          timeoutMs: 15000,
          environment: { nodeEnv: "production" }
        })
    ).toThrow("APIFootball.com adapter is blocked in production until explicit production provider approval exists.");
  });

  it("can register the enabled adapter in non-production", () => {
    const adapter = new APIFootballComAdapter({
      enabled: true,
      apiKey,
      baseUrl: "https://apiv3.apifootball.com/",
      timeoutMs: 15000,
      environment: { nodeEnv: "test" },
      fetchImpl: vi.fn()
    });
    const registry = new ProviderRegistry();

    registry.register(adapter);

    expect(registry.get("apifootball-com")).toBe(adapter);
    expect(registry.listCapabilities()["apifootball-com"]).toMatchObject({
      supportsFootball: true,
      supportsBasketball: false,
      supportsScores: true,
      supportsStandings: true,
      supportsTeamStatistics: false
    });
  });

  it("resolves endpoint-specific credentials with safe labels and fallbacks", () => {
    const resolver = createAPIFootballCredentialResolver({
      defaultApiKey: "test-default-key",
      legacyApiKey: "test-legacy-key",
      countriesApiKey: "test-countries-key",
      leaguesApiKey: "test-leagues-key",
      teamsApiKey: "test-teams-key",
      standingsApiKey: "test-standings-key",
      eventsApiKey: "test-events-key",
      resultsApiKey: "test-results-key",
      fixturesApiKey: "test-fixtures-key",
      playersApiKey: "test-players-key",
      statisticsApiKey: "test-statistics-key",
      lineupsApiKey: "test-lineups-key",
      injuriesApiKey: "test-injuries-key"
    });

    expect(resolver.resolveForAction("get_countries")).toEqual({ apiKey: "test-countries-key", credentialLabel: "countries" });
    expect(resolver.resolveForAction("get_leagues")).toEqual({ apiKey: "test-leagues-key", credentialLabel: "leagues" });
    expect(resolver.resolveForAction("get_teams")).toEqual({ apiKey: "test-teams-key", credentialLabel: "teams" });
    expect(resolver.resolveForAction("get_standings")).toEqual({ apiKey: "test-standings-key", credentialLabel: "standings" });
    expect(resolver.resolveForAction("events")).toEqual({ apiKey: "test-events-key", credentialLabel: "events" });
    expect(resolver.resolveForAction("results")).toEqual({ apiKey: "test-results-key", credentialLabel: "results" });
    expect(resolver.resolveForAction("fixtures")).toEqual({ apiKey: "test-fixtures-key", credentialLabel: "fixtures" });
    expect(resolver.resolveForAction("get_players")).toEqual({ apiKey: "test-players-key", credentialLabel: "players" });
    expect(resolver.resolveForAction("get_statistics")).toEqual({ apiKey: "test-statistics-key", credentialLabel: "statistics" });
    expect(resolver.resolveForAction("get_lineups")).toEqual({ apiKey: "test-lineups-key", credentialLabel: "lineups" });
    expect(resolver.resolveForAction("get_injuries")).toEqual({ apiKey: "test-injuries-key", credentialLabel: "injuries" });

    expect(createAPIFootballCredentialResolver({ defaultApiKey: "test-default-key" }).resolveForAction("get_countries")).toEqual({
      apiKey: "test-default-key",
      credentialLabel: "default"
    });
    expect(createAPIFootballCredentialResolver({ legacyApiKey: "test-legacy-key" }).resolveForAction("get_countries")).toEqual({
      apiKey: "test-legacy-key",
      credentialLabel: "legacy"
    });
    expect(createAPIFootballCredentialResolver({}).hasCredentialForAction("get_countries")).toBe(false);
  });

  it("builds request URLs and redacts API keys from safe output and errors", () => {
    const client = new APIFootballComHttpClient({
      apiKey,
      baseUrl: "https://apiv3.apifootball.com/",
      timeoutMs: 15000,
      fetchImpl: vi.fn()
    });

    expect(client.buildRequestUrl({ action: "get_countries" }).searchParams.get(APIFOOTBALL_COM_API_KEY_QUERY_PARAM)).toBe(apiKey);
    expect(client.buildSafeRequestUrl({ action: "get_countries" })).toContain("APIkey=<redacted>");
    expect(client.buildSafeRequestUrl({ action: "get_countries" })).not.toContain(apiKey);
    expect(redactApiKey(`bad url ${apiKey}`, apiKey)).toBe("bad url <redacted>");
    expect(redactApiKey(`https://apiv3.apifootball.com/?action=get_countries&APIkey=${apiKey}`, apiKey)).toBe(
      "https://apiv3.apifootball.com/?action=get_countries&APIkey=<redacted>"
    );
  });

  it("classifies provider authentication failures with sanitized diagnostics", async () => {
    const fetchSpy = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: "Invalid API Key", APIkey: apiKey }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
    );
    const client = new APIFootballComHttpClient({
      apiKey,
      baseUrl: "https://apiv3.apifootball.com/",
      timeoutMs: 15000,
      fetchImpl: fetchSpy
    });

    await expect(client.requestJson({ action: "get_countries" })).rejects.toMatchObject({
      details: {
        kind: "authentication",
        action: "get_countries",
        message: "Invalid API Key",
        safeRequestUrl: "https://apiv3.apifootball.com/?action=get_countries&APIkey=<redacted>",
        credentialLabel: "legacy",
        status: 200,
        responseBody: {
          error: "Invalid API Key",
          APIkey: "<redacted>"
        }
      }
    });

    try {
      await client.requestJson({ action: "get_countries" });
    } catch (error) {
      expect(error).toBeInstanceOf(APIFootballComHttpError);
      expect(String(error)).not.toContain(apiKey);
    }
  });

  it("does not treat row-level logo URL strings as provider errors", async () => {
    const laLigaLikeTeams = Array.from({ length: 20 }, (_, index) => ({
      team_key: String(1000 + index),
      team_name: `La Liga Team ${index + 1}`,
      team_badge: index === 0 ? "https://apiv3.apifootball.com/badges/players/132798_m-vilaplana-dachs.jpg" : `https://apiv3.apifootball.com/badges/teams/${1000 + index}.png`,
      country_id: "6",
      country_name: "Spain"
    }));
    const fetchSpy = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify(laLigaLikeTeams), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
    );
    const client = new APIFootballComHttpClient({
      apiKey,
      baseUrl: "https://apiv3.apifootball.com/",
      timeoutMs: 15000,
      fetchImpl: fetchSpy
    });

    const result = await client.requestJson<typeof laLigaLikeTeams>({ action: "get_teams" });
    const mapped = result.payload.map((team) => mapTeamToProviderTeam(team));

    expect(result.metadata.credentialLabel).toBe("legacy");
    expect(result.payload).toHaveLength(20);
    expect(mapped).toHaveLength(20);
    expect(mapped.every((team) => team.providerEntityId && team.name && team.logoUrl)).toBe(true);
    expect(JSON.stringify(result)).not.toContain(apiKey);
  });

  it("maps countries and leagues into provider DTOs", () => {
    expect(mapCountryToProviderCountry({ country_id: "41", country_name: "England" })).toMatchObject({
      providerEntityId: "41",
      name: "England"
    });
    expect(mapLeagueToProviderCompetition({ country_id: "41", country_name: "England", league_id: "148", league_name: "Premier League" })).toMatchObject({
      providerEntityId: "148",
      sportProviderId: "football",
      countryProviderId: "41",
      name: "Premier League",
      metadata: {
        countryName: "England"
      }
    });
  });

  it("maps event rows into ProviderMatch and ProviderFootballMatchScore", () => {
    const event = {
      match_id: "194200",
      country_id: "41",
      country_name: "England",
      league_id: "148",
      league_name: "Premier League",
      match_date: "2019-04-01",
      match_time: "21:00",
      match_status: "Finished",
      match_hometeam_id: "2617",
      match_hometeam_name: "Arsenal",
      match_awayteam_id: "2630",
      match_awayteam_name: "Newcastle",
      match_hometeam_score: "2 ",
      match_awayteam_score: " 0",
      match_hometeam_halftime_score: "1",
      match_awayteam_halftime_score: "0",
      match_hometeam_extra_score: "",
      match_awayteam_extra_score: "",
      match_hometeam_penalty_score: "",
      match_awayteam_penalty_score: "",
      match_round: "Round 32",
      match_stadium: "Emirates",
      match_referee: "Referee Name"
    };

    expect(mapEventToProviderMatch(event)).toMatchObject({
      status: "mapped",
      data: {
        providerEntityId: "194200",
        competitionProviderId: "148",
        homeTeamProviderId: "2617",
        awayTeamProviderId: "2630",
        scheduledStartAt: "2019-04-01T21:00:00.000Z",
        status: "finished",
        roundName: "Round 32",
        venueName: "Emirates",
        refereeName: "Referee Name"
      }
    });
    expect(mapEventToProviderFootballMatchScore(event)).toMatchObject({
      status: "mapped",
      data: {
        providerEntityId: "194200",
        matchProviderId: "194200",
        homeScoreCurrent: 2,
        awayScoreCurrent: 0,
        homeScoreFullTime: 2,
        awayScoreFullTime: 0,
        homeScoreHalfTime: 1,
        awayScoreHalfTime: 0,
        status: "finished"
      }
    });
  });

  it("does not fabricate team IDs when event rows only include names", () => {
    expect(
      mapEventToProviderMatch({
        match_id: "m1",
        league_id: "l1",
        match_date: "2026-04-29",
        match_time: "12:00",
        match_status: "Finished",
        match_hometeam_name: "Home",
        match_awayteam_name: "Away"
      })
    ).toMatchObject({
      status: "unresolved",
      reason: "event is missing stable home or away team provider ID"
    });
  });

  it("reports numeric live match statuses as unsupported without fabricating final scores", () => {
    const liveLikeEvent = {
      match_id: "615673",
      country_id: "5",
      country_name: "Italy",
      league_id: "207",
      league_name: "Serie A",
      match_date: "2026-05-01",
      match_time: "21:45",
      match_status: "18",
      match_live: "1",
      match_hometeam_id: "4988",
      match_hometeam_name: "Pisa",
      match_awayteam_id: "5010",
      match_awayteam_name: "Lecce",
      match_hometeam_score: "0",
      match_awayteam_score: "0",
      match_hometeam_halftime_score: "",
      match_awayteam_halftime_score: "",
      match_hometeam_ft_score: "",
      match_awayteam_ft_score: ""
    };

    expect(mapEventToProviderMatch(liveLikeEvent)).toMatchObject({
      status: "unresolved",
      reason: 'Unsupported APIFootball.com match status "18".',
      metadata: {
        matchId: "615673",
        rawStatus: "18"
      }
    });
    expect(mapEventToProviderFootballMatchScore(liveLikeEvent)).toMatchObject({
      status: "unresolved",
      reason: 'Unsupported APIFootball.com match status "18".',
      metadata: {
        matchId: "615673",
        rawStatus: "18"
      }
    });
  });

  it("keeps After Pen. unsupported unless an explicit league-result policy is added", () => {
    const afterPenEvent = {
      match_id: "eredivisie-after-pen",
      country_id: "82",
      country_name: "Netherlands",
      league_id: "244",
      league_name: "Eredivisie",
      match_date: "2026-05-02",
      match_time: "19:45",
      match_status: "After Pen.",
      match_hometeam_id: "123",
      match_hometeam_name: "Waalwijk",
      match_awayteam_id: "456",
      match_awayteam_name: "Roda",
      match_hometeam_score: "1",
      match_awayteam_score: "1",
      match_hometeam_halftime_score: "0",
      match_awayteam_halftime_score: "0",
      match_hometeam_ft_score: "",
      match_awayteam_ft_score: "",
      match_hometeam_penalty_score: "4",
      match_awayteam_penalty_score: "5"
    };

    expect(mapEventToProviderMatch(afterPenEvent)).toMatchObject({
      status: "unresolved",
      reason: 'Unsupported APIFootball.com match status "After Pen.".',
      metadata: {
        matchId: "eredivisie-after-pen",
        rawStatus: "After Pen."
      }
    });
    expect(mapEventToProviderFootballMatchScore(afterPenEvent)).toMatchObject({
      status: "unresolved",
      reason: 'Unsupported APIFootball.com match status "After Pen.".',
      metadata: {
        matchId: "eredivisie-after-pen",
        rawStatus: "After Pen."
      }
    });
  });

  it("maps standings only when a stable team ID exists", () => {
    expect(
      mapStandingToProviderFootballStanding({
        league_id: "148",
        team_id: "2626",
        team_name: "Manchester City",
        overall_league_position: "1",
        overall_league_payed: "38",
        overall_league_W: "32",
        overall_league_D: "2",
        overall_league_L: "4",
        overall_league_GF: "95",
        overall_league_GA: "23",
        overall_league_PTS: "98",
        home_league_payed: "19",
        home_league_W: "18",
        home_league_D: "0",
        home_league_L: "1",
        home_league_GF: "57",
        home_league_GA: "12"
      })
    ).toMatchObject({
      status: "mapped",
      data: {
        providerEntityId: "148:2626",
        competitionProviderId: "148",
        teamProviderId: "2626",
        position: 1,
        played: 38,
        wins: 32,
        draws: 2,
        losses: 4,
        goalsFor: 95,
        goalsAgainst: 23,
        goalDifference: 72,
        points: 98,
        homePlayed: 19
      }
    });

    expect(
      mapStandingToProviderFootballStanding({
        league_id: "148",
        team_name: "Manchester City",
        overall_league_position: "1"
      })
    ).toMatchObject({
      status: "unresolved",
      reason: "standing is missing stable team provider ID"
    });
  });

  it("maps team logos to ProviderTeam.logoUrl and treats missing logos as non-fatal", () => {
    expect(
      mapTeamToProviderTeam({
        team_key: "2611",
        team_name: "Leicester",
        team_badge: "https://apifootball.com/badges/2611_leicester.png"
      })
    ).toMatchObject({
      providerEntityId: "2611",
      name: "Leicester",
      logoUrl: "https://apifootball.com/badges/2611_leicester.png",
      metadata: {
        logoMissing: false
      }
    });

    expect(
      mapTeamToProviderTeam({
        team_key: "2612",
        team_name: "Everton"
      })
    ).toMatchObject({
      providerEntityId: "2612",
      name: "Everton",
      metadata: {
        logoMissing: true
      }
    });
  });

  it("filters unmapped team rows without failing the provider fetch", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            team_key: "3911",
            team_name: "Bochum",
            team_badge: "https://apiv3.apifootball.com/badges/3911_bochum.jpg"
          },
          {
            team_key: "missing-name"
          }
        ]),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      )
    );
    const adapter = new APIFootballComAdapter({
      enabled: true,
      apiKey,
      baseUrl: "https://apiv3.apifootball.com/",
      timeoutMs: 15000,
      environment: { nodeEnv: "test" },
      fetchImpl: fetchSpy
    });

    const result = await adapter.fetch({
      provider: "apifootball-com",
      operation: "list_teams",
      entityType: "team",
      params: { league_id: "171" }
    });

    expect(result.data).toHaveLength(1);
    expect(result.rawPayload).toHaveLength(2);
  });

  it("fetches with a mocked HTTP client path and never calls real HTTP in unit tests", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([{ country_id: "41", country_name: "England" }]), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    const adapter = new APIFootballComAdapter({
      enabled: true,
      apiKey,
      baseUrl: "https://apiv3.apifootball.com/",
      timeoutMs: 15000,
      environment: { nodeEnv: "test" },
      fetchImpl: fetchSpy
    });

    const result = await adapter.fetch({
      provider: "apifootball-com",
      operation: "list_countries",
      entityType: "country",
      params: {}
    });

    expect(result.data).toEqual([expect.objectContaining({ providerEntityId: "41", name: "England" })]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const firstCall = fetchSpy.mock.calls[0];
    expect(firstCall).toBeDefined();
    expect(new URL(String(firstCall?.[0])).searchParams.get(APIFOOTBALL_COM_API_KEY_QUERY_PARAM)).toBe(apiKey);
    expect(result.metadata.requestParams).not.toHaveProperty("APIkey");
  });

  it("routes provider operations to endpoint-specific credentials", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([{ country_id: "41", country_name: "England" }]), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    const adapter = new APIFootballComAdapter({
      enabled: true,
      apiKeys: {
        defaultApiKey: "test-default-key",
        countriesApiKey: "test-countries-key",
        eventsApiKey: "test-events-key",
        fixturesApiKey: "test-fixtures-key",
        resultsApiKey: "test-results-key"
      },
      baseUrl: "https://apiv3.apifootball.com/",
      timeoutMs: 15000,
      environment: { nodeEnv: "test" },
      fetchImpl: fetchSpy
    });

    const result = await adapter.fetch({
      provider: "apifootball-com",
      operation: "list_countries",
      entityType: "country",
      params: {}
    });

    expect(new URL(String(fetchSpy.mock.calls[0]?.[0])).searchParams.get(APIFOOTBALL_COM_API_KEY_QUERY_PARAM)).toBe("test-countries-key");
    expect(result.metadata.credentialLabel).toBe("countries");
    expect(JSON.stringify(result)).not.toContain("test-countries-key");
  });

  it("routes event-like operations to fixtures, events, and results credentials", async () => {
    const fetchSpy = vi.fn().mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify([]), {
        status: 200,
        headers: { "content-type": "application/json" }
      }))
    );
    const adapter = new APIFootballComAdapter({
      enabled: true,
      apiKeys: {
        defaultApiKey: "test-default-key",
        eventsApiKey: "test-events-key",
        fixturesApiKey: "test-fixtures-key",
        resultsApiKey: "test-results-key"
      },
      baseUrl: "https://apiv3.apifootball.com/",
      timeoutMs: 15000,
      environment: { nodeEnv: "test" },
      fetchImpl: fetchSpy
    });

    await adapter.fetch({ provider: "apifootball-com", operation: "list_upcoming_matches", entityType: "match", params: {} });
    await adapter.fetch({ provider: "apifootball-com", operation: "list_finished_matches", entityType: "match", params: {} });
    await adapter.fetch({ provider: "apifootball-com", operation: "get_football_match_score", entityType: "football_match_score", params: {} });

    expect(new URL(String(fetchSpy.mock.calls[0]?.[0])).searchParams.get(APIFOOTBALL_COM_API_KEY_QUERY_PARAM)).toBe("test-fixtures-key");
    expect(new URL(String(fetchSpy.mock.calls[1]?.[0])).searchParams.get(APIFOOTBALL_COM_API_KEY_QUERY_PARAM)).toBe("test-events-key");
    expect(new URL(String(fetchSpy.mock.calls[2]?.[0])).searchParams.get(APIFOOTBALL_COM_API_KEY_QUERY_PARAM)).toBe("test-results-key");
  });
});
