import { and, desc, eq, inArray, isNull, lt, or } from "drizzle-orm";
import {
  basketballMatchScores,
  basketballPeriodScores,
  basketballTeamFormFeatures,
  basketballTeamMatchStatistics,
  basketballStandings,
  competitions,
  countries,
  footballMatchScores,
  footballMatchTeamStatistics,
  footballHeadToHeadFeatures,
  footballPredictionConflicts,
  footballPredictionOutputs,
  footballPredictionSettlements,
  footballMatchPredictionFeatures,
  footballStandings,
  footballTeamFormFeatures,
  matches,
  players,
  seasons,
  sports,
  teams
} from "../schema.js";
import { sha256Hash } from "@sports-data/shared";
import type {
  BasketballPeriodType,
  BasketballTeamFormScope,
  FootballPredictionConflictSeverity,
  FootballPredictionConsistencyStatus,
  FootballPredictionFamily,
  FootballPredictionRiskLevel,
  FootballPredictionSettlementStatus,
  FootballPredictionStatus,
  FootballTeamFormScope,
  MatchStatus
} from "@sports-data/shared";
import type { RepositoryExecutor } from "./types.js";

export interface UpsertSportInput {
  slug: string;
  name: string;
}

export interface UpsertCountryInput {
  code?: string;
  slug: string;
  name: string;
}

export interface UpsertCompetitionInput {
  sportId: string;
  countryId?: string;
  name: string;
  slug: string;
  gender?: string;
  level?: string;
  metadataJson?: Record<string, unknown>;
}

export interface UpsertSeasonInput {
  competitionId: string;
  name: string;
  startDate?: string;
  endDate?: string;
  isCurrent?: boolean;
}

export interface UpsertTeamInput {
  sportId: string;
  countryId?: string;
  name: string;
  shortName?: string;
  slug: string;
  gender?: string;
  type?: string;
  logoUrl?: string;
  venueName?: string;
  foundedYear?: number;
  metadataJson?: Record<string, unknown>;
}

export interface UpsertPlayerInput {
  sportId: string;
  nationalityCountryId?: string;
  currentTeamId?: string;
  name: string;
  shortName?: string;
  slug?: string;
  dateOfBirth?: string;
  age?: number;
  heightCm?: number;
  weightKg?: number;
  preferredFoot?: string;
  position?: string;
  jerseyNumber?: number;
  marketValue?: string;
  contractUntil?: string;
  photoUrl?: string;
  metadataJson?: Record<string, unknown>;
}

export interface UpsertMatchInput {
  sportId: string;
  competitionId: string;
  seasonId?: string;
  homeTeamId: string;
  awayTeamId: string;
  scheduledStartAt: Date;
  status: MatchStatus;
  round?: string;
  venue?: string;
  referee?: string;
  stageName?: string;
  neutralGround?: boolean;
  attendance?: number;
  winnerTeamId?: string;
  metadataJson?: Record<string, unknown>;
}

export interface UpsertFootballMatchScoreInput {
  matchId: string;
  homeTeamId: string;
  awayTeamId: string;
  winnerTeamId?: string;
  homeScoreCurrent?: number;
  awayScoreCurrent?: number;
  homeScoreHalftime?: number;
  awayScoreHalftime?: number;
  homeScoreFulltime?: number;
  awayScoreFulltime?: number;
  homeScoreExtraTime?: number;
  awayScoreExtraTime?: number;
  homeScorePenalties?: number;
  awayScorePenalties?: number;
  status?: MatchStatus;
  metadataJson?: Record<string, unknown>;
}

export interface UpsertBasketballMatchScoreInput {
  matchId: string;
  homeTeamId: string;
  awayTeamId: string;
  winnerTeamId?: string;
  homeScoreCurrent?: number;
  awayScoreCurrent?: number;
  homeScoreFinal?: number;
  awayScoreFinal?: number;
  homeScoreHalftime?: number;
  awayScoreHalftime?: number;
  homeScoreOvertime?: number;
  awayScoreOvertime?: number;
  status?: MatchStatus;
  metadataJson?: Record<string, unknown>;
}

export interface UpsertBasketballPeriodScoreInput {
  matchId: string;
  periodNumber: number;
  periodType: BasketballPeriodType;
  overtimeNumber?: number;
  homeScore: number;
  awayScore: number;
  metadataJson?: Record<string, unknown>;
}

export interface UpsertFootballMatchTeamStatisticsInput {
  matchId: string;
  teamId: string;
  opponentTeamId: string;
  isHome: boolean;
  possessionPercent?: number;
  shotsTotal?: number;
  shotsOnTarget?: number;
  shotsOffTarget?: number;
  blockedShots?: number;
  corners?: number;
  fouls?: number;
  yellowCards?: number;
  redCards?: number;
  offsides?: number;
  goalkeeperSaves?: number;
  passes?: number;
  accuratePasses?: number;
  passAccuracyPercent?: number;
  bigChances?: number;
  bigChancesMissed?: number;
  expectedGoals?: number;
  expectedAssists?: number;
  attacks?: number;
  dangerousAttacks?: number;
  hitWoodwork?: number;
  tackles?: number;
  interceptions?: number;
  clearances?: number;
  duelsWon?: number;
  aerialDuelsWon?: number;
  metadataJson?: Record<string, unknown>;
}

export interface UpsertBasketballTeamMatchStatisticsInput {
  matchId: string;
  teamId: string;
  opponentTeamId: string;
  isHome: boolean;
  fieldGoalsMade?: number;
  fieldGoalsAttempted?: number;
  fieldGoalPercent?: number;
  twoPointersMade?: number;
  twoPointersAttempted?: number;
  twoPointPercent?: number;
  threePointersMade?: number;
  threePointersAttempted?: number;
  threePointPercent?: number;
  freeThrowsMade?: number;
  freeThrowsAttempted?: number;
  freeThrowPercent?: number;
  reboundsTotal?: number;
  reboundsOffensive?: number;
  reboundsDefensive?: number;
  assists?: number;
  steals?: number;
  blocks?: number;
  turnovers?: number;
  personalFouls?: number;
  fastBreakPoints?: number;
  pointsInPaint?: number;
  secondChancePoints?: number;
  benchPoints?: number;
  biggestLead?: number;
  leadChanges?: number;
  timeInLeadSeconds?: number;
  metadataJson?: Record<string, unknown>;
}

export interface UpsertFootballStandingInput {
  competitionId: string;
  seasonId?: string;
  teamId: string;
  position: number;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  homePlayed?: number;
  homeWins?: number;
  homeDraws?: number;
  homeLosses?: number;
  homeGoalsFor?: number;
  homeGoalsAgainst?: number;
  awayPlayed?: number;
  awayWins?: number;
  awayDraws?: number;
  awayLosses?: number;
  awayGoalsFor?: number;
  awayGoalsAgainst?: number;
  formString?: string;
  status?: string;
  metadataJson?: Record<string, unknown>;
}

export interface UpsertBasketballStandingInput {
  competitionId: string;
  seasonId?: string;
  teamId: string;
  position: number;
  played: number;
  wins: number;
  losses: number;
  winPercentage?: number;
  pointsFor?: number;
  pointsAgainst?: number;
  pointDifference?: number;
  homeWins?: number;
  homeLosses?: number;
  awayWins?: number;
  awayLosses?: number;
  streak?: string;
  formString?: string;
  conference?: string;
  division?: string;
  status?: string;
  metadataJson?: Record<string, unknown>;
}

export interface UpsertFootballTeamFormFeatureInput {
  teamId: string;
  competitionId?: string;
  seasonId?: string | null;
  asOfMatchId?: string;
  asOfDate: Date;
  windowSize: number;
  scope: FootballTeamFormScope;
  matchesPlayed: number;
  wins: number;
  draws: number;
  losses: number;
  points: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  avgGoalsFor?: number;
  avgGoalsAgainst?: number;
  cleanSheetRate?: number;
  failedToScoreRate?: number;
  bothTeamsToScoreRate?: number;
  over05Rate?: number;
  over15Rate?: number;
  over25Rate?: number;
  over35Rate?: number;
  under25Rate?: number;
  scoredRate?: number;
  concededRate?: number;
  teamOver05Rate?: number;
  teamOver15Rate?: number;
  firstHalfOver05Rate?: number;
  firstHalfAvgGoalsFor?: number;
  firstHalfAvgGoalsAgainst?: number;
  avgShots?: number;
  avgShotsOnTarget?: number;
  avgPossessionPercent?: number;
  avgCorners?: number;
  avgYellowCards?: number;
  avgRedCards?: number;
  avgFouls?: number;
  avgExpectedGoals?: number;
  avgDangerousAttacks?: number;
  standingsPosition?: number;
  standingsPoints?: number;
  standingsGoalDifference?: number;
  sampleSize: number;
  coverageScore: number;
  metadataJson?: Record<string, unknown>;
}

export interface FootballTeamFormFeatureKey {
  teamId: string;
  competitionId?: string;
  seasonId?: string | null;
  asOfMatchId?: string;
  windowSize: number;
  scope: FootballTeamFormScope;
}

export interface ListFootballTeamFinalMatchesInput {
  teamId: string;
  asOfDate: Date;
  scope: FootballTeamFormScope;
  limit: number;
  competitionId?: string;
  seasonId?: string | null;
  includeMatchId?: string;
}

export interface UpsertFootballHeadToHeadFeatureInput {
  teamAId: string;
  teamBId: string;
  competitionId?: string;
  seasonId?: string | null;
  asOfMatchId?: string;
  asOfDate: Date;
  windowSize: number;
  matchesPlayed: number;
  teamAWins: number;
  teamBWins: number;
  draws: number;
  teamAGoalsFor: number;
  teamBGoalsFor: number;
  avgTotalGoals?: number;
  avgTeamAGoals?: number;
  avgTeamBGoals?: number;
  bothTeamsToScoreRate?: number;
  over15Rate?: number;
  over25Rate?: number;
  over35Rate?: number;
  teamAHomeMatches: number;
  teamBHomeMatches: number;
  teamAHomeWins: number;
  teamBHomeWins: number;
  lastMatchId?: string;
  lastMatchDate?: Date;
  lastMatchTeamAGoals?: number;
  lastMatchTeamBGoals?: number;
  sampleSize: number;
  coverageScore: number;
  metadataJson?: Record<string, unknown>;
}

export interface FootballHeadToHeadFeatureKey {
  teamAId: string;
  teamBId: string;
  competitionId?: string;
  seasonId?: string | null;
  asOfMatchId?: string;
  windowSize: number;
}

export type FootballMatchPredictionFeatureStatus = "ready" | "partial" | "insufficient_data";
export type FootballGoalProfile = "low_goal" | "medium_goal" | "high_goal" | "unknown";
export type FootballFirstHalfGoalProfile = "low_goal" | "likely_goal" | "unknown";
export type FootballBttsProfile = "yes_lean" | "no_lean" | "balanced" | "unknown";
export type FootballTeamGoalProfile = "weak" | "moderate" | "strong" | "unknown";

