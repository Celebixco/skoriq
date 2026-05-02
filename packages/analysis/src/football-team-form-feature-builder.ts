import type { FootballTeamFormScope, MatchStatus } from "@sports-data/shared";
import type { AnalysisFeatureBuilder, AnalysisFeatureBuildRequest, AnalysisFeatureBuildResult } from "./feature-builder.js";

const DEFAULT_WINDOWS = [5, 10] as const;
const DEFAULT_SCOPES: readonly FootballTeamFormScope[] = ["overall", "home", "away"];
const FINAL_STATUSES: readonly MatchStatus[] = ["finished", "after_extra_time", "after_penalties"];

export interface FootballTeamFormMatch {
  id: string;
  competitionId: string;
  seasonId?: string | null;
  scheduledStartAt: Date;
  status: MatchStatus;
  homeTeamId: string;
  awayTeamId: string;
}

export interface FootballTeamFormScore {
  homeScoreCurrent?: number | null;
  awayScoreCurrent?: number | null;
  homeScoreHalftime?: number | null;
  awayScoreHalftime?: number | null;
  homeScoreFulltime?: number | null;
  awayScoreFulltime?: number | null;
  status?: MatchStatus | null;
}

export interface FootballTeamFormStatistics {
  shotsTotal?: number | null;
  shotsOnTarget?: number | null;
  possessionPercent?: number | null;
  corners?: number | null;
  yellowCards?: number | null;
  redCards?: number | null;
  fouls?: number | null;
  expectedGoals?: number | null;
  dangerousAttacks?: number | null;
}

export interface FootballTeamFormStanding {
  position: number;
  points: number;
  goalDifference: number;
}

export interface FootballTeamFormSourceRow {
  match: FootballTeamFormMatch;
  score: FootballTeamFormScore;
  statistics?: FootballTeamFormStatistics | null;
}

export interface ListFootballTeamFormMatchesInput {
  teamId: string;
  asOfDate: Date;
  scope: FootballTeamFormScope;
  limit: number;
  competitionId?: string;
  seasonId?: string | null;
  includeMatchId?: string;
}

export interface FootballTeamFormFeatureInput {
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

export interface FootballTeamFormFeatureRepository {
  upsertFeature(input: FootballTeamFormFeatureInput): Promise<unknown>;
}

export interface FootballTeamFormSourceRepository {
  findMatchById(matchId: string): Promise<FootballTeamFormMatch | undefined>;
  findStandingForTeam(teamId: string, competitionId?: string, seasonId?: string | null): Promise<FootballTeamFormStanding | undefined>;
  listFinalMatchesForTeamBefore(input: ListFootballTeamFormMatchesInput): Promise<FootballTeamFormSourceRow[]>;
  listTeamIdsForCompetitionSeason?(competitionId: string, seasonId: string | null): Promise<string[]>;
}

export interface FootballTeamFormFeatureBuilderRepositories {
  features: FootballTeamFormFeatureRepository;
  sources: FootballTeamFormSourceRepository;
}

export interface BuildFootballTeamFormOptions {
  asOfDate?: Date;
  asOfMatchId?: string;
  competitionId?: string;
  seasonId?: string | null;
  windowSizes?: readonly number[];
  scopes?: readonly FootballTeamFormScope[];
  includeMatchId?: string;
}

export class FootballTeamFormFeatureBuilder implements AnalysisFeatureBuilder {
  constructor(private readonly repositories: FootballTeamFormFeatureBuilderRepositories) {}

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

