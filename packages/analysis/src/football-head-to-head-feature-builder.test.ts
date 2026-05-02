import { describe, expect, it } from "vitest";
import {
  FootballHeadToHeadFeatureBuilder,
  calculateFootballHeadToHeadFeature,
  canonicalizePair
} from "./football-head-to-head-feature-builder.js";
import type {
  FootballHeadToHeadFeatureInput,
  FootballHeadToHeadMatch,
  FootballHeadToHeadSourceRow,
  ListFootballHeadToHeadMatchesInput
} from "./football-head-to-head-feature-builder.js";

const teamAId = "00000000-0000-0000-0000-00000000000a";
const teamBId = "00000000-0000-0000-0000-00000000000b";
const teamCId = "00000000-0000-0000-0000-00000000000c";
const competitionId = "competition-1";
const seasonId = "season-1";
const asOfDate = new Date("2026-05-01T12:00:00.000Z");

describe("football head-to-head feature builder", () => {
  it("canonical pair ordering prevents duplicate A/B and B/A rows", () => {
    expect(canonicalizePair(teamBId, teamAId)).toEqual({ teamAId, teamBId });
  });

  it("calculates wins, draws, goals, rates, and last match from canonical team perspective", () => {
    const feature = calculateFootballHeadToHeadFeature({
      teamAId: teamBId,
      teamBId: teamAId,
      competitionId,
      seasonId,
      asOfDate,
      windowSize: 5,
      sourceRows: [
        matchRow("m3", "2026-04-25", teamAId, teamBId, 2, 1),
        matchRow("m2", "2026-04-20", teamBId, teamAId, 3, 3),
        matchRow("m1", "2026-04-10", teamBId, teamAId, 1, 0)
      ]
    });

    expect(feature).toMatchObject({
      teamAId,
      teamBId,
      matchesPlayed: 3,
      teamAWins: 1,
      teamBWins: 1,
      draws: 1,
      teamAGoalsFor: 5,
      teamBGoalsFor: 5,
      avgTotalGoals: 3.333,
      avgTeamAGoals: 1.667,
      avgTeamBGoals: 1.667,
      bothTeamsToScoreRate: 66.67,
      over15Rate: 66.67,
      over25Rate: 66.67,
      over35Rate: 33.33,
      teamAHomeMatches: 1,
      teamBHomeMatches: 2,
      teamAHomeWins: 1,
      teamBHomeWins: 1,
      lastMatchId: "m3",
      lastMatchTeamAGoals: 2,
      lastMatchTeamBGoals: 1,
      sampleSize: 3
    });
  });

  it("uses current score fallback only for final statuses", () => {
    const feature = calculateFootballHeadToHeadFeature({
      teamAId,
      teamBId,
      asOfDate,
      windowSize: 5,
      sourceRows: [
        {
          match: baseMatch("fallback-final", "2026-04-20", teamAId, teamBId, "finished"),
          score: { homeScoreCurrent: 2, awayScoreCurrent: 2, status: "finished" }
        },
        {
          match: baseMatch("scheduled", "2026-04-18", teamAId, teamBId, "scheduled"),
          score: { homeScoreCurrent: 4, awayScoreCurrent: 4, status: "scheduled" }
        }
      ]
    });

    expect(feature.sampleSize).toBe(1);
    expect(feature.draws).toBe(1);
  });

  it("no-match pair produces sample_size=0 and coverage_score=0", async () => {
    const repositories = createInMemoryRepositories([]);
    const builder = new FootballHeadToHeadFeatureBuilder(repositories);

    await builder.buildForPair(teamAId, teamBId, { asOfDate, windowSizes: [5] });

    expect(repositories.features.get(`${teamAId}|${teamBId}||||5`)).toMatchObject({
      matchesPlayed: 0,
      sampleSize: 0,
      coverageScore: 0
    });
  });

  it("excludes future and non-final matches", async () => {
    const repositories = createInMemoryRepositories([
      matchRow("past-final", "2026-04-20", teamAId, teamBId, 2, 0),
      matchRow("future-final", "2026-06-01", teamAId, teamBId, 5, 0),
      matchRow("past-scheduled", "2026-04-10", teamAId, teamBId, 1, 0, "scheduled")
    ]);
    const builder = new FootballHeadToHeadFeatureBuilder(repositories);

    await builder.buildForPair(teamAId, teamBId, { asOfDate, windowSizes: [5] });

    expect(repositories.features.get(`${teamAId}|${teamBId}||||5`)).toMatchObject({
      matchesPlayed: 1,
      teamAGoalsFor: 2,
      teamBGoalsFor: 0
    });
  });

  it("buildForMatch resolves the pair and excludes the target match", async () => {
    const target = baseMatch("target", "2026-05-01", teamBId, teamAId, "scheduled");
    const repositories = createInMemoryRepositories([matchRow("history", "2026-04-20", teamAId, teamBId, 2, 0), { match: target, score: { homeScoreFulltime: 5, awayScoreFulltime: 0 } }]);
    const builder = new FootballHeadToHeadFeatureBuilder(repositories);

    const result = await builder.buildForMatch("target");

    expect(result.changedFeatureRows).toBe(2);
    expect(repositories.features.get(`${teamAId}|${teamBId}|competition-1|season-1|target|5`)).toMatchObject({ matchesPlayed: 1, teamAGoalsFor: 2 });
  });

  it("rebuildAfterMatch includes the final target match", async () => {
    const repositories = createInMemoryRepositories([matchRow("target", "2026-04-20", teamAId, teamBId, 3, 1)]);
    const builder = new FootballHeadToHeadFeatureBuilder(repositories);

    const result = await builder.rebuildAfterMatch("target");

    expect(result.changedFeatureRows).toBe(2);
    expect(repositories.features.get(`${teamAId}|${teamBId}|competition-1|season-1|target|5`)).toMatchObject({ matchesPlayed: 1, teamAGoalsFor: 3 });
  });

  it("upserts idempotently by feature key", async () => {
    const repositories = createInMemoryRepositories([matchRow("m1", "2026-04-20", teamAId, teamBId, 2, 0)]);
    const builder = new FootballHeadToHeadFeatureBuilder(repositories);

    await builder.buildForPair(teamBId, teamAId, { asOfDate, windowSizes: [5] });
    await builder.buildForPair(teamAId, teamBId, { asOfDate, windowSizes: [5] });

    expect(repositories.features.size).toBe(1);
    expect(repositories.upsertCount).toBe(2);
  });

  it("buildForCompetitionSeason supports nullable-season pair discovery", async () => {
    const nullSeasonRow = matchRow("null-season", "2026-04-20", teamAId, teamBId, 2, 0);
    nullSeasonRow.match.seasonId = null;
    const concreteSeasonRow = matchRow("concrete-season", "2026-04-18", teamAId, teamCId, 5, 0);
    const repositories = createInMemoryRepositories([nullSeasonRow, concreteSeasonRow]);
    const builder = new FootballHeadToHeadFeatureBuilder(repositories);

    const result = await builder.buildForCompetitionSeason(competitionId, null, { windowSizes: [5] });

    expect(result.changedFeatureRows).toBe(1);
    expect(repositories.competitionSeasonCalls).toEqual([{ competitionId, seasonId: null }]);
    expect(repositories.features.get(`${teamAId}|${teamBId}|competition-1|||5`)).toMatchObject({ matchesPlayed: 1 });
  });
});

