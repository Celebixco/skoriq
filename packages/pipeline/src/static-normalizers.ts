import type {
  BasketballMatchScoreRepository,
  BasketballPeriodScoreRepository,
  BasketballStandingRepository,
  BasketballTeamMatchStatisticsRepository,
  CompetitionRepository,
  CountryRepository,
  FootballMatchScoreRepository,
  FootballStandingRepository,
  FootballMatchTeamStatisticsRepository,
  MatchRepository,
  PlayerRepository,
  ProviderMappingRepository,
  RepositoryExecutor,
  SeasonRepository,
  SportRepository,
  TeamRepository
} from "@sports-data/database";
import { BasketballMatchScoreRepository as DbBasketballMatchScoreRepository, BasketballPeriodScoreRepository as DbBasketballPeriodScoreRepository, BasketballStandingRepository as DbBasketballStandingRepository, BasketballTeamMatchStatisticsRepository as DbBasketballTeamMatchStatisticsRepository, CompetitionRepository as DbCompetitionRepository, CountryRepository as DbCountryRepository, FootballMatchScoreRepository as DbFootballMatchScoreRepository, FootballStandingRepository as DbFootballStandingRepository, FootballMatchTeamStatisticsRepository as DbFootballMatchTeamStatisticsRepository, MatchRepository as DbMatchRepository, PlayerRepository as DbPlayerRepository, ProviderMappingRepository as DbProviderMappingRepository, SeasonRepository as DbSeasonRepository, SportRepository as DbSportRepository, TeamRepository as DbTeamRepository } from "@sports-data/database";
import type { ProviderBasketballMatchScore, ProviderBasketballPeriodScore, ProviderBasketballStanding, ProviderBasketballTeamMatchStatistics, ProviderCompetition, ProviderCountry, ProviderFootballMatchScore, ProviderFootballMatchTeamStatistics, ProviderFootballStanding, ProviderMatch, ProviderPlayer, ProviderSeason, ProviderSport, ProviderTeam } from "@sports-data/providers";
import { basketballPeriodTypes, matchStatuses } from "@sports-data/shared";
import type { BasketballPeriodType, MatchStatus, ProviderEntityType } from "@sports-data/shared";
import type { NormalizationContext, NormalizationResult, PipelineNormalizer } from "./normalizers.js";

export interface StaticNormalizerRepositories {
  sports: Pick<SportRepository, "upsertSport" | "updateSport">;
  countries: Pick<CountryRepository, "upsertCountry" | "updateCountry">;
  competitions: Pick<CompetitionRepository, "findCompetitionById" | "upsertCompetition" | "updateCompetition">;
  seasons: Pick<SeasonRepository, "upsertSeason" | "updateSeason">;
  teams: Pick<TeamRepository, "upsertTeam" | "updateTeam">;
  players: Pick<PlayerRepository, "upsertPlayer" | "updatePlayer">;
  matches: Pick<MatchRepository, "findMatchById" | "upsertMatch" | "updateMatch">;
  footballMatchScores: Pick<FootballMatchScoreRepository, "upsertByMatchId">;
  basketballMatchScores: Pick<BasketballMatchScoreRepository, "upsertByMatchId">;
  basketballPeriodScores: Pick<BasketballPeriodScoreRepository, "upsertByMatchAndPeriod">;
  footballMatchTeamStatistics: Pick<FootballMatchTeamStatisticsRepository, "upsertByMatchAndTeam">;
  basketballTeamMatchStatistics: Pick<BasketballTeamMatchStatisticsRepository, "upsertByMatchAndTeam">;
  footballStandings: Pick<FootballStandingRepository, "upsertByCompetitionSeasonTeam">;
  basketballStandings: Pick<BasketballStandingRepository, "upsertByCompetitionSeasonTeam">;
  providerMappings: Pick<ProviderMappingRepository, "findProviderMapping" | "findOrCreateProviderMapping">;
  runInTransaction?<T>(work: (repositories: StaticNormalizerRepositories) => Promise<T>): Promise<T>;
}

export class SportNormalizer implements PipelineNormalizer {
  readonly entityType = "sport" as const;

  constructor(private readonly repositories: StaticNormalizerRepositories) {}

  async normalize(payload: unknown, context: NormalizationContext): Promise<NormalizationResult> {
    const dtos = asArray(payload).map(parseProviderSport);
    const internalEntityIds: string[] = [];
    let changed = false;

    for (const dto of dtos) {
      const sportId = await this.withRepositories(async (repositories) => {
        const slug = normalizeSlug(dto.slug ?? dto.name);
        const mapping = await repositories.providerMappings.findProviderMapping(context.provider, "sport", dto.providerEntityId);
        const sport = mapping ? await repositories.sports.updateSport(mapping.internalEntityId, { slug, name: dto.name }) : await repositories.sports.upsertSport({ slug, name: dto.name });

        if (!sport) {
          throw new Error(`Failed to normalize sport "${dto.providerEntityId}".`);
        }

        await repositories.providerMappings.findOrCreateProviderMapping({
          provider: context.provider,
          entityType: "sport",
          providerEntityId: dto.providerEntityId,
          internalEntityType: "sport",
          internalEntityId: sport.id,
          metadataJson: dto.metadata ?? {}
        });
        return sport.id;
      });
      internalEntityIds.push(sportId);
      changed = true;
    }

    return normalized("sport", internalEntityIds, changed);
  }

  private async withRepositories<T>(work: (repositories: StaticNormalizerRepositories) => Promise<T>): Promise<T> {
    return this.repositories.runInTransaction ? this.repositories.runInTransaction(work) : work(this.repositories);
  }
}

export class CountryNormalizer implements PipelineNormalizer {
  readonly entityType = "country" as const;

  constructor(private readonly repositories: StaticNormalizerRepositories) {}

  async normalize(payload: unknown, context: NormalizationContext): Promise<NormalizationResult> {
    const dtos = asArray(payload).map(parseProviderCountry);
    const internalEntityIds: string[] = [];
    let changed = false;

    for (const dto of dtos) {
      const countryId = await this.withRepositories(async (repositories) => {
        const code = dto.code?.trim().toUpperCase();
        const slug = normalizeSlug(dto.slug ?? code ?? dto.name);
        const mapping = await repositories.providerMappings.findProviderMapping(context.provider, "country", dto.providerEntityId);
        const country = mapping
          ? await repositories.countries.updateCountry(mapping.internalEntityId, { code, slug, name: dto.name })
          : await repositories.countries.upsertCountry({ code, slug, name: dto.name });

        if (!country) {
          throw new Error(`Failed to normalize country "${dto.providerEntityId}".`);
        }

        await repositories.providerMappings.findOrCreateProviderMapping({
          provider: context.provider,
          entityType: "country",
          providerEntityId: dto.providerEntityId,
          internalEntityType: "country",
          internalEntityId: country.id,
          metadataJson: dto.metadata ?? {}
        });
        return country.id;
      });
      internalEntityIds.push(countryId);
      changed = true;
    }

    return normalized("country", internalEntityIds, changed);
  }

