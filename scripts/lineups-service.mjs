/**
 * Backfill missing SofaScore confirmed lineups for finished matches.
 *
 * The service selects finished matches without any football_match_lineups row,
 * fetches `/event/{id}/lineups` through curl_cffi with chrome impersonation, and
 * imports formations, players, positions, shirt numbers, and ratings.
 */
import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
const INTERVAL_MS = Math.max(5, Number(process.env.LINEUPS_INTERVAL_MINUTES || 30)) * 60_000;
const BATCH_LIMIT = Math.max(1, Math.min(100, Number(process.env.LINEUPS_BATCH_LIMIT || 80)));
const LOOKBACK_DAYS = Math.max(1, Math.min(365, Number(process.env.LINEUPS_LOOKBACK_DAYS || 120)));
const STATE_DIR = process.env.LINEUPS_STATE_DIR || "/var/lib/skoriq-lineups";
const FAILURES_PATH = join(STATE_DIR, "failures.json");
const FAILURE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PYTHON_BIN = process.env.PYTHON_BIN || "python3";
const TSX_BIN = join(process.cwd(), "node_modules", ".bin", "tsx");
const FETCH_SCRIPT = join(process.cwd(), "scripts", "sofascore_fetch_lineups.py");
const IMPORT_SCRIPT = join(process.cwd(), "scripts", "provider-sofascore-lineups-sync.ts");
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
      LOG_SCRIPT, "--job", "lineups", "--phase", phase,
      "--status", payload.status, "--mode", "execute", "--summary", JSON.stringify(payload.summary ?? {})
    ];
    if (payload.error) args.push("--error", redact(payload.error).slice(0, 500));
    const child = spawn(process.execPath, args, { cwd: process.cwd(), env: process.env, stdio: "ignore" });
    child.on("close", resolve);
    child.on("error", resolve);
  });
}

async function selectMissingLineups(limit = BATCH_LIMIT) {
  if (!pool) return [];
  const result = await pool.query(
    `
      SELECT m.id AS match_id,
        m.metadata_json->>'sofascoreId' AS event_id,
        hpm.provider_entity_id AS home_team_id,
        apm.provider_entity_id AS away_team_id
      FROM matches m
      INNER JOIN sports s ON s.id = m.sport_id AND s.slug = 'football'
      INNER JOIN provider_mappings hpm
        ON hpm.provider = 'sofascore' AND hpm.entity_type = 'team' AND hpm.internal_entity_id = m.home_team_id
      INNER JOIN provider_mappings apm
        ON apm.provider = 'sofascore' AND apm.entity_type = 'team' AND apm.internal_entity_id = m.away_team_id
      WHERE m.status IN ('finished', 'after_extra_time', 'after_penalties')
        AND m.metadata_json->>'sofascoreId' IS NOT NULL
        AND m.scheduled_start_at >= now() - ($1::int * interval '1 day')
        AND NOT EXISTS (SELECT 1 FROM football_match_lineups l WHERE l.match_id = m.id)
      ORDER BY m.scheduled_start_at DESC
      LIMIT $2
    `,
    [LOOKBACK_DAYS, limit]
  );
  return result.rows;
}

async function loadFailures() {
  try {
    const document = JSON.parse(await readFile(FAILURES_PATH, "utf8"));
    if (!document || typeof document !== "object" || Array.isArray(document)) return {};
    const cutoff = Date.now() - FAILURE_TTL_MS;
    return Object.fromEntries(Object.entries(document).filter(([eventId, timestamp]) =>
      /^[1-9]\d*$/.test(eventId) && typeof timestamp === "string" && Date.parse(timestamp) >= cutoff
    ));
  } catch {
    return {};
  }
}

