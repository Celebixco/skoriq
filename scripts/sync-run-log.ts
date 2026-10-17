import { pathToFileURL } from "node:url";
import pg from "pg";

type SyncRunPhase = "begin" | "step" | "final";

interface Options {
  job: string;
  status: string;
  mode: string;
  summary: string;
  error?: string;
  message?: string;
  phase?: SyncRunPhase;
}

interface JobIdentity {
  jobKey: string;
  jobName: string;
  entityType: string;
}

const jobs: Record<string, JobIdentity> = {
  "finished-matches": { jobKey: "sofascore.finished-matches", jobName: "finished-matches-sync", entityType: "match" },
  "upcoming-matches": { jobKey: "sofascore.upcoming-matches", jobName: "upcoming-matches-sync", entityType: "match" },
  "standings": { jobKey: "sofascore.standings", jobName: "standings-sync", entityType: "standing" },
  "history-backfill": { jobKey: "sofascore.history-backfill", jobName: "history-backfill-sync", entityType: "match" },
  "team-statistics": { jobKey: "sofascore.team-statistics", jobName: "team-statistics-sync", entityType: "team" },
  "prematch": { jobKey: "analytics.prematch", jobName: "daily-prematch", entityType: "match" },
  "settlement": { jobKey: "analytics.settlement", jobName: "prediction-settlement", entityType: "match" }
};
const failedStatuses = new Set(["fetch_failed", "import_failed", "service_error"]);
const phases = new Set<SyncRunPhase>(["begin", "step", "final"]);

export function parseSyncRunLogArgs(args: string[]): Options {
  const options: Partial<Options> = {};
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (["--job", "--status", "--mode", "--summary", "--error", "--message", "--phase"].includes(arg)) {
      const value = args[++index];
      if (!value) throw new Error(`${arg} requires a value.`);
      if (arg === "--phase") {
        if (!phases.has(value as SyncRunPhase)) throw new Error('--phase must be one of: begin, step, final.');
        options.phase = value as SyncRunPhase;
      } else {
        (options as Record<string, string>)[arg.slice(2)] = value;
      }
    } else throw new Error(`Unknown sync run log flag "${arg}".`);
  }
  for (const required of ["job", "status", "mode", "summary"] as const) {
    if (!options[required]) throw new Error(`--${required} is required.`);
  }
  return options as Options;
}

export async function writeSyncRunLog(options: Options, databaseUrl: string): Promise<void> {
  const identity = jobs[options.job];
  if (!identity) throw new Error(`Unknown job "${options.job}".`);
  let summary: unknown;
  try {
    summary = JSON.parse(options.summary);
  } catch {
    throw new Error("--summary must be valid JSON.");
  }
  const phase = options.phase ?? "final";
  const failed = failedStatuses.has(options.status);
  if (phase === "final" && failed && !options.error) {
    throw new Error(`--error is required for ${options.status} outcomes.`);
  }
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 1,
    connectionTimeoutMillis: 5_000,
    query_timeout: 10_000,
    statement_timeout: 10_000,
    keepAlive: true
  });
  try {
    const jobId = await resolveJobId(pool, identity, phase, failed ? "failed" : options.status, options.error ?? null);
    if (!jobId) return;
    await pool.query(`
      INSERT INTO sync_job_logs (sync_job_id, level, message, metadata_json)
      VALUES ($1::uuid, $2, $3, $4::jsonb)
    `, [
      jobId,
      failed ? "error" : "info",
      options.message ?? `${options.job} ${options.status} (${options.mode})`,
      JSON.stringify({ phase, status: options.status, mode: options.mode, error: options.error ?? null, message: options.message ?? null, summary })
    ]);
  } finally {
    await pool.end().catch(() => {});
  }
}

async function resolveJobId(
  pool: pg.Pool,
  identity: JobIdentity,
  phase: SyncRunPhase,
  status: string,
  error: string | null
): Promise<string | undefined> {
  // begin opens a run exactly once; step markers only append logs and never
  // touch an existing run's status/timestamps; final closes the run.
  const sql = phase === "begin" ? beginJobSql : phase === "step" ? ensureJobSql : finishJobSql;
  const params = phase === "begin"
    ? [identity.jobName, identity.jobKey, identity.entityType]
    : phase === "step"
      ? [identity.jobName, identity.jobKey, identity.entityType]
      : [identity.jobName, identity.jobKey, identity.entityType, status, error];
  const result = await pool.query(sql, params);
  return result.rows.length === 1 ? (result.rows[0] as { id?: string }).id : undefined;
}

const beginJobSql = `INSERT INTO sync_jobs (
    queue_name, job_name, job_key, provider, entity_type, status,
    attempt_count, started_at
  )
  VALUES ('sync-service', $1, $2, 'sofascore', $3, 'running', 1, now())
  ON CONFLICT (job_key) DO UPDATE SET
    status = 'running',
    attempt_count = 1,
    started_at = EXCLUDED.started_at,
    finished_at = NULL,
    duration_ms = NULL,
    last_error = NULL,
    updated_at = now()
  RETURNING id`;

const ensureJobSql = `WITH placeholder AS (
    INSERT INTO sync_jobs (
      queue_name, job_name, job_key, provider, entity_type, status, attempt_count
    )
    VALUES ('sync-service', $1, $2, 'sofascore', $3, 'queued', 0)
    ON CONFLICT (job_key) DO NOTHING
    RETURNING id
  )
  SELECT id FROM placeholder
  UNION ALL
  SELECT id FROM sync_jobs WHERE job_key = $2
  LIMIT 1`;

const finishJobSql = `INSERT INTO sync_jobs (
    queue_name, job_name, job_key, provider, entity_type, status,
    attempt_count, started_at, finished_at, duration_ms, last_error
  )
  VALUES ('sync-service', $1, $2, 'sofascore', $3, $4, 1, now(), now(), 0, $5)
  ON CONFLICT (job_key) DO UPDATE SET
    status = EXCLUDED.status,
    last_error = EXCLUDED.last_error,
    finished_at = EXCLUDED.finished_at,
    duration_ms = GREATEST(0, (EXTRACT(EPOCH FROM (EXCLUDED.finished_at - COALESCE(sync_jobs.started_at, EXCLUDED.finished_at))) * 1000)::bigint),
    updated_at = now()
  RETURNING id`;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is required to record a sync run.");
    process.exitCode = 1;
  } else {
    writeSyncRunLog(parseSyncRunLogArgs(process.argv.slice(2)), databaseUrl)
      .then(() => console.log(JSON.stringify({ logged: true })))
      .catch((error: unknown) => {
        console.error(error instanceof Error ? error.message.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "DATABASE_URL=<redacted>") : "Sync run logging failed.");
        process.exitCode = 1;
      });
  }
}