  private async withRepositories<T>(work: (repositories: StaticNormalizerRepositories) => Promise<T>): Promise<T> {
    return this.repositories.runInTransaction ? this.repositories.runInTransaction(work) : work(this.repositories);
  }
}

export class CompetitionNormalizer implements PipelineNormalizer {
  readonly entityType = "competition" as const;

  constructor(private readonly repositories: StaticNormalizerRepositories) {}

  async normalize(payload: unknown, context: NormalizationContext): Promise<NormalizationResult> {
    const dtos = asArray(payload).map(parseProviderCompetition);
    const internalEntityIds: string[] = [];
    let changed = false;

    for (const dto of dtos) {
      const competitionId = await this.withRepositories(async (repositories) => {
        const sportMapping = await repositories.providerMappings.findProviderMapping(context.provider, "sport", dto.sportProviderId);
        if (!sportMapping) {
          throw new Error(`Cannot normalize competition "${dto.providerEntityId}" without sport mapping "${dto.sportProviderId}".`);
        }

        const countryMapping = dto.countryProviderId ? await repositories.providerMappings.findProviderMapping(context.provider, "country", dto.countryProviderId) : undefined;
        if (dto.countryProviderId && !countryMapping) {
          throw new Error(`Cannot normalize competition "${dto.providerEntityId}" without country mapping "${dto.countryProviderId}".`);
        }

        const slug = normalizeSlug(dto.slug ?? dto.name);
        const input = {
          sportId: sportMapping.internalEntityId,
          countryId: countryMapping?.internalEntityId,
          name: dto.name,
          slug,
          gender: dto.gender,
          level: dto.level,
          metadataJson: dto.metadata ?? {}
        };
        const mapping = await repositories.providerMappings.findProviderMapping(context.provider, "competition", dto.providerEntityId);
        const competition = mapping ? await repositories.competitions.updateCompetition(mapping.internalEntityId, input) : await repositories.competitions.upsertCompetition(input);

        if (!competition) {
          throw new Error(`Failed to normalize competition "${dto.providerEntityId}".`);
        }

        await repositories.providerMappings.findOrCreateProviderMapping({
          provider: context.provider,
          entityType: "competition",
          providerEntityId: dto.providerEntityId,
          internalEntityType: "competition",
          internalEntityId: competition.id,
          metadataJson: dto.metadata ?? {}
        });
        return competition.id;
      });
      internalEntityIds.push(competitionId);
      changed = true;
    }

    return normalized("competition", internalEntityIds, changed);
  }

  private async withRepositories<T>(work: (repositories: StaticNormalizerRepositories) => Promise<T>): Promise<T> {
    return this.repositories.runInTransaction ? this.repositories.runInTransaction(work) : work(this.repositories);
  }
}

export class SeasonNormalizer implements PipelineNormalizer {
  readonly entityType = "season" as const;

  constructor(private readonly repositories: StaticNormalizerRepositories) {}

  async normalize(payload: unknown, context: NormalizationContext): Promise<NormalizationResult> {
    const dtos = asArray(payload).map(parseProviderSeason);
    const internalEntityIds: string[] = [];
    let changed = false;

    for (const dto of dtos) {
      const seasonId = await this.withRepositories(async (repositories) => {
        const competitionMapping = await repositories.providerMappings.findProviderMapping(context.provider, "competition", dto.competitionProviderId);
        if (!competitionMapping) {
          throw new Error(`Cannot normalize season "${dto.providerEntityId}" without competition mapping "${dto.competitionProviderId}".`);
        }

        const input = {
          competitionId: competitionMapping.internalEntityId,
          name: dto.name,
          startDate: dto.startDate,
          endDate: dto.endDate,
          isCurrent: dto.isCurrent ?? false
        };
        const mapping = await repositories.providerMappings.findProviderMapping(context.provider, "season", dto.providerEntityId);
        const season = mapping ? await repositories.seasons.updateSeason(mapping.internalEntityId, input) : await repositories.seasons.upsertSeason(input);

        if (!season) {
          throw new Error(`Failed to normalize season "${dto.providerEntityId}".`);
        }

        await repositories.providerMappings.findOrCreateProviderMapping({
          provider: context.provider,
          entityType: "season",
          providerEntityId: dto.providerEntityId,
          internalEntityType: "season",
          internalEntityId: season.id,
          metadataJson: dto.metadata ?? {}
        });
        return season.id;
      });
      internalEntityIds.push(seasonId);
      changed = true;
    }

    return normalized("season", internalEntityIds, changed);
  }

  private async withRepositories<T>(work: (repositories: StaticNormalizerRepositories) => Promise<T>): Promise<T> {
    return this.repositories.runInTransaction ? this.repositories.runInTransaction(work) : work(this.repositories);
  }
}

export class TeamNormalizer implements PipelineNormalizer {
  readonly entityType = "team" as const;

  constructor(private readonly repositories: StaticNormalizerRepositories) {}

  async normalize(payload: unknown, context: NormalizationContext): Promise<NormalizationResult> {
    const dtos = asArray(payload).map(parseProviderTeam);
    const internalEntityIds: string[] = [];
    let changed = false;

    for (const dto of dtos) {
      const teamId = await this.withRepositories(async (repositories) => {
        const sportMapping = await repositories.providerMappings.findProviderMapping(context.provider, "sport", dto.sportProviderId);
        if (!sportMapping) {
          throw new Error(`Cannot normalize team "${dto.providerEntityId}" without sport mapping "${dto.sportProviderId}".`);
        }

        const countryMapping = dto.countryProviderId ? await repositories.providerMappings.findProviderMapping(context.provider, "country", dto.countryProviderId) : undefined;
        const slug = normalizeSlug(dto.slug ?? dto.name);
        const input = {
          sportId: sportMapping.internalEntityId,
          countryId: countryMapping?.internalEntityId,
          name: dto.name,
          shortName: dto.shortName,
          slug,
          gender: dto.gender,
          type: dto.type,
          logoUrl: dto.logoUrl,
          venueName: dto.venueName,
          foundedYear: dto.foundedYear,
          metadataJson: dto.metadata ?? {}
        };
        const mapping = await repositories.providerMappings.findProviderMapping(context.provider, "team", dto.providerEntityId);
        const team = mapping ? await repositories.teams.updateTeam(mapping.internalEntityId, input) : await repositories.teams.upsertTeam(input);

        if (!team) {
          throw new Error(`Failed to normalize team "${dto.providerEntityId}".`);
        }

        await repositories.providerMappings.findOrCreateProviderMapping({
          provider: context.provider,
          entityType: "team",
          providerEntityId: dto.providerEntityId,
          internalEntityType: "team",
          internalEntityId: team.id,
          metadataJson: dto.metadata ?? {}
        });
        return team.id;
      });
      internalEntityIds.push(teamId);
      changed = true;
    }

    return normalized("team", internalEntityIds, changed);
  }

  private async withRepositories<T>(work: (repositories: StaticNormalizerRepositories) => Promise<T>): Promise<T> {
    return this.repositories.runInTransaction ? this.repositories.runInTransaction(work) : work(this.repositories);
  }
}