export interface UpsertFootballMatchPredictionFeatureInput {
  matchId: string;
  competitionId: string;
  seasonId?: string | null;
  homeTeamId: string;
  awayTeamId: string;
  asOfDate: Date;
  formWindowSize: number;
  h2hWindowSize: number;
  homeFormFeatureId?: string;
  awayFormFeatureId?: string;
  h2hFeatureId?: string;
  homeFormCoverageScore?: number;
  awayFormCoverageScore?: number;
  h2hCoverageScore?: number;
  combinedCoverageScore: number;
  homeRecentPoints?: number;
  awayRecentPoints?: number;
  homeAvgGoalsFor?: number;
  homeAvgGoalsAgainst?: number;
  awayAvgGoalsFor?: number;
  awayAvgGoalsAgainst?: number;
  homeAttackStrengthProxy?: number;
  awayAttackStrengthProxy?: number;
  homeDefenseStrengthProxy?: number;
  awayDefenseStrengthProxy?: number;
  h2hAvgTotalGoals?: number;
  h2hBttsRate?: number;
  h2hOver25Rate?: number;
  expectedTotalGoalsProxy?: number;
  expectedHomeGoalsProxy?: number;
  expectedAwayGoalsProxy?: number;
  homeGoalSignalScore?: number;
  awayGoalSignalScore?: number;
  firstHalfGoalSignalScore?: number;
  bttsSignalScore?: number;
  goalProfile?: FootballGoalProfile;
  firstHalfGoalProfile?: FootballFirstHalfGoalProfile;
  bttsProfile?: FootballBttsProfile;
  homeTeamGoalProfile?: FootballTeamGoalProfile;
  awayTeamGoalProfile?: FootballTeamGoalProfile;
  standingsPositionDiff?: number;
  standingsPointsDiff?: number;
  standingsGoalDifferenceDiff?: number;
  featureStatus: FootballMatchPredictionFeatureStatus;
  metadataJson?: Record<string, unknown>;
}

export interface FootballMatchPredictionFeatureKey {
  matchId: string;
  formWindowSize: number;
  h2hWindowSize: number;
}

export interface CreateFootballPredictionOutputInput {
  matchId: string;
  featureSnapshotId: string;
  predictionType: string;
  predictionValue: string;
  predictionFamily: FootballPredictionFamily;
  recommendationTier?: string;
  displayLabel?: string;
  reasoningSummary?: string;
  confidenceScore?: number;
  confidenceCeiling?: number;
  riskLevel?: FootballPredictionRiskLevel;
  status?: FootballPredictionStatus;
  consistencyStatus?: FootballPredictionConsistencyStatus;
  consistencyCheckedAt?: Date;
  consistencySummary?: string;
  expectationSnapshot?: Record<string, unknown>;
  conflictCount?: number;
  blockingConflictCount?: number;
  warningConflictCount?: number;
  generatedAt: Date;
  visibleToMembersAt?: Date;
  lockedAt?: Date;
  publicEligibleAt?: Date;
  publicPublishedAt?: Date;
  publicExcludedAt?: Date;
  publicExclusionReason?: string;
  staleAt?: Date;
  rebuildRequired?: boolean;
  generationWindowStatus?: FootballPredictionGenerationWindowStatus;
  generatedLeadTimeMinutes?: number;
  rebuildReason?: string;
  lastRebuiltAt?: Date;
  dedupeKey?: string;
  metadataJson?: Record<string, unknown>;
}

export type FootballPredictionGenerationWindowStatus = "within_window" | "too_early" | "too_late" | "stale" | "unknown";

export interface UpdateFootballPredictionOutputInput {
  predictionType?: string;
  predictionValue?: string;
  predictionFamily?: FootballPredictionFamily;
  recommendationTier?: string | null;
  displayLabel?: string | null;
  reasoningSummary?: string | null;
  confidenceScore?: number | null;
  confidenceCeiling?: number | null;
  riskLevel?: FootballPredictionRiskLevel;
  status?: FootballPredictionStatus;
  consistencyStatus?: FootballPredictionConsistencyStatus;
  consistencyCheckedAt?: Date | null;
  consistencySummary?: string | null;
  expectationSnapshot?: Record<string, unknown> | null;
  conflictCount?: number;
  blockingConflictCount?: number;
  warningConflictCount?: number;
  generatedAt?: Date;
  visibleToMembersAt?: Date | null;
  lockedAt?: Date | null;
  publicEligibleAt?: Date | null;
  publicPublishedAt?: Date | null;
  publicExcludedAt?: Date | null;
  publicExclusionReason?: string | null;
  staleAt?: Date | null;
  rebuildRequired?: boolean;
  generationWindowStatus?: FootballPredictionGenerationWindowStatus | null;
  generatedLeadTimeMinutes?: number | null;
  rebuildReason?: string | null;
  lastRebuiltAt?: Date | null;
  metadataJson?: Record<string, unknown>;
}

export interface FootballPredictionWindowMetadataInput {
  staleAt?: Date | null;
  rebuildRequired?: boolean;
  generationWindowStatus?: FootballPredictionGenerationWindowStatus | null;
  generatedLeadTimeMinutes?: number | null;
  rebuildReason?: string | null;
  lastRebuiltAt?: Date | null;
}

export interface ListRebuildRequiredPredictionOutputsFilters {
  matchId?: string;
  generationWindowStatus?: FootballPredictionGenerationWindowStatus;
  limit?: number;
}

export interface FootballPredictionConsistencyResultInput {
  consistencyStatus: FootballPredictionConsistencyStatus;
  consistencyCheckedAt?: Date;
  consistencySummary?: string | null;
  expectationSnapshot?: Record<string, unknown> | null;
  conflictCount?: number;
  blockingConflictCount?: number;
  warningConflictCount?: number;
}

export interface FootballPredictionConflictInput {
  predictionOutputId: string;
  matchId: string;
  conflictType: string;
  severity: FootballPredictionConflictSeverity;
  sourcePredictionType?: string;
  conflictingPredictionType?: string;
  reason: string;
  metadataJson?: Record<string, unknown>;
}

export interface FootballPredictionSettlementInput {
  predictionOutputId: string;
  matchId: string;
  settlementStatus: FootballPredictionSettlementStatus;
  actualResult: string;
  evaluatedAt: Date;
  settlementReason: string;
  settlementMetadata?: Record<string, unknown>;
}

export type SettlePredictionOutputInput = FootballPredictionSettlementInput;

export function buildFootballPredictionOutputDedupeKey(input: Pick<CreateFootballPredictionOutputInput, "matchId" | "featureSnapshotId" | "predictionType" | "predictionValue">): string {
  return sha256Hash({
    featureSnapshotId: input.featureSnapshotId,
    matchId: input.matchId,
    predictionType: input.predictionType,
    predictionValue: input.predictionValue
  });
}

export interface FindFootballPredictionTeamFormFeatureInput {
  teamId: string;
  competitionId: string;
  seasonId?: string | null;
  asOfMatchId: string;
  asOfDate: Date;
  windowSize: number;
  scope: FootballTeamFormScope;
}

export interface FindFootballPredictionH2HFeatureInput {
  teamAId: string;
  teamBId: string;
  competitionId: string;
  seasonId?: string | null;
  asOfMatchId: string;
  asOfDate: Date;
  windowSize: number;
}

export interface ListFootballHeadToHeadMatchesInput {
  teamAId: string;
  teamBId: string;
  asOfDate: Date;
  limit: number;
  competitionId?: string;
  seasonId?: string | null;
  includeMatchId?: string;
}

export interface UpsertBasketballTeamFormFeatureInput {
  teamId: string;
  competitionId?: string;
  seasonId?: string;
  asOfMatchId?: string;
  asOfDate: Date;
  windowSize: number;
  scope: BasketballTeamFormScope;
  matchesPlayed: number;
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
  pointDifference: number;
  avgPointsFor?: number;
  avgPointsAgainst?: number;
  avgTotalPoints?: number;
  avgMargin?: number;
  over1505Rate?: number;
  over1605Rate?: number;
  over1705Rate?: number;
  over1805Rate?: number;
  avgQ1PointsFor?: number;
  avgQ1PointsAgainst?: number;
  avgFirstHalfPointsFor?: number;
  avgFirstHalfPointsAgainst?: number;
  avgSecondHalfPointsFor?: number;
  avgSecondHalfPointsAgainst?: number;
  avgQ4PointsFor?: number;
  avgQ4PointsAgainst?: number;
  avgFieldGoalPercent?: number;
  avgThreePointPercent?: number;
  avgFreeThrowPercent?: number;
  avgReboundsTotal?: number;
  avgReboundsOffensive?: number;
  avgReboundsDefensive?: number;
  avgAssists?: number;
  avgSteals?: number;
  avgBlocks?: number;
  avgTurnovers?: number;
  avgPersonalFouls?: number;
  avgFastBreakPoints?: number;
  avgPointsInPaint?: number;
  avgSecondChancePoints?: number;
  avgBenchPoints?: number;
  standingsPosition?: number;
  standingsWinPercentage?: number;
  standingsPointDifference?: number;
  standingsStreak?: string;
  sampleSize: number;
  coverageScore: number;
  metadataJson?: Record<string, unknown>;
}

export interface BasketballTeamFormFeatureKey {
  teamId: string;
  competitionId?: string;
  seasonId?: string;
  asOfMatchId?: string;
  windowSize: number;
  scope: BasketballTeamFormScope;
}

export interface ListBasketballTeamFinalMatchesInput {
  teamId: string;
  asOfDate: Date;
  scope: BasketballTeamFormScope;
  limit: number;
  competitionId?: string;
  seasonId?: string;
  includeMatchId?: string;
}

export class SportRepository {
  constructor(private readonly db: RepositoryExecutor) {}

  async findSportById(id: string) {
    const rows = await this.db.select().from(sports).where(eq(sports.id, id)).limit(1);
    return rows[0];
  }

  async findSportBySlug(slug: string) {
    const rows = await this.db.select().from(sports).where(eq(sports.slug, slug)).limit(1);
    return rows[0];
  }

  async createSport(input: UpsertSportInput) {
    const rows = await this.db.insert(sports).values(input).returning();
    return rows[0];
  }

  async updateSport(id: string, input: UpsertSportInput) {
    const rows = await this.db
      .update(sports)
      .set({
        ...input,
        updatedAt: new Date()
      })
      .where(eq(sports.id, id))
      .returning();
    return rows[0];
  }

  async upsertSport(input: UpsertSportInput) {
    const rows = await this.db
      .insert(sports)
      .values(input)
      .onConflictDoUpdate({
        target: sports.slug,
        set: {
          name: input.name,
          updatedAt: new Date()
        }
      })
      .returning();
    return rows[0];
  }
}

export class CountryRepository {
  constructor(private readonly db: RepositoryExecutor) {}

  async findCountryById(id: string) {
    const rows = await this.db.select().from(countries).where(eq(countries.id, id)).limit(1);
    return rows[0];
  }

  async findCountryByCode(code: string) {
    const rows = await this.db.select().from(countries).where(eq(countries.code, code)).limit(1);
    return rows[0];
  }

  async findCountryBySlug(slug: string) {
    const rows = await this.db.select().from(countries).where(eq(countries.slug, slug)).limit(1);
    return rows[0];
  }

  async createCountry(input: UpsertCountryInput) {
    const rows = await this.db.insert(countries).values(input).returning();
    return rows[0];
  }

  async updateCountry(id: string, input: UpsertCountryInput) {
    const rows = await this.db
      .update(countries)
      .set({
        ...input,
        updatedAt: new Date()
      })
      .where(eq(countries.id, id))
      .returning();
    return rows[0];
  }

  async upsertCountry(input: UpsertCountryInput) {
    const existing = input.code ? await this.findCountryByCode(input.code) : await this.findCountryBySlug(input.slug);
    if (existing) {
      const rows = await this.db
        .update(countries)
        .set({
          name: input.name,
          slug: input.slug,
          code: input.code,
          updatedAt: new Date()
        })
        .where(eq(countries.id, existing.id))
        .returning();
      return rows[0];
    }

    const rows = await this.db
      .insert(countries)
      .values(input)
      .onConflictDoUpdate({
        target: countries.slug,
        set: {
          name: input.name,
          code: input.code,
          updatedAt: new Date()
        }
      })
      .returning();
    return rows[0];
  }
}

export class CompetitionRepository {
  constructor(private readonly db: RepositoryExecutor) {}

  async findCompetitionById(id: string) {
    const rows = await this.db.select().from(competitions).where(eq(competitions.id, id)).limit(1);
    return rows[0];
  }

  async findCompetitionByNaturalKey(sportId: string, slug: string) {
    const rows = await this.db.select().from(competitions).where(and(eq(competitions.sportId, sportId), eq(competitions.slug, slug))).limit(1);
    return rows[0];
  }

