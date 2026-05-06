import "dotenv/config";
import { pathToFileURL } from "node:url";
import { sql } from "drizzle-orm";
import { loadConfig } from "@sports-data/config";
import {
  FootballMatchLineupRepository,
  FootballPlayerTeamMembershipRepository,
  PlayerRepository,
  ProviderMappingRepository,
  SportRepository,
  createDatabase
} from "@sports-data/database";
import type { Database } from "@sports-data/database";
import { APIFootballComAdapter } from "@sports-data/providers";
import type { ProviderFootballMatchLineupPlayer } from "@sports-data/providers";
import { manualLeagueConfigs } from "./apifootball-manual-league-config.js";
import type { ManualLeagueReviewConfig } from "./apifootball-manual-league-config.js";
import { checkDatabaseReadiness } from "./db-readiness.js";

export interface FootballLineupsSyncOptions {
  execute: boolean;
  allReviewedEnabled: boolean;
  countryId?: string;
  leagueId?: string;
  competitionId?: string;
  matchId?: string;
  windowHours: number;
  limit: number;
  maxRuntimeSeconds: number;
}

interface MatchTargetRow {
  match_id: string;
  competition_id: string;
  provider_match_id: string | null;
  scheduled_start_at: Date;
  home_team_id: string;
  away_team_id: string;
}

interface LeagueMatchTarget {
  league: ManualLeagueReviewConfig;
  matches: MatchTargetRow[];
}

export interface FootballLineupsSyncLeagueReport {
  countryId: string;
  leagueId: string;
  leagueName: string;
  providerActionUsed: "get_lineups";
  credentialLabels: string[];
  matchesChecked: number;
  lineupRowsFetched: number;
  lineupRowsWouldUpsert: number;
  lineupRowsUpserted: number;
  lineupPlayersWouldUpsert: number;
  lineupPlayersUpserted: number;
  skippedRows: number;
  skippedReasons: Record<string, number>;
  missingCredential: boolean;
  unsupportedEndpoint: boolean;
  dbWritesCount: number;
  secretExposureCheck: "clean";
}

export interface FootballLineupsSyncResult {
  provider: "football-lineups-sync";
  mode: "dry-run" | "execute";
  windowHours: number;
  leaguesScanned: number;
  totalMatchesChecked: number;
  totalLineupRowsFetched: number;
  totalLineupRowsWouldUpsert: number;
  totalLineupRowsUpserted: number;
  totalLineupPlayersWouldUpsert: number;
  totalLineupPlayersUpserted: number;
  totalSkipped: number;
  stopReason: "completed" | "db_not_ready" | "missing_lineups_credential" | "max_runtime_exceeded";
  leagues: FootballLineupsSyncLeagueReport[];
  secretExposureCheck: "clean";
}

export function parseFootballLineupsSyncArgs(argv: string[]): FootballLineupsSyncOptions {
  const options: FootballLineupsSyncOptions = {
    execute: false,
    allReviewedEnabled: false,
    windowHours: 48,
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
      case "--match-id":
        options.matchId = requiredFlagValue(key, value);
        break;
      case "--window-hours":
        options.windowHours = parsePositiveInteger(key, value);
        break;
      case "--limit":
        options.limit = Math.min(parsePositiveInteger(key, value), 200);
        break;
      case "--max-runtime-seconds":
        options.maxRuntimeSeconds = parsePositiveInteger(key, value);
        break;
      default:
        throw new Error(`Unknown football lineups sync flag "${key}".`);
    }
  }

  if (!hasScope(options)) {
    throw new Error("Football lineups sync requires one scope: --all-reviewed-enabled, --country-id plus --league-id, --competition-id, or --match-id.");
  }
  if (Boolean(options.countryId) !== Boolean(options.leagueId)) {
    throw new Error("Football lineups sync requires --country-id and --league-id together.");
  }
  return options;
}