export class PlayerNormalizer implements PipelineNormalizer {
  readonly entityType = "player" as const;

  constructor(private readonly repositories: StaticNormalizerRepositories) {}

  async normalize(payload: unknown, context: NormalizationContext): Promise<NormalizationResult> {
    const dtos = asArray(payload).map(parseProviderPlayer);
    const internalEntityIds: string[] = [];
    let changed = false;

    for (const dto of dtos) {
      const playerId = await this.withRepositories(async (repositories) => {
        const sportMapping = await repositories.providerMappings.findProviderMapping(context.provider, "sport", dto.sportProviderId);
        if (!sportMapping) {
          throw new Error(`Cannot normalize player "${dto.providerEntityId}" without sport mapping "${dto.sportProviderId}".`);
        }

        const currentTeamMapping = dto.currentTeamProviderId ? await repositories.providerMappings.findProviderMapping(context.provider, "team", dto.currentTeamProviderId) : undefined;
        const nationalityProviderId = dto.nationalityProviderId ?? dto.countryProviderId;
        const nationalityMapping = nationalityProviderId ? await repositories.providerMappings.findProviderMapping(context.provider, "country", nationalityProviderId) : undefined;
        const slug = dto.slug ? normalizeSlug(dto.slug) : normalizeSlug(dto.name);
        const input = {
          sportId: sportMapping.internalEntityId,
          nationalityCountryId: nationalityMapping?.internalEntityId,
          currentTeamId: currentTeamMapping?.internalEntityId,
          name: dto.name,
          shortName: dto.shortName,
          slug,
          dateOfBirth: dto.dateOfBirth,
          age: dto.age,
          heightCm: dto.heightCm,
          weightKg: dto.weightKg,
          preferredFoot: dto.preferredFoot,
          position: dto.position,
          jerseyNumber: dto.jerseyNumber,
          marketValue: dto.marketValue,
          contractUntil: dto.contractUntil,
          photoUrl: dto.photoUrl,
          metadataJson: dto.metadata ?? {}
        };
        const mapping = await repositories.providerMappings.findProviderMapping(context.provider, "player", dto.providerEntityId);
        const player = mapping ? await repositories.players.updatePlayer(mapping.internalEntityId, input) : await repositories.players.upsertPlayer(input);

        if (!player) {
          throw new Error(`Failed to normalize player "${dto.providerEntityId}".`);
        }

        await repositories.providerMappings.findOrCreateProviderMapping({
          provider: context.provider,
          entityType: "player",
          providerEntityId: dto.providerEntityId,
          internalEntityType: "player",
          internalEntityId: player.id,
          metadataJson: dto.metadata ?? {}
        });
        return player.id;
      });
      internalEntityIds.push(playerId);
      changed = true;
    }

    return normalized("player", internalEntityIds, changed);
  }

  private async withRepositories<T>(work: (repositories: StaticNormalizerRepositories) => Promise<T>): Promise<T> {
    return this.repositories.runInTransaction ? this.repositories.runInTransaction(work) : work(this.repositories);
  }
}

export class MatchNormalizer implements PipelineNormalizer {
  readonly entityType = "match" as const;

  constructor(private readonly repositories: StaticNormalizerRepositories) {}

  async normalize(payload: unknown, context: NormalizationContext): Promise<NormalizationResult> {
    const dtos = asArray(payload).map(parseProviderMatch);
    const internalEntityIds: string[] = [];
    let changed = false;

    for (const dto of dtos) {
      const matchId = await this.withRepositories(async (repositories) => {
        const competitionMapping = await repositories.providerMappings.findProviderMapping(context.provider, "competition", dto.competitionProviderId);
        if (!competitionMapping) {
          throw new Error(`Cannot normalize match "${dto.providerEntityId}" without competition mapping "${dto.competitionProviderId}".`);
        }

        const sportId = await resolveMatchSportId(repositories, context.provider, dto, competitionMapping.internalEntityId);
        const seasonMapping = dto.seasonProviderId ? await repositories.providerMappings.findProviderMapping(context.provider, "season", dto.seasonProviderId) : undefined;
        const homeTeamMapping = await repositories.providerMappings.findProviderMapping(context.provider, "team", dto.homeTeamProviderId);
        if (!homeTeamMapping) {
          throw new Error(`Cannot normalize match "${dto.providerEntityId}" without home team mapping "${dto.homeTeamProviderId}".`);
        }

        const awayTeamMapping = await repositories.providerMappings.findProviderMapping(context.provider, "team", dto.awayTeamProviderId);
        if (!awayTeamMapping) {
          throw new Error(`Cannot normalize match "${dto.providerEntityId}" without away team mapping "${dto.awayTeamProviderId}".`);
        }

        const winnerTeamMapping = dto.winnerProviderTeamId ? await repositories.providerMappings.findProviderMapping(context.provider, "team", dto.winnerProviderTeamId) : undefined;
        const input = {
          sportId,
          competitionId: competitionMapping.internalEntityId,
          seasonId: seasonMapping?.internalEntityId,
          homeTeamId: homeTeamMapping.internalEntityId,
          awayTeamId: awayTeamMapping.internalEntityId,
          scheduledStartAt: parseDateTime(dto.scheduledStartAt, "match.scheduledStartAt"),
          status: dto.status,
          round: dto.roundName ?? dto.round,
          venue: dto.venueName ?? dto.venue,
          referee: dto.refereeName ?? dto.referee,
          stageName: dto.stageName,
          neutralGround: dto.neutralGround,
          attendance: dto.attendance,
          winnerTeamId: winnerTeamMapping?.internalEntityId,
          metadataJson: buildMatchMetadata(dto)
        };
        const mapping = await repositories.providerMappings.findProviderMapping(context.provider, "match", dto.providerEntityId);
        const match = mapping ? await repositories.matches.updateMatch(mapping.internalEntityId, input) : await repositories.matches.upsertMatch(input);

        if (!match) {
          throw new Error(`Failed to normalize match "${dto.providerEntityId}".`);
        }

        await repositories.providerMappings.findOrCreateProviderMapping({
          provider: context.provider,
          entityType: "match",
          providerEntityId: dto.providerEntityId,
          internalEntityType: "match",
          internalEntityId: match.id,
          metadataJson: dto.metadata ?? {}
        });
        return match.id;
      });
      internalEntityIds.push(matchId);
      changed = true;
    }

    return normalized("match", internalEntityIds, changed);
  }

  private async withRepositories<T>(work: (repositories: StaticNormalizerRepositories) => Promise<T>): Promise<T> {
    return this.repositories.runInTransaction ? this.repositories.runInTransaction(work) : work(this.repositories);
  }
}

export class FootballMatchScoreNormalizer implements PipelineNormalizer {
  readonly entityType = "football_match_score" as const;

  constructor(private readonly repositories: StaticNormalizerRepositories) {}

