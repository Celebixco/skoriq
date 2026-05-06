import "dotenv/config";
import { pathToFileURL } from "node:url";
import { sql } from "drizzle-orm";
import { loadConfig } from "@sports-data/config";
import {
  FootballPlayerTeamMembershipRepository,
  PlayerRepository,
  ProviderMappingRepository,
  SportRepository,
  createDatabase
} from "@sports-data/database";
import type { Database } from "@sports-data/database";
import { APIFootballComAdapter, mapTeamPlayerToProviderPlayer } from "@sports-data/providers";
import type { APIFootballComTeam, ProviderPlayer } from "@sports-data/providers";
import { manualLeagueConfigs } from "./apifootball-manual-league-config.js";
import type { ManualLeagueReviewConfig } from "./apifootball-manual-league-config.js";
import { checkDatabaseReadiness } from "./db-readiness.js";

export interface FootballPlayersSyncOptions {
  execute: boolean;
  allReviewedEnabled: boolean;
  countryId?: string;
  leagueId?: string;
  competitionId?: string;
  teamId?: string;
  windowDays: number;
  limit: number;
  maxRuntimeSeconds: number;
}

interface TeamTargetRow {
  competition_id: string;
  canonical_team_id: string;
  canonical_team_name: string;
  provider_team_id: string | null;
}

interface LeagueTeamTarget {
  league: ManualLeagueReviewConfig;
  teams: TeamTargetRow[];
  skippedReasons: Record<string, number>;
}

export interface FootballPlayersSyncLeagueReport {
  countryId: string;
  leagueId: string;
  leagueName: string;
  providerActionUsed: "get_teams";
  credentialLabels: string[];
  teamsChecked: number;
  playersFetched: number;
  playersMapped: number;
  playersWouldUpsert: number;
  playersUpserted: number;
  membershipsWouldUpsert: number;
  membershipsUpserted: number;
  skippedRows: number;
  skippedReasons: Record<string, number>;
  missingCredential: boolean;
  dbWritesCount: number;
  secretExposureCheck: "clean";
}

export interface FootballPlayersSyncResult {
  provider: "football-players-sync";
  mode: "dry-run" | "execute";
  windowDays: number;
  leaguesScanned: number;
  totalTeamsChecked: number;
  totalPlayersFetched: number;
  totalPlayersMapped: number;
  totalPlayersWouldUpsert: number;
  totalPlayersUpserted: number;
  totalMembershipsWouldUpsert: number;
  totalMembershipsUpserted: number;
  totalSkipped: number;
  stopReason: "completed" | "db_not_ready" | "max_runtime_exceeded";
  leagues: FootballPlayersSyncLeagueReport[];
  secretExposureCheck: "clean";
}

export function parseFootballPlayersSyncArgs(argv: string[]): FootballPlayersSyncOptions {
  const options: FootballPlayersSyncOptions = {
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
    if (arg === "--all-reviewed-enabled") {
      options.allReviewedEnabled = true;
      continue;
    }
    if (arg === "--dry-run") {
      options.execute = false;
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
        throw new Error(`Unknown football players sync flag "${key}".`);
    }
  }

  if (!hasScope(options)) {
    throw new Error(
      "Football players sync requires one scope: --all-reviewed-enabled, --country-id plus --league-id, --competition-id, or --team-id."
    );
  }
  if (Boolean(options.countryId) !== Boolean(options.leagueId)) {
    throw new Error("Football players sync requires --country-id and --league-id together.");
  }
  return options;
}

