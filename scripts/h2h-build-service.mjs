/**
 * One-shot H2H materialization for upcoming matches.
 *
 * The daily prematch pipeline also builds H2H per match; this service lets a
 * deployment verify and populate the new historical depth immediately without
 * waiting for the 09:00 schedule.
 */
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
const STATE_DIR = process.env.H2H_STATE_DIR || "/var/lib/skoriq-h2h";
const COMPLETED_PATH = join(STATE_DIR, "completed.json");
const MATCH_LIMIT = Math.max(1, Math.min(200, Number(process.env.H2H_MATCH_LIMIT || 100)));
const WINDOW_SIZES = process.env.H2H_WINDOW_SIZES || "5,10";
const FORCE = process.env.H2H_FORCE === "1";
const TSX_BIN = join(process.cwd(), "node_modules", ".bin", "tsx");
const BUILD_SCRIPT = join(process.cwd(), "scripts", "analytics-football-h2h-build.ts");
const LOG_SCRIPT = join(process.cwd(), "scripts", "sync-run-log.ts");

let pool;

function log(event, extra = {}) {
  console.log(JSON.stringify({ event, at: new Date().toISOString(), ...extra }));
}

function redact(text) {
  return String(text ?? "").replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "DATABASE_URL=<redacted>");
}

function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: process.cwd(), env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout = (stdout + chunk.toString()).slice(-100_000); });
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk.toString()).slice(-40_000); });
    child.on("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
    child.on("error", (error) => resolve({ code: -1, signal: null, stdout, stderr: `${stderr}${error.message}` }));
  });
}

function syncLog(phase, payload) {
  return new Promise((resolve) => {
    if (!DATABASE_URL) return resolve();
    const args = [
      LOG_SCRIPT, "--job", "h2h-build", "--phase", phase,
      "--status", payload.status, "--mode", "execute", "--summary", JSON.stringify(payload.summary ?? {})
    ];
    if (payload.error) args.push("--error", redact(payload.error).slice(0, 500));
    const child = spawn(process.execPath, args, { cwd: process.cwd(), env: process.env, stdio: "ignore" });
    child.on("close", resolve);
    child.on("error", resolve);
  });
}

async function featureStats() {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS features,
       COUNT(*) FILTER (WHERE sample_size > 0)::int AS with_history,
       COALESCE(MAX(sample_size), 0)::int AS max_sample
     FROM football_head_to_head_features`
  );
  return result.rows[0] ?? { features: 0, with_history: 0, max_sample: 0 };
}

async function main() {
  if (!DATABASE_URL) {
    log("missing_database_url");
    process.exitCode = 1;
    return;
  }
  await mkdir(STATE_DIR, { recursive: true });
  if (!FORCE) {
    try {
      const completed = JSON.parse(await readFile(COMPLETED_PATH, "utf8"));
      log("already_completed", { completedAt: completed.completedAt, built: completed.built });
      return;
    } catch {
      // No completed marker; build now.
    }
  }
  pool = new pg.Pool({
    connectionString: DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 5_000,
    query_timeout: 20_000,
    statement_timeout: 20_000
  });
  pool.on("error", () => {});
  try {
    const matches = (await pool.query(
      `SELECT m.id::text AS id
       FROM matches m
       INNER JOIN sports s ON s.id = m.sport_id AND s.slug = 'football'
       WHERE m.status IN ('scheduled', 'not_started')
         AND m.scheduled_start_at BETWEEN now() AND now() + interval '14 days'
       ORDER BY m.scheduled_start_at ASC
       LIMIT $1`,
      [MATCH_LIMIT]
    )).rows;
    log("matches_selected", { count: matches.length, windowSizes: WINDOW_SIZES });
    await syncLog("begin", { status: "running", summary: { selected: matches.length, windowSizes: WINDOW_SIZES } });

    let built = 0;
    const failures = [];
    for (const match of matches) {
      const result = await run(TSX_BIN, [
        BUILD_SCRIPT, `--match-id=${match.id}`, `--window-sizes=${WINDOW_SIZES}`, "--execute"
      ]);
      if (result.code === 0) built += 1;
      else failures.push({ matchId: match.id, error: redact(result.stderr).slice(-300) });
    }
    const stats = await featureStats();
    const completed = {
      completedAt: new Date().toISOString(),
      selected: matches.length,
      built,
      failed: failures.length,
      stats
    };
    await writeFile(COMPLETED_PATH, JSON.stringify(completed, null, 2), "utf8");
    const status = built > 0 || matches.length === 0 ? "succeeded" : "failed";
    await syncLog("final", {
      status,
      summary: { selected: matches.length, built, failed: failures.length, stats, failures: failures.slice(0, 5) },
      error: failures.length ? failures[0].error : undefined
    });
    log("h2h_build_finished", { ...completed, status });
    if (status === "failed") process.exitCode = 1;
  } finally {
    await pool.end().catch(() => {});
  }
}

main().catch(async (error) => {
  const message = redact(error instanceof Error ? error.message : String(error));
  log("h2h_build_fatal", { error: message });
  await syncLog("final", { status: "failed", summary: { stage: "fatal" }, error: message });
  process.exitCode = 1;
});
