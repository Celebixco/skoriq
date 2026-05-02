import { describe, expect, it, vi } from "vitest";
import {
  BasketballMatchScoreNormalizer,
  BasketballPeriodScoreNormalizer,
  BasketballStandingNormalizer,
  BasketballTeamMatchStatisticsNormalizer,
  CompetitionNormalizer,
  CountryNormalizer,
  FootballMatchScoreNormalizer,
  FootballStandingNormalizer,
  FootballMatchTeamStatisticsNormalizer,
  MatchNormalizer,
  PlayerNormalizer,
  SeasonNormalizer,
  SportNormalizer,
  TeamNormalizer,
  normalizeSlug
} from "./static-normalizers.js";
import type { StaticNormalizerRepositories } from "./static-normalizers.js";

describe("static entity normalizers", () => {
  it("normalizes sport payloads and creates provider mappings", async () => {
    const repositories = createMockRepositories();
    repositories.sports.upsertSport = vi.fn().mockResolvedValue({ id: "sport-1" });
    repositories.providerMappings.findProviderMapping = vi.fn().mockResolvedValue(undefined);

    const result = await new SportNormalizer(repositories).normalize(
      { providerEntityId: "football", name: "Football" },
      { provider: "mock", rawPayloadId: "raw-1", entityType: "sport" }
    );

    expect(result).toMatchObject({ status: "normalized", internalEntityIds: ["sport-1"], changed: true });
    expect(repositories.sports.upsertSport).toHaveBeenCalledWith({ slug: "football", name: "Football" });
    expect(repositories.providerMappings.findOrCreateProviderMapping).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "mock",
        entityType: "sport",
        providerEntityId: "football",
        internalEntityId: "sport-1"
      })
    );
  });

  it("reuses existing sport mappings instead of upserting by natural key", async () => {
    const repositories = createMockRepositories();
    repositories.providerMappings.findProviderMapping = vi.fn().mockResolvedValue({ internalEntityId: "sport-1" });
    repositories.sports.updateSport = vi.fn().mockResolvedValue({ id: "sport-1" });

    await new SportNormalizer(repositories).normalize({ providerEntityId: "football", name: "Football" }, { provider: "mock", rawPayloadId: "raw-1", entityType: "sport" });

    expect(repositories.sports.updateSport).toHaveBeenCalledWith("sport-1", { slug: "football", name: "Football" });
    expect(repositories.sports.upsertSport).not.toHaveBeenCalled();
  });

  it("normalizes country payloads with code and without code", async () => {
    const repositories = createMockRepositories();
    repositories.providerMappings.findProviderMapping = vi.fn().mockResolvedValue(undefined);
    repositories.countries.upsertCountry = vi.fn().mockResolvedValueOnce({ id: "country-1" }).mockResolvedValueOnce({ id: "country-2" });

    await new CountryNormalizer(repositories).normalize(
      [
        { providerEntityId: "gb-eng", name: "England", code: "gb-eng" },
        { providerEntityId: "world", name: "International" }
      ],
      { provider: "mock", rawPayloadId: "raw-1", entityType: "country" }
    );

    expect(repositories.countries.upsertCountry).toHaveBeenNthCalledWith(1, { code: "GB-ENG", slug: "gb-eng", name: "England" });
    expect(repositories.countries.upsertCountry).toHaveBeenNthCalledWith(2, { code: undefined, slug: "international", name: "International" });
  });

  it("normalizes competition only when sport and country dependencies are mapped", async () => {
    const repositories = createMockRepositories();
    repositories.providerMappings.findProviderMapping = vi
      .fn()
      .mockResolvedValueOnce({ internalEntityId: "sport-1" })
      .mockResolvedValueOnce({ internalEntityId: "country-1" })
      .mockResolvedValueOnce(undefined);
    repositories.competitions.upsertCompetition = vi.fn().mockResolvedValue({ id: "competition-1" });

    const result = await new CompetitionNormalizer(repositories).normalize(
      { providerEntityId: "premier-league", sportProviderId: "football", countryProviderId: "england", name: "Premier League", metadata: { tier: 1 } },
      { provider: "mock", rawPayloadId: "raw-1", entityType: "competition" }
    );

    expect(result.internalEntityIds).toEqual(["competition-1"]);
    expect(repositories.competitions.upsertCompetition).toHaveBeenCalledWith(
      expect.objectContaining({
        sportId: "sport-1",
        countryId: "country-1",
        slug: "premier-league",
        metadataJson: { tier: 1 }
      })
    );
  });

  it("fails competition normalization when sport mapping is missing", async () => {
    const repositories = createMockRepositories();
    repositories.providerMappings.findProviderMapping = vi.fn().mockResolvedValue(undefined);

    await expect(
      new CompetitionNormalizer(repositories).normalize(
        { providerEntityId: "premier-league", sportProviderId: "football", name: "Premier League" },
        { provider: "mock", rawPayloadId: "raw-1", entityType: "competition" }
      )
    ).rejects.toThrow('Cannot normalize competition "premier-league" without sport mapping "football".');
  });

  it("normalizes season only when competition dependency is mapped", async () => {
    const repositories = createMockRepositories();
    repositories.providerMappings.findProviderMapping = vi.fn().mockResolvedValueOnce({ internalEntityId: "competition-1" }).mockResolvedValueOnce(undefined);
    repositories.seasons.upsertSeason = vi.fn().mockResolvedValue({ id: "season-1" });

    const result = await new SeasonNormalizer(repositories).normalize(
      { providerEntityId: "pl-2026", competitionProviderId: "premier-league", name: "2025/2026", startDate: "2025-08-01", isCurrent: true },
      { provider: "mock", rawPayloadId: "raw-1", entityType: "season" }
    );

    expect(result.internalEntityIds).toEqual(["season-1"]);
    expect(repositories.seasons.upsertSeason).toHaveBeenCalledWith({
      competitionId: "competition-1",
      name: "2025/2026",
      startDate: "2025-08-01",
      endDate: undefined,
      isCurrent: true
    });
  });

  it("normalizes teams and creates provider mappings", async () => {
    const repositories = createMockRepositories();
    repositories.providerMappings.findProviderMapping = vi.fn().mockResolvedValueOnce({ internalEntityId: "sport-football" }).mockResolvedValueOnce({ internalEntityId: "country-tr" }).mockResolvedValueOnce(undefined);
    repositories.teams.upsertTeam = vi.fn().mockResolvedValue({ id: "team-1" });

    const result = await new TeamNormalizer(repositories).normalize(
      {
        providerEntityId: "galatasaray-football",
        sportProviderId: "football",
        countryProviderId: "turkey",
        name: "Galatasaray",
        shortName: "GS",
        gender: "male",
        type: "club",
        logoUrl: "https://example.test/gs.png",
        venueName: "Ali Sami Yen",
        foundedYear: 1905,
        metadata: { sourceTier: "profile" }
      },
      { provider: "mock", rawPayloadId: "raw-1", entityType: "team" }
    );

    expect(result).toMatchObject({ status: "normalized", internalEntityIds: ["team-1"], changed: true });
    expect(repositories.teams.upsertTeam).toHaveBeenCalledWith({
      sportId: "sport-football",
      countryId: "country-tr",
      name: "Galatasaray",
      shortName: "GS",
      slug: "galatasaray",
      gender: "male",
      type: "club",
      logoUrl: "https://example.test/gs.png",
      venueName: "Ali Sami Yen",
      foundedYear: 1905,
      metadataJson: { sourceTier: "profile" }
    });
    expect(repositories.providerMappings.findOrCreateProviderMapping).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "mock",
        entityType: "team",
        providerEntityId: "galatasaray-football",
        internalEntityId: "team-1"
      })
    );
  });

  it("reuses existing team mappings instead of upserting by natural key", async () => {
    const repositories = createMockRepositories();
    repositories.providerMappings.findProviderMapping = vi.fn().mockResolvedValueOnce({ internalEntityId: "sport-football" }).mockResolvedValueOnce({ internalEntityId: "team-1" });
    repositories.teams.updateTeam = vi.fn().mockResolvedValue({ id: "team-1" });

    await new TeamNormalizer(repositories).normalize(
      { providerEntityId: "galatasaray-football", sportProviderId: "football", name: "Galatasaray" },
      { provider: "mock", rawPayloadId: "raw-1", entityType: "team" }
    );

    expect(repositories.teams.updateTeam).toHaveBeenCalledWith("team-1", expect.objectContaining({ sportId: "sport-football", slug: "galatasaray" }));
    expect(repositories.teams.upsertTeam).not.toHaveBeenCalled();
  });

  it("keeps team normalization idempotent through sport-scoped natural keys", async () => {
    const repositories = createMockRepositories();
    repositories.providerMappings.findProviderMapping = vi
      .fn()
      .mockResolvedValueOnce({ internalEntityId: "sport-football" })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ internalEntityId: "sport-football" })
      .mockResolvedValueOnce(undefined);
    repositories.teams.upsertTeam = vi.fn().mockResolvedValue({ id: "team-1" });

    await new TeamNormalizer(repositories).normalize(
      [
        { providerEntityId: "gs-1", sportProviderId: "football", name: "Galatasaray" },
        { providerEntityId: "gs-1", sportProviderId: "football", name: "Galatasaray" }
      ],
      { provider: "mock", rawPayloadId: "raw-1", entityType: "team" }
    );

    expect(repositories.teams.upsertTeam).toHaveBeenCalledTimes(2);
    expect(repositories.teams.upsertTeam).toHaveBeenNthCalledWith(1, expect.objectContaining({ sportId: "sport-football", slug: "galatasaray" }));
    expect(repositories.teams.upsertTeam).toHaveBeenNthCalledWith(2, expect.objectContaining({ sportId: "sport-football", slug: "galatasaray" }));
  });

  it("allows the same team slug across different sports", async () => {
    const repositories = createMockRepositories();
    repositories.providerMappings.findProviderMapping = vi
      .fn()
      .mockResolvedValueOnce({ internalEntityId: "sport-football" })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ internalEntityId: "sport-basketball" })
      .mockResolvedValueOnce(undefined);
    repositories.teams.upsertTeam = vi.fn().mockResolvedValueOnce({ id: "team-football" }).mockResolvedValueOnce({ id: "team-basketball" });

    await new TeamNormalizer(repositories).normalize(
      [
        { providerEntityId: "gs-football", sportProviderId: "football", name: "Galatasaray" },
        { providerEntityId: "gs-basketball", sportProviderId: "basketball", name: "Galatasaray" }
      ],
      { provider: "mock", rawPayloadId: "raw-1", entityType: "team" }
    );

    expect(repositories.teams.upsertTeam).toHaveBeenNthCalledWith(1, expect.objectContaining({ sportId: "sport-football", slug: "galatasaray" }));
    expect(repositories.teams.upsertTeam).toHaveBeenNthCalledWith(2, expect.objectContaining({ sportId: "sport-basketball", slug: "galatasaray" }));
  });

  it("fails team normalization when sport mapping is missing", async () => {
    const repositories = createMockRepositories();
    repositories.providerMappings.findProviderMapping = vi.fn().mockResolvedValue(undefined);

    await expect(
      new TeamNormalizer(repositories).normalize(
        { providerEntityId: "galatasaray", sportProviderId: "football", name: "Galatasaray" },
        { provider: "mock", rawPayloadId: "raw-1", entityType: "team" }
      )
    ).rejects.toThrow('Cannot normalize team "galatasaray" without sport mapping "football".');
  });

  it("does not block team normalization when optional country mapping is missing", async () => {
    const repositories = createMockRepositories();
    repositories.providerMappings.findProviderMapping = vi.fn().mockResolvedValueOnce({ internalEntityId: "sport-football" }).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined);
    repositories.teams.upsertTeam = vi.fn().mockResolvedValue({ id: "team-1" });

    await new TeamNormalizer(repositories).normalize(
      { providerEntityId: "galatasaray", sportProviderId: "football", countryProviderId: "turkey", name: "Galatasaray" },
      { provider: "mock", rawPayloadId: "raw-1", entityType: "team" }
    );

    expect(repositories.teams.upsertTeam).toHaveBeenCalledWith(expect.objectContaining({ countryId: undefined }));
  });

  it("normalizes players and creates provider mappings", async () => {
    const repositories = createMockRepositories();
    repositories.providerMappings.findProviderMapping = vi
      .fn()
      .mockResolvedValueOnce({ internalEntityId: "sport-football" })
      .mockResolvedValueOnce({ internalEntityId: "team-1" })
      .mockResolvedValueOnce({ internalEntityId: "country-pt" })
      .mockResolvedValueOnce(undefined);
    repositories.players.upsertPlayer = vi.fn().mockResolvedValue({ id: "player-1" });

    const result = await new PlayerNormalizer(repositories).normalize(
      {
        providerEntityId: "ronaldo",
        sportProviderId: "football",
        currentTeamProviderId: "al-nassr",
        nationalityProviderId: "portugal",
        name: "Cristiano Ronaldo",
        shortName: "Ronaldo",
        dateOfBirth: "1985-02-05",
        age: 41,
        heightCm: 187,
        weightKg: 83,
        preferredFoot: "right",
        position: "forward",
        jerseyNumber: 7,
        marketValue: "1000000",
        contractUntil: "2026-06-30",
        photoUrl: "https://example.test/ronaldo.png",
        metadata: { profileQuality: "full" }
      },
      { provider: "mock", rawPayloadId: "raw-1", entityType: "player" }
    );

    expect(result).toMatchObject({ status: "normalized", internalEntityIds: ["player-1"], changed: true });
    expect(repositories.players.upsertPlayer).toHaveBeenCalledWith({
      sportId: "sport-football",
      nationalityCountryId: "country-pt",
      currentTeamId: "team-1",
      name: "Cristiano Ronaldo",
      shortName: "Ronaldo",
      slug: "cristiano-ronaldo",
      dateOfBirth: "1985-02-05",
      age: 41,
      heightCm: 187,
      weightKg: 83,
      preferredFoot: "right",
      position: "forward",
      jerseyNumber: 7,
      marketValue: "1000000",
      contractUntil: "2026-06-30",
      photoUrl: "https://example.test/ronaldo.png",
      metadataJson: { profileQuality: "full" }
    });
    expect(repositories.providerMappings.findOrCreateProviderMapping).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "mock",
        entityType: "player",
        providerEntityId: "ronaldo",
        internalEntityId: "player-1"
      })
    );
  });

  it("uses existing player mappings as the primary identity", async () => {
    const repositories = createMockRepositories();
    repositories.providerMappings.findProviderMapping = vi.fn().mockResolvedValueOnce({ internalEntityId: "sport-football" }).mockResolvedValueOnce({ internalEntityId: "player-1" });
    repositories.players.updatePlayer = vi.fn().mockResolvedValue({ id: "player-1" });

    await new PlayerNormalizer(repositories).normalize(
      { providerEntityId: "ronaldo", sportProviderId: "football", name: "Cristiano Ronaldo", slug: "cr7", dateOfBirth: "1985-02-05" },
      { provider: "mock", rawPayloadId: "raw-1", entityType: "player" }
    );

    expect(repositories.players.updatePlayer).toHaveBeenCalledWith("player-1", expect.objectContaining({ sportId: "sport-football", slug: "cr7" }));
    expect(repositories.players.upsertPlayer).not.toHaveBeenCalled();
  });

  it("keeps player normalization idempotent after mapping exists", async () => {
    const repositories = createMockRepositories();
    repositories.providerMappings.findProviderMapping = vi
      .fn()
      .mockResolvedValueOnce({ internalEntityId: "sport-football" })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ internalEntityId: "sport-football" })
      .mockResolvedValueOnce({ internalEntityId: "player-1" });
    repositories.players.upsertPlayer = vi.fn().mockResolvedValue({ id: "player-1" });
    repositories.players.updatePlayer = vi.fn().mockResolvedValue({ id: "player-1" });

    const normalizer = new PlayerNormalizer(repositories);
    await normalizer.normalize({ providerEntityId: "player-1", sportProviderId: "football", name: "Same Player" }, { provider: "mock", rawPayloadId: "raw-1", entityType: "player" });
    await normalizer.normalize({ providerEntityId: "player-1", sportProviderId: "football", name: "Same Player" }, { provider: "mock", rawPayloadId: "raw-2", entityType: "player" });

    expect(repositories.players.upsertPlayer).toHaveBeenCalledTimes(1);
    expect(repositories.players.updatePlayer).toHaveBeenCalledTimes(1);
  });

  it("allows the same player slug across different sports", async () => {
    const repositories = createMockRepositories();
    repositories.providerMappings.findProviderMapping = vi
      .fn()
      .mockResolvedValueOnce({ internalEntityId: "sport-football" })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ internalEntityId: "sport-basketball" })
      .mockResolvedValueOnce(undefined);
    repositories.players.upsertPlayer = vi.fn().mockResolvedValueOnce({ id: "player-football" }).mockResolvedValueOnce({ id: "player-basketball" });

    await new PlayerNormalizer(repositories).normalize(
      [
        { providerEntityId: "alex-football", sportProviderId: "football", name: "Alex Silva", slug: "alex-silva", dateOfBirth: "2000-01-01" },
        { providerEntityId: "alex-basketball", sportProviderId: "basketball", name: "Alex Silva", slug: "alex-silva", dateOfBirth: "2000-01-01" }
      ],
      { provider: "mock", rawPayloadId: "raw-1", entityType: "player" }
    );

    expect(repositories.players.upsertPlayer).toHaveBeenNthCalledWith(1, expect.objectContaining({ sportId: "sport-football", slug: "alex-silva" }));
    expect(repositories.players.upsertPlayer).toHaveBeenNthCalledWith(2, expect.objectContaining({ sportId: "sport-basketball", slug: "alex-silva" }));
  });

  it("fails player normalization when sport mapping is missing", async () => {
    const repositories = createMockRepositories();
    repositories.providerMappings.findProviderMapping = vi.fn().mockResolvedValue(undefined);

    await expect(
      new PlayerNormalizer(repositories).normalize(
        { providerEntityId: "ronaldo", sportProviderId: "football", name: "Cristiano Ronaldo" },
        { provider: "mock", rawPayloadId: "raw-1", entityType: "player" }
      )
    ).rejects.toThrow('Cannot normalize player "ronaldo" without sport mapping "football".');
  });

  it("does not block player normalization when optional team or nationality mappings are missing", async () => {
    const repositories = createMockRepositories();
    repositories.providerMappings.findProviderMapping = vi.fn().mockResolvedValueOnce({ internalEntityId: "sport-football" }).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined);
    repositories.players.upsertPlayer = vi.fn().mockResolvedValue({ id: "player-1" });

    await new PlayerNormalizer(repositories).normalize(
      { providerEntityId: "ronaldo", sportProviderId: "football", currentTeamProviderId: "al-nassr", nationalityProviderId: "portugal", name: "Cristiano Ronaldo" },
      { provider: "mock", rawPayloadId: "raw-1", entityType: "player" }
    );

    expect(repositories.players.upsertPlayer).toHaveBeenCalledWith(expect.objectContaining({ currentTeamId: undefined, nationalityCountryId: undefined }));
  });

  it("normalizes matches and creates provider mappings", async () => {
    const repositories = createMockRepositories();
    repositories.providerMappings.findProviderMapping = vi
      .fn()
      .mockResolvedValueOnce({ internalEntityId: "competition-1" })
      .mockResolvedValueOnce({ internalEntityId: "sport-football" })
      .mockResolvedValueOnce({ internalEntityId: "season-1" })
      .mockResolvedValueOnce({ internalEntityId: "home-team" })
      .mockResolvedValueOnce({ internalEntityId: "away-team" })
      .mockResolvedValueOnce({ internalEntityId: "home-team" })
      .mockResolvedValueOnce(undefined);
    repositories.matches.upsertMatch = vi.fn().mockResolvedValue({ id: "match-1" });

    const result = await new MatchNormalizer(repositories).normalize(
      {
        providerEntityId: "match-1",
        sportProviderId: "football",
        competitionProviderId: "premier-league",
        seasonProviderId: "pl-2026",
        homeTeamProviderId: "arsenal",
        awayTeamProviderId: "chelsea",
        winnerProviderTeamId: "arsenal",
        scheduledStartAt: "2026-05-01T17:00:00.000Z",
        status: "finished",
        roundName: "Round 1",
        stageName: "Regular Season",
        venueName: "Emirates Stadium",
        refereeName: "Referee One",
        neutralGround: false,
        attendance: 60000,
        homeScoreFinal: 2,
        awayScoreFinal: 1,
        metadata: { source: "fixture" }
      },
      { provider: "mock", rawPayloadId: "raw-1", entityType: "match" }
    );

    expect(result).toMatchObject({ status: "normalized", internalEntityIds: ["match-1"], changed: true });
    expect(repositories.matches.upsertMatch).toHaveBeenCalledWith(
      expect.objectContaining({
        sportId: "sport-football",
        competitionId: "competition-1",
        seasonId: "season-1",
        homeTeamId: "home-team",
        awayTeamId: "away-team",
        status: "finished",
        round: "Round 1",
        venue: "Emirates Stadium",
        referee: "Referee One",
        stageName: "Regular Season",
        neutralGround: false,
        attendance: 60000,
        winnerTeamId: "home-team",
        metadataJson: { source: "fixture", scoreSummary: { homeScoreFinal: 2, awayScoreFinal: 1 } }
      })
    );
    expect(repositories.providerMappings.findOrCreateProviderMapping).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "mock",
        entityType: "match",
        providerEntityId: "match-1",
        internalEntityId: "match-1"
      })
    );
  });

  it("reuses existing match mappings instead of upserting by natural key", async () => {
    const repositories = createMockRepositories();
    repositories.providerMappings.findProviderMapping = vi
      .fn()
      .mockResolvedValueOnce({ internalEntityId: "competition-1" })
      .mockResolvedValueOnce({ internalEntityId: "sport-football" })
      .mockResolvedValueOnce({ internalEntityId: "home-team" })
      .mockResolvedValueOnce({ internalEntityId: "away-team" })
      .mockResolvedValueOnce({ internalEntityId: "match-1" });
    repositories.matches.updateMatch = vi.fn().mockResolvedValue({ id: "match-1" });

    await new MatchNormalizer(repositories).normalize(
      {
        providerEntityId: "match-1",
        sportProviderId: "football",
        competitionProviderId: "premier-league",
        homeTeamProviderId: "arsenal",
        awayTeamProviderId: "chelsea",
        scheduledStartAt: "2026-05-01T17:00:00.000Z",
        status: "scheduled"
      },
      { provider: "mock", rawPayloadId: "raw-1", entityType: "match" }
    );

    expect(repositories.matches.updateMatch).toHaveBeenCalledWith("match-1", expect.objectContaining({ competitionId: "competition-1", status: "scheduled" }));
    expect(repositories.matches.upsertMatch).not.toHaveBeenCalled();
  });

  it("uses competition sport when match sport provider id is absent", async () => {
    const repositories = createMockRepositories();
    repositories.providerMappings.findProviderMapping = vi
      .fn()
      .mockResolvedValueOnce({ internalEntityId: "competition-1" })
      .mockResolvedValueOnce({ internalEntityId: "home-team" })
      .mockResolvedValueOnce({ internalEntityId: "away-team" })
      .mockResolvedValueOnce(undefined);
    repositories.competitions.findCompetitionById = vi.fn().mockResolvedValue({ id: "competition-1", sportId: "sport-football" });
    repositories.matches.upsertMatch = vi.fn().mockResolvedValue({ id: "match-1" });

    await new MatchNormalizer(repositories).normalize(
      {
        providerEntityId: "match-1",
        competitionProviderId: "premier-league",
        homeTeamProviderId: "arsenal",
        awayTeamProviderId: "chelsea",
        scheduledStartAt: "2026-05-01T17:00:00.000Z",
        status: "scheduled"
      },
      { provider: "mock", rawPayloadId: "raw-1", entityType: "match" }
    );

    expect(repositories.matches.upsertMatch).toHaveBeenCalledWith(expect.objectContaining({ sportId: "sport-football" }));
  });

  it("fails match normalization when required dependency mappings are missing", async () => {
    const repositories = createMockRepositories();
    repositories.providerMappings.findProviderMapping = vi.fn().mockResolvedValue(undefined);
    const payload = {
      providerEntityId: "match-1",
      competitionProviderId: "premier-league",
      homeTeamProviderId: "arsenal",
      awayTeamProviderId: "chelsea",
      scheduledStartAt: "2026-05-01T17:00:00.000Z",
      status: "scheduled"
    };

    await expect(new MatchNormalizer(repositories).normalize(payload, { provider: "mock", rawPayloadId: "raw-1", entityType: "match" })).rejects.toThrow(
      'Cannot normalize match "match-1" without competition mapping "premier-league".'
    );

    repositories.providerMappings.findProviderMapping = vi.fn().mockResolvedValueOnce({ internalEntityId: "competition-1" }).mockResolvedValueOnce({ internalEntityId: "sport-football" }).mockResolvedValueOnce(undefined);
    await expect(new MatchNormalizer(repositories).normalize({ ...payload, sportProviderId: "football" }, { provider: "mock", rawPayloadId: "raw-1", entityType: "match" })).rejects.toThrow(
      'Cannot normalize match "match-1" without home team mapping "arsenal".'
    );

    repositories.providerMappings.findProviderMapping = vi
      .fn()
      .mockResolvedValueOnce({ internalEntityId: "competition-1" })
      .mockResolvedValueOnce({ internalEntityId: "sport-football" })
      .mockResolvedValueOnce({ internalEntityId: "home-team" })
      .mockResolvedValueOnce(undefined);
    await expect(new MatchNormalizer(repositories).normalize({ ...payload, sportProviderId: "football" }, { provider: "mock", rawPayloadId: "raw-1", entityType: "match" })).rejects.toThrow(
      'Cannot normalize match "match-1" without away team mapping "chelsea".'
    );
  });

  it("does not block match normalization when optional season or winner mappings are missing", async () => {
    const repositories = createMockRepositories();
    repositories.providerMappings.findProviderMapping = vi
      .fn()
      .mockResolvedValueOnce({ internalEntityId: "competition-1" })
      .mockResolvedValueOnce({ internalEntityId: "sport-football" })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ internalEntityId: "home-team" })
      .mockResolvedValueOnce({ internalEntityId: "away-team" })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);
    repositories.matches.upsertMatch = vi.fn().mockResolvedValue({ id: "match-1" });

    await new MatchNormalizer(repositories).normalize(
      {
        providerEntityId: "match-1",
        sportProviderId: "football",
        competitionProviderId: "premier-league",
        seasonProviderId: "pl-2026",
        homeTeamProviderId: "arsenal",
        awayTeamProviderId: "chelsea",
        winnerProviderTeamId: "arsenal",
        scheduledStartAt: "2026-05-01T17:00:00.000Z",
        status: "finished"
      },
      { provider: "mock", rawPayloadId: "raw-1", entityType: "match" }
    );

    expect(repositories.matches.upsertMatch).toHaveBeenCalledWith(expect.objectContaining({ seasonId: undefined, winnerTeamId: undefined }));
  });

  it("rejects invalid match statuses", async () => {
    await expect(
      new MatchNormalizer(createMockRepositories()).normalize(
        {
          providerEntityId: "match-1",
          competitionProviderId: "premier-league",
          homeTeamProviderId: "arsenal",
          awayTeamProviderId: "chelsea",
          scheduledStartAt: "2026-05-01T17:00:00.000Z",
          status: "live_second_half"
        },
        { provider: "mock", rawPayloadId: "raw-1", entityType: "match" }
      )
    ).rejects.toThrow('Invalid match status "live_second_half".');
  });

  it("normalizes football match scores for mapped matches without score provider mappings", async () => {
    const repositories = createMockRepositories();
    repositories.providerMappings.findProviderMapping = vi.fn().mockResolvedValueOnce({ internalEntityId: "match-1" }).mockResolvedValueOnce({ internalEntityId: "home-team" });
    repositories.matches.findMatchById = vi.fn().mockResolvedValue({ id: "match-1", homeTeamId: "home-team", awayTeamId: "away-team" });
    repositories.footballMatchScores.upsertByMatchId = vi.fn().mockResolvedValue({ id: "football-score-1" });

    const result = await new FootballMatchScoreNormalizer(repositories).normalize(
      {
        providerEntityId: "football-score-1",
        matchProviderId: "match-1",
        homeScoreHalfTime: 1,
        awayScoreHalfTime: 0,
        homeScoreFullTime: 2,
        awayScoreFullTime: 1,
        winnerProviderTeamId: "home-team",
        status: "finished",
        metadata: { source: "summary" }
      },
      { provider: "mock", rawPayloadId: "raw-1", entityType: "football_match_score" }
    );

    expect(result).toMatchObject({ status: "normalized", internalEntityIds: ["football-score-1"], changed: true });
    expect(repositories.footballMatchScores.upsertByMatchId).toHaveBeenCalledWith({
      matchId: "match-1",
      homeTeamId: "home-team",
      awayTeamId: "away-team",
      winnerTeamId: "home-team",
      homeScoreCurrent: undefined,
      awayScoreCurrent: undefined,
      homeScoreHalftime: 1,
      awayScoreHalftime: 0,
      homeScoreFulltime: 2,
      awayScoreFulltime: 1,
      homeScoreExtraTime: undefined,
      awayScoreExtraTime: undefined,
      homeScorePenalties: undefined,
      awayScorePenalties: undefined,
      status: "finished",
      metadataJson: { source: "summary" }
    });
    expect(repositories.providerMappings.findOrCreateProviderMapping).not.toHaveBeenCalled();
  });

  it("updates football match score idempotently through match-scoped upsert", async () => {
    const repositories = createMockRepositories();
    repositories.providerMappings.findProviderMapping = vi.fn().mockResolvedValue({ internalEntityId: "match-1" });
    repositories.matches.findMatchById = vi.fn().mockResolvedValue({ id: "match-1", homeTeamId: "home-team", awayTeamId: "away-team" });
    repositories.footballMatchScores.upsertByMatchId = vi.fn().mockResolvedValue({ id: "football-score-1" });

    await new FootballMatchScoreNormalizer(repositories).normalize(
      [
        { providerEntityId: "football-score-1", matchProviderId: "match-1", homeScoreFullTime: 2, awayScoreFullTime: 1 },
        { providerEntityId: "football-score-1", matchProviderId: "match-1", homeScoreFullTime: 3, awayScoreFullTime: 1 }
      ],
      { provider: "mock", rawPayloadId: "raw-1", entityType: "football_match_score" }
    );

    expect(repositories.footballMatchScores.upsertByMatchId).toHaveBeenCalledTimes(2);
  });

  it("fails football match score normalization when match mapping is missing", async () => {
    const repositories = createMockRepositories();
    repositories.providerMappings.findProviderMapping = vi.fn().mockResolvedValue(undefined);

    await expect(
      new FootballMatchScoreNormalizer(repositories).normalize(
        { providerEntityId: "football-score-1", matchProviderId: "missing-match" },
        { provider: "mock", rawPayloadId: "raw-1", entityType: "football_match_score" }
      )
    ).rejects.toThrow('Cannot normalize football match score "football-score-1" without match mapping "missing-match".');
  });

  it("normalizes basketball match scores and keeps them out of football score storage", async () => {
    const repositories = createMockRepositories();
    repositories.providerMappings.findProviderMapping = vi.fn().mockResolvedValueOnce({ internalEntityId: "match-1" });
    repositories.matches.findMatchById = vi.fn().mockResolvedValue({ id: "match-1", homeTeamId: "home-team", awayTeamId: "away-team" });
    repositories.basketballMatchScores.upsertByMatchId = vi.fn().mockResolvedValue({ id: "basketball-score-1" });

    await new BasketballMatchScoreNormalizer(repositories).normalize(
      { providerEntityId: "basketball-score-1", matchProviderId: "match-1", homeScoreFinal: 91, awayScoreFinal: 87, status: "finished" },
      { provider: "mock", rawPayloadId: "raw-1", entityType: "basketball_match_score" }
    );

    expect(repositories.basketballMatchScores.upsertByMatchId).toHaveBeenCalledWith(expect.objectContaining({ homeScoreFinal: 91, awayScoreFinal: 87 }));
    expect(repositories.footballMatchScores.upsertByMatchId).not.toHaveBeenCalled();
  });

  it("updates basketball match score idempotently through match-scoped upsert", async () => {
    const repositories = createMockRepositories();
    repositories.providerMappings.findProviderMapping = vi.fn().mockResolvedValue({ internalEntityId: "match-1" });
    repositories.matches.findMatchById = vi.fn().mockResolvedValue({ id: "match-1", homeTeamId: "home-team", awayTeamId: "away-team" });
    repositories.basketballMatchScores.upsertByMatchId = vi.fn().mockResolvedValue({ id: "basketball-score-1" });

    await new BasketballMatchScoreNormalizer(repositories).normalize(
      [
        { providerEntityId: "basketball-score-1", matchProviderId: "match-1", homeScoreFinal: 91, awayScoreFinal: 87 },
        { providerEntityId: "basketball-score-1", matchProviderId: "match-1", homeScoreFinal: 92, awayScoreFinal: 87 }
      ],
      { provider: "mock", rawPayloadId: "raw-1", entityType: "basketball_match_score" }
    );

    expect(repositories.basketballMatchScores.upsertByMatchId).toHaveBeenCalledTimes(2);
  });

  it("normalizes basketball quarter and overtime period scores idempotently", async () => {
    const repositories = createMockRepositories();
    repositories.providerMappings.findProviderMapping = vi.fn().mockResolvedValue({ internalEntityId: "match-1" });
    repositories.matches.findMatchById = vi.fn().mockResolvedValue({ id: "match-1", homeTeamId: "home-team", awayTeamId: "away-team" });
    repositories.basketballPeriodScores.upsertByMatchAndPeriod = vi.fn().mockResolvedValue({ id: "period-score-1" });

    await new BasketballPeriodScoreNormalizer(repositories).normalize(
      [
        { providerEntityId: "q1", matchProviderId: "match-1", periodType: "q1", periodNumber: 1, homeScore: 22, awayScore: 20 },
        { providerEntityId: "q2", matchProviderId: "match-1", periodType: "q2", periodNumber: 2, homeScore: 24, awayScore: 19 },
        { providerEntityId: "q3", matchProviderId: "match-1", periodType: "q3", periodNumber: 3, homeScore: 20, awayScore: 22 },
        { providerEntityId: "q4", matchProviderId: "match-1", periodType: "q4", periodNumber: 4, homeScore: 25, awayScore: 26 },
        { providerEntityId: "ot1", matchProviderId: "match-1", periodType: "overtime", periodNumber: 5, overtimeNumber: 1, homeScore: 8, awayScore: 6 },
        { providerEntityId: "ot1", matchProviderId: "match-1", periodType: "overtime", periodNumber: 5, overtimeNumber: 1, homeScore: 9, awayScore: 6 }
      ],
      { provider: "mock", rawPayloadId: "raw-1", entityType: "basketball_period_score" }
    );

    expect(repositories.basketballPeriodScores.upsertByMatchAndPeriod).toHaveBeenCalledTimes(6);
    expect(repositories.basketballPeriodScores.upsertByMatchAndPeriod).toHaveBeenLastCalledWith(
      expect.objectContaining({ periodType: "overtime", periodNumber: 5, overtimeNumber: 1, homeScore: 9, awayScore: 6 })
    );
  });

  it("rejects invalid basketball period score payloads", async () => {
    await expect(
      new BasketballPeriodScoreNormalizer(createMockRepositories()).normalize(
        { providerEntityId: "period-1", matchProviderId: "match-1", periodType: "half", periodNumber: 1, homeScore: 10, awayScore: 11 },
        { provider: "mock", rawPayloadId: "raw-1", entityType: "basketball_period_score" }
      )
    ).rejects.toThrow('Invalid basketball period type "half" for basketball_period_score.periodType.');
  });

  it("normalizes football team statistics and derives opponent/home fields", async () => {
    const repositories = createMockRepositories();
    repositories.providerMappings.findProviderMapping = vi.fn().mockResolvedValueOnce({ internalEntityId: "match-1" }).mockResolvedValueOnce({ internalEntityId: "home-team" });
    repositories.matches.findMatchById = vi.fn().mockResolvedValue({ id: "match-1", homeTeamId: "home-team", awayTeamId: "away-team" });
    repositories.footballMatchTeamStatistics.upsertByMatchAndTeam = vi.fn().mockResolvedValue({ id: "football-stat-1" });

    const result = await new FootballMatchTeamStatisticsNormalizer(repositories).normalize(
      {
        providerEntityId: "football-stat-1",
        matchProviderId: "match-1",
        teamProviderId: "home",
        possessionPercent: 58.5,
        shotsTotal: 12,
        shotsOnTarget: 5,
        passAccuracyPercent: 82.3,
        expectedGoals: 1.75,
        metadata: { source: "team-stats" }
      },
      { provider: "mock", rawPayloadId: "raw-1", entityType: "football_match_team_statistics" }
    );

    expect(result).toMatchObject({ status: "normalized", internalEntityIds: ["football-stat-1"], changed: true });
    expect(repositories.footballMatchTeamStatistics.upsertByMatchAndTeam).toHaveBeenCalledWith(
      expect.objectContaining({
        matchId: "match-1",
        teamId: "home-team",
        opponentTeamId: "away-team",
        isHome: true,
        possessionPercent: 58.5,
        shotsTotal: 12,
        shotsOnTarget: 5,
        passAccuracyPercent: 82.3,
        expectedGoals: 1.75,
        metadataJson: { source: "team-stats" }
      })
    );
    expect(repositories.basketballTeamMatchStatistics.upsertByMatchAndTeam).not.toHaveBeenCalled();
    expect(repositories.providerMappings.findOrCreateProviderMapping).not.toHaveBeenCalled();
  });

  it("keeps football team statistics idempotent through match/team upsert", async () => {
    const repositories = createMockRepositories();
    repositories.providerMappings.findProviderMapping = vi.fn().mockResolvedValueOnce({ internalEntityId: "match-1" }).mockResolvedValueOnce({ internalEntityId: "away-team" }).mockResolvedValueOnce({ internalEntityId: "match-1" }).mockResolvedValueOnce({ internalEntityId: "away-team" });
    repositories.matches.findMatchById = vi.fn().mockResolvedValue({ id: "match-1", homeTeamId: "home-team", awayTeamId: "away-team" });
    repositories.footballMatchTeamStatistics.upsertByMatchAndTeam = vi.fn().mockResolvedValue({ id: "football-stat-1" });

    await new FootballMatchTeamStatisticsNormalizer(repositories).normalize(
      [
        { matchProviderId: "match-1", teamProviderId: "away", shotsTotal: 8 },
        { matchProviderId: "match-1", teamProviderId: "away", shotsTotal: 9 }
      ],
      { provider: "mock", rawPayloadId: "raw-1", entityType: "football_match_team_statistics" }
    );

    expect(repositories.footballMatchTeamStatistics.upsertByMatchAndTeam).toHaveBeenCalledTimes(2);
    expect(repositories.footballMatchTeamStatistics.upsertByMatchAndTeam).toHaveBeenLastCalledWith(expect.objectContaining({ isHome: false, opponentTeamId: "home-team", shotsTotal: 9 }));
  });

  it("fails football team statistics when dependencies are missing or team is not in match", async () => {
    const repositories = createMockRepositories();
    repositories.providerMappings.findProviderMapping = vi.fn().mockResolvedValue(undefined);

    await expect(
      new FootballMatchTeamStatisticsNormalizer(repositories).normalize(
        { matchProviderId: "missing-match", teamProviderId: "home" },
        { provider: "mock", rawPayloadId: "raw-1", entityType: "football_match_team_statistics" }
      )
    ).rejects.toThrow('Cannot normalize football match team statistics "missing-match:home" without match mapping "missing-match".');

    repositories.providerMappings.findProviderMapping = vi.fn().mockResolvedValueOnce({ internalEntityId: "match-1" }).mockResolvedValueOnce(undefined);
    repositories.matches.findMatchById = vi.fn().mockResolvedValue({ id: "match-1", homeTeamId: "home-team", awayTeamId: "away-team" });
    await expect(
      new FootballMatchTeamStatisticsNormalizer(repositories).normalize(
        { matchProviderId: "match-1", teamProviderId: "missing-team" },
        { provider: "mock", rawPayloadId: "raw-1", entityType: "football_match_team_statistics" }
      )
    ).rejects.toThrow('Cannot normalize football match team statistics "match-1:missing-team" without team mapping "missing-team".');

    repositories.providerMappings.findProviderMapping = vi.fn().mockResolvedValueOnce({ internalEntityId: "match-1" }).mockResolvedValueOnce({ internalEntityId: "third-team" });
    await expect(
      new FootballMatchTeamStatisticsNormalizer(repositories).normalize(
        { matchProviderId: "match-1", teamProviderId: "third-team" },
        { provider: "mock", rawPayloadId: "raw-1", entityType: "football_match_team_statistics" }
      )
    ).rejects.toThrow('Cannot normalize football match team statistics "match-1:third-team" because team "third-team" is not part of match "match-1".');
  });

  it("validates football team statistics counts and percentages", async () => {
    await expect(
      new FootballMatchTeamStatisticsNormalizer(createMockRepositories()).normalize(
        { matchProviderId: "match-1", teamProviderId: "home", shotsTotal: -1 },
        { provider: "mock", rawPayloadId: "raw-1", entityType: "football_match_team_statistics" }
      )
    ).rejects.toThrow("Invalid non-negative integer field football_match_team_statistics.shotsTotal.");

    await expect(
      new FootballMatchTeamStatisticsNormalizer(createMockRepositories()).normalize(
        { matchProviderId: "match-1", teamProviderId: "home", possessionPercent: 101 },
        { provider: "mock", rawPayloadId: "raw-1", entityType: "football_match_team_statistics" }
      )
    ).rejects.toThrow("Invalid percentage field football_match_team_statistics.possessionPercent.");
  });

  it("normalizes basketball team statistics and keeps them out of football statistics storage", async () => {
    const repositories = createMockRepositories();
    repositories.providerMappings.findProviderMapping = vi.fn().mockResolvedValueOnce({ internalEntityId: "match-1" }).mockResolvedValueOnce({ internalEntityId: "away-team" });
    repositories.matches.findMatchById = vi.fn().mockResolvedValue({ id: "match-1", homeTeamId: "home-team", awayTeamId: "away-team" });
    repositories.basketballTeamMatchStatistics.upsertByMatchAndTeam = vi.fn().mockResolvedValue({ id: "basketball-stat-1" });

    await new BasketballTeamMatchStatisticsNormalizer(repositories).normalize(
      {
        providerEntityId: "basketball-stat-1",
        matchProviderId: "match-1",
        teamProviderId: "away",
        fieldGoalsMade: 32,
        fieldGoalsAttempted: 70,
        fieldGoalPercent: 45.71,
        threePointPercent: 37.5,
        reboundsTotal: 41,
        assists: 23,
        turnovers: 12,
        metadata: { source: "box-score" }
      },
      { provider: "mock", rawPayloadId: "raw-1", entityType: "basketball_team_match_statistics" }
    );

    expect(repositories.basketballTeamMatchStatistics.upsertByMatchAndTeam).toHaveBeenCalledWith(
      expect.objectContaining({
        matchId: "match-1",
        teamId: "away-team",
        opponentTeamId: "home-team",
        isHome: false,
        fieldGoalsMade: 32,
        fieldGoalPercent: 45.71,
        threePointPercent: 37.5,
        reboundsTotal: 41,
        metadataJson: { source: "box-score" }
      })
    );
    expect(repositories.footballMatchTeamStatistics.upsertByMatchAndTeam).not.toHaveBeenCalled();
  });

  it("keeps basketball team statistics idempotent through match/team upsert", async () => {
    const repositories = createMockRepositories();
    repositories.providerMappings.findProviderMapping = vi.fn().mockResolvedValue({ internalEntityId: "match-1" });
    repositories.matches.findMatchById = vi.fn().mockResolvedValue({ id: "match-1", homeTeamId: "match-1", awayTeamId: "away-team" });
    repositories.basketballTeamMatchStatistics.upsertByMatchAndTeam = vi.fn().mockResolvedValue({ id: "basketball-stat-1" });

    await new BasketballTeamMatchStatisticsNormalizer(repositories).normalize(
      [
        { matchProviderId: "match-1", teamProviderId: "home", fieldGoalPercent: 45 },
        { matchProviderId: "match-1", teamProviderId: "home", fieldGoalPercent: 46 }
      ],
      { provider: "mock", rawPayloadId: "raw-1", entityType: "basketball_team_match_statistics" }
    );

    expect(repositories.basketballTeamMatchStatistics.upsertByMatchAndTeam).toHaveBeenCalledTimes(2);
  });

  it("validates basketball team statistics percentages and team membership", async () => {
    await expect(
      new BasketballTeamMatchStatisticsNormalizer(createMockRepositories()).normalize(
        { matchProviderId: "match-1", teamProviderId: "home", fieldGoalPercent: 120 },
        { provider: "mock", rawPayloadId: "raw-1", entityType: "basketball_team_match_statistics" }
      )
    ).rejects.toThrow("Invalid percentage field basketball_team_match_statistics.fieldGoalPercent.");

    const repositories = createMockRepositories();
    repositories.providerMappings.findProviderMapping = vi.fn().mockResolvedValueOnce({ internalEntityId: "match-1" }).mockResolvedValueOnce({ internalEntityId: "third-team" });
    repositories.matches.findMatchById = vi.fn().mockResolvedValue({ id: "match-1", homeTeamId: "home-team", awayTeamId: "away-team" });

    await expect(
      new BasketballTeamMatchStatisticsNormalizer(repositories).normalize(
        { matchProviderId: "match-1", teamProviderId: "third-team" },
        { provider: "mock", rawPayloadId: "raw-1", entityType: "basketball_team_match_statistics" }
      )
    ).rejects.toThrow('Cannot normalize basketball team match statistics "match-1:third-team" because team "third-team" is not part of match "match-1".');
  });

  it("normalizes football standings with optional season and no standing provider mapping", async () => {
    const repositories = createMockRepositories();
    repositories.providerMappings.findProviderMapping = vi.fn().mockResolvedValueOnce({ internalEntityId: "competition-1" }).mockResolvedValueOnce({ internalEntityId: "season-1" }).mockResolvedValueOnce({ internalEntityId: "team-1" });
    repositories.footballStandings.upsertByCompetitionSeasonTeam = vi.fn().mockResolvedValue({ id: "football-standing-1" });

    const result = await new FootballStandingNormalizer(repositories).normalize(
      {
        providerEntityId: "standing-1",
        competitionProviderId: "premier-league",
        seasonProviderId: "pl-2026",
        teamProviderId: "arsenal",
        position: 1,
        played: 10,
        wins: 7,
        draws: 2,
        losses: 1,
        goalsFor: 21,
        goalsAgainst: 8,
        goalDifference: 13,
        points: 23,
        formString: "WWDLW",
        metadata: { source: "table" }
      },
      { provider: "mock", rawPayloadId: "raw-1", entityType: "football_standing" }
    );

    expect(result).toMatchObject({ status: "normalized", internalEntityIds: ["football-standing-1"], changed: true });
    expect(repositories.footballStandings.upsertByCompetitionSeasonTeam).toHaveBeenCalledWith(
      expect.objectContaining({
        competitionId: "competition-1",
        seasonId: "season-1",
        teamId: "team-1",
        position: 1,
        played: 10,
        wins: 7,
        draws: 2,
        losses: 1,
        goalDifference: 13,
        metadataJson: { source: "table" }
      })
    );
    expect(repositories.providerMappings.findOrCreateProviderMapping).not.toHaveBeenCalled();
  });

  it("keeps football standings idempotent through competition/season/team upsert", async () => {
    const repositories = createMockRepositories();
    repositories.providerMappings.findProviderMapping = vi.fn().mockResolvedValue({ internalEntityId: "entity-1" });
    repositories.footballStandings.upsertByCompetitionSeasonTeam = vi.fn().mockResolvedValue({ id: "football-standing-1" });

    await new FootballStandingNormalizer(repositories).normalize(
      [
        { competitionProviderId: "league", teamProviderId: "team", position: 1, played: 1, wins: 1, draws: 0, losses: 0, goalsFor: 2, goalsAgainst: 0, goalDifference: 2, points: 3 },
        { competitionProviderId: "league", teamProviderId: "team", position: 2, played: 2, wins: 1, draws: 0, losses: 1, goalsFor: 2, goalsAgainst: 1, goalDifference: 1, points: 3 }
      ],
      { provider: "mock", rawPayloadId: "raw-1", entityType: "football_standing" }
    );

    expect(repositories.footballStandings.upsertByCompetitionSeasonTeam).toHaveBeenCalledTimes(2);
    expect(repositories.footballStandings.upsertByCompetitionSeasonTeam).toHaveBeenLastCalledWith(expect.objectContaining({ seasonId: undefined, position: 2 }));
  });

  it("fails football standings when required dependency mappings are missing", async () => {
    const repositories = createMockRepositories();
    repositories.providerMappings.findProviderMapping = vi.fn().mockResolvedValue(undefined);
    const payload = { competitionProviderId: "league", teamProviderId: "team", position: 1, played: 1, wins: 1, draws: 0, losses: 0, goalsFor: 2, goalsAgainst: 0, goalDifference: 2, points: 3 };

    await expect(new FootballStandingNormalizer(repositories).normalize(payload, { provider: "mock", rawPayloadId: "raw-1", entityType: "football_standing" })).rejects.toThrow(
      'Cannot normalize football standing "league:team" without competition mapping "league".'
    );

    repositories.providerMappings.findProviderMapping = vi.fn().mockResolvedValueOnce({ internalEntityId: "competition-1" }).mockResolvedValueOnce(undefined);
    await expect(new FootballStandingNormalizer(repositories).normalize({ ...payload, seasonProviderId: "season" }, { provider: "mock", rawPayloadId: "raw-1", entityType: "football_standing" })).rejects.toThrow(
      'Cannot normalize football standing "league:team" without season mapping "season".'
    );

    repositories.providerMappings.findProviderMapping = vi.fn().mockResolvedValueOnce({ internalEntityId: "competition-1" }).mockResolvedValueOnce(undefined);
    await expect(new FootballStandingNormalizer(repositories).normalize(payload, { provider: "mock", rawPayloadId: "raw-1", entityType: "football_standing" })).rejects.toThrow(
      'Cannot normalize football standing "league:team" without team mapping "team".'
    );
  });

  it("validates football standing values", async () => {
    await expect(
      new FootballStandingNormalizer(createMockRepositories()).normalize(
        { competitionProviderId: "league", teamProviderId: "team", position: 0, played: 1, wins: 1, draws: 0, losses: 0, goalsFor: 1, goalsAgainst: 0, goalDifference: 1, points: 3 },
        { provider: "mock", rawPayloadId: "raw-1", entityType: "football_standing" }
      )
    ).rejects.toThrow("Invalid positive integer field football_standing.position.");

    await expect(
      new FootballStandingNormalizer(createMockRepositories()).normalize(
        { competitionProviderId: "league", teamProviderId: "team", position: 1, played: -1, wins: 1, draws: 0, losses: 0, goalsFor: 1, goalsAgainst: 0, goalDifference: 1, points: 3 },
        { provider: "mock", rawPayloadId: "raw-1", entityType: "football_standing" }
      )
    ).rejects.toThrow("Invalid non-negative integer field football_standing.played.");
  });

  it("normalizes basketball standings and keeps them separate from football standings", async () => {
    const repositories = createMockRepositories();
    repositories.providerMappings.findProviderMapping = vi.fn().mockResolvedValueOnce({ internalEntityId: "competition-1" }).mockResolvedValueOnce({ internalEntityId: "team-1" });
    repositories.basketballStandings.upsertByCompetitionSeasonTeam = vi.fn().mockResolvedValue({ id: "basketball-standing-1" });

    await new BasketballStandingNormalizer(repositories).normalize(
      {
        providerEntityId: "standing-1",
        competitionProviderId: "nba",
        teamProviderId: "lakers",
        position: 3,
        played: 10,
        wins: 6,
        losses: 4,
        winPercentage: 60,
        pointsFor: 1120,
        pointsAgainst: 1095,
        pointDifference: 25,
        conference: "West",
        metadata: { source: "table" }
      },
      { provider: "mock", rawPayloadId: "raw-1", entityType: "basketball_standing" }
    );

    expect(repositories.basketballStandings.upsertByCompetitionSeasonTeam).toHaveBeenCalledWith(
      expect.objectContaining({ competitionId: "competition-1", seasonId: undefined, teamId: "team-1", position: 3, winPercentage: 60, pointDifference: 25 })
    );
    expect(repositories.footballStandings.upsertByCompetitionSeasonTeam).not.toHaveBeenCalled();
    expect(repositories.providerMappings.findOrCreateProviderMapping).not.toHaveBeenCalled();
  });

  it("keeps basketball standings idempotent and resolves optional season", async () => {
    const repositories = createMockRepositories();
    repositories.providerMappings.findProviderMapping = vi.fn().mockResolvedValue({ internalEntityId: "entity-1" });
    repositories.basketballStandings.upsertByCompetitionSeasonTeam = vi.fn().mockResolvedValue({ id: "basketball-standing-1" });

    await new BasketballStandingNormalizer(repositories).normalize(
      [
        { competitionProviderId: "league", seasonProviderId: "season", teamProviderId: "team", position: 1, played: 1, wins: 1, losses: 0 },
        { competitionProviderId: "league", seasonProviderId: "season", teamProviderId: "team", position: 2, played: 2, wins: 1, losses: 1 }
      ],
      { provider: "mock", rawPayloadId: "raw-1", entityType: "basketball_standing" }
    );

    expect(repositories.basketballStandings.upsertByCompetitionSeasonTeam).toHaveBeenCalledTimes(2);
    expect(repositories.basketballStandings.upsertByCompetitionSeasonTeam).toHaveBeenLastCalledWith(expect.objectContaining({ seasonId: "entity-1", position: 2 }));
  });

  it("fails and validates basketball standings", async () => {
    const repositories = createMockRepositories();
    repositories.providerMappings.findProviderMapping = vi.fn().mockResolvedValue(undefined);
    const payload = { competitionProviderId: "league", teamProviderId: "team", position: 1, played: 1, wins: 1, losses: 0 };

    await expect(new BasketballStandingNormalizer(repositories).normalize(payload, { provider: "mock", rawPayloadId: "raw-1", entityType: "basketball_standing" })).rejects.toThrow(
      'Cannot normalize basketball standing "league:team" without competition mapping "league".'
    );

    await expect(new BasketballStandingNormalizer(createMockRepositories()).normalize({ ...payload, winPercentage: 120 }, { provider: "mock", rawPayloadId: "raw-1", entityType: "basketball_standing" })).rejects.toThrow(
      "Invalid percentage field basketball_standing.winPercentage."
    );

    await expect(new BasketballStandingNormalizer(createMockRepositories()).normalize({ ...payload, losses: -1 }, { provider: "mock", rawPayloadId: "raw-1", entityType: "basketball_standing" })).rejects.toThrow(
      "Invalid non-negative integer field basketball_standing.losses."
    );
  });

  it("fails clearly when required fields are missing", async () => {
    await expect(new SportNormalizer(createMockRepositories()).normalize({ providerEntityId: "football" }, { provider: "mock", rawPayloadId: "raw-1", entityType: "sport" })).rejects.toThrow(
      "Missing required field sport.name."
    );
  });

  it("normalizes slugs consistently", () => {
    expect(normalizeSlug(" Premier League! ")).toBe("premier-league");
  });
});

function createMockRepositories(): StaticNormalizerRepositories {
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