  async buildForTeam(teamId: string, options: BuildFootballTeamFormOptions = {}): Promise<AnalysisFeatureBuildResult> {
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
        const feature = calculateFootballTeamFormFeature({
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

  async buildForMatch(matchId: string, options: Pick<BuildFootballTeamFormOptions, "windowSizes" | "scopes"> = {}): Promise<AnalysisFeatureBuildResult> {
    const match = await this.repositories.sources.findMatchById(matchId);
    if (!match) {
      return { changedFeatureRows: 0, skippedReason: `match "${matchId}" not found` };
    }

    const homeResult = await this.buildForTeam(match.homeTeamId, {
      asOfDate: match.scheduledStartAt,
      asOfMatchId: match.id,
      competitionId: match.competitionId,
      seasonId: match.seasonId ?? undefined,
      windowSizes: options.windowSizes,
      scopes: options.scopes
    });
    const awayResult = await this.buildForTeam(match.awayTeamId, {
      asOfDate: match.scheduledStartAt,
      asOfMatchId: match.id,
      competitionId: match.competitionId,
      seasonId: match.seasonId ?? undefined,
      windowSizes: options.windowSizes,
      scopes: options.scopes
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

  async buildForCompetitionSeason(
    competitionId: string,
    seasonId: string | null,
    options: Pick<BuildFootballTeamFormOptions, "windowSizes" | "scopes"> = {}
  ): Promise<AnalysisFeatureBuildResult> {
    if (!this.repositories.sources.listTeamIdsForCompetitionSeason) {
      return { changedFeatureRows: 0, skippedReason: "competition-season team listing is not available" };
    }

    const teamIds = await this.repositories.sources.listTeamIdsForCompetitionSeason(competitionId, seasonId);
    let changedFeatureRows = 0;

    for (const teamId of teamIds) {
      const result = await this.buildForTeam(teamId, {
        competitionId,
        seasonId,
        windowSizes: options.windowSizes,
        scopes: options.scopes
      });
      changedFeatureRows += result.changedFeatureRows;
    }

    return { changedFeatureRows };
  }
}

export interface CalculateFootballTeamFormFeatureInput {
  teamId: string;
  competitionId?: string;
  seasonId?: string | null;
  asOfMatchId?: string;
  asOfDate: Date;
  windowSize: number;
  scope: FootballTeamFormScope;
  sourceRows: FootballTeamFormSourceRow[];
  standing?: FootballTeamFormStanding;
}

export function calculateFootballTeamFormFeature(input: CalculateFootballTeamFormFeatureInput): FootballTeamFormFeatureInput {
  const totals = {
    wins: 0,
    draws: 0,
    losses: 0,
    points: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    cleanSheets: 0,
    failedToScore: 0,
    bothTeamsToScore: 0,
    over05: 0,
    over15: 0,
    over25: 0,
    over35: 0,
    under25: 0,
    scored: 0,
    conceded: 0,
    teamOver05: 0,
    teamOver15: 0,
    firstHalfOver05: 0,
    firstHalfGoalsFor: 0,
    firstHalfGoalsAgainst: 0,
    firstHalfSampleSize: 0
  };
  const stats: Record<"shots" | "shotsOnTarget" | "possession" | "corners" | "yellowCards" | "redCards" | "fouls" | "expectedGoals" | "dangerousAttacks", number[]> = {
    shots: [],
    shotsOnTarget: [],
    possession: [],
    corners: [],
    yellowCards: [],
    redCards: [],
    fouls: [],
    expectedGoals: [],
    dangerousAttacks: []
  };

  const includedMatchIds: string[] = [];

  for (const row of input.sourceRows) {
    const score = resolveTeamScore(input.teamId, row);
    if (!score) {
      continue;
    }

    includedMatchIds.push(row.match.id);
    totals.goalsFor += score.goalsFor;
    totals.goalsAgainst += score.goalsAgainst;

    if (score.goalsFor > score.goalsAgainst) {
      totals.wins += 1;
      totals.points += 3;
    } else if (score.goalsFor === score.goalsAgainst) {
      totals.draws += 1;
      totals.points += 1;
    } else {
      totals.losses += 1;
    }

    if (score.goalsAgainst === 0) totals.cleanSheets += 1;
    if (score.goalsFor === 0) totals.failedToScore += 1;
    if (score.goalsFor > 0 && score.goalsAgainst > 0) totals.bothTeamsToScore += 1;
    if (score.goalsFor > 0) totals.scored += 1;
    if (score.goalsAgainst > 0) totals.conceded += 1;
    if (score.goalsFor > 0) totals.teamOver05 += 1;
    if (score.goalsFor >= 2) totals.teamOver15 += 1;

    const totalGoals = score.goalsFor + score.goalsAgainst;
    if (totalGoals >= 1) totals.over05 += 1;
    if (totalGoals > 1.5) totals.over15 += 1;
    if (totalGoals > 2.5) totals.over25 += 1;
    if (totalGoals > 3.5) totals.over35 += 1;
    if (totalGoals < 3) totals.under25 += 1;

    const halftimeScore = resolveTeamHalftimeScore(input.teamId, row);
    if (halftimeScore) {
      totals.firstHalfSampleSize += 1;
      totals.firstHalfGoalsFor += halftimeScore.goalsFor;
      totals.firstHalfGoalsAgainst += halftimeScore.goalsAgainst;
      if (halftimeScore.goalsFor + halftimeScore.goalsAgainst >= 1) {
        totals.firstHalfOver05 += 1;
      }
    }

    pushIfNumber(stats.shots, row.statistics?.shotsTotal);
    pushIfNumber(stats.shotsOnTarget, row.statistics?.shotsOnTarget);
    pushIfNumber(stats.possession, row.statistics?.possessionPercent);
    pushIfNumber(stats.corners, row.statistics?.corners);
    pushIfNumber(stats.yellowCards, row.statistics?.yellowCards);
    pushIfNumber(stats.redCards, row.statistics?.redCards);
    pushIfNumber(stats.fouls, row.statistics?.fouls);
    pushIfNumber(stats.expectedGoals, row.statistics?.expectedGoals);
    pushIfNumber(stats.dangerousAttacks, row.statistics?.dangerousAttacks);
  }

  const sampleSize = includedMatchIds.length;
  const metadataJson = {
    builder: "football_team_form_features",
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
    draws: totals.draws,
    losses: totals.losses,
    points: totals.points,
    goalsFor: totals.goalsFor,
    goalsAgainst: totals.goalsAgainst,
    goalDifference: totals.goalsFor - totals.goalsAgainst,
    avgGoalsFor: sampleSize ? round(totals.goalsFor / sampleSize, 3) : undefined,
    avgGoalsAgainst: sampleSize ? round(totals.goalsAgainst / sampleSize, 3) : undefined,
    cleanSheetRate: percentage(totals.cleanSheets, sampleSize),
    failedToScoreRate: percentage(totals.failedToScore, sampleSize),
    bothTeamsToScoreRate: percentage(totals.bothTeamsToScore, sampleSize),
    over05Rate: percentage(totals.over05, sampleSize),
    over15Rate: percentage(totals.over15, sampleSize),
    over25Rate: percentage(totals.over25, sampleSize),
    over35Rate: percentage(totals.over35, sampleSize),
    under25Rate: percentage(totals.under25, sampleSize),
    scoredRate: percentage(totals.scored, sampleSize),
    concededRate: percentage(totals.conceded, sampleSize),
    teamOver05Rate: percentage(totals.teamOver05, sampleSize),
    teamOver15Rate: percentage(totals.teamOver15, sampleSize),
    firstHalfOver05Rate: percentage(totals.firstHalfOver05, totals.firstHalfSampleSize),
    firstHalfAvgGoalsFor: totals.firstHalfSampleSize ? round(totals.firstHalfGoalsFor / totals.firstHalfSampleSize, 3) : undefined,
    firstHalfAvgGoalsAgainst: totals.firstHalfSampleSize ? round(totals.firstHalfGoalsAgainst / totals.firstHalfSampleSize, 3) : undefined,
    avgShots: average(stats.shots),
    avgShotsOnTarget: average(stats.shotsOnTarget),
    avgPossessionPercent: average(stats.possession, 2),
    avgCorners: average(stats.corners),
    avgYellowCards: average(stats.yellowCards),
    avgRedCards: average(stats.redCards),
    avgFouls: average(stats.fouls),
    avgExpectedGoals: average(stats.expectedGoals),
    avgDangerousAttacks: average(stats.dangerousAttacks),
    standingsPosition: input.standing?.position,
    standingsPoints: input.standing?.points,
    standingsGoalDifference: input.standing?.goalDifference,
    sampleSize,
    coverageScore: calculateCoverageScore(sampleSize, input.windowSize, stats, input.standing),
    metadataJson
  };
}

function resolveTeamScore(teamId: string, row: FootballTeamFormSourceRow): { goalsFor: number; goalsAgainst: number } | undefined {
  const homeScore = row.score.homeScoreFulltime ?? (row.score.status && isFinalStatus(row.score.status) ? row.score.homeScoreCurrent : undefined);
  const awayScore = row.score.awayScoreFulltime ?? (row.score.status && isFinalStatus(row.score.status) ? row.score.awayScoreCurrent : undefined);

  if (homeScore === undefined || awayScore === undefined || homeScore === null || awayScore === null) {
    return undefined;
  }

  if (row.match.homeTeamId === teamId) {
    return { goalsFor: homeScore, goalsAgainst: awayScore };
  }

  if (row.match.awayTeamId === teamId) {
    return { goalsFor: awayScore, goalsAgainst: homeScore };
  }

  return undefined;
}

function resolveTeamHalftimeScore(teamId: string, row: FootballTeamFormSourceRow): { goalsFor: number; goalsAgainst: number } | undefined {
  const homeScore = row.score.homeScoreHalftime;
  const awayScore = row.score.awayScoreHalftime;

  if (homeScore === undefined || awayScore === undefined || homeScore === null || awayScore === null) {
    return undefined;
  }

  if (row.match.homeTeamId === teamId) {
    return { goalsFor: homeScore, goalsAgainst: awayScore };
  }

  if (row.match.awayTeamId === teamId) {
    return { goalsFor: awayScore, goalsAgainst: homeScore };
  }

  return undefined;
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

function calculateCoverageScore(
  sampleSize: number,
  windowSize: number,
  stats: Record<"shots" | "shotsOnTarget" | "possession" | "corners" | "yellowCards" | "redCards" | "fouls" | "expectedGoals" | "dangerousAttacks", number[]>,
  standing?: FootballTeamFormStanding
): number {
  if (!sampleSize) {
    return 0;
  }

  const scoreCoverage = Math.min(sampleSize / windowSize, 1) * 60;
  const statFields = Object.values(stats);
  const statCoverage = statFields.length ? (statFields.reduce((sum, values) => sum + Math.min(values.length / sampleSize, 1), 0) / statFields.length) * 30 : 0;
  const standingCoverage = standing ? 10 : 0;

  return Math.min(100, round(scoreCoverage + statCoverage + standingCoverage, 2));
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
