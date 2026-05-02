import { describe, expect, it } from "vitest";
import { BasketballTeamFormFeatureBuilder, calculateBasketballTeamFormFeature } from "./basketball-team-form-feature-builder.js";
import type {
  BasketballTeamFormFeatureInput,
  BasketballTeamFormMatch,
  BasketballTeamFormSourceRow,
  BasketballTeamFormStanding,
  ListBasketballTeamFormMatchesInput
} from "./basketball-team-form-feature-builder.js";

const teamId = "team-a";
const opponentId = "team-b";
const competitionId = "competition-1";
const seasonId = "season-1";
const asOfDate = new Date("2026-05-01T12:00:00.000Z");

describe("basketball team form feature builder", () => {
  it("calculates overall last-5 form, wins/losses, points, margin, and over rates", () => {
    const feature = calculateBasketballTeamFormFeature({
      teamId,
      competitionId,
      seasonId,
      asOfDate,
      windowSize: 5,
      scope: "overall",
      sourceRows: [
        matchRow("m1", "2026-04-25", true, 102, 98),
        matchRow("m2", "2026-04-20", false, 95, 100),
        matchRow("m3", "2026-04-15", true, 88, 80),
        matchRow("m4", "2026-04-10", false, 110, 112),
        matchRow("m5", "2026-04-05", true, 90, 89)
      ]
    });

    expect(feature).toMatchObject({
      matchesPlayed: 5,
      wins: 3,
      losses: 2,
      pointsFor: 485,
      pointsAgainst: 479,
      pointDifference: 6,
      avgPointsFor: 97,
      avgPointsAgainst: 95.8,
      avgTotalPoints: 192.8,
      avgMargin: 1.2,
      over1505Rate: 100,
      over1605Rate: 100,
      over1705Rate: 80,
      over1805Rate: 60,
      sampleSize: 5
    });
  });

  it("builds home-only and away-only scopes", async () => {
    const repositories = createInMemoryRepositories([
      matchRow("home-win", "2026-04-20", true, 102, 90),
      matchRow("away-loss", "2026-04-18", false, 88, 96),
      matchRow("home-win-2", "2026-04-10", true, 101, 99)
    ]);
    const builder = new BasketballTeamFormFeatureBuilder(repositories);

    await builder.buildForTeam(teamId, { asOfDate, competitionId, seasonId, windowSizes: [5], scopes: ["home", "away"] });

    expect(repositories.features.get("team-a|competition-1|season-1||5|home")).toMatchObject({
      matchesPlayed: 2,
      wins: 2,
      losses: 0,
      pointsFor: 203,
      pointsAgainst: 189
    });
    expect(repositories.features.get("team-a|competition-1|season-1||5|away")).toMatchObject({
      matchesPlayed: 1,
      wins: 0,
      losses: 1,
      pointsFor: 88,
      pointsAgainst: 96
    });
  });

  it("averages period scoring from basketball period scores", () => {
    const feature = calculateBasketballTeamFormFeature({
      teamId,
      asOfDate,
      windowSize: 2,
      scope: "overall",
      sourceRows: [
        matchRow("m1", "2026-04-20", true, 100, 90, undefined, "finished", [
          period("q1", 1, 25, 20),
          period("q2", 2, 28, 22),
          period("q3", 3, 20, 24),
          period("q4", 4, 27, 24)
        ]),
        matchRow("m2", "2026-04-10", false, 96, 92, undefined, "finished", [
          period("q1", 1, 20, 24),
          period("q2", 2, 22, 26),
          period("q3", 3, 25, 21),
          period("q4", 4, 25, 25)
        ])
      ]
    });

    expect(feature).toMatchObject({
      avgQ1PointsFor: 24.5,
      avgQ1PointsAgainst: 20,
      avgFirstHalfPointsFor: 51.5,
      avgFirstHalfPointsAgainst: 42,
      avgSecondHalfPointsFor: 46.5,
      avgSecondHalfPointsAgainst: 49,
      avgQ4PointsFor: 26,
      avgQ4PointsAgainst: 24.5
    });
  });

  it("averages basketball team statistics when available", () => {
    const feature = calculateBasketballTeamFormFeature({
      teamId,
      asOfDate,
      windowSize: 2,
      scope: "overall",
      sourceRows: [
        matchRow("m1", "2026-04-20", true, 100, 90, {
          fieldGoalPercent: 50,
          threePointPercent: 38,
          freeThrowPercent: 80,
          reboundsTotal: 42,
          reboundsOffensive: 9,
          reboundsDefensive: 33,
          assists: 24,
          steals: 7,
          blocks: 5,
          turnovers: 12,
          personalFouls: 18,
          fastBreakPoints: 14,
          pointsInPaint: 44,
          secondChancePoints: 11,
          benchPoints: 32
        }),
        matchRow("m2", "2026-04-10", false, 96, 92, {
          fieldGoalPercent: 46,
          threePointPercent: 34,
          freeThrowPercent: 76,
          reboundsTotal: 38,
          reboundsOffensive: 7,
          reboundsDefensive: 31,
          assists: 20,
          steals: 9,
          blocks: 3,
          turnovers: 10,
          personalFouls: 20,
          fastBreakPoints: 10,
          pointsInPaint: 40,
          secondChancePoints: 9,
          benchPoints: 28
        })
      ]
    });

    expect(feature).toMatchObject({
      avgFieldGoalPercent: 48,
      avgThreePointPercent: 36,
      avgFreeThrowPercent: 78,
      avgReboundsTotal: 40,
      avgReboundsOffensive: 8,
      avgReboundsDefensive: 32,
      avgAssists: 22,
      avgSteals: 8,
      avgBlocks: 4,
      avgTurnovers: 11,
      avgPersonalFouls: 19,
      avgFastBreakPoints: 12,
      avgPointsInPaint: 42,
      avgSecondChancePoints: 10,
      avgBenchPoints: 30,
      coverageScore: 75
    });
  });

  it("does not block when statistics or period scores are missing", () => {
    const feature = calculateBasketballTeamFormFeature({
      teamId,
      asOfDate,
      windowSize: 5,
      scope: "overall",
      sourceRows: [matchRow("m1", "2026-04-20", true, 100, 90)]
    });

    expect(feature.matchesPlayed).toBe(1);
    expect(feature.avgFieldGoalPercent).toBeUndefined();
    expect(feature.avgQ1PointsFor).toBeUndefined();
    expect(feature.coverageScore).toBe(12);
  });

  it("includes standings context when available", async () => {
    const repositories = createInMemoryRepositories([matchRow("m1", "2026-04-20", true, 100, 90)], {
      position: 3,
      winPercentage: 62.5,
      pointDifference: 144,
      streak: "W3"
    });
    const builder = new BasketballTeamFormFeatureBuilder(repositories);

    await builder.buildForTeam(teamId, { asOfDate, competitionId, seasonId, windowSizes: [5], scopes: ["overall"] });

    expect(repositories.features.get("team-a|competition-1|season-1||5|overall")).toMatchObject({
      standingsPosition: 3,
      standingsWinPercentage: 62.5,
      standingsPointDifference: 144,
      standingsStreak: "W3",
      coverageScore: 22
    });
  });

  it("excludes future and non-final matches", async () => {
    const repositories = createInMemoryRepositories([
      matchRow("past-final", "2026-04-20", true, 100, 90),
      matchRow("future-final", "2026-06-01", true, 130, 90),
      matchRow("past-scheduled", "2026-04-10", true, 95, 92, undefined, "scheduled")
    ]);
    const builder = new BasketballTeamFormFeatureBuilder(repositories);

    await builder.buildForTeam(teamId, { asOfDate, windowSizes: [5], scopes: ["overall"] });

    expect(repositories.features.get("team-a||||5|overall")).toMatchObject({
      matchesPlayed: 1,
      pointsFor: 100,
      pointsAgainst: 90
    });
  });

  it("handles insufficient sample size and no-match behavior", async () => {
    const repositories = createInMemoryRepositories([]);
    const builder = new BasketballTeamFormFeatureBuilder(repositories);

    await builder.buildForTeam(teamId, { asOfDate, windowSizes: [5], scopes: ["overall"] });

    expect(repositories.features.get("team-a||||5|overall")).toMatchObject({
      matchesPlayed: 0,
      sampleSize: 0,
      wins: 0,
      pointsFor: 0,
      coverageScore: 0
    });
    expect(repositories.features.get("team-a||||5|overall")?.avgPointsFor).toBeUndefined();
  });

  it("uses current score fields for final basketball statuses when final score fields are missing", () => {
    const feature = calculateBasketballTeamFormFeature({
      teamId,
      asOfDate,
      windowSize: 2,
      scope: "overall",
      sourceRows: [
        {
          match: baseMatch("ot-win", "2026-04-20", true, "after_extra_time"),
          score: {
            homeScoreCurrent: 111,
            awayScoreCurrent: 107,
            status: "after_extra_time"
          }
        },
        {
          match: baseMatch("penalty-style-final", "2026-04-10", false, "after_penalties"),
          score: {
            homeScoreCurrent: 98,
            awayScoreCurrent: 99,
            status: "after_penalties"
          }
        }
      ]
    });

    expect(feature).toMatchObject({
      matchesPlayed: 2,
      wins: 2,
      losses: 0,
      pointsFor: 210,
      pointsAgainst: 205,
      avgPointsFor: 105,
      avgPointsAgainst: 102.5
    });
  });

  it("buildForMatch creates pre-match features for both teams without including the target match", async () => {
    const targetMatch = baseMatch("target", "2026-05-01", true, "scheduled");
    const repositories = createInMemoryRepositories([matchRow("history", "2026-04-20", true, 100, 90), { match: targetMatch, score: { homeScoreFinal: 120, awayScoreFinal: 80 } }]);
    const builder = new BasketballTeamFormFeatureBuilder(repositories);

    const result = await builder.buildForMatch("target");

    expect(result.changedFeatureRows).toBe(12);
    expect(repositories.features.get("team-a|competition-1|season-1|target|5|overall")).toMatchObject({ matchesPlayed: 1, pointsFor: 100 });
    expect(repositories.features.get("team-b|competition-1|season-1|target|5|overall")).toMatchObject({ matchesPlayed: 1, pointsFor: 90 });
  });

  it("rebuildAfterMatch includes the final match itself", async () => {
    const repositories = createInMemoryRepositories([matchRow("target", "2026-04-20", true, 104, 99)]);
    const builder = new BasketballTeamFormFeatureBuilder(repositories);

    const result = await builder.rebuildAfterMatch("target");

    expect(result.changedFeatureRows).toBe(12);
    expect(repositories.features.get("team-a|competition-1|season-1|target|5|overall")).toMatchObject({ matchesPlayed: 1, pointsFor: 104 });
  });

  it("buildForCompetitionSeason rebuilds all discovered teams for default windows and scopes", async () => {
    const repositories = createInMemoryRepositories([
      matchRow("m1", "2026-04-20", true, 100, 90),
      matchRow("m2", "2026-04-18", false, 95, 99)
    ]);
    const builder = new BasketballTeamFormFeatureBuilder(repositories);

    const result = await builder.buildForCompetitionSeason(competitionId, seasonId);

    expect(result.changedFeatureRows).toBe(12);
    expect(repositories.features.get("team-a|competition-1|season-1||5|overall")).toMatchObject({ matchesPlayed: 2 });
    expect(repositories.features.get("team-b|competition-1|season-1||5|overall")).toMatchObject({ matchesPlayed: 2 });
  });

  it("upserts idempotently by feature key", async () => {
    const repositories = createInMemoryRepositories([matchRow("m1", "2026-04-20", true, 100, 90)]);
    const builder = new BasketballTeamFormFeatureBuilder(repositories);

    await builder.buildForTeam(teamId, { asOfDate, windowSizes: [5], scopes: ["overall"] });
    await builder.buildForTeam(teamId, { asOfDate, windowSizes: [5], scopes: ["overall"] });

    expect(repositories.features.size).toBe(1);
    expect(repositories.upsertCount).toBe(2);
  });
});

