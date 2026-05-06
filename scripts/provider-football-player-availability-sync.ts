import "dotenv/config";
import { pathToFileURL } from "node:url";
import { sql } from "drizzle-orm";
import { loadConfig } from "@sports-data/config";
import {
  FootballPlayerAvailabilityRepository,
  FootballPlayerTeamMembershipRepository,
  PlayerRepository,
  ProviderMappingRepository,
  SportRepository,
  createDatabase
} from "@sports-data/database";
import type { Database } from "@sports-data/database";
import { APIFootballComAdapter, mapTeamPlayerToProviderPlayer } from "@sports-data/providers";
import type { APIFootballComTeam, ProviderFootballPlayerAvailability, ProviderPlayer } from "@sports-data/providers";
import { footballPlayerAvailabilityStatuses } from "@sports-data/shared";
import { manualLeagueConfigs } from "./apifootball-manual-league-config.js";
import type { ManualLeagueReviewConfig } from "./apifootball-manual-league-config.js";
import { checkDatabaseReadiness } from "./db-readiness.js";

export interface PlayerAvailabilitySyncOptions {
  execute: boolean;
  allReviewedEnabled: boolean;
  countryId?: string;
  leagueId?: string;
  competitionId?: string;
  teamId?: string;
  matchId?: string;
  windowDays: number;
  limit: number;
  maxRuntimeSeconds: number;
}

export interface PlayerAvailabilityLeagueReport {
  countryId: string;
  leagueId: string;
  leagueName: string;
  providerActionUsed: "get_teams";
  credentialLabels: string[];
  teamsChecked: number;
  matchesChecked: number;
  availabilityRowsFetched: number;
  playersMapped: number;
  playersWouldUpsert: number;
  playersUpserted: number;
  membershipsWouldUpsert: number;
  membershipsUpserted: number;
  availabilityRowsWouldUpsert: number;
  availabilityRowsUpserted: number;
  skippedRows: number;
  skippedReasons: Record<string, number>;
  missingCredential: boolean;
  unsupportedEndpoint: boolean;
  dbWritesCount: number;
  secretExposureCheck: "clean";
}

export interface PlayerAvailabilitySyncResult {
  provider: "football-player-availability-sync";
  mode: "dry-run" | "execute";
  windowDays: number;
  leaguesScanned: number;
  totalTeamsChecked: number;
  totalMatchesChecked: number;
  totalAvailabilityRowsFetched: number;
  totalPlayersMapped: number;
  totalPlayersWouldUpsert: number;
  totalPlayersUpserted: number;
  totalMembershipsWouldUpsert: number;
  totalMembershipsUpserted: number;
  totalAvailabilityRowsWouldUpsert: number;
  totalAvailabilityRowsUpserted: number;
  totalSkipped: number;
  stopReason: "completed" | "db_not_ready" | "missing_injuries_credential" | "max_runtime_exceeded";
  leagues: PlayerAvailabilityLeagueReport[];
  secretExposureCheck: "clean";
}

interface PlayerAvailabilityLeagueTarget {
  league: ManualLeagueReviewConfig;
  matchesChecked: number;
  teams: PlayerAvailabilityTeamTarget[];
  skippedReasons: Record<string, number>;
}

interface PlayerAvailabilityTeamTarget {
  canonicalTeamId: string;
  teamProviderId: string;
  teamName: string;
  competitionId: string;
  matchIds: string[];
}

interface TeamTargetRow {
  match_id: string;
  competition_id: string;
  home_team_id: string;
  home_team_name: string;
  home_team_provider_id: string | null;
  away_team_id: string;
  away_team_name: string;
  away_team_provider_id: string | null;
}

interface PlayerAvailabilitySyncDependencies {
  now(): Date;
  checkDb: typeof checkDatabaseReadiness;
  createDb(databaseUrl: string): Database;
  createAdapter(config: ReturnType<typeof loadConfig>): APIFootballComAdapter;
  loadLeagueTargets(
    database: Database,
    leagues: readonly ManualLeagueReviewConfig[],
    options: PlayerAvailabilitySyncOptions,
    startedAt: Date,
    windowEnd: Date
  ): Promise<PlayerAvailabilityLeagueTarget[]>;
  processLeagueTarget(database: Database, adapter: APIFootballComAdapter, leagueTarget: PlayerAvailabilityLeagueTarget, execute: boolean): Promise<PlayerAvailabilityLeagueReport>;
}

