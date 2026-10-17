/**
 * Backfill missing SofaScore full-time team statistics for finished matches.
 *
 * The service selects finished matches that have no telemetry rows, writes a
 * small match list, fetches `/event/{id}/statistics` through curl_cffi with the
 * same chrome impersonation as the other SofaScore slices, and imports the
 * capture into football_match_team_statistics.
 */
import { spawn } from "node:child_process";
import { mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
const INTERVAL_MS = Math.max(5, Number(process.env.MATCH_STATISTICS_INTERVAL_MINUTES || 60)) * 60_000;
const BATCH_LIMIT = Math.max(1, Math.min(100, Number(process.env.MATCH_STATISTICS_BATCH_LIMIT || 40)));
const LOOKBACK_DAYS = Math.max(1, Math.min(365, Number(process.env.MATCH_STATISTICS_LOOKBACK_DAYS || 120)));
const STATE_DIR = process.env.MATCH_STATISTICS_STATE_DIR || "/var/lib/skoriq-match-statistics";
const PYTHON_BIN = process.env.PYTHON_BIN || "python3";
const TSX_BIN = join(process.cwd(), "node_modules", ".bin", "tsx");
const FETCH_SCRIPT = join(process.cwd(), "scripts", "sofascore_fetch_match_statistics.py");
const IMPORT_SCRIPT = join(process.cwd(), "scripts", "provider-sofascore-match-statistics-sync.ts");
const LOG_SCRIPT = join(process.cwd(), "scripts", "sync-run-log.ts");

let stopping = false;
let currentChild;
let pool;

function log(event, extra = {}) {
  console.log(JSON.stringify({ event, at: new Date().toISOString(), ...extra }));
}

function redact(text) {
  return String(text ?? "").replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "DATABASE_URL=<redacted>");
}

function parseLastJson(text) {
  const lines = String(text ?? "").split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index].trim();
    if (!line.startsWith("{")) continue;
    for (const candidate of [line, lines.slice(index).join("\n").trim()]) {
      try {
        const document = JSON.parse(candidate);
        if (document && typeof document === "object") return document;
      } catch {
        // Keep looking for the last complete JSON document.
      }
    }
  }
  return null;
}

function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: process.cwd(), env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    currentChild = child;
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout = (stdout + chunk.toString()).slice(-200_000); });
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk.toString()).slice(-50_000); });
    child.on("close", (code, signal) => {
      currentChild = undefined;
      resolve({ code, signal, stdout, stderr });
    });
    child.on("error", (error) => {
      currentChild = undefined;
      resolve({ code: -1, signal: null, stdout, stderr: `${stderr}${error.message}` });
    });
  });
}

function runSyncLog(phase, payload) {
  return new Promise((resolve) => {
    if (!DATABASE_URL) return resolve();
    const args = [
      LOG_SCRIPT, "--job", "match-statistics", "--phase", phase,
      "--status", payload.status, "--mode", "execute", "--summary", JSON.stringify(payload.summary ?? {})
    ];
    if (payload.error) args.push("--error", redact(payload.error).slice(0, 500));
    const child = spawn(process.execPath, args, { cwd: process.cwd(), env: process.env, stdio: "ignore" });
    child.on("close", resolve);
    child.on("error", resolve);
  });
}

async function selectMissingMatches() {
  if (!pool) return [];
  const result = await pool.query(
    `
      SELECT m.id AS match_id,
        epm.provider_entity_id AS event_id,
        hpm.provider_entity_id AS home_team_id,
        apm.provider_entity_id AS away_team_id
      FROM matches m
      INNER JOIN sports s ON s.id = m.sport_id AND s.slug = 'football'
      INNER JOIN provider_mappings epm
        ON epm.provider = 'sofascore' AND epm.entity_type = 'match' AND epm.internal_entity_id = m.id
      INNER JOIN provider_mappings hpm
        ON hpm.provider = 'sofascore' AND hpm.entity_type = 'team' AND hpm.internal_entity_id = m.home_team_id
      INNER JOIN provider_mappings apm
        ON apm.provider = 'sofascore' AND apm.entity_type = 'team' AND apm.internal_entity_id = m.away_team_id
      LEFT JOIN football_match_team_statistics ms ON ms.match_id = m.id
      WHERE m.status IN ('finished', 'after_extra_time', 'after_penalties')
        AND ms.id IS NULL
        AND m.scheduled_start_at >= now() - ($1::int * interval '1 day')
      ORDER BY m.scheduled_start_at DESC
      LIMIT $2
    `,
    [LOOKBACK_DAYS, BATCH_LIMIT]
  );
  return result.rows;
}

