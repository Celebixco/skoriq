import { describe, expect, it } from "vitest";
import {
  parseUpcomingH2HBackfillArgs,
  runUpcomingH2HBackfill,
  selectUpcomingH2HMatches,
  validateUpcomingH2HBackfillOptions
} from "./provider-apifootball-h2h-backfill-upcoming.js";
import type { APIFootballH2HIngestReport } from "./provider-apifootball-h2h-ingest.js";
import type { ManualLeagueReviewConfig } from "./provider-apifootball-manual-ingest.js";

const reviewedLeague: ManualLeagueReviewConfig = {
  provider: "apifootball-com",
  sport: "football",
  countryId: "44",
  leagueId: "152",
  countryName: "England",
  leagueName: "Premier League",
  enabled: true,
  reviewed: true,
  dryRunAllowed: true,
  priority: "high",
  notes: "Test reviewed league."
};

const reviewCandidate: ManualLeagueReviewConfig = {
  ...reviewedLeague,
  countryId: "1",
  leagueId: "2",
  enabled: false,
  reviewed: false,
  notes: "Test candidate."
};

describe("APIFootball upcoming H2H backfill runner", () => {
  it("parses dry-run defaults and execute flags", () => {
    expect(parseUpcomingH2HBackfillArgs(["--country-id=44", "--league-id=152"])).toMatchObject({
      countryId: "44",
      leagueId: "152",
      execute: false,
      limit: 20,
      allowPartial: false,
      minimumCleanRows: 3
    });
    expect(
      parseUpcomingH2HBackfillArgs(["--country-id=44", "--league-id=152", "--execute", "--allow-partial", "--limit=5", "--minimum-clean-rows=4"])
    ).toMatchObject({
      execute: true,
      allowPartial: true,
      limit: 5,
      minimumCleanRows: 4
    });
  });

  it("allows reviewed/enabled leagues", () => {
    expect(() => validateUpcomingH2HBackfillOptions(baseOptions(), baseEnv(), [reviewedLeague])).not.toThrow();
  });

  it("blocks review candidates and unknown leagues", () => {
    expect(() => validateUpcomingH2HBackfillOptions({ ...baseOptions(), countryId: "1", leagueId: "2" }, baseEnv(), [reviewCandidate])).toThrow(
      "requires reviewed=true and enabled=true"
    );
    expect(() => validateUpcomingH2HBackfillOptions({ ...baseOptions(), countryId: "9", leagueId: "9" }, baseEnv(), [reviewedLeague])).toThrow(
      "limited to configured reviewed and enabled leagues"
    );
  });

  it("filters by limit and date range", () => {
    const selected = selectUpcomingH2HMatches(sampleMatches(), { from: "2026-05-02", to: "2026-05-03", limit: 2 }, new Date("2026-05-01T00:00:00.000Z"));
    expect(selected.map((match) => match.matchId)).toEqual(["m2", "m3"]);
  });

  it("filters by window hours when no date range is provided", () => {
    const selected = selectUpcomingH2HMatches(sampleMatches(), { windowHours: 24, limit: 20 }, new Date("2026-05-01T12:00:00.000Z"));
    expect(selected.map((match) => match.matchId)).toEqual(["m1"]);
  });

  it("dry-run writes nothing and passes allowPartial through", async () => {
    const report = await runUpcomingH2HBackfill(
      { ...baseOptions(), allowPartial: true },
      {
        loadUpcomingMatches: async () => sampleMatches().slice(0, 1),
        runOneMatch: async ({ execute, allowPartial }) => fakeReport({ execute, allowPartial, executeSafe: true }),
      },
      [reviewedLeague]
    );

    expect(report.mode).toBe("dry-run");
    expect(report.matches[0]).toMatchObject({
      executeSafe: true,
      executed: false,
      matchesWritten: 0,
      scoreRowsWritten: 0
    });
    expect(report.allowPartial).toBe(true);
    expect(report.executedMatches).toBe(0);
  });

  it("execute only writes safe matches and skips unsafe ones without failing whole run", async () => {
    const report = await runUpcomingH2HBackfill(
      { ...baseOptions(), execute: true, allowPartial: true },
      {
        loadUpcomingMatches: async () => sampleMatches().slice(0, 2),
        runOneMatch: async ({ matchId, execute, allowPartial }) =>
          matchId === "m1" ? fakeReport({ execute, allowPartial, executeSafe: true }) : fakeReport({ execute, allowPartial, executeSafe: false })
      },
      [reviewedLeague]
    );

    expect(report.executedMatches).toBe(1);
    expect(report.skippedMatches).toBe(1);
    expect(report.matches[0]).toMatchObject({ executed: true, matchesWritten: 3, scoreRowsWritten: 3 });
    expect(report.matches[1]).toMatchObject({ executed: false, matchesWritten: 0, scoreRowsWritten: 0 });
  });

  it("marks low clean-row matches unsafe in batch reports", async () => {
    const report = await runUpcomingH2HBackfill(
      { ...baseOptions(), allowPartial: true, minimumCleanRows: 3 },
      {
        loadUpcomingMatches: async () => sampleMatches().slice(0, 1),
        runOneMatch: async ({ execute, allowPartial }) =>
          fakeReport({
            execute,
            allowPartial,
            executeSafe: false,
            cleanRows: 1,
            skippedRows: 0,
            skippedReasons: { clean_rows_below_minimum: 1 },
            blockReason: "clean_rows_below_minimum"
          })
      },
      [reviewedLeague]
    );

    expect(report.executeSafeMatches).toBe(0);
    expect(report.matches[0]).toMatchObject({
      cleanRows: 1,
      skippedRows: 0,
      skippedReasons: { clean_rows_below_minimum: 1 },
      executeSafe: false,
      blockReason: "clean_rows_below_minimum",
      executed: false,
      matchesWritten: 0,
      scoreRowsWritten: 0
    });
  });

  it("does not expose API keys in sanitized match errors", async () => {
    const report = await runUpcomingH2HBackfill(
      baseOptions(),
      {
        loadUpcomingMatches: async () => sampleMatches().slice(0, 1),
        runOneMatch: async () => {
          throw new Error("safeRequestUrl=https://example.test/?APIkey=secret-value&action=get_H2H");
        }
      },
      [reviewedLeague]
    );

    expect(JSON.stringify(report)).not.toContain("secret-value");
    expect(report.matches[0].errorMessage).toContain("APIkey=<redacted>");
  });
});