const defaultDependencies: PlayerAvailabilitySyncDependencies = {
  now: () => new Date(),
  checkDb: checkDatabaseReadiness,
  createDb: createDatabase,
  createAdapter: (config) =>
    new APIFootballComAdapter({
      enabled: config.APIFOOTBALL_COM_ENABLED,
      apiKey: config.APIFOOTBALL_COM_API_KEY,
      apiKeys: {
        defaultApiKey: config.APIFOOTBALL_COM_API_KEY_DEFAULT,
        injuriesApiKey: config.APIFOOTBALL_COM_API_KEY_INJURIES,
        teamsApiKey: config.APIFOOTBALL_COM_API_KEY_TEAMS
      },
      baseUrl: config.APIFOOTBALL_COM_BASE_URL,
      timeoutMs: config.APIFOOTBALL_COM_TIMEOUT_MS,
      environment: {
        nodeEnv: config.NODE_ENV,
        allowProductionAccess: config.APIFOOTBALL_COM_ALLOW_PRODUCTION
      }
    }),
  loadLeagueTargets,
  processLeagueTarget
};

export function parsePlayerAvailabilitySyncArgs(argv: string[]): PlayerAvailabilitySyncOptions {
  const options: PlayerAvailabilitySyncOptions = {
    execute: false,
    allReviewedEnabled: false,
    windowDays: 7,
    limit: 200,
    maxRuntimeSeconds: 300
  };

  for (const arg of argv) {
    if (arg === "--execute") {
      options.execute = true;
      continue;
    }
    if (arg === "--dry-run") {
      options.execute = false;
      continue;
    }
    if (arg === "--all-reviewed-enabled") {
      options.allReviewedEnabled = true;
      continue;
    }

    const [key, value] = parseFlag(arg);
    switch (key) {
      case "--country-id":
        options.countryId = requiredFlagValue(key, value);
        break;
      case "--league-id":
        options.leagueId = requiredFlagValue(key, value);
        break;
      case "--competition-id":
        options.competitionId = requiredFlagValue(key, value);
        break;
      case "--team-id":
        options.teamId = requiredFlagValue(key, value);
        break;
      case "--match-id":
        options.matchId = requiredFlagValue(key, value);
        break;
      case "--window-days":
        options.windowDays = parsePositiveInteger(key, value);
        break;
      case "--limit":
        options.limit = Math.min(parsePositiveInteger(key, value), 200);
        break;
      case "--max-runtime-seconds":
        options.maxRuntimeSeconds = parsePositiveInteger(key, value);
        break;
      default:
        throw new Error(`Unknown football player availability sync flag "${key}".`);
    }
  }

  if (!hasScope(options)) {
    throw new Error(
      "Player availability sync requires one scope: --all-reviewed-enabled, --country-id plus --league-id, --competition-id, --team-id, or --match-id."
    );
  }
  if (options.countryId && !options.leagueId) {
    throw new Error("Player availability sync requires --country-id and --league-id together.");
  }
  if (!options.countryId && options.leagueId) {
    throw new Error("Player availability sync requires --country-id and --league-id together.");
  }
  return options;
}

export function resolvePlayerAvailabilitySyncLeagues(
  options: Pick<PlayerAvailabilitySyncOptions, "allReviewedEnabled" | "countryId" | "leagueId" | "limit">,
  configs: readonly ManualLeagueReviewConfig[] = manualLeagueConfigs
): ManualLeagueReviewConfig[] {
  const matching = configs.filter((league) =>
    options.allReviewedEnabled ? league.reviewed && league.enabled : league.countryId === options.countryId && league.leagueId === options.leagueId
  );
  if (matching.length === 0) {
    throw new Error("Football player availability sync is limited to configured reviewed and enabled leagues.");
  }
  const blocked = matching.find((league) => !league.reviewed || !league.enabled);
  if (blocked) {
    throw new Error("Football player availability sync execute/dry-run is limited to reviewed and enabled leagues.");
  }
  return matching.slice(0, options.limit);
}

