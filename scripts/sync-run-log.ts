import { pathToFileURL } from "node:url";
import pg from "pg";

interface Options {
  job: string;
  status: string;
  mode: string;
  summary: string;
  error?: string;
}

interface JobIdentity {
  jobKey: string;
  jobName: string;
  entityType: string;
}

const jobs: Record<string, JobIdentity> = {
  "finished-matches": { jobKey: "sofascore.finished-matches", jobName: "finished-matches-sync", entityType: "match" }
};
const failedStatuses = new Set(["fetch_failed", "import_failed", "service_error"]);

export function parseSyncRunLogArgs(args: string[]): Options {
  const options: Partial<Options> = {};
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (["--job", "--status", "--mode", "--summary", "--error"].includes(arg)) {
      const value = args[++index];
      if (!value) throw new Error(`${arg} requires a value.`);
      (options as Record<string, string>)[arg.slice(2)] = value;
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
  const failed = failedStatuses.has(options.status);
  if (failed && !options.error) {
    throw new Error(`--error is required for ${options.status} outcomes.`);
  }
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const job = await pool.query(`
      INSERT INTO sync_jobs (
        queue_name, job_name, job_key, provider, entity_type, status,
        attempt_count, last_error, started_at, finished_at, duration_ms
      )
      VALUES ('sync-service', $1, $2, 'sofascore', $3, $4, 1, $5, now(), now(), 0)
      ON CONFLICT (job_key) DO UPDATE SET
        status = EXCLUDED.status,
        attempt_count = sync_jobs.attempt_count + 1,
        last_error = EXCLUDED.last_error,
        started_at = EXCLUDED.started_at,
        finished_at = EXCLUDED.finished_at,
        duration_ms = EXCLUDED.duration_ms,
        updated_at = now()
      RETURNING id
    `, [identity.jobName, identity.jobKey, identity.entityType, failed ? "failed" : options.status, options.error ?? null]);
    const jobId = job.rows.length === 1 ? (job.rows[0] as { id?: string }).id : undefined;
    if (!jobId) return;
    await pool.query(`
      INSERT INTO sync_job_logs (sync_job_id, level, message, metadata_json)
      VALUES ($1::uuid, $2, $3, $4::jsonb)
    `, [
      jobId,
      failed ? "error" : "info",
      `${options.job} ${options.status} (${options.mode})`,
      JSON.stringify({ status: options.status, mode: options.mode, error: options.error ?? null, summary })
    ]);
  } finally {
    await pool.end().catch(() => {});
  }
}

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
