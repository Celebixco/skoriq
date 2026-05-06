import "dotenv/config";
import { pathToFileURL } from "node:url";
import { sql } from "drizzle-orm";
import { FootballMatchPlayerContextFeatureRepository, createDatabase } from "@sports-data/database";
import type { Database } from "@sports-data/database";
import type { FootballPlayerContextRiskLevel } from "@sports-data/shared";
import { loadConfig } from "@sports-data/config";
import { checkDatabaseReadiness } from "./db-readiness.js";

export interface FootballPlayerContextBuildOptions {
  execute: boolean;
  allReviewedEnabled: boolean;
  matchId?: string;
  countryId?: string;
  leagueId?: string;
}

interface MatchContextRow {
  match_id: string;
  home_team_id: string;
  away_team_id: string;
}

export interface FootballPlayerContextBuildResult {
  mode: "dry-run" | "execute";
  matchesConsidered: number;
  featuresCalculated: number;
  featuresWritten: number;
  riskLevels: Record<string, number>;
  stopReason: "completed" | "db_not_ready";
}

export function parseFootballPlayerContextBuildArgs(argv: string[]): FootballPlayerContextBuildOptions {
  const options: FootballPlayerContextBuildOptions = {
    execute: false,
    allReviewedEnabled: false
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
    const [key, value] = arg.split("=", 2);
    switch (key) {
      case "--match-id":
        options.matchId = value;
        break;
      case "--country-id":
        options.countryId = value;
        break;
      case "--league-id":
        options.leagueId = value;
        break;
      default:
        throw new Error(`Unknown football player-context build flag "${key}".`);
    }
  }
  return options;
}

export async function runFootballPlayerContextBuild(options: FootballPlayerContextBuildOptions): Promise<FootballPlayerContextBuildResult> {
  const config = loadConfig();
  const readiness = await checkDatabaseReadiness({
    databaseUrl: config.DATABASE_URL,
    nodeEnv: config.NODE_ENV,
    dbExecutionTarget: config.DB_EXECUTION_TARGET,
    allowRemoteTestDb: config.ALLOW_REMOTE_TEST_DB,
    neonBranchName: config.NEON_BRANCH_NAME
  });
  if (readiness.status !== "ready") {
    return {
      mode: options.execute ? "execute" : "dry-run",
      matchesConsidered: 0,
      featuresCalculated: 0,
      featuresWritten: 0,
      riskLevels: {},
      stopReason: "db_not_ready"
    };
  }

  const database = createDatabase(config.DATABASE_URL);
  const repository = new FootballMatchPlayerContextFeatureRepository(database);
  const matches = await loadTargetMatches(database, options);
  const riskLevels: Record<string, number> = {};
  let featuresWritten = 0;

  for (const match of matches) {
    const feature = await buildPlayerContextFeature(database, match);
    riskLevels[feature.playerContextRiskLevel] = (riskLevels[feature.playerContextRiskLevel] ?? 0) + 1;
    if (options.execute) {
      await repository.upsertFeature(feature);
      featuresWritten += 1;
    }
  }

  return {
    mode: options.execute ? "execute" : "dry-run",
    matchesConsidered: matches.length,
    featuresCalculated: matches.length,
    featuresWritten,
    riskLevels,
    stopReason: "completed"
  };
}

async function loadTargetMatches(database: Database, options: FootballPlayerContextBuildOptions) {
  const rows = await executeRows<MatchContextRow>(
    database,
    sql`
      select
        m.id as match_id,
        m.home_team_id,
        m.away_team_id
      from matches m
      inner join competitions c on c.id = m.competition_id
      inner join sports s on s.id = c.sport_id and s.slug = 'football'
      ${options.countryId && options.leagueId
        ? sql`inner join provider_mappings cpm
              on cpm.provider = 'apifootball-com'
             and cpm.entity_type = 'competition'
             and cpm.internal_entity_type = 'competition'
             and cpm.internal_entity_id = c.id
             and cpm.provider_entity_id = ${options.leagueId}`
        : sql``}
      where 1=1
        ${options.matchId ? sql`and m.id = ${options.matchId}` : sql``}
    `
  );
  return rows;
}