async function saveFailures(failures) {
  await mkdir(STATE_DIR, { recursive: true });
  const temporary = `${FAILURES_PATH}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(failures, null, 2), "utf8");
  await rename(temporary, FAILURES_PATH);
}

function isPermanentFailure(reason) {
  const text = String(reason ?? "");
  return text.startsWith("http_404") || ["empty_lineups", "partial_response", "non_json"].includes(text);
}

function recordPermanentFailures(failures, fetchSummary, importReport) {
  const timestamp = new Date().toISOString();
  for (const failure of fetchSummary?.failures ?? []) {
    if (isPermanentFailure(failure?.reason)) failures[String(failure.eventId)] = timestamp;
  }
  for (const entry of importReport?.entries ?? []) {
    if (["unknown_match", "team_mismatch", "missing_sport"].includes(entry?.status)) {
      failures[String(entry.eventId)] = timestamp;
    }
  }
}

async function pruneCaptures() {
  try {
    const entries = await readdir(STATE_DIR, { withFileTypes: true });
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    for (const entry of entries) {
      if (!entry.isFile() || (!entry.name.startsWith("lineups-") && !entry.name.startsWith("input-"))) continue;
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
  const failures = await loadFailures();
  const rows = await selectMissingLineups(BATCH_LIMIT * 10);
  const candidates = rows.filter((row) => !failures[String(row.event_id)]);
  const selected = candidates.slice(0, BATCH_LIMIT);
  if (selected.length === 0) {
    const skippedFailed = rows.length - candidates.length;
    log("no_missing_lineups", { lookbackDays: LOOKBACK_DAYS, skippedFailed });
    await runSyncLog("final", {
      status: "succeeded",
      summary: { selected: 0, skippedFailed, lookbackDays: LOOKBACK_DAYS, message: "no_missing_lineups" }
    });
    return { status: "skipped" };
  }
  const matches = selected
    .map((row) => ({
      eventId: Number(row.event_id),
      homeTeamId: Number(row.home_team_id),
      awayTeamId: Number(row.away_team_id)
    }))
    .filter((match) => Number.isSafeInteger(match.eventId) && match.eventId > 0 && Number.isSafeInteger(match.homeTeamId) && Number.isSafeInteger(match.awayTeamId));
  if (matches.length === 0) {
    log("invalid_missing_lineups", { selected: selected.length });
    await runSyncLog("final", { status: "succeeded", summary: { selected: 0, invalid: selected.length } });
    return { status: "skipped" };
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await mkdir(STATE_DIR, { recursive: true });
  const inputPath = join(STATE_DIR, `input-${stamp}.json`);
  const outputPath = join(STATE_DIR, `lineups-${stamp}.json`);
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
    recordPermanentFailures(failures, fetchSummary, null);
    await saveFailures(failures);
    await runSyncLog("final", {
      status: "failed",
      summary: { selected: matches.length, fetchSummary, rememberedFailures: Object.keys(failures).length },
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
  for (const entry of importReport?.entries ?? []) {
    if (entry?.status === "updated") delete failures[String(entry.eventId)];
  }
  recordPermanentFailures(failures, fetchSummary, importReport);
  await saveFailures(failures);
  await runSyncLog("final", {
    status,
    summary: {
      selected: matches.length,
      fetched: fetchSummary?.succeeded ?? null,
      fetchFailed: fetchSummary?.failed ?? null,
      writtenMatches: importReport?.writtenMatches ?? null,
      playersInserted: importReport?.playersInserted ?? null,
      importCounts: importReport?.counts ?? null,
      rememberedFailures: Object.keys(failures).length,
      durationMs: Date.now() - startedAt
    },
    error
  });
  log("run_finished", {
    status,
    selected: matches.length,
    fetched: fetchSummary?.succeeded ?? null,
    writtenMatches: importReport?.writtenMatches ?? null,
    playersInserted: importReport?.playersInserted ?? null,
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
      const message = redact(error instanceof Error ? error.message : String(error)).slice(0, 300);
      log("run_error", { error: message });
      await runSyncLog("final", { status: "failed", summary: { stage: "run_once" }, error: message });
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
