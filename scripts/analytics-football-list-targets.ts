import "dotenv/config";
import { pathToFileURL } from "node:url";
import { sql } from "drizzle-orm";
import { createDatabase } from "@sports-data/database";
import type { Database } from "@sports-data/database";
import { checkDatabaseReadiness, formatDatabaseReadinessResult } from "./db-readiness.js";

const defaultLimit = 20;
const maxLimit = 100;

export interface FootballTargetListOptions {
  competitionId?: string;
  limit: number;
  json: boolean;
}

export interface FootballTargetListEnvironment {
  NODE_ENV?: string;
  DATABASE_URL?: string;
  DB_EXECUTION_TARGET?: string;
  ALLOW_REMOTE_TEST_DB?: string | boolean;
  NEON_BRANCH_NAME?: string;
}

export interface FootballCompetitionTargetSummary {
  id: string;
  name: string;
  country: string | null;
  teams_count: number;
  matches_count: number;
}

export interface FootballTeamTargetSummary {
  id: string;
  name: string;
  logo_url: string | null;
  matches_count: number;
}

export interface FootballMatchTargetSummary {
  id: string;
  scheduled_start_at: string;
  status: string;
  home_team: string;
  away_team: string;
}

export interface FootballTargetListResult {
  competitions: FootballCompetitionTargetSummary[];
  teams?: FootballTeamTargetSummary[];
  matches?: FootballMatchTargetSummary[];
  warnings: string[];
}

export interface FootballTargetListDependencies {
  listTargets(options: FootballTargetListOptions): Promise<FootballTargetListResult>;
  log?(message: string): void;
}

export function parseFootballTargetListArgs(argv: string[]): FootballTargetListOptions {
  const options: FootballTargetListOptions = {
    limit: defaultLimit,
    json: false
  };

  for (const arg of argv) {
    if (arg === "--json") {
      options.json = true;
      continue;
    }

    const [key, value] = parseFlag(arg);
    switch (key) {
      case "--competition-id":
        options.competitionId = requiredFlagValue(key, value);
        break;
      case "--limit":
        options.limit = parseLimit(value);
        break;
      default:
        throw new Error(`Unknown football target listing flag "${key}".`);
    }
  }

  return options;
}

export function validateFootballTargetListOptions(options: FootballTargetListOptions, env: FootballTargetListEnvironment) {
  if (env.NODE_ENV === "production") {
    throw new Error("Football analytics target listing is forbidden in production.");
  }

  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for football analytics target listing.");
  }

  if (options.limit < 1 || options.limit > maxLimit) {
    throw new Error(`--limit must be between 1 and ${maxLimit}.`);
  }
}

export async function runFootballTargetListing(
  options: FootballTargetListOptions,
  dependencies: FootballTargetListDependencies
): Promise<FootballTargetListResult> {
  const result = await dependencies.listTargets(options);
  dependencies.log?.(options.json ? JSON.stringify(result, null, 2) : formatTextResult(result));
  return result;
}

function createFootballTargetListDependencies(database: Database): FootballTargetListDependencies {
  return {
    listTargets: (options) => queryFootballTargets(database, options),
    log: (message) => console.log(message)
  };
}

async function queryFootballTargets(database: Database, options: FootballTargetListOptions): Promise<FootballTargetListResult> {
  const competitions = await queryCompetitions(database, options);
  const warnings = ["Read-only football analytics target listing. No provider calls, ingestion, analytics writes, or scheduler work were run."];

  if (!options.competitionId) {
    return { competitions, warnings };
  }

  if (competitions.length === 0) {
    warnings.push(`No football competition found for competition_id=${options.competitionId}.`);
  }

  const [teams, matches] = await Promise.all([queryTeams(database, options), queryMatches(database, options)]);
  return { competitions, teams, matches, warnings };
}

async function queryCompetitions(database: Database, options: FootballTargetListOptions): Promise<FootballCompetitionTargetSummary[]> {
  const competitionFilter = options.competitionId ? sql`and c.id = ${options.competitionId}` : sql``;
  const rows = await executeRows<{
    id: string;
    name: string;
    country: string | null;
    teams_count: string | number | bigint | null;
    matches_count: string | number | bigint | null;
  }>(
    database,
    sql`
      select
        c.id,
        c.name,
        co.name as country,
        count(distinct team_ids.team_id) as teams_count,
        count(distinct m.id) as matches_count
      from competitions c
      inner join sports s on s.id = c.sport_id and s.slug = 'football'
      left join countries co on co.id = c.country_id
      left join matches m on m.competition_id = c.id
      left join lateral (
        select m.home_team_id as team_id
        union
        select m.away_team_id as team_id
      ) team_ids on true
      where true ${competitionFilter}
      group by c.id, c.name, co.name
      order by c.name asc
      limit ${options.limit}
    `
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    country: row.country,
    teams_count: normalizeCount(row.teams_count),
    matches_count: normalizeCount(row.matches_count)
  }));
}