function baseOptions() {
  return {
    countryId: "44",
    leagueId: "152",
    limit: 20,
    allowPartial: false,
    minimumCleanRows: 3,
    execute: false
  };
}

function baseEnv(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "development",
    APIFOOTBALL_COM_ENABLED: "true",
    APIFOOTBALL_COM_API_KEY_EVENTS: "test-events-key"
  };
}

function sampleMatches() {
  return [
    { matchId: "m1", matchLabel: "Team A vs Team B", kickoffAt: "2026-05-01T18:00:00.000Z" },
    { matchId: "m2", matchLabel: "Team C vs Team D", kickoffAt: "2026-05-02T18:00:00.000Z" },
    { matchId: "m3", matchLabel: "Team E vs Team F", kickoffAt: "2026-05-03T18:00:00.000Z" }
  ];
}

function fakeReport(input: {
  execute: boolean;
  allowPartial: boolean;
  executeSafe: boolean;
  cleanRows?: number;
  skippedRows?: number;
  skippedReasons?: Record<string, number>;
  blockReason?: string;
}): APIFootballH2HIngestReport {
  const cleanRows = input.cleanRows ?? 3;
  const skippedRows = input.skippedRows ?? (input.executeSafe ? 1 : 4);
  const skippedReasons = input.skippedReasons ?? (input.executeSafe ? { missing_competition_mapping: 1 } : { team_mapping_missing: 4 });
  return {
    mode: input.execute ? "execute" : "dry-run",
    providerAction: "get_H2H",
    credentialLabel: "events",
    target: {
      matchId: "m1",
      competitionId: "competition-1",
      competitionName: "Premier League",
      canonicalHomeTeamId: "home",
      canonicalAwayTeamId: "away",
      homeTeamName: "Team A",
      awayTeamName: "Team B",
      kickoffAt: "2026-05-01T18:00:00.000Z",
      homeProviderTeamId: "1",
      awayProviderTeamId: "2"
    },
    totalH2hRows: 4,
    cleanRows,
    skippedRows,
    skippedReasons,
    allowPartial: input.allowPartial,
    minimumCleanRows: 3,
    executeSafe: input.executeSafe,
    blockReason: input.blockReason,
    h2hFetchedCount: 4,
    stableH2HMatchIdsCount: 4,
    stableHomeAwayProviderTeamIdsCount: 4,
    canonicalTeamMappingCount: 4,
    fulltimeScoreFieldsPresentCount: 4,
    halftimeScoreFieldsPresentCount: 4,
    unresolvedSkippedRows: skippedRows,
    wouldInsertOrUpdateMatches: cleanRows,
    wouldInsertOrUpdateScores: cleanRows,
    matchesInsertedOrUpdated: input.execute && input.executeSafe ? cleanRows : 0,
    footballMatchScoresInsertedOrUpdated: input.execute && input.executeSafe ? cleanRows : 0,
    providerMatchMappingsCreated: input.execute && input.executeSafe ? cleanRows : 0,
    providerMatchMappingsReused: 0,
    rawPayloadPersistenceCount: 0,
    dbWritesCount: input.execute && input.executeSafe ? cleanRows * 3 : 0,
    secretExposureCheck: "clean",
    cleanEnoughForFutureExecute: input.executeSafe,
    rows: [],
    warnings: input.executeSafe ? [] : ["Execute blocked."]
  };
}