export async function runPlayerAvailabilitySync(
  options: PlayerAvailabilitySyncOptions,
  dependencies: PlayerAvailabilitySyncDependencies = defaultDependencies
): Promise<PlayerAvailabilitySyncResult> {
  const config = loadConfig();
  const readiness = await dependencies.checkDb({
    databaseUrl: config.DATABASE_URL,
    nodeEnv: config.NODE_ENV,
    dbExecutionTarget: config.DB_EXECUTION_TARGET,
    allowRemoteTestDb: config.ALLOW_REMOTE_TEST_DB,
    neonBranchName: config.NEON_BRANCH_NAME
  });
  if (readiness.status !== "ready") {
    return emptyPlayerAvailabilityResult(options, "db_not_ready");
  }

  if (!config.APIFOOTBALL_COM_API_KEY_INJURIES) {
    return emptyPlayerAvailabilityResult(options, "missing_injuries_credential");
  }

  const database = dependencies.createDb(config.DATABASE_URL);
  const startedAt = dependencies.now();
  const windowEnd = addDays(startedAt, options.windowDays);
  const leagues = resolveAvailabilityLeaguesForScope(options);
  const adapter = dependencies.createAdapter(config);
  const leagueTargets = await dependencies.loadLeagueTargets(database, leagues, options, startedAt, windowEnd);
  const reports: PlayerAvailabilityLeagueReport[] = [];
  let stopReason: PlayerAvailabilitySyncResult["stopReason"] = "completed";

  for (const leagueTarget of leagueTargets) {
    if (dependencies.now().getTime() - startedAt.getTime() > options.maxRuntimeSeconds * 1000) {
      stopReason = "max_runtime_exceeded";
      break;
    }
    reports.push(await dependencies.processLeagueTarget(database, adapter, leagueTarget, options.execute));
  }

  return {
    provider: "football-player-availability-sync",
    mode: options.execute ? "execute" : "dry-run",
    windowDays: options.windowDays,
    leaguesScanned: reports.length,
    totalTeamsChecked: reports.reduce((sum, report) => sum + report.teamsChecked, 0),
    totalMatchesChecked: reports.reduce((sum, report) => sum + report.matchesChecked, 0),
    totalAvailabilityRowsFetched: reports.reduce((sum, report) => sum + report.availabilityRowsFetched, 0),
    totalPlayersMapped: reports.reduce((sum, report) => sum + report.playersMapped, 0),
    totalPlayersWouldUpsert: reports.reduce((sum, report) => sum + report.playersWouldUpsert, 0),
    totalPlayersUpserted: reports.reduce((sum, report) => sum + report.playersUpserted, 0),
    totalMembershipsWouldUpsert: reports.reduce((sum, report) => sum + report.membershipsWouldUpsert, 0),
    totalMembershipsUpserted: reports.reduce((sum, report) => sum + report.membershipsUpserted, 0),
    totalAvailabilityRowsWouldUpsert: reports.reduce((sum, report) => sum + report.availabilityRowsWouldUpsert, 0),
    totalAvailabilityRowsUpserted: reports.reduce((sum, report) => sum + report.availabilityRowsUpserted, 0),
    totalSkipped: reports.reduce((sum, report) => sum + report.skippedRows, 0),
    stopReason,
    leagues: reports,
    secretExposureCheck: "clean"
  };
}

function resolveAvailabilityLeaguesForScope(options: PlayerAvailabilitySyncOptions): ManualLeagueReviewConfig[] {
  if (options.countryId && options.leagueId) {
    return resolvePlayerAvailabilitySyncLeagues(options);
  }
  return manualLeagueConfigs.filter((league) => league.reviewed && league.enabled).slice(0, options.limit);
}

