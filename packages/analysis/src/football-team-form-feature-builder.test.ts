import { describe, expect, it } from "vitest";
import { FootballTeamFormFeatureBuilder, calculateFootballTeamFormFeature } from "./football-team-form-feature-builder.js";
import type {
  FootballTeamFormFeatureInput,
  FootballTeamFormMatch,
  FootballTeamFormSourceRow,
  FootballTeamFormStanding,
  ListFootballTeamFormMatchesInput
} from "./football-team-form-feature-builder.js";

const teamId = "team-a";
const opponentId = "team-b";
const competitionId = "competition-1";
const seasonId = "season-1";
const asOfDate = new Date("2026-05-01T12:00:00.000Z");

describe("football team form feature builder", () => {
  it("calculates overall last-5 form, W/D/L, points, goals, and rates", () => {
    const feature = calculateFootballTeamFormFeature({
      teamId,
      competitionId,
      seasonId,
      asOfDate,
      windowSize: 5,
      scope: "overall",
      sourceRows: [
        matchRow("m1", "2026-04-25", true, 2, 0),
        matchRow("m2", "2026-04-20", false, 1, 1),
        matchRow("m3", "2026-04-15", true, 0, 1),
        matchRow("m4", "2026-04-10", false, 3, 2),
        matchRow("m5", "2026-04-05", true, 4, 1)
      ]
    });

    expect(feature).toMatchObject({
      matchesPlayed: 5,
      wins: 3,
      draws: 1,
      losses: 1,
      points: 10,
      goalsFor: 10,
      goalsAgainst: 5,
      goalDifference: 5,
      avgGoalsFor: 2,
      avgGoalsAgainst: 1,
      cleanSheetRate: 20,
      failedToScoreRate: 20,
      bothTeamsToScoreRate: 60,
      over05Rate: 100,
      over15Rate: 80,
      over25Rate: 40,
      over35Rate: 40,
      under25Rate: 60,
      scoredRate: 80,
      concededRate: 80,
      teamOver05Rate: 80,
      teamOver15Rate: 60,
      sampleSize: 5
    });
  });

  it("calculates first goal-profile expansion rates from included fulltime matches", () => {
    const feature = calculateFootballTeamFormFeature({
      teamId,
      asOfDate,
      windowSize: 4,
      scope: "overall",
      sourceRows: [
        matchRow("m1", "2026-04-25", true, 2, 0),
        matchRow("m2", "2026-04-20", false, 1, 1),
        matchRow("m3", "2026-04-15", true, 0, 1),
        matchRow("m4", "2026-04-10", false, 3, 2)
      ]
    });

    expect(feature).toMatchObject({
      over05Rate: 100,
      under25Rate: 75,
      scoredRate: 75,
      concededRate: 75,
      teamOver05Rate: 75,
      teamOver15Rate: 50,
      bothTeamsToScoreRate: 50,
      over15Rate: 75,
      over25Rate: 25
    });
  });

  it("calculates first-half goal fields using only matches with halftime scores", () => {
    const feature = calculateFootballTeamFormFeature({
      teamId,
      asOfDate,
      windowSize: 3,
      scope: "overall",
      sourceRows: [
        matchRow("m1", "2026-04-25", true, 2, 0, undefined, "finished", { teamGoals: 1, opponentGoals: 0 }),
        matchRow("m2", "2026-04-20", false, 1, 1),
        matchRow("m3", "2026-04-15", false, 3, 2, undefined, "finished", { teamGoals: 0, opponentGoals: 0 })
      ]
    });

    expect(feature).toMatchObject({
      matchesPlayed: 3,
      firstHalfOver05Rate: 50,
      firstHalfAvgGoalsFor: 0.5,
      firstHalfAvgGoalsAgainst: 0
    });
  });

  it("leaves first-half goal fields empty when halftime scores are missing", () => {
    const feature = calculateFootballTeamFormFeature({
      teamId,
      asOfDate,
      windowSize: 2,
      scope: "overall",
      sourceRows: [matchRow("m1", "2026-04-25", true, 2, 0), matchRow("m2", "2026-04-20", false, 1, 1)]
    });

    expect(feature.matchesPlayed).toBe(2);
    expect(feature.firstHalfOver05Rate).toBeUndefined();
    expect(feature.firstHalfAvgGoalsFor).toBeUndefined();
    expect(feature.firstHalfAvgGoalsAgainst).toBeUndefined();
  });

  it("builds home-only and away-only scopes", async () => {
    const repositories = createInMemoryRepositories([
      matchRow("home-win", "2026-04-20", true, 2, 0),
      matchRow("away-loss", "2026-04-18", false, 1, 3),
      matchRow("home-draw", "2026-04-10", true, 1, 1)
    ]);
    const builder = new FootballTeamFormFeatureBuilder(repositories);

    await builder.buildForTeam(teamId, { asOfDate, competitionId, seasonId, windowSizes: [5], scopes: ["home", "away"] });

    expect(repositories.features.get("team-a|competition-1|season-1||5|home")).toMatchObject({
      matchesPlayed: 2,
      wins: 1,
      draws: 1,
      losses: 0,
      goalsFor: 3,
      goalsAgainst: 1
    });
    expect(repositories.features.get("team-a|competition-1|season-1||5|away")).toMatchObject({
      matchesPlayed: 1,
      wins: 0,
      draws: 0,
      losses: 1,
      goalsFor: 1,
      goalsAgainst: 3
    });
  });

  it("averages football team statistics when available", () => {
    const feature = calculateFootballTeamFormFeature({
      teamId,
      asOfDate,
      windowSize: 2,
      scope: "overall",
      sourceRows: [
        matchRow("m1", "2026-04-20", true, 2, 0, {
          shotsTotal: 10,
          shotsOnTarget: 5,
          possessionPercent: 60,
          corners: 7,
          yellowCards: 2,
          redCards: 0,
          fouls: 11,
          expectedGoals: 1.5,
          dangerousAttacks: 30
        }),
        matchRow("m2", "2026-04-10", false, 1, 1, {
          shotsTotal: 6,
          shotsOnTarget: 3,
          possessionPercent: 50,
          corners: 5,
          yellowCards: 4,
          redCards: 1,
          fouls: 13,
          expectedGoals: 0.8,
          dangerousAttacks: 20
        })
      ]
    });

    expect(feature).toMatchObject({
      avgShots: 8,
      avgShotsOnTarget: 4,
      avgPossessionPercent: 55,
      avgCorners: 6,
      avgYellowCards: 3,
      avgRedCards: 0.5,
      avgFouls: 12,
      avgExpectedGoals: 1.15,
      avgDangerousAttacks: 25,
      coverageScore: 90
    });
  });

  it("does not block when statistics are missing", () => {
    const feature = calculateFootballTeamFormFeature({
      teamId,
      asOfDate,
      windowSize: 5,
      scope: "overall",
      sourceRows: [matchRow("m1", "2026-04-20", true, 2, 0)]
    });

    expect(feature.matchesPlayed).toBe(1);
    expect(feature.avgShots).toBeUndefined();
    expect(feature.coverageScore).toBe(12);
  });

  it("includes standings context when available", async () => {
    const repositories = createInMemoryRepositories([matchRow("m1", "2026-04-20", true, 2, 0)], { position: 2, points: 68, goalDifference: 31 });
    const builder = new FootballTeamFormFeatureBuilder(repositories);

    await builder.buildForTeam(teamId, { asOfDate, competitionId, seasonId, windowSizes: [5], scopes: ["overall"] });

    expect(repositories.features.get("team-a|competition-1|season-1||5|overall")).toMatchObject({
      standingsPosition: 2,
      standingsPoints: 68,
      standingsGoalDifference: 31,
      coverageScore: 22
    });
  });

  it("excludes future and non-final matches", async () => {
    const repositories = createInMemoryRepositories([
      matchRow("past-final", "2026-04-20", true, 2, 0),
      matchRow("future-final", "2026-06-01", true, 5, 0),
      matchRow("past-scheduled", "2026-04-10", true, 1, 0, undefined, "scheduled")
    ]);
    const builder = new FootballTeamFormFeatureBuilder(repositories);

    await builder.buildForTeam(teamId, { asOfDate, windowSizes: [5], scopes: ["overall"] });

    expect(repositories.features.get("team-a||||5|overall")).toMatchObject({
      matchesPlayed: 1,
      goalsFor: 2,
      goalsAgainst: 0
    });
  });

  it("handles insufficient sample size and no-match behavior", async () => {
    const repositories = createInMemoryRepositories([]);
    const builder = new FootballTeamFormFeatureBuilder(repositories);

    await builder.buildForTeam(teamId, { asOfDate, windowSizes: [5], scopes: ["overall"] });

    expect(repositories.features.get("team-a||||5|overall")).toMatchObject({
      matchesPlayed: 0,
      sampleSize: 0,
      wins: 0,
      goalsFor: 0,
      coverageScore: 0
    });
    expect(repositories.features.get("team-a||||5|overall")?.cleanSheetRate).toBeUndefined();
  });

  it("buildForMatch creates pre-match features for both teams without including the target match", async () => {
    const targetMatch = baseMatch("target", "2026-05-01", true, "scheduled");
    const repositories = createInMemoryRepositories([matchRow("history", "2026-04-20", true, 2, 0), { match: targetMatch, score: { homeScoreFulltime: 4, awayScoreFulltime: 0 } }]);
    const builder = new FootballTeamFormFeatureBuilder(repositories);

    const result = await builder.buildForMatch("target");

    expect(result.changedFeatureRows).toBe(12);
    expect(repositories.features.get("team-a|competition-1|season-1|target|5|overall")).toMatchObject({ matchesPlayed: 1, goalsFor: 2 });
    expect(repositories.features.get("team-b|competition-1|season-1|target|5|overall")).toMatchObject({ matchesPlayed: 1, goalsFor: 0 });
  });

  it("rebuildAfterMatch includes the final match itself", async () => {
    const repositories = createInMemoryRepositories([matchRow("target", "2026-04-20", true, 3, 1)]);
    const builder = new FootballTeamFormFeatureBuilder(repositories);

    const result = await builder.rebuildAfterMatch("target");

    expect(result.changedFeatureRows).toBe(12);
    expect(repositories.features.get("team-a|competition-1|season-1|target|5|overall")).toMatchObject({ matchesPlayed: 1, goalsFor: 3 });
  });

  it("upserts idempotently by feature key", async () => {
    const repositories = createInMemoryRepositories([matchRow("m1", "2026-04-20", true, 2, 0)]);
    const builder = new FootballTeamFormFeatureBuilder(repositories);

    await builder.buildForTeam(teamId, { asOfDate, windowSizes: [5], scopes: ["overall"] });
    await builder.buildForTeam(teamId, { asOfDate, windowSizes: [5], scopes: ["overall"] });

    expect(repositories.features.size).toBe(1);
    expect(repositories.upsertCount).toBe(2);
  });

  it("buildForCompetitionSeason supports explicit nullable-season builds", async () => {
    const nullSeasonRow = matchRow("null-season", "2026-04-20", true, 2, 0);
    nullSeasonRow.match.seasonId = null;
    const concreteSeasonRow = matchRow("concrete-season", "2026-04-18", true, 5, 0);
    const repositories = createInMemoryRepositories([nullSeasonRow, concreteSeasonRow]);
    const builder = new FootballTeamFormFeatureBuilder(repositories);

    const result = await builder.buildForCompetitionSeason(competitionId, null, { windowSizes: [5], scopes: ["overall"] });

    expect(result.changedFeatureRows).toBe(2);
    expect(repositories.competitionSeasonCalls).toEqual([{ competitionId, seasonId: null }]);
    expect(repositories.features.get("team-a|competition-1|||5|overall")).toMatchObject({
      matchesPlayed: 1,
      goalsFor: 2,
      goalsAgainst: 0
    });
  });
});

