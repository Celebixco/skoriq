import { describe, expect, it, vi } from "vitest";
import { checkDatabaseReadiness } from "./db-readiness.js";
import { parseFootballMatchViewArgs, runFootballMatchView, validateFootballMatchViewOptions } from "./analytics-football-match-view.js";
import type { FootballMatchAnalyticsReport, FootballMatchViewDependencies, FootballMatchViewOptions } from "./analytics-football-match-view.js";

const baseOptions: FootballMatchViewOptions = {
  matchId: "match-1",
  json: false,
  debug: false,
  formWindowSize: 5,
  h2hWindowSize: 5
};

const baseEnv = {
  NODE_ENV: "development",
  DATABASE_URL: "postgres://user:secret@localhost:5432/sports_data"
};

describe("football match analytics viewer", () => {
  it("parses match id with text output by default", () => {
    expect(parseFootballMatchViewArgs(["--match-id=match-1"])).toEqual(baseOptions);
  });

  it("parses json, debug, and custom window flags", () => {
    expect(parseFootballMatchViewArgs(["--match-id=match-1", "--json", "--debug", "--form-window-size=10", "--h2h-window-size=3"])).toMatchObject({
      matchId: "match-1",
      json: true,
      debug: true,
      formWindowSize: 10,
      h2hWindowSize: 3
    });
  });

  it("rejects execute and rebuild because the viewer is read-only", () => {
    expect(() => parseFootballMatchViewArgs(["--match-id=match-1", "--execute"])).toThrow("Football match analytics viewer is read-only; --execute is not supported.");
    expect(() => parseFootballMatchViewArgs(["--match-id=match-1", "--rebuild"])).toThrow(
      "Football match analytics viewer does not rebuild stored features; run the dedicated builders first."
    );
  });

  it("requires match id and blocks production", () => {
    expect(() => validateFootballMatchViewOptions({ ...baseOptions, matchId: undefined }, baseEnv)).toThrow("Football match analytics viewer requires --match-id.");
    expect(() => validateFootballMatchViewOptions(baseOptions, { ...baseEnv, NODE_ENV: "production" })).toThrow("Football match analytics viewer is forbidden in production.");
  });

  it("keeps unsafe remote databases blocked through shared readiness logic", async () => {
    const result = await checkDatabaseReadiness({
      databaseUrl: "postgres://user:secret@db.example.internal/sports_data",
      nodeEnv: "development",
      connect: async () => ({ tableNames: [] })
    });

    expect(result).toMatchObject({ status: "not_ready", reason: "unsafe_target" });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("renders a readable match analytics report", async () => {
    const log = vi.fn();

    await runFootballMatchView(baseOptions, mockDependencies({ log }));

    const output = log.mock.calls.join("\n");
    expect(output).toContain("Football match analytics report");
    expect(output).toContain("Borussia Dortmund vs Freiburg");
    expect(output).toContain("prediction_eligible: yes");
    expect(output).toContain("kupon_eligible: no");
    expect(output).not.toContain("postgres://");
    expect(output).not.toContain("secret");
  });

  it("prints JSON output when requested", async () => {
    const log = vi.fn();

    await runFootballMatchView({ ...baseOptions, json: true }, mockDependencies({ log }));

    const output = log.mock.calls.join("\n");
    expect(output).toContain('"match"');
    expect(output).toContain('"prediction_eligible": true');
    expect(output).not.toContain("DATABASE_URL");
  });

  it("includes source IDs only when debug is requested", async () => {
    const withoutDebug = vi.fn();
    const withDebug = vi.fn();

    await runFootballMatchView(baseOptions, mockDependencies({ log: withoutDebug }));
    await runFootballMatchView({ ...baseOptions, debug: true }, mockDependencies({ log: withDebug }));

    expect(withoutDebug.mock.calls.join("\n")).not.toContain("home-form-1");
    expect(withDebug.mock.calls.join("\n")).toContain("home-form-1");
  });

  it("handles missing match safely", async () => {
    const result = await runFootballMatchView(baseOptions, mockDependencies({ loadReport: vi.fn().mockResolvedValue({ warnings: ["No football match found for match_id=match-1."] }) }));

    expect(result.match).toBeUndefined();
    expect(result.warnings).toContain("No football match found for match_id=match-1.");
  });

  it("handles missing feature snapshot safely", async () => {
    const result = await runFootballMatchView(
      baseOptions,
      mockDependencies({
        loadReport: vi.fn().mockResolvedValue({
          match: baseReport.match,
          warnings: ["No football_match_prediction_features row found for the selected match/windows. Build the feature snapshot first."]
        })
      })
    );

    expect(result.reasoning).toBeUndefined();
    expect(result.warnings).toContain("No football_match_prediction_features row found for the selected match/windows. Build the feature snapshot first.");
  });

  it("keeps kupon eligibility false under current policy", async () => {
    const result = await runFootballMatchView(baseOptions, mockDependencies());

    expect(result.reasoning?.kupon_eligible).toBe(false);
  });
});

const baseReport: FootballMatchAnalyticsReport = {
  match: {
    id: "match-1",
    competition_id: "competition-1",
    competition: "Bundesliga",
    country: "Germany",
    kickoff: "2026-04-26T17:30:00.000Z",
    status: "finished",
    home_team_id: "team-home",
    home_team: "Borussia Dortmund",
    away_team_id: "team-away",
    away_team: "Freiburg"
  },
  feature_snapshot: {
    feature_status: "ready",
    combined_coverage_score: 64,
    home_form_coverage_score: 70,
    away_form_coverage_score: 58,
    h2h_coverage_score: 0
  },
  reasoning: {
    match_id: "match-1",
    feature_status: "ready",
    reasoning_status: "ready_for_prediction_analysis",
    positive_signals: ["Minimum MVP feature readiness is satisfied."],
    negative_signals: [],
    risk_factors: ["Head-to-head history is missing or zero-sample, so confidence is capped."],
    missing_data_warnings: ["Head-to-head sample is unavailable for this matchup."],
    confidence_ceiling: 65,
    prediction_eligible: true,
    kupon_eligible: false,
    summary: "Feature readiness is ready; team-form coverage is sufficient for MVP prediction analysis, but missing H2H caps confidence at 65.",
    metadata: {
      h2hMissing: true,
      sampleSizes: {
        homeForm: 5,
        awayForm: 4,
        h2h: 0
      },
      coverage: {
        homeForm: 70,
        awayForm: 58,
        h2h: 0,
        combined: 64
      },
      sourceFeatureIds: {
        homeFormFeatureId: "home-form-1",
        awayFormFeatureId: "away-form-1",
        h2hFeatureId: "h2h-1"
      },
      policy: {
        predictionEligibility: "ready_rows_only",
        kuponEligibility: "disabled_no_kupon_engine"
      }
    }
  },
  warnings: ["Read-only football match analytics viewer. No provider calls, ingestion, analytics writes, scheduler work, predictions, or kupons were run."]
};

function mockDependencies(overrides: Partial<FootballMatchViewDependencies> = {}): FootballMatchViewDependencies {
  return {
    loadReport: vi.fn().mockImplementation((options: FootballMatchViewOptions) =>
      Promise.resolve(
        options.debug
          ? {
              ...baseReport,
              debug: {
                source_feature_ids: {
                  home_form_feature_id: "home-form-1",
                  away_form_feature_id: "away-form-1",
                  h2h_feature_id: "h2h-1"
                }
              }
            }
          : baseReport
      )
    ),
    log: vi.fn(),
    ...overrides
  };
}
