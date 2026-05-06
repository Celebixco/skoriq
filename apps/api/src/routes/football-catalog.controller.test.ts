import { BadRequestException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { FootballCatalogController, parseCompetitionsQuery, parseTeamsQuery } from "./football-catalog.controller.js";
import {
  mapCompetitionRow,
  mapCompetitionExplorerRow,
  mapCompetitionProfile,
  mapCountryExplorerRow,
  mapMatchRow,
  mapPlayerAvailabilityRow,
  mapReadinessRow,
  mapTeamProfileCoverageRow,
  mapTeamProfileFormSummary,
  mapTeamProfileGoalProfile,
  mapTeamProfileRecentMatchRow,
  mapTeamProfileStandingRow,
  mapTeamProfileUpcomingMatchRow,
  mapTeamRow
} from "./football-catalog.service.js";
import type { FootballCatalogService } from "./football-catalog.service.js";

const teamId = "b4235ef3-4d8c-4461-aeec-37e9abef3130";
const competitionId = "e91bf32e-3683-49f6-8077-6247889e58a5";
const countryId = "0fbbf7f8-e5f8-438f-9e8e-befef85d587b";

describe("FootballCatalogController", () => {
  it("lists football teams with safe filters", async () => {
    const service = mockService();
    const controller = new FootballCatalogController(service);

    const response = await controller.listFootballTeams({
      competitionId,
      search: " Dortmund ",
      limit: "25",
      offset: "5"
    });

    expect(service.listTeams).toHaveBeenCalledWith({
      competitionId,
      search: "Dortmund",
      limit: 25,
      offset: 5
    });
    expect(response.items[0]).toMatchObject({ teamId, logoUrl: "https://example.test/dortmund.png", hasLogo: true });
  });

  it("lists football competitions with pagination", async () => {
    const service = mockService();
    const controller = new FootballCatalogController(service);

    await controller.listFootballCompetitions({ limit: "10", offset: "2" });

    expect(service.listCompetitions).toHaveBeenCalledWith({ limit: 10, offset: 2 });
  });

  it("lists countries and country competitions for the explorer", async () => {
    const service = mockService();
    const controller = new FootballCatalogController(service);

    const countries = await controller.listFootballCountries();
    const competitions = await controller.listFootballCountryCompetitions(countryId);

    expect(service.listCountries).toHaveBeenCalledWith();
    expect(service.listCompetitionsForCountry).toHaveBeenCalledWith(countryId);
    expect(countries[0]).toMatchObject({ id: countryId, name: "Germany", competitionCount: 1 });
    expect(competitions[0]).toMatchObject({
      id: competitionId,
      country: { id: countryId, name: "Germany" },
      dataStatus: "ready"
    });
  });

  it("returns detail rows for valid team and competition ids", async () => {
    const service = mockService();
    const controller = new FootballCatalogController(service);

    await controller.getFootballTeam(teamId);
    await controller.getFootballTeamProfile(teamId);
    await controller.getFootballTeamAvailability(teamId);
    await controller.getFootballCompetitionProfile(competitionId);
    await controller.getFootballCompetition(competitionId);
    await controller.getFootballMatchPlayerAvailability("89759e35-758d-416e-b0d3-ad07436c8a9b");

    expect(service.getTeam).toHaveBeenCalledWith(teamId);
    expect(service.getTeamProfile).toHaveBeenCalledWith(teamId);
    expect(service.getTeamAvailability).toHaveBeenCalledWith(teamId);
    expect(service.getCompetitionProfile).toHaveBeenCalledWith(competitionId);
    expect(service.getCompetition).toHaveBeenCalledWith(competitionId);
    expect(service.getMatchPlayerAvailability).toHaveBeenCalledWith("89759e35-758d-416e-b0d3-ad07436c8a9b");
  });

  it("rejects invalid UUIDs and invalid query values", async () => {
    const controller = new FootballCatalogController(mockService());

    await expect(controller.getFootballTeam("not-a-uuid")).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.getFootballTeamProfile("not-a-uuid")).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.getFootballTeamAvailability("not-a-uuid")).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.listFootballCountryCompetitions("not-a-uuid")).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.getFootballCompetitionProfile("not-a-uuid")).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.getFootballCompetition("not-a-uuid")).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.getFootballMatchPlayerAvailability("not-a-uuid")).rejects.toBeInstanceOf(BadRequestException);
    expect(() => parseTeamsQuery({ competitionId: "not-a-uuid" })).toThrow(BadRequestException);
    expect(() => parseTeamsQuery({ search: "x".repeat(81) })).toThrow(BadRequestException);
    expect(() => parseTeamsQuery({ limit: "101" })).toThrow(BadRequestException);
    expect(() => parseTeamsQuery({ offset: "-1" })).toThrow(BadRequestException);
    expect(() => parseCompetitionsQuery({ limit: "0" })).toThrow(BadRequestException);
  });

  it("propagates missing catalog resources as 404", async () => {
    const service = mockService({
      getTeam: vi.fn().mockRejectedValue(new NotFoundException("Football team not found.")),
      getCompetition: vi.fn().mockRejectedValue(new NotFoundException("Football competition not found."))
    });
    const controller = new FootballCatalogController(service);

    await expect(controller.getFootballTeam(teamId)).rejects.toBeInstanceOf(NotFoundException);
    await expect(controller.getFootballCompetition(competitionId)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("football catalog response mappers", () => {
  it("maps logos, competition summaries, and read-only match fields", () => {
    expect(mapCountryExplorerRow(countryExplorerRow())).toMatchObject({
      id: countryId,
      name: "Germany",
      logoUrl: null,
      competitionCount: 1,
      teamCount: 18,
      matchCount: 54,
      finishedMatchCount: 44,
      upcomingMatchCount: 10,
      averageCoverage: 64
    });

    expect(mapTeamRow(teamRow())).toMatchObject({
      teamId,
      name: "Borussia Dortmund",
      logoUrl: "https://example.test/dortmund.png",
      hasLogo: true,
      matchesCount: 12,
      latestFormCoverage: 70,
      competitions: [{ competitionId, name: "Bundesliga", country: "Germany" }]
    });

    expect(mapCompetitionRow(competitionRow())).toMatchObject({
      competitionId,
      name: "Bundesliga",
      teamsCount: 18,
      matchesCount: 54,
      readyMatchesCount: 1,
      averageCoverage: 64
    });

    expect(mapCompetitionExplorerRow(competitionExplorerRow())).toMatchObject({
      id: competitionId,
      name: "Bundesliga",
      logoUrl: "https://example.test/bundesliga.png",
      country: { id: countryId, name: "Germany" },
      teamCount: 18,
      standingRows: 18,
      matchCount: 54,
      finishedMatchCount: 44,
      upcomingMatchCount: 10,
      averageCoverage: 64,
      dataStatus: "ready"
    });

    expect(mapCompetitionExplorerRow({ ...competitionExplorerRow(), competition_metadata_json: {}, average_coverage: null })).toMatchObject({
      logoUrl: null,
      dataStatus: "partial"
    });

    expect(mapMatchRow(matchRow())).toMatchObject({
      matchId: "89759e35-758d-416e-b0d3-ad07436c8a9b",
      homeTeam: { logoUrl: "https://example.test/dortmund.png" },
      awayTeam: { logoUrl: "https://example.test/freiburg.png" },
      combinedCoverageScore: 64
    });
  });

  it("maps the football explorer competition profile from normalized rows only", () => {
    const profile = mapCompetitionProfile({
      summaryRow: competitionExplorerRow(),
      standings: [
        {
          teamId,
          teamName: "Borussia Dortmund",
          logoUrl: "https://example.test/dortmund.png",
          position: 1,
          played: 30,
          wins: 22,
          draws: 4,
          losses: 4,
          goalsFor: 70,
          goalsAgainst: 30,
          goalDifference: 40,
          points: 70
        }
      ],
      teams: [mapTeamRow(teamRow())],
      upcomingMatches: [mapMatchRow({ ...matchRow(), status: "not_started" })],
      recentMatches: [mapMatchRow(matchRow())]
    });

    expect(profile).toMatchObject({
      competition: {
        id: competitionId,
        name: "Bundesliga",
        logoUrl: "https://example.test/bundesliga.png",
        country: { id: countryId, name: "Germany", logoUrl: null }
      },
      summary: {
        teamCount: 18,
        standingRows: 18,
        matchCount: 54,
        finishedMatchCount: 44,
        upcomingMatchCount: 10,
        averageCoverage: 64,
        h2hSupportedUpcomingCount: 9,
        predictionReadyUpcomingCount: 8
      },
      dataCoverage: {
        dataStatus: "ready",
        hasStandings: true,
        hasTeams: true,
        hasRecentScores: true,
        hasUpcomingMatches: true
      }
    });
    expect(profile.standings).toHaveLength(1);
    expect(profile.teams).toHaveLength(1);
    expect(profile.upcomingMatches).toHaveLength(1);
    expect(profile.recentMatches).toHaveLength(1);
  });

  it("maps the member-safe team profile shape from normalized rows", () => {
    const formSummary = mapTeamProfileFormSummary([teamProfileFormRow({ scope: "overall" }), teamProfileFormRow({ scope: "home", sample_size: 2 })]);
    const recentMatch = mapTeamProfileRecentMatchRow(teamProfileMatchRow(), teamId);
    const upcomingMatch = mapTeamProfileUpcomingMatchRow({ ...teamProfileMatchRow(), status: "not_started", feature_status: "partial" }, teamId);
    const coverage = mapTeamProfileCoverageRow({
      row: { matches_available: "12", scores_available: "8", player_memberships_available: "4", lineup_rows_available: "1", availability_rows_available: "2" },
      formSummary,
      standing: standingRow(),
      logoUrl: "https://example.test/dortmund.png"
    });

    expect(mapTeamProfileStandingRow(standingRow())).toMatchObject({ position: 1, played: 30, points: 70 });
    expect(formSummary.overall).toMatchObject({
      scope: "overall",
      sampleSize: 5,
      coverageScore: 64,
      scoredRate: 80,
      firstHalfOver05Rate: 60
    });
    expect(mapTeamProfileGoalProfile(formSummary.overall)).toMatchObject({
      scoredRate: 80,
      teamOver15Rate: 70,
      under25Rate: 40
    });
    expect(recentMatch).toMatchObject({
      opponent: { name: "Freiburg" },
      homeAway: "home",
      fulltimeScore: "2-1",
      halftimeScore: "1-0",
      result: "W"
    });
    expect(mapTeamProfileRecentMatchRow(teamProfileMatchRow({ home_team_id: "98a256b8-08a3-4bd7-a184-1bc8f3fbfca3", away_team_id: teamId, home_score_fulltime: "1", away_score_fulltime: "3" }), teamId)).toMatchObject({
      homeAway: "away",
      fulltimeScore: "1-3",
      result: "W"
    });
    expect(mapTeamProfileRecentMatchRow(teamProfileMatchRow({ home_team_id: "98a256b8-08a3-4bd7-a184-1bc8f3fbfca3", away_team_id: teamId, home_score_fulltime: "2", away_score_fulltime: "1" }), teamId)).toMatchObject({
      homeAway: "away",
      fulltimeScore: "2-1",
      result: "L"
    });
    expect(mapTeamProfileRecentMatchRow(teamProfileMatchRow({ home_score_fulltime: "1", away_score_fulltime: "1" }), teamId)).toMatchObject({
      homeAway: "home",
      fulltimeScore: "1-1",
      result: "D"
    });
    expect(upcomingMatch).toMatchObject({ status: "not_started", analysisStatus: "partial" });
    expect(coverage).toMatchObject({
      matchesAvailable: 12,
      scoresAvailable: 8,
      formCoverageScore: 64,
      hasStanding: true,
      hasLogo: true,
      playersAvailable: true,
      injuriesAvailable: true
    });
    expect(
      mapPlayerAvailabilityRow({
        player_id: "player-1",
        player_name: "Example Player",
        team_id: teamId,
        team_name: "Borussia Dortmund",
        team_logo_url: "https://example.test/dortmund.png",
        status: "injured",
        reason: "Knock",
        injury_type: "Muscle",
        expected_return_date: "2026-05-10",
        source_freshness: "2026-05-01T12:00:00.000Z"
      })
    ).toMatchObject({
      playerId: "player-1",
      playerName: "Example Player",
      status: "injured",
      reason: "Knock",
      injuryType: "Muscle",
      expectedReturnDate: "2026-05-10"
    });
  });

  it("keeps responses free of secrets and raw payloads", () => {
    const formSummary = mapTeamProfileFormSummary([teamProfileFormRow({ scope: "overall" })]);
    const response = {
      team: mapTeamRow(teamRow()),
      match: mapMatchRow(matchRow()),
      profile: {
        formSummary,
        goalProfile: mapTeamProfileGoalProfile(formSummary.overall),
        recentMatches: [mapTeamProfileRecentMatchRow(teamProfileMatchRow(), teamId)]
      },
      readiness: mapReadinessRow({
        analyzed_matches_count: "1",
        ready_matches_count: "1",
        partial_matches_count: "0",
        insufficient_data_matches_count: "0",
        average_coverage: "64.00"
      })
    };
    const serialized = JSON.stringify(response);

    expect(serialized).not.toContain("APIFOOTBALL_COM_API_KEY");
    expect(serialized).not.toContain("DATABASE_URL");
    expect(serialized).not.toContain("postgres://");
    expect(serialized).not.toContain("raw_provider_payload");
    expect(serialized).not.toContain("provider_entity_id");
    expect(serialized).not.toContain("metadata_json");
    expect(serialized).not.toContain("rawPayload");
  });
});

function mockService(overrides: Partial<FootballCatalogService> = {}): FootballCatalogService {
  return {
    listCountries: vi.fn().mockResolvedValue([mapCountryExplorerRow(countryExplorerRow())]),
    listTeams: vi.fn().mockResolvedValue({
      items: [mapTeamRow(teamRow())],
      pagination: { limit: 50, offset: 0, total: 1 }
    }),
    getTeam: vi.fn().mockResolvedValue({ ...mapTeamRow(teamRow()), recentMatches: [], latestForm: [], analyticsReadiness: mapReadinessRow(undefined) }),
    getTeamProfile: vi.fn().mockResolvedValue({
      team: {
        id: teamId,
        name: "Borussia Dortmund",
        logoUrl: "https://example.test/dortmund.png",
        country: "Germany",
        primaryCompetition: { id: competitionId, name: "Bundesliga", country: "Germany" }
      },
      standing: null,
      formSummary: { overall: null, home: null, away: null },
      goalProfile: mapTeamProfileGoalProfile(null),
      recentMatches: [],
      upcomingMatches: [],
      playerAvailability: [],
      dataCoverage: {
        matchesAvailable: 0,
        scoresAvailable: 0,
        formCoverageScore: null,
        hasStanding: false,
        hasLogo: true,
        playersAvailable: false,
        lineupsAvailable: false,
        injuriesAvailable: false
      }
    }),
    getTeamAvailability: vi.fn().mockResolvedValue({
      team: {
        id: teamId,
        name: "Borussia Dortmund",
        logoUrl: "https://example.test/dortmund.png"
      },
      items: []
    }),
    listCompetitions: vi.fn().mockResolvedValue({
      items: [mapCompetitionRow(competitionRow())],
      pagination: { limit: 50, offset: 0, total: 1 }
    }),
    listCompetitionsForCountry: vi.fn().mockResolvedValue([mapCompetitionExplorerRow(competitionExplorerRow())]),
    getCompetition: vi.fn().mockResolvedValue({
      ...mapCompetitionRow(competitionRow()),
      teams: [mapTeamRow(teamRow())],
      matches: [],
      standings: [],
      analyticsReadiness: mapReadinessRow(undefined)
    }),
    getCompetitionProfile: vi.fn().mockResolvedValue(
      mapCompetitionProfile({
        summaryRow: competitionExplorerRow(),
        standings: [],
        teams: [mapTeamRow(teamRow())],
        upcomingMatches: [],
        recentMatches: []
      })
    ),
    getMatchPlayerAvailability: vi.fn().mockResolvedValue({
      match: {
        id: "89759e35-758d-416e-b0d3-ad07436c8a9b",
        kickoffAt: "2026-05-04T10:00:00.000Z",
        homeTeam: { id: teamId, name: "Borussia Dortmund", logoUrl: "https://example.test/dortmund.png" },
        awayTeam: { id: "away-team", name: "SC Freiburg", logoUrl: "https://example.test/freiburg.png" }
      },
      items: []
    }),
    ...overrides
  } as unknown as FootballCatalogService;
}

function countryExplorerRow() {
  return {
    country_id: countryId,
    name: "Germany",
    competition_count: "1",
    team_count: "18",
    match_count: "54",
    finished_match_count: "44",
    upcoming_match_count: "10",
    average_coverage: "64.00"
  };
}

function teamRow() {
  return {
    team_id: teamId,
    name: "Borussia Dortmund",
    short_name: "Dortmund",
    logo_url: "https://example.test/dortmund.png",
    country: "Germany",
    competitions: [{ competitionId, name: "Bundesliga", country: "Germany" }],
    matches_count: "12",
    latest_form_coverage: "70.00"
  };
}

function competitionRow() {
  return {
    competition_id: competitionId,
    name: "Bundesliga",
    country: "Germany",
    teams_count: "18",
    matches_count: "54",
    ready_matches_count: "1",
    average_coverage: "64.00"
  };
}

function competitionExplorerRow() {
  return {
    competition_id: competitionId,
    name: "Bundesliga",
    competition_metadata_json: { logoUrl: "https://example.test/bundesliga.png", provider_entity_id: "hidden" },
    country_id: countryId,
    country_name: "Germany",
    team_count: "18",
    standing_rows: "18",
    match_count: "54",
    finished_match_count: "44",
    upcoming_match_count: "10",
    average_coverage: "64.00",
    h2h_supported_upcoming_count: "9",
    prediction_ready_upcoming_count: "8"
  };
}

function matchRow() {
  return {
    match_id: "89759e35-758d-416e-b0d3-ad07436c8a9b",
    competition_id: competitionId,
    competition: "Bundesliga",
    country: "Germany",
    kickoff_at: new Date("2026-04-26T17:30:00.000Z"),
    status: "finished",
    home_team_id: teamId,
    home_team: "Borussia Dortmund",
    home_team_logo_url: "https://example.test/dortmund.png",
    away_team_id: "98a256b8-08a3-4bd7-a184-1bc8f3fbfca3",
    away_team: "Freiburg",
    away_team_logo_url: "https://example.test/freiburg.png",
    feature_status: "ready",
    combined_coverage_score: "64.00"
  };
}

function standingRow() {
  return {
    position: "1",
    played: "30",
    wins: "22",
    draws: "4",
    losses: "4",
    goals_for: "70",
    goals_against: "30",
    goal_difference: "40",
    points: "70"
  };
}

function teamProfileFormRow(overrides: Partial<ReturnType<typeof baseTeamProfileFormRow>> = {}) {
  return { ...baseTeamProfileFormRow(), ...overrides };
}

function baseTeamProfileFormRow() {
  return {
    feature_id: "6fc2d4ac-8249-42a2-af7d-afc6e88f2cb0",
    competition_id: competitionId,
    window_size: 5,
    scope: "overall",
    sample_size: 5,
    coverage_score: "64.00",
    matches_played: "5",
    wins: "3",
    draws: "1",
    losses: "1",
    points: 10,
    avg_goals_for: "1.800",
    avg_goals_against: "0.800",
    both_teams_to_score_rate: "50.00",
    over_0_5_rate: "100.00",
    over_1_5_rate: "80.00",
    over_2_5_rate: "60.00",
    under_2_5_rate: "40.00",
    scored_rate: "80.00",
    conceded_rate: "40.00",
    team_over_0_5_rate: "80.00",
    team_over_1_5_rate: "70.00",
    first_half_over_0_5_rate: "60.00",
    first_half_avg_goals_for: "0.800",
    first_half_avg_goals_against: "0.200"
  };
}

function teamProfileMatchRow(overrides: Partial<ReturnType<typeof baseTeamProfileMatchRow>> = {}) {
  return { ...baseTeamProfileMatchRow(), ...overrides };
}

function baseTeamProfileMatchRow() {
  return {
    match_id: "89759e35-758d-416e-b0d3-ad07436c8a9b",
    competition: "Bundesliga",
    kickoff_at: new Date("2026-04-26T17:30:00.000Z"),
    status: "finished",
    home_team_id: teamId,
    home_team: "Borussia Dortmund",
    home_team_logo_url: "https://example.test/dortmund.png",
    away_team_id: "98a256b8-08a3-4bd7-a184-1bc8f3fbfca3",
    away_team: "Freiburg",
    away_team_logo_url: "https://example.test/freiburg.png",
    home_score_fulltime: "2",
    away_score_fulltime: "1",
    home_score_current: "2",
    away_score_current: "1",
    home_score_halftime: "1",
    away_score_halftime: "0",
    feature_status: null
  };
}