  async normalize(payload: unknown, context: NormalizationContext): Promise<NormalizationResult> {
    const dtos = asArray(payload).map(parseProviderFootballMatchScore);
    const internalEntityIds: string[] = [];
    let changed = false;

    for (const dto of dtos) {
      const scoreId = await this.withRepositories(async (repositories) => {
        const match = await resolveScoreMatch(repositories, context.provider, dto.providerEntityId, dto.matchProviderId, "football match score");
        const winnerTeamMapping = dto.winnerProviderTeamId ? await repositories.providerMappings.findProviderMapping(context.provider, "team", dto.winnerProviderTeamId) : undefined;
        const score = await repositories.footballMatchScores.upsertByMatchId({
          matchId: match.id,
          homeTeamId: match.homeTeamId,
          awayTeamId: match.awayTeamId,
          winnerTeamId: winnerTeamMapping?.internalEntityId,
          homeScoreCurrent: dto.homeScoreCurrent,
          awayScoreCurrent: dto.awayScoreCurrent,
          homeScoreHalftime: dto.homeScoreHalfTime,
          awayScoreHalftime: dto.awayScoreHalfTime,
          homeScoreFulltime: dto.homeScoreFullTime,
          awayScoreFulltime: dto.awayScoreFullTime,
          homeScoreExtraTime: dto.homeScoreExtraTime,
          awayScoreExtraTime: dto.awayScoreExtraTime,
          homeScorePenalties: dto.homeScorePenalties,
          awayScorePenalties: dto.awayScorePenalties,
          status: dto.status,
          metadataJson: dto.metadata ?? {}
        });

        if (!score) {
          throw new Error(`Failed to normalize football match score "${dto.providerEntityId}".`);
        }

        return score.id;
      });
      internalEntityIds.push(scoreId);
      changed = true;
    }

    return normalized("football_match_score", internalEntityIds, changed);
  }

  private async withRepositories<T>(work: (repositories: StaticNormalizerRepositories) => Promise<T>): Promise<T> {
    return this.repositories.runInTransaction ? this.repositories.runInTransaction(work) : work(this.repositories);
  }
}

export class BasketballMatchScoreNormalizer implements PipelineNormalizer {
  readonly entityType = "basketball_match_score" as const;

  constructor(private readonly repositories: StaticNormalizerRepositories) {}

  async normalize(payload: unknown, context: NormalizationContext): Promise<NormalizationResult> {
    const dtos = asArray(payload).map(parseProviderBasketballMatchScore);
    const internalEntityIds: string[] = [];
    let changed = false;

    for (const dto of dtos) {
      const scoreId = await this.withRepositories(async (repositories) => {
        const match = await resolveScoreMatch(repositories, context.provider, dto.providerEntityId, dto.matchProviderId, "basketball match score");
        const winnerTeamMapping = dto.winnerProviderTeamId ? await repositories.providerMappings.findProviderMapping(context.provider, "team", dto.winnerProviderTeamId) : undefined;
        const score = await repositories.basketballMatchScores.upsertByMatchId({
          matchId: match.id,
          homeTeamId: match.homeTeamId,
          awayTeamId: match.awayTeamId,
          winnerTeamId: winnerTeamMapping?.internalEntityId,
          homeScoreCurrent: dto.homeScoreCurrent,
          awayScoreCurrent: dto.awayScoreCurrent,
          homeScoreFinal: dto.homeScoreFinal,
          awayScoreFinal: dto.awayScoreFinal,
          homeScoreHalftime: dto.homeScoreHalfTime,
          awayScoreHalftime: dto.awayScoreHalfTime,
          homeScoreOvertime: dto.homeScoreOvertime,
          awayScoreOvertime: dto.awayScoreOvertime,
          status: dto.status,
          metadataJson: dto.metadata ?? {}
        });

        if (!score) {
          throw new Error(`Failed to normalize basketball match score "${dto.providerEntityId}".`);
        }

        return score.id;
      });
      internalEntityIds.push(scoreId);
      changed = true;
    }

    return normalized("basketball_match_score", internalEntityIds, changed);
  }

  private async withRepositories<T>(work: (repositories: StaticNormalizerRepositories) => Promise<T>): Promise<T> {
    return this.repositories.runInTransaction ? this.repositories.runInTransaction(work) : work(this.repositories);
  }
}

export class BasketballPeriodScoreNormalizer implements PipelineNormalizer {
  readonly entityType = "basketball_period_score" as const;

  constructor(private readonly repositories: StaticNormalizerRepositories) {}

  async normalize(payload: unknown, context: NormalizationContext): Promise<NormalizationResult> {
    const dtos = asArray(payload).map(parseProviderBasketballPeriodScore);
    const internalEntityIds: string[] = [];
    let changed = false;

    for (const dto of dtos) {
      const scoreId = await this.withRepositories(async (repositories) => {
        const match = await resolveScoreMatch(repositories, context.provider, dto.providerEntityId, dto.matchProviderId, "basketball period score");
        const score = await repositories.basketballPeriodScores.upsertByMatchAndPeriod({
          matchId: match.id,
          periodNumber: dto.periodNumber,
          periodType: dto.periodType,
          overtimeNumber: dto.overtimeNumber,
          homeScore: dto.homeScore,
          awayScore: dto.awayScore,
          metadataJson: dto.metadata ?? {}
        });

        if (!score) {
          throw new Error(`Failed to normalize basketball period score "${dto.providerEntityId}".`);
        }

        return score.id;
      });
      internalEntityIds.push(scoreId);
      changed = true;
    }

    return normalized("basketball_period_score", internalEntityIds, changed);
  }

  private async withRepositories<T>(work: (repositories: StaticNormalizerRepositories) => Promise<T>): Promise<T> {
    return this.repositories.runInTransaction ? this.repositories.runInTransaction(work) : work(this.repositories);
  }
}

export class FootballMatchTeamStatisticsNormalizer implements PipelineNormalizer {
  readonly entityType = "football_match_team_statistics" as const;

  constructor(private readonly repositories: StaticNormalizerRepositories) {}

