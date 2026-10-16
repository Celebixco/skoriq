import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import pg from "pg";

type JsonRecord = Record<string, unknown>;

interface DatabaseClient {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

export interface SofaScoreMatchesOptions {
  execute: boolean;
  capturePath: string;
  logRun: boolean;
}

export interface SofaScoreMatchesDependencies {
  env?: NodeJS.ProcessEnv;
  readCapture?: (capturePath: string) => Promise<unknown>;
  database?: DatabaseClient;
  now?: () => Date;
}

export interface SofaScoreMatchesReport {
  mode: "dry_run" | "execute";
  capturePath: string;
  databaseConfigured: boolean;
  entries: MatchEntry[];
  counts: Record<string, number>;
  syncJobLogged: boolean;
  loggingError?: string;
}

interface MatchEntry {
  providerMatchId: string;
  tournamentId: string;
  action: string;
  matchId?: string;
  reason?: string;
}

interface CapturedEvent {
  sofascoreId: string;
  tournamentId: string;
  startTimestamp: number;
  round: number | null;
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number;
  awayScore: number;
  homeScoreHalftime: number | null;
  awayScoreHalftime: number | null;
}

const MAX_GOALS = 30;
const KICKOFF_FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

export function parseSofaScoreMatchesArgs(args: string[]): SofaScoreMatchesOptions {
  const options: SofaScoreMatchesOptions = { execute: false, capturePath: "", logRun: true };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--execute") options.execute = true;
    else if (arg === "--no-log-run") options.logRun = false;
    else if (arg === "--capture" || arg.startsWith("--capture=")) {
      const value = arg === "--capture" ? args[++index] : arg.slice("--capture=".length);
      if (!value || value.startsWith("--")) throw new Error("--capture requires a file path.");
      options.capturePath = value;
    } else throw new Error(`Unknown SofaScore matches flag "${arg}".`);
  }
  if (!options.capturePath) throw new Error("A validated capture file is required; pass --capture <path>.");
  return options;
}

export async function runSofaScoreMatchesSync(
  options: SofaScoreMatchesOptions,
  dependencies: SofaScoreMatchesDependencies = {}
): Promise<SofaScoreMatchesReport> {
  const env = dependencies.env ?? process.env;
  const now = dependencies.now ?? (() => new Date());
  // Unlike the supervised team-statistics slice, this importer is the production
  // refresh path: writes are additive/corrective only (status to finished, scores,
  // merged metadata), never destructive and never a rebuild.
  if (options.execute && !env.DATABASE_URL) {
    throw new Error("Executing the matches refresh requires DATABASE_URL.");
  }
  if (env.DATABASE_URL) {
    validateDatabaseUrl(env.DATABASE_URL);
  }

  const startedAt = now();
  const capture = await (dependencies.readCapture ?? readCaptureFile)(options.capturePath);
  const events = validateCapture(capture);

  const pool = env.DATABASE_URL && !dependencies.database
    ? new pg.Pool({ connectionString: env.DATABASE_URL, max: 2 })
    : undefined;
  // Transient pool errors must never crash a long refresh run.
  pool?.on("error", () => {});
  const database = env.DATABASE_URL ? dependencies.database ?? pool : undefined;

  const entries: MatchEntry[] = [];
  try {
    for (const event of events) {
      try {
        entries.push(await importEvent(event, options, database, now));
      } catch {
        // A single failed resolution must not abort the whole refresh; the
        // category is recorded without leaking database diagnostics.
        entries.push({ providerMatchId: event.sofascoreId, tournamentId: event.tournamentId, action: "query_failed", reason: "query_failed" });
      }
    }
  } finally {
    await pool?.end();
  }

  const counts = entries.reduce<Record<string, number>>((accumulator, entry) => {
    accumulator[entry.action] = (accumulator[entry.action] ?? 0) + 1;
    return accumulator;
  }, {});
  const report: SofaScoreMatchesReport = {
    mode: options.execute ? "execute" : "dry_run",
    capturePath: options.capturePath,
    databaseConfigured: Boolean(database),
    entries,
    counts,
    syncJobLogged: false
  };
  if (database && options.logRun) {
    try {
      await recordSyncRun(database, report, startedAt, now());
      report.syncJobLogged = true;
    } catch (error) {
      report.loggingError = error instanceof Error ? error.message : "sync run logging failed";
    }
  }
  return report;
}

