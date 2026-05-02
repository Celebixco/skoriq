import type { BasketballPeriodType, BasketballTeamFormScope, MatchStatus } from "@sports-data/shared";
import type { AnalysisFeatureBuilder, AnalysisFeatureBuildRequest, AnalysisFeatureBuildResult } from "./feature-builder.js";

const DEFAULT_WINDOWS = [5, 10] as const;
const DEFAULT_SCOPES: readonly BasketballTeamFormScope[] = ["overall", "home", "away"];
const FINAL_STATUSES: readonly MatchStatus[] = ["finished", "after_extra_time", "after_penalties"];

export interface BasketballTeamFormMatch {
  id: string;
  competitionId: string;
  seasonId?: string | null;
  scheduledStartAt: Date;
  status: MatchStatus;
  homeTeamId: string;
  awayTeamId: string;
}

export interface BasketballTeamFormScore {
  homeScoreCurrent?: number | null;
  awayScoreCurrent?: number | null;
  homeScoreFinal?: number | null;
  awayScoreFinal?: number | null;
  status?: MatchStatus | null;
}

export interface BasketballTeamFormPeriodScore {
  periodType: BasketballPeriodType;
  periodNumber: number;
  overtimeNumber?: number | null;
  homeScore: number;
  awayScore: number;
}

export interface BasketballTeamFormStatistics {
  fieldGoalPercent?: number | null;
  threePointPercent?: number | null;
  freeThrowPercent?: number | null;
  reboundsTotal?: number | null;
  reboundsOffensive?: number | null;
  reboundsDefensive?: number | null;
  assists?: number | null;
  steals?: number | null;
  blocks?: number | null;
  turnovers?: number | null;
  personalFouls?: number | null;
  fastBreakPoints?: number | null;
  pointsInPaint?: number | null;
  secondChancePoints?: number | null;
  benchPoints?: number | null;
}

export interface BasketballTeamFormStanding {
  position: number;
  winPercentage?: number | null;
  pointDifference?: number | null;
  streak?: string | null;
}

export interface BasketballTeamFormSourceRow {
  match: BasketballTeamFormMatch;
  score: BasketballTeamFormScore;
  periods?: BasketballTeamFormPeriodScore[];
  statistics?: BasketballTeamFormStatistics | null;
}

export interface ListBasketballTeamFormMatchesInput {
  teamId: string;
  asOfDate: Date;
  scope: BasketballTeamFormScope;
  limit: number;
  competitionId?: string;
  seasonId?: string;
  includeMatchId?: string;
}

export interface BasketballTeamFormFeatureInput {
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

export interface BasketballTeamFormFeatureRepository {
  upsertFeature(input: BasketballTeamFormFeatureInput): Promise<unknown>;
}

export interface BasketballTeamFormSourceRepository {
  findMatchById(matchId: string): Promise<BasketballTeamFormMatch | undefined>;
  findStandingForTeam(teamId: string, competitionId?: string, seasonId?: string): Promise<BasketballTeamFormStanding | undefined>;
  listFinalMatchesForTeamBefore(input: ListBasketballTeamFormMatchesInput): Promise<BasketballTeamFormSourceRow[]>;
  listTeamIdsForCompetitionSeason?(competitionId: string, seasonId: string): Promise<string[]>;
}

export interface BasketballTeamFormFeatureBuilderRepositories {
  features: BasketballTeamFormFeatureRepository;
  sources: BasketballTeamFormSourceRepository;
}

export interface BuildBasketballTeamFormOptions {
  asOfDate?: Date;
  asOfMatchId?: string;
  competitionId?: string;
  seasonId?: string;
  windowSizes?: readonly number[];
  scopes?: readonly BasketballTeamFormScope[];
  includeMatchId?: string;
}

export class BasketballTeamFormFeatureBuilder implements AnalysisFeatureBuilder {
  constructor(private readonly repositories: BasketballTeamFormFeatureBuilderRepositories) {}