export async function runFootballLineupsSync(options: FootballLineupsSyncOptions): Promise<FootballLineupsSyncResult> {
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
  if (!config.APIFOOTBALL_COM_API_KEY_LINEUPS) {
    return emptyResult(options, "missing_lineups_credential");
  }

  const database = createDatabase(config.DATABASE_URL);
  const adapter = new APIFootballComAdapter({
    enabled: config.APIFOOTBALL_COM_ENABLED,
    apiKey: config.APIFOOTBALL_COM_API_KEY,
    apiKeys: {
      defaultApiKey: config.APIFOOTBALL_COM_API_KEY_DEFAULT,
      lineupsApiKey: config.APIFOOTBALL_COM_API_KEY_LINEUPS,
      teamsApiKey: config.APIFOOTBALL_COM_API_KEY_TEAMS
    },
    baseUrl: config.APIFOOTBALL_COM_BASE_URL,
    timeoutMs: config.APIFOOTBALL_COM_TIMEOUT_MS,
    environment: {
      nodeEnv: config.NODE_ENV,
      allowProductionAccess: config.APIFOOTBALL_COM_ALLOW_PRODUCTION
    }
  });

  const now = new Date();
  const windowEnd = new Date(now.getTime() + options.windowHours * 60 * 60 * 1000);
  const leagues = resolveLeagues(options);
  const targets = await loadMatchTargets(database, leagues, options, now, windowEnd);
  const reports: FootballLineupsSyncLeagueReport[] = [];
  let stopReason: FootballLineupsSyncResult["stopReason"] = "completed";
  const startedAt = Date.now();

  for (const target of targets) {
    if (Date.now() - startedAt > options.maxRuntimeSeconds * 1000) {
      stopReason = "max_runtime_exceeded";
      break;
    }
    reports.push(await processLeagueTarget(database, adapter, target, options.execute));
  }

  return {
    provider: "football-lineups-sync",
    mode: options.execute ? "execute" : "dry-run",
    windowHours: options.windowHours,
    leaguesScanned: reports.length,
    totalMatchesChecked: reports.reduce((sum, row) => sum + row.matchesChecked, 0),
    totalLineupRowsFetched: reports.reduce((sum, row) => sum + row.lineupRowsFetched, 0),
    totalLineupRowsWouldUpsert: reports.reduce((sum, row) => sum + row.lineupRowsWouldUpsert, 0),
    totalLineupRowsUpserted: reports.reduce((sum, row) => sum + row.lineupRowsUpserted, 0),
    totalLineupPlayersWouldUpsert: reports.reduce((sum, row) => sum + row.lineupPlayersWouldUpsert, 0),
    totalLineupPlayersUpserted: reports.reduce((sum, row) => sum + row.lineupPlayersUpserted, 0),
    totalSkipped: reports.reduce((sum, row) => sum + row.skippedRows, 0),
    stopReason,
    leagues: reports,
    secretExposureCheck: "clean"
  };
}

async function loadMatchTargets(
  database: Database,
  leagues: ManualLeagueReviewConfig[],
  options: FootballLineupsSyncOptions,
  startedAt: Date,
  windowEnd: Date
): Promise<LeagueMatchTarget[]> {
  const targets: LeagueMatchTarget[] = [];
  for (const league of leagues) {
    const rows = await executeRows<MatchTargetRow>(
      database,
      sql`
        select
          m.id as match_id,
          m.competition_id,
          m.scheduled_start_at,
          m.home_team_id,
          m.away_team_id,
          pm.provider_entity_id as provider_match_id
        from matches m
        inner join competitions c on c.id = m.competition_id
        inner join sports s on s.id = c.sport_id and s.slug = 'football'
        inner join provider_mappings cpm
          on cpm.provider = 'apifootball-com'
          and cpm.entity_type = 'competition'
          and cpm.internal_entity_type = 'competition'
          and cpm.internal_entity_id = c.id
          and cpm.provider_entity_id = ${league.leagueId}
        left join provider_mappings pm
          on pm.provider = 'apifootball-com'
          and pm.entity_type = 'match'
          and pm.internal_entity_type = 'match'
          and pm.internal_entity_id = m.id
        where m.scheduled_start_at >= ${startedAt}
          and m.scheduled_start_at <= ${windowEnd}
          and m.status in ('scheduled', 'not_started', 'postponed')
          ${options.competitionId ? sql`and m.competition_id = ${options.competitionId}` : sql``}
          ${options.matchId ? sql`and m.id = ${options.matchId}` : sql``}
        order by m.scheduled_start_at asc
        limit ${options.limit}
      `
    );
    targets.push({ league, matches: rows });
  }
  return targets;
}