async function importEvent(
  event: CapturedEvent,
  options: SofaScoreMatchesOptions,
  database: DatabaseClient | undefined,
  now: () => Date
): Promise<MatchEntry> {
  const base: MatchEntry = { providerMatchId: event.sofascoreId, tournamentId: event.tournamentId, action: "capture_validated" };
  if (!database) {
    return base;
  }
  const competition = resolveSingle((await database.query(resolveCompetitionSql, [event.tournamentId])).rows, "id");
  if (competition.status !== "ok") {
    return { ...base, action: "skipped", reason: competition.status === "missing" ? "unknown_competition" : "identity_conflict" };
  }
  const season = resolveSingle((await database.query(resolveSeasonSql, [competition.id])).rows, "id");
  if (season.status !== "ok") {
    return { ...base, action: "skipped", reason: "unknown_season" };
  }
  const homeTeam = resolveTeam((await database.query(resolveTeamSql, [event.homeTeamId])).rows);
  if (homeTeam.status !== "ok") {
    return { ...base, action: "skipped", reason: homeTeam.reason };
  }
  const awayTeam = resolveTeam((await database.query(resolveTeamSql, [event.awayTeamId])).rows);
  if (awayTeam.status !== "ok") {
    return { ...base, action: "skipped", reason: awayTeam.reason };
  }

  const existingRows = (await database.query(findMatchSql, [
    event.sofascoreId,
    competition.id,
    season.id,
    homeTeam.id,
    awayTeam.id,
    event.startTimestamp
  ])).rows.map(record);
  if (existingRows.length > 1) {
    return { ...base, action: "skipped", reason: "identity_conflict" };
  }
  const winnerTeamId = event.homeScore > event.awayScore ? homeTeam.id : event.awayScore > event.homeScore ? awayTeam.id : null;
  const finishedStatuses = new Set(["finished", "after_extra_time", "after_penalties"]);

  if (existingRows.length === 1) {
    const existing = existingRows[0];
    const matchId = String(existing.id);
    if (unchanged(existing, event, winnerTeamId, finishedStatuses)) {
      return { ...base, action: "unchanged", matchId };
    }
    if (!options.execute) {
      return { ...base, action: "planned_update", matchId };
    }
    const updated = await database.query(updateMatchSql, [
      matchId,
      winnerTeamId,
      JSON.stringify(metadataPatch(event))
    ]);
    if (updated.rows.length !== 1) {
      return { ...base, action: "skipped", reason: "concurrent_change", matchId };
    }
    await upsertScores(database, matchId, homeTeam.id, awayTeam.id, winnerTeamId, event);
    return { ...base, action: "updated", matchId };
  }

  if (event.startTimestamp * 1000 > now().getTime() + KICKOFF_FUTURE_TOLERANCE_MS) {
    return { ...base, action: "skipped", reason: "future_kickoff" };
  }
  if (!options.execute) {
    return { ...base, action: "planned_insert" };
  }
  const inserted = await database.query(insertMatchSql, [
    competition.id,
    season.id,
    event.round,
    homeTeam.id,
    awayTeam.id,
    event.startTimestamp,
    winnerTeamId,
    JSON.stringify(metadataPatch(event))
  ]);
  if (inserted.rows.length !== 1) {
    // A concurrent insert already created this fixture; the next refresh updates it.
    return { ...base, action: "skipped", reason: "insert_conflict" };
  }
  const matchId = String(record(inserted.rows[0]).id);
  await upsertScores(database, matchId, homeTeam.id, awayTeam.id, winnerTeamId, event);
  return { ...base, action: "inserted", matchId };
}

function unchanged(existing: JsonRecord, event: CapturedEvent, winnerTeamId: string | null, finishedStatuses: Set<string>): boolean {
  if (typeof existing.status !== "string" || !finishedStatuses.has(existing.status)) return false;
  if (existing.home_score_current !== event.homeScore || existing.away_score_current !== event.awayScore) return false;
  if ((existing.winner_team_id ?? null) !== winnerTeamId) return false;
  if (event.homeScoreHalftime !== null && existing.home_score_halftime !== event.homeScoreHalftime) return false;
  if (event.awayScoreHalftime !== null && existing.away_score_halftime !== event.awayScoreHalftime) return false;
  const metadata = record(existing.metadata_json);
  if (metadata.sofascoreId != null && String(metadata.sofascoreId) !== event.sofascoreId) return false;
  if (event.round !== null && metadata.round != null && Number(metadata.round) !== event.round) return false;
  return true;
}

async function upsertScores(
  database: DatabaseClient,
  matchId: string,
  homeTeamId: string,
  awayTeamId: string,
  winnerTeamId: string | null,
  event: CapturedEvent
): Promise<void> {
  await database.query(upsertScoresSql, [
    matchId,
    homeTeamId,
    awayTeamId,
    winnerTeamId,
    event.homeScore,
    event.awayScore,
    event.homeScoreHalftime,
    event.awayScoreHalftime
  ]);
}