export async function runFootballPlayersSync(options: FootballPlayersSyncOptions): Promise<FootballPlayersSyncResult> {
  const config = loadConfig();
  const readiness = await checkDatabaseReadiness({
    databaseUrl: config.DATABASE_URL,
    nodeEnv: config.NODE_ENV,
    dbExecutionTarget: config.DB_EXECUTION_TARGET,
    allowRemoteTestDb: config.ALLOW_REMOTE_TEST_DB,
    neonBranchName: config.NEON_BRANCH_NAME
  });

  if (readiness.status !== "ready") {
    return emptyResult(options, "db_not_ready");
  }

  const database = createDatabase(config.DATABASE_URL);
  const adapter = new APIFootballComAdapter({
    enabled: config.APIFOOTBALL_COM_ENABLED,
    apiKey: config.APIFOOTBALL_COM_API_KEY,
    apiKeys: {
      defaultApiKey: config.APIFOOTBALL_COM_API_KEY_DEFAULT,
      teamsApiKey: config.APIFOOTBALL_COM_API_KEY_TEAMS,
      playersApiKey: config.APIFOOTBALL_COM_API_KEY_PLAYERS
    },
    baseUrl: config.APIFOOTBALL_COM_BASE_URL,
    timeoutMs: config.APIFOOTBALL_COM_TIMEOUT_MS,
    environment: {
      nodeEnv: config.NODE_ENV,
      allowProductionAccess: config.APIFOOTBALL_COM_ALLOW_PRODUCTION
    }
  });

  const startedAt = new Date();
  const windowEnd = addDays(startedAt, options.windowDays);
  const leagueTargets = await loadLeagueTargets(database, resolveLeagues(options), options, startedAt, windowEnd);
  const reports: FootballPlayersSyncLeagueReport[] = [];
  let stopReason: FootballPlayersSyncResult["stopReason"] = "completed";

  for (const leagueTarget of leagueTargets) {
    if (Date.now() - startedAt.getTime() > options.maxRuntimeSeconds * 1000) {
      stopReason = "max_runtime_exceeded";
      break;
    }
    reports.push(await processLeagueTarget(database, adapter, leagueTarget, options.execute));
  }

  return {
    provider: "football-players-sync",
    mode: options.execute ? "execute" : "dry-run",
    windowDays: options.windowDays,
    leaguesScanned: reports.length,
    totalTeamsChecked: reports.reduce((sum, row) => sum + row.teamsChecked, 0),
    totalPlayersFetched: reports.reduce((sum, row) => sum + row.playersFetched, 0),
    totalPlayersMapped: reports.reduce((sum, row) => sum + row.playersMapped, 0),
    totalPlayersWouldUpsert: reports.reduce((sum, row) => sum + row.playersWouldUpsert, 0),
    totalPlayersUpserted: reports.reduce((sum, row) => sum + row.playersUpserted, 0),
    totalMembershipsWouldUpsert: reports.reduce((sum, row) => sum + row.membershipsWouldUpsert, 0),
    totalMembershipsUpserted: reports.reduce((sum, row) => sum + row.membershipsUpserted, 0),
    totalSkipped: reports.reduce((sum, row) => sum + row.skippedRows, 0),
    stopReason,
    leagues: reports,
    secretExposureCheck: "clean"
  };
}

async function loadLeagueTargets(
  database: Database,
  leagues: ManualLeagueReviewConfig[],
  options: FootballPlayersSyncOptions,
  startedAt: Date,
  windowEnd: Date
): Promise<LeagueTeamTarget[]> {
  const targets: LeagueTeamTarget[] = [];
  for (const league of leagues) {
    const rows = await executeRows<TeamTargetRow>(
      database,
      sql`
        select distinct
          m.competition_id,
          t.id as canonical_team_id,
          t.name as canonical_team_name,
          pm.provider_entity_id as provider_team_id
        from matches m
        inner join competitions c on c.id = m.competition_id
        inner join sports s on s.id = c.sport_id and s.slug = 'football'
        inner join provider_mappings cpm
          on cpm.provider = 'apifootball-com'
          and cpm.entity_type = 'competition'
          and cpm.internal_entity_type = 'competition'
          and cpm.internal_entity_id = c.id
          and cpm.provider_entity_id = ${league.leagueId}
        inner join teams t on (t.id = m.home_team_id or t.id = m.away_team_id)
        left join provider_mappings pm
          on pm.provider = 'apifootball-com'
          and pm.entity_type = 'team'
          and pm.internal_entity_type = 'team'
          and pm.internal_entity_id = t.id
        where m.status in ('scheduled', 'not_started', 'postponed')
          and m.scheduled_start_at >= ${startedAt}
          and m.scheduled_start_at <= ${windowEnd}
          ${options.competitionId ? sql`and m.competition_id = ${options.competitionId}` : sql``}
          ${options.teamId ? sql`and t.id = ${options.teamId}` : sql``}
        order by t.name asc
        limit ${options.limit}
      `
    );

    const skippedReasons: Record<string, number> = {};
    for (const row of rows) {
      if (!row.provider_team_id) {
        increment(skippedReasons, "missing_team_mapping");
      }
    }

    targets.push({
      league,
      teams: rows.filter((row) => Boolean(row.provider_team_id)),
      skippedReasons
    });
  }

  return targets;
}