async function queryTeams(database: Database, options: FootballTargetListOptions): Promise<FootballTeamTargetSummary[]> {
  const rows = await executeRows<{
    id: string;
    name: string;
    logo_url: string | null;
    matches_count: string | number | bigint | null;
  }>(
    database,
    sql`
      select
        t.id,
        t.name,
        t.logo_url,
        count(distinct m.id) as matches_count
      from teams t
      inner join sports s on s.id = t.sport_id and s.slug = 'football'
      inner join matches m on m.competition_id = ${options.competitionId}
        and (m.home_team_id = t.id or m.away_team_id = t.id)
      group by t.id, t.name, t.logo_url
      order by t.name asc
      limit ${options.limit}
    `
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    logo_url: row.logo_url,
    matches_count: normalizeCount(row.matches_count)
  }));
}

async function queryMatches(database: Database, options: FootballTargetListOptions): Promise<FootballMatchTargetSummary[]> {
  const rows = await executeRows<{
    id: string;
    scheduled_start_at: Date | string;
    status: string;
    home_team: string;
    away_team: string;
  }>(
    database,
    sql`
      select
        m.id,
        m.scheduled_start_at,
        m.status,
        home.name as home_team,
        away.name as away_team
      from matches m
      inner join sports s on s.id = m.sport_id and s.slug = 'football'
      inner join teams home on home.id = m.home_team_id
      inner join teams away on away.id = m.away_team_id
      where m.competition_id = ${options.competitionId}
      order by m.scheduled_start_at desc
      limit ${options.limit}
    `
  );

  return rows.map((row) => ({
    id: row.id,
    scheduled_start_at: row.scheduled_start_at instanceof Date ? row.scheduled_start_at.toISOString() : new Date(row.scheduled_start_at).toISOString(),
    status: row.status,
    home_team: row.home_team,
    away_team: row.away_team
  }));
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

function formatTextResult(result: FootballTargetListResult): string {
  const lines = ["Football analytics targets", ""];
  lines.push("Competitions:");
  if (result.competitions.length === 0) {
    lines.push("- none");
  } else {
    for (const competition of result.competitions) {
      lines.push(`- ${competition.name} (${competition.id}) country=${competition.country ?? "unknown"} teams=${competition.teams_count} matches=${competition.matches_count}`);
    }
  }

  if (result.teams) {
    lines.push("", "Teams:");
    if (result.teams.length === 0) {
      lines.push("- none");
    } else {
      for (const team of result.teams) {
        lines.push(`- ${team.name} (${team.id}) matches=${team.matches_count} logo=${team.logo_url ? "yes" : "no"}`);
      }
    }
  }

  if (result.matches) {
    lines.push("", "Matches:");
    if (result.matches.length === 0) {
      lines.push("- none");
    } else {
      for (const match of result.matches) {
        lines.push(`- ${match.scheduled_start_at} ${match.status}: ${match.home_team} vs ${match.away_team} (${match.id})`);
      }
    }
  }

  if (result.warnings.length > 0) {
    lines.push("", "Warnings:");
    for (const warning of result.warnings) {
      lines.push(`- ${warning}`);
    }
  }

  return lines.join("\n");
}

function parseFlag(arg: string): [string, string | undefined] {
  const index = arg.indexOf("=");
  return index === -1 ? [arg, undefined] : [arg.slice(0, index), arg.slice(index + 1)];
}

function requiredFlagValue(flag: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Flag ${flag} requires a value.`);
  }
  return value;
}

function parseLimit(value: string | undefined): number {
  const limit = Number(requiredFlagValue("--limit", value));
  if (!Number.isInteger(limit) || limit < 1 || limit > maxLimit) {
    throw new Error(`--limit must be between 1 and ${maxLimit}.`);
  }
  return limit;
}

function normalizeCount(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") return Number(value);
  return 0;
}

async function main() {
  const options = parseFootballTargetListArgs(process.argv.slice(2));
  validateFootballTargetListOptions(options, process.env);

  const readiness = await checkDatabaseReadiness({
    databaseUrl: process.env.DATABASE_URL,
    nodeEnv: process.env.NODE_ENV,
    dbExecutionTarget: process.env.DB_EXECUTION_TARGET,
    allowRemoteTestDb: process.env.ALLOW_REMOTE_TEST_DB,
    neonBranchName: process.env.NEON_BRANCH_NAME
  });
  if (readiness.status !== "ready") {
    throw new Error(`Database readiness check failed before football target listing.\n${formatDatabaseReadinessResult(readiness)}`);
  }

  const database = createDatabase(process.env.DATABASE_URL!);
  await runFootballTargetListing(options, createFootballTargetListDependencies(database));
}

const isDirectRun = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Football target listing failed.");
    process.exitCode = 1;
  });
}