function metadataPatch(event: CapturedEvent): JsonRecord {
  const patch: JsonRecord = {
    sofascoreId: Number(event.sofascoreId),
    homeScore: event.homeScore,
    awayScore: event.awayScore
  };
  if (event.round !== null) patch.round = event.round;
  return patch;
}

async function recordSyncRun(database: DatabaseClient, report: SofaScoreMatchesReport, startedAt: Date, finishedAt: Date): Promise<void> {
  const failed = (report.counts.query_failed ?? 0) > 0;
  const job = await database.query(recordSyncJobSql, [
    failed ? "failed" : "succeeded",
    failed ? "one or more refresh queries failed" : null,
    startedAt.toISOString(),
    finishedAt.toISOString(),
    Math.max(0, finishedAt.getTime() - startedAt.getTime())
  ]);
  const jobId = job.rows.length === 1 ? record(job.rows[0]).id : undefined;
  if (!jobId) return;
  const summary = {
    mode: report.mode,
    capturePath: report.capturePath,
    counts: report.counts,
    entryTotal: report.entries.length
  };
  await database.query(insertSyncLogSql, [
    String(jobId),
    failed ? "error" : "info",
    `finished-matches ${report.mode} run: ${report.entries.length} events`,
    JSON.stringify(summary)
  ]);
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
    throw new Error("Matches refresh refuses connection target overrides.");
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

function validateCapture(capture: unknown): CapturedEvent[] {
  if (!isRecord(capture)) throw new Error("Capture must be an object.");
  if (capture.source !== "sofascore") throw new Error("Capture source must be sofascore.");
  if (typeof capture.capturedAt !== "string" || !Number.isFinite(Date.parse(capture.capturedAt))) {
    throw new Error("Capture must include an ISO capturedAt timestamp.");
  }
  if (!Array.isArray(capture.tournaments)) throw new Error("Capture must include a tournaments array.");
  const events: CapturedEvent[] = [];
  const seen = new Set<string>();
  for (const rawTournament of capture.tournaments) {
    if (!isRecord(rawTournament)) throw new Error("Capture tournaments must be objects.");
    const tournamentId = positiveIntegerString(rawTournament.sofascore_tournament_id, "tournament id");
    positiveIntegerString(rawTournament.season_id, "season id");
    if (!Array.isArray(rawTournament.events)) throw new Error("Capture tournament events must be an array.");
    for (const rawEvent of rawTournament.events) {
      if (!isRecord(rawEvent)) throw new Error("Capture events must be objects.");
      const sofascoreId = positiveIntegerString(rawEvent.sofascore_id, "event id");
      if (seen.has(sofascoreId)) continue;
      seen.add(sofascoreId);
      if (rawEvent.status_type !== "finished") throw new Error("Capture events must be finished.");
      const startTimestamp = rawEvent.start_timestamp;
      if (typeof startTimestamp !== "number" || !Number.isSafeInteger(startTimestamp) || startTimestamp <= 0) {
        throw new Error("Capture events must include a valid start timestamp.");
      }
      events.push({
        sofascoreId,
        tournamentId,
        startTimestamp,
        round: optionalRound(rawEvent.round),
        homeTeamId: positiveIntegerString(rawEvent.home_team_id, "home team id"),
        awayTeamId: positiveIntegerString(rawEvent.away_team_id, "away team id"),
        homeScore: goalCount(rawEvent.home_score),
        awayScore: goalCount(rawEvent.away_score),
        homeScoreHalftime: optionalGoalCount(rawEvent.home_score_halftime),
        awayScoreHalftime: optionalGoalCount(rawEvent.away_score_halftime)
      });
    }
  }
  if (events.length === 0) throw new Error("Capture contains no importable events.");
  return events;
}

function positiveIntegerString(value: unknown, label: string): string {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value === "string" && /^[1-9]\d*$/.test(value)) return value;
  throw new Error(`Capture ${label} must be a positive integer.`);
}

function goalCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > MAX_GOALS) {
    throw new Error("Capture scores must be integers between 0 and 30.");
  }
  return value;
}

function optionalGoalCount(value: unknown): number | null {
  return value === undefined || value === null ? null : goalCount(value);
}

function optionalRound(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0 || value > 200) {
    throw new Error("Capture round must be a positive integer.");
  }
  return value;
}

