import { open } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import pg from "pg";

type JsonRecord = Record<string, unknown>;
interface DatabaseClient { query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>; }

export interface MatchStatisticsOptions { execute: boolean; capturePath: string; }

interface CapturedSide {
  possessionPercent?: number;
  shotsTotal?: number;
  shotsOnTarget?: number;
  shotsOffTarget?: number;
  blockedShots?: number;
  corners?: number;
  fouls?: number;
  yellowCards?: number;
  redCards?: number;
  offsides?: number;
  goalkeeperSaves?: number;
  passes?: number;
  accuratePasses?: number;
  passAccuracyPercent?: number;
  bigChances?: number;
  bigChancesMissed?: number;
  expectedGoals?: number;
  expectedAssists?: number;
  attacks?: number;
  dangerousAttacks?: number;
  hitWoodwork?: number;
  tackles?: number;
  interceptions?: number;
  clearances?: number;
  duelsWon?: number;
  aerialDuelsWon?: number;
}

interface CaptureMatch {
  eventId: number;
  homeTeamId: number;
  awayTeamId: number;
  statistics: { home: CapturedSide; away: CapturedSide };
}

interface Capture {
  source: string;
  capturedAt: string;
  matches: CaptureMatch[];
}

interface MatchRow {
  id: string;
  home_team_id: string;
  away_team_id: string;
}

interface MappingRow {
  internal_entity_id: string;
  provider_entity_id: string;
}

const statisticColumns = [
  "possession_percent",
  "shots_total",
  "shots_on_target",
  "shots_off_target",
  "blocked_shots",
  "corners",
  "fouls",
  "yellow_cards",
  "red_cards",
  "offsides",
  "goalkeeper_saves",
  "passes",
  "accurate_passes",
  "pass_accuracy_percent",
  "big_chances",
  "big_chances_missed",
  "expected_goals",
  "expected_assists",
  "attacks",
  "dangerous_attacks",
  "hit_woodwork",
  "tackles",
  "interceptions",
  "clearances",
  "duels_won",
  "aerial_duels_won"
] as const;

const statisticKeys: Record<(typeof statisticColumns)[number], keyof CapturedSide> = {
  possession_percent: "possessionPercent",
  shots_total: "shotsTotal",
  shots_on_target: "shotsOnTarget",
  shots_off_target: "shotsOffTarget",
  blocked_shots: "blockedShots",
  corners: "corners",
  fouls: "fouls",
  yellow_cards: "yellowCards",
  red_cards: "redCards",
  offsides: "offsides",
  goalkeeper_saves: "goalkeeperSaves",
  passes: "passes",
  accurate_passes: "accuratePasses",
  pass_accuracy_percent: "passAccuracyPercent",
  big_chances: "bigChances",
  big_chances_missed: "bigChancesMissed",
  expected_goals: "expectedGoals",
  expected_assists: "expectedAssists",
  attacks: "attacks",
  dangerous_attacks: "dangerousAttacks",
  hit_woodwork: "hitWoodwork",
  tackles: "tackles",
  interceptions: "interceptions",
  clearances: "clearances",
  duels_won: "duelsWon",
  aerial_duels_won: "aerialDuelsWon"
};

const upsertSql = `INSERT INTO football_match_team_statistics (
    match_id, team_id, opponent_team_id, is_home,
    ${statisticColumns.join(", ")},
    metadata_json, updated_at
  )
  VALUES ($1::uuid, $2::uuid, $3::uuid, $4, ${statisticColumns.map((_, index) => `$${index + 5}`).join(", ")}, $${statisticColumns.length + 5}::jsonb, now())
  ON CONFLICT (match_id, team_id) DO UPDATE SET
    opponent_team_id = EXCLUDED.opponent_team_id,
    is_home = EXCLUDED.is_home,
    ${statisticColumns.map((column) => `${column} = EXCLUDED.${column}`).join(",\n    ")},
    metadata_json = COALESCE(football_match_team_statistics.metadata_json, '{}'::jsonb) || EXCLUDED.metadata_json,
    updated_at = now()`;

const matchSql = `SELECT m.id, m.home_team_id, m.away_team_id
  FROM matches m
  INNER JOIN provider_mappings pm
    ON pm.provider = 'sofascore'
   AND pm.entity_type = 'match'
   AND pm.internal_entity_id = m.id
  WHERE pm.provider_entity_id = $1
  LIMIT 1`;

