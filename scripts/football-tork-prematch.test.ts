import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  isTorkNormalResult, leagueKeyFor, predictTork, torkFeaturesFor, validateModelArtifact,
  type TorkMatchRow, type TorkModelDefinition
} from "./football-tork-prematch.js";
import { classifyTorkProbability, TORK_DECISION_POLICY_VERSION, TORK_DECISION_THRESHOLD, TORK_MODEL_VERSION } from "../packages/shared/src/football-tork-policy.js";

const dir = dirname(fileURLToPath(import.meta.url));

interface ParityFixtureRow {
  matchId: string; competitionId: string; competitionName: string; country: string;
  season: string; kickoffAtMs: number; status: string;
  homeId: string; homeTeam: string; awayId: string; awayTeam: string;
  homeScore: number | null; awayScore: number | null;
  homeExtra: number | null; awayExtra: number | null; homePen: number | null; awayPen: number | null;
}

function toMatchRow(row: ParityFixtureRow): TorkMatchRow {
  return {
    match_id: row.matchId, competition_id: row.competitionId, competition_name: row.competitionName,
    country: row.country, season: row.season, kickoff_at: new Date(row.kickoffAtMs), status: row.status,
    home_id: row.homeId, home_team: row.homeTeam, away_id: row.awayId, away_team: row.awayTeam,
    home_score: row.homeScore, away_score: row.awayScore,
    home_extra: row.homeExtra, away_extra: row.awayExtra, home_pen: row.homePen, away_pen: row.awayPen
  };
}

async function loadModel(): Promise<TorkModelDefinition> {
  const model = JSON.parse(await readFile(join(dir, "football-tork-model.json"), "utf8")) as TorkModelDefinition;
  validateModelArtifact(model);
  return model;
}

describe("football-tork-prematch model artifact", () => {
  it("validates the shipped model artifact", async () => {
    const model = await loadModel();
    expect(model.modelId).toBe("TORK-A");
    expect(model.modelVersion).toBe(TORK_MODEL_VERSION);
    expect(model.decisionPolicy.version).toBe(TORK_DECISION_POLICY_VERSION);
    expect(model.decisionPolicy.threshold).toBe(TORK_DECISION_THRESHOLD);
    expect(Object.keys(model.leagueConstants).length).toBe(8);
    expect(model.leagueConstants["bundesliga"]!.btts).toBeGreaterThan(0.57);
    expect(model.tuning).not.toHaveProperty("pickThreshold");
  });

  it("rejects corrupted artifacts", async () => {
    const model = await loadModel();
    expect(() => validateModelArtifact({ ...model, modelId: "WRONG" })).toThrow(/invalid_model_identity/);
    expect(() => validateModelArtifact({ ...model, weights: { ...model.weights, h2h: Number.NaN } })).toThrow(/invalid_weight/);
    expect(() => validateModelArtifact({ ...model, decisionPolicy: { ...model.decisionPolicy, threshold: Number.NaN } })).toThrow(/invalid_decision_policy/);
    expect(() => validateModelArtifact({ ...model, features: [...model.features, model.features[0]!] })).toThrow(/invalid_feature_contract/);
  });

  it("maps production competition names to league constants", async () => {
    const model = await loadModel();
    expect(leagueKeyFor("Süper Lig", model).key).toBe("superlig");
    expect(leagueKeyFor("2. Bundesliga", model).key).toBe("2bundesliga");
    expect(leagueKeyFor("Random Cup", model).key).toBe("global");
  });
});

