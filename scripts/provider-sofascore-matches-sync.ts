import { appendFile, readFile } from "node:fs/promises";
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
  job?: string;
}

export interface SofaScoreMatchesDependencies {
  env?: NodeJS.ProcessEnv;
  readCapture?: (capturePath: string) => Promise<unknown>;
  database?: DatabaseClient;
  now?: () => Date;
  eventTimeoutMs?: number;
}

export interface SofaScoreMatchesReport {
  mode: "dry_run" | "execute";
  capturePath: string;
  databaseConfigured: boolean;
  queriesExecuted: number;
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
  statusType: "finished" | "notstarted";
  round: number | null;
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number | null;
  awayScore: number | null;
  homeScoreHalftime: number | null;
  awayScoreHalftime: number | null;
}

const MAX_GOALS = 30;
const KICKOFF_FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

const JOB_IDENTITIES: Record<string, { jobKey: string; jobName: string }> = {
  "finished-matches": { jobKey: "sofascore.finished-matches", jobName: "finished-matches-sync" },
  "upcoming-matches": { jobKey: "sofascore.upcoming-matches", jobName: "upcoming-matches-sync" }
};

export function parseSofaScoreMatchesArgs(args: string[]): SofaScoreMatchesOptions {
  const options: SofaScoreMatchesOptions = { execute: false, capturePath: "", logRun: true, job: "finished-matches" };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--execute") options.execute = true;
    else if (arg === "--no-log-run") options.logRun = false;
    else if (arg === "--job" || arg.startsWith("--job=")) {
      const value = arg === "--job" ? args[++index] : arg.slice("--job=".length);
      if (!value || !JOB_IDENTITIES[value]) throw new Error(`--job must be one of: ${Object.keys(JOB_IDENTITIES).join(", ")}.`);
      options.job = value;
    } else if (arg === "--capture" || arg.startsWith("--capture=")) {
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
  // Transient pool errors must never crash a long refresh run.
  pool?.on("error", () => {});
  const database = env.DATABASE_URL ? dependencies.database ?? pool : undefined;
  await beacon("database_configured");
  const capture = await (dependencies.readCapture ?? readCaptureFile)(options.capturePath);
  const events = validateCapture(capture);
  await beacon(`capture_validated events=${events.length}`);

  let syncJobId: string | undefined;
  let loggingError: string | undefined;
  if (database && options.logRun) {
    try {
      syncJobId = await beginSyncRun(database, startedAt, options.job ?? "finished-matches");
      await beacon("begin_logged");
    } catch (error) {
      loggingError = error instanceof Error ? error.message : "sync run logging failed";
    }
  }

  const entries: MatchEntry[] = [];
  // Identity anchors repeat across a run; resolve each provider id once.
  const competitionCache = new Map<string, Resolution>();
  const seasonCache = new Map<string, Resolution>();
  const teamCache = new Map<string, Resolution>();
  const startedQueries = { count: 0 };
  const progress = { lastCount: 0, lastAt: startedAt.getTime() };
  const eventTimeoutMs = dependencies.eventTimeoutMs ?? 30_000;
  try {
    for (let index = 0; index < events.length; index++) {
      const event = events[index];
      try {
        entries.push(await withTimeout(importEvent(event, options, database, now, { competitionCache, seasonCache, teamCache, startedQueries }), eventTimeoutMs));
      } catch (error) {
        // A single failed or wedged resolution must not abort the whole refresh;
        // the category is recorded without leaking database diagnostics.
        const reason = error instanceof Error && error.message === "event_timeout" ? "event_timeout" : "query_failed";
        entries.push({ providerMatchId: event.sofascoreId, tournamentId: event.tournamentId, action: reason, reason });
      }
      if (database && syncJobId && progressDue(progress, index + 1, now())) {
        await recordProgress(database, syncJobId, index + 1, events.length, now().getTime() - startedAt.getTime(), event.sofascoreId).catch(() => {});
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
  const report: SofaScoreMatchesReport = {
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

const PROGRESS_EVENT_STEP = 100;
const PROGRESS_TIME_STEP_MS = 60_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("event_timeout")), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); }
    );
  });
}

function progressDue(progress: { lastCount: number; lastAt: number }, processed: number, at: Date): boolean {
  if (processed - progress.lastCount >= PROGRESS_EVENT_STEP || at.getTime() - progress.lastAt >= PROGRESS_TIME_STEP_MS) {
    progress.lastCount = processed;
    progress.lastAt = at.getTime();
    return true;
  }
  return false;
}

type Resolution = { status: "ok"; id: string } | { status: "missing" | "conflict" };