  async build(request: AnalysisFeatureBuildRequest): Promise<AnalysisFeatureBuildResult> {
    if (request.matchId) {
      return this.buildForMatch(request.matchId);
    }

    if (request.teamId) {
      return this.buildForTeam(request.teamId, {
        competitionId: request.competitionId,
        seasonId: request.seasonId
      });
    }

    if (request.competitionId && request.seasonId) {
      return this.buildForCompetitionSeason(request.competitionId, request.seasonId);
    }

    return { changedFeatureRows: 0, skippedReason: "matchId, teamId, or competitionId+seasonId is required" };
  }

  async buildForTeam(teamId: string, options: BuildBasketballTeamFormOptions = {}): Promise<AnalysisFeatureBuildResult> {
    const asOfDate = options.asOfDate ?? new Date();
    const windowSizes = options.windowSizes ?? DEFAULT_WINDOWS;
    const scopes = options.scopes ?? DEFAULT_SCOPES;
    const standing = await this.repositories.sources.findStandingForTeam(teamId, options.competitionId, options.seasonId);
    let changedFeatureRows = 0;

    for (const windowSize of windowSizes) {
      for (const scope of scopes) {
        const sourceRows = await this.repositories.sources.listFinalMatchesForTeamBefore({
          teamId,
          asOfDate,
          scope,
          limit: windowSize,
          competitionId: options.competitionId,
          seasonId: options.seasonId,
          includeMatchId: options.includeMatchId
        });
        const feature = calculateBasketballTeamFormFeature({
          teamId,
          competitionId: options.competitionId,
          seasonId: options.seasonId,
          asOfMatchId: options.asOfMatchId,
          asOfDate,
          windowSize,
          scope,
          sourceRows,
          standing
        });

        await this.repositories.features.upsertFeature(feature);
        changedFeatureRows += 1;
      }
    }

    return { changedFeatureRows };
  }

  async buildForMatch(matchId: string): Promise<AnalysisFeatureBuildResult> {
    const match = await this.repositories.sources.findMatchById(matchId);
    if (!match) {
      return { changedFeatureRows: 0, skippedReason: `match "${matchId}" not found` };
    }

    const homeResult = await this.buildForTeam(match.homeTeamId, {
      asOfDate: match.scheduledStartAt,
      asOfMatchId: match.id,
      competitionId: match.competitionId,
      seasonId: match.seasonId ?? undefined
    });
    const awayResult = await this.buildForTeam(match.awayTeamId, {
      asOfDate: match.scheduledStartAt,
      asOfMatchId: match.id,
      competitionId: match.competitionId,
      seasonId: match.seasonId ?? undefined
    });

    return { changedFeatureRows: homeResult.changedFeatureRows + awayResult.changedFeatureRows };
  }

  async rebuildAfterMatch(matchId: string): Promise<AnalysisFeatureBuildResult> {
    const match = await this.repositories.sources.findMatchById(matchId);
    if (!match) {
      return { changedFeatureRows: 0, skippedReason: `match "${matchId}" not found` };
    }

    if (!isFinalStatus(match.status)) {
      return { changedFeatureRows: 0, skippedReason: `match "${matchId}" is not final` };
    }

    const homeResult = await this.buildForTeam(match.homeTeamId, {
      asOfDate: match.scheduledStartAt,
      asOfMatchId: match.id,
      competitionId: match.competitionId,
      seasonId: match.seasonId ?? undefined,
      includeMatchId: match.id
    });
    const awayResult = await this.buildForTeam(match.awayTeamId, {
      asOfDate: match.scheduledStartAt,
      asOfMatchId: match.id,
      competitionId: match.competitionId,
      seasonId: match.seasonId ?? undefined,
      includeMatchId: match.id
    });

    return { changedFeatureRows: homeResult.changedFeatureRows + awayResult.changedFeatureRows };
  }

