import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ManualLeagueReviewConfig } from "./apifootball-manual-league-config.js";
import {
  dedupeAvailabilityRows,
  dedupePlayers,
  parsePlayerAvailabilitySyncArgs,
  resolvePlayerAvailabilitySyncLeagues,
  runPlayerAvailabilitySync
} from "./provider-football-player-availability-sync.js";

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
  reviewed: false
};

describe("football player availability sync", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://example",
      DB_EXECUTION_TARGET: "local",
      APIFOOTBALL_COM_ENABLED: "true",
      APIFOOTBALL_COM_API_KEY_DEFAULT: "test-default-key",
      APIFOOTBALL_COM_API_KEY_INJURIES: "test-injuries-key",
      APIFOOTBALL_COM_BASE_URL: "https://example.test",
      APIFOOTBALL_COM_TIMEOUT_MS: "1000"
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("parses dry-run defaults", () => {
    expect(parsePlayerAvailabilitySyncArgs(["--country-id=44", "--league-id=152"])).toMatchObject({
      execute: false,
      countryId: "44",
      leagueId: "152",
      windowDays: 7,
      limit: 200,
      maxRuntimeSeconds: 300
    });
  });

  it("limits sync to reviewed and enabled leagues", () => {
    expect(resolvePlayerAvailabilitySyncLeagues({ allReviewedEnabled: true, limit: 200 }, [reviewedLeague, reviewCandidate])).toEqual([reviewedLeague]);
    expect(() => resolvePlayerAvailabilitySyncLeagues({ allReviewedEnabled: false, countryId: "82", leagueId: "999", limit: 200 }, [reviewedLeague, reviewCandidate])).toThrow(
      "reviewed and enabled"
    );
  });

  it("exits safely when the injuries credential is missing", async () => {
    delete process.env.APIFOOTBALL_COM_API_KEY_INJURIES;
    const createAdapter = vi.fn();
    const result = await runPlayerAvailabilitySync(
      { execute: false, allReviewedEnabled: false, countryId: "44", leagueId: "152", windowDays: 7, limit: 50, maxRuntimeSeconds: 300 },
      {
        now: () => new Date("2026-05-04T06:00:00.000Z"),
        checkDb: vi.fn().mockResolvedValue({ status: "ready", message: "ok" }),
        createDb: vi.fn(),
        createAdapter,
        loadLeagueTargets: vi.fn(),
        processLeagueTarget: vi.fn()
      }
    );

    expect(result.stopReason).toBe("missing_injuries_credential");
    expect(result.leaguesScanned).toBe(0);
    expect(createAdapter).not.toHaveBeenCalled();
  });

  it("stops cleanly when db:check is not ready", async () => {
    const result = await runPlayerAvailabilitySync(
      { execute: false, allReviewedEnabled: false, countryId: "44", leagueId: "152", windowDays: 7, limit: 50, maxRuntimeSeconds: 300 },
      {
        now: () => new Date("2026-05-04T06:00:00.000Z"),
        checkDb: vi.fn().mockResolvedValue({ status: "not_ready", reason: "auth_failed", message: "blocked" }),
        createDb: vi.fn(),
        createAdapter: vi.fn(),
        loadLeagueTargets: vi.fn(),
        processLeagueTarget: vi.fn()
      }
    );

    expect(result.stopReason).toBe("db_not_ready");
    expect(result.secretExposureCheck).toBe("clean");
  });

  it("dry-run reports mapped rows without writes", async () => {
    const processLeagueTarget = vi.fn().mockResolvedValue({
      countryId: "44",
      leagueId: "152",
      leagueName: "Premier League",
      providerActionUsed: "get_teams",
      credentialLabels: ["injuries"],
      teamsChecked: 2,
      matchesChecked: 1,
      availabilityRowsFetched: 3,
      playersMapped: 6,
      playersWouldUpsert: 2,
      playersUpserted: 0,
      membershipsWouldUpsert: 2,
      membershipsUpserted: 0,
      availabilityRowsWouldUpsert: 3,
      availabilityRowsUpserted: 0,
      skippedRows: 0,
      skippedReasons: {},
      missingCredential: false,
      unsupportedEndpoint: false,
      dbWritesCount: 0,
      secretExposureCheck: "clean"
    });

    const result = await runPlayerAvailabilitySync(
      { execute: false, allReviewedEnabled: false, countryId: "44", leagueId: "152", windowDays: 7, limit: 50, maxRuntimeSeconds: 300 },
      {
        now: () => new Date("2026-05-04T06:00:00.000Z"),
        checkDb: vi.fn().mockResolvedValue({ status: "ready", message: "ok" }),
        createDb: vi.fn().mockReturnValue({}),
        createAdapter: vi.fn().mockReturnValue({}),
        loadLeagueTargets: vi.fn().mockResolvedValue([
          {
            league: reviewedLeague,
            matchesChecked: 1,
            teams: [
              {
                canonicalTeamId: "team-1",
                teamProviderId: "provider-team-1",
                teamName: "Arsenal",
                competitionId: "competition-1",
                matchIds: ["match-1"]
              }
            ],
            skippedReasons: {}
          }
        ]),
        processLeagueTarget
      }
    );

    expect(result.mode).toBe("dry-run");
    expect(result.totalAvailabilityRowsFetched).toBe(3);
    expect(result.totalPlayersUpserted).toBe(0);
    expect(result.totalAvailabilityRowsUpserted).toBe(0);
    expect(result.secretExposureCheck).toBe("clean");
  });

  it("deduplicates repeated player and availability rows safely", () => {
    expect(
      dedupePlayers([
        {
          providerEntityId: "player-1",
          sportProviderId: "football",
          currentTeamProviderId: "team-1",
          name: "Example Player"
        },
        {
          providerEntityId: "player-1",
          sportProviderId: "football",
          currentTeamProviderId: "team-1",
          name: "Example Player"
        }
      ])
    ).toHaveLength(1);

    expect(
      dedupeAvailabilityRows([
        {
          providerPlayerId: "player-1",
          sportProviderId: "football",
          teamProviderId: "team-1",
          playerName: "Example Player",
          status: "injured"
        },
        {
          providerPlayerId: "player-1",
          sportProviderId: "football",
          teamProviderId: "team-1",
          playerName: "Example Player",
          status: "injured"
        }
      ])
    ).toHaveLength(1);
  });
});
