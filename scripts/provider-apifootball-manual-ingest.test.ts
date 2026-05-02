import { describe, expect, it, vi } from "vitest";
import type { ProviderFetchResult, ProviderOperation } from "@sports-data/providers";
import type { ProviderEntityType } from "@sports-data/shared";
import {
  parseManualIngestionArgs,
  runManualAPIFootballComIngestion,
  validateManualLeagueAccess,
  validateManualIngestionOptions
} from "./provider-apifootball-manual-ingest.js";
import type { ManualFetchRequest, ManualIngestionOptions, ManualPostRunVerificationCounts } from "./provider-apifootball-manual-ingest.js";

const baseOptions: ManualIngestionOptions = {
  execute: false,
  verifyAfter: false,
  reportJson: false,
  operations: ["countries", "leagues", "teams", "events", "scores", "standings"],
  countryId: "4",
  leagueId: "171",
  from: "2026-04-24",
  to: "2026-04-26"
};

const baseEnv = {
  NODE_ENV: "development",
  APIFOOTBALL_COM_ENABLED: "true",
  APIFOOTBALL_COM_API_KEY: "secret-key"
};
const superLigOptions: ManualIngestionOptions = {
  ...baseOptions,
  countryId: "111",
  leagueId: "322"
};
const premierLeagueOptions: ManualIngestionOptions = {
  ...baseOptions,
  countryId: "44",
  leagueId: "152"
};
const laLigaOptions: ManualIngestionOptions = {
  ...baseOptions,
  countryId: "6",
  leagueId: "302"
};
const serieAOptions: ManualIngestionOptions = {
  ...baseOptions,
  countryId: "5",
  leagueId: "207"
};
const ligue1Options: ManualIngestionOptions = {
  ...baseOptions,
  countryId: "3",
  leagueId: "168"
};
const eredivisieOptions: ManualIngestionOptions = {
  ...baseOptions,
  countryId: "82",
  leagueId: "244"
};