async function buildPlayerContextFeature(database: Database, match: MatchContextRow) {
  const homeAvailability = await getTeamAvailabilityStats(database, match.home_team_id, match.match_id);
  const awayAvailability = await getTeamAvailabilityStats(database, match.away_team_id, match.match_id);
  const homeLineup = await getTeamLineupStats(database, match.home_team_id, match.match_id);
  const awayLineup = await getTeamLineupStats(database, match.away_team_id, match.match_id);

  const homeCoverage = computeCoverage(homeAvailability.totalRows, homeLineup.totalKnown);
  const awayCoverage = computeCoverage(awayAvailability.totalRows, awayLineup.totalKnown);
  const combinedCoverage = round((homeCoverage + awayCoverage) / 2, 2);
  const riskLevel = deriveRiskLevel({
    combinedCoverage,
    homeMissing: homeAvailability.missingCount,
    awayMissing: awayAvailability.missingCount,
    homeConfirmed: homeLineup.confirmed,
    awayConfirmed: awayLineup.confirmed
  });

  return {
    matchId: match.match_id,
    homeMissingPlayersCount: homeAvailability.missingCount,
    awayMissingPlayersCount: awayAvailability.missingCount,
    homeSuspendedCount: homeAvailability.suspendedCount,
    awaySuspendedCount: awayAvailability.suspendedCount,
    homeInjuredCount: homeAvailability.injuredCount,
    awayInjuredCount: awayAvailability.injuredCount,
    homeDoubtfulCount: homeAvailability.doubtfulCount,
    awayDoubtfulCount: awayAvailability.doubtfulCount,
    homeLineupConfirmed: homeLineup.confirmed,
    awayLineupConfirmed: awayLineup.confirmed,
    homeStartingXiKnown: homeLineup.startingCount >= 11,
    awayStartingXiKnown: awayLineup.startingCount >= 11,
    homeAvailabilityCoverageScore: homeCoverage,
    awayAvailabilityCoverageScore: awayCoverage,
    playerContextCoverageScore: combinedCoverage,
    playerContextRiskLevel: riskLevel,
    metadataJson: {
      homeAvailabilityRows: homeAvailability.totalRows,
      awayAvailabilityRows: awayAvailability.totalRows,
      homeLineupPlayersKnown: homeLineup.totalKnown,
      awayLineupPlayersKnown: awayLineup.totalKnown
    }
  };
}

async function getTeamAvailabilityStats(database: Database, teamId: string, matchId: string) {
  const rows = await executeRows<{
    status: string;
    count: number;
  }>(
    database,
    sql`
      select status, count(*)::int as count
      from football_player_availability
      where team_id = ${teamId}
        and (match_id = ${matchId} or match_id is null)
      group by status
    `
  );

  const get = (status: string) => rows.find((row) => row.status === status)?.count ?? 0;
  const injuredCount = get("injured");
  const suspendedCount = get("suspended");
  const doubtfulCount = get("doubtful") + get("questionable");
  return {
    totalRows: rows.reduce((sum, row) => sum + row.count, 0),
    injuredCount,
    suspendedCount,
    doubtfulCount,
    missingCount: injuredCount + suspendedCount + doubtfulCount
  };
}

async function getTeamLineupStats(database: Database, teamId: string, matchId: string) {
  const lineupRows = await executeRows<{ confirmed: boolean }>(
    database,
    sql`select confirmed from football_match_lineups where match_id = ${matchId} and team_id = ${teamId} limit 1`
  );
  const playerRows = await executeRows<{ role: string; count: number }>(
    database,
    sql`
      select role, count(*)::int as count
      from football_match_lineup_players
      where match_id = ${matchId}
        and team_id = ${teamId}
      group by role
    `
  );
  const startingCount = playerRows.find((row) => row.role === "starting")?.count ?? 0;
  const substituteCount = playerRows.find((row) => row.role === "substitute")?.count ?? 0;
  const unavailableCount = playerRows.find((row) => row.role === "unavailable")?.count ?? 0;
  return {
    confirmed: lineupRows[0]?.confirmed ?? false,
    startingCount,
    totalKnown: startingCount + substituteCount + unavailableCount
  };
}

function computeCoverage(availabilityRows: number, knownLineupPlayers: number) {
  const availabilityScore = Math.min(100, availabilityRows * 12);
  const lineupScore = Math.min(100, knownLineupPlayers * 4);
  return round(Math.max(availabilityScore, lineupScore), 2);
}

function deriveRiskLevel(input: {
  combinedCoverage: number;
  homeMissing: number;
  awayMissing: number;
  homeConfirmed: boolean;
  awayConfirmed: boolean;
}): FootballPlayerContextRiskLevel {
  if (input.combinedCoverage === 0) return "unknown";
  if (input.homeMissing + input.awayMissing >= 6) return "high";
  if (!input.homeConfirmed || !input.awayConfirmed) return input.combinedCoverage >= 50 ? "medium" : "unknown";
  if (input.homeMissing + input.awayMissing >= 3) return "medium";
  return "low";
}

async function executeRows<TRow>(database: Database, query: ReturnType<typeof sql>) {
  const result = await database.execute(query);
  return result.rows as TRow[];
}

function round(value: number, precision: number) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

async function main() {
  const options = parseFootballPlayerContextBuildArgs(process.argv.slice(2));
  const result = await runFootballPlayerContextBuild(options);
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