  async normalize(payload: unknown, context: NormalizationContext): Promise<NormalizationResult> {
    const dtos = asArray(payload).map(parseProviderFootballMatchTeamStatistics);
    const internalEntityIds: string[] = [];
    let changed = false;

    for (const dto of dtos) {
      const statisticsId = await this.withRepositories(async (repositories) => {
        const { match, teamId, opponentTeamId, isHome } = await resolveTeamStatisticsDependencies(
          repositories,
          context.provider,
          dto.providerEntityId,
          dto.matchProviderId,
          dto.teamProviderId,
          "football match team statistics"
        );
        const statistics = await repositories.footballMatchTeamStatistics.upsertByMatchAndTeam({
          matchId: match.id,
          teamId,
          opponentTeamId,
          isHome,
          possessionPercent: dto.possessionPercent,
          shotsTotal: dto.shotsTotal,
          shotsOnTarget: dto.shotsOnTarget,
          shotsOffTarget: dto.shotsOffTarget,
          blockedShots: dto.blockedShots,
          corners: dto.corners,
          fouls: dto.fouls,
          yellowCards: dto.yellowCards,
          redCards: dto.redCards,
          offsides: dto.offsides,
          goalkeeperSaves: dto.goalkeeperSaves,
          passes: dto.passes,
          accuratePasses: dto.accuratePasses,
          passAccuracyPercent: dto.passAccuracyPercent,
          bigChances: dto.bigChances,
          bigChancesMissed: dto.bigChancesMissed,
          expectedGoals: dto.expectedGoals,
          expectedAssists: dto.expectedAssists,
          attacks: dto.attacks,
          dangerousAttacks: dto.dangerousAttacks,
          hitWoodwork: dto.hitWoodwork,
          tackles: dto.tackles,
          interceptions: dto.interceptions,
          clearances: dto.clearances,
          duelsWon: dto.duelsWon,
          aerialDuelsWon: dto.aerialDuelsWon,
          metadataJson: dto.metadata ?? {}
        });

        if (!statistics) {
          throw new Error(`Failed to normalize football match team statistics "${statisticsIdentity(dto.providerEntityId, dto.matchProviderId, dto.teamProviderId)}".`);
        }

        return statistics.id;
      });
      internalEntityIds.push(statisticsId);
      changed = true;
    }

    return normalized("football_match_team_statistics", internalEntityIds, changed);
  }

  private async withRepositories<T>(work: (repositories: StaticNormalizerRepositories) => Promise<T>): Promise<T> {
    return this.repositories.runInTransaction ? this.repositories.runInTransaction(work) : work(this.repositories);
  }
}

export class BasketballTeamMatchStatisticsNormalizer implements PipelineNormalizer {
  readonly entityType = "basketball_team_match_statistics" as const;

  constructor(private readonly repositories: StaticNormalizerRepositories) {}

  async normalize(payload: unknown, context: NormalizationContext): Promise<NormalizationResult> {
    const dtos = asArray(payload).map(parseProviderBasketballTeamMatchStatistics);
    const internalEntityIds: string[] = [];
    let changed = false;

    for (const dto of dtos) {
      const statisticsId = await this.withRepositories(async (repositories) => {
        const { match, teamId, opponentTeamId, isHome } = await resolveTeamStatisticsDependencies(
          repositories,
          context.provider,
          dto.providerEntityId,
          dto.matchProviderId,
          dto.teamProviderId,
          "basketball team match statistics"
        );
        const statistics = await repositories.basketballTeamMatchStatistics.upsertByMatchAndTeam({
          matchId: match.id,
          teamId,
          opponentTeamId,
          isHome,
          fieldGoalsMade: dto.fieldGoalsMade,
          fieldGoalsAttempted: dto.fieldGoalsAttempted,
          fieldGoalPercent: dto.fieldGoalPercent,
          twoPointersMade: dto.twoPointersMade,
          twoPointersAttempted: dto.twoPointersAttempted,
          twoPointPercent: dto.twoPointPercent,
          threePointersMade: dto.threePointersMade,
          threePointersAttempted: dto.threePointersAttempted,
          threePointPercent: dto.threePointPercent,
          freeThrowsMade: dto.freeThrowsMade,
          freeThrowsAttempted: dto.freeThrowsAttempted,
          freeThrowPercent: dto.freeThrowPercent,
          reboundsTotal: dto.reboundsTotal,
          reboundsOffensive: dto.reboundsOffensive,
          reboundsDefensive: dto.reboundsDefensive,
          assists: dto.assists,
          steals: dto.steals,
          blocks: dto.blocks,
          turnovers: dto.turnovers,
          personalFouls: dto.personalFouls,
          fastBreakPoints: dto.fastBreakPoints,
          pointsInPaint: dto.pointsInPaint,
          secondChancePoints: dto.secondChancePoints,
          benchPoints: dto.benchPoints,
          biggestLead: dto.biggestLead,
          leadChanges: dto.leadChanges,
          timeInLeadSeconds: dto.timeInLeadSeconds,
          metadataJson: dto.metadata ?? {}
        });

        if (!statistics) {
          throw new Error(`Failed to normalize basketball team match statistics "${statisticsIdentity(dto.providerEntityId, dto.matchProviderId, dto.teamProviderId)}".`);
        }

        return statistics.id;
      });
      internalEntityIds.push(statisticsId);
      changed = true;
    }

    return normalized("basketball_team_match_statistics", internalEntityIds, changed);
  }

  private async withRepositories<T>(work: (repositories: StaticNormalizerRepositories) => Promise<T>): Promise<T> {
    return this.repositories.runInTransaction ? this.repositories.runInTransaction(work) : work(this.repositories);
  }
}

export class FootballStandingNormalizer implements PipelineNormalizer {
  readonly entityType = "football_standing" as const;

  constructor(private readonly repositories: StaticNormalizerRepositories) {}

  async normalize(payload: unknown, context: NormalizationContext): Promise<NormalizationResult> {
    const dtos = asArray(payload).map(parseProviderFootballStanding);
    const internalEntityIds: string[] = [];
    let changed = false;

    for (const dto of dtos) {
      const standingId = await this.withRepositories(async (repositories) => {
        const { competitionId, seasonId, teamId } = await resolveStandingDependencies(repositories, context.provider, dto.providerEntityId, dto.competitionProviderId, dto.seasonProviderId, dto.teamProviderId, "football standing");
        const standing = await repositories.footballStandings.upsertByCompetitionSeasonTeam({
          competitionId,
          seasonId,
          teamId,
          position: dto.position,
          played: dto.played,
          wins: dto.wins,
          draws: dto.draws,
          losses: dto.losses,
          goalsFor: dto.goalsFor,
          goalsAgainst: dto.goalsAgainst,
          goalDifference: dto.goalDifference,
          points: dto.points,
          homePlayed: dto.homePlayed,
          homeWins: dto.homeWins,
          homeDraws: dto.homeDraws,
          homeLosses: dto.homeLosses,
          homeGoalsFor: dto.homeGoalsFor,
          homeGoalsAgainst: dto.homeGoalsAgainst,
          awayPlayed: dto.awayPlayed,
          awayWins: dto.awayWins,
          awayDraws: dto.awayDraws,
          awayLosses: dto.awayLosses,
          awayGoalsFor: dto.awayGoalsFor,
          awayGoalsAgainst: dto.awayGoalsAgainst,
          formString: dto.formString,
          status: dto.status,
          metadataJson: dto.metadata ?? {}
        });

        if (!standing) {
          throw new Error(`Failed to normalize football standing "${standingIdentity(dto.providerEntityId, dto.competitionProviderId, dto.teamProviderId)}".`);
        }

        return standing.id;
      });
      internalEntityIds.push(standingId);
      changed = true;
    }

    return normalized("football_standing", internalEntityIds, changed);
  }

  private async withRepositories<T>(work: (repositories: StaticNormalizerRepositories) => Promise<T>): Promise<T> {
    return this.repositories.runInTransaction ? this.repositories.runInTransaction(work) : work(this.repositories);
  }
}

export class BasketballStandingNormalizer implements PipelineNormalizer {
  readonly entityType = "basketball_standing" as const;