  async createCompetition(input: UpsertCompetitionInput) {
    const rows = await this.db.insert(competitions).values({ ...input, metadataJson: input.metadataJson ?? {} }).returning();
    return rows[0];
  }

  async updateCompetition(id: string, input: UpsertCompetitionInput) {
    const rows = await this.db
      .update(competitions)
      .set({
        ...input,
        metadataJson: input.metadataJson ?? {},
        updatedAt: new Date()
      })
      .where(eq(competitions.id, id))
      .returning();
    return rows[0];
  }

  async upsertCompetition(input: UpsertCompetitionInput) {
    const rows = await this.db
      .insert(competitions)
      .values({ ...input, metadataJson: input.metadataJson ?? {} })
      .onConflictDoUpdate({
        target: [competitions.sportId, competitions.slug],
        set: {
          countryId: input.countryId,
          name: input.name,
          gender: input.gender,
          level: input.level,
          metadataJson: input.metadataJson ?? {},
          updatedAt: new Date()
        }
      })
      .returning();
    return rows[0];
  }
}

export class SeasonRepository {
  constructor(private readonly db: RepositoryExecutor) {}

  async findSeasonById(id: string) {
    const rows = await this.db.select().from(seasons).where(eq(seasons.id, id)).limit(1);
    return rows[0];
  }

  async findSeasonByCompetitionAndName(competitionId: string, name: string) {
    const rows = await this.db.select().from(seasons).where(and(eq(seasons.competitionId, competitionId), eq(seasons.name, name))).limit(1);
    return rows[0];
  }

  async createSeason(input: UpsertSeasonInput) {
    const rows = await this.db.insert(seasons).values(input).returning();
    return rows[0];
  }

  async updateSeason(id: string, input: UpsertSeasonInput) {
    const rows = await this.db
      .update(seasons)
      .set({
        ...input,
        isCurrent: input.isCurrent ?? false,
        updatedAt: new Date()
      })
      .where(eq(seasons.id, id))
      .returning();
    return rows[0];
  }

  async upsertSeason(input: UpsertSeasonInput) {
    const rows = await this.db
      .insert(seasons)
      .values(input)
      .onConflictDoUpdate({
        target: [seasons.competitionId, seasons.name],
        set: {
          startDate: input.startDate,
          endDate: input.endDate,
          isCurrent: input.isCurrent ?? false,
          updatedAt: new Date()
        }
      })
      .returning();
    return rows[0];
  }
}

export class TeamRepository {
  constructor(private readonly db: RepositoryExecutor) {}

  async findTeamById(id: string) {
    const rows = await this.db.select().from(teams).where(eq(teams.id, id)).limit(1);
    return rows[0];
  }

  async findTeamBySportAndSlug(sportId: string, slug: string) {
    const rows = await this.db.select().from(teams).where(and(eq(teams.sportId, sportId), eq(teams.slug, slug))).limit(1);
    return rows[0];
  }

  async findTeamByNaturalKey(sportId: string, slug: string) {
    return this.findTeamBySportAndSlug(sportId, slug);
  }

  async createTeam(input: UpsertTeamInput) {
    const rows = await this.db.insert(teams).values({ ...input, metadataJson: input.metadataJson ?? {} }).returning();
    return rows[0];
  }

  async updateTeam(id: string, input: UpsertTeamInput) {
    const rows = await this.db
      .update(teams)
      .set({
        ...input,
        metadataJson: input.metadataJson ?? {},
        updatedAt: new Date()
      })
      .where(eq(teams.id, id))
      .returning();
    return rows[0];
  }

  async upsertTeam(input: UpsertTeamInput) {
    const rows = await this.db
      .insert(teams)
      .values({ ...input, metadataJson: input.metadataJson ?? {} })
      .onConflictDoUpdate({
        target: [teams.sportId, teams.slug],
        set: {
          countryId: input.countryId,
          name: input.name,
          shortName: input.shortName,
          gender: input.gender,
          type: input.type,
          logoUrl: input.logoUrl,
          venueName: input.venueName,
          foundedYear: input.foundedYear,
          metadataJson: input.metadataJson ?? {},
          updatedAt: new Date()
        }
      })
      .returning();
    return rows[0];
  }
}

export class PlayerRepository {
  constructor(private readonly db: RepositoryExecutor) {}

  async findPlayerById(id: string) {
    const rows = await this.db.select().from(players).where(eq(players.id, id)).limit(1);
    return rows[0];
  }

  async findPlayerBySportAndSlug(sportId: string, slug: string) {
    const rows = await this.db.select().from(players).where(and(eq(players.sportId, sportId), eq(players.slug, slug))).limit(1);
    return rows[0];
  }

  async findPlayerByNaturalKey(sportId: string, slug: string, dateOfBirth: string) {
    const rows = await this.db
      .select()
      .from(players)
      .where(and(eq(players.sportId, sportId), eq(players.slug, slug), eq(players.dateOfBirth, dateOfBirth)))
      .limit(1);
    return rows[0];
  }

  async createPlayer(input: UpsertPlayerInput) {
    const rows = await this.db.insert(players).values(toPlayerValues(input)).returning();
    return rows[0];
  }

  async updatePlayer(id: string, input: UpsertPlayerInput) {
    const rows = await this.db
      .update(players)
      .set({
        ...toPlayerValues(input),
        updatedAt: new Date()
      })
      .where(eq(players.id, id))
      .returning();
    return rows[0];
  }

  async upsertPlayer(input: UpsertPlayerInput) {
    if (input.slug && input.dateOfBirth) {
      const existing = await this.findPlayerByNaturalKey(input.sportId, input.slug, input.dateOfBirth);
      if (existing) {
        return this.updatePlayer(existing.id, input);
      }
    }

    return this.createPlayer(input);
  }
}

export class MatchRepository {
  constructor(private readonly db: RepositoryExecutor) {}

  async findMatchById(id: string) {
    const rows = await this.db.select().from(matches).where(eq(matches.id, id)).limit(1);
    return rows[0];
  }

  async findMatchByNaturalKey(input: Pick<UpsertMatchInput, "competitionId" | "seasonId" | "homeTeamId" | "awayTeamId" | "scheduledStartAt">) {
    const rows = await this.db
      .select()
      .from(matches)
      .where(
        and(
          eq(matches.competitionId, input.competitionId),
          input.seasonId ? eq(matches.seasonId, input.seasonId) : isNull(matches.seasonId),
          eq(matches.homeTeamId, input.homeTeamId),
          eq(matches.awayTeamId, input.awayTeamId),
          eq(matches.scheduledStartAt, input.scheduledStartAt)
        )
      )
      .limit(1);
    return rows[0];
  }

  async createMatch(input: UpsertMatchInput) {
    const rows = await this.db.insert(matches).values({ ...input, metadataJson: input.metadataJson ?? {} }).returning();
    return rows[0];
  }

  async updateMatch(id: string, input: UpsertMatchInput) {
    const rows = await this.db
      .update(matches)
      .set({
        ...input,
        metadataJson: input.metadataJson ?? {},
        updatedAt: new Date()
      })
      .where(eq(matches.id, id))
      .returning();
    return rows[0];
  }

  async upsertMatch(input: UpsertMatchInput) {
    const rows = await this.db
      .insert(matches)
      .values({ ...input, metadataJson: input.metadataJson ?? {} })
      .onConflictDoUpdate({
        target: [matches.competitionId, matches.seasonId, matches.homeTeamId, matches.awayTeamId, matches.scheduledStartAt],
        set: {
          sportId: input.sportId,
          status: input.status,
          round: input.round,
          venue: input.venue,
          referee: input.referee,
          stageName: input.stageName,
          neutralGround: input.neutralGround,
          attendance: input.attendance,
          winnerTeamId: input.winnerTeamId,
          metadataJson: input.metadataJson ?? {},
          updatedAt: new Date()
        }
      })
      .returning();
    return rows[0];
  }
}

export class FootballMatchScoreRepository {
  constructor(private readonly db: RepositoryExecutor) {}

  async findByMatchId(matchId: string) {
    const rows = await this.db.select().from(footballMatchScores).where(eq(footballMatchScores.matchId, matchId)).limit(1);
    return rows[0];
  }

  async create(input: UpsertFootballMatchScoreInput) {
    const rows = await this.db.insert(footballMatchScores).values({ ...input, metadataJson: input.metadataJson ?? {} }).returning();
    return rows[0];
  }

  async update(id: string, input: UpsertFootballMatchScoreInput) {
    const rows = await this.db
      .update(footballMatchScores)
      .set({
        ...input,
        metadataJson: input.metadataJson ?? {},
        updatedAt: new Date()
      })
      .where(eq(footballMatchScores.id, id))
      .returning();
    return rows[0];
  }

  async upsertByMatchId(input: UpsertFootballMatchScoreInput) {
    const rows = await this.db
      .insert(footballMatchScores)
      .values({ ...input, metadataJson: input.metadataJson ?? {} })
      .onConflictDoUpdate({
        target: footballMatchScores.matchId,
        set: {
          homeTeamId: input.homeTeamId,
          awayTeamId: input.awayTeamId,
          winnerTeamId: input.winnerTeamId,
          homeScoreCurrent: input.homeScoreCurrent,
          awayScoreCurrent: input.awayScoreCurrent,
          homeScoreHalftime: input.homeScoreHalftime,
          awayScoreHalftime: input.awayScoreHalftime,
          homeScoreFulltime: input.homeScoreFulltime,
          awayScoreFulltime: input.awayScoreFulltime,
          homeScoreExtraTime: input.homeScoreExtraTime,
          awayScoreExtraTime: input.awayScoreExtraTime,
          homeScorePenalties: input.homeScorePenalties,
          awayScorePenalties: input.awayScorePenalties,
          status: input.status,
          metadataJson: input.metadataJson ?? {},
          updatedAt: new Date()
        }
      })
      .returning();
    return rows[0];
  }
}

export class BasketballMatchScoreRepository {
  constructor(private readonly db: RepositoryExecutor) {}

  async findByMatchId(matchId: string) {
    const rows = await this.db.select().from(basketballMatchScores).where(eq(basketballMatchScores.matchId, matchId)).limit(1);
    return rows[0];
  }

  async create(input: UpsertBasketballMatchScoreInput) {
    const rows = await this.db.insert(basketballMatchScores).values({ ...input, metadataJson: input.metadataJson ?? {} }).returning();
    return rows[0];
  }

  async update(id: string, input: UpsertBasketballMatchScoreInput) {
    const rows = await this.db
      .update(basketballMatchScores)
      .set({
        ...input,
        metadataJson: input.metadataJson ?? {},
        updatedAt: new Date()
      })
      .where(eq(basketballMatchScores.id, id))
      .returning();
    return rows[0];
  }

  async upsertByMatchId(input: UpsertBasketballMatchScoreInput) {
    const rows = await this.db
      .insert(basketballMatchScores)
      .values({ ...input, metadataJson: input.metadataJson ?? {} })
      .onConflictDoUpdate({
        target: basketballMatchScores.matchId,
        set: {
          homeTeamId: input.homeTeamId,
          awayTeamId: input.awayTeamId,
          winnerTeamId: input.winnerTeamId,
          homeScoreCurrent: input.homeScoreCurrent,
          awayScoreCurrent: input.awayScoreCurrent,
          homeScoreFinal: input.homeScoreFinal,
          awayScoreFinal: input.awayScoreFinal,
          homeScoreHalftime: input.homeScoreHalftime,
          awayScoreHalftime: input.awayScoreHalftime,
          homeScoreOvertime: input.homeScoreOvertime,
          awayScoreOvertime: input.awayScoreOvertime,
          status: input.status,
          metadataJson: input.metadataJson ?? {},
          updatedAt: new Date()
        }
      })
      .returning();
    return rows[0];
  }
}