function resolveSingle(rows: unknown[], column: string): { status: "ok"; id: string } | { status: "missing" | "conflict" } {
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

const findMatchSql = `SELECT m.id::text AS id, m.status, m.winner_team_id::text AS winner_team_id, m.metadata_json,
    fs.home_score_current, fs.away_score_current, fs.home_score_halftime, fs.away_score_halftime
  FROM matches m
  LEFT JOIN football_match_scores fs ON fs.match_id = m.id
  WHERE m.metadata_json->>'sofascoreId' = $1
     OR (m.competition_id = $2::uuid AND m.season_id = $3::uuid
         AND m.home_team_id = $4::uuid AND m.away_team_id = $5::uuid
         AND m.scheduled_start_at = to_timestamp($6::bigint))
  LIMIT 2`;

// Status only ever moves to 'finished' here, so a stale capture can never
// downgrade a finished match. Metadata is merged, not replaced, so telemetry
// stored under other keys survives refresh cycles.
const updateMatchSql = `UPDATE matches
  SET status = 'finished',
      winner_team_id = COALESCE($2::uuid, winner_team_id),
      metadata_json = COALESCE(NULLIF(metadata_json, 'null'::jsonb), '{}'::jsonb) || $3::jsonb,
      updated_at = now()
  WHERE id = $1::uuid
  RETURNING id`;

const upsertScoresSql = `INSERT INTO football_match_scores (
    match_id, home_team_id, away_team_id, winner_team_id,
    home_score_current, away_score_current,
    home_score_fulltime, away_score_fulltime,
    home_score_halftime, away_score_halftime, status
  )
  VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $5, $6, $7, $8, 'finished')
  ON CONFLICT (match_id) DO UPDATE SET
    home_score_current = EXCLUDED.home_score_current,
    away_score_current = EXCLUDED.away_score_current,
    home_score_fulltime = EXCLUDED.home_score_fulltime,
    away_score_fulltime = EXCLUDED.away_score_fulltime,
    home_score_halftime = COALESCE(EXCLUDED.home_score_halftime, football_match_scores.home_score_halftime),
    away_score_halftime = COALESCE(EXCLUDED.away_score_halftime, football_match_scores.away_score_halftime),
    winner_team_id = COALESCE(EXCLUDED.winner_team_id, football_match_scores.winner_team_id),
    status = 'finished'
  WHERE football_match_scores.home_score_current IS DISTINCT FROM EXCLUDED.home_score_current
     OR football_match_scores.away_score_current IS DISTINCT FROM EXCLUDED.away_score_current
     OR football_match_scores.home_score_fulltime IS DISTINCT FROM EXCLUDED.home_score_fulltime
     OR football_match_scores.away_score_fulltime IS DISTINCT FROM EXCLUDED.away_score_fulltime
     OR (EXCLUDED.home_score_halftime IS NOT NULL AND football_match_scores.home_score_halftime IS DISTINCT FROM EXCLUDED.home_score_halftime)
     OR (EXCLUDED.away_score_halftime IS NOT NULL AND football_match_scores.away_score_halftime IS DISTINCT FROM EXCLUDED.away_score_halftime)
     OR COALESCE(football_match_scores.status::text, '') <> 'finished'`;

const insertMatchSql = `INSERT INTO matches (
    sport_id, competition_id, season_id, round, home_team_id, away_team_id,
    scheduled_start_at, status, winner_team_id, metadata_json
  )
  SELECT s.id, $1::uuid, $2::uuid, $3, $4::uuid, $5::uuid,
    to_timestamp($6::bigint), 'finished', $7::uuid, $8::jsonb
  FROM sports s WHERE s.slug = 'football'
  ON CONFLICT ON CONSTRAINT "matches_natural_uidx" DO NOTHING
  RETURNING id`;

const recordSyncJobSql = `INSERT INTO sync_jobs (
    queue_name, job_name, job_key, provider, entity_type, status,
    attempt_count, last_error, started_at, finished_at, duration_ms
  )
  VALUES ('sync-service', 'finished-matches-sync', 'sofascore.finished-matches', 'sofascore', 'match', $1, 1, $2, $3, $4, $5)
  ON CONFLICT (job_key) DO UPDATE SET
    status = EXCLUDED.status,
    attempt_count = sync_jobs.attempt_count + 1,
    last_error = EXCLUDED.last_error,
    started_at = EXCLUDED.started_at,
    finished_at = EXCLUDED.finished_at,
    duration_ms = EXCLUDED.duration_ms,
    updated_at = now()
  RETURNING id`;

const insertSyncLogSql = `INSERT INTO sync_job_logs (sync_job_id, level, message, metadata_json)
  VALUES ($1::uuid, $2, $3, $4::jsonb)`;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSofaScoreMatchesSync(parseSofaScoreMatchesArgs(process.argv.slice(2)))
    .then((report) => console.log(JSON.stringify(report)))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "DATABASE_URL=<redacted>") : "SofaScore matches refresh failed.");
      process.exitCode = 1;
    });
}
