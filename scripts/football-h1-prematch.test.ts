import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  h1FeaturesFor, isH1NormalResult, leagueKeyFor, predictH1, validateModelArtifact,
  type H1MatchRow, type H1ModelDefinition
} from "./football-h1-prematch.js";

const dir = dirname(fileURLToPath(import.meta.url));

interface ParityFixtureRow {
  matchId: string; competitionId: string; competitionName: string; country: string;
  season: string; kickoffAtMs: number; status: string;
  homeId: string; homeTeam: string; awayId: string; awayTeam: string;
  homeScore: number | null; awayScore: number | null;
  homeHt: number | null; awayHt: number | null;
  homeExtra: number | null; awayExtra: number | null; homePen: number | null; awayPen: number | null;
}

function toMatchRow(row: ParityFixtureRow): H1MatchRow {
  return {
    match_id: row.matchId, competition_id: row.competitionId, competition_name: row.competitionName,
    country: row.country, season: row.season, kickoff_at: new Date(row.kickoffAtMs), status: row.status,
    home_id: row.homeId, home_team: row.homeTeam, away_id: row.awayId, away_team: row.awayTeam,
    home_score: row.homeScore, away_score: row.awayScore,
    home_ht: row.homeHt, away_ht: row.awayHt,
    home_extra: row.homeExtra, away_extra: row.awayExtra, home_pen: row.homePen, away_pen: row.awayPen
  };
}

async function loadModel(): Promise<H1ModelDefinition> {
  const model = JSON.parse(await readFile(join(dir, "football-h1-model.json"), "utf8")) as H1ModelDefinition;
  validateModelArtifact(model);
  return model;
}

describe("football-h1-prematch model artifact", () => {
  it("validates the shipped model artifact", async () => {
    const model = await loadModel();
    expect(model.modelId).toBe("H1-A");
    expect(model.leagueConstants["superlig"]!.h1Home).toBeGreaterThan(0.6);
    expect(Object.keys(model.leagueConstants).length).toBe(8);
  });

  it("rejects corrupted artifacts", async () => {
    const model = await loadModel();
    const broken = { ...model, weights: { ...model.weights, logit_league: Number.NaN } };
    expect(() => validateModelArtifact(broken)).toThrow(/invalid_weight/);
    const brokenTuning = { ...model, tuning: { ...model.tuning, pickThreshold: 1.5 } };
    expect(() => validateModelArtifact(brokenTuning)).toThrow(/invalid_tuning/);
  });

  it("maps production competition names to league constants", async () => {
    const model = await loadModel();
    expect(leagueKeyFor("Süper Lig", model).key).toBe("superlig");
    expect(leagueKeyFor("Premier League", model).key).toBe("premierleague");
    expect(leagueKeyFor("La Liga", model).key).toBe("laliga");
    expect(leagueKeyFor("Serie A", model).key).toBe("seriea");
    expect(leagueKeyFor("2. Bundesliga", model).key).toBe("2bundesliga");
    expect(leagueKeyFor("Random Cup", model).key).toBe("global");
  });
});