export class BasketballPeriodScoreRepository {
  constructor(private readonly db: RepositoryExecutor) {}

  async findByMatchAndPeriod(matchId: string, periodType: BasketballPeriodType, periodNumber: number, overtimeNumber?: number) {
    const rows = await this.db
      .select()
      .from(basketballPeriodScores)
      .where(
        and(
          eq(basketballPeriodScores.matchId, matchId),
          eq(basketballPeriodScores.periodType, periodType),
          eq(basketballPeriodScores.periodNumber, periodNumber),
          overtimeNumber === undefined ? isNull(basketballPeriodScores.overtimeNumber) : eq(basketballPeriodScores.overtimeNumber, overtimeNumber)
        )
      )
      .limit(1);
    return rows[0];
  }

  async listByMatchId(matchId: string) {
    return this.db.select().from(basketballPeriodScores).where(eq(basketballPeriodScores.matchId, matchId));
  }

  async create(input: UpsertBasketballPeriodScoreInput) {
    const rows = await this.db.insert(basketballPeriodScores).values({ ...input, metadataJson: input.metadataJson ?? {} }).returning();
    return rows[0];
  }

  async update(id: string, input: UpsertBasketballPeriodScoreInput) {
    const rows = await this.db
      .update(basketballPeriodScores)
      .set({
        ...input,
        metadataJson: input.metadataJson ?? {},
        updatedAt: new Date()
      })
      .where(eq(basketballPeriodScores.id, id))
      .returning();
    return rows[0];
  }

  async upsertByMatchAndPeriod(input: UpsertBasketballPeriodScoreInput) {
    const rows = await this.db
      .insert(basketballPeriodScores)
      .values({ ...input, metadataJson: input.metadataJson ?? {} })
      .onConflictDoUpdate({
        target: [basketballPeriodScores.matchId, basketballPeriodScores.periodType, basketballPeriodScores.periodNumber, basketballPeriodScores.overtimeNumber],
        set: {
          homeScore: input.homeScore,
          awayScore: input.awayScore,
          metadataJson: input.metadataJson ?? {},
          updatedAt: new Date()
        }
      })
      .returning();
    return rows[0];
  }
}

export class FootballMatchTeamStatisticsRepository {
  constructor(private readonly db: RepositoryExecutor) {}

  async findByMatchAndTeam(matchId: string, teamId: string) {
    const rows = await this.db
      .select()
      .from(footballMatchTeamStatistics)
      .where(and(eq(footballMatchTeamStatistics.matchId, matchId), eq(footballMatchTeamStatistics.teamId, teamId)))
      .limit(1);
    return rows[0];
  }

  async listByMatchId(matchId: string) {
    return this.db.select().from(footballMatchTeamStatistics).where(eq(footballMatchTeamStatistics.matchId, matchId));
  }

  async listByTeamId(teamId: string) {
    return this.db.select().from(footballMatchTeamStatistics).where(eq(footballMatchTeamStatistics.teamId, teamId));
  }

  async create(input: UpsertFootballMatchTeamStatisticsInput) {
    const rows = await this.db.insert(footballMatchTeamStatistics).values({ ...input, metadataJson: input.metadataJson ?? {} }).returning();
    return rows[0];
  }

  async update(id: string, input: UpsertFootballMatchTeamStatisticsInput) {
    const rows = await this.db
      .update(footballMatchTeamStatistics)
      .set({
        ...input,
        metadataJson: input.metadataJson ?? {},
        updatedAt: new Date()
      })
      .where(eq(footballMatchTeamStatistics.id, id))
      .returning();
    return rows[0];
  }

  async upsertByMatchAndTeam(input: UpsertFootballMatchTeamStatisticsInput) {
    const rows = await this.db
      .insert(footballMatchTeamStatistics)
      .values({ ...input, metadataJson: input.metadataJson ?? {} })
      .onConflictDoUpdate({
        target: [footballMatchTeamStatistics.matchId, footballMatchTeamStatistics.teamId],
        set: {
          opponentTeamId: input.opponentTeamId,
          isHome: input.isHome,
          possessionPercent: input.possessionPercent,
          shotsTotal: input.shotsTotal,
          shotsOnTarget: input.shotsOnTarget,
          shotsOffTarget: input.shotsOffTarget,
          blockedShots: input.blockedShots,
          corners: input.corners,
          fouls: input.fouls,
          yellowCards: input.yellowCards,
          redCards: input.redCards,
          offsides: input.offsides,
          goalkeeperSaves: input.goalkeeperSaves,
          passes: input.passes,
          accuratePasses: input.accuratePasses,
          passAccuracyPercent: input.passAccuracyPercent,
          bigChances: input.bigChances,
          bigChancesMissed: input.bigChancesMissed,
          expectedGoals: input.expectedGoals,
          expectedAssists: input.expectedAssists,
          attacks: input.attacks,
          dangerousAttacks: input.dangerousAttacks,
          hitWoodwork: input.hitWoodwork,
          tackles: input.tackles,
          interceptions: input.interceptions,
          clearances: input.clearances,
          duelsWon: input.duelsWon,
          aerialDuelsWon: input.aerialDuelsWon,
          metadataJson: input.metadataJson ?? {},
          updatedAt: new Date()
        }
      })
      .returning();
    return rows[0];
  }
}

export class BasketballTeamMatchStatisticsRepository {
  constructor(private readonly db: RepositoryExecutor) {}

  async findByMatchAndTeam(matchId: string, teamId: string) {
    const rows = await this.db
      .select()
      .from(basketballTeamMatchStatistics)
      .where(and(eq(basketballTeamMatchStatistics.matchId, matchId), eq(basketballTeamMatchStatistics.teamId, teamId)))
      .limit(1);
    return rows[0];
  }

  async listByMatchId(matchId: string) {
    return this.db.select().from(basketballTeamMatchStatistics).where(eq(basketballTeamMatchStatistics.matchId, matchId));
  }

  async listByTeamId(teamId: string) {
    return this.db.select().from(basketballTeamMatchStatistics).where(eq(basketballTeamMatchStatistics.teamId, teamId));
  }

  async create(input: UpsertBasketballTeamMatchStatisticsInput) {
    const rows = await this.db.insert(basketballTeamMatchStatistics).values({ ...input, metadataJson: input.metadataJson ?? {} }).returning();
    return rows[0];
  }

  async update(id: string, input: UpsertBasketballTeamMatchStatisticsInput) {
    const rows = await this.db
      .update(basketballTeamMatchStatistics)
      .set({
        ...input,
        metadataJson: input.metadataJson ?? {},
        updatedAt: new Date()
      })
      .where(eq(basketballTeamMatchStatistics.id, id))
      .returning();
    return rows[0];
  }

  async upsertByMatchAndTeam(input: UpsertBasketballTeamMatchStatisticsInput) {
    const rows = await this.db
      .insert(basketballTeamMatchStatistics)
      .values({ ...input, metadataJson: input.metadataJson ?? {} })
      .onConflictDoUpdate({
        target: [basketballTeamMatchStatistics.matchId, basketballTeamMatchStatistics.teamId],
        set: {
          opponentTeamId: input.opponentTeamId,
          isHome: input.isHome,
          fieldGoalsMade: input.fieldGoalsMade,
          fieldGoalsAttempted: input.fieldGoalsAttempted,
          fieldGoalPercent: input.fieldGoalPercent,
          twoPointersMade: input.twoPointersMade,
          twoPointersAttempted: input.twoPointersAttempted,
          twoPointPercent: input.twoPointPercent,
          threePointersMade: input.threePointersMade,
          threePointersAttempted: input.threePointersAttempted,
          threePointPercent: input.threePointPercent,
          freeThrowsMade: input.freeThrowsMade,
          freeThrowsAttempted: input.freeThrowsAttempted,
          freeThrowPercent: input.freeThrowPercent,
          reboundsTotal: input.reboundsTotal,
          reboundsOffensive: input.reboundsOffensive,
          reboundsDefensive: input.reboundsDefensive,
          assists: input.assists,
          steals: input.steals,
          blocks: input.blocks,
          turnovers: input.turnovers,
          personalFouls: input.personalFouls,
          fastBreakPoints: input.fastBreakPoints,
          pointsInPaint: input.pointsInPaint,
          secondChancePoints: input.secondChancePoints,
          benchPoints: input.benchPoints,
          biggestLead: input.biggestLead,
          leadChanges: input.leadChanges,
          timeInLeadSeconds: input.timeInLeadSeconds,
          metadataJson: input.metadataJson ?? {},
          updatedAt: new Date()
        }
      })
      .returning();
    return rows[0];
  }
}

export class FootballStandingRepository {
  constructor(private readonly db: RepositoryExecutor) {}

  async findByCompetitionSeasonTeam(competitionId: string, seasonId: string | undefined, teamId: string) {
    const rows = await this.db
      .select()
      .from(footballStandings)
      .where(
        and(
          eq(footballStandings.competitionId, competitionId),
          seasonId ? eq(footballStandings.seasonId, seasonId) : isNull(footballStandings.seasonId),
          eq(footballStandings.teamId, teamId)
        )
      )
      .limit(1);
    return rows[0];
  }

  async listByCompetitionSeason(competitionId: string, seasonId?: string) {
    return this.db
      .select()
      .from(footballStandings)
      .where(and(eq(footballStandings.competitionId, competitionId), seasonId ? eq(footballStandings.seasonId, seasonId) : isNull(footballStandings.seasonId)));
  }

  async listByTeamId(teamId: string) {
    return this.db.select().from(footballStandings).where(eq(footballStandings.teamId, teamId));
  }

  async create(input: UpsertFootballStandingInput) {
    const rows = await this.db.insert(footballStandings).values({ ...input, metadataJson: input.metadataJson ?? {} }).returning();
    return rows[0];
  }

  async update(id: string, input: UpsertFootballStandingInput) {
    const rows = await this.db
      .update(footballStandings)
      .set({ ...input, metadataJson: input.metadataJson ?? {}, updatedAt: new Date() })
      .where(eq(footballStandings.id, id))
      .returning();
    return rows[0];
  }

  async upsertByCompetitionSeasonTeam(input: UpsertFootballStandingInput) {
    const rows = await this.db
      .insert(footballStandings)
      .values({ ...input, metadataJson: input.metadataJson ?? {} })
      .onConflictDoUpdate({
        target: [footballStandings.competitionId, footballStandings.seasonId, footballStandings.teamId],
        set: {
          position: input.position,
          played: input.played,
          wins: input.wins,
          draws: input.draws,
          losses: input.losses,
          goalsFor: input.goalsFor,
          goalsAgainst: input.goalsAgainst,
          goalDifference: input.goalDifference,
          points: input.points,
          homePlayed: input.homePlayed,
          homeWins: input.homeWins,
          homeDraws: input.homeDraws,
          homeLosses: input.homeLosses,
          homeGoalsFor: input.homeGoalsFor,
          homeGoalsAgainst: input.homeGoalsAgainst,
          awayPlayed: input.awayPlayed,
          awayWins: input.awayWins,
          awayDraws: input.awayDraws,
          awayLosses: input.awayLosses,
          awayGoalsFor: input.awayGoalsFor,
          awayGoalsAgainst: input.awayGoalsAgainst,
          formString: input.formString,
          status: input.status,
          metadataJson: input.metadataJson ?? {},
          updatedAt: new Date()
        }
      })
      .returning();
    return rows[0];
  }
}

export class BasketballStandingRepository {
  constructor(private readonly db: RepositoryExecutor) {}

  async findByCompetitionSeasonTeam(competitionId: string, seasonId: string | undefined, teamId: string) {
    const rows = await this.db
      .select()
      .from(basketballStandings)
      .where(
        and(
          eq(basketballStandings.competitionId, competitionId),
          seasonId ? eq(basketballStandings.seasonId, seasonId) : isNull(basketballStandings.seasonId),
          eq(basketballStandings.teamId, teamId)
        )
      )
      .limit(1);
    return rows[0];
  }

