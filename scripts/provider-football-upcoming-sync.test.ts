import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderFetchResult } from "@sports-data/providers";
import type { ManualLeagueReviewConfig } from "./apifootball-manual-league-config.js";
import {
  buildUpcomingDiagnostics,
  classifyUpcomingUnresolvedEvent,
  filterUpcomingProviderResult,
  parseUpcomingSyncArgs,
  resolveUpcomingSyncLeagues,
  runUpcomingSync
} from "./provider-football-upcoming-sync.js";

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
  notes: "reviewed"
};

const reviewCandidate: ManualLeagueReviewConfig = {
  ...reviewedLeague,
  countryId: "82",
  leagueId: "999",
  leagueName: "Candidate League",
  enabled: false,
  reviewed: false,
  dryRunAllowed: true
};

describe("football upcoming fixture sync", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NODE_ENV: "test",
      APIFOOTBALL_COM_ENABLED: "true",
      APIFOOTBALL_COM_API_KEY_DEFAULT: "test-key",
      APIFOOTBALL_COM_BASE_URL: "https://example.test",
      APIFOOTBALL_COM_TIMEOUT_MS: "1000"
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("parses dry-run defaults without enabling execute", () => {
    expect(parseUpcomingSyncArgs(["--all-reviewed-enabled"])).toMatchObject({
      execute: false,
      allReviewedEnabled: true,
      windowDays: 5,
      limit: 200,
      maxRuntimeSeconds: 300
    });
  });

  it("limits upcoming sync to reviewed and enabled leagues", () => {
    expect(resolveUpcomingSyncLeagues({ allReviewedEnabled: true, limit: 200 }, [reviewedLeague, reviewCandidate])).toEqual([reviewedLeague]);
    expect(() => resolveUpcomingSyncLeagues({ allReviewedEnabled: false, countryId: "82", leagueId: "999", limit: 200 }, [reviewedLeague, reviewCandidate])).toThrow(
      "reviewed and enabled"
    );
    expect(() => resolveUpcomingSyncLeagues({ allReviewedEnabled: false, countryId: "1", leagueId: "1", limit: 200 }, [reviewedLeague])).toThrow(
      "configured reviewed and enabled"
    );
  });

  it.each([
    ["18", "live_numeric_status"],
    ["90+", "live_minute_status"],
    ["45+", "live_minute_status"],
    ["90+3", "live_minute_status"],
    ["After Pen.", "after_pen"]
  ])("classifies %s as a safe non-upcoming skip", (status, reason) => {
    expect(
      classifyUpcomingUnresolvedEvent("events", {
        match_id: `match-${status}`,
        league_id: "152",
        match_status: status,
        match_live: /^\d+$/.test(status) ? "1" : "0",
        match_hometeam_id: "1",
        match_awayteam_id: "2"
      })
    ).toMatchObject({
      canonicalStatusDecision: status === "18" || status.includes("+") || status === "After Pen." ? "unsupported" : expect.any(String),
      reason
    });
  });

  it("keeps truly unsupported statuses unsafe", () => {
    expect(
      classifyUpcomingUnresolvedEvent("events", {
        match_id: "mystery",
        league_id: "152",
        match_status: "Mystery Delay",
        match_hometeam_id: "1",
        match_awayteam_id: "2"
      })
    ).toMatchObject({
      reason: "unsupported_status"
    });
  });

  it("reports missing team mappings instead of creating fake IDs", () => {
    expect(
      classifyUpcomingUnresolvedEvent("events", {
        match_id: "missing-team",
        league_id: "152",
        match_status: "Not Started",
        match_hometeam_name: "Home",
        match_awayteam_name: "Away"
      })
    ).toMatchObject({
      providerEventId: "missing-team",
      reason: "missing_team_mapping"
    });
  });

  it("filters provider rows to upcoming statuses and never treats finished rows as upcoming", () => {
    const filtered = filterUpcomingProviderResult(
      providerResult([
        {
          providerEntityId: "scheduled",
          status: "not_started"
        },
        {
          providerEntityId: "finished",
          status: "finished"
        }
      ]),
      "events",
      200
    );

    expect(filtered.data).toEqual([{ providerEntityId: "scheduled", status: "not_started" }]);
    expect(buildUpcomingDiagnostics([{ operation: "events", result: filtered }])).toEqual([
      expect.objectContaining({
        providerEventId: "finished",
        reason: "finished_ignored"
      })
    ]);
  });

  it("dry-run fetches and maps upcoming rows without writing", async () => {
    const ingestProviderResult = vi.fn();
    const result = await runUpcomingSync(
      { execute: false, allReviewedEnabled: false, countryId: "44", leagueId: "152", windowDays: 5, limit: 200, maxRuntimeSeconds: 300 },
      {
        now: () => new Date("2026-05-03T06:00:00.000Z"),
        createManualDependencies: () => ({
          fetchProviderResult: mockUpcomingProviderFetch,
          ingestProviderResult
        })
      }
    );

    expect(result.mode).toBe("dry-run");
    expect(result.totalUpcomingMatchesMapped).toBe(1);
    expect(result.totalUpcomingMatchesUpserted).toBe(0);
    expect(result.leagues[0]?.dbWritesCount).toBe(0);
    expect(JSON.stringify(result)).not.toContain("test-key");
    expect(ingestProviderResult).not.toHaveBeenCalled();
  });

  it("execute upserts upcoming matches and scores through the existing ingestion path", async () => {
    const ingestProviderResult = vi.fn().mockResolvedValue({ rawPayloadId: "raw-1" });
    const processRawPayload = vi.fn().mockResolvedValue({ status: "processed", normalizationStatus: "success" });
    const result = await runUpcomingSync(
      { execute: true, allReviewedEnabled: false, countryId: "44", leagueId: "152", windowDays: 5, limit: 200, maxRuntimeSeconds: 300 },
      {
        now: () => new Date("2026-05-03T06:00:00.000Z"),
        createManualDependencies: () => ({
          fetchProviderResult: mockUpcomingProviderFetch,
          ingestProviderResult,
          processRawPayload
        })
      }
    );

    expect(result.mode).toBe("execute");
    expect(result.totalUpcomingMatchesUpserted).toBe(1);
    expect(result.totalScoreRowsUpserted).toBe(1);
    expect(ingestProviderResult).toHaveBeenCalledTimes(3);
    expect(processRawPayload).toHaveBeenCalledTimes(3);
  });
});