function createInMemoryRepositories(rows: BasketballTeamFormSourceRow[], standing?: BasketballTeamFormStanding) {
  const features = new Map<string, BasketballTeamFormFeatureInput>();
  let upsertCount = 0;
  const repositoryBundle = {
    features: {
      async upsertFeature(input: BasketballTeamFormFeatureInput) {
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
      async listFinalMatchesForTeamBefore(input: ListBasketballTeamFormMatchesInput) {
        return rows
          .filter((row) => isIncluded(row, input))
          .sort((a, b) => b.match.scheduledStartAt.getTime() - a.match.scheduledStartAt.getTime())
          .slice(0, input.limit);
      },
      async listTeamIdsForCompetitionSeason() {
        return [teamId, opponentId];
      }
    },
    get upsertCount() {
      return upsertCount;
    }
  };

  return repositoryBundle;
}

function isIncluded(row: BasketballTeamFormSourceRow, input: ListBasketballTeamFormMatchesInput): boolean {
  const isTeamMatch = row.match.homeTeamId === input.teamId || row.match.awayTeamId === input.teamId;
  const isScopeMatch =
    input.scope === "overall" || (input.scope === "home" && row.match.homeTeamId === input.teamId) || (input.scope === "away" && row.match.awayTeamId === input.teamId);
  const isBefore = row.match.scheduledStartAt < input.asOfDate || row.match.id === input.includeMatchId;
  const isFinal = row.match.status === "finished" || row.match.status === "after_extra_time" || row.match.status === "after_penalties";
  const isCompetitionMatch = !input.competitionId || row.match.competitionId === input.competitionId;
  const isSeasonMatch = !input.seasonId || row.match.seasonId === input.seasonId;
  return isTeamMatch && isScopeMatch && isBefore && isFinal && isCompetitionMatch && isSeasonMatch;
}

function featureKey(input: BasketballTeamFormFeatureInput): string {
  return [input.teamId, input.competitionId ?? "", input.seasonId ?? "", input.asOfMatchId ?? "", input.windowSize, input.scope].join("|");
}

function matchRow(
  id: string,
  date: string,
  isHome: boolean,
  teamPoints: number,
  opponentPoints: number,
  statistics?: BasketballTeamFormSourceRow["statistics"],
  status: BasketballTeamFormMatch["status"] = "finished",
  periods?: BasketballTeamFormSourceRow["periods"]
): BasketballTeamFormSourceRow {
  return {
    match: baseMatch(id, date, isHome, status),
    score: {
      homeScoreFinal: isHome ? teamPoints : opponentPoints,
      awayScoreFinal: isHome ? opponentPoints : teamPoints,
      status
    },
    periods,
    statistics
  };
}

function baseMatch(id: string, date: string, isHome: boolean, status: BasketballTeamFormMatch["status"] = "finished"): BasketballTeamFormMatch {
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

function period(periodType: "q1" | "q2" | "q3" | "q4", periodNumber: number, homeScore: number, awayScore: number) {
  return { periodType, periodNumber, homeScore, awayScore };
}