  async listByCompetitionSeason(competitionId: string, seasonId?: string) {
    return this.db
      .select()
      .from(basketballStandings)
      .where(and(eq(basketballStandings.competitionId, competitionId), seasonId ? eq(basketballStandings.seasonId, seasonId) : isNull(basketballStandings.seasonId)));
  }

  async listByTeamId(teamId: string) {
    return this.db.select().from(basketballStandings).where(eq(basketballStandings.teamId, teamId));
  }

  async create(input: UpsertBasketballStandingInput) {
    const rows = await this.db.insert(basketballStandings).values({ ...input, metadataJson: input.metadataJson ?? {} }).returning();
    return rows[0];
  }

  async update(id: string, input: UpsertBasketballStandingInput) {
    const rows = await this.db
      .update(basketballStandings)
      .set({ ...input, metadataJson: input.metadataJson ?? {}, updatedAt: new Date() })
      .where(eq(basketballStandings.id, id))
      .returning();
    return rows[0];
  }

  async upsertByCompetitionSeasonTeam(input: UpsertBasketballStandingInput) {
    const rows = await this.db
      .insert(basketballStandings)
      .values({ ...input, metadataJson: input.metadataJson ?? {} })
      .onConflictDoUpdate({
        target: [basketballStandings.competitionId, basketballStandings.seasonId, basketballStandings.teamId],
        set: {
          position: input.position,
          played: input.played,
          wins: input.wins,
          losses: input.losses,
          winPercentage: input.winPercentage,
          pointsFor: input.pointsFor,
          pointsAgainst: input.pointsAgainst,
          pointDifference: input.pointDifference,
          homeWins: input.homeWins,
          homeLosses: input.homeLosses,
          awayWins: input.awayWins,
          awayLosses: input.awayLosses,
          streak: input.streak,
          formString: input.formString,
          conference: input.conference,
          division: input.division,
          status: input.status,
          metadataJson: input.metadataJson ?? {},
          updatedAt: new Date()
        }
      })
      .returning();
    return rows[0];
  }
}

export class FootballTeamFormFeatureRepository {
  constructor(private readonly db: RepositoryExecutor) {}

  async findByKey(input: FootballTeamFormFeatureKey) {
    const rows = await this.db
      .select()
      .from(footballTeamFormFeatures)
      .where(
        and(
          eq(footballTeamFormFeatures.teamId, input.teamId),
          input.competitionId ? eq(footballTeamFormFeatures.competitionId, input.competitionId) : isNull(footballTeamFormFeatures.competitionId),
          input.seasonId ? eq(footballTeamFormFeatures.seasonId, input.seasonId) : isNull(footballTeamFormFeatures.seasonId),
          input.asOfMatchId ? eq(footballTeamFormFeatures.asOfMatchId, input.asOfMatchId) : isNull(footballTeamFormFeatures.asOfMatchId),
          eq(footballTeamFormFeatures.windowSize, input.windowSize),
          eq(footballTeamFormFeatures.scope, input.scope)
        )
      )
      .limit(1);
    return rows[0];
  }

  async create(input: UpsertFootballTeamFormFeatureInput) {
    const rows = await this.db.insert(footballTeamFormFeatures).values({ ...input, metadataJson: input.metadataJson ?? {} }).returning();
    return rows[0];
  }

  async update(id: string, input: UpsertFootballTeamFormFeatureInput) {
    const rows = await this.db
      .update(footballTeamFormFeatures)
      .set({
        ...input,
        metadataJson: input.metadataJson ?? {},
        updatedAt: new Date()
      })
      .where(eq(footballTeamFormFeatures.id, id))
      .returning();
    return rows[0];
  }

  async upsertFeature(input: UpsertFootballTeamFormFeatureInput) {
    const rows = await this.db
      .insert(footballTeamFormFeatures)
      .values({ ...input, metadataJson: input.metadataJson ?? {} })
      .onConflictDoUpdate({
        target: [
          footballTeamFormFeatures.teamId,
          footballTeamFormFeatures.competitionId,
          footballTeamFormFeatures.seasonId,
          footballTeamFormFeatures.asOfMatchId,
          footballTeamFormFeatures.windowSize,
          footballTeamFormFeatures.scope
        ],
        set: {
          asOfDate: input.asOfDate,
          matchesPlayed: input.matchesPlayed,
          wins: input.wins,
          draws: input.draws,
          losses: input.losses,
          points: input.points,
          goalsFor: input.goalsFor,
          goalsAgainst: input.goalsAgainst,
          goalDifference: input.goalDifference,
          avgGoalsFor: input.avgGoalsFor,
          avgGoalsAgainst: input.avgGoalsAgainst,
          cleanSheetRate: input.cleanSheetRate,
          failedToScoreRate: input.failedToScoreRate,
          bothTeamsToScoreRate: input.bothTeamsToScoreRate,
          over05Rate: input.over05Rate,
          over15Rate: input.over15Rate,
          over25Rate: input.over25Rate,
          over35Rate: input.over35Rate,
          under25Rate: input.under25Rate,
          scoredRate: input.scoredRate,
          concededRate: input.concededRate,
          teamOver05Rate: input.teamOver05Rate,
          teamOver15Rate: input.teamOver15Rate,
          firstHalfOver05Rate: input.firstHalfOver05Rate,
          firstHalfAvgGoalsFor: input.firstHalfAvgGoalsFor,
          firstHalfAvgGoalsAgainst: input.firstHalfAvgGoalsAgainst,
          avgShots: input.avgShots,
          avgShotsOnTarget: input.avgShotsOnTarget,
          avgPossessionPercent: input.avgPossessionPercent,
          avgCorners: input.avgCorners,
          avgYellowCards: input.avgYellowCards,
          avgRedCards: input.avgRedCards,
          avgFouls: input.avgFouls,
          avgExpectedGoals: input.avgExpectedGoals,
          avgDangerousAttacks: input.avgDangerousAttacks,
          standingsPosition: input.standingsPosition,
          standingsPoints: input.standingsPoints,
          standingsGoalDifference: input.standingsGoalDifference,
          sampleSize: input.sampleSize,
          coverageScore: input.coverageScore,
          metadataJson: input.metadataJson ?? {},
          updatedAt: new Date()
        }
      })
      .returning();
    return rows[0];
  }

  async listByTeamId(teamId: string) {
    return this.db.select().from(footballTeamFormFeatures).where(eq(footballTeamFormFeatures.teamId, teamId));
  }

  async listByMatchId(asOfMatchId: string) {
    return this.db.select().from(footballTeamFormFeatures).where(eq(footballTeamFormFeatures.asOfMatchId, asOfMatchId));
  }

  async listLatestByTeam(teamId: string, limit = 20) {
    return this.db.select().from(footballTeamFormFeatures).where(eq(footballTeamFormFeatures.teamId, teamId)).orderBy(desc(footballTeamFormFeatures.updatedAt)).limit(limit);
  }

  async findMatchById(matchId: string) {
    const rows = await this.db.select().from(matches).where(eq(matches.id, matchId)).limit(1);
    return rows[0];
  }

  async findStandingForTeam(teamId: string, competitionId?: string, seasonId?: string | null) {
    if (!competitionId) {
      return undefined;
    }

    const seasonCondition = seasonId === undefined ? undefined : seasonId === null ? isNull(footballStandings.seasonId) : eq(footballStandings.seasonId, seasonId);
    const conditions = [eq(footballStandings.teamId, teamId), eq(footballStandings.competitionId, competitionId), seasonCondition].filter((condition) => condition !== undefined);

    const rows = await this.db
      .select()
      .from(footballStandings)
      .where(and(...conditions))
      .limit(1);
    return rows[0];
  }

  async listFinalMatchesForTeamBefore(input: ListFootballTeamFinalMatchesInput) {
    const sideCondition =
      input.scope === "home" ? eq(matches.homeTeamId, input.teamId) : input.scope === "away" ? eq(matches.awayTeamId, input.teamId) : or(eq(matches.homeTeamId, input.teamId), eq(matches.awayTeamId, input.teamId));
    const dateCondition = input.includeMatchId ? or(lt(matches.scheduledStartAt, input.asOfDate), eq(matches.id, input.includeMatchId)) : lt(matches.scheduledStartAt, input.asOfDate);
    const conditions = [
      sideCondition,
      dateCondition,
      inArray(matches.status, ["finished", "after_extra_time", "after_penalties"] satisfies MatchStatus[]),
      input.competitionId ? eq(matches.competitionId, input.competitionId) : undefined,
      input.seasonId === undefined ? undefined : input.seasonId === null ? isNull(matches.seasonId) : eq(matches.seasonId, input.seasonId)
    ].filter((condition) => condition !== undefined);

    return this.db
      .select({
        match: matches,
        score: footballMatchScores,
        statistics: footballMatchTeamStatistics
      })
      .from(matches)
      .innerJoin(footballMatchScores, eq(footballMatchScores.matchId, matches.id))
      .leftJoin(footballMatchTeamStatistics, and(eq(footballMatchTeamStatistics.matchId, matches.id), eq(footballMatchTeamStatistics.teamId, input.teamId)))
      .where(and(...conditions))
      .orderBy(desc(matches.scheduledStartAt))
      .limit(input.limit);
  }

  async listTeamIdsForCompetitionSeason(competitionId: string, seasonId: string | null) {
    const seasonCondition = seasonId === null ? isNull(matches.seasonId) : eq(matches.seasonId, seasonId);
    const rows = await this.db
      .select({
        homeTeamId: matches.homeTeamId,
        awayTeamId: matches.awayTeamId
      })
      .from(matches)
      .where(and(eq(matches.competitionId, competitionId), seasonCondition, inArray(matches.status, ["finished", "after_extra_time", "after_penalties"] satisfies MatchStatus[])));

    return [...new Set(rows.flatMap((row) => [row.homeTeamId, row.awayTeamId]))];
  }
}

export class FootballHeadToHeadFeatureRepository {
  constructor(private readonly db: RepositoryExecutor) {}

  async findByKey(input: FootballHeadToHeadFeatureKey) {
    const rows = await this.db
      .select()
      .from(footballHeadToHeadFeatures)
      .where(
        and(
          eq(footballHeadToHeadFeatures.teamAId, input.teamAId),
          eq(footballHeadToHeadFeatures.teamBId, input.teamBId),
          input.competitionId ? eq(footballHeadToHeadFeatures.competitionId, input.competitionId) : isNull(footballHeadToHeadFeatures.competitionId),
          input.seasonId ? eq(footballHeadToHeadFeatures.seasonId, input.seasonId) : isNull(footballHeadToHeadFeatures.seasonId),
          input.asOfMatchId ? eq(footballHeadToHeadFeatures.asOfMatchId, input.asOfMatchId) : isNull(footballHeadToHeadFeatures.asOfMatchId),
          eq(footballHeadToHeadFeatures.windowSize, input.windowSize)
        )
      )
      .limit(1);
    return rows[0];
  }

  async create(input: UpsertFootballHeadToHeadFeatureInput) {
    const rows = await this.db.insert(footballHeadToHeadFeatures).values({ ...input, metadataJson: input.metadataJson ?? {} }).returning();
    return rows[0];
  }

  async update(id: string, input: UpsertFootballHeadToHeadFeatureInput) {
    const rows = await this.db
      .update(footballHeadToHeadFeatures)
      .set({
        ...input,
        metadataJson: input.metadataJson ?? {},
        updatedAt: new Date()
      })
      .where(eq(footballHeadToHeadFeatures.id, id))
      .returning();
    return rows[0];
  }