async function mockUpcomingProviderFetch(request: { operation: string }): Promise<ProviderFetchResult<unknown>> {
  if (request.operation === "list_upcoming_matches") {
    return providerResult([{ providerEntityId: "match-1", status: "not_started" }]);
  }
  if (request.operation === "get_football_match_score") {
    return providerResult([{ providerEntityId: "match-1", matchProviderId: "match-1", status: "not_started" }]);
  }
  throw new Error(`Unexpected provider request ${request.operation}.`);
}

function providerResult(data: unknown[]): ProviderFetchResult<unknown> {
  return {
    data,
    rawPayload: data.map((row) => ({
      match_id: (row as { providerEntityId?: string }).providerEntityId,
      league_id: "152",
      match_status: (row as { status?: string }).status === "finished" ? "Finished" : "Not Started",
      match_hometeam_id: "1",
      match_awayteam_id: "2",
      match_hometeam_name: "Home",
      match_awayteam_name: "Away"
    })),
    metadata: {
      provider: "apifootball-com",
      endpoint: "list_upcoming_matches",
      requestParams: {},
      requestParamsHashInput: {},
      credentialLabel: "APIFOOTBALL_COM_API_KEY_DEFAULT",
      durationMs: 1,
      fetchedAt: "2026-05-03T06:00:00.000Z"
    }
  };
}