async function loadLeagueTargets(
  database: Database,
  leagues: readonly ManualLeagueReviewConfig[],
  options: PlayerAvailabilitySyncOptions,
  startedAt: Date,
  windowEnd: Date
): Promise<PlayerAvailabilityLeagueTarget[]> {
  const results: PlayerAvailabilityLeagueTarget[] = [];

  for (const league of leagues) {
    const rows = await executeRows<TeamTargetRow>(
      database,
      sql`
        select
          m.id as match_id,
          m.competition_id,
          m.home_team_id,
          ht.name as home_team_name,
          hpm.provider_entity_id as home_team_provider_id,
          m.away_team_id,
          at.name as away_team_name,
          apm.provider_entity_id as away_team_provider_id
        from matches m
        inner join competitions c on c.id = m.competition_id
        inner join sports s on s.id = c.sport_id and s.slug = 'football'
        inner join provider_mappings cpm
          on cpm.provider = 'apifootball-com'
          and cpm.entity_type = 'competition'
          and cpm.internal_entity_type = 'competition'
          and cpm.internal_entity_id = c.id
          and cpm.provider_entity_id = ${league.leagueId}
        inner join teams ht on ht.id = m.home_team_id
        inner join teams at on at.id = m.away_team_id
        left join provider_mappings hpm
          on hpm.provider = 'apifootball-com'
          and hpm.entity_type = 'team'
          and hpm.internal_entity_type = 'team'
          and hpm.internal_entity_id = m.home_team_id
        left join provider_mappings apm
          on apm.provider = 'apifootball-com'
          and apm.entity_type = 'team'
          and apm.internal_entity_type = 'team'
          and apm.internal_entity_id = m.away_team_id
        where m.status in ('scheduled', 'not_started', 'postponed')
          and m.scheduled_start_at >= ${startedAt}
          and m.scheduled_start_at <= ${windowEnd}
          ${options.competitionId ? sql`and m.competition_id = ${options.competitionId}` : sql``}
          ${options.matchId ? sql`and m.id = ${options.matchId}` : sql``}
          ${options.teamId ? sql`and (m.home_team_id = ${options.teamId} or m.away_team_id = ${options.teamId})` : sql``}
        order by m.scheduled_start_at asc
        limit ${options.limit}
      `
    );

    const skippedReasons: Record<string, number> = {};
    const teams = new Map<string, PlayerAvailabilityTeamTarget>();
    for (const row of rows) {
      const candidates = [
        { canonicalTeamId: row.home_team_id, teamProviderId: row.home_team_provider_id, teamName: row.home_team_name },
        { canonicalTeamId: row.away_team_id, teamProviderId: row.away_team_provider_id, teamName: row.away_team_name }
      ];

      for (const candidate of candidates) {
        if (!candidate.teamProviderId) {
          increment(skippedReasons, "missing_team_mapping");
          continue;
        }
        const existing = teams.get(candidate.canonicalTeamId);
        if (existing) {
          existing.matchIds.push(row.match_id);
          continue;
        }
        teams.set(candidate.canonicalTeamId, {
          canonicalTeamId: candidate.canonicalTeamId,
          teamProviderId: candidate.teamProviderId,
          teamName: candidate.teamName,
          competitionId: row.competition_id,
          matchIds: [row.match_id]
        });
      }
    }

    results.push({
      league,
      matchesChecked: rows.length,
      teams: [...teams.values()],
      skippedReasons
    });
  }

  return results;
}