describe("football-tork-prematch parity with validated experiment", () => {
  it("reproduces the Python feature vectors and probabilities", async () => {
    const model = await loadModel();
    const fixtures = JSON.parse(await readFile(join(dir, "fixtures/tork-parity.json"), "utf8")) as {
      fixtures: Array<{ target: { matchId: string; competitionName: string; season: string; kickoffAtMs: number; homeId: string; awayId: string };
        history: ParityFixtureRow[]; pairHistory: ParityFixtureRow[];
        expected: { features: Record<string, number>; pBtts: number; pLeague: number; lambdaHome: number; lambdaAway: number } }>;
    };
    expect(fixtures.fixtures.length).toBeGreaterThanOrEqual(8);
    for (const fixture of fixtures.fixtures) {
      const target = toMatchRow({
        ...fixture.history[0]!, matchId: fixture.target.matchId, competitionName: fixture.target.competitionName,
        season: fixture.target.season, kickoffAtMs: fixture.target.kickoffAtMs,
        homeId: fixture.target.homeId, awayId: fixture.target.awayId, status: "scheduled",
        homeScore: null, awayScore: null
      });
      const { constants } = leagueKeyFor(fixture.target.competitionName, model);
      const computed = torkFeaturesFor(
        target,
        fixture.history.map(toMatchRow).filter(isTorkNormalResult),
        fixture.pairHistory.map(toMatchRow).filter(isTorkNormalResult),
        constants, model.tuning,
        model.globalFallback.btts, model.tuning.globalHomeScoredPrior, model.tuning.globalAwayScoredPrior,
        (1 - Math.exp(-model.globalFallback.gfHome)) * (1 - Math.exp(-model.globalFallback.gfAway)));
      expect(computed, `features for ${fixture.target.matchId}`).not.toBeNull();
      for (const [name, value] of Object.entries(fixture.expected.features)) {
        expect((computed!.features as unknown as Record<string, number>)[name]).toBeCloseTo(value, 6);
      }
      expect(computed!.pLeague).toBeCloseTo(fixture.expected.pLeague, 6);
      expect(computed!.lambdaHome).toBeCloseTo(fixture.expected.lambdaHome, 6);
      expect(computed!.lambdaAway).toBeCloseTo(fixture.expected.lambdaAway, 6);
      const prediction = predictTork(model, computed!.features);
      expect(prediction.pBtts).toBeCloseTo(fixture.expected.pBtts, 6);
    }
  });

  it("derives pick from the probability threshold", async () => {
    const model = await loadModel();
    const yes = predictTork(model, { logit_league: 0.2, logit_poisson: 0.4, btts_season: 0.15, cross_score: 0.1, cross_emp: 0.1, h2h: 0.1, log_asym: 0.0 });
    expect(yes.pick).toBe("btts_yes");
    expect(yes.pBtts).toBeGreaterThan(0.55);
    expect(yes.pBtts).toBeGreaterThan(0.5);
    const no = predictTork(model, { logit_league: -0.4, logit_poisson: -0.6, btts_season: -0.3, cross_score: -0.2, cross_emp: -0.2, h2h: -0.2, log_asym: 0.9 });
    expect(no.pick).toBe("btts_no");
    expect(no.pBtts).toBeLessThan(0.55);
    expect(no.pBtts).toBeLessThan(0.5);
  });

  it("uses the shared equal-cost binary threshold and rejects invalid probabilities", async () => {
    expect(classifyTorkProbability(0.5)).toBe("btts_yes");
    expect(classifyTorkProbability(0.499999)).toBe("btts_no");
    expect(() => classifyTorkProbability(Number.NaN)).toThrow(/invalid_tork_probability/);
    expect(() => classifyTorkProbability(0.5, Number.NaN)).toThrow(/invalid_tork_threshold/);
    const model = await loadModel();
    const balanced = predictTork(model, { logit_league: 0, logit_poisson: 0, btts_season: 0, cross_score: 0, cross_emp: 0, h2h: 0, log_asym: 0 });
    expect(balanced.pBtts).toBe(0.5);
    expect(balanced.pick).toBe("btts_yes");
  });

  it("requires fulltime-scored priors only from normal results", () => {
    const base = {
      matchId: "m", competitionId: "c", competitionName: "L", country: "", season: "S",
      kickoffAtMs: 0, status: "finished", homeId: "h", homeTeam: "H", awayId: "a", awayTeam: "A",
      homeExtra: null, awayExtra: null, homePen: null, awayPen: null
    };
    expect(isTorkNormalResult(toMatchRow({ ...base, homeScore: 1, awayScore: 1 }))).toBe(true);
    expect(isTorkNormalResult(toMatchRow({ ...base, homeScore: null, awayScore: 1 }))).toBe(false);
    expect(isTorkNormalResult(toMatchRow({ ...base, homeScore: 2, awayScore: 2, status: "after_extra_time" }))).toBe(false);
  });
});