  async upsertFeature(input: UpsertFootballHeadToHeadFeatureInput) {
    const rows = await this.db
      .insert(footballHeadToHeadFeatures)
      .values({ ...input, metadataJson: input.metadataJson ?? {} })
      .onConflictDoUpdate({
        target: [
          footballHeadToHeadFeatures.teamAId,
          footballHeadToHeadFeatures.teamBId,
          footballHeadToHeadFeatures.competitionId,
          footballHeadToHeadFeatures.seasonId,
          footballHeadToHeadFeatures.asOfMatchId,
          footballHeadToHeadFeatures.windowSize
        ],
        set: {
          asOfDate: input.asOfDate,
          matchesPlayed: input.matchesPlayed,
          teamAWins: input.teamAWins,
          teamBWins: input.teamBWins,
          draws: input.draws,
          teamAGoalsFor: input.teamAGoalsFor,
          teamBGoalsFor: input.teamBGoalsFor,
          avgTotalGoals: input.avgTotalGoals,
          avgTeamAGoals: input.avgTeamAGoals,
          avgTeamBGoals: input.avgTeamBGoals,
          bothTeamsToScoreRate: input.bothTeamsToScoreRate,
          over15Rate: input.over15Rate,
          over25Rate: input.over25Rate,
          over35Rate: input.over35Rate,
          teamAHomeMatches: input.teamAHomeMatches,
          teamBHomeMatches: input.teamBHomeMatches,
          teamAHomeWins: input.teamAHomeWins,
          teamBHomeWins: input.teamBHomeWins,
          lastMatchId: input.lastMatchId,
          lastMatchDate: input.lastMatchDate,
          lastMatchTeamAGoals: input.lastMatchTeamAGoals,
          lastMatchTeamBGoals: input.lastMatchTeamBGoals,
          sampleSize: input.sampleSize,
          coverageScore: input.coverageScore,
          metadataJson: input.metadataJson ?? {},
          updatedAt: new Date()
        }
      })
      .returning();
    return rows[0];
  }

  async listByPair(teamAId: string, teamBId: string) {
    return this.db
      .select()
      .from(footballHeadToHeadFeatures)
      .where(and(eq(footballHeadToHeadFeatures.teamAId, teamAId), eq(footballHeadToHeadFeatures.teamBId, teamBId)));
  }

  async listByMatchId(asOfMatchId: string) {
    return this.db.select().from(footballHeadToHeadFeatures).where(eq(footballHeadToHeadFeatures.asOfMatchId, asOfMatchId));
  }

  async listLatestByPair(teamAId: string, teamBId: string, limit = 20) {
    return this.db
      .select()
      .from(footballHeadToHeadFeatures)
      .where(and(eq(footballHeadToHeadFeatures.teamAId, teamAId), eq(footballHeadToHeadFeatures.teamBId, teamBId)))
      .orderBy(desc(footballHeadToHeadFeatures.updatedAt))
      .limit(limit);
  }

  async findMatchById(matchId: string) {
    const rows = await this.db.select().from(matches).where(eq(matches.id, matchId)).limit(1);
    return rows[0];
  }

  async listFinalMatchesForPairBefore(input: ListFootballHeadToHeadMatchesInput) {
    const pairCondition = or(
      and(eq(matches.homeTeamId, input.teamAId), eq(matches.awayTeamId, input.teamBId)),
      and(eq(matches.homeTeamId, input.teamBId), eq(matches.awayTeamId, input.teamAId))
    );
    const dateCondition = input.includeMatchId ? or(lt(matches.scheduledStartAt, input.asOfDate), eq(matches.id, input.includeMatchId)) : lt(matches.scheduledStartAt, input.asOfDate);
    const conditions = [
      pairCondition,
      dateCondition,
      inArray(matches.status, ["finished", "after_extra_time", "after_penalties"] satisfies MatchStatus[]),
      input.competitionId ? eq(matches.competitionId, input.competitionId) : undefined,
      input.seasonId === undefined ? undefined : input.seasonId === null ? isNull(matches.seasonId) : eq(matches.seasonId, input.seasonId)
    ].filter((condition) => condition !== undefined);

    return this.db
      .select({
        match: matches,
        score: footballMatchScores
      })
      .from(matches)
      .innerJoin(footballMatchScores, eq(footballMatchScores.matchId, matches.id))
      .where(and(...conditions))
      .orderBy(desc(matches.scheduledStartAt))
      .limit(input.limit);
  }

  async listPairIdsForCompetitionSeason(competitionId: string, seasonId: string | null) {
    const seasonCondition = seasonId === null ? isNull(matches.seasonId) : eq(matches.seasonId, seasonId);
    const rows = await this.db
      .select({
        homeTeamId: matches.homeTeamId,
        awayTeamId: matches.awayTeamId
      })
      .from(matches)
      .where(and(eq(matches.competitionId, competitionId), seasonCondition, inArray(matches.status, ["finished", "after_extra_time", "after_penalties"] satisfies MatchStatus[])));

    return [...new Map(rows.map((row) => [canonicalPairKey(row.homeTeamId, row.awayTeamId), canonicalPair(row.homeTeamId, row.awayTeamId)])).values()];
  }
}

export class FootballMatchPredictionFeatureRepository {
  constructor(private readonly db: RepositoryExecutor) {}

  async findByMatchAndWindows(input: FootballMatchPredictionFeatureKey) {
    const rows = await this.db
      .select()
      .from(footballMatchPredictionFeatures)
      .where(
        and(
          eq(footballMatchPredictionFeatures.matchId, input.matchId),
          eq(footballMatchPredictionFeatures.formWindowSize, input.formWindowSize),
          eq(footballMatchPredictionFeatures.h2hWindowSize, input.h2hWindowSize)
        )
      )
      .limit(1);
    return rows[0];
  }

  async create(input: UpsertFootballMatchPredictionFeatureInput) {
    const rows = await this.db.insert(footballMatchPredictionFeatures).values({ ...input, metadataJson: input.metadataJson ?? {} }).returning();
    return rows[0];
  }

  async update(id: string, input: UpsertFootballMatchPredictionFeatureInput) {
    const rows = await this.db
      .update(footballMatchPredictionFeatures)
      .set({
        ...input,
        metadataJson: input.metadataJson ?? {},
        updatedAt: new Date()
      })
      .where(eq(footballMatchPredictionFeatures.id, id))
      .returning();
    return rows[0];
  }

  async upsertFeature(input: UpsertFootballMatchPredictionFeatureInput) {
    const rows = await this.db
      .insert(footballMatchPredictionFeatures)
      .values({ ...input, metadataJson: input.metadataJson ?? {} })
      .onConflictDoUpdate({
        target: [footballMatchPredictionFeatures.matchId, footballMatchPredictionFeatures.formWindowSize, footballMatchPredictionFeatures.h2hWindowSize],
        set: {
          competitionId: input.competitionId,
          seasonId: input.seasonId,
          homeTeamId: input.homeTeamId,
          awayTeamId: input.awayTeamId,
          asOfDate: input.asOfDate,
          homeFormFeatureId: input.homeFormFeatureId,
          awayFormFeatureId: input.awayFormFeatureId,
          h2hFeatureId: input.h2hFeatureId,
          homeFormCoverageScore: input.homeFormCoverageScore,
          awayFormCoverageScore: input.awayFormCoverageScore,
          h2hCoverageScore: input.h2hCoverageScore,
          combinedCoverageScore: input.combinedCoverageScore,
          homeRecentPoints: input.homeRecentPoints,
          awayRecentPoints: input.awayRecentPoints,
          homeAvgGoalsFor: input.homeAvgGoalsFor,
          homeAvgGoalsAgainst: input.homeAvgGoalsAgainst,
          awayAvgGoalsFor: input.awayAvgGoalsFor,
          awayAvgGoalsAgainst: input.awayAvgGoalsAgainst,
          homeAttackStrengthProxy: input.homeAttackStrengthProxy,
          awayAttackStrengthProxy: input.awayAttackStrengthProxy,
          homeDefenseStrengthProxy: input.homeDefenseStrengthProxy,
          awayDefenseStrengthProxy: input.awayDefenseStrengthProxy,
          h2hAvgTotalGoals: input.h2hAvgTotalGoals,
          h2hBttsRate: input.h2hBttsRate,
          h2hOver25Rate: input.h2hOver25Rate,
          expectedTotalGoalsProxy: input.expectedTotalGoalsProxy,
          expectedHomeGoalsProxy: input.expectedHomeGoalsProxy,
          expectedAwayGoalsProxy: input.expectedAwayGoalsProxy,
          homeGoalSignalScore: input.homeGoalSignalScore,
          awayGoalSignalScore: input.awayGoalSignalScore,
          firstHalfGoalSignalScore: input.firstHalfGoalSignalScore,
          bttsSignalScore: input.bttsSignalScore,
          goalProfile: input.goalProfile,
          firstHalfGoalProfile: input.firstHalfGoalProfile,
          bttsProfile: input.bttsProfile,
          homeTeamGoalProfile: input.homeTeamGoalProfile,
          awayTeamGoalProfile: input.awayTeamGoalProfile,
          standingsPositionDiff: input.standingsPositionDiff,
          standingsPointsDiff: input.standingsPointsDiff,
          standingsGoalDifferenceDiff: input.standingsGoalDifferenceDiff,
          featureStatus: input.featureStatus,
          metadataJson: input.metadataJson ?? {},
          updatedAt: new Date()
        }
      })
      .returning();
    return rows[0];
  }

  async listByMatchId(matchId: string) {
    return this.db.select().from(footballMatchPredictionFeatures).where(eq(footballMatchPredictionFeatures.matchId, matchId));
  }

  async listByCompetition(competitionId: string, limit = 100) {
    return this.db
      .select()
      .from(footballMatchPredictionFeatures)
      .where(eq(footballMatchPredictionFeatures.competitionId, competitionId))
      .orderBy(desc(footballMatchPredictionFeatures.updatedAt))
      .limit(limit);
  }

  async listByStatus(status: FootballMatchPredictionFeatureStatus, limit = 100) {
    return this.db
      .select()
      .from(footballMatchPredictionFeatures)
      .where(eq(footballMatchPredictionFeatures.featureStatus, status))
      .orderBy(desc(footballMatchPredictionFeatures.updatedAt))
      .limit(limit);
  }

  async findMatchById(matchId: string) {
    const rows = await this.db.select().from(matches).where(eq(matches.id, matchId)).limit(1);
    return rows[0];
  }

  async findBestTeamFormFeature(input: FindFootballPredictionTeamFormFeatureInput) {
    const seasonCondition = input.seasonId === undefined ? undefined : input.seasonId === null ? isNull(footballTeamFormFeatures.seasonId) : eq(footballTeamFormFeatures.seasonId, input.seasonId);
    const baseConditions = [
      eq(footballTeamFormFeatures.teamId, input.teamId),
      eq(footballTeamFormFeatures.competitionId, input.competitionId),
      seasonCondition,
      eq(footballTeamFormFeatures.windowSize, input.windowSize),
      eq(footballTeamFormFeatures.scope, input.scope)
    ].filter((condition) => condition !== undefined);

    const exactRows = await this.db
      .select()
      .from(footballTeamFormFeatures)
      .where(and(...baseConditions, eq(footballTeamFormFeatures.asOfMatchId, input.asOfMatchId)))
      .limit(1);
    if (exactRows[0]) return exactRows[0];

    const latestRows = await this.db
      .select()
      .from(footballTeamFormFeatures)
      .where(and(...baseConditions, lt(footballTeamFormFeatures.asOfDate, input.asOfDate)))
      .orderBy(desc(footballTeamFormFeatures.asOfDate), desc(footballTeamFormFeatures.updatedAt))
      .limit(1);
    return latestRows[0];
  }