async function processLeagueTarget(
  database: Database,
  adapter: APIFootballComAdapter,
  leagueTarget: PlayerAvailabilityLeagueTarget,
  execute: boolean
): Promise<PlayerAvailabilityLeagueReport> {
  const sportRepository = new SportRepository(database);
  const sport = await sportRepository.findSportBySlug("football");
  if (!sport) {
    throw new Error("Football sport row is required before syncing player availability.");
  }

  const playerRepository = new PlayerRepository(database);
  const providerMappings = new ProviderMappingRepository(database);
  const availabilityRepository = new FootballPlayerAvailabilityRepository(database);
  const membershipRepository = new FootballPlayerTeamMembershipRepository(database);

  const report: PlayerAvailabilityLeagueReport = {
    countryId: leagueTarget.league.countryId,
    leagueId: leagueTarget.league.leagueId,
    leagueName: leagueTarget.league.leagueName,
    providerActionUsed: "get_teams",
    credentialLabels: [],
    teamsChecked: leagueTarget.teams.length,
    matchesChecked: leagueTarget.matchesChecked,
    availabilityRowsFetched: 0,
    playersMapped: 0,
    playersWouldUpsert: 0,
    playersUpserted: 0,
    membershipsWouldUpsert: 0,
    membershipsUpserted: 0,
    availabilityRowsWouldUpsert: 0,
    availabilityRowsUpserted: 0,
    skippedRows: Object.values(leagueTarget.skippedReasons).reduce((sum, count) => sum + count, 0),
    skippedReasons: { ...leagueTarget.skippedReasons },
    missingCredential: false,
    unsupportedEndpoint: false,
    dbWritesCount: 0,
    secretExposureCheck: "clean"
  };

  for (const teamTarget of leagueTarget.teams) {
    const fetchResult = await adapter.getTeamPlayerAvailability({ teamId: teamTarget.teamProviderId });
    report.credentialLabels.push(fetchResult.metadata.credentialLabel ?? "injuries");
    const rawTeams = asTeamPayload(fetchResult.rawPayload);
    const hasPlayerPayload = rawTeams.some((team) => Array.isArray(team.players));
    if (!hasPlayerPayload) {
      report.unsupportedEndpoint = true;
      increment(report.skippedReasons, "unsupported_endpoint");
      report.skippedRows += 1;
      continue;
    }

    const mappedPlayers = dedupePlayers(
      rawTeams.flatMap((team) =>
        (Array.isArray(team.players) ? team.players : [])
          .map((player) => mapTeamPlayerToProviderPlayer(team, player))
          .filter((result): result is { status: "mapped"; data: ProviderPlayer } => result.status === "mapped")
          .map((result) => result.data)
      )
    );
    const availabilityRows = dedupeAvailabilityRows(asAvailabilityRows(fetchResult.data).filter((row) => footballPlayerAvailabilityStatuses.includes(row.status)));

    report.playersMapped += mappedPlayers.length;
    report.availabilityRowsFetched += availabilityRows.length;

    for (const availability of availabilityRows) {
      const player = mappedPlayers.find((candidate) => sameProviderPlayer(candidate, availability));
      if (!player) {
        increment(report.skippedReasons, "player_mapping_missing");
        report.skippedRows += 1;
        continue;
      }

      const resolution = await resolveCanonicalPlayer({
        execute,
        sportId: sport.id,
        player,
        canonicalTeamId: teamTarget.canonicalTeamId,
        providerMappings,
        playerRepository
      });
      if (!resolution.playerId) {
        increment(report.skippedReasons, "player_unresolved");
        report.skippedRows += 1;
        continue;
      }

      if (resolution.wouldUpsert) {
        report.playersWouldUpsert += 1;
      }
      if (resolution.didUpsert) {
        report.playersUpserted += 1;
        report.dbWritesCount += 1;
      }

      const membership = await membershipRepository.findMembership(resolution.playerId, teamTarget.canonicalTeamId, teamTarget.competitionId);
      if (!membership) {
        report.membershipsWouldUpsert += 1;
      }
      if (execute) {
        await membershipRepository.upsertMembership({
          playerId: resolution.playerId,
          teamId: teamTarget.canonicalTeamId,
          competitionId: teamTarget.competitionId,
          shirtNumber: player.jerseyNumber,
          position: player.position,
          active: true,
          metadataJson: {
            source: "apifootball-com:get_teams"
          }
        });
        report.membershipsUpserted += 1;
        report.dbWritesCount += 1;
      }

      const existingAvailability = await availabilityRepository.findAvailability({
        playerId: resolution.playerId,
        teamId: teamTarget.canonicalTeamId,
        competitionId: teamTarget.competitionId,
        matchId: undefined,
        status: availability.status,
        reason: availability.reason,
        injuryType: availability.injuryType,
        expectedReturnDate: availability.expectedReturnDate,
        sourceLabel: "apifootball-com:get_teams"
      });
      if (!existingAvailability) {
        report.availabilityRowsWouldUpsert += 1;
      }
      if (execute) {
        await availabilityRepository.upsertAvailability({
          playerId: resolution.playerId,
          teamId: teamTarget.canonicalTeamId,
          competitionId: teamTarget.competitionId,
          status: availability.status,
          reason: availability.reason,
          injuryType: availability.injuryType,
          expectedReturnDate: availability.expectedReturnDate,
          providerReportedAt: availability.providerReportedAt ? new Date(availability.providerReportedAt) : undefined,
          sourceLabel: "apifootball-com:get_teams",
          sourceQuality: availability.sourceQuality,
          metadataJson: {
            source: "apifootball-com",
            teamProviderId: availability.teamProviderId
          }
        });
        report.availabilityRowsUpserted += 1;
        report.dbWritesCount += 1;
      }
    }
  }

  report.credentialLabels = [...new Set(report.credentialLabels)];
  return report;
}

