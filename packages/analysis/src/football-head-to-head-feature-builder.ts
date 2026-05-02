import type { MatchStatus } from "@sports-data/shared";
import type { AnalysisFeatureBuilder, AnalysisFeatureBuildRequest, AnalysisFeatureBuildResult } from "./feature-builder.js";

const DEFAULT_WINDOWS = [5, 10] as const;
const FINAL_STATUSES: readonly MatchStatus[] = ["finished", "after_extra_time", "after_penalties"];

export interface FootballHeadToHeadMatch {
  id: string;
  competitionId: string;
  seasonId?: string | null;
  scheduledStartAt: Date;
  status: MatchStatus;
  homeTeamId: string;
  awayTeamId: string;
}

export interface FootballHeadToHeadScore {
  homeScoreCurrent?: number | null;
  awayScoreCurrent?: number | null;
  homeScoreFulltime?: number | null;
  awayScoreFulltime?: number | null;
  status?: MatchStatus | null;
}

export interface FootballHeadToHeadSourceRow {
  match: FootballHeadToHeadMatch;
  score: FootballHeadToHeadScore;
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

export interface FootballHeadToHeadFeatureInput {
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

export interface FootballHeadToHeadFeatureRepository {
  upsertFeature(input: FootballHeadToHeadFeatureInput): Promise<unknown>;
}

export interface FootballHeadToHeadSourceRepository {
  findMatchById(matchId: string): Promise<FootballHeadToHeadMatch | undefined>;
  listFinalMatchesForPairBefore(input: ListFootballHeadToHeadMatchesInput): Promise<FootballHeadToHeadSourceRow[]>;
  listPairIdsForCompetitionSeason?(competitionId: string, seasonId: string | null): Promise<Array<{ teamAId: string; teamBId: string }>>;
}

export interface FootballHeadToHeadFeatureBuilderRepositories {
  features: FootballHeadToHeadFeatureRepository;
  sources: FootballHeadToHeadSourceRepository;
}

export interface BuildFootballHeadToHeadOptions {
  asOfDate?: Date;
  asOfMatchId?: string;
  competitionId?: string;
  seasonId?: string | null;
  windowSizes?: readonly number[];
  includeMatchId?: string;
}

export class FootballHeadToHeadFeatureBuilder implements AnalysisFeatureBuilder {
  constructor(private readonly repositories: FootballHeadToHeadFeatureBuilderRepositories) {}

  async build(request: AnalysisFeatureBuildRequest): Promise<AnalysisFeatureBuildResult> {
    if (request.matchId) {
      return this.buildForMatch(request.matchId);
    }

    if (request.teamId) {
      return { changedFeatureRows: 0, skippedReason: "teamId alone is not supported for football head-to-head features" };
    }

    if (request.competitionId && request.seasonId) {
      return this.buildForCompetitionSeason(request.competitionId, request.seasonId);
    }

    return { changedFeatureRows: 0, skippedReason: "matchId, pair, or competitionId+seasonId is required" };
  }

  async buildForPair(teamAId: string, teamBId: string, options: BuildFootballHeadToHeadOptions = {}): Promise<AnalysisFeatureBuildResult> {
    const pair = canonicalizePair(teamAId, teamBId);
    const asOfDate = options.asOfDate ?? new Date();
    const windowSizes = options.windowSizes ?? DEFAULT_WINDOWS;
    let changedFeatureRows = 0;

    for (const windowSize of windowSizes) {
      const sourceRows = await this.repositories.sources.listFinalMatchesForPairBefore({
        teamAId: pair.teamAId,
        teamBId: pair.teamBId,
        asOfDate,
        limit: windowSize,
        competitionId: options.competitionId,
        seasonId: options.seasonId,
        includeMatchId: options.includeMatchId
      });
      const feature = calculateFootballHeadToHeadFeature({
        teamAId: pair.teamAId,
        teamBId: pair.teamBId,
        competitionId: options.competitionId,
        seasonId: options.seasonId,
        asOfMatchId: options.asOfMatchId,
        asOfDate,
        windowSize,
        sourceRows
      });

      await this.repositories.features.upsertFeature(feature);
      changedFeatureRows += 1;
    }

    return { changedFeatureRows };
  }

