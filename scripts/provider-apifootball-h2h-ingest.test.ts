import { describe, expect, it } from "vitest";
import {
  buildH2HIngestPlan,
  evaluateH2HPartialExecutePolicy,
  parseAPIFootballH2HIngestArgs,
  validateAPIFootballH2HIngestOptions
} from "./provider-apifootball-h2h-ingest.js";
import type { ResolvedH2HTarget } from "./provider-apifootball-h2h-evidence.js";

const target: ResolvedH2HTarget = {
  matchId: "12acd83e-ca54-4444-9c67-a03cfbc70bcf",
  competitionId: "competition-1",
  competitionName: "Premier League",
  canonicalHomeTeamId: "arsenal-canonical",
  canonicalAwayTeamId: "fulham-canonical",
  homeTeamName: "Arsenal FC",
  awayTeamName: "Fulham",
  kickoffAt: "2026-05-02T18:30:00.000Z",
  homeProviderTeamId: "141",
  awayProviderTeamId: "3085",
  providerMatchId: "619815"
};

const mappings = {
  competitionByProviderId: { "152": "competition-1" },
  teamByProviderId: { "141": "arsenal-canonical", "3085": "fulham-canonical" }
};

describe("APIFootball H2H ingest command", () => {
  it("parses dry-run by default and execute explicitly", () => {
    expect(parseAPIFootballH2HIngestArgs(["--match-id=match-1"])).toEqual({ matchId: "match-1", execute: false, allowPartial: false, minimumCleanRows: 3 });
    expect(parseAPIFootballH2HIngestArgs(["--match-id=match-1", "--execute", "--allow-partial", "--minimum-clean-rows=5"])).toEqual({
      matchId: "match-1",
      execute: true,
      allowPartial: true,
      minimumCleanRows: 5
    });
  });

  it("rejects missing match id", () => {
    expect(() => validateAPIFootballH2HIngestOptions({ execute: false, allowPartial: false, minimumCleanRows: 3 }, baseEnv())).toThrow("requires --match-id");
  });

  it("refuses production/main execution context", () => {
    expect(() =>
      validateAPIFootballH2HIngestOptions({ matchId: "match-1", execute: true, allowPartial: false, minimumCleanRows: 3 }, { ...baseEnv(), NODE_ENV: "production" })
    ).toThrow("forbidden in production");
  });

  it("rejects invalid minimum clean rows", () => {
    expect(() => parseAPIFootballH2HIngestArgs(["--match-id=match-1", "--minimum-clean-rows=0"])).toThrow("positive integer");
  });

  it("plans clean H2H rows for match and score normalization", () => {
    const plan = buildH2HIngestPlan(
      [
        {
          match_id: "h2h-1",
          league_id: "152",
          match_date: "2025-10-18",
          match_time: "17:30",
          match_status: "Finished",
          match_hometeam_id: "3085",
          match_hometeam_name: "Fulham",
          match_hometeam_score: "1",
          match_awayteam_id: "141",
          match_awayteam_name: "Arsenal FC",
          match_awayteam_score: "2",
          match_hometeam_halftime_score: "0",
          match_awayteam_halftime_score: "1"
        }
      ],
      target,
      mappings
    );

    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({
      action: "normalize",
      providerMatchId: "h2h-1",
      canonicalCompetitionId: "competition-1",
      canonicalHomeTeamId: "fulham-canonical",
      canonicalAwayTeamId: "arsenal-canonical",
      homeScoreFulltime: 1,
      awayScoreFulltime: 2,
      homeScoreHalftime: 0,
      awayScoreHalftime: 1
    });
  });

  it("blocks unresolved rows instead of fabricating team or competition IDs", () => {
    const plan = buildH2HIngestPlan(
      [
        {
          match_id: "h2h-2",
          league_id: "999",
          match_date: "2025-10-18",
          match_hometeam_id: "9999",
          match_hometeam_score: "1",
          match_awayteam_id: "141",
          match_awayteam_score: "2"
        }
      ],
      target,
      mappings
    );

    expect(plan[0]).toMatchObject({
      action: "skip",
      skipReason: "h2h_team_not_in_target_pair"
    });
  });

  it("blocks execute when score fields are unparseable", () => {
    const plan = buildH2HIngestPlan(
      [
        {
          match_id: "h2h-3",
          league_id: "152",
          match_date: "2025-10-18",
          match_hometeam_id: "3085",
          match_hometeam_score: "x",
          match_awayteam_id: "141",
          match_awayteam_score: "2"
        }
      ],
      target,
      mappings
    );

    expect(plan[0]).toMatchObject({
      action: "skip",
      skipReason: "missing_or_unparseable_fulltime_score"
    });
  });

  it("keeps strict default blocking when any skipped row exists", () => {
    const policy = evaluateH2HPartialExecutePolicy([cleanRow("h2h-1"), cleanRow("h2h-2"), cleanRow("h2h-3"), skippedRow("h2h-4", "missing_competition_mapping")], {
      allowPartial: false,
      minimumCleanRows: 3
    });

    expect(policy).toMatchObject({
      totalH2hRows: 4,
      cleanRows: 3,
      skippedRows: 1,
      skippedReasons: { missing_competition_mapping: 1 },
      executeSafe: false,
      blockReason: "unresolved_rows_present_strict_mode"
    });
  });

  it("allows partial execute when skipped rows are non-critical and clean sample meets threshold", () => {
    const policy = evaluateH2HPartialExecutePolicy(
      [cleanRow("h2h-1"), cleanRow("h2h-2"), cleanRow("h2h-3"), skippedRow("h2h-4", "missing_competition_mapping")],
      { allowPartial: true, minimumCleanRows: 3 }
    );

    expect(policy).toMatchObject({
      cleanRows: 3,
      skippedRows: 1,
      executeSafe: true
    });
  });

  it("blocks partial execute when clean rows are below the minimum", () => {
    const policy = evaluateH2HPartialExecutePolicy([cleanRow("h2h-1"), skippedRow("h2h-2", "missing_competition_mapping")], {
      allowPartial: true,
      minimumCleanRows: 3
    });

    expect(policy).toMatchObject({
      cleanRows: 1,
      skippedRows: 1,
      skippedReasons: { missing_competition_mapping: 1, clean_rows_below_minimum: 1 },
      executeSafe: false,
      blockReason: "clean_rows_below_minimum"
    });
  });

  it("blocks execute when clean rows are below minimum even without skipped rows", () => {
    const policy = evaluateH2HPartialExecutePolicy([cleanRow("h2h-1")], {
      allowPartial: true,
      minimumCleanRows: 3
    });

    expect(policy).toMatchObject({
      totalH2hRows: 1,
      cleanRows: 1,
      skippedRows: 0,
      skippedReasons: { clean_rows_below_minimum: 1 },
      executeSafe: false,
      blockReason: "clean_rows_below_minimum"
    });
  });

  it("allows execute at the minimum clean row threshold when no other blockers exist", () => {
    const policy = evaluateH2HPartialExecutePolicy([cleanRow("h2h-1"), cleanRow("h2h-2"), cleanRow("h2h-3")], {
      allowPartial: false,
      minimumCleanRows: 3
    });

    expect(policy).toMatchObject({
      cleanRows: 3,
      skippedRows: 0,
      executeSafe: true
    });
  });

  it("blocks partial execute for missing team mappings", () => {
    const policy = evaluateH2HPartialExecutePolicy([cleanRow("h2h-1"), cleanRow("h2h-2"), cleanRow("h2h-3"), skippedRow("h2h-4", "team_mapping_missing")], {
      allowPartial: true,
      minimumCleanRows: 3
    });

    expect(policy.executeSafe).toBe(false);
    expect(policy.blockReason).toContain("team_mapping_missing");
  });

  it("blocks partial execute for unstable provider match IDs", () => {
    const policy = evaluateH2HPartialExecutePolicy([cleanRow("h2h-1"), cleanRow("h2h-2"), cleanRow("h2h-3"), skippedRow(undefined, "missing_provider_match_id")], {
      allowPartial: true,
      minimumCleanRows: 3
    });

    expect(policy.executeSafe).toBe(false);
    expect(policy.blockReason).toContain("missing_provider_match_id");
  });
});

function cleanRow(providerMatchId: string) {
  return {
    providerMatchId,
    action: "normalize" as const,
    canonicalCompetitionId: "competition-1",
    canonicalHomeTeamId: "home-team",
    canonicalAwayTeamId: "away-team",
    homeScoreFulltime: 1,
    awayScoreFulltime: 0,
    scheduledStartAt: "2025-01-01T00:00:00.000Z"
  };
}

function skippedRow(providerMatchId: string | undefined, skipReason: string) {
  return {
    providerMatchId,
    action: "skip" as const,
    skipReason
  };
}

function baseEnv(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "development",
    APIFOOTBALL_COM_ENABLED: "true",
    DATABASE_URL: "postgres://user:pass@localhost:5432/test"
  };
}
