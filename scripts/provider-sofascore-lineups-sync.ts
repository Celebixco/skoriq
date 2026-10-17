import { open } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import pg from "pg";

type JsonRecord = Record<string, unknown>;
interface DatabaseClient { query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>; }

export interface LineupsSyncOptions { execute: boolean; capturePath: string; }

interface CapturedPlayer {
  playerId: number;
  name: string;
  position?: string | null;
  shirtNumber?: number | null;
  substitute: boolean;
  orderIndex: number;
  rating?: number | null;
}

interface CapturedSide { formation?: string | null; players: CapturedPlayer[]; }

interface CaptureMatch {
  eventId: number;
  homeTeamId: number;
  awayTeamId: number;
  lineups: { confirmed: boolean; home: CapturedSide; away: CapturedSide };
}

interface Capture { source: string; capturedAt: string; matches: CaptureMatch[]; }
interface MatchRow { id: string; home_team_id: string; away_team_id: string; }
interface MappingRow { internal_entity_id: string; provider_entity_id: string; }

const matchSql = `SELECT m.id, m.home_team_id, m.away_team_id
  FROM matches m
  INNER JOIN sports s ON s.id = m.sport_id AND s.slug = 'football'
  WHERE m.metadata_json->>'sofascoreId' = $1
  LIMIT 1`;

const teamMappingSql = `SELECT internal_entity_id, provider_entity_id
  FROM provider_mappings
  WHERE provider = 'sofascore' AND entity_type = 'team'
    AND internal_entity_id IN ($1::uuid, $2::uuid)`;

const sportSql = `SELECT id::text AS id FROM sports WHERE slug = 'football' LIMIT 1`;

const playerResolutionSql = `SELECT p.id::text AS id
  FROM provider_mappings pm
  INNER JOIN players p ON p.id = pm.internal_entity_id
  WHERE pm.provider = 'sofascore' AND pm.entity_type = 'player' AND pm.provider_entity_id = $1
  UNION ALL
  SELECT id::text AS id FROM players WHERE metadata_json->>'sofascoreId' = $1
  LIMIT 1`;

const insertPlayerSql = `INSERT INTO players (sport_id, current_team_id, name, position, jersey_number, metadata_json)
  VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::jsonb)
  RETURNING id::text AS id`;

const insertPlayerMappingSql = `INSERT INTO provider_mappings
    (provider, entity_type, provider_entity_id, internal_entity_id, internal_entity_type, metadata_json, updated_at)
  VALUES ('sofascore', 'player', $1, $2::uuid, 'player', '{}'::jsonb, now())
  ON CONFLICT (provider, entity_type, provider_entity_id) DO NOTHING`;

const upsertLineupSql = `INSERT INTO football_match_lineups
    (match_id, team_id, formation, confirmed, provider_reported_at, metadata_json, updated_at)
  VALUES ($1::uuid, $2::uuid, $3, $4, $5::timestamptz, $6::jsonb, now())
  ON CONFLICT (match_id, team_id) DO UPDATE SET
    formation = EXCLUDED.formation,
    confirmed = EXCLUDED.confirmed,
    provider_reported_at = EXCLUDED.provider_reported_at,
    metadata_json = COALESCE(football_match_lineups.metadata_json, '{}'::jsonb) || EXCLUDED.metadata_json,
    updated_at = now()
  RETURNING id::text AS id`;

const deleteLineupPlayersSql = `DELETE FROM football_match_lineup_players WHERE match_lineup_id = $1::uuid`;

const insertLineupPlayerSql = `INSERT INTO football_match_lineup_players
    (match_lineup_id, match_id, team_id, player_id, role, position, shirt_number, order_index, metadata_json)
  VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, $8, $9::jsonb)`;

export function parseLineupsArgs(args: string[]): LineupsSyncOptions {
  const options: Partial<LineupsSyncOptions> = { execute: false };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--execute") options.execute = true;
    else if (arg === "--no-log-run") { /* accepted for sync-service child runs */ }
    else if (arg === "--capture" || arg.startsWith("--capture=")) {
      const value = arg === "--capture" ? args[++index] : arg.slice("--capture=".length);
      if (!value || value.startsWith("--")) throw new Error("--capture requires a file path.");
      options.capturePath = value;
    } else throw new Error(`Unknown lineups flag "${arg}".`);
  }
  if (!options.capturePath) throw new Error("--capture is required.");
  return options as LineupsSyncOptions;
}

