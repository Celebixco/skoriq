import { describe, expect, it } from "vitest";
import {
  fitFootballPoissonModel,
  outcomeOf,
  predictFootballMarkets,
  scoreMatrix,
  type FootballModelMatch
} from "./football-probabilistic-model.js";

function match(day: number, homeTeamId: string, awayTeamId: string, homeGoals: number, awayGoals: number): FootballModelMatch {
  return {
    date: new Date(Date.UTC(2026, 0, 1 + day)),
    homeTeamId,
    awayTeamId,
    homeGoals,
    awayGoals
  };
}

function syntheticLeague(): FootballModelMatch[] {
  const matches: FootballModelMatch[] = [];
  let day = 0;
  for (let round = 0; round < 8; round++) {
    matches.push(match(day++, "strong", "weak", 3, 0));
    matches.push(match(day++, "weak", "strong", 0, 2));
    matches.push(match(day++, "strong", "middle", 2, 0));
    matches.push(match(day++, "middle", "strong", 1, 2));
    matches.push(match(day++, "middle", "weak", 1, 1));
    matches.push(match(day++, "weak", "middle", 0, 1));
  }
  return matches;
}

describe("football probabilistic model", () => {
  it("fits team strength and favours the stronger side", () => {
    const model = fitFootballPoissonModel(syntheticLeague(), { iterations: 300, timeDecayHalfLifeDays: 3650 });
    const prediction = predictFootballMarkets(model, "strong", "weak");

    expect(model.trainedMatches).toBe(48);
    expect(model.teams.strong?.matches).toBe(32);
    expect(prediction.homeWin).toBeGreaterThan(prediction.awayWin);
    expect(prediction.homeWin).toBeGreaterThan(prediction.draw);
    expect(prediction.homeWin + prediction.draw + prediction.awayWin).toBeCloseTo(1, 6);
  });

  it("derives complementary over/under and BTTS markets", () => {
    const model = fitFootballPoissonModel(syntheticLeague(), { iterations: 300 });
    const prediction = predictFootballMarkets(model, "middle", "strong");

    expect(prediction.over15 + prediction.under15).toBeCloseTo(1, 6);
    expect(prediction.over25 + prediction.under25).toBeCloseTo(1, 6);
    expect(prediction.over35 + prediction.under35).toBeCloseTo(1, 6);
    expect(prediction.bttsYes + prediction.bttsNo).toBeCloseTo(1, 6);
    expect(prediction.expectedTotalGoals).toBeGreaterThan(0);
  });

  it("normalises a Dixon-Coles score matrix", () => {
    const cells = scoreMatrix(1.6, 0.9, 10, -0.06);
    const total = cells.reduce((sum, cell) => sum + cell.probability, 0);
    expect(total).toBeCloseTo(1, 8);
    expect(cells.some((cell) => cell.home === 0 && cell.away === 0)).toBe(true);
  });

  it("classifies outcomes consistently", () => {
    expect(outcomeOf(2, 1)).toBe("home");
    expect(outcomeOf(0, 0)).toBe("draw");
    expect(outcomeOf(0, 2)).toBe("away");
  });
});
