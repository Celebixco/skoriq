import { appendFile, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import pg from "pg";

type JsonRecord = Record<string, unknown>;

interface DatabaseClient {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

export interface SofaScoreStandingsOptions {
  execute: boolean;
  capturePath: string;
  logRun: boolean;
}

export interface SofaScoreStandingsDependencies {
  env?: NodeJS.ProcessEnv;
  readCapture?: (capturePath: string) => Promise<unknown>;
  database?: DatabaseClient;
  now?: () => Date;
  rowTimeoutMs?: number;
}

export interface SofaScoreStandingsReport {
  mode: "dry_run" | "execute";
  capturePath: string;
  databaseConfigured: boolean;
  queriesExecuted: number;
  entries: StandingEntry[];
  counts: Record<string, number>;
  syncJobLogged: boolean;
  loggingError?: string;
}

interface StandingEntry {
  providerTeamId: string;
  tournamentId: string;
  action: string;
  reason?: string;
}

interface CapturedStandingRow {
  tournamentId: string;
  position: number;
  teamId: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
  form: string | null;
}

type Resolution = { status: "ok"; id: string } | { status: "missing" | "conflict" };

const MAX_TABLE_ROWS = 40;
const ROW_SELECT = `SELECT s.id::text AS id, s.position, s.played, s.wins, s.draws, s.losses, s.goals_for, s.goals_against, s.points
  FROM football_standings s
  WHERE s.competition_id = $1::uuid AND s.season_id = $2::uuid AND s.team_id = $3::uuid
  LIMIT 2`;

export function parseSofaScoreStandingsArgs(args: string[]): SofaScoreStandingsOptions {
  const options: SofaScoreStandingsOptions = { execute: false, capturePath: "", logRun: true };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--execute") options.execute = true;
    else if (arg === "--no-log-run") options.logRun = false;
    else if (arg === "--capture" || arg.startsWith("--capture=")) {
      const value = arg === "--capture" ? args[++index] : arg.slice("--capture=".length);
      if (!value || value.startsWith("--")) throw new Error("--capture requires a file path.");
      options.capturePath = value;
    } else throw new Error(`Unknown SofaScore standings flag "${arg}".`);
  }
  if (!options.capturePath) throw new Error("A validated capture file is required; pass --capture <path>.");
  return options;
}

export async function runSofaScoreStandingsSync(
  options: SofaScoreStandingsOptions,
  dependencies: SofaScoreStandingsDependencies = {}
): Promise<SofaScoreStandingsReport> {
  const env = dependencies.env ?? process.env;
  const now = dependencies.now ?? (() => new Date());
  if (options.execute && !env.DATABASE_URL) {
    throw new Error("Executing the standings refresh requires DATABASE_URL.");
  }
  if (env.DATABASE_URL) {
    validateDatabaseUrl(env.DATABASE_URL);
  }

  const startedAt = now();
  const beacon = createBeacon(options.capturePath);
  await beacon("pool_setup");
  const pool = env.DATABASE_URL && !dependencies.database
    ? new pg.Pool({
        connectionString: env.DATABASE_URL,
        max: 2,
        connectionTimeoutMillis: 5_000,
        query_timeout: 10_000,
        statement_timeout: 10_000,
        idle_in_transaction_session_timeout: 10_000,
        keepAlive: true
      })
    : undefined;
  pool?.on("error", () => {});
  const database = env.DATABASE_URL ? dependencies.database ?? pool : undefined;
  await beacon("database_configured");
  const capture = await (dependencies.readCapture ?? readCaptureFile)(options.capturePath);
  const rows = validateCapture(capture);
  await beacon(`capture_validated rows=${rows.length}`);

  let syncJobId: string | undefined;
  let loggingError: string | undefined;
  if (database && options.logRun) {
    try {
      syncJobId = await beginSyncRun(database, startedAt);
      await beacon("begin_logged");
    } catch (error) {
      loggingError = error instanceof Error ? error.message : "sync run logging failed";
    }
  }

  const entries: StandingEntry[] = [];
  const competitionCache = new Map<string, Resolution>();
  const seasonCache = new Map<string, Resolution>();
  const teamCache = new Map<string, Resolution>();
  const startedQueries = { count: 0 };
  const rowTimeoutMs = dependencies.rowTimeoutMs ?? 30_000;
  try {
    for (const row of rows) {
      try {
        entries.push(await withTimeout(importRow(row, options, database, { competitionCache, seasonCache, teamCache, startedQueries }), rowTimeoutMs));
      } catch {
        entries.push({ providerTeamId: row.teamId, tournamentId: row.tournamentId, action: "query_failed", reason: "query_failed" });
      }
    }
  } finally {
    await pool?.end();
  }
  await beacon("loop_done");

  const counts = entries.reduce<Record<string, number>>((accumulator, entry) => {
    accumulator[entry.action] = (accumulator[entry.action] ?? 0) + 1;
    return accumulator;
  }, {});
  const report: SofaScoreStandingsReport = {
    mode: options.execute ? "execute" : "dry_run",
    capturePath: options.capturePath,
    databaseConfigured: Boolean(database),
    queriesExecuted: startedQueries.count,
    entries,
    counts,
    syncJobLogged: false
  };
  if (database && options.logRun && syncJobId) {
    try {
      await finishSyncRun(database, syncJobId, report, startedAt, now());
      report.syncJobLogged = true;
    } catch (error) {
      report.loggingError = error instanceof Error ? error.message : "sync run logging failed";
    }
  } else if (loggingError) {
    report.loggingError = loggingError;
  }
  return report;
}

async function importRow(
  row: CapturedStandingRow,
  options: SofaScoreStandingsOptions,
  database: DatabaseClient | undefined,
  context: { competitionCache: Map<string, Resolution>; seasonCache: Map<string, Resolution>; teamCache: Map<string, Resolution>; startedQueries: { count: number } }
): Promise<StandingEntry> {
  const base: StandingEntry = { providerTeamId: row.teamId, tournamentId: row.tournamentId, action: "capture_validated" };
  if (!database) {
    return base;
  }
  const competition = await resolveCompetitionId(database, context, row.tournamentId);
  if (competition.status !== "ok") {
    return { ...base, action: "skipped", reason: competition.status === "missing" ? "unknown_competition" : "identity_conflict" };
  }
  const season = await resolveSeasonId(database, context, competition.id);
  if (season.status !== "ok") {
    return { ...base, action: "skipped", reason: "unknown_season" };
  }
  const team = await resolveTeamId(database, context, row.teamId);
  if (team.status !== "ok") {
    return { ...base, action: "skipped", reason: team.reason };
  }

  context.startedQueries.count++;
  const existingRows = (await database.query(ROW_SELECT, [competition.id, season.id, team.id])).rows.map(record);
  if (existingRows.length > 1) {
    return { ...base, action: "skipped", reason: "identity_conflict" };
  }
  const values = [competition.id, season.id, team.id, row.position, row.played, row.wins, row.draws, row.losses,
                  row.goalsFor, row.goalsAgainst, row.goalsFor - row.goalsAgainst, row.points, JSON.stringify({ sofascore: true, form: row.form })];

  if (existingRows.length === 0) {
    if (!options.execute) {
      return { ...base, action: "planned_insert" };
    }
    const inserted = await database.query(insertStandingSql, values);
    return inserted.rows.length === 1 ? { ...base, action: "inserted" } : { ...base, action: "skipped", reason: "insert_conflict" };
  }
  const existing = existingRows[0];
  const unchanged = Number(existing.position) === row.position
    && Number(existing.played) === row.played
    && Number(existing.wins) === row.wins
    && Number(existing.draws) === row.draws
    && Number(existing.losses) === row.losses
    && Number(existing.points) === row.points;
  if (unchanged) {
    return { ...base, action: "unchanged" };
  }
  if (!options.execute) {
    return { ...base, action: "planned_update" };
  }
  const updated = await database.query(upsertStandingSql, values);
  if (updated.rows.length !== 1) {
    return { ...base, action: "unchanged" };
  }
  return { ...base, action: "updated" };
}

async function resolveCompetitionId(database: DatabaseClient, context: { competitionCache: Map<string, Resolution>; startedQueries: { count: number } }, tournamentId: string): Promise<Resolution> {
  const cached = context.competitionCache.get(tournamentId);
  if (cached) return cached;
  context.startedQueries.count++;
  const result = resolveSingle((await database.query(resolveCompetitionSql, [tournamentId])).rows, "id");
  context.competitionCache.set(tournamentId, result);
  return result;
}

async function resolveSeasonId(database: DatabaseClient, context: { seasonCache: Map<string, Resolution>; startedQueries: { count: number } }, competitionId: string): Promise<Resolution> {
  const cached = context.seasonCache.get(competitionId);
  if (cached) return cached;
  context.startedQueries.count++;
  const result = resolveSingle((await database.query(resolveSeasonSql, [competitionId])).rows, "id");
  context.seasonCache.set(competitionId, result);
  return result;
}

async function resolveTeamId(database: DatabaseClient, context: { teamCache: Map<string, Resolution>; startedQueries: { count: number } }, providerTeamId: string): Promise<{ status: "ok"; id: string } | { status: "skipped"; reason: string }> {
  const cached = context.teamCache.get(providerTeamId);
  if (cached) {
    return cached.status === "ok" ? cached : { status: "skipped", reason: cached.status === "missing" ? "unknown_team" : "identity_conflict" };
  }
  context.startedQueries.count++;
  const resolved = resolveTeam((await database.query(resolveTeamSql, [providerTeamId])).rows);
  context.teamCache.set(providerTeamId, resolved.status === "ok" ? resolved : { status: resolved.reason === "unknown_team" ? "missing" : "conflict" });
  return resolved;
}

async function beginSyncRun(database: DatabaseClient, startedAt: Date): Promise<string | undefined> {
  const result = await database.query(beginSyncJobSql, ["standings-sync", "sofascore.standings", startedAt.toISOString()]);
  return result.rows.length === 1 ? String(record(result.rows[0]).id) : undefined;
}

async function finishSyncRun(database: DatabaseClient, jobId: string, report: SofaScoreStandingsReport, startedAt: Date, finishedAt: Date): Promise<void> {
  const failed = (report.counts.query_failed ?? 0) > 0;
  await database.query(finishSyncJobSql, [
    jobId,
    failed ? "failed" : "succeeded",
    failed ? "one or more refresh queries failed" : null,
    finishedAt.toISOString(),
    Math.max(0, finishedAt.getTime() - startedAt.getTime())
  ]);
  await database.query(insertSyncLogSql, [
    jobId,
    failed ? "error" : "info",
    `${report.mode} run: ${report.entries.length} standings rows`,
    JSON.stringify({ mode: report.mode, counts: report.counts, queriesExecuted: report.queriesExecuted, entryTotal: report.entries.length })
  ]);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("row_timeout")), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); }
    );
  });
}