function createInMemoryRepositories(rows: FootballHeadToHeadSourceRow[]) {
  const features = new Map<string, FootballHeadToHeadFeatureInput>();
  let upsertCount = 0;
  const competitionSeasonCalls: Array<{ competitionId: string; seasonId: string | null }> = [];
  const repositoryBundle = {
    features: {
      async upsertFeature(input: FootballHeadToHeadFeatureInput) {
        features.set(featureKey(input), input);
        upsertCount += 1;
        return input;
      },
      get(key: string) {
        return features.get(key);
      },
      get size() {
        return features.size;
      }
    },
    sources: {
      async findMatchById(matchId: string) {
        return rows.find((row) => row.match.id === matchId)?.match;
      },
      async listFinalMatchesForPairBefore(input: ListFootballHeadToHeadMatchesInput) {
        return rows
          .filter((row) => isIncluded(row, input))
          .sort((a, b) => b.match.scheduledStartAt.getTime() - a.match.scheduledStartAt.getTime())
          .slice(0, input.limit);
      },
      async listPairIdsForCompetitionSeason(requestCompetitionId: string, requestSeasonId: string | null) {
        competitionSeasonCalls.push({ competitionId: requestCompetitionId, seasonId: requestSeasonId });
        return uniquePairs(rows.filter((row) => row.match.competitionId === requestCompetitionId && (requestSeasonId === null ? row.match.seasonId == null : row.match.seasonId === requestSeasonId)));
      }
    },
    get upsertCount() {
      return upsertCount;
    },
    get competitionSeasonCalls() {
      return competitionSeasonCalls;
    }
  };

  return repositoryBundle;
}

function isIncluded(row: FootballHeadToHeadSourceRow, input: ListFootballHeadToHeadMatchesInput): boolean {
  const isPairMatch =
    (row.match.homeTeamId === input.teamAId && row.match.awayTeamId === input.teamBId) || (row.match.homeTeamId === input.teamBId && row.match.awayTeamId === input.teamAId);
  const isBefore = row.match.scheduledStartAt < input.asOfDate || row.match.id === input.includeMatchId;
  const isFinal = row.match.status === "finished" || row.match.status === "after_extra_time" || row.match.status === "after_penalties";
  const isCompetitionMatch = !input.competitionId || row.match.competitionId === input.competitionId;
  const isSeasonMatch = input.seasonId === undefined ? true : input.seasonId === null ? row.match.seasonId == null : row.match.seasonId === input.seasonId;
  return isPairMatch && isBefore && isFinal && isCompetitionMatch && isSeasonMatch;
}

function uniquePairs(rows: FootballHeadToHeadSourceRow[]) {
  const pairs = new Map<string, { teamAId: string; teamBId: string }>();
  for (const row of rows) {
    const pair = canonicalizePair(row.match.homeTeamId, row.match.awayTeamId);
    pairs.set(`${pair.teamAId}|${pair.teamBId}`, pair);
  }
  return [...pairs.values()];
}

function featureKey(input: FootballHeadToHeadFeatureInput): string {
  return [input.teamAId, input.teamBId, input.competitionId ?? "", input.seasonId ?? "", input.asOfMatchId ?? "", input.windowSize].join("|");
}

function matchRow(id: string, date: string, homeTeamId: string, awayTeamId: string, homeGoals: number, awayGoals: number, status: FootballHeadToHeadMatch["status"] = "finished"): FootballHeadToHeadSourceRow {
  return {
    match: baseMatch(id, date, homeTeamId, awayTeamId, status),
    score: {
      homeScoreFulltime: homeGoals,
      awayScoreFulltime: awayGoals,
      status
    }
  };
}

function baseMatch(id: string, date: string, homeTeamId: string, awayTeamId: string, status: FootballHeadToHeadMatch["status"] = "finished"): FootballHeadToHeadMatch {
  return {
    id,
    competitionId,
    seasonId,
    scheduledStartAt: new Date(`${date}T12:00:00.000Z`),
    status,
    homeTeamId,
    awayTeamId
  };
}