describe("football-h1-prematch parity with validated experiment", () => {
  it("reproduces the Python feature vectors and probabilities", async () => {
    const model = await loadModel();
    const fixtures = JSON.parse(await readFile(join(dir, "../.research/h1/data/parity_fixtures.json"), "utf8")) as {
      fixtures: Array<{ target: { matchId: string; competitionName: string; season: string; kickoffAtMs: number; homeId: string; awayId: string };
        history: ParityFixtureRow[]; pairHistory: ParityFixtureRow[];
        expected: { features: Record<string, number>; pGoal: number; pLeague: number; lambdaTeam: number } }>;
    };
    expect(fixtures.fixtures.length).toBeGreaterThanOrEqual(8);
    for (const fixture of fixtures.fixtures) {
      const target = toMatchRow({
        ...fixture.history[0]!, matchId: fixture.target.matchId, competitionName: fixture.target.competitionName,
        season: fixture.target.season, kickoffAtMs: fixture.target.kickoffAtMs,
        homeId: fixture.target.homeId, awayId: fixture.target.awayId, status: "scheduled",
        homeScore: null, awayScore: null, homeHt: null, awayHt: null
      });
      const { constants } = leagueKeyFor(fixture.target.competitionName, model);
      const computed = h1FeaturesFor(target, fixture.history.map(toMatchRow).filter(isH1NormalResult), fixture.pairHistory.map(toMatchRow).filter(isH1NormalResult), constants, model.tuning);
      expect(computed, `features for ${fixture.target.matchId}`).not.toBeNull();
      for (const [name, value] of Object.entries(fixture.expected.features)) {
        const computedValue = (computed!.features as unknown as Record<string, number>)[name];
        // tolerance 1e-6: identical formulas, negligible float-association differences
        expect(computedValue).toBeCloseTo(value, 6);
      }
      expect(computed!.pLeague).toBeCloseTo(fixture.expected.pLeague, 9);
      expect(computed!.lambdaTeam).toBeCloseTo(fixture.expected.lambdaTeam, 6);
      const prediction = predictH1(model, computed!.features);
      expect(prediction.pGoal).toBeCloseTo(fixture.expected.pGoal, 6);
    }
  });

  it("derives pick and implied expectation from the probability", async () => {
    const model = await loadModel();
    const over = predictH1(model, { logit_league: 1.0, inv_recent: 0.1, inv_season: 0.1, log_lam_ratio: 0.2, h2h: 0.05, log_ft_ratio: 0.2, n_avg: 0.9 });
    expect(over.pick).toBe("over_0_5");
    expect(over.pGoal).toBeGreaterThan(0.5);
    expect(over.expectedH1Goals).toBeCloseTo(-Math.log(1 - over.pGoal), 9);
    const under = predictH1(model, { logit_league: 0.2, inv_recent: 0.2, inv_season: -0.35, log_lam_ratio: -0.6, h2h: -0.25, log_ft_ratio: -1.1, n_avg: 0.3 });
    expect(under.pGoal).toBeLessThan(0.5);
    expect(under.pick).toBe("under_0_5");
  });

  it("requires at least three halftime-scored priors per side", async () => {
    const model = await loadModel();
    const target = toMatchRow({
      matchId: "t1", competitionId: "c", competitionName: "Süper Lig", country: "", season: "2025/26",
      kickoffAtMs: new Date("2026-02-01T12:00:00Z").getTime(), status: "scheduled",
      homeId: "h1", homeTeam: "H", awayId: "a1", awayTeam: "A",
      homeScore: null, awayScore: null, homeHt: null, awayHt: null,
      homeExtra: null, awayExtra: null, homePen: null, awayPen: null
    });
    const prior = (id: string, day: number, side: "home" | "away"): H1MatchRow => toMatchRow({
      matchId: id, competitionId: "c", competitionName: "Süper Lig", country: "", season: "2025/26",
      kickoffAtMs: new Date(`2026-01-${day}T12:00:00Z`).getTime(), status: "finished",
      homeId: side === "home" ? "h1" : "a1", homeTeam: "H", awayId: side === "home" ? "x1" : "h1", awayTeam: "A",
      homeScore: 1, awayScore: 1, homeHt: 1, awayHt: 0,
      homeExtra: null, awayExtra: null, homePen: null, awayPen: null
    });
    const history = [prior("p1", 20, "home"), prior("p2", 17, "home"), prior("p3", 14, "away")];
    expect(h1FeaturesFor(target, history, [], model.leagueConstants["superlig"]!, model.tuning)).toBeNull();
  });

  it("treats halftime scores as mandatory for priors", () => {
    const base = {
      matchId: "m", competitionId: "c", competitionName: "L", country: "", season: "S",
      kickoffAtMs: 0, status: "finished", homeId: "h", homeTeam: "H", awayId: "a", awayTeam: "A",
      homeScore: 1, awayScore: 1, homeExtra: null, awayExtra: null, homePen: null, awayPen: null
    };
    expect(isH1NormalResult(toMatchRow({ ...base, homeHt: 0, awayHt: 0 }))).toBe(true);
    expect(isH1NormalResult(toMatchRow({ ...base, homeHt: null, awayHt: 0 }))).toBe(false);
    expect(isH1NormalResult(toMatchRow({ ...base, homeHt: 0, awayHt: 0, status: "after_extra_time", homeExtra: 1, awayExtra: 1 }))).toBe(false);
  });
});