  async findBestHeadToHeadFeature(input: FindFootballPredictionH2HFeatureInput) {
    const pair = canonicalPair(input.teamAId, input.teamBId);
    const seasonCondition = input.seasonId === undefined ? undefined : input.seasonId === null ? isNull(footballHeadToHeadFeatures.seasonId) : eq(footballHeadToHeadFeatures.seasonId, input.seasonId);
    const baseConditions = [
      eq(footballHeadToHeadFeatures.teamAId, pair.teamAId),
      eq(footballHeadToHeadFeatures.teamBId, pair.teamBId),
      eq(footballHeadToHeadFeatures.competitionId, input.competitionId),
      seasonCondition,
      eq(footballHeadToHeadFeatures.windowSize, input.windowSize)
    ].filter((condition) => condition !== undefined);

    const exactRows = await this.db
      .select()
      .from(footballHeadToHeadFeatures)
      .where(and(...baseConditions, eq(footballHeadToHeadFeatures.asOfMatchId, input.asOfMatchId)))
      .limit(1);
    if (exactRows[0]) return exactRows[0];

    const latestRows = await this.db
      .select()
      .from(footballHeadToHeadFeatures)
      .where(and(...baseConditions, lt(footballHeadToHeadFeatures.asOfDate, input.asOfDate)))
      .orderBy(desc(footballHeadToHeadFeatures.asOfDate), desc(footballHeadToHeadFeatures.updatedAt))
      .limit(1);
    return latestRows[0];
  }
}

export class FootballPredictionOutputRepository {
  constructor(private readonly db: RepositoryExecutor) {}

  async findById(id: string) {
    const rows = await this.db.select().from(footballPredictionOutputs).where(eq(footballPredictionOutputs.id, id)).limit(1);
    return rows[0];
  }

  async findByDedupeKey(dedupeKey: string) {
    const rows = await this.db.select().from(footballPredictionOutputs).where(eq(footballPredictionOutputs.dedupeKey, dedupeKey)).limit(1);
    return rows[0];
  }

  async createPredictionOutput(input: CreateFootballPredictionOutputInput) {
    const values = buildFootballPredictionOutputValues(input);
    const rows = await this.db.insert(footballPredictionOutputs).values(values).returning();
    return rows[0];
  }

  async updatePredictionOutput(id: string, input: UpdateFootballPredictionOutputInput) {
    const rows = await this.db
      .update(footballPredictionOutputs)
      .set({
        ...input,
        updatedAt: new Date()
      })
      .where(eq(footballPredictionOutputs.id, id))
      .returning();
    return rows[0];
  }

  async upsertPredictionOutput(input: CreateFootballPredictionOutputInput) {
    const values = buildFootballPredictionOutputValues(input);
    const rows = await this.db
      .insert(footballPredictionOutputs)
      .values(values)
      .onConflictDoUpdate({
        target: footballPredictionOutputs.dedupeKey,
        set: {
          predictionFamily: values.predictionFamily,
          recommendationTier: values.recommendationTier,
          displayLabel: values.displayLabel,
          reasoningSummary: values.reasoningSummary,
          confidenceScore: values.confidenceScore,
          confidenceCeiling: values.confidenceCeiling,
          riskLevel: values.riskLevel,
          status: values.status,
          consistencyStatus: values.consistencyStatus,
          consistencyCheckedAt: values.consistencyCheckedAt,
          consistencySummary: values.consistencySummary,
          expectationSnapshot: values.expectationSnapshot,
          conflictCount: values.conflictCount,
          blockingConflictCount: values.blockingConflictCount,
          warningConflictCount: values.warningConflictCount,
          generatedAt: values.generatedAt,
          visibleToMembersAt: values.visibleToMembersAt,
          lockedAt: values.lockedAt,
          staleAt: values.staleAt,
          rebuildRequired: values.rebuildRequired,
          generationWindowStatus: values.generationWindowStatus,
          generatedLeadTimeMinutes: values.generatedLeadTimeMinutes,
          rebuildReason: values.rebuildReason,
          lastRebuiltAt: values.lastRebuiltAt,
          metadataJson: values.metadataJson,
          updatedAt: new Date()
        }
      })
      .returning();
    return rows[0];
  }

  async updateWindowMetadata(id: string, input: FootballPredictionWindowMetadataInput) {
    const rows = await this.db
      .update(footballPredictionOutputs)
      .set({
        ...input,
        updatedAt: new Date()
      })
      .where(eq(footballPredictionOutputs.id, id))
      .returning();
    return rows[0];
  }

  async markRebuildRequired(id: string, reason: string, staleAt = new Date()) {
    return this.updateWindowMetadata(id, {
      rebuildRequired: true,
      generationWindowStatus: "stale",
      staleAt,
      rebuildReason: reason
    });
  }

  async clearRebuildRequired(id: string, lastRebuiltAt = new Date()) {
    return this.updateWindowMetadata(id, {
      rebuildRequired: false,
      rebuildReason: null,
      staleAt: null,
      lastRebuiltAt
    });
  }

  async listRebuildRequired(filters: ListRebuildRequiredPredictionOutputsFilters = {}) {
    const conditions = [
      eq(footballPredictionOutputs.rebuildRequired, true),
      filters.matchId ? eq(footballPredictionOutputs.matchId, filters.matchId) : undefined,
      filters.generationWindowStatus ? eq(footballPredictionOutputs.generationWindowStatus, filters.generationWindowStatus) : undefined
    ].filter((condition) => condition !== undefined);

    return this.db
      .select()
      .from(footballPredictionOutputs)
      .where(and(...conditions))
      .orderBy(desc(footballPredictionOutputs.generatedAt))
      .limit(filters.limit ?? 100);
  }

  async listByMatchId(matchId: string, limit = 100) {
    return this.db
      .select()
      .from(footballPredictionOutputs)
      .where(eq(footballPredictionOutputs.matchId, matchId))
      .orderBy(desc(footballPredictionOutputs.generatedAt))
      .limit(limit);
  }

  async listByStatus(status: FootballPredictionStatus, limit = 100) {
    return this.db
      .select()
      .from(footballPredictionOutputs)
      .where(eq(footballPredictionOutputs.status, status))
      .orderBy(desc(footballPredictionOutputs.generatedAt))
      .limit(limit);
  }

  async listMemberVisible(limit = 100) {
    return this.db
      .select()
      .from(footballPredictionOutputs)
      .where(eq(footballPredictionOutputs.status, "member_visible"))
      .orderBy(desc(footballPredictionOutputs.visibleToMembersAt), desc(footballPredictionOutputs.generatedAt))
      .limit(limit);
  }

  async updateConsistencyResult(id: string, input: FootballPredictionConsistencyResultInput) {
    const rows = await this.db
      .update(footballPredictionOutputs)
      .set({
        consistencyStatus: input.consistencyStatus,
        consistencyCheckedAt: input.consistencyCheckedAt ?? new Date(),
        consistencySummary: input.consistencySummary,
        expectationSnapshot: input.expectationSnapshot,
        conflictCount: input.conflictCount ?? 0,
        blockingConflictCount: input.blockingConflictCount ?? 0,
        warningConflictCount: input.warningConflictCount ?? 0,
        updatedAt: new Date()
      })
      .where(eq(footballPredictionOutputs.id, id))
      .returning();
    return rows[0];
  }

  async markMemberVisible(id: string, visibleToMembersAt = new Date()) {
    const rows = await this.db
      .update(footballPredictionOutputs)
      .set({
        status: "member_visible",
        visibleToMembersAt,
        updatedAt: new Date()
      })
      .where(eq(footballPredictionOutputs.id, id))
      .returning();
    return rows[0];
  }

  async lockPrediction(id: string, lockedAt = new Date()) {
    const rows = await this.db
      .update(footballPredictionOutputs)
      .set({
        status: "locked",
        lockedAt,
        updatedAt: new Date()
      })
      .where(eq(footballPredictionOutputs.id, id))
      .returning();
    return rows[0];
  }

  async archivePrediction(id: string) {
    const rows = await this.db
      .update(footballPredictionOutputs)
      .set({
        status: "archived",
        updatedAt: new Date()
      })
      .where(eq(footballPredictionOutputs.id, id))
      .returning();
    return rows[0];
  }

  async addConflict(input: FootballPredictionConflictInput) {
    const rows = await this.db.insert(footballPredictionConflicts).values({ ...input, metadataJson: input.metadataJson ?? {} }).returning();
    return rows[0];
  }

  async listConflictsForPrediction(predictionOutputId: string) {
    return this.db
      .select()
      .from(footballPredictionConflicts)
      .where(eq(footballPredictionConflicts.predictionOutputId, predictionOutputId))
      .orderBy(desc(footballPredictionConflicts.createdAt));
  }

  async deleteConflictsForPrediction(predictionOutputId: string) {
    return this.db.delete(footballPredictionConflicts).where(eq(footballPredictionConflicts.predictionOutputId, predictionOutputId)).returning();
  }

  async replaceConflictsForPrediction(predictionOutputId: string, conflicts: FootballPredictionConflictInput[]) {
    await this.deleteConflictsForPrediction(predictionOutputId);
    return Promise.all(conflicts.map((conflict) => this.addConflict(conflict)));
  }

  async findSettlementByPredictionOutputId(predictionOutputId: string) {
    const rows = await this.db.select().from(footballPredictionSettlements).where(eq(footballPredictionSettlements.predictionOutputId, predictionOutputId)).limit(1);
    return rows[0];
  }

  async createSettlement(input: FootballPredictionSettlementInput) {
    const rows = await this.db.insert(footballPredictionSettlements).values(buildFootballPredictionSettlementValues(input)).returning();
    return rows[0];
  }

  async updateSettlement(predictionOutputId: string, input: FootballPredictionSettlementInput) {
    const rows = await this.db
      .update(footballPredictionSettlements)
      .set({
        settlementStatus: input.settlementStatus,
        actualResult: input.actualResult,
        evaluatedAt: input.evaluatedAt,
        settlementReason: input.settlementReason,
        settlementMetadata: input.settlementMetadata ?? {},
        updatedAt: new Date()
      })
      .where(eq(footballPredictionSettlements.predictionOutputId, predictionOutputId))
      .returning();
    return rows[0];
  }

  async upsertSettlement(input: FootballPredictionSettlementInput) {
    const values = buildFootballPredictionSettlementValues(input);
    const rows = await this.db
      .insert(footballPredictionSettlements)
      .values(values)
      .onConflictDoUpdate({
        target: footballPredictionSettlements.predictionOutputId,
        set: {
          matchId: values.matchId,
          settlementStatus: values.settlementStatus,
          actualResult: values.actualResult,
          evaluatedAt: values.evaluatedAt,
          settlementReason: values.settlementReason,
          settlementMetadata: values.settlementMetadata,
          updatedAt: new Date()
        }
      })
      .returning();
    return rows[0];
  }

  async listSettlementsByMatchId(matchId: string, limit = 100) {
    return this.db
      .select()
      .from(footballPredictionSettlements)
      .where(eq(footballPredictionSettlements.matchId, matchId))
      .orderBy(desc(footballPredictionSettlements.evaluatedAt))
      .limit(limit);
  }

  async listSettlementsByStatus(status: FootballPredictionSettlementStatus, limit = 100) {
    return this.db
      .select()
      .from(footballPredictionSettlements)
      .where(eq(footballPredictionSettlements.settlementStatus, status))
      .orderBy(desc(footballPredictionSettlements.evaluatedAt))
      .limit(limit);
  }

  async settlePredictionOutput(input: SettlePredictionOutputInput) {
    const settlement = await this.upsertSettlement(input);
    await this.updatePredictionOutput(input.predictionOutputId, { status: input.settlementStatus });
    return settlement;
  }

  async listSettleablePredictionOutputsByMatchId(matchId: string, limit = 100) {
    return this.db
      .select()
      .from(footballPredictionOutputs)
      .where(
        and(
          eq(footballPredictionOutputs.matchId, matchId),
          inArray(footballPredictionOutputs.status, ["draft", "generated", "member_visible", "locked", "settlement_pending"])
        )
      )
      .orderBy(desc(footballPredictionOutputs.generatedAt))
      .limit(limit);
  }

