/**
 * Lightweight production monitor.
 *
 * Checks the public health endpoint, recent failed sync jobs and core data
 * coverage, and posts a webhook alert when configured. It deliberately has no
 * write path into the application: monitoring must never repair or mutate data.
 */
import { mkdir } from "node:fs/promises";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
const HEALTH_URL = process.env.API_HEALTH_URL || "http://api:3000/api/health/ready";
const INTERVAL_MS = Math.max(60, Number(process.env.OPS_INTERVAL_SECONDS || 300)) * 1000;
const ALERT_WEBHOOK_URL = process.env.ALERT_WEBHOOK_URL;
const MIN_TELEMETRY_MATCHES = Math.max(0, Number(process.env.MIN_TELEMETRY_MATCHES || 500));
const MIN_LINEUP_MATCHES = Math.max(0, Number(process.env.MIN_LINEUP_MATCHES || 100));
const STATE_DIR = process.env.OPS_STATE_DIR || "/var/lib/skoriq-ops";

let pool;
let stopping = false;
const alerted = new Map();

function log(event, extra = {}) {
  console.log(JSON.stringify({ event, at: new Date().toISOString(), ...extra }));
}

function redact(text) {
  return String(text ?? "").replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "DATABASE_URL=<redacted>");
}

async function sendAlert(key, message, details = {}) {
  const now = Date.now();
  const last = alerted.get(key) ?? 0;
  if (now - last < 30 * 60 * 1000) return;
  alerted.set(key, now);
  log("alert", { key, message, details });
  if (!ALERT_WEBHOOK_URL) return;
  try {
    await fetch(ALERT_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `[SkorIQ] ${message}`,
        content: `[SkorIQ] ${message}`,
        details
      }),
      signal: AbortSignal.timeout(10_000)
    });
  } catch (error) {
    log("alert_delivery_failed", { error: redact(error instanceof Error ? error.message : String(error)).slice(0, 200) });
  }
}

async function checkHealth() {
  try {
    const response = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) {
      await sendAlert("health", `Health endpoint returned ${response.status}`, { url: HEALTH_URL });
      return false;
    }
    log("health_ok", { url: HEALTH_URL });
    return true;
  } catch (error) {
    await sendAlert("health", "Health endpoint is unreachable", { url: HEALTH_URL, error: redact(error instanceof Error ? error.message : String(error)) });
    return false;
  }
}

async function checkSyncFailures() {
  if (!pool) return;
  const result = await pool.query(
    `SELECT job_key, status, last_error, updated_at
     FROM sync_jobs
     WHERE status = 'failed' AND updated_at > now() - interval '24 hours'
     ORDER BY updated_at DESC
     LIMIT 20`
  );
  for (const row of result.rows) {
    await sendAlert(`sync:${row.job_key}`, `Sync job failed: ${row.job_key}`, {
      status: row.status,
      error: row.last_error ? String(row.last_error).slice(0, 400) : null,
      updatedAt: row.updated_at
    });
  }
  if (result.rows.length === 0) log("sync_failures_ok");
}

async function checkCoverage() {
  if (!pool) return;
  const result = await pool.query(
    `SELECT
       (SELECT count(*)::int FROM matches) AS matches,
       (SELECT count(DISTINCT match_id)::int FROM football_match_team_statistics) AS telemetry_matches,
       (SELECT count(DISTINCT match_id)::int FROM football_match_lineups) AS lineup_matches,
       (SELECT count(*)::int FROM players) AS players,
       (SELECT count(*)::int FROM football_head_to_head_features WHERE sample_size > 0) AS h2h_with_history`
  );
  const row = result.rows[0] ?? {};
  log("coverage", row);
  if (Number(row.telemetry_matches ?? 0) < MIN_TELEMETRY_MATCHES) {
    await sendAlert("coverage:telemetry", "Match telemetry coverage dropped", {
      telemetryMatches: row.telemetry_matches,
      minimum: MIN_TELEMETRY_MATCHES
    });
  }
  if (Number(row.lineup_matches ?? 0) < MIN_LINEUP_MATCHES) {
    await sendAlert("coverage:lineups", "Lineup coverage dropped", {
      lineupMatches: row.lineup_matches,
      minimum: MIN_LINEUP_MATCHES
    });
  }
}

async function runChecks() {
  try {
    await checkHealth();
    await checkSyncFailures();
    await checkCoverage();
  } catch (error) {
    log("monitor_error", { error: redact(error instanceof Error ? error.message : String(error)).slice(0, 300) });
  }
}

async function main() {
  if (!DATABASE_URL) {
    log("missing_database_url");
    process.exitCode = 1;
    return;
  }
  await mkdir(STATE_DIR, { recursive: true });
  pool = new pg.Pool({
    connectionString: DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 5_000,
    query_timeout: 10_000,
    statement_timeout: 10_000
  });
  pool.on("error", () => {});
  log("monitor_started", { intervalSeconds: INTERVAL_MS / 1000, healthUrl: HEALTH_URL, webhookConfigured: Boolean(ALERT_WEBHOOK_URL) });
  const graceSeconds = Math.max(0, Number(process.env.OPS_STARTUP_GRACE_SECONDS || 60));
  if (graceSeconds > 0) {
    log("startup_grace", { seconds: graceSeconds });
    await new Promise((resolve) => setTimeout(resolve, graceSeconds * 1000));
  }
  while (!stopping) {
    await runChecks();
    if (stopping) break;
    await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
  }
  await pool.end().catch(() => {});
  log("monitor_stopped");
}

process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });

main().catch((error) => {
  log("monitor_fatal", { error: redact(error instanceof Error ? error.message : String(error)) });
  process.exitCode = 1;
});
