import { describe, expect, it, vi } from "vitest";
import { RawPayloadProcessor } from "./raw-payload-processor.js";
import { NormalizerRegistry } from "./normalizers.js";
import type { PipelineNormalizer } from "./normalizers.js";
import { FootballMatchScoreNormalizer, FootballMatchTeamStatisticsNormalizer, FootballStandingNormalizer, MatchNormalizer, PlayerNormalizer, SportNormalizer, TeamNormalizer } from "./static-normalizers.js";
import type { StaticNormalizerRepositories } from "./static-normalizers.js";

describe("RawPayloadProcessor", () => {
  it("fails safely for unknown entity types", async () => {
    const processor = new RawPayloadProcessor({} as never, { createSyncJobLog: vi.fn() } as never);

    await expect(processor.process({ rawPayloadId: "raw-1", entityType: "not_real" as never })).rejects.toThrow('Unknown provider entity type "not_real".');
  });

  it("marks payload failed when normalizer throws", async () => {
    const markRawPayloadFailed = vi.fn().mockResolvedValue(undefined);
    const processor = new RawPayloadProcessor(
      {
        findRawPayloadById: vi.fn().mockResolvedValue({
          id: "raw-1",
          provider: "mock",
          entityType: "sport",
          status: "received",
          payloadJson: { bad: true }
        }),
        markRawPayloadFailed
      } as never,
      { createSyncJobLog: vi.fn() } as never,
      new NormalizerRegistry([throwingNormalizer])
    );

    await expect(processor.process({ rawPayloadId: "raw-1", entityType: "sport" })).rejects.toThrow("Normalizer exploded.");
    expect(markRawPayloadFailed).toHaveBeenCalledWith("raw-1", "Normalizer exploded.");
  });

  it("marks payload processed for validated-only shells", async () => {
    const markRawPayloadProcessed = vi.fn().mockResolvedValue(undefined);
    const processor = new RawPayloadProcessor(
      {
        findRawPayloadById: vi.fn().mockResolvedValue({
          id: "raw-1",
          provider: "mock",
          entityType: "sport",
          status: "received",
          payloadJson: { ok: true }
        }),
        markRawPayloadProcessed
      } as never,
      { createSyncJobLog: vi.fn() } as never
    );

    const result = await processor.process({ rawPayloadId: "raw-1", entityType: "sport" });

    expect(result).toEqual({
      rawPayloadId: "raw-1",
      status: "processed",
      normalizationStatus: "validated_only"
    });
    expect(markRawPayloadProcessed).toHaveBeenCalledWith("raw-1");
  });

  it("marks payload processed after successful static canonical normalization", async () => {
    const markRawPayloadProcessed = vi.fn().mockResolvedValue(undefined);
    const repositories = createStaticMockRepositories();
    repositories.sports.upsertSport = vi.fn().mockResolvedValue({ id: "sport-1" });
    repositories.providerMappings.findProviderMapping = vi.fn().mockResolvedValue(undefined);

    const processor = new RawPayloadProcessor(
      {
        findRawPayloadById: vi.fn().mockResolvedValue({
          id: "raw-1",
          provider: "mock",
          entityType: "sport",
          status: "received",
          payloadJson: { providerEntityId: "football", name: "Football" }
        }),
        markRawPayloadProcessed
      } as never,
      { createSyncJobLog: vi.fn() } as never,
      new NormalizerRegistry([new SportNormalizer(repositories)])
    );

    const result = await processor.process({ rawPayloadId: "raw-1", entityType: "sport" });

    expect(result.normalizationStatus).toBe("normalized");
    expect(markRawPayloadProcessed).toHaveBeenCalledWith("raw-1");
  });

  it("marks payload failed after static normalizer validation failure", async () => {
    const markRawPayloadFailed = vi.fn().mockResolvedValue(undefined);
    const processor = new RawPayloadProcessor(
      {
        findRawPayloadById: vi.fn().mockResolvedValue({
          id: "raw-1",
          provider: "mock",
          entityType: "sport",
          status: "received",
          payloadJson: { providerEntityId: "football" }
        }),
        markRawPayloadFailed
      } as never,
      { createSyncJobLog: vi.fn() } as never,
      new NormalizerRegistry([new SportNormalizer(createStaticMockRepositories())])
    );

    await expect(processor.process({ rawPayloadId: "raw-1", entityType: "sport" })).rejects.toThrow("Missing required field sport.name.");
    expect(markRawPayloadFailed).toHaveBeenCalledWith("raw-1", "Missing required field sport.name.");
  });

  it("marks team payload processed after successful canonical normalization", async () => {
    const markRawPayloadProcessed = vi.fn().mockResolvedValue(undefined);
    const repositories = createStaticMockRepositories();
    repositories.providerMappings.findProviderMapping = vi.fn().mockResolvedValueOnce({ internalEntityId: "sport-football" }).mockResolvedValueOnce(undefined);
    repositories.teams.upsertTeam = vi.fn().mockResolvedValue({ id: "team-1" });

    const processor = new RawPayloadProcessor(
      {
        findRawPayloadById: vi.fn().mockResolvedValue({
          id: "raw-team-1",
          provider: "mock",
          entityType: "team",
          status: "received",
          payloadJson: { providerEntityId: "galatasaray", sportProviderId: "football", name: "Galatasaray" }
        }),
        markRawPayloadProcessed
      } as never,
      { createSyncJobLog: vi.fn() } as never,
      new NormalizerRegistry([new TeamNormalizer(repositories)])
    );

    const result = await processor.process({ rawPayloadId: "raw-team-1", entityType: "team" });

    expect(result.normalizationStatus).toBe("normalized");
    expect(markRawPayloadProcessed).toHaveBeenCalledWith("raw-team-1");
  });

  it("marks team payload failed after validation failure", async () => {
    const markRawPayloadFailed = vi.fn().mockResolvedValue(undefined);
    const processor = new RawPayloadProcessor(
      {
        findRawPayloadById: vi.fn().mockResolvedValue({
          id: "raw-team-1",
          provider: "mock",
          entityType: "team",
          status: "received",
          payloadJson: { providerEntityId: "galatasaray", sportProviderId: "football" }
        }),
        markRawPayloadFailed
      } as never,
      { createSyncJobLog: vi.fn() } as never,
      new NormalizerRegistry([new TeamNormalizer(createStaticMockRepositories())])
    );

    await expect(processor.process({ rawPayloadId: "raw-team-1", entityType: "team" })).rejects.toThrow("Missing required field team.name.");
    expect(markRawPayloadFailed).toHaveBeenCalledWith("raw-team-1", "Missing required field team.name.");
  });

  it("marks player payload processed after successful canonical normalization", async () => {
    const markRawPayloadProcessed = vi.fn().mockResolvedValue(undefined);
    const repositories = createStaticMockRepositories();
    repositories.providerMappings.findProviderMapping = vi.fn().mockResolvedValueOnce({ internalEntityId: "sport-football" }).mockResolvedValueOnce(undefined);
    repositories.players.upsertPlayer = vi.fn().mockResolvedValue({ id: "player-1" });

    const processor = new RawPayloadProcessor(
      {
        findRawPayloadById: vi.fn().mockResolvedValue({
          id: "raw-player-1",
          provider: "mock",
          entityType: "player",
          status: "received",
          payloadJson: { providerEntityId: "ronaldo", sportProviderId: "football", name: "Cristiano Ronaldo" }
        }),
        markRawPayloadProcessed
      } as never,
      { createSyncJobLog: vi.fn() } as never,
      new NormalizerRegistry([new PlayerNormalizer(repositories)])
    );

    const result = await processor.process({ rawPayloadId: "raw-player-1", entityType: "player" });

    expect(result.normalizationStatus).toBe("normalized");
    expect(markRawPayloadProcessed).toHaveBeenCalledWith("raw-player-1");
  });

  it("marks player payload failed after validation failure", async () => {
    const markRawPayloadFailed = vi.fn().mockResolvedValue(undefined);
    const processor = new RawPayloadProcessor(
      {
        findRawPayloadById: vi.fn().mockResolvedValue({
          id: "raw-player-1",
          provider: "mock",
          entityType: "player",
          status: "received",
          payloadJson: { providerEntityId: "ronaldo", sportProviderId: "football" }
        }),
        markRawPayloadFailed
      } as never,
      { createSyncJobLog: vi.fn() } as never,
      new NormalizerRegistry([new PlayerNormalizer(createStaticMockRepositories())])
    );

    await expect(processor.process({ rawPayloadId: "raw-player-1", entityType: "player" })).rejects.toThrow("Missing required field player.name.");
    expect(markRawPayloadFailed).toHaveBeenCalledWith("raw-player-1", "Missing required field player.name.");
  });

  it("marks match payload processed after successful canonical normalization", async () => {
    const markRawPayloadProcessed = vi.fn().mockResolvedValue(undefined);
    const repositories = createStaticMockRepositories();
    repositories.providerMappings.findProviderMapping = vi
      .fn()
      .mockResolvedValueOnce({ internalEntityId: "competition-1" })
      .mockResolvedValueOnce({ internalEntityId: "sport-football" })
      .mockResolvedValueOnce({ internalEntityId: "home-team" })
      .mockResolvedValueOnce({ internalEntityId: "away-team" })
      .mockResolvedValueOnce(undefined);
    repositories.matches.upsertMatch = vi.fn().mockResolvedValue({ id: "match-1" });

    const processor = new RawPayloadProcessor(
      {
        findRawPayloadById: vi.fn().mockResolvedValue({
          id: "raw-match-1",
          provider: "mock",
          entityType: "match",
          status: "received",
          payloadJson: {
            providerEntityId: "match-1",
            sportProviderId: "football",
            competitionProviderId: "premier-league",
            homeTeamProviderId: "arsenal",
            awayTeamProviderId: "chelsea",
            scheduledStartAt: "2026-05-01T17:00:00.000Z",
            status: "scheduled"
          }
        }),
        markRawPayloadProcessed
      } as never,
      { createSyncJobLog: vi.fn() } as never,
      new NormalizerRegistry([new MatchNormalizer(repositories)])
    );

    const result = await processor.process({ rawPayloadId: "raw-match-1", entityType: "match" });

    expect(result.normalizationStatus).toBe("normalized");
    expect(markRawPayloadProcessed).toHaveBeenCalledWith("raw-match-1");
  });

  it("marks match payload failed after validation failure", async () => {
    const markRawPayloadFailed = vi.fn().mockResolvedValue(undefined);
    const processor = new RawPayloadProcessor(
      {
        findRawPayloadById: vi.fn().mockResolvedValue({
          id: "raw-match-1",
          provider: "mock",
          entityType: "match",
          status: "received",
          payloadJson: {
            providerEntityId: "match-1",
            competitionProviderId: "premier-league",
            homeTeamProviderId: "arsenal",
            scheduledStartAt: "2026-05-01T17:00:00.000Z",
            status: "scheduled"
          }
        }),
        markRawPayloadFailed
      } as never,
      { createSyncJobLog: vi.fn() } as never,
      new NormalizerRegistry([new MatchNormalizer(createStaticMockRepositories())])
    );

    await expect(processor.process({ rawPayloadId: "raw-match-1", entityType: "match" })).rejects.toThrow("Missing required field match.awayTeamProviderId.");
    expect(markRawPayloadFailed).toHaveBeenCalledWith("raw-match-1", "Missing required field match.awayTeamProviderId.");
  });

  it("marks sport-specific score payload processed after successful normalization", async () => {
    const markRawPayloadProcessed = vi.fn().mockResolvedValue(undefined);
    const repositories = createStaticMockRepositories();
    repositories.providerMappings.findProviderMapping = vi.fn().mockResolvedValueOnce({ internalEntityId: "match-1" });
    repositories.matches.findMatchById = vi.fn().mockResolvedValue({ id: "match-1", homeTeamId: "home-team", awayTeamId: "away-team" });
    repositories.footballMatchScores.upsertByMatchId = vi.fn().mockResolvedValue({ id: "football-score-1" });

    const processor = new RawPayloadProcessor(
      {
        findRawPayloadById: vi.fn().mockResolvedValue({
          id: "raw-football-score-1",
          provider: "mock",
          entityType: "football_match_score",
          status: "received",
          payloadJson: {
            providerEntityId: "football-score-1",
            matchProviderId: "match-1",
            homeScoreFullTime: 2,
            awayScoreFullTime: 1,
            status: "finished"
          }
        }),
        markRawPayloadProcessed
      } as never,
      { createSyncJobLog: vi.fn() } as never,
      new NormalizerRegistry([new FootballMatchScoreNormalizer(repositories)])
    );

    const result = await processor.process({ rawPayloadId: "raw-football-score-1", entityType: "football_match_score" });

    expect(result.normalizationStatus).toBe("normalized");
    expect(markRawPayloadProcessed).toHaveBeenCalledWith("raw-football-score-1");
  });

  it("marks sport-specific score payload failed after dependency failure", async () => {
    const markRawPayloadFailed = vi.fn().mockResolvedValue(undefined);
    const repositories = createStaticMockRepositories();
    repositories.providerMappings.findProviderMapping = vi.fn().mockResolvedValue(undefined);

    const processor = new RawPayloadProcessor(
      {
        findRawPayloadById: vi.fn().mockResolvedValue({
          id: "raw-football-score-1",
          provider: "mock",
          entityType: "football_match_score",
          status: "received",
          payloadJson: {
            providerEntityId: "football-score-1",
            matchProviderId: "missing-match"
          }
        }),
        markRawPayloadFailed
      } as never,
      { createSyncJobLog: vi.fn() } as never,
      new NormalizerRegistry([new FootballMatchScoreNormalizer(repositories)])
    );

    await expect(processor.process({ rawPayloadId: "raw-football-score-1", entityType: "football_match_score" })).rejects.toThrow(
      'Cannot normalize football match score "football-score-1" without match mapping "missing-match".'
    );
    expect(markRawPayloadFailed).toHaveBeenCalledWith("raw-football-score-1", 'Cannot normalize football match score "football-score-1" without match mapping "missing-match".');
  });

  it("marks sport-specific team statistics payload processed after successful normalization", async () => {
    const markRawPayloadProcessed = vi.fn().mockResolvedValue(undefined);
    const repositories = createStaticMockRepositories();
    repositories.providerMappings.findProviderMapping = vi.fn().mockResolvedValueOnce({ internalEntityId: "match-1" }).mockResolvedValueOnce({ internalEntityId: "home-team" });
    repositories.matches.findMatchById = vi.fn().mockResolvedValue({ id: "match-1", homeTeamId: "home-team", awayTeamId: "away-team" });
    repositories.footballMatchTeamStatistics.upsertByMatchAndTeam = vi.fn().mockResolvedValue({ id: "football-stat-1" });

    const processor = new RawPayloadProcessor(
      {
        findRawPayloadById: vi.fn().mockResolvedValue({
          id: "raw-football-stat-1",
          provider: "mock",
          entityType: "football_match_team_statistics",
          status: "received",
          payloadJson: {
            matchProviderId: "match-1",
            teamProviderId: "home",
            possessionPercent: 55,
            shotsTotal: 10
          }
        }),
        markRawPayloadProcessed
      } as never,
      { createSyncJobLog: vi.fn() } as never,
      new NormalizerRegistry([new FootballMatchTeamStatisticsNormalizer(repositories)])
    );

    const result = await processor.process({ rawPayloadId: "raw-football-stat-1", entityType: "football_match_team_statistics" });

    expect(result.normalizationStatus).toBe("normalized");
    expect(markRawPayloadProcessed).toHaveBeenCalledWith("raw-football-stat-1");
  });

  it("marks sport-specific team statistics payload failed after validation failure", async () => {
    const markRawPayloadFailed = vi.fn().mockResolvedValue(undefined);
    const processor = new RawPayloadProcessor(
      {
        findRawPayloadById: vi.fn().mockResolvedValue({
          id: "raw-football-stat-1",
          provider: "mock",
          entityType: "football_match_team_statistics",
          status: "received",
          payloadJson: {
            matchProviderId: "match-1",
            teamProviderId: "home",
            possessionPercent: 150
          }
        }),
        markRawPayloadFailed
      } as never,
      { createSyncJobLog: vi.fn() } as never,
      new NormalizerRegistry([new FootballMatchTeamStatisticsNormalizer(createStaticMockRepositories())])
    );

    await expect(processor.process({ rawPayloadId: "raw-football-stat-1", entityType: "football_match_team_statistics" })).rejects.toThrow(
      "Invalid percentage field football_match_team_statistics.possessionPercent."
    );
    expect(markRawPayloadFailed).toHaveBeenCalledWith("raw-football-stat-1", "Invalid percentage field football_match_team_statistics.possessionPercent.");
  });

  it("marks sport-specific standing payload processed after successful normalization", async () => {
    const markRawPayloadProcessed = vi.fn().mockResolvedValue(undefined);
    const repositories = createStaticMockRepositories();
    repositories.providerMappings.findProviderMapping = vi.fn().mockResolvedValueOnce({ internalEntityId: "competition-1" }).mockResolvedValueOnce({ internalEntityId: "team-1" });
    repositories.footballStandings.upsertByCompetitionSeasonTeam = vi.fn().mockResolvedValue({ id: "football-standing-1" });

    const processor = new RawPayloadProcessor(
      {
        findRawPayloadById: vi.fn().mockResolvedValue({
          id: "raw-football-standing-1",
          provider: "mock",
          entityType: "football_standing",
          status: "received",
          payloadJson: {
            competitionProviderId: "league",
            teamProviderId: "team",
            position: 1,
            played: 1,
            wins: 1,
            draws: 0,
            losses: 0,
            goalsFor: 2,
            goalsAgainst: 0,
            goalDifference: 2,
            points: 3
          }
        }),
        markRawPayloadProcessed
      } as never,
      { createSyncJobLog: vi.fn() } as never,
      new NormalizerRegistry([new FootballStandingNormalizer(repositories)])
    );

    const result = await processor.process({ rawPayloadId: "raw-football-standing-1", entityType: "football_standing" });

    expect(result.normalizationStatus).toBe("normalized");
    expect(markRawPayloadProcessed).toHaveBeenCalledWith("raw-football-standing-1");
  });

  it("marks sport-specific standing payload failed after validation failure", async () => {
    const markRawPayloadFailed = vi.fn().mockResolvedValue(undefined);
    const processor = new RawPayloadProcessor(
      {
        findRawPayloadById: vi.fn().mockResolvedValue({
          id: "raw-football-standing-1",
          provider: "mock",
          entityType: "football_standing",
          status: "received",
          payloadJson: {
            competitionProviderId: "league",
            teamProviderId: "team",
            position: 0,
            played: 1,
            wins: 1,
            draws: 0,
            losses: 0,
            goalsFor: 2,
            goalsAgainst: 0,
            goalDifference: 2,
            points: 3
          }
        }),
        markRawPayloadFailed
      } as never,
      { createSyncJobLog: vi.fn() } as never,
      new NormalizerRegistry([new FootballStandingNormalizer(createStaticMockRepositories())])
    );

    await expect(processor.process({ rawPayloadId: "raw-football-standing-1", entityType: "football_standing" })).rejects.toThrow("Invalid positive integer field football_standing.position.");
    expect(markRawPayloadFailed).toHaveBeenCalledWith("raw-football-standing-1", "Invalid positive integer field football_standing.position.");
  });
});