  async buildForMatch(matchId: string, options: Pick<BuildFootballHeadToHeadOptions, "windowSizes"> = {}): Promise<AnalysisFeatureBuildResult> {
    const match = await this.repositories.sources.findMatchById(matchId);
    if (!match) {
      return { changedFeatureRows: 0, skippedReason: `match "${matchId}" not found` };
    }

    return this.buildForPair(match.homeTeamId, match.awayTeamId, {
      asOfDate: match.scheduledStartAt,
      asOfMatchId: match.id,
      competitionId: match.competitionId,
      seasonId: match.seasonId ?? null,
      windowSizes: options.windowSizes
    });
  }

  async rebuildAfterMatch(matchId: string): Promise<AnalysisFeatureBuildResult> {
    const match = await this.repositories.sources.findMatchById(matchId);
    if (!match) {
      return { changedFeatureRows: 0, skippedReason: `match "${matchId}" not found` };
    }

    if (!isFinalStatus(match.status)) {
      return { changedFeatureRows: 0, skippedReason: `match "${matchId}" is not final` };
    }

    return this.buildForPair(match.homeTeamId, match.awayTeamId, {
      asOfDate: match.scheduledStartAt,
      asOfMatchId: match.id,
      competitionId: match.competitionId,
      seasonId: match.seasonId ?? null,
      includeMatchId: match.id
    });
  }