  async buildForCompetitionSeason(competitionId: string, seasonId: string): Promise<AnalysisFeatureBuildResult> {
    if (!this.repositories.sources.listTeamIdsForCompetitionSeason) {
      return { changedFeatureRows: 0, skippedReason: "competition-season team listing is not available" };
    }

    const teamIds = await this.repositories.sources.listTeamIdsForCompetitionSeason(competitionId, seasonId);
    let changedFeatureRows = 0;

    for (const teamId of teamIds) {
      const result = await this.buildForTeam(teamId, { competitionId, seasonId });
      changedFeatureRows += result.changedFeatureRows;
    }

    return { changedFeatureRows };
  }
}

export interface CalculateBasketballTeamFormFeatureInput {
  teamId: string;
  competitionId?: string;
  seasonId?: string;
  asOfMatchId?: string;
  asOfDate: Date;
  windowSize: number;
  scope: BasketballTeamFormScope;
  sourceRows: BasketballTeamFormSourceRow[];
  standing?: BasketballTeamFormStanding;
}

export function calculateBasketballTeamFormFeature(input: CalculateBasketballTeamFormFeatureInput): BasketballTeamFormFeatureInput {
  const totals = {
    wins: 0,
    losses: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    margin: 0,
    over1505: 0,
    over1605: 0,
    over1705: 0,
    over1805: 0
  };
  const periodStats = createPeriodStatBuckets();
  const stats = createTeamStatBuckets();
  const includedMatchIds: string[] = [];

  for (const row of input.sourceRows) {
    const score = resolveTeamScore(input.teamId, row);
    if (!score) {
      continue;
    }

    includedMatchIds.push(row.match.id);
    totals.pointsFor += score.pointsFor;
    totals.pointsAgainst += score.pointsAgainst;
    totals.margin += score.pointsFor - score.pointsAgainst;

    if (score.pointsFor > score.pointsAgainst) {
      totals.wins += 1;
    } else {
      totals.losses += 1;
    }

    const totalPoints = score.pointsFor + score.pointsAgainst;
    if (totalPoints > 150.5) totals.over1505 += 1;
    if (totalPoints > 160.5) totals.over1605 += 1;
    if (totalPoints > 170.5) totals.over1705 += 1;
    if (totalPoints > 180.5) totals.over1805 += 1;

    pushPeriodStats(input.teamId, row, periodStats);
    pushTeamStats(row.statistics, stats);
  }

  const sampleSize = includedMatchIds.length;
  const metadataJson = {
    builder: "basketball_team_form_features",
    calculationVersion: 1,
    includedMatchIds
  };

  return {
    teamId: input.teamId,
    competitionId: input.competitionId,
    seasonId: input.seasonId,
    asOfMatchId: input.asOfMatchId,
    asOfDate: input.asOfDate,
    windowSize: input.windowSize,
    scope: input.scope,
    matchesPlayed: sampleSize,
    wins: totals.wins,
    losses: totals.losses,
    pointsFor: totals.pointsFor,
    pointsAgainst: totals.pointsAgainst,
    pointDifference: totals.pointsFor - totals.pointsAgainst,
    avgPointsFor: sampleSize ? round(totals.pointsFor / sampleSize, 3) : undefined,
    avgPointsAgainst: sampleSize ? round(totals.pointsAgainst / sampleSize, 3) : undefined,
    avgTotalPoints: sampleSize ? round((totals.pointsFor + totals.pointsAgainst) / sampleSize, 3) : undefined,
    avgMargin: sampleSize ? round(totals.margin / sampleSize, 3) : undefined,
    over1505Rate: percentage(totals.over1505, sampleSize),
    over1605Rate: percentage(totals.over1605, sampleSize),
    over1705Rate: percentage(totals.over1705, sampleSize),
    over1805Rate: percentage(totals.over1805, sampleSize),
    avgQ1PointsFor: average(periodStats.q1For),
    avgQ1PointsAgainst: average(periodStats.q1Against),
    avgFirstHalfPointsFor: average(periodStats.firstHalfFor),
    avgFirstHalfPointsAgainst: average(periodStats.firstHalfAgainst),
    avgSecondHalfPointsFor: average(periodStats.secondHalfFor),
    avgSecondHalfPointsAgainst: average(periodStats.secondHalfAgainst),
    avgQ4PointsFor: average(periodStats.q4For),
    avgQ4PointsAgainst: average(periodStats.q4Against),
    avgFieldGoalPercent: average(stats.fieldGoalPercent, 2),
    avgThreePointPercent: average(stats.threePointPercent, 2),
    avgFreeThrowPercent: average(stats.freeThrowPercent, 2),
    avgReboundsTotal: average(stats.reboundsTotal),
    avgReboundsOffensive: average(stats.reboundsOffensive),
    avgReboundsDefensive: average(stats.reboundsDefensive),
    avgAssists: average(stats.assists),
    avgSteals: average(stats.steals),
    avgBlocks: average(stats.blocks),
    avgTurnovers: average(stats.turnovers),
    avgPersonalFouls: average(stats.personalFouls),
    avgFastBreakPoints: average(stats.fastBreakPoints),
    avgPointsInPaint: average(stats.pointsInPaint),
    avgSecondChancePoints: average(stats.secondChancePoints),
    avgBenchPoints: average(stats.benchPoints),
    standingsPosition: input.standing?.position,
    standingsWinPercentage: input.standing?.winPercentage ?? undefined,
    standingsPointDifference: input.standing?.pointDifference ?? undefined,
    standingsStreak: input.standing?.streak ?? undefined,
    sampleSize,
    coverageScore: calculateCoverageScore(sampleSize, input.windowSize, periodStats, stats, input.standing),
    metadataJson
  };
}

function resolveTeamScore(teamId: string, row: BasketballTeamFormSourceRow): { pointsFor: number; pointsAgainst: number } | undefined {
  const homeScore = row.score.homeScoreFinal ?? (row.score.status && isFinalStatus(row.score.status) ? row.score.homeScoreCurrent : undefined);
  const awayScore = row.score.awayScoreFinal ?? (row.score.status && isFinalStatus(row.score.status) ? row.score.awayScoreCurrent : undefined);

  if (homeScore === undefined || awayScore === undefined || homeScore === null || awayScore === null) {
    return undefined;
  }

  if (row.match.homeTeamId === teamId) {
    return { pointsFor: homeScore, pointsAgainst: awayScore };
  }

  if (row.match.awayTeamId === teamId) {
    return { pointsFor: awayScore, pointsAgainst: homeScore };
  }

  return undefined;
}

function pushPeriodStats(teamId: string, row: BasketballTeamFormSourceRow, stats: PeriodStatBuckets): void {
  const q1 = resolvePeriodScore(teamId, row, "q1");
  const q2 = resolvePeriodScore(teamId, row, "q2");
  const q3 = resolvePeriodScore(teamId, row, "q3");
  const q4 = resolvePeriodScore(teamId, row, "q4");

  if (q1) {
    stats.q1For.push(q1.pointsFor);
    stats.q1Against.push(q1.pointsAgainst);
  }

  if (q1 && q2) {
    stats.firstHalfFor.push(q1.pointsFor + q2.pointsFor);
    stats.firstHalfAgainst.push(q1.pointsAgainst + q2.pointsAgainst);
  }

  if (q3 && q4) {
    stats.secondHalfFor.push(q3.pointsFor + q4.pointsFor);
    stats.secondHalfAgainst.push(q3.pointsAgainst + q4.pointsAgainst);
  }

  if (q4) {
    stats.q4For.push(q4.pointsFor);
    stats.q4Against.push(q4.pointsAgainst);
  }
}

function resolvePeriodScore(teamId: string, row: BasketballTeamFormSourceRow, periodType: BasketballPeriodType): { pointsFor: number; pointsAgainst: number } | undefined {
  const period = row.periods?.find((candidate) => candidate.periodType === periodType);
  if (!period) {
    return undefined;
  }

  if (row.match.homeTeamId === teamId) {
    return { pointsFor: period.homeScore, pointsAgainst: period.awayScore };
  }

  if (row.match.awayTeamId === teamId) {
    return { pointsFor: period.awayScore, pointsAgainst: period.homeScore };
  }

  return undefined;
}

function pushTeamStats(statistics: BasketballTeamFormStatistics | null | undefined, stats: TeamStatBuckets): void {
  pushIfNumber(stats.fieldGoalPercent, statistics?.fieldGoalPercent);
  pushIfNumber(stats.threePointPercent, statistics?.threePointPercent);
  pushIfNumber(stats.freeThrowPercent, statistics?.freeThrowPercent);
  pushIfNumber(stats.reboundsTotal, statistics?.reboundsTotal);
  pushIfNumber(stats.reboundsOffensive, statistics?.reboundsOffensive);
  pushIfNumber(stats.reboundsDefensive, statistics?.reboundsDefensive);
  pushIfNumber(stats.assists, statistics?.assists);
  pushIfNumber(stats.steals, statistics?.steals);
  pushIfNumber(stats.blocks, statistics?.blocks);
  pushIfNumber(stats.turnovers, statistics?.turnovers);
  pushIfNumber(stats.personalFouls, statistics?.personalFouls);
  pushIfNumber(stats.fastBreakPoints, statistics?.fastBreakPoints);
  pushIfNumber(stats.pointsInPaint, statistics?.pointsInPaint);
  pushIfNumber(stats.secondChancePoints, statistics?.secondChancePoints);
  pushIfNumber(stats.benchPoints, statistics?.benchPoints);
}

function isFinalStatus(status: MatchStatus): boolean {
  return FINAL_STATUSES.includes(status);
}

function pushIfNumber(values: number[], value: number | null | undefined): void {
  if (typeof value === "number" && Number.isFinite(value)) {
    values.push(value);
  }
}

function average(values: number[], decimals = 3): number | undefined {
  if (!values.length) {
    return undefined;
  }

  return round(values.reduce((sum, value) => sum + value, 0) / values.length, decimals);
}

function percentage(numerator: number, denominator: number): number | undefined {
  if (!denominator) {
    return undefined;
  }

  return round((numerator / denominator) * 100, 2);
}

function calculateCoverageScore(sampleSize: number, windowSize: number, periodStats: PeriodStatBuckets, teamStats: TeamStatBuckets, standing?: BasketballTeamFormStanding): number {
  if (!sampleSize) {
    return 0;
  }

  const scoreCoverage = Math.min(sampleSize / windowSize, 1) * 60;
  const periodFields = Object.values(periodStats);
  const periodCoverage = periodFields.length ? (periodFields.reduce((sum, values) => sum + Math.min(values.length / sampleSize, 1), 0) / periodFields.length) * 15 : 0;
  const statFields = Object.values(teamStats);
  const statCoverage = statFields.length ? (statFields.reduce((sum, values) => sum + Math.min(values.length / sampleSize, 1), 0) / statFields.length) * 15 : 0;
  const standingCoverage = standing ? 10 : 0;

  return Math.min(100, round(scoreCoverage + periodCoverage + statCoverage + standingCoverage, 2));
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

type PeriodStatBuckets = ReturnType<typeof createPeriodStatBuckets>;

function createPeriodStatBuckets() {
  return {
    q1For: [] as number[],
    q1Against: [] as number[],
    firstHalfFor: [] as number[],
    firstHalfAgainst: [] as number[],
    secondHalfFor: [] as number[],
    secondHalfAgainst: [] as number[],
    q4For: [] as number[],
    q4Against: [] as number[]
  };
}

type TeamStatBuckets = ReturnType<typeof createTeamStatBuckets>;

function createTeamStatBuckets() {
  return {
    fieldGoalPercent: [] as number[],
    threePointPercent: [] as number[],
    freeThrowPercent: [] as number[],
    reboundsTotal: [] as number[],
    reboundsOffensive: [] as number[],
    reboundsDefensive: [] as number[],
    assists: [] as number[],
    steals: [] as number[],
    blocks: [] as number[],
    turnovers: [] as number[],
    personalFouls: [] as number[],
    fastBreakPoints: [] as number[],
    pointsInPaint: [] as number[],
    secondChancePoints: [] as number[],
    benchPoints: [] as number[]
  };
}