const FINISHED_STATUSES = new Set(["finished", "after_extra_time", "after_penalties"]);

async function importFixture(
  event: CapturedEvent,
  options: SofaScoreMatchesOptions,
  database: DatabaseClient,
  existingRows: JsonRecord[],
  base: MatchEntry,
  competitionId: string,
  seasonId: string,
  homeTeamId: string,
  awayTeamId: string
): Promise<MatchEntry> {
  // Fixtures refresh only ever adds missing scheduled matches; a finished row is never touched.
  if (existingRows.length === 1) {
    const existing = existingRows[0];
    const matchId = String(existing.id);
    if (typeof existing.status === "string" && FINISHED_STATUSES.has(existing.status)) {
      return { ...base, action: "skipped", reason: "already_finished", matchId };
    }
    return { ...base, action: "unchanged", matchId };
  }
  if (!options.execute) {
    return { ...base, action: "planned_insert" };
  }
  const inserted = await database.query(insertFixtureSql, [
    competitionId,
    seasonId,
    event.round,
    homeTeamId,
    awayTeamId,
    event.startTimestamp,
    JSON.stringify(metadataPatch(event))
  ]);
  if (inserted.rows.length !== 1) {
    return { ...base, action: "skipped", reason: "insert_conflict" };
  }
  return { ...base, action: "inserted", matchId: String(record(inserted.rows[0]).id) };
}

interface ImportContext {
  competitionCache: Map<string, Resolution>;
  seasonCache: Map<string, Resolution>;
  teamCache: Map<string, Resolution>;
  startedQueries: { count: number };
}

async function resolveCompetitionId(database: DatabaseClient, context: ImportContext, tournamentId: string): Promise<Resolution> {
  const cached = context.competitionCache.get(tournamentId);
  if (cached) return cached;
  context.startedQueries.count++;
  const result = resolveSingle((await database.query(resolveCompetitionSql, [tournamentId])).rows, "id");
  context.competitionCache.set(tournamentId, result);
  return result;
}

async function resolveSeasonId(database: DatabaseClient, context: ImportContext, competitionId: string): Promise<Resolution> {
  const cached = context.seasonCache.get(competitionId);
  if (cached) return cached;
  context.startedQueries.count++;
  const result = resolveSingle((await database.query(resolveSeasonSql, [competitionId])).rows, "id");
  context.seasonCache.set(competitionId, result);
  return result;
}

async function resolveTeamId(database: DatabaseClient, context: ImportContext, providerTeamId: string): Promise<{ status: "ok"; id: string } | { status: "skipped"; reason: string }> {
  const cached = context.teamCache.get(providerTeamId);
  if (cached) {
    return cached.status === "ok" ? cached : { status: "skipped", reason: cached.status === "missing" ? "unknown_team" : "identity_conflict" };
  }
  context.startedQueries.count++;
  const resolved = resolveTeam((await database.query(resolveTeamSql, [providerTeamId])).rows);
  context.teamCache.set(providerTeamId, resolved.status === "ok" ? resolved : { status: resolved.reason === "unknown_team" ? "missing" : "conflict" });
  return resolved;
}

async function importEvent(
  event: CapturedEvent,
  options: SofaScoreMatchesOptions,
  database: DatabaseClient | undefined,
  now: () => Date,
  context: ImportContext
): Promise<MatchEntry> {
  const base: MatchEntry = { providerMatchId: event.sofascoreId, tournamentId: event.tournamentId, action: "capture_validated" };
  if (!database) {
    return base;
  }
  const competition = await resolveCompetitionId(database, context, event.tournamentId);
  if (competition.status !== "ok") {
    return { ...base, action: "skipped", reason: competition.status === "missing" ? "unknown_competition" : "identity_conflict" };
  }
  const season = await resolveSeasonId(database, context, competition.id);
  if (season.status !== "ok") {
    return { ...base, action: "skipped", reason: "unknown_season" };
  }
  const homeTeam = await resolveTeamId(database, context, event.homeTeamId);
  if (homeTeam.status !== "ok") {
    return { ...base, action: "skipped", reason: homeTeam.reason };
  }
  const awayTeam = await resolveTeamId(database, context, event.awayTeamId);
  if (awayTeam.status !== "ok") {
    return { ...base, action: "skipped", reason: awayTeam.reason };
  }

  context.startedQueries.count++;
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
  if (event.statusType === "notstarted") {
    return importFixture(event, options, database, existingRows, base, competition.id, season.id, homeTeam.id, awayTeam.id);
  }
  const winnerTeamId = event.homeScore! > event.awayScore! ? homeTeam.id : event.awayScore! > event.homeScore! ? awayTeam.id : null;
  const finishedStatuses = FINISHED_STATUSES;

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
  const patch: JsonRecord = { sofascoreId: Number(event.sofascoreId) };
  if (event.statusType === "finished") {
    patch.homeScore = event.homeScore;
    patch.awayScore = event.awayScore;
  }
  if (event.round !== null) patch.round = event.round;
  return patch;
}