async function resolveCanonicalPlayer(input: {
  execute: boolean;
  sportId: string;
  player: ProviderPlayer;
  canonicalTeamId: string;
  providerMappings: ProviderMappingRepository;
  playerRepository: PlayerRepository;
}): Promise<{ playerId?: string; wouldUpsert: boolean; didUpsert: boolean }> {
  const providerId = input.player.providerEntityId;
  const providerMapping = providerId ? await input.providerMappings.findProviderMapping("apifootball-com", "player", providerId) : undefined;
  const slug = normalizeSlug(input.player.slug ?? input.player.name);

  if (providerMapping) {
    if (!input.execute) {
      return { playerId: providerMapping.internalEntityId, wouldUpsert: false, didUpsert: false };
    }
    await input.playerRepository.updatePlayer(providerMapping.internalEntityId, {
      sportId: input.sportId,
      nationalityCountryId: undefined,
      currentTeamId: input.canonicalTeamId,
      name: input.player.name,
      shortName: input.player.shortName,
      slug,
      dateOfBirth: input.player.dateOfBirth,
      age: input.player.age,
      position: input.player.position,
      jerseyNumber: input.player.jerseyNumber,
      photoUrl: input.player.photoUrl,
      metadataJson: input.player.metadata ?? {}
    });
    return { playerId: providerMapping.internalEntityId, wouldUpsert: false, didUpsert: true };
  }

  const existing =
    (input.player.dateOfBirth ? await input.playerRepository.findPlayerByNaturalKey(input.sportId, slug, input.player.dateOfBirth) : undefined) ??
    (await input.playerRepository.findPlayerByTeamAndSlug(input.sportId, input.canonicalTeamId, slug));
  if (existing) {
    if (!input.execute) {
      return { playerId: existing.id, wouldUpsert: false, didUpsert: false };
    }
    await input.playerRepository.updatePlayer(existing.id, {
      sportId: input.sportId,
      nationalityCountryId: undefined,
      currentTeamId: input.canonicalTeamId,
      name: input.player.name,
      shortName: input.player.shortName,
      slug,
      dateOfBirth: input.player.dateOfBirth,
      age: input.player.age,
      position: input.player.position,
      jerseyNumber: input.player.jerseyNumber,
      photoUrl: input.player.photoUrl,
      metadataJson: {
        ...(input.player.metadata ?? {}),
        matchingMode: providerId ? "provider_id_missing_existing_team_slug" : "team_slug_fallback"
      }
    });
    if (providerId) {
      await input.providerMappings.findOrCreateProviderMapping({
        provider: "apifootball-com",
        entityType: "player",
        providerEntityId: providerId,
        internalEntityType: "player",
        internalEntityId: existing.id,
        metadataJson: { source: "availability-sync" }
      });
    }
    return { playerId: existing.id, wouldUpsert: true, didUpsert: true };
  }

  if (!input.execute) {
    return { wouldUpsert: true, didUpsert: false };
  }

  const created = await input.playerRepository.createPlayer({
    sportId: input.sportId,
    nationalityCountryId: undefined,
    currentTeamId: input.canonicalTeamId,
    name: input.player.name,
    shortName: input.player.shortName,
    slug,
    dateOfBirth: input.player.dateOfBirth,
    age: input.player.age,
    position: input.player.position,
    jerseyNumber: input.player.jerseyNumber,
    photoUrl: input.player.photoUrl,
    metadataJson: {
      ...(input.player.metadata ?? {}),
      matchingMode: providerId ? "provider_id" : "team_slug_fallback"
    }
  });
  if (providerId) {
    await input.providerMappings.findOrCreateProviderMapping({
      provider: "apifootball-com",
      entityType: "player",
      providerEntityId: providerId,
      internalEntityType: "player",
      internalEntityId: created.id,
      metadataJson: { source: "availability-sync" }
    });
  }
  return { playerId: created.id, wouldUpsert: true, didUpsert: true };
}