  constructor(private readonly repositories: StaticNormalizerRepositories) {}

  async normalize(payload: unknown, context: NormalizationContext): Promise<NormalizationResult> {
    const dtos = asArray(payload).map(parseProviderBasketballStanding);
    const internalEntityIds: string[] = [];
    let changed = false;

    for (const dto of dtos) {
      const standingId = await this.withRepositories(async (repositories) => {
        const { competitionId, seasonId, teamId } = await resolveStandingDependencies(repositories, context.provider, dto.providerEntityId, dto.competitionProviderId, dto.seasonProviderId, dto.teamProviderId, "basketball standing");
        const standing = await repositories.basketballStandings.upsertByCompetitionSeasonTeam({
          competitionId,
          seasonId,
          teamId,
          position: dto.position,
          played: dto.played,
          wins: dto.wins,
          losses: dto.losses,
          winPercentage: dto.winPercentage,
          pointsFor: dto.pointsFor,
          pointsAgainst: dto.pointsAgainst,
          pointDifference: dto.pointDifference,
          homeWins: dto.homeWins,
          homeLosses: dto.homeLosses,
          awayWins: dto.awayWins,
          awayLosses: dto.awayLosses,
          streak: dto.streak,
          formString: dto.formString,
          conference: dto.conference,
          division: dto.division,
          status: dto.status,
          metadataJson: dto.metadata ?? {}
        });

        if (!standing) {
          throw new Error(`Failed to normalize basketball standing "${standingIdentity(dto.providerEntityId, dto.competitionProviderId, dto.teamProviderId)}".`);
        }

        return standing.id;
      });
      internalEntityIds.push(standingId);
      changed = true;
    }

    return normalized("basketball_standing", internalEntityIds, changed);
  }

  private async withRepositories<T>(work: (repositories: StaticNormalizerRepositories) => Promise<T>): Promise<T> {
    return this.repositories.runInTransaction ? this.repositories.runInTransaction(work) : work(this.repositories);
  }
}

export function createStaticEntityNormalizers(repositories: StaticNormalizerRepositories): PipelineNormalizer[] {
  return [
    new SportNormalizer(repositories),
    new CountryNormalizer(repositories),
    new CompetitionNormalizer(repositories),
    new SeasonNormalizer(repositories),
    new TeamNormalizer(repositories),
    new PlayerNormalizer(repositories),
    new MatchNormalizer(repositories),
    new FootballMatchScoreNormalizer(repositories),
    new BasketballMatchScoreNormalizer(repositories),
    new BasketballPeriodScoreNormalizer(repositories),
    new FootballMatchTeamStatisticsNormalizer(repositories),
    new BasketballTeamMatchStatisticsNormalizer(repositories),
    new FootballStandingNormalizer(repositories),
    new BasketballStandingNormalizer(repositories)
  ];
}

export function createStaticNormalizerRepositories(db: RepositoryExecutor, runInTransaction?: StaticNormalizerRepositories["runInTransaction"]): StaticNormalizerRepositories {
  return {
    sports: new DbSportRepository(db),
    countries: new DbCountryRepository(db),
    competitions: new DbCompetitionRepository(db),
    seasons: new DbSeasonRepository(db),
    teams: new DbTeamRepository(db),
    players: new DbPlayerRepository(db),
    matches: new DbMatchRepository(db),
    footballMatchScores: new DbFootballMatchScoreRepository(db),
    basketballMatchScores: new DbBasketballMatchScoreRepository(db),
    basketballPeriodScores: new DbBasketballPeriodScoreRepository(db),
    footballMatchTeamStatistics: new DbFootballMatchTeamStatisticsRepository(db),
    basketballTeamMatchStatistics: new DbBasketballTeamMatchStatisticsRepository(db),
    footballStandings: new DbFootballStandingRepository(db),
    basketballStandings: new DbBasketballStandingRepository(db),
    providerMappings: new DbProviderMappingRepository(db),
    runInTransaction
  };
}

export function normalizeSlug(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!normalized) {
    throw new Error("Cannot create slug from an empty value.");
  }

  return normalized;
}

function asArray(payload: unknown): unknown[] {
  return Array.isArray(payload) ? payload : [payload];
}

function normalized(entityType: ProviderEntityType, internalEntityIds: string[], changed: boolean): NormalizationResult {
  return {
    status: "normalized",
    entityType,
    changed,
    internalEntityIds,
    message: "Canonical entity normalized."
  };
}

function parseProviderSport(value: unknown): ProviderSport {
  const dto = asRecord(value, "sport");
  requireString(dto.providerEntityId, "sport.providerEntityId");
  requireString(dto.name, "sport.name");
  return dto as unknown as ProviderSport;
}

function parseProviderCountry(value: unknown): ProviderCountry {
  const dto = asRecord(value, "country");
  requireString(dto.providerEntityId, "country.providerEntityId");
  requireString(dto.name, "country.name");
  return dto as unknown as ProviderCountry;
}

function parseProviderCompetition(value: unknown): ProviderCompetition {
  const dto = asRecord(value, "competition");
  requireString(dto.providerEntityId, "competition.providerEntityId");
  requireString(dto.sportProviderId, "competition.sportProviderId");
  requireString(dto.name, "competition.name");
  return dto as unknown as ProviderCompetition;
}

function parseProviderSeason(value: unknown): ProviderSeason {
  const dto = asRecord(value, "season");
  requireString(dto.providerEntityId, "season.providerEntityId");
  requireString(dto.competitionProviderId, "season.competitionProviderId");
  requireString(dto.name, "season.name");
  return dto as unknown as ProviderSeason;
}

function parseProviderTeam(value: unknown): ProviderTeam {
  const dto = asRecord(value, "team");
  requireString(dto.providerEntityId, "team.providerEntityId");
  requireString(dto.sportProviderId, "team.sportProviderId");
  requireString(dto.name, "team.name");
  return dto as unknown as ProviderTeam;
}

function parseProviderPlayer(value: unknown): ProviderPlayer {
  const dto = asRecord(value, "player");
  requireString(dto.providerEntityId, "player.providerEntityId");
  requireString(dto.sportProviderId, "player.sportProviderId");
  requireString(dto.name, "player.name");
  return dto as unknown as ProviderPlayer;
}

function parseProviderMatch(value: unknown): ProviderMatch {
  const dto = asRecord(value, "match");
  requireString(dto.providerEntityId, "match.providerEntityId");
  requireString(dto.competitionProviderId, "match.competitionProviderId");
  requireString(dto.homeTeamProviderId, "match.homeTeamProviderId");
  requireString(dto.awayTeamProviderId, "match.awayTeamProviderId");
  requireString(dto.scheduledStartAt, "match.scheduledStartAt");
  requireMatchStatus(dto.status);
  return dto as unknown as ProviderMatch;
}

function parseProviderFootballMatchScore(value: unknown): ProviderFootballMatchScore {
  const dto = asRecord(value, "football_match_score");
  requireString(dto.providerEntityId, "football_match_score.providerEntityId");
  requireString(dto.matchProviderId, "football_match_score.matchProviderId");
  requireOptionalMatchStatus(dto.status);
  return dto as unknown as ProviderFootballMatchScore;
}

