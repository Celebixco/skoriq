import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolveCompetitionScope, normalizeCompetitionText } from "./football-rc-scope.js";
import { applyPreprocessor, featureVector, pick, prior, validateModelArtifact, validateProbabilities } from "./football-rc-prematch.js";

const rows = [
  { competition_id: "super", name: "Trendyol Süper Lig", country: "Türkiye" },
  { competition_id: "pl", name: "Premier League", country: "England" },
  { competition_id: "serie", name: "Serie A", country: "Italy" },
  { competition_id: "serie-b", name: "Serie B", country: "Italy" },
  { competition_id: "europa", name: "UEFA Europa League", country: "Europe" }
];

function match(overrides: Record<string, unknown>) {
  return {
    match_id: "m", competition_id: "super", competition_name: "Trendyol Süper Lig", country: "Türkiye",
    source_event_id: null, season: "26/27", kickoff_at: new Date("2026-09-01T17:00:00Z"), status: "finished",
    home_id: "team-a", home_team: "A", away_id: "team-b", away_team: "B",
    home_score: 2, away_score: 1, home_extra: null, away_extra: null, home_pen: null, away_pen: null,
    ...overrides
  };
}

describe("multi-league R-C scope", () => {
  it("maps only reviewed/enabled national leagues to production competition ids", async () => {
    const scope = await resolveCompetitionScope({ query: async () => ({ rows }) } as never);
    expect(scope.approved.map((entry) => entry.competitionId)).toEqual(["super", "pl", "serie"]);
    expect(scope.approved.some((entry) => entry.name === "Serie B")).toBe(false);
    expect(scope.excluded.map((entry) => entry.name)).toContain("Serie B");
    expect(scope.approved.some((entry) => entry.name.includes("Europa"))).toBe(false);
    expect(normalizeCompetitionText("SÃ¼per Lig")).toBe(normalizeCompetitionText("Süper Lig"));
  });

  it("keeps same-club history inside its own competition", () => {
    const target = match({ match_id: "target", kickoff_at: new Date("2026-10-20T17:00:00Z"), status: "scheduled", home_score: null, away_score: null });
    const history = [
      match({ match_id: "a1", competition_id: "super", kickoff_at: new Date("2026-09-01T17:00:00Z") }),
      match({ match_id: "a2", competition_id: "super", kickoff_at: new Date("2026-09-08T17:00:00Z") }),
      match({ match_id: "a3", competition_id: "super", kickoff_at: new Date("2026-09-15T17:00:00Z") }),
      match({ match_id: "b1", competition_id: "pl", kickoff_at: new Date("2026-09-02T17:00:00Z") }),
      match({ match_id: "b2", competition_id: "pl", kickoff_at: new Date("2026-09-09T17:00:00Z") })
    ];
    const filtered = prior(history, "super", "team-a", target.kickoff_at, new Date("2026-10-19T17:00:00Z"));
    expect(filtered.map((row) => row.match_id)).toEqual(["a1", "a2", "a3"]);
    const features = featureVector(target as never, history as never, {} as never);
    expect(features.homeN).toBe(3);
    expect(features.awayN).toBe(3);
    expect(features.scope).toBe("partial_history_unverified");
  });

  it("uses argmax with class-order tie behavior", () => {
    expect(pick([0.5, 0.3, 0.2])).toBe("1");
    expect(pick([0.2, 0.5, 0.3])).toBe("X");
    expect(pick([0.2, 0.3, 0.5])).toBe("2");
    expect(pick([0.4, 0.4, 0.2])).toBe("1");
  });

  it("accepts valid probability vectors and preserves class order", () => {
    expect(pick([0.5, 0.3, 0.2])).toBe("1");
    expect(pick([0.2, 0.5, 0.3])).toBe("X");
    expect(pick([0.2, 0.3, 0.5])).toBe("2");
    expect(() => validateProbabilities([0.4, 0.3, 0.3000000005])).not.toThrow();
  });

  it("rejects malformed model artifacts and missing feature values", () => {
    const model = JSON.parse(readFileSync(new URL("./football-rc-model.json", import.meta.url), "utf8"));
    expect(() => validateModelArtifact(model)).not.toThrow();
    expect(() => validateModelArtifact({ ...model, classOrder: ["X", "1", "2"] })).toThrow();
    expect(() => validateModelArtifact({ ...model, preprocessor: { ...model.preprocessor, std: model.preprocessor.std.map((v: number, i: number) => i === 0 ? 0 : v) } })).toThrow();
    expect(() => applyPreprocessor({}, model)).toThrow("missing_required_feature");
  });

  it("rejects invalid probability vectors instead of defaulting to home", () => {
    for (const invalid of [[], [NaN, 0.5, 0.5], [0, 0, 0], [0.5, 0.5, 0.5], [0.5, -0.1, 0.6], [0.5, 0.6], [Infinity, 0, 0]]) {
      expect(() => validateProbabilities(invalid as number[])).toThrow();
      expect(() => pick(invalid as number[])).toThrow();
    }
  });
});