function createInMemoryRepositories(rows: FootballTeamFormSourceRow[], standing?: FootballTeamFormStanding) {
  const features = new Map<string, FootballTeamFormFeatureInput>();
  let upsertCount = 0;
  const competitionSeasonCalls: Array<{ competitionId: string; seasonId: string | null }> = [];
  const repositoryBundle = {
    features: {
      async upsertFeature(input: FootballTeamFormFeatureInput) {
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
      async findStandingForTeam() {
        return standing;
      },
      async listFinalMatchesForTeamBefore(input: ListFootballTeamFormMatchesInput) {
        return rows
          .filter((row) => isIncluded(row, input))
          .sort((a, b) => b.match.scheduledStartAt.getTime() - a.match.scheduledStartAt.getTime())
          .slice(0, input.limit);
      },
      async listTeamIdsForCompetitionSeason(requestCompetitionId: string, requestSeasonId: string | null) {
        competitionSeasonCalls.push({ competitionId: requestCompetitionId, seasonId: requestSeasonId });
        return [teamId, opponentId];
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

function isIncluded(row: FootballTeamFormSourceRow, input: ListFootballTeamFormMatchesInput): boolean {
  const isTeamMatch = row.match.homeTeamId === input.teamId || row.match.awayTeamId === input.teamId;
  const isScopeMatch =
    input.scope === "overall" || (input.scope === "home" && row.match.homeTeamId === input.teamId) || (input.scope === "away" && row.match.awayTeamId === input.teamId);
  const isBefore = row.match.scheduledStartAt < input.asOfDate || row.match.id === input.includeMatchId;
  const isFinal = row.match.status === "finished" || row.match.status === "after_extra_time" || row.match.status === "after_penalties";
  const isCompetitionMatch = !input.competitionId || row.match.competitionId === input.competitionId;
  const isSeasonMatch = input.seasonId === undefined ? true : input.seasonId === null ? row.match.seasonId == null : row.match.seasonId === input.seasonId;
  return isTeamMatch && isScopeMatch && isBefore && isFinal && isCompetitionMatch && isSeasonMatch;
}

function featureKey(input: FootballTeamFormFeatureInput): string {
  return [input.teamId, input.competitionId ?? "", input.seasonId ?? "", input.asOfMatchId ?? "", input.windowSize, input.scope].join("|");
}

function matchRow(
  id: string,
  date: string,
  isHome: boolean,
  teamGoals: number,
  opponentGoals: number,
  statistics?: FootballTeamFormSourceRow["statistics"],
  status: FootballTeamFormMatch["status"] = "finished",
  halftime?: { teamGoals: number; opponentGoals: number }
): FootballTeamFormSourceRow {
  return {
    match: baseMatch(id, date, isHome, status),
    score: {
      homeScoreHalftime: halftime ? (isHome ? halftime.teamGoals : halftime.opponentGoals) : undefined,
      awayScoreHalftime: halftime ? (isHome ? halftime.opponentGoals : halftime.teamGoals) : undefined,
      homeScoreFulltime: isHome ? teamGoals : opponentGoals,
      awayScoreFulltime: isHome ? opponentGoals : teamGoals,
      status
    },
    statistics
  };
}

function baseMatch(id: string, date: string, isHome: boolean, status: FootballTeamFormMatch["status"] = "finished"): FootballTeamFormMatch {
  return {
    id,
    competitionId,
    seasonId,
    scheduledStartAt: new Date(`${date}T12:00:00.000Z`),
    status,
    homeTeamId: isHome ? teamId : opponentId,
    awayTeamId: isHome ? opponentId : teamId
  };
}