function createBeacon(capturePath: string) {
  const progressPath = `${capturePath}.progress`;
  return async (stage: string): Promise<void> => {
    try {
      await appendFile(progressPath, `${new Date().toISOString()} ${stage}\n`, "utf8");
    } catch {
      // Beacons are diagnostics only.
    }
  };
}

function validateDatabaseUrl(databaseUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL.");
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new Error("DATABASE_URL must be a PostgreSQL URL.");
  }
  if (["host", "hostaddr", "service", "servicefile"].some((key) => parsed.searchParams.has(key))) {
    throw new Error("Standings refresh refuses connection target overrides.");
  }
}

async function readCaptureFile(capturePath: string): Promise<unknown> {
  let raw: string;
  try {
    raw = await readFile(capturePath, "utf8");
  } catch (error) {
    throw new Error(`Capture file cannot be read: ${error instanceof Error ? error.message : "unknown error"}`);
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Capture file is not valid JSON.");
  }
}

function validateCapture(capture: unknown): CapturedStandingRow[] {
  if (!isRecord(capture)) throw new Error("Capture must be an object.");
  if (capture.source !== "sofascore-standings") throw new Error("Capture source must be sofascore-standings.");
  if (typeof capture.capturedAt !== "string" || !Number.isFinite(Date.parse(capture.capturedAt))) {
    throw new Error("Capture must include an ISO capturedAt timestamp.");
  }
  if (!Array.isArray(capture.tournaments)) throw new Error("Capture must include a tournaments array.");
  const rows: CapturedStandingRow[] = [];
  const seen = new Set<string>();
  for (const rawTournament of capture.tournaments) {
    if (!isRecord(rawTournament)) throw new Error("Capture tournaments must be objects.");
    const tournamentId = positiveIntegerString(rawTournament.sofascore_tournament_id, "tournament id");
    if (!Array.isArray(rawTournament.standings)) throw new Error("Capture tournament standings must be an array.");
    for (const rawRow of rawTournament.standings) {
      if (!isRecord(rawRow)) throw new Error("Capture standings must be objects.");
      const teamId = positiveIntegerString(rawRow.team_id, "team id");
      const key = `${tournamentId}:${teamId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        tournamentId,
        teamId,
        position: boundedInteger(rawRow.position, 1, MAX_TABLE_ROWS, "position"),
        played: boundedInteger(rawRow.played, 0, 100, "played"),
        wins: boundedInteger(rawRow.wins, 0, 100, "wins"),
        draws: boundedInteger(rawRow.draws, 0, 100, "draws"),
        losses: boundedInteger(rawRow.losses, 0, 100, "losses"),
        goalsFor: boundedInteger(rawRow.goals_for, 0, 500, "goals_for"),
        goalsAgainst: boundedInteger(rawRow.goals_against, 0, 500, "goals_against"),
        points: boundedInteger(rawRow.points, 0, 300, "points"),
        form: typeof rawRow.form === "string" ? rawRow.form : null
      });
    }
  }
  if (rows.length === 0) throw new Error("Capture contains no importable standings rows.");
  return rows;
}

function positiveIntegerString(value: unknown, label: string): string {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value === "string" && /^[1-9]\d*$/.test(value)) return value;
  throw new Error(`Capture ${label} must be a positive integer.`);
}

function boundedInteger(value: unknown, minimum: number, maximum: number, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`Capture ${label} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

function resolveSingle(rows: unknown[], column: string): Resolution {
  if (rows.length === 0) return { status: "missing" };
  if (rows.length > 1) return { status: "conflict" };
  const value = record(rows[0])[column];
  if (typeof value !== "string" || !value) return { status: "missing" };
  return { status: "ok", id: value };
}

function resolveTeam(rawRows: unknown[]): { status: "ok"; id: string } | { status: "skipped"; reason: string } {
  const rows = rawRows.map(record);
  const mappings = rows.filter((row) => row.kind === "mapping");
  if (mappings.length > 1 || mappings.some((row) => row.team_exists !== true || row.internal_entity_type !== "team")) {
    return { status: "skipped", reason: "identity_conflict" };
  }
  const ids = new Set(rows.filter((row) => row.team_exists === true).map((row) => row.id));
  if (ids.size > 1) return { status: "skipped", reason: "identity_conflict" };
  const selected = mappings[0] ?? rows[0];
  if (!selected || selected.team_exists !== true || typeof selected.id !== "string") {
    return { status: "skipped", reason: "unknown_team" };
  }
  return { status: "ok", id: selected.id };
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

const resolveCompetitionSql = `SELECT c.id::text AS id
  FROM provider_mappings pm
  JOIN competitions c ON c.id = pm.internal_entity_id
  JOIN sports s ON s.id = c.sport_id AND s.slug = 'football'
  WHERE pm.provider = 'sofascore' AND pm.entity_type = 'competition' AND pm.provider_entity_id = $1`;

const resolveSeasonSql = `SELECT id::text AS id
  FROM seasons
  WHERE competition_id = $1::uuid AND is_current = true
  ORDER BY start_date DESC NULLS LAST, updated_at DESC
  LIMIT 1`;

const resolveTeamSql = `SELECT 'mapping' AS kind, pm.internal_entity_id::text AS id, pm.internal_entity_type,
    t.id IS NOT NULL AS team_exists
  FROM provider_mappings pm
  LEFT JOIN teams t ON t.id = pm.internal_entity_id
  WHERE pm.provider = 'sofascore' AND pm.entity_type = 'team' AND pm.provider_entity_id = $1
  UNION ALL
  SELECT 'metadata', t.id::text, 'team', true
  FROM teams t JOIN sports s ON s.id = t.sport_id AND s.slug = 'football'
  WHERE t.metadata_json->>'sofascoreId' = $1`;

const beginSyncJobSql = `INSERT INTO sync_jobs (
    queue_name, job_name, job_key, provider, entity_type, status, attempt_count, started_at
  )
  VALUES ('sync-service', $1, $2, 'sofascore', 'standing', 'running', 1, $3)
  ON CONFLICT (job_key) DO UPDATE SET
    status = 'running',
    attempt_count = sync_jobs.attempt_count + 1,
    started_at = EXCLUDED.started_at,
    last_error = NULL,
    updated_at = now()
  RETURNING id`;

const finishSyncJobSql = `UPDATE sync_jobs
  SET status = $2, last_error = $3, finished_at = $4, duration_ms = $5, updated_at = now()
  WHERE id = $1::uuid
  RETURNING id`;

const insertSyncLogSql = `INSERT INTO sync_job_logs (sync_job_id, level, message, metadata_json)
  VALUES ($1::uuid, $2, $3, $4::jsonb)`;

const insertStandingSql = `INSERT INTO football_standings (
    competition_id, season_id, team_id, position, played, wins, draws, losses,
    goals_for, goals_against, goal_difference, points, metadata_json
  )
  VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)
  ON CONFLICT ON CONSTRAINT "football_standings_competition_season_team_uidx" DO UPDATE SET
    position = EXCLUDED.position, played = EXCLUDED.played, wins = EXCLUDED.wins,
    draws = EXCLUDED.draws, losses = EXCLUDED.losses, goals_for = EXCLUDED.goals_for,
    goals_against = EXCLUDED.goals_against, goal_difference = EXCLUDED.goal_difference,
    points = EXCLUDED.points,
    metadata_json = COALESCE(NULLIF(football_standings.metadata_json, 'null'::jsonb), '{}'::jsonb) || EXCLUDED.metadata_json,
    updated_at = now()
  RETURNING id`;

const upsertStandingSql = `UPDATE football_standings s SET
    position = $4, played = $5, wins = $6, draws = $7, losses = $8,
    goals_for = $9, goals_against = $10, goal_difference = $11, points = $12,
    metadata_json = COALESCE(NULLIF(s.metadata_json, 'null'::jsonb), '{}'::jsonb) || $13::jsonb,
    updated_at = now()
  WHERE s.competition_id = $1::uuid AND s.season_id = $2::uuid AND s.team_id = $3::uuid
    AND (s.position, s.played, s.wins, s.draws, s.losses, s.goals_for, s.goals_against, s.points)
        IS DISTINCT FROM ($4, $5, $6, $7, $8, $9, $10, $12)
  RETURNING s.id`;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = parseSofaScoreStandingsArgs(process.argv.slice(2));
  const beacon = createBeacon(options.capturePath);
  beacon("cli_start")
    .then(() => runSofaScoreStandingsSync(options))
    .then((report) => console.log(JSON.stringify(report)))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "DATABASE_URL=<redacted>") : "SofaScore standings refresh failed.");
      process.exitCode = 1;
    });
}