async function beginSyncRun(database: DatabaseClient, startedAt: Date, job: string): Promise<string | undefined> {
  const identity = JOB_IDENTITIES[job];
  if (!identity) throw new Error(`Unknown sync job "${job}".`);
  const result = await database.query(beginSyncJobSql, [identity.jobName, identity.jobKey, startedAt.toISOString()]);
  return result.rows.length === 1 ? String(record(result.rows[0]).id) : undefined;
}

async function recordProgress(database: DatabaseClient, jobId: string, processed: number, total: number, elapsedMs: number, lastProviderMatchId: string): Promise<void> {
  await database.query(insertSyncLogSql, [
    jobId,
    "info",
    `import_progress ${processed}/${total}`,
    JSON.stringify({ step: "import_progress", processed, total, elapsedMs, lastProviderMatchId })
  ]);
}

async function finishSyncRun(database: DatabaseClient, jobId: string, report: SofaScoreMatchesReport, startedAt: Date, finishedAt: Date): Promise<void> {
  const failed = (report.counts.query_failed ?? 0) > 0 || (report.counts.event_timeout ?? 0) > 0;
  await database.query(finishSyncJobSql, [
    jobId,
    failed ? "failed" : "succeeded",
    failed ? "one or more refresh queries failed" : null,
    finishedAt.toISOString(),
    Math.max(0, finishedAt.getTime() - startedAt.getTime())
  ]);
  const summary = {
    mode: report.mode,
    capturePath: report.capturePath,
    counts: report.counts,
    queriesExecuted: report.queriesExecuted,
    entryTotal: report.entries.length
  };
  await database.query(insertSyncLogSql, [
    jobId,
    failed ? "error" : "info",
    `${report.mode} run: ${report.entries.length} events`,
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

function createBeacon(capturePath: string) {
  const progressPath = `${capturePath}.progress`;
  return async (stage: string): Promise<void> => {
    try {
      await appendFile(progressPath, `${new Date().toISOString()} ${stage}\n`, "utf8");
    } catch {
      // Beacons are diagnostics only; a failure to write must never matter.
    }
  };
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
      const statusType = rawEvent.status_type;
      if (statusType !== "finished" && statusType !== "notstarted") throw new Error("Capture events must be finished or notstarted.");
      const startTimestamp = rawEvent.start_timestamp;
      if (typeof startTimestamp !== "number" || !Number.isSafeInteger(startTimestamp) || startTimestamp <= 0) {
        throw new Error("Capture events must include a valid start timestamp.");
      }
      events.push({
        sofascoreId,
        tournamentId,
        startTimestamp,
        statusType,
        round: optionalRound(rawEvent.round),
        homeTeamId: positiveIntegerString(rawEvent.home_team_id, "home team id"),
        awayTeamId: positiveIntegerString(rawEvent.away_team_id, "away team id"),
        homeScore: statusType === "finished" ? goalCount(rawEvent.home_score) : optionalGoalCount(rawEvent.home_score),
        awayScore: statusType === "finished" ? goalCount(rawEvent.away_score) : optionalGoalCount(rawEvent.away_score),
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

const insertFixtureSql = `INSERT INTO matches (
    sport_id, competition_id, season_id, round, home_team_id, away_team_id,
    scheduled_start_at, status, metadata_json
  )
  SELECT s.id, $1::uuid, $2::uuid, $3, $4::uuid, $5::uuid,
    to_timestamp($6::bigint), 'scheduled', $7::jsonb
  FROM sports s WHERE s.slug = 'football'
  ON CONFLICT ON CONSTRAINT "matches_natural_uidx" DO NOTHING
  RETURNING id`;

const beginSyncJobSql = `INSERT INTO sync_jobs (
    queue_name, job_name, job_key, provider, entity_type, status, attempt_count, started_at
  )
  VALUES ('sync-service', $1, $2, 'sofascore', 'match', 'running', 1, $3)
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = parseSofaScoreMatchesArgs(process.argv.slice(2));
  const beacon = createBeacon(options.capturePath);
  beacon("cli_start")
    .then(() => runSofaScoreMatchesSync(options))
    .then((report) => console.log(JSON.stringify(report)))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "DATABASE_URL=<redacted>") : "SofaScore matches refresh failed.");
      process.exitCode = 1;
    });
}