const throwingNormalizer: PipelineNormalizer = {
  entityType: "sport",
  async normalize() {
    throw new Error("Normalizer exploded.");
  }
};

function createStaticMockRepositories(): StaticNormalizerRepositories {
  return {
    sports: {
      upsertSport: vi.fn(),
      updateSport: vi.fn()
    },
    countries: {
      upsertCountry: vi.fn(),
      updateCountry: vi.fn()
    },
    competitions: {
      findCompetitionById: vi.fn(),
      upsertCompetition: vi.fn(),
      updateCompetition: vi.fn()
    },
    seasons: {
      upsertSeason: vi.fn(),
      updateSeason: vi.fn()
    },
    teams: {
      upsertTeam: vi.fn(),
      updateTeam: vi.fn()
    },
    players: {
      upsertPlayer: vi.fn(),
      updatePlayer: vi.fn()
    },
    matches: {
      findMatchById: vi.fn(),
      upsertMatch: vi.fn(),
      updateMatch: vi.fn()
    },
    footballMatchScores: {
      upsertByMatchId: vi.fn()
    },
    basketballMatchScores: {
      upsertByMatchId: vi.fn()
    },
    basketballPeriodScores: {
      upsertByMatchAndPeriod: vi.fn()
    },
    footballMatchTeamStatistics: {
      upsertByMatchAndTeam: vi.fn()
    },
    basketballTeamMatchStatistics: {
      upsertByMatchAndTeam: vi.fn()
    },
    footballStandings: {
      upsertByCompetitionSeasonTeam: vi.fn()
    },
    basketballStandings: {
      upsertByCompetitionSeasonTeam: vi.fn()
    },
    providerMappings: {
      findProviderMapping: vi.fn(),
      findOrCreateProviderMapping: vi.fn().mockImplementation(async (input: unknown) => input)
    }
  };
}