function parseProviderBasketballMatchScore(value: unknown): ProviderBasketballMatchScore {
  const dto = asRecord(value, "basketball_match_score");
  requireString(dto.providerEntityId, "basketball_match_score.providerEntityId");
  requireString(dto.matchProviderId, "basketball_match_score.matchProviderId");
  requireOptionalMatchStatus(dto.status);
  return dto as unknown as ProviderBasketballMatchScore;
}

function parseProviderBasketballPeriodScore(value: unknown): ProviderBasketballPeriodScore {
  const dto = asRecord(value, "basketball_period_score");
  requireString(dto.providerEntityId, "basketball_period_score.providerEntityId");
  requireString(dto.matchProviderId, "basketball_period_score.matchProviderId");
  requireNumber(dto.periodNumber, "basketball_period_score.periodNumber");
  requireBasketballPeriodType(dto.periodType, "basketball_period_score.periodType");
  requireOptionalNumber(dto.overtimeNumber, "basketball_period_score.overtimeNumber");
  requireNumber(dto.homeScore, "basketball_period_score.homeScore");
  requireNumber(dto.awayScore, "basketball_period_score.awayScore");
  return dto as unknown as ProviderBasketballPeriodScore;
}

function parseProviderFootballMatchTeamStatistics(value: unknown): ProviderFootballMatchTeamStatistics {
  const dto = asRecord(value, "football_match_team_statistics");
  requireString(dto.matchProviderId, "football_match_team_statistics.matchProviderId");
  requireString(dto.teamProviderId, "football_match_team_statistics.teamProviderId");
  validateOptionalPercent(dto.possessionPercent, "football_match_team_statistics.possessionPercent");
  validateOptionalPercent(dto.passAccuracyPercent, "football_match_team_statistics.passAccuracyPercent");
  validateOptionalNonNegativeNumber(dto.expectedGoals, "football_match_team_statistics.expectedGoals");
  validateOptionalNonNegativeNumber(dto.expectedAssists, "football_match_team_statistics.expectedAssists");
  for (const field of footballCountFields) {
    validateOptionalNonNegativeInteger(dto[field], `football_match_team_statistics.${field}`);
  }
  return dto as unknown as ProviderFootballMatchTeamStatistics;
}

function parseProviderBasketballTeamMatchStatistics(value: unknown): ProviderBasketballTeamMatchStatistics {
  const dto = asRecord(value, "basketball_team_match_statistics");
  requireString(dto.matchProviderId, "basketball_team_match_statistics.matchProviderId");
  requireString(dto.teamProviderId, "basketball_team_match_statistics.teamProviderId");
  validateOptionalPercent(dto.fieldGoalPercent, "basketball_team_match_statistics.fieldGoalPercent");
  validateOptionalPercent(dto.twoPointPercent, "basketball_team_match_statistics.twoPointPercent");
  validateOptionalPercent(dto.threePointPercent, "basketball_team_match_statistics.threePointPercent");
  validateOptionalPercent(dto.freeThrowPercent, "basketball_team_match_statistics.freeThrowPercent");
  validateOptionalNonNegativeInteger(dto.timeInLeadSeconds, "basketball_team_match_statistics.timeInLeadSeconds");
  for (const field of basketballCountFields) {
    validateOptionalNonNegativeInteger(dto[field], `basketball_team_match_statistics.${field}`);
  }
  return dto as unknown as ProviderBasketballTeamMatchStatistics;
}

function parseProviderFootballStanding(value: unknown): ProviderFootballStanding {
  const dto = asRecord(value, "football_standing");
  requireString(dto.competitionProviderId, "football_standing.competitionProviderId");
  requireString(dto.teamProviderId, "football_standing.teamProviderId");
  validatePositiveInteger(dto.position, "football_standing.position");
  for (const field of footballStandingNonNegativeFields) {
    validateNonNegativeInteger(dto[field], `football_standing.${field}`);
  }
  for (const field of footballStandingOptionalNonNegativeFields) {
    validateOptionalNonNegativeInteger(dto[field], `football_standing.${field}`);
  }
  return dto as unknown as ProviderFootballStanding;
}

function parseProviderBasketballStanding(value: unknown): ProviderBasketballStanding {
  const dto = asRecord(value, "basketball_standing");
  requireString(dto.competitionProviderId, "basketball_standing.competitionProviderId");
  requireString(dto.teamProviderId, "basketball_standing.teamProviderId");
  validatePositiveInteger(dto.position, "basketball_standing.position");
  validateNonNegativeInteger(dto.played, "basketball_standing.played");
  validateNonNegativeInteger(dto.wins, "basketball_standing.wins");
  validateNonNegativeInteger(dto.losses, "basketball_standing.losses");
  validateOptionalPercent(dto.winPercentage, "basketball_standing.winPercentage");
  for (const field of basketballStandingOptionalNonNegativeFields) {
    validateOptionalNonNegativeInteger(dto[field], `basketball_standing.${field}`);
  }
  return dto as unknown as ProviderBasketballStanding;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid ${label} payload.`);
  }

  return value as Record<string, unknown>;
}

function requireString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Missing required field ${field}.`);
  }
}

function requireMatchStatus(value: unknown): asserts value is MatchStatus {
  if (typeof value !== "string" || !matchStatuses.includes(value as MatchStatus)) {
    throw new Error(`Invalid match status "${String(value)}".`);
  }
}

function requireOptionalMatchStatus(value: unknown): asserts value is MatchStatus | undefined {
  if (value === undefined) {
    return;
  }

  requireMatchStatus(value);
}

function requireNumber(value: unknown, field: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Missing required field ${field}.`);
  }
}

function requireOptionalNumber(value: unknown, field: string): asserts value is number | undefined {
  if (value === undefined) {
    return;
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Invalid number field ${field}.`);
  }
}

function requireBasketballPeriodType(value: unknown, field: string): asserts value is BasketballPeriodType {
  if (typeof value !== "string" || !basketballPeriodTypes.includes(value as BasketballPeriodType)) {
    throw new Error(`Invalid basketball period type "${String(value)}" for ${field}.`);
  }
}

const footballCountFields = [
  "shotsTotal",
  "shotsOnTarget",
  "shotsOffTarget",
  "blockedShots",
  "corners",
  "fouls",
  "yellowCards",
  "redCards",
  "offsides",
  "goalkeeperSaves",
  "passes",
  "accuratePasses",
  "bigChances",
  "bigChancesMissed",
  "attacks",
  "dangerousAttacks",
  "hitWoodwork",
  "tackles",
  "interceptions",
  "clearances",
  "duelsWon",
  "aerialDuelsWon"
] as const;