async function processLeagueTarget(
  database: Database,
  adapter: APIFootballComAdapter,
  target: LeagueTeamTarget,
  execute: boolean
): Promise<FootballPlayersSyncLeagueReport> {
  const sportRepository = new SportRepository(database);
  const sport = await sportRepository.findSportBySlug("football");
  if (!sport) {
    throw new Error("Football sport row is required before syncing players.");
  }

  const playerRepository = new PlayerRepository(database);
  const membershipRepository = new FootballPlayerTeamMembershipRepository(database);
  const mappingRepository = new ProviderMappingRepository(database);
  const report: FootballPlayersSyncLeagueReport = {
    countryId: target.league.countryId,
    leagueId: target.league.leagueId,
    leagueName: target.league.leagueName,
    providerActionUsed: "get_teams",
    credentialLabels: [],
    teamsChecked: target.teams.length,
    playersFetched: 0,
    playersMapped: 0,
    playersWouldUpsert: 0,
    playersUpserted: 0,
    membershipsWouldUpsert: 0,
    membershipsUpserted: 0,
    skippedRows: Object.values(target.skippedReasons).reduce((sum, value) => sum + value, 0),
    skippedReasons: { ...target.skippedReasons },
    missingCredential: false,
    dbWritesCount: 0,
    secretExposureCheck: "clean"
  };

  for (const team of target.teams) {
    const fetchResult = await adapter.getTeamPlayers({ teamId: team.provider_team_id! });
    report.credentialLabels.push(fetchResult.metadata.credentialLabel ?? "players");
    const rawTeams = asTeamPayload(fetchResult.rawPayload);
    const mappedPlayers = dedupePlayers(
      rawTeams.flatMap((providerTeam) =>
        (Array.isArray(providerTeam.players) ? providerTeam.players : [])
          .map((player) => mapTeamPlayerToProviderPlayer(providerTeam, player))
          .filter((mapped): mapped is { status: "mapped"; data: ProviderPlayer } => mapped.status === "mapped")
          .map((mapped) => mapped.data)
      )
    );

    report.playersFetched += mappedPlayers.length;
    report.playersMapped += mappedPlayers.length;

    for (const player of mappedPlayers) {
      const resolution = await resolveCanonicalPlayer({
        execute,
        sportId: sport.id,
        player,
        canonicalTeamId: team.canonical_team_id,
        playerRepository,
        mappingRepository
      });

      if (!resolution.playerId) {
        increment(report.skippedReasons, "player_unresolved");
        report.skippedRows += 1;
        continue;
      }

      if (resolution.wouldUpsert) report.playersWouldUpsert += 1;
      if (resolution.didUpsert) {
        report.playersUpserted += 1;
        report.dbWritesCount += 1;
      }

      const membership = await membershipRepository.findMembership(resolution.playerId, team.canonical_team_id, team.competition_id);
      if (!membership) {
        report.membershipsWouldUpsert += 1;
      }
      if (execute) {
        await membershipRepository.upsertMembership({
          playerId: resolution.playerId,
          teamId: team.canonical_team_id,
          competitionId: team.competition_id,
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
  playerRepository: PlayerRepository;
  mappingRepository: ProviderMappingRepository;
}): Promise<{ playerId?: string; wouldUpsert: boolean; didUpsert: boolean }> {
  const providerId = input.player.providerEntityId;
  const mapping = providerId ? await input.mappingRepository.findProviderMapping("apifootball-com", "player", providerId) : undefined;
  const slug = normalizeSlug(input.player.slug ?? input.player.name);

  if (mapping) {
    if (!input.execute) {
      return { playerId: mapping.internalEntityId, wouldUpsert: false, didUpsert: false };
    }
    await input.playerRepository.updatePlayer(mapping.internalEntityId, {
      sportId: input.sportId,
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
    return { playerId: mapping.internalEntityId, wouldUpsert: false, didUpsert: true };
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
    if (providerId) {
      await input.mappingRepository.findOrCreateProviderMapping({
        provider: "apifootball-com",
        entityType: "player",
        providerEntityId: providerId,
        internalEntityType: "player",
        internalEntityId: existing.id,
        metadataJson: { source: "players-sync" }
      });
    }
    return { playerId: existing.id, wouldUpsert: true, didUpsert: true };
  }

  if (!input.execute) {
    return { wouldUpsert: true, didUpsert: false };
  }

  const created = await input.playerRepository.createPlayer({
    sportId: input.sportId,
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

  if (providerId) {
    await input.mappingRepository.findOrCreateProviderMapping({
      provider: "apifootball-com",
      entityType: "player",
      providerEntityId: providerId,
      internalEntityType: "player",
      internalEntityId: created.id,
      metadataJson: { source: "players-sync" }
    });
  }

  return { playerId: created.id, wouldUpsert: true, didUpsert: true };
}

function resolveLeagues(options: FootballPlayersSyncOptions) {
  const matches = manualLeagueConfigs.filter((league) =>
    options.allReviewedEnabled ? league.reviewed && league.enabled : league.countryId === options.countryId && league.leagueId === options.leagueId
  );
  if (matches.length === 0) {
    throw new Error("Football players sync is limited to configured reviewed and enabled leagues.");
  }
  return matches.slice(0, options.limit);
}

function hasScope(options: FootballPlayersSyncOptions) {
  return Boolean(options.allReviewedEnabled || (options.countryId && options.leagueId) || options.competitionId || options.teamId);
}

function emptyResult(options: FootballPlayersSyncOptions, stopReason: FootballPlayersSyncResult["stopReason"]): FootballPlayersSyncResult {
  return {
    provider: "football-players-sync",
    mode: options.execute ? "execute" : "dry-run",
    windowDays: options.windowDays,
    leaguesScanned: 0,
    totalTeamsChecked: 0,
    totalPlayersFetched: 0,
    totalPlayersMapped: 0,
    totalPlayersWouldUpsert: 0,
    totalPlayersUpserted: 0,
    totalMembershipsWouldUpsert: 0,
    totalMembershipsUpserted: 0,
    totalSkipped: 0,
    stopReason,
    leagues: [],
    secretExposureCheck: "clean"
  };
}

function asTeamPayload(value: unknown): APIFootballComTeam[] {
  return Array.isArray(value) ? (value as APIFootballComTeam[]) : [];
}

function dedupePlayers(players: ProviderPlayer[]) {
  const map = new Map<string, ProviderPlayer>();
  for (const player of players) {
    const key = player.providerEntityId || normalizeSlug(player.name);
    if (!map.has(key)) {
      map.set(key, player);
    }
  }
  return [...map.values()];
}

function normalizeSlug(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 180);
}

function increment(record: Record<string, number>, key: string) {
  record[key] = (record[key] ?? 0) + 1;
}

function addDays(base: Date, days: number) {
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}

async function executeRows<TRow>(database: Database, query: ReturnType<typeof sql>) {
  const result = await database.execute(query);
  return result.rows as TRow[];
}

function parseFlag(arg: string): [string, string | undefined] {
  const [key, value] = arg.split("=", 2);
  return [key, value];
}

function requiredFlagValue(flag: string, value: string | undefined) {
  if (!value) throw new Error(`${flag} requires a value.`);
  return value;
}

function parsePositiveInteger(flag: string, value: string | undefined) {
  const raw = requiredFlagValue(flag, value);
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${flag} must be a positive integer.`);
  return parsed;
}

async function main() {
  const options = parseFootballPlayersSyncArgs(process.argv.slice(2));
  const result = await runFootballPlayersSync(options);
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