async function processLeagueTarget(
  database: Database,
  adapter: APIFootballComAdapter,
  target: LeagueMatchTarget,
  execute: boolean
): Promise<FootballLineupsSyncLeagueReport> {
  const sportRepository = new SportRepository(database);
  const sport = await sportRepository.findSportBySlug("football");
  if (!sport) throw new Error("Football sport row is required before syncing lineups.");

  const playerRepository = new PlayerRepository(database);
  const membershipRepository = new FootballPlayerTeamMembershipRepository(database);
  const mappingRepository = new ProviderMappingRepository(database);
  const lineupRepository = new FootballMatchLineupRepository(database);

  const report: FootballLineupsSyncLeagueReport = {
    countryId: target.league.countryId,
    leagueId: target.league.leagueId,
    leagueName: target.league.leagueName,
    providerActionUsed: "get_lineups",
    credentialLabels: [],
    matchesChecked: target.matches.length,
    lineupRowsFetched: 0,
    lineupRowsWouldUpsert: 0,
    lineupRowsUpserted: 0,
    lineupPlayersWouldUpsert: 0,
    lineupPlayersUpserted: 0,
    skippedRows: 0,
    skippedReasons: {},
    missingCredential: false,
    unsupportedEndpoint: false,
    dbWritesCount: 0,
    secretExposureCheck: "clean"
  };

  for (const match of target.matches) {
    if (!match.provider_match_id) {
      increment(report.skippedReasons, "missing_match_mapping");
      report.skippedRows += 1;
      continue;
    }
    const fetchResult = await adapter.getMatchLineups({ matchId: match.provider_match_id });
    report.credentialLabels.push(fetchResult.metadata.credentialLabel ?? "lineups");
    const lineups = Array.isArray(fetchResult.data) ? fetchResult.data : [];
    report.lineupRowsFetched += lineups.length;
    if (lineups.length === 0) {
      report.unsupportedEndpoint = true;
      increment(report.skippedReasons, "lineup_not_available");
      report.skippedRows += 1;
      continue;
    }

    for (const lineup of lineups) {
      const canonicalTeamId = lineup.teamProviderId === undefined ? undefined : await resolveCanonicalTeamId(mappingRepository, lineup.teamProviderId);
      if (!canonicalTeamId) {
        increment(report.skippedReasons, "missing_team_mapping");
        report.skippedRows += 1;
        continue;
      }

      const existingLineup = await lineupRepository.findMatchLineup(match.match_id, canonicalTeamId);
      if (!existingLineup) report.lineupRowsWouldUpsert += 1;
      const persistedLineup =
        execute
          ? await lineupRepository.upsertMatchLineup({
              matchId: match.match_id,
              teamId: canonicalTeamId,
              formation: lineup.formation,
              confirmed: lineup.confirmed,
              providerReportedAt: lineup.providerReportedAt ? new Date(lineup.providerReportedAt) : undefined,
              metadataJson: lineup.metadata ?? {}
            })
          : { id: `dry-run:${match.match_id}:${canonicalTeamId}` };
      if (execute) {
        report.lineupRowsUpserted += 1;
        report.dbWritesCount += 1;
      }

      const allPlayers = [...lineup.starting, ...lineup.substitutes, ...lineup.unavailable];
      for (const player of allPlayers) {
        const playerId = await resolveCanonicalLineupPlayer({
          execute,
          sportId: sport.id,
          player,
          canonicalTeamId,
          playerRepository,
          mappingRepository,
          membershipRepository,
          competitionId: match.competition_id
        });
        if (!playerId) {
          increment(report.skippedReasons, "player_unresolved");
          report.skippedRows += 1;
          continue;
        }
        report.lineupPlayersWouldUpsert += 1;
        if (execute) {
          await lineupRepository.upsertMatchLineupPlayer({
            matchLineupId: persistedLineup.id,
            matchId: match.match_id,
            teamId: canonicalTeamId,
            playerId,
            role: player.role,
            position: player.position,
            shirtNumber: player.shirtNumber,
            orderIndex: player.orderIndex,
            metadataJson: player.metadata ?? {}
          });
          report.lineupPlayersUpserted += 1;
          report.dbWritesCount += 1;
        }
      }
    }
  }

  report.credentialLabels = [...new Set(report.credentialLabels)];
  return report;
}