export async function runLineupsSync(options: LineupsSyncOptions, dependencies: { env?: NodeJS.ProcessEnv; database?: DatabaseClient } = {}) {
  const env = dependencies.env ?? process.env;
  if (options.execute && !env.DATABASE_URL) throw new Error("Executing lineups requires DATABASE_URL.");
  if (env.DATABASE_URL) validateDatabaseUrl(env.DATABASE_URL);
  const capture = await readCapture(options.capturePath);
  const pool = env.DATABASE_URL && !dependencies.database
    ? new pg.Pool({ connectionString: env.DATABASE_URL, max: 1, connectionTimeoutMillis: 5_000, query_timeout: 15_000, statement_timeout: 15_000 })
    : undefined;
  pool?.on("error", () => {});
  const client = pool ? await pool.connect() : undefined;
  const database = env.DATABASE_URL ? dependencies.database ?? (client as unknown as DatabaseClient) : undefined;
  const entries: Array<{ eventId: number; status: string; matchId?: string }> = [];
  let writtenMatches = 0;
  let playersInserted = 0;
  try {
    const sport = database ? (await database.query(sportSql)).rows[0] as { id: string } | undefined : undefined;
    for (const match of capture.matches) {
      const entry: { eventId: number; status: string; matchId?: string } = { eventId: match.eventId, status: "planned" };
      entries.push(entry);
      if (!database) continue;
      if (!sport) { entry.status = "missing_sport"; continue; }
      const matchRow = (await database.query(matchSql, [String(match.eventId)])).rows[0] as MatchRow | undefined;
      if (!matchRow) { entry.status = "unknown_match"; continue; }
      entry.matchId = matchRow.id;
      const mappingRows = (await database.query(teamMappingSql, [matchRow.home_team_id, matchRow.away_team_id])).rows as MappingRow[];
      const providerByTeam = new Map(mappingRows.map((row) => [row.internal_entity_id, row.provider_entity_id]));
      const homeCanonical = providerByTeam.get(matchRow.home_team_id) === String(match.homeTeamId) ? matchRow.home_team_id : undefined;
      const awayCanonical = providerByTeam.get(matchRow.away_team_id) === String(match.awayTeamId) ? matchRow.away_team_id : undefined;
      const swappedHome = providerByTeam.get(matchRow.home_team_id) === String(match.awayTeamId) ? matchRow.home_team_id : undefined;
      const swappedAway = providerByTeam.get(matchRow.away_team_id) === String(match.homeTeamId) ? matchRow.away_team_id : undefined;
      let homeTeamId = homeCanonical;
      let awayTeamId = awayCanonical;
      let homeSide = match.lineups.home;
      let awaySide = match.lineups.away;
      if ((!homeTeamId || !awayTeamId) && swappedHome && swappedAway) {
        homeTeamId = swappedHome;
        awayTeamId = swappedAway;
        homeSide = match.lineups.away;
        awaySide = match.lineups.home;
      }
      if (!homeTeamId || !awayTeamId) { entry.status = "team_mismatch"; continue; }
      if (!options.execute) { entry.status = "planned"; continue; }
      try {
        await database.query("BEGIN");
        playersInserted += await writeSide(database, sport.id, matchRow.id, homeTeamId, homeSide, match, capture.capturedAt, true, match.homeTeamId);
        playersInserted += await writeSide(database, sport.id, matchRow.id, awayTeamId, awaySide, match, capture.capturedAt, false, match.awayTeamId);
        await database.query("COMMIT");
        entry.status = "updated";
        writtenMatches += 1;
      } catch {
        await database.query("ROLLBACK");
        entry.status = "invalid";
      }
    }
  } finally {
    client?.release();
    await pool?.end();
  }
  const counts = entries.reduce<Record<string, number>>((accumulator, entry) => {
    accumulator[entry.status] = (accumulator[entry.status] ?? 0) + 1;
    return accumulator;
  }, {});
  return {
    mode: options.execute ? "execute" : "dry_run",
    source: capture.source,
    capturedAt: capture.capturedAt,
    capturePath: options.capturePath,
    matches: capture.matches.length,
    writtenMatches,
    playersInserted,
    entries,
    counts
  };
}

async function writeSide(database: DatabaseClient, sportId: string, matchId: string, teamId: string,
                          side: CapturedSide, match: CaptureMatch, capturedAt: string, isHome: boolean, providerTeamId: number): Promise<number> {
  const lineup = (await database.query(upsertLineupSql, [
    matchId,
    teamId,
    side.formation ?? null,
    match.lineups.confirmed,
    match.lineups.confirmed ? capturedAt : null,
    JSON.stringify({
      source: "sofascore",
      capturedAt,
      providerEventId: match.eventId,
      providerTeamId,
      isHome
    })
  ])).rows[0] as { id: string } | undefined;
  if (!lineup) throw new Error("Lineup upsert returned no id.");
  await database.query(deleteLineupPlayersSql, [lineup.id]);
  let inserted = 0;
  for (const player of side.players) {
    let playerId = (await database.query(playerResolutionSql, [String(player.playerId)])).rows[0] as { id: string } | undefined;
    if (!playerId) {
      const created = (await database.query(insertPlayerSql, [
        sportId,
        teamId,
        player.name,
        player.position ?? null,
        player.shirtNumber ?? null,
        JSON.stringify({ source: "sofascore", sofascoreId: player.playerId })
      ])).rows[0] as { id: string } | undefined;
      playerId = created;
      if (!playerId) throw new Error("Player insert returned no id.");
      await database.query(insertPlayerMappingSql, [String(player.playerId), playerId.id]);
      inserted += 1;
    }
    await database.query(insertLineupPlayerSql, [
      lineup.id,
      matchId,
      teamId,
      playerId.id,
      player.substitute ? "substitute" : "starting",
      player.position ?? null,
      player.shirtNumber ?? null,
      player.orderIndex,
      JSON.stringify({ source: "sofascore", rating: player.rating ?? null })
    ]);
  }
  return inserted;
}

async function readCapture(capturePath: string): Promise<Capture> {
  const file = await open(capturePath, "r");
  try {
    const document = JSON.parse(await file.readFile("utf8")) as Capture;
    if (!document || document.source !== "sofascore-lineups" || !Array.isArray(document.matches)) {
      throw new Error("Lineups capture has an unsupported shape.");
    }
    return document;
  } finally {
    await file.close();
  }
}

function validateDatabaseUrl(databaseUrl: string) {
  const parsed = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) throw new Error("DATABASE_URL must be a PostgreSQL URL.");
  if (["host", "hostaddr", "service", "servicefile"].some((key) => parsed.searchParams.has(key))) {
    throw new Error("Lineups refresh refuses connection target overrides.");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runLineupsSync(parseLineupsArgs(process.argv.slice(2)))
    .then((report) => console.log(JSON.stringify(report, null, 2)))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "DATABASE_URL=<redacted>") : "Lineups refresh failed.");
      process.exitCode = 1;
    });
}