const basketballCountFields = [
  "fieldGoalsMade",
  "fieldGoalsAttempted",
  "twoPointersMade",
  "twoPointersAttempted",
  "threePointersMade",
  "threePointersAttempted",
  "freeThrowsMade",
  "freeThrowsAttempted",
  "reboundsTotal",
  "reboundsOffensive",
  "reboundsDefensive",
  "assists",
  "steals",
  "blocks",
  "turnovers",
  "personalFouls",
  "fastBreakPoints",
  "pointsInPaint",
  "secondChancePoints",
  "benchPoints",
  "biggestLead",
  "leadChanges"
] as const;

const footballStandingNonNegativeFields = [
  "played",
  "wins",
  "draws",
  "losses",
  "goalsFor",
  "goalsAgainst",
  "points"
] as const;

const basketballStandingOptionalNonNegativeFields = [
  "pointsFor",
  "pointsAgainst",
  "homeWins",
  "homeLosses",
  "awayWins",
  "awayLosses"
] as const;

const footballStandingOptionalNonNegativeFields = [
  "homePlayed",
  "homeWins",
  "homeDraws",
  "homeLosses",
  "homeGoalsFor",
  "homeGoalsAgainst",
  "awayPlayed",
  "awayWins",
  "awayDraws",
  "awayLosses",
  "awayGoalsFor",
  "awayGoalsAgainst"
] as const;

function validatePositiveInteger(value: unknown, field: string) {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid positive integer field ${field}.`);
  }
}

function validateNonNegativeInteger(value: unknown, field: string) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid non-negative integer field ${field}.`);
  }
}

function validateOptionalNonNegativeNumber(value: unknown, field: string) {
  if (value === undefined) {
    return;
  }

  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid non-negative number field ${field}.`);
  }
}

function validateOptionalNonNegativeInteger(value: unknown, field: string) {
  if (value === undefined) {
    return;
  }

  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
    throw new Error(`Invalid non-negative integer field ${field}.`);
  }
}

function validateOptionalPercent(value: unknown, field: string) {
  if (value === undefined) {
    return;
  }

  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`Invalid percentage field ${field}.`);
  }
}

async function resolveMatchSportId(repositories: StaticNormalizerRepositories, provider: string, dto: ProviderMatch, competitionId: string): Promise<string> {
  if (dto.sportProviderId) {
    const sportMapping = await repositories.providerMappings.findProviderMapping(provider, "sport", dto.sportProviderId);
    if (!sportMapping) {
      throw new Error(`Cannot normalize match "${dto.providerEntityId}" without sport mapping "${dto.sportProviderId}".`);
    }

    return sportMapping.internalEntityId;
  }

  const competition = await repositories.competitions.findCompetitionById(competitionId);
  if (!competition) {
    throw new Error(`Cannot normalize match "${dto.providerEntityId}" without canonical competition "${competitionId}".`);
  }

  return competition.sportId;
}

async function resolveScoreMatch(repositories: StaticNormalizerRepositories, provider: string, providerEntityId: string, matchProviderId: string, label: string) {
  const matchMapping = await repositories.providerMappings.findProviderMapping(provider, "match", matchProviderId);
  if (!matchMapping) {
    throw new Error(`Cannot normalize ${label} "${providerEntityId}" without match mapping "${matchProviderId}".`);
  }

  const match = await repositories.matches.findMatchById(matchMapping.internalEntityId);
  if (!match) {
    throw new Error(`Cannot normalize ${label} "${providerEntityId}" without canonical match "${matchMapping.internalEntityId}".`);
  }

  return match;
}

async function resolveTeamStatisticsDependencies(
  repositories: StaticNormalizerRepositories,
  provider: string,
  providerEntityId: string | undefined,
  matchProviderId: string,
  teamProviderId: string,
  label: string
) {
  const identity = statisticsIdentity(providerEntityId, matchProviderId, teamProviderId);
  const match = await resolveScoreMatch(repositories, provider, identity, matchProviderId, label);
  const teamMapping = await repositories.providerMappings.findProviderMapping(provider, "team", teamProviderId);
  if (!teamMapping) {
    throw new Error(`Cannot normalize ${label} "${identity}" without team mapping "${teamProviderId}".`);
  }

  if (teamMapping.internalEntityId === match.homeTeamId) {
    return {
      match,
      teamId: teamMapping.internalEntityId,
      opponentTeamId: match.awayTeamId,
      isHome: true
    };
  }

  if (teamMapping.internalEntityId === match.awayTeamId) {
    return {
      match,
      teamId: teamMapping.internalEntityId,
      opponentTeamId: match.homeTeamId,
      isHome: false
    };
  }

  throw new Error(`Cannot normalize ${label} "${identity}" because team "${teamProviderId}" is not part of match "${matchProviderId}".`);
}

function statisticsIdentity(providerEntityId: string | undefined, matchProviderId: string, teamProviderId: string) {
  return providerEntityId ?? `${matchProviderId}:${teamProviderId}`;
}

async function resolveStandingDependencies(
  repositories: StaticNormalizerRepositories,
  provider: string,
  providerEntityId: string | undefined,
  competitionProviderId: string,
  seasonProviderId: string | undefined,
  teamProviderId: string,
  label: string
) {
  const identity = standingIdentity(providerEntityId, competitionProviderId, teamProviderId);
  const competitionMapping = await repositories.providerMappings.findProviderMapping(provider, "competition", competitionProviderId);
  if (!competitionMapping) {
    throw new Error(`Cannot normalize ${label} "${identity}" without competition mapping "${competitionProviderId}".`);
  }

  const seasonMapping = seasonProviderId ? await repositories.providerMappings.findProviderMapping(provider, "season", seasonProviderId) : undefined;
  if (seasonProviderId && !seasonMapping) {
    throw new Error(`Cannot normalize ${label} "${identity}" without season mapping "${seasonProviderId}".`);
  }

  const teamMapping = await repositories.providerMappings.findProviderMapping(provider, "team", teamProviderId);
  if (!teamMapping) {
    throw new Error(`Cannot normalize ${label} "${identity}" without team mapping "${teamProviderId}".`);
  }

  return {
    competitionId: competitionMapping.internalEntityId,
    seasonId: seasonMapping?.internalEntityId,
    teamId: teamMapping.internalEntityId
  };
}

function standingIdentity(providerEntityId: string | undefined, competitionProviderId: string, teamProviderId: string) {
  return providerEntityId ?? `${competitionProviderId}:${teamProviderId}`;
}

function parseDateTime(value: string, field: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date field ${field}.`);
  }

  return parsed;
}

function buildMatchMetadata(dto: ProviderMatch): Record<string, unknown> {
  const metadata: Record<string, unknown> = { ...(dto.metadata ?? {}) };
  const scoreSummary = pickDefined({
    homeScoreCurrent: dto.homeScoreCurrent,
    awayScoreCurrent: dto.awayScoreCurrent,
    homeScoreFinal: dto.homeScoreFinal,
    awayScoreFinal: dto.awayScoreFinal,
    homeScoreHalfTime: dto.homeScoreHalfTime,
    awayScoreHalfTime: dto.awayScoreHalfTime,
    scores: dto.scores
  });

  if (Object.keys(scoreSummary).length > 0) {
    metadata.scoreSummary = scoreSummary;
  }

  return metadata;
}

function pickDefined(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));
}
