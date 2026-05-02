import { describe, expect, it, vi } from "vitest";
import {
  parseHistoricalBackfillArgs,
  runHistoricalBackfill,
  splitDateRange,
  validateHistoricalBackfillOptions
} from "./provider-apifootball-backfill-history.js";
import type { HistoricalBackfillOptions } from "./provider-apifootball-backfill-history.js";
import type { ManualIngestionRunResult, ManualLeagueReviewConfig } from "./provider-apifootball-manual-ingest.js";

const baseOptions: HistoricalBackfillOptions = {
  countryId: "44",
  leagueId: "152",
  from: "2026-04-01",
  to: "2026-04-28",
  batchDays: 14,
  stopAfterEmptyBatches: 2,
  execute: false
};

const baseEnv = {
  NODE_ENV: "development",
  APIFOOTBALL_COM_ENABLED: "true",
  APIFOOTBALL_COM_API_KEY_EVENTS: "test-events-key"
} as NodeJS.ProcessEnv;

const configs: ManualLeagueReviewConfig[] = [
  {
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
  },
  {
    provider: "apifootball-com",
    sport: "football",
    countryId: "6",
    leagueId: "302",
    countryName: "Spain",
    leagueName: "La Liga",
    enabled: false,
    reviewed: false,
    dryRunAllowed: true,
    priority: "high",
    notes: "Test review candidate."
  }
];

describe("APIFootball.com historical backfill runner", () => {
  it("parses dry-run defaults", () => {
    expect(parseHistoricalBackfillArgs(["--country-id=44", "--league-id=152", "--from=2026-04-01", "--to=2026-04-28"])).toMatchObject({
      countryId: "44",
      leagueId: "152",
      batchDays: 14,
      stopAfterEmptyBatches: 2,
      execute: false
    });
  });

  it("allows reviewed/enabled leagues", () => {
    expect(() => validateHistoricalBackfillOptions(baseOptions, baseEnv, configs)).not.toThrow();
  });

  it("blocks review-candidate leagues", () => {
    expect(() => validateHistoricalBackfillOptions({ ...baseOptions, countryId: "6", leagueId: "302" }, baseEnv, configs)).toThrow(
      "APIFootball.com historical backfill requires reviewed=true and enabled=true."
    );
  });

  it("blocks unknown leagues", () => {
    expect(() => validateHistoricalBackfillOptions({ ...baseOptions, leagueId: "999" }, baseEnv, configs)).toThrow(
      "APIFootball.com historical backfill is limited to configured reviewed and enabled leagues."
    );
  });

  it("blocks production", () => {
    expect(() => validateHistoricalBackfillOptions(baseOptions, { ...baseEnv, NODE_ENV: "production" }, configs)).toThrow(
      "APIFootball.com historical backfill is forbidden in production."
    );
  });

  it("uses max 14-day batch splitting", () => {
    expect(splitDateRange("2026-04-01", "2026-04-30", 14)).toEqual([
      { from: "2026-04-01", to: "2026-04-14" },
      { from: "2026-04-15", to: "2026-04-28" },
      { from: "2026-04-29", to: "2026-04-30" }
    ]);
    expect(() => validateHistoricalBackfillOptions({ ...baseOptions, batchDays: 15 }, baseEnv, configs)).toThrow("14 days or fewer");
  });

  it("dry-run writes nothing", async () => {
    const runManualBatch = vi.fn().mockResolvedValue(manualResult({ events: 3, scores: 3 }));
    const result = await runHistoricalBackfill(baseOptions, { runManualBatch }, configs);

    expect(runManualBatch).toHaveBeenCalledWith({ from: "2026-04-01", to: "2026-04-14", execute: false });
    expect(runManualBatch).not.toHaveBeenCalledWith(expect.objectContaining({ execute: true }));
    expect(result.totalExecutedBatches).toBe(0);
    expect(result.totalMatchesInsertedOrUpdated).toBe(0);
  });

  it("--execute runs dry-run then execute for a clean batch", async () => {
    const runManualBatch = vi
      .fn()
      .mockResolvedValueOnce(manualResult({ events: 4, scores: 4 }))
      .mockResolvedValueOnce(manualResult({ events: 4, scores: 4, mode: "execute" }));
    const queryFinishedMatchCount = vi.fn().mockResolvedValue(40);

    const result = await runHistoricalBackfill({ ...baseOptions, from: "2026-04-01", to: "2026-04-01", execute: true }, { runManualBatch, queryFinishedMatchCount }, configs);

    expect(runManualBatch.mock.calls.map(([input]) => input.execute)).toEqual([false, true]);
    expect(result.totalExecutedBatches).toBe(1);
    expect(result.totalMatchesInsertedOrUpdated).toBe(8);
  });

  it("stops when unresolved rows appear", async () => {
    const result = await runHistoricalBackfill(baseOptions, { runManualBatch: vi.fn().mockResolvedValue(manualResult({ events: 2, scores: 2, unresolved: 1 })) }, configs);

    expect(result.stopReason).toBe("unresolved_rows");
    expect(result.totalBatchesProcessed).toBe(1);
  });

  it("stops after configured empty batches", async () => {
    const result = await runHistoricalBackfill(
      { ...baseOptions, stopAfterEmptyBatches: 2 },
      { runManualBatch: vi.fn().mockRejectedValue(new Error('APIFootball.com rate_limit_or_plan failure: No event found (please check your plan)! Request URL: https://example.test/?APIkey=<redacted>')) },
      configs
    );

    expect(result.stopReason).toBe("empty_batch_limit_reached");
    expect(result.totalEmptyBatches).toBe(2);
    expect(JSON.stringify(result)).toContain("APIkey=<redacted>");
  });

  it("stops when target finished count is reached", async () => {
    const queryFinishedMatchCount = vi.fn().mockResolvedValue(50);
    const result = await runHistoricalBackfill(
      { ...baseOptions, targetFinished: 50 },
      { runManualBatch: vi.fn().mockResolvedValue(manualResult({ events: 2, scores: 2 })), queryFinishedMatchCount },
      configs
    );

    expect(result.stopReason).toBe("target_finished_reached");
    expect(result.finalFinishedMatchCount).toBe(50);
  });

  it("does not include API keys in output", async () => {
    const log = vi.fn();
    await runHistoricalBackfill(baseOptions, { runManualBatch: vi.fn().mockResolvedValue(manualResult({ events: 1, scores: 1 })), log }, configs);

    expect(log.mock.calls.map((call) => call.join(" ")).join("\n")).not.toContain("test-events-key");
  });
});