const teamMappingSql = `SELECT internal_entity_id, provider_entity_id
  FROM provider_mappings
  WHERE provider = 'sofascore'
    AND entity_type = 'team'
    AND internal_entity_id IN ($1::uuid, $2::uuid)`;

export function parseMatchStatisticsArgs(args: string[]): MatchStatisticsOptions {
  const options: Partial<MatchStatisticsOptions> = { execute: false };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--execute") options.execute = true;
    else if (arg === "--no-log-run") { /* accepted for sync-service child runs */ }
    else if (arg === "--capture" || arg.startsWith("--capture=")) {
      const value = arg === "--capture" ? args[++index] : arg.slice("--capture=".length);
      if (!value || value.startsWith("--")) throw new Error("--capture requires a file path.");
      options.capturePath = value;
    } else throw new Error(`Unknown match statistics flag "${arg}".`);
  }
  if (!options.capturePath) throw new Error("--capture is required.");
  return options as MatchStatisticsOptions;
}

export async function runMatchStatisticsSync(options: MatchStatisticsOptions, dependencies: { env?: NodeJS.ProcessEnv; database?: DatabaseClient } = {}) {
  const env = dependencies.env ?? process.env;
  if (options.execute && !env.DATABASE_URL) throw new Error("Executing match statistics requires DATABASE_URL.");
  if (env.DATABASE_URL) validateDatabaseUrl(env.DATABASE_URL);
  const capture = await readCapture(options.capturePath);
  const pool = env.DATABASE_URL && !dependencies.database
    ? new pg.Pool({ connectionString: env.DATABASE_URL, max: 1, connectionTimeoutMillis: 5_000, query_timeout: 10_000, statement_timeout: 10_000 })
    : undefined;
  pool?.on("error", () => {});
  const database = env.DATABASE_URL ? dependencies.database ?? pool : undefined;
  const entries: Array<{ eventId: number; status: string; matchId?: string }> = [];
  let written = 0;
  try {
    for (const match of capture.matches) {
      const entry: { eventId: number; status: string; matchId?: string } = { eventId: match.eventId, status: "planned" };
      entries.push(entry);
      if (!database) continue;
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
      let homeSide = match.statistics.home;
      let awaySide = match.statistics.away;
      if ((!homeTeamId || !awayTeamId) && swappedHome && swappedAway) {
        homeTeamId = swappedHome;
        awayTeamId = swappedAway;
        homeSide = match.statistics.away;
        awaySide = match.statistics.home;
      }
      if (!homeTeamId || !awayTeamId) { entry.status = "team_mismatch"; continue; }
      if (!options.execute) { entry.status = "planned"; continue; }
      const metadata = JSON.stringify({
        source: "sofascore",
        capturedAt: capture.capturedAt,
        period: "ALL",
        providerEventId: match.eventId,
        providerHomeTeamId: match.homeTeamId,
        providerAwayTeamId: match.awayTeamId
      });
      await upsertTeam(database, matchRow.id, homeTeamId, awayTeamId, true, homeSide, metadata);
      await upsertTeam(database, matchRow.id, awayTeamId, homeTeamId, false, awaySide, metadata);
      entry.status = "updated";
      written += 1;
    }
  } finally {
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
    writtenMatches: written,
    entries,
    counts
  };
}

async function upsertTeam(database: DatabaseClient, matchId: string, teamId: string, opponentTeamId: string, isHome: boolean, side: CapturedSide, metadata: string) {
  const params: unknown[] = [matchId, teamId, opponentTeamId, isHome];
  for (const column of statisticColumns) {
    const value = side[statisticKeys[column]];
    params.push(value === undefined || value === null ? null : value);
  }
  params.push(metadata);
  await database.query(upsertSql, params);
}

async function readCapture(capturePath: string): Promise<Capture> {
  const file = await open(capturePath, "r");
  try {
    const document = JSON.parse(await file.readFile("utf8")) as Capture;
    if (!document || document.source !== "sofascore-match-statistics" || !Array.isArray(document.matches)) {
      throw new Error("Match statistics capture has an unsupported shape.");
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
    throw new Error("Match statistics refresh refuses connection target overrides.");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runMatchStatisticsSync(parseMatchStatisticsArgs(process.argv.slice(2)))
    .then((report) => console.log(JSON.stringify(report, null, 2)))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "DATABASE_URL=<redacted>") : "Match statistics refresh failed.");
      process.exitCode = 1;
    });
}