async function resolveCanonicalTeamId(mappingRepository: ProviderMappingRepository, providerTeamId: string) {
  const mapping = await mappingRepository.findProviderMapping("apifootball-com", "team", providerTeamId);
  return mapping?.internalEntityId;
}

async function resolveCanonicalLineupPlayer(input: {
  execute: boolean;
  sportId: string;
  player: ProviderFootballMatchLineupPlayer;
  canonicalTeamId: string;
  competitionId: string;
  playerRepository: PlayerRepository;
  mappingRepository: ProviderMappingRepository;
  membershipRepository: FootballPlayerTeamMembershipRepository;
}): Promise<string | undefined> {
  const providerId = input.player.providerPlayerId;
  const slug = normalizeSlug(input.player.playerName);
  const mapping = providerId ? await input.mappingRepository.findProviderMapping("apifootball-com", "player", providerId) : undefined;
  if (mapping) return mapping.internalEntityId;

  const existing = await input.playerRepository.findPlayerByTeamAndSlug(input.sportId, input.canonicalTeamId, slug);
  if (existing) return existing.id;

  if (!input.execute) return undefined;

  const created = await input.playerRepository.createPlayer({
    sportId: input.sportId,
    currentTeamId: input.canonicalTeamId,
    name: input.player.playerName,
    shortName: input.player.playerName,
    slug,
    position: input.player.position,
    jerseyNumber: input.player.shirtNumber,
    metadataJson: input.player.metadata ?? {}
  });

  if (providerId) {
    await input.mappingRepository.findOrCreateProviderMapping({
      provider: "apifootball-com",
      entityType: "player",
      providerEntityId: providerId,
      internalEntityType: "player",
      internalEntityId: created.id,
      metadataJson: { source: "lineups-sync" }
    });
  }
  await input.membershipRepository.upsertMembership({
    playerId: created.id,
    teamId: input.canonicalTeamId,
    competitionId: input.competitionId,
    shirtNumber: input.player.shirtNumber,
    position: input.player.position,
    active: true,
    metadataJson: { source: "apifootball-com:get_lineups" }
  });
  return created.id;
}

function resolveLeagues(options: FootballLineupsSyncOptions) {
  const matches = manualLeagueConfigs.filter((league) =>
    options.allReviewedEnabled ? league.reviewed && league.enabled : league.countryId === options.countryId && league.leagueId === options.leagueId
  );
  if (matches.length === 0) {
    throw new Error("Football lineups sync is limited to configured reviewed and enabled leagues.");
  }
  return matches.slice(0, options.limit);
}

function hasScope(options: FootballLineupsSyncOptions) {
  return Boolean(options.allReviewedEnabled || (options.countryId && options.leagueId) || options.competitionId || options.matchId);
}

function emptyResult(options: FootballLineupsSyncOptions, stopReason: FootballLineupsSyncResult["stopReason"]): FootballLineupsSyncResult {
  return {
    provider: "football-lineups-sync",
    mode: options.execute ? "execute" : "dry-run",
    windowHours: options.windowHours,
    leaguesScanned: 0,
    totalMatchesChecked: 0,
    totalLineupRowsFetched: 0,
    totalLineupRowsWouldUpsert: 0,
    totalLineupRowsUpserted: 0,
    totalLineupPlayersWouldUpsert: 0,
    totalLineupPlayersUpserted: 0,
    totalSkipped: 0,
    stopReason,
    leagues: [],
    secretExposureCheck: "clean"
  };
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
  const options = parseFootballLineupsSyncArgs(process.argv.slice(2));
  const result = await runFootballLineupsSync(options);
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