describe("APIFootball.com manual ingestion command", () => {
  it("defaults to dry-run with all reviewed operations", () => {
    expect(parseManualIngestionArgs(["--country-id=4", "--league-id=171", "--from=2026-04-24", "--to=2026-04-26"])).toMatchObject({
      execute: false,
      verifyAfter: false,
      reportJson: false,
      operations: ["countries", "leagues", "teams", "events", "scores", "standings"]
    });
  });

  it("parses optional post-run verification flag", () => {
    expect(parseManualIngestionArgs(["--verify-after", "--country-id=4", "--league-id=171", "--from=2026-04-24", "--to=2026-04-26"])).toMatchObject({
      execute: false,
      verifyAfter: true
    });
  });

  it("parses optional JSON report persistence flag", () => {
    expect(parseManualIngestionArgs(["--report-json", "--country-id=4", "--league-id=171", "--from=2026-04-24", "--to=2026-04-26"])).toMatchObject({
      reportJson: true
    });
  });

  it("requires --execute for DB writes by keeping dry-run free of ingestion calls", async () => {
    const ingestProviderResult = vi.fn();

    await runManualAPIFootballComIngestion(baseOptions, {
      fetchProviderResult: mockFetchProviderResult(),
      ingestProviderResult
    });

    expect(ingestProviderResult).not.toHaveBeenCalled();
  });

  it("generates a dry-run ingestion run report", async () => {
    const result = await runManualAPIFootballComIngestion({ ...baseOptions, operations: ["teams"] }, {
      fetchProviderResult: mockFetchProviderResult()
    });

    expect(result.ingestionRunReport).toMatchObject({
      provider: "apifootball-com",
      mode: "dry-run",
      country_id: "4",
      league_id: "171",
      league_name: "2. Bundesliga",
      teams_count: 2,
      teams_with_logos_count: 1,
      team_logo_coverage_percentage: 50,
      result: "success"
    });
    expect(result.ingestionRunReport.safe_sanitized_command_context).toMatchObject({
      execute: false,
      report_json: false
    });
  });

  it("blocks production usage", () => {
    expect(() => validateManualIngestionOptions(baseOptions, { ...baseEnv, NODE_ENV: "production" })).toThrow(
      "APIFootball.com manual ingestion is forbidden in production."
    );
  });

  it("blocks missing API keys without printing the key", () => {
    expect(() => validateManualIngestionOptions(baseOptions, { ...baseEnv, APIFOOTBALL_COM_API_KEY: undefined })).toThrow(
      "At least one APIFOOTBALL_COM_API_KEY* value is required for APIFootball.com manual ingestion."
    );
  });

  it("accepts endpoint-specific API keys without the legacy key", () => {
    expect(() =>
      validateManualIngestionOptions(baseOptions, {
        ...baseEnv,
        APIFOOTBALL_COM_API_KEY: undefined,
        APIFOOTBALL_COM_API_KEY_EVENTS: "test-events-key"
      })
    ).not.toThrow();
  });

  it("blocks missing league id for league-scoped operations", () => {
    expect(() => validateManualIngestionOptions({ ...baseOptions, leagueId: undefined, operations: ["teams"] }, baseEnv)).toThrow(
      "APIFootball.com manual ingestion requires one configured --league-id (171, 175, 322, 152, 302, 207, 168, 244) for leagues, teams, events, scores, and standings."
    );
  });

  it("allows reviewed league_id=171", () => {
    expect(() => validateManualIngestionOptions({ ...baseOptions, leagueId: "171" }, baseEnv)).not.toThrow();
  });

  it("allows Bundesliga reviewed/enabled execute", () => {
    expect(() => validateManualIngestionOptions({ ...baseOptions, execute: true, leagueId: "175" }, baseEnv)).not.toThrow();
  });

  it("allows reviewed league_id=175", () => {
    expect(() => validateManualIngestionOptions({ ...baseOptions, leagueId: "175" }, baseEnv)).not.toThrow();
  });

  it("allows Süper Lig reviewed/enabled dry-run", () => {
    expect(() => validateManualIngestionOptions(superLigOptions, baseEnv)).not.toThrow();
  });

  it("allows Süper Lig reviewed/enabled execute", () => {
    expect(() => validateManualIngestionOptions({ ...superLigOptions, execute: true }, baseEnv)).not.toThrow();
  });

  it("allows Premier League reviewed/enabled dry-run", () => {
    expect(() => validateManualIngestionOptions(premierLeagueOptions, baseEnv)).not.toThrow();
  });

  it("allows Premier League reviewed/enabled execute", () => {
    expect(() => validateManualIngestionOptions({ ...premierLeagueOptions, execute: true }, baseEnv)).not.toThrow();
  });

  it("allows La Liga reviewed/enabled dry-run", () => {
    expect(() => validateManualIngestionOptions(laLigaOptions, baseEnv)).not.toThrow();
  });

  it("allows La Liga reviewed/enabled execute", () => {
    expect(() => validateManualIngestionOptions({ ...laLigaOptions, execute: true }, baseEnv)).not.toThrow();
  });

  it("allows Serie A reviewed/enabled dry-run", () => {
    expect(() => validateManualIngestionOptions(serieAOptions, baseEnv)).not.toThrow();
  });

  it("allows Serie A reviewed/enabled execute", () => {
    expect(() => validateManualIngestionOptions({ ...serieAOptions, execute: true }, baseEnv)).not.toThrow();
  });

  it("allows Ligue 1 reviewed/enabled dry-run", () => {
    expect(() => validateManualIngestionOptions(ligue1Options, baseEnv)).not.toThrow();
  });

  it("allows Ligue 1 reviewed/enabled execute", () => {
    expect(() => validateManualIngestionOptions({ ...ligue1Options, execute: true }, baseEnv)).not.toThrow();
  });

  it("allows Eredivisie reviewed/enabled dry-run", () => {
    expect(() => validateManualIngestionOptions(eredivisieOptions, baseEnv)).not.toThrow();
  });

  it("allows Eredivisie reviewed/enabled execute", () => {
    expect(() => validateManualIngestionOptions({ ...eredivisieOptions, execute: true }, baseEnv)).not.toThrow();
  });

  it("blocks unknown league dry-run", () => {
    expect(() => validateManualIngestionOptions({ ...baseOptions, leagueId: "999" }, baseEnv)).toThrow(
      "APIFootball.com manual ingestion is limited to configured reviewed leagues and review candidates."
    );
  });

  it("blocks unknown league execute", () => {
    expect(() => validateManualIngestionOptions({ ...baseOptions, execute: true, leagueId: "999" }, baseEnv)).toThrow(
      "APIFootball.com manual ingestion is limited to configured reviewed leagues and review candidates."
    );
  });

  it("blocks dry-run for configured candidates when dryRunAllowed=false", () => {
    expect(() =>
      validateManualLeagueAccess(
        { ...baseOptions, countryId: "111", leagueId: "323" },
        [
          {
            provider: "apifootball-com",
            sport: "football",
            countryId: "111",
            leagueId: "323",
            countryName: "Turkey",
            leagueName: "Super Cup",
            enabled: false,
            reviewed: false,
            dryRunAllowed: false,
            priority: "low",
            notes: "Test-only disabled review candidate."
          }
        ]
      )
    ).toThrow("APIFootball.com dry-run is limited to reviewed/enabled leagues or review candidates with dryRunAllowed=true.");
  });

  it("rejects date ranges over seven days", () => {
    expect(() => validateManualIngestionOptions({ ...baseOptions, from: "2026-04-01", to: "2026-04-09" }, baseEnv)).toThrow(
      "APIFootball.com manual ingestion date range must be 7 days or fewer."
    );
  });

  it("execute mode calls ProviderIngestionService in dependency-safe order", async () => {
    const ingestProviderResult = vi.fn().mockImplementation(({ entityType }) =>
      Promise.resolve({
        rawPayloadId: `raw-${entityType}`,
        enqueuedJobKey: `raw-payload:raw-${entityType}`
      })
    );
    const processRawPayload = vi.fn().mockResolvedValue({ status: "processed", normalizationStatus: "normalized" });

    await runManualAPIFootballComIngestion({ ...baseOptions, execute: true }, {
      fetchProviderResult: mockFetchProviderResult(),
      ingestProviderResult,
      processRawPayload
    });

    expect(ingestProviderResult.mock.calls.map(([request]) => request.entityType)).toEqual([
      "sport",
      "country",
      "competition",
      "team",
      "match",
      "football_match_score",
      "football_standing"
    ]);
    expect(processRawPayload).toHaveBeenCalledTimes(7);
  });

  it("execute mode prints a post-run verification report when a query layer is available", async () => {
    const log = vi.fn();
    const result = await runManualAPIFootballComIngestion({ ...baseOptions, execute: true, operations: ["teams"] }, {
      fetchProviderResult: mockFetchProviderResult(),
      ingestProviderResult: vi.fn().mockResolvedValue({ rawPayloadId: "raw-1", enqueuedJobKey: "raw-payload:raw-1" }),
      processRawPayload: vi.fn().mockResolvedValue({ status: "processed", normalizationStatus: "normalized" }),
      queryPostRunVerificationCounts: vi
        .fn()
        .mockResolvedValueOnce(verificationCounts({ teamsCount: 1, teamsWithLogoUrlCount: 1 }))
        .mockResolvedValueOnce(verificationCounts({ teamsCount: 2, teamsWithLogoUrlCount: 1, failedRawPayloadCount: 1 })),
      log
    });

    expect(result.postRunVerification).toMatchObject({
      teamsCount: 2,
      teamsWithLogoUrlCount: 1,
      teamLogoCoveragePercentage: 50,
      failedRawPayloadCount: 1,
      unresolvedSkippedRowsCount: 0,
      canonicalCountsChangedUnexpectedly: false
    });
    expect(log.mock.calls.map((call) => call.join(" ")).join("\n")).toContain('"postRunVerification"');
  });

  it("generates an execute ingestion run report with verification counts", async () => {
    const result = await runManualAPIFootballComIngestion({ ...baseOptions, execute: true, operations: ["teams"] }, {
      fetchProviderResult: mockFetchProviderResult(),
      ingestProviderResult: vi.fn().mockResolvedValue({ rawPayloadId: "raw-1", enqueuedJobKey: "raw-payload:raw-1" }),
      processRawPayload: vi.fn().mockResolvedValue({ status: "processed", normalizationStatus: "normalized" }),
      queryPostRunVerificationCounts: vi.fn().mockResolvedValue(verificationCounts({ failedRawPayloadCount: 1 }))
    });

    expect(result.ingestionRunReport).toMatchObject({
      mode: "execute",
      raw_payload_status_distribution: [{ status: "processed", count: 7 }],
      failed_raw_payload_count: 1,
      provider_mappings_count: 6,
      canonical_counts: {
        countries: 1,
        competitions: 1,
        teams: 2,
        teams_with_logo_url: 2,
        matches: 1,
        football_match_scores: 1,
        football_standings: 1
      }
    });
  });

  it("persists the sanitized run report only when --report-json is requested", async () => {
    const persistRunReport = vi.fn();

    await runManualAPIFootballComIngestion({ ...baseOptions, reportJson: true, operations: ["countries"] }, {
      fetchProviderResult: mockFetchProviderResult(),
      persistRunReport
    });

    expect(persistRunReport).toHaveBeenCalledOnce();
    expect(persistRunReport.mock.calls[0][0]).toMatchObject({
      provider: "apifootball-com",
      country_id: "4",
      league_id: "171"
    });
  });

  it("dry-run does not require DB verification", async () => {
    const queryPostRunVerificationCounts = vi.fn();

    await runManualAPIFootballComIngestion({ ...baseOptions, operations: ["countries"] }, {
      fetchProviderResult: mockFetchProviderResult(),
      queryPostRunVerificationCounts
    });

    expect(queryPostRunVerificationCounts).not.toHaveBeenCalled();
  });

  it("dry-run can run explicit read-only post-run verification", async () => {
    const result = await runManualAPIFootballComIngestion({ ...baseOptions, verifyAfter: true, operations: ["countries"] }, {
      fetchProviderResult: mockFetchProviderResult(),
      queryPostRunVerificationCounts: vi.fn().mockResolvedValue(verificationCounts({ failedRawPayloadCount: 2 }))
    });

    expect(result.postRunVerification).toMatchObject({
      failedRawPayloadCount: 2,
      teamLogoCoveragePercentage: 100
    });
  });

  it("reports team logo counts", async () => {
    const result = await runManualAPIFootballComIngestion({ ...baseOptions, operations: ["teams"] }, {
      fetchProviderResult: mockFetchProviderResult()
    });

    expect(result.totals.teamsCount).toBe(2);
    expect(result.totals.teamsWithLogoCount).toBe(1);
    expect(result.operations[0]).toMatchObject({
      operation: "teams",
      teamsWithLogoCount: 1,
      teamsMissingLogoCount: 1
    });
  });

  it("reports unmapped standing rows instead of silently ignoring them", async () => {
    const result = await runManualAPIFootballComIngestion({ ...baseOptions, operations: ["standings"] }, {
      fetchProviderResult: async () =>
        providerResult("get_football_standings", "football_standing", [{ providerEntityId: "171:3911", competitionProviderId: "171", teamProviderId: "3911", position: 1, played: 1, wins: 1, draws: 0, losses: 0, goalsFor: 2, goalsAgainst: 0, goalDifference: 2, points: 3 }], [
          { team_id: "3911" },
          { team_name: "Missing ID" }
        ])
    });

    expect(result.totals.standingsCount).toBe(1);
    expect(result.totals.unresolvedRowsCount).toBe(1);
  });

  it("enriches missing APIFootball team_name from standings with the same team_key", async () => {
    const fetchProviderResult = vi.fn(async (request: ManualFetchRequest) => {
      if (request.operation === "list_teams") {
        return providerResult(
          request.operation,
          request.entityType,
          [{ providerEntityId: "3911", sportProviderId: "football", name: "Bochum", logoUrl: "https://example.test/bochum.png" }],
          [
            { team_key: "3911", team_name: "Bochum", team_badge: "https://example.test/bochum.png" },
            { team_key: "7701", team_name: "", team_badge: "" }
          ]
        );
      }

      if (request.operation === "get_football_standings") {
        return providerResult(
          request.operation,
          request.entityType,
          [{ providerEntityId: "171:7701", competitionProviderId: "171", teamProviderId: "7701", position: 2, played: 1, wins: 0, draws: 1, losses: 0, goalsFor: 1, goalsAgainst: 1, goalDifference: 0, points: 1 }],
          [{ league_id: "171", team_id: "7701", team_name: "Fallback Team", overall_league_position: "2", overall_league_payed: "1", overall_league_W: "0", overall_league_D: "1", overall_league_L: "0", overall_league_GF: "1", overall_league_GA: "1", overall_league_PTS: "1" }]
        );
      }

      throw new Error(`Unexpected operation ${request.operation}`);
    });

    const result = await runManualAPIFootballComIngestion({ ...baseOptions, operations: ["teams"] }, { fetchProviderResult });

    expect(fetchProviderResult.mock.calls.map(([request]) => request.operation)).toEqual(["list_teams", "get_football_standings"]);
    expect(result.operations[0]).toMatchObject({
      mappedCount: 2,
      unresolvedRowsCount: 0,
      teamsWithLogoCount: 1,
      teamsMissingLogoCount: 1,
      enrichedTeamNamesCount: 1,
      enrichedFrom: "standings"
    });
    expect(result.totals).toMatchObject({
      teamsCount: 2,
      teamsWithLogoCount: 1,
      unresolvedRowsCount: 0
    });
    expect(result.notes).toContain("Enriched 1 APIFootball.com team name(s) from exact team_id standings matches; logo fallback was not applied.");
  });

  it("does not enrich missing team_name when standings team_key does not match", async () => {
    const result = await runManualAPIFootballComIngestion({ ...baseOptions, operations: ["teams"] }, {
      fetchProviderResult: async (request) => {
        if (request.operation === "list_teams") {
          return providerResult(request.operation, request.entityType, [], [{ team_key: "7701", team_name: "" }]);
        }
        return providerResult(request.operation, request.entityType, [], [{ team_id: "9999", team_name: "Different Team" }]);
      }
    });

    expect(result.operations[0]).toMatchObject({
      mappedCount: 0,
      unresolvedRowsCount: 1,
      enrichedTeamNamesCount: 0
    });
  });

  it("does not enrich missing team_name when standings team_name is also missing", async () => {
    const result = await runManualAPIFootballComIngestion({ ...baseOptions, operations: ["teams"] }, {
      fetchProviderResult: async (request) => {
        if (request.operation === "list_teams") {
          return providerResult(request.operation, request.entityType, [], [{ team_key: "7701", team_name: "" }]);
        }
        return providerResult(request.operation, request.entityType, [], [{ team_id: "7701", team_name: "" }]);
      }
    });

    expect(result.operations[0]).toMatchObject({
      mappedCount: 0,
      unresolvedRowsCount: 1,
      enrichedTeamNamesCount: 0
    });
  });

  it("skips reviewed-slice match, score, and standing rows with missing dependency mappings", async () => {
    const ingestProviderResult = vi.fn().mockImplementation(({ entityType, result }) =>
      Promise.resolve({
        rawPayloadId: `raw-${entityType}-${asArray(result.data).length}`,
        enqueuedJobKey: `raw-payload:raw-${entityType}`
      })
    );

    const result = await runManualAPIFootballComIngestion(
      { ...baseOptions, execute: true, operations: ["teams", "events", "scores", "standings"] },
      {
        fetchProviderResult: async (request) => {
          switch (request.operation) {
            case "list_teams":
              return providerResult(request.operation, request.entityType, [
                { providerEntityId: "3911", sportProviderId: "football", name: "Bochum", logoUrl: "https://example.test/badge.png" }
              ]);
            case "list_finished_matches":
              return providerResult(request.operation, request.entityType, [
                {
                  providerEntityId: "known-match",
                  sportProviderId: "football",
                  competitionProviderId: "171",
                  homeTeamProviderId: "3911",
                  awayTeamProviderId: "3911",
                  scheduledStartAt: "2026-04-24T18:30:00.000Z",
                  status: "finished"
                },
                {
                  providerEntityId: "missing-team-match",
                  sportProviderId: "football",
                  competitionProviderId: "171",
                  homeTeamProviderId: "9999",
                  awayTeamProviderId: "3911",
                  scheduledStartAt: "2026-04-24T18:30:00.000Z",
                  status: "finished"
                }
              ]);
            case "get_football_match_score":
              return providerResult(request.operation, request.entityType, [
                { providerEntityId: "known-match", matchProviderId: "known-match", homeScoreFullTime: 2, awayScoreFullTime: 1, status: "finished" },
                { providerEntityId: "missing-team-match", matchProviderId: "missing-team-match", homeScoreFullTime: 1, awayScoreFullTime: 0, status: "finished" }
              ]);
            case "get_football_standings":
              return providerResult(request.operation, request.entityType, [
                { providerEntityId: "171:3911", competitionProviderId: "171", teamProviderId: "3911", position: 1, played: 1, wins: 1, draws: 0, losses: 0, goalsFor: 2, goalsAgainst: 1, goalDifference: 1, points: 3 },
                { providerEntityId: "171:9999", competitionProviderId: "171", teamProviderId: "9999", position: 2, played: 1, wins: 0, draws: 0, losses: 1, goalsFor: 1, goalsAgainst: 2, goalDifference: -1, points: 0 }
              ]);
            default:
              throw new Error(`Unexpected operation ${request.operation}`);
          }
        },
        ingestProviderResult,
        processRawPayload: vi.fn().mockResolvedValue({ status: "processed", normalizationStatus: "normalized" })
      }
    );

    expect(result.totals).toMatchObject({
      teamsCount: 1,
      eventsCount: 1,
      scoresCount: 1,
      standingsCount: 1,
      unresolvedRowsCount: 3
    });
    expect(result.ingestionRunReport).toMatchObject({
      unresolved_skipped_rows_count: 3,
      result: "partial"
    });
    expect(ingestProviderResult.mock.calls.map(([request]) => [request.entityType, asArray(request.result.data).length])).toEqual([
      ["sport", 1],
      ["team", 1],
      ["match", 1],
      ["football_match_score", 1],
      ["football_standing", 1]
    ]);
  });

  it("does not print or log API keys", async () => {
    const log = vi.fn();
    await runManualAPIFootballComIngestion({ ...baseOptions, operations: ["countries"] }, {
      fetchProviderResult: mockFetchProviderResult(),
      log
    });

    expect(log.mock.calls.map((call) => call.join(" ")).join("\n")).not.toContain(baseEnv.APIFOOTBALL_COM_API_KEY);
  });

  it("does not print credentials in verification or run report output", async () => {
    const log = vi.fn();
    await runManualAPIFootballComIngestion({ ...baseOptions, execute: true, operations: ["countries"] }, {
      fetchProviderResult: mockFetchProviderResult(),
      ingestProviderResult: vi.fn().mockResolvedValue({ rawPayloadId: "raw-1", enqueuedJobKey: "raw-payload:raw-1" }),
      processRawPayload: vi.fn().mockResolvedValue({ status: "processed", normalizationStatus: "normalized" }),
      queryPostRunVerificationCounts: vi.fn().mockResolvedValue(verificationCounts()),
      log
    });

    const logged = log.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(logged).not.toContain("postgresql://");
    expect(logged).not.toContain("password");
    expect(logged).not.toContain(baseEnv.APIFOOTBALL_COM_API_KEY);
  });

  it("calculates failed run report status when current processing fails", async () => {
    const result = await runManualAPIFootballComIngestion({ ...baseOptions, execute: true, operations: ["countries"] }, {
      fetchProviderResult: mockFetchProviderResult(),
      ingestProviderResult: vi.fn().mockResolvedValue({ rawPayloadId: "raw-1", enqueuedJobKey: "raw-payload:raw-1" }),
      processRawPayload: vi.fn().mockResolvedValue({ status: "failed", normalizationStatus: "failed" })
    });

    expect(result.ingestionRunReport.result).toBe("failed");
    expect(result.ingestionRunReport.warnings).toContain("One or more current-run raw payloads failed processing.");
  });

  it("validates execute preconditions before any provider fetch in the run helper", async () => {
    const fetchProviderResult = vi.fn();
    const ingestProviderResult = vi.fn().mockResolvedValue({
      rawPayloadId: "raw-sport",
      enqueuedJobKey: "raw-payload:raw-sport"
    });

    await runManualAPIFootballComIngestion({ ...baseOptions, execute: true, operations: [] }, {
      fetchProviderResult,
      ingestProviderResult,
      processRawPayload: vi.fn().mockResolvedValue({ status: "processed", normalizationStatus: "normalized" })
    });

    expect(fetchProviderResult).not.toHaveBeenCalled();
    expect(ingestProviderResult).toHaveBeenCalledOnce();
  });
});