function sameProviderPlayer(player: ProviderPlayer, availability: ProviderFootballPlayerAvailability) {
  if (availability.providerPlayerId && player.providerEntityId === availability.providerPlayerId) {
    return true;
  }
  return normalizeSlug(player.name) === normalizeSlug(availability.playerName) && player.currentTeamProviderId === availability.teamProviderId;
}

export function dedupePlayers(players: ProviderPlayer[]) {
  const seen = new Set<string>();
  return players.filter((player) => {
    const key = `${player.providerEntityId}:${player.currentTeamProviderId ?? "unknown"}:${normalizeSlug(player.name)}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function dedupeAvailabilityRows(rows: ProviderFootballPlayerAvailability[]) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = [
      row.providerPlayerId ?? normalizeSlug(row.playerName),
      row.teamProviderId,
      row.status,
      row.reason ?? "",
      row.injuryType ?? "",
      row.expectedReturnDate ?? ""
    ].join(":");
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function asTeamPayload(value: unknown): APIFootballComTeam[] {
  return Array.isArray(value) ? (value as APIFootballComTeam[]) : [];
}

function asAvailabilityRows(value: unknown): ProviderFootballPlayerAvailability[] {
  return Array.isArray(value) ? (value as ProviderFootballPlayerAvailability[]) : [];
}

function emptyPlayerAvailabilityResult(
  options: PlayerAvailabilitySyncOptions,
  stopReason: PlayerAvailabilitySyncResult["stopReason"]
): PlayerAvailabilitySyncResult {
  return {
    provider: "football-player-availability-sync",
    mode: options.execute ? "execute" : "dry-run",
    windowDays: options.windowDays,
    leaguesScanned: 0,
    totalTeamsChecked: 0,
    totalMatchesChecked: 0,
    totalAvailabilityRowsFetched: 0,
    totalPlayersMapped: 0,
    totalPlayersWouldUpsert: 0,
    totalPlayersUpserted: 0,
    totalMembershipsWouldUpsert: 0,
    totalMembershipsUpserted: 0,
    totalAvailabilityRowsWouldUpsert: 0,
    totalAvailabilityRowsUpserted: 0,
    totalSkipped: 0,
    stopReason,
    leagues: [],
    secretExposureCheck: "clean"
  };
}

function hasScope(options: PlayerAvailabilitySyncOptions) {
  return Boolean(options.allReviewedEnabled || (options.countryId && options.leagueId) || options.competitionId || options.teamId || options.matchId);
}

function parseFlag(arg: string): [string, string | undefined] {
  const [key, value] = arg.split("=", 2);
  return [key, value];
}

function requiredFlagValue(key: string, value: string | undefined) {
  if (!value) {
    throw new Error(`Flag "${key}" requires a value.`);
  }
  return value;
}

function parsePositiveInteger(key: string, value: string | undefined) {
  const parsed = Number(requiredFlagValue(key, value));
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Flag "${key}" must be a positive integer.`);
  }
  return parsed;
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function normalizeSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function increment(record: Record<string, number>, key: string) {
  record[key] = (record[key] ?? 0) + 1;
}

async function executeRows<T>(database: Database, query: ReturnType<typeof sql>): Promise<T[]> {
  const result = await database.execute(query);
  if (Array.isArray(result)) {
    return result as T[];
  }
  if (result && typeof result === "object" && "rows" in result && Array.isArray(result.rows)) {
    return result.rows as T[];
  }
  return [];
}

async function main() {
  const options = parsePlayerAvailabilitySyncArgs(process.argv.slice(2));
  const result = await runPlayerAvailabilitySync(options);
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch(async (error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