function manualResult(input: { events: number; scores: number; unresolved?: number; mode?: "dry-run" | "execute" }): ManualIngestionRunResult {
  const mode = input.mode ?? "dry-run";
  return {
    mode,
    operations: [
      {
        operation: "events",
        entityType: "match",
        providerOperation: "list_finished_matches",
        fetchedCount: input.events,
        mappedCount: input.events,
        unresolvedRowsCount: input.unresolved ?? 0
      },
      {
        operation: "scores",
        entityType: "football_match_score",
        providerOperation: "get_football_match_score",
        fetchedCount: input.scores,
        mappedCount: input.scores,
        unresolvedRowsCount: 0
      }
    ],
    totals: {
      countriesCount: 0,
      leaguesCount: 0,
      teamsCount: 0,
      teamsWithLogoCount: 0,
      eventsCount: input.events,
      eventsWithStableHomeAwayIdsCount: input.events,
      scoresCount: input.scores,
      standingsCount: 0,
      unresolvedRowsCount: input.unresolved ?? 0
    },
    notes: [],
    ingestionRunReport: {
      provider: "apifootball-com",
      mode,
      country_id: "44",
      league_id: "152",
      league_name: "Premier League",
      from: "2026-04-01",
      to: "2026-04-14",
      operations: ["events", "scores"],
      countries_count: 0,
      leagues_count: 0,
      teams_count: 0,
      teams_with_logos_count: 0,
      team_logo_coverage_percentage: 0,
      events_count: input.events,
      stable_events_count: input.events,
      scores_count: input.scores,
      standings_count: 0,
      unresolved_skipped_rows_count: input.unresolved ?? 0,
      started_at: "2026-05-01T00:00:00.000Z",
      finished_at: "2026-05-01T00:00:01.000Z",
      duration_ms: 1000,
      result: input.unresolved ? "partial" : "success",
      warnings: [],
      safe_sanitized_command_context: {
        provider: "apifootball-com",
        mode,
        country_id: "44",
        league_id: "152",
        league_name: "Premier League",
        from: "2026-04-01",
        to: "2026-04-14",
        operations: ["events", "scores"],
        execute: mode === "execute",
        verify_after: false,
        report_json: false
      }
    }
  };
}