  async buildForCompetitionSeason(
    competitionId: string,
    seasonId: string | null,
    options: Pick<BuildFootballHeadToHeadOptions, "windowSizes"> = {}
  ): Promise<AnalysisFeatureBuildResult> {
    if (!this.repositories.sources.listPairIdsForCompetitionSeason) {
      return { changedFeatureRows: 0, skippedReason: "competition-season pair listing is not available" };
    }

    const pairs = await this.repositories.sources.listPairIdsForCompetitionSeason(competitionId, seasonId);
    let changedFeatureRows = 0;

    for (const pair of pairs) {
      const result = await this.buildForPair(pair.teamAId, pair.teamBId, {
        competitionId,
        seasonId,
        windowSizes: options.windowSizes
      });
      changedFeatureRows += result.changedFeatureRows;
    }

    return { changedFeatureRows };
  }
}

export interface CalculateFootballHeadToHeadFeatureInput {
  teamAId: string;
  teamBId: string;
  competitionId?: string;
  seasonId?: string | null;
  asOfMatchId?: string;
  asOfDate: Date;
  windowSize: number;
  sourceRows: FootballHeadToHeadSourceRow[];
}

export function calculateFootballHeadToHeadFeature(input: CalculateFootballHeadToHeadFeatureInput): FootballHeadToHeadFeatureInput {
  const pair = canonicalizePair(input.teamAId, input.teamBId);
  const totals = {
    teamAWins: 0,
    teamBWins: 0,
    draws: 0,
    teamAGoalsFor: 0,
    teamBGoalsFor: 0,
    bothTeamsToScore: 0,
    over15: 0,
    over25: 0,
    over35: 0,
    teamAHomeMatches: 0,
    teamBHomeMatches: 0,
    teamAHomeWins: 0,
    teamBHomeWins: 0
  };
  const includedMatchIds: string[] = [];
  let lastMatch: { id: string; date: Date; teamAGoals: number; teamBGoals: number } | undefined;

  for (const row of input.sourceRows) {
    const score = resolvePairScore(pair.teamAId, pair.teamBId, row);
    if (!score) {
      continue;
    }

    includedMatchIds.push(row.match.id);
    if (!lastMatch) {
      lastMatch = {
        id: row.match.id,
        date: row.match.scheduledStartAt,
        teamAGoals: score.teamAGoals,
        teamBGoals: score.teamBGoals
      };
    }

    totals.teamAGoalsFor += score.teamAGoals;
    totals.teamBGoalsFor += score.teamBGoals;

    if (score.teamAGoals > score.teamBGoals) totals.teamAWins += 1;
    else if (score.teamBGoals > score.teamAGoals) totals.teamBWins += 1;
    else totals.draws += 1;

    if (row.match.homeTeamId === pair.teamAId) {
      totals.teamAHomeMatches += 1;
      if (score.teamAGoals > score.teamBGoals) totals.teamAHomeWins += 1;
    }
    if (row.match.homeTeamId === pair.teamBId) {
      totals.teamBHomeMatches += 1;
      if (score.teamBGoals > score.teamAGoals) totals.teamBHomeWins += 1;
    }

    const totalGoals = score.teamAGoals + score.teamBGoals;
    if (score.teamAGoals > 0 && score.teamBGoals > 0) totals.bothTeamsToScore += 1;
    if (totalGoals > 1.5) totals.over15 += 1;
    if (totalGoals > 2.5) totals.over25 += 1;
    if (totalGoals > 3.5) totals.over35 += 1;
  }

  const sampleSize = includedMatchIds.length;
  return {
    teamAId: pair.teamAId,
    teamBId: pair.teamBId,
    competitionId: input.competitionId,
    seasonId: input.seasonId,
    asOfMatchId: input.asOfMatchId,
    asOfDate: input.asOfDate,
    windowSize: input.windowSize,
    matchesPlayed: sampleSize,
    teamAWins: totals.teamAWins,
    teamBWins: totals.teamBWins,
    draws: totals.draws,
    teamAGoalsFor: totals.teamAGoalsFor,
    teamBGoalsFor: totals.teamBGoalsFor,
    avgTotalGoals: sampleSize ? round((totals.teamAGoalsFor + totals.teamBGoalsFor) / sampleSize, 3) : undefined,
    avgTeamAGoals: sampleSize ? round(totals.teamAGoalsFor / sampleSize, 3) : undefined,
    avgTeamBGoals: sampleSize ? round(totals.teamBGoalsFor / sampleSize, 3) : undefined,
    bothTeamsToScoreRate: percentage(totals.bothTeamsToScore, sampleSize),
    over15Rate: percentage(totals.over15, sampleSize),
    over25Rate: percentage(totals.over25, sampleSize),
    over35Rate: percentage(totals.over35, sampleSize),
    teamAHomeMatches: totals.teamAHomeMatches,
    teamBHomeMatches: totals.teamBHomeMatches,
    teamAHomeWins: totals.teamAHomeWins,
    teamBHomeWins: totals.teamBHomeWins,
    lastMatchId: lastMatch?.id,
    lastMatchDate: lastMatch?.date,
    lastMatchTeamAGoals: lastMatch?.teamAGoals,
    lastMatchTeamBGoals: lastMatch?.teamBGoals,
    sampleSize,
    coverageScore: calculateCoverageScore(sampleSize, input.windowSize, input.sourceRows.length),
    metadataJson: {
      builder: "football_head_to_head_features",
      calculationVersion: 1,
      canonicalPair: pair,
      includedMatchIds
    }
  };
}

export function canonicalizePair(teamAId: string, teamBId: string): { teamAId: string; teamBId: string } {
  if (teamAId === teamBId) {
    throw new Error("Football head-to-head features require two different teams.");
  }
  return teamAId.localeCompare(teamBId) <= 0 ? { teamAId, teamBId } : { teamAId: teamBId, teamBId: teamAId };
}

function resolvePairScore(teamAId: string, teamBId: string, row: FootballHeadToHeadSourceRow): { teamAGoals: number; teamBGoals: number } | undefined {
  const homeScore = row.score.homeScoreFulltime ?? (row.score.status && isFinalStatus(row.score.status) ? row.score.homeScoreCurrent : undefined);
  const awayScore = row.score.awayScoreFulltime ?? (row.score.status && isFinalStatus(row.score.status) ? row.score.awayScoreCurrent : undefined);

  if (homeScore === undefined || awayScore === undefined || homeScore === null || awayScore === null) {
    return undefined;
  }

  if (row.match.homeTeamId === teamAId && row.match.awayTeamId === teamBId) {
    return { teamAGoals: homeScore, teamBGoals: awayScore };
  }

  if (row.match.homeTeamId === teamBId && row.match.awayTeamId === teamAId) {
    return { teamAGoals: awayScore, teamBGoals: homeScore };
  }

  return undefined;
}

function isFinalStatus(status: MatchStatus): boolean {
  return FINAL_STATUSES.includes(status);
}

function percentage(count: number, total: number): number | undefined {
  return total ? round((count / total) * 100, 2) : undefined;
}

function calculateCoverageScore(sampleSize: number, windowSize: number, sourceRows: number): number {
  if (sampleSize === 0) return 0;
  const sampleCoverage = Math.min(sampleSize / windowSize, 1) * 80;
  const scoreCoverage = sourceRows ? (sampleSize / sourceRows) * 20 : 20;
  return round(Math.min(sampleCoverage + scoreCoverage, 100), 2);
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