function mockFetchProviderResult() {
  return async (request: ManualFetchRequest) => {
    switch (request.operation) {
      case "list_countries":
        return providerResult(request.operation, request.entityType, [
          { providerEntityId: "4", name: "Germany" },
          { providerEntityId: "5", name: "France" }
        ]);
      case "list_competitions":
        return providerResult(request.operation, request.entityType, [
          { providerEntityId: "171", sportProviderId: "football", countryProviderId: "4", name: "2. Bundesliga" },
          { providerEntityId: "999", sportProviderId: "football", countryProviderId: "4", name: "Other League" }
        ]);
      case "list_teams":
        return providerResult(request.operation, request.entityType, [
          { providerEntityId: "3911", sportProviderId: "football", name: "Bochum", logoUrl: "https://apiv3.apifootball.com/badges/3911_bochum.jpg" },
          { providerEntityId: "3912", sportProviderId: "football", name: "Darmstadt", metadata: { logoMissing: true } }
        ]);
      case "list_finished_matches":
        return providerResult(request.operation, request.entityType, [
          {
            providerEntityId: "688976",
            sportProviderId: "football",
            competitionProviderId: "171",
            homeTeamProviderId: "3911",
            awayTeamProviderId: "3912",
            scheduledStartAt: "2026-04-24T18:30:00.000Z",
            status: "finished"
          }
        ]);
      case "get_football_match_score":
        return providerResult(request.operation, request.entityType, [
          { providerEntityId: "688976", matchProviderId: "688976", homeScoreFullTime: 2, awayScoreFullTime: 1, status: "finished" }
        ]);
      case "get_football_standings":
        return providerResult(request.operation, request.entityType, [
          { providerEntityId: "171:3911", competitionProviderId: "171", teamProviderId: "3911", position: 1, played: 1, wins: 1, draws: 0, losses: 0, goalsFor: 2, goalsAgainst: 1, goalDifference: 1, points: 3 }
        ]);
      default:
        throw new Error(`Unexpected operation ${request.operation}`);
    }
  };
}

function providerResult(operation: ProviderOperation, entityType: ProviderEntityType, data: unknown[], rawPayload: unknown[] = data): ProviderFetchResult<unknown> {
  return {
    data,
    rawPayload,
    metadata: {
      provider: "apifootball-com",
      endpoint: operation,
      requestParams: {},
      requestParamsHashInput: { operation, entityType },
      durationMs: 1,
      fetchedAt: "2026-04-29T00:00:00.000Z"
    }
  };
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function verificationCounts(overrides: Partial<ManualPostRunVerificationCounts> = {}): ManualPostRunVerificationCounts {
  return {
    countriesCount: 1,
    competitionsCount: 1,
    teamsCount: 2,
    teamsWithLogoUrlCount: 2,
    matchesCount: 1,
    footballMatchScoresCount: 1,
    footballStandingsCount: 1,
    providerMappingsCount: 6,
    rawProviderPayloadsByProcessingStatus: [{ status: "processed", count: 7 }],
    failedRawPayloadCount: 0,
    ...overrides
  };
}