async function pruneCaptures() {
  try {
    const entries = await readdir(STATE_DIR, { withFileTypes: true });
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    for (const entry of entries) {
      if (!entry.isFile() || (!entry.name.startsWith("match-statistics-") && !entry.name.startsWith("input-"))) continue;
      const path = join(STATE_DIR, entry.name);
      const info = await stat(path);
      if (info.mtimeMs < cutoff) await unlink(path);
    }
  } catch {
    // Best effort; captures are regenerated.
  }
}

async function runOnce() {
  const startedAt = Date.now();
  const rows = await selectMissingMatches();
  if (rows.length === 0) {
    log("no_missing_matches", { lookbackDays: LOOKBACK_DAYS });
    return { status: "skipped" };
  }
  const matches = rows
    .map((row) => ({
      eventId: Number(row.event_id),
      homeTeamId: Number(row.home_team_id),
      awayTeamId: Number(row.away_team_id)
    }))
    .filter((match) => Number.isSafeInteger(match.eventId) && match.eventId > 0 && Number.isSafeInteger(match.homeTeamId) && Number.isSafeInteger(match.awayTeamId));
  if (matches.length === 0) {
    log("invalid_missing_matches", { selected: rows.length });
    return { status: "skipped" };
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await mkdir(STATE_DIR, { recursive: true });
  const inputPath = join(STATE_DIR, `input-${stamp}.json`);
  const outputPath = join(STATE_DIR, `match-statistics-${stamp}.json`);
  await writeFile(inputPath, JSON.stringify({ matches }, null, 2), "utf8");
  log("run_started", { selected: matches.length, batchLimit: BATCH_LIMIT });
  await runSyncLog("begin", { status: "running", summary: { selected: matches.length, lookbackDays: LOOKBACK_DAYS } });

  const fetch = await run(PYTHON_BIN, [
    FETCH_SCRIPT, "--input", inputPath, "--output", outputPath, "--limit", String(matches.length)
  ]);
  const fetchSummary = parseLastJson(fetch.stdout);
  const captured = Boolean(fetchSummary?.succeeded) && fetch.code === 0;
  if (!captured) {
    const error = redact(fetch.stderr).slice(-500) || `fetch exit ${fetch.code}`;
    log("fetch_failed", { error: error.slice(0, 200) });
    await runSyncLog("final", {
      status: "failed",
      summary: { selected: matches.length, fetchSummary },
      error
    });
    return { status: "failed" };
  }

  const importResult = await run(TSX_BIN, [
    IMPORT_SCRIPT, "--capture", outputPath, "--execute", "--no-log-run"
  ]);
  const importReport = parseLastJson(importResult.stdout);
  const succeeded = importResult.code === 0 && importReport !== null;
  const status = succeeded ? "succeeded" : "failed";
  const error = succeeded ? undefined : redact(importResult.stderr).slice(-500) || `import exit ${importResult.code}`;
  await runSyncLog("final", {
    status,
    summary: {
      selected: matches.length,
      fetched: fetchSummary?.succeeded ?? null,
      fetchFailed: fetchSummary?.failed ?? null,
      writtenMatches: importReport?.writtenMatches ?? null,
      importCounts: importReport?.counts ?? null,
      durationMs: Date.now() - startedAt
    },
    error
  });
  log("run_finished", {
    status,
    selected: matches.length,
    fetched: fetchSummary?.succeeded ?? null,
    writtenMatches: importReport?.writtenMatches ?? null,
    durationMs: Date.now() - startedAt
  });
  return { status };
}

async function main() {
  if (!DATABASE_URL) {
    log("missing_database_url");
    process.exitCode = 1;
    return;
  }
  pool = new pg.Pool({
    connectionString: DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 5_000,
    query_timeout: 15_000,
    statement_timeout: 15_000
  });
  pool.on("error", () => {});
  log("service_started", { intervalMinutes: INTERVAL_MS / 60_000, batchLimit: BATCH_LIMIT, lookbackDays: LOOKBACK_DAYS });
  while (!stopping) {
    try {
      await runOnce();
      await pruneCaptures();
    } catch (error) {
      log("run_error", { error: redact(error instanceof Error ? error.message : String(error)).slice(0, 300) });
    }
    if (stopping) break;
    await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
  }
  await pool.end().catch(() => {});
  log("service_stopped");
}

process.on("SIGTERM", () => {
  stopping = true;
  currentChild?.kill("SIGTERM");
});
process.on("SIGINT", () => {
  stopping = true;
  currentChild?.kill("SIGTERM");
});

main().catch((error) => {
  log("service_fatal", { error: redact(error instanceof Error ? error.message : String(error)) });
  process.exitCode = 1;
});