  async findPredictionOutputSettlementContextById(predictionOutputId: string) {
    const rows = await this.db
      .select({
        predictionOutput: footballPredictionOutputs,
        match: matches,
        score: footballMatchScores
      })
      .from(footballPredictionOutputs)
      .innerJoin(matches, eq(footballPredictionOutputs.matchId, matches.id))
      .leftJoin(footballMatchScores, eq(footballPredictionOutputs.matchId, footballMatchScores.matchId))
      .where(eq(footballPredictionOutputs.id, predictionOutputId))
      .limit(1);
    return rows[0];
  }

  async listPredictionOutputSettlementContextsByMatchId(matchId: string, limit = 100) {
    return this.db
      .select({
        predictionOutput: footballPredictionOutputs,
        match: matches,
        score: footballMatchScores
      })
      .from(footballPredictionOutputs)
      .innerJoin(matches, eq(footballPredictionOutputs.matchId, matches.id))
      .leftJoin(footballMatchScores, eq(footballPredictionOutputs.matchId, footballMatchScores.matchId))
      .where(
        and(
          eq(footballPredictionOutputs.matchId, matchId),
          inArray(footballPredictionOutputs.status, ["draft", "generated", "member_visible", "locked", "settlement_pending"])
        )
      )
      .orderBy(desc(footballPredictionOutputs.generatedAt))
      .limit(limit);
  }
}

function buildFootballPredictionOutputValues(input: CreateFootballPredictionOutputInput) {
  return {
    ...input,
    riskLevel: input.riskLevel ?? "unknown",
    status: input.status ?? "draft",
    consistencyStatus: input.consistencyStatus ?? "unchecked",
    conflictCount: input.conflictCount ?? 0,
    blockingConflictCount: input.blockingConflictCount ?? 0,
    warningConflictCount: input.warningConflictCount ?? 0,
    rebuildRequired: input.rebuildRequired ?? false,
    dedupeKey: input.dedupeKey ?? buildFootballPredictionOutputDedupeKey(input),
    metadataJson: input.metadataJson ?? {}
  };
}

function buildFootballPredictionSettlementValues(input: FootballPredictionSettlementInput) {
  return {
    predictionOutputId: input.predictionOutputId,
    matchId: input.matchId,
    settlementStatus: input.settlementStatus,
    actualResult: input.actualResult,
    evaluatedAt: input.evaluatedAt,
    settlementReason: input.settlementReason,
    settlementMetadata: input.settlementMetadata ?? {}
  };
}

function canonicalPair(teamAId: string, teamBId: string) {
  return teamAId.localeCompare(teamBId) <= 0 ? { teamAId, teamBId } : { teamAId: teamBId, teamBId: teamAId };
}

function canonicalPairKey(teamAId: string, teamBId: string) {
  const pair = canonicalPair(teamAId, teamBId);
  return `${pair.teamAId}|${pair.teamBId}`;
}

export class BasketballTeamFormFeatureRepository {
  constructor(private readonly db: RepositoryExecutor) {}

  async findByKey(input: BasketballTeamFormFeatureKey) {
    const rows = await this.db
      .select()
      .from(basketballTeamFormFeatures)
      .where(
        and(
          eq(basketballTeamFormFeatures.teamId, input.teamId),
          input.competitionId ? eq(basketballTeamFormFeatures.competitionId, input.competitionId) : isNull(basketballTeamFormFeatures.competitionId),
          input.seasonId ? eq(basketballTeamFormFeatures.seasonId, input.seasonId) : isNull(basketballTeamFormFeatures.seasonId),
          input.asOfMatchId ? eq(basketballTeamFormFeatures.asOfMatchId, input.asOfMatchId) : isNull(basketballTeamFormFeatures.asOfMatchId),
          eq(basketballTeamFormFeatures.windowSize, input.windowSize),
          eq(basketballTeamFormFeatures.scope, input.scope)
        )
      )
      .limit(1);
    return rows[0];
  }

  async create(input: UpsertBasketballTeamFormFeatureInput) {
    const rows = await this.db.insert(basketballTeamFormFeatures).values({ ...input, metadataJson: input.metadataJson ?? {} }).returning();
    return rows[0];
  }

  async update(id: string, input: UpsertBasketballTeamFormFeatureInput) {
    const rows = await this.db
      .update(basketballTeamFormFeatures)
      .set({
        ...input,
        metadataJson: input.metadataJson ?? {},
        updatedAt: new Date()
      })
      .where(eq(basketballTeamFormFeatures.id, id))
      .returning();
    return rows[0];
  }

  async upsertFeature(input: UpsertBasketballTeamFormFeatureInput) {
    const rows = await this.db
      .insert(basketballTeamFormFeatures)
      .values({ ...input, metadataJson: input.metadataJson ?? {} })
      .onConflictDoUpdate({
        target: [
          basketballTeamFormFeatures.teamId,
          basketballTeamFormFeatures.competitionId,
          basketballTeamFormFeatures.seasonId,
          basketballTeamFormFeatures.asOfMatchId,
          basketballTeamFormFeatures.windowSize,
          basketballTeamFormFeatures.scope
        ],
        set: {
          asOfDate: input.asOfDate,
          matchesPlayed: input.matchesPlayed,
          wins: input.wins,
          losses: input.losses,
          pointsFor: input.pointsFor,
          pointsAgainst: input.pointsAgainst,
          pointDifference: input.pointDifference,
          avgPointsFor: input.avgPointsFor,
          avgPointsAgainst: input.avgPointsAgainst,
          avgTotalPoints: input.avgTotalPoints,
          avgMargin: input.avgMargin,
          over1505Rate: input.over1505Rate,
          over1605Rate: input.over1605Rate,
          over1705Rate: input.over1705Rate,
          over1805Rate: input.over1805Rate,
          avgQ1PointsFor: input.avgQ1PointsFor,
          avgQ1PointsAgainst: input.avgQ1PointsAgainst,
          avgFirstHalfPointsFor: input.avgFirstHalfPointsFor,
          avgFirstHalfPointsAgainst: input.avgFirstHalfPointsAgainst,
          avgSecondHalfPointsFor: input.avgSecondHalfPointsFor,
          avgSecondHalfPointsAgainst: input.avgSecondHalfPointsAgainst,
          avgQ4PointsFor: input.avgQ4PointsFor,
          avgQ4PointsAgainst: input.avgQ4PointsAgainst,
          avgFieldGoalPercent: input.avgFieldGoalPercent,
          avgThreePointPercent: input.avgThreePointPercent,
          avgFreeThrowPercent: input.avgFreeThrowPercent,
          avgReboundsTotal: input.avgReboundsTotal,
          avgReboundsOffensive: input.avgReboundsOffensive,
          avgReboundsDefensive: input.avgReboundsDefensive,
          avgAssists: input.avgAssists,
          avgSteals: input.avgSteals,
          avgBlocks: input.avgBlocks,
          avgTurnovers: input.avgTurnovers,
          avgPersonalFouls: input.avgPersonalFouls,
          avgFastBreakPoints: input.avgFastBreakPoints,
          avgPointsInPaint: input.avgPointsInPaint,
          avgSecondChancePoints: input.avgSecondChancePoints,
          avgBenchPoints: input.avgBenchPoints,
          standingsPosition: input.standingsPosition,
          standingsWinPercentage: input.standingsWinPercentage,
          standingsPointDifference: input.standingsPointDifference,
          standingsStreak: input.standingsStreak,
          sampleSize: input.sampleSize,
          coverageScore: input.coverageScore,
          metadataJson: input.metadataJson ?? {},
          updatedAt: new Date()
        }
      })
      .returning();
    return rows[0];
  }

  async listByTeamId(teamId: string) {
    return this.db.select().from(basketballTeamFormFeatures).where(eq(basketballTeamFormFeatures.teamId, teamId));
  }

  async listByMatchId(asOfMatchId: string) {
    return this.db.select().from(basketballTeamFormFeatures).where(eq(basketballTeamFormFeatures.asOfMatchId, asOfMatchId));
  }

  async listLatestByTeam(teamId: string, limit = 20) {
    return this.db.select().from(basketballTeamFormFeatures).where(eq(basketballTeamFormFeatures.teamId, teamId)).orderBy(desc(basketballTeamFormFeatures.updatedAt)).limit(limit);
  }

  async findMatchById(matchId: string) {
    const rows = await this.db.select().from(matches).where(eq(matches.id, matchId)).limit(1);
    return rows[0];
  }

  async findStandingForTeam(teamId: string, competitionId?: string, seasonId?: string) {
    if (!competitionId) {
      return undefined;
    }

    const rows = await this.db
      .select()
      .from(basketballStandings)
      .where(
        and(
          eq(basketballStandings.teamId, teamId),
          eq(basketballStandings.competitionId, competitionId),
          seasonId ? eq(basketballStandings.seasonId, seasonId) : isNull(basketballStandings.seasonId)
        )
      )
      .limit(1);
    return rows[0];
  }

  async listFinalMatchesForTeamBefore(input: ListBasketballTeamFinalMatchesInput) {
    const sideCondition =
      input.scope === "home" ? eq(matches.homeTeamId, input.teamId) : input.scope === "away" ? eq(matches.awayTeamId, input.teamId) : or(eq(matches.homeTeamId, input.teamId), eq(matches.awayTeamId, input.teamId));
    const dateCondition = input.includeMatchId ? or(lt(matches.scheduledStartAt, input.asOfDate), eq(matches.id, input.includeMatchId)) : lt(matches.scheduledStartAt, input.asOfDate);
    const conditions = [
      sideCondition,
      dateCondition,
      inArray(matches.status, ["finished", "after_extra_time", "after_penalties"] satisfies MatchStatus[]),
      input.competitionId ? eq(matches.competitionId, input.competitionId) : undefined,
      input.seasonId ? eq(matches.seasonId, input.seasonId) : undefined
    ].filter((condition) => condition !== undefined);

    const rows = await this.db
      .select({
        match: matches,
        score: basketballMatchScores,
        statistics: basketballTeamMatchStatistics
      })
      .from(matches)
      .innerJoin(basketballMatchScores, eq(basketballMatchScores.matchId, matches.id))
      .leftJoin(basketballTeamMatchStatistics, and(eq(basketballTeamMatchStatistics.matchId, matches.id), eq(basketballTeamMatchStatistics.teamId, input.teamId)))
      .where(and(...conditions))
      .orderBy(desc(matches.scheduledStartAt))
      .limit(input.limit);

    if (!rows.length) {
      return [];
    }

    const periods = await this.db.select().from(basketballPeriodScores).where(
      inArray(
        basketballPeriodScores.matchId,
        rows.map((row) => row.match.id)
      )
    );

    return rows.map((row) => ({
      ...row,
      periods: periods.filter((period) => period.matchId === row.match.id)
    }));
  }

  async listTeamIdsForCompetitionSeason(competitionId: string, seasonId: string) {
    const rows = await this.db
      .select({
        homeTeamId: matches.homeTeamId,
        awayTeamId: matches.awayTeamId
      })
      .from(matches)
      .where(and(eq(matches.competitionId, competitionId), eq(matches.seasonId, seasonId), inArray(matches.status, ["finished", "after_extra_time", "after_penalties"] satisfies MatchStatus[])));

    return [...new Set(rows.flatMap((row) => [row.homeTeamId, row.awayTeamId]))];
  }
}

function toPlayerValues(input: UpsertPlayerInput) {
  return {
    sportId: input.sportId,
    countryId: input.nationalityCountryId,
    currentTeamId: input.currentTeamId,
    name: input.name,
    shortName: input.shortName,
    slug: input.slug,
    dateOfBirth: input.dateOfBirth,
    age: input.age,
    heightCm: input.heightCm,
    weightKg: input.weightKg,
    preferredFoot: input.preferredFoot,
    position: input.position,
    jerseyNumber: input.jerseyNumber,
    marketValue: input.marketValue,
    contractUntil: input.contractUntil,
    photoUrl: input.photoUrl,
    metadataJson: input.metadataJson ?? {}
  };
}
