/**
 * One-shot previous-season backfill for H2H and historical match depth.
 *
 * Fetches the previous two seasons for every catalog league, then imports the
 * capture through the existing SofaScore matches importer. The importer creates
 * missing historical seasons with season_kind=historical, so current-season
 * matches are never mixed into a prior year.
 */
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const DATABASE_URL = process.env.DATABASE_URL;
const STATE_DIR = process.env.HISTORICAL_STATE_DIR || "/var/lib/skoriq-historical";
const COMPLETED_PATH = join(STATE_DIR, "completed.json");
const SEASONS = Math.max(1, Math.min(5, Number(process.env.HISTORICAL_SEASONS || 2)));
const PAGES = Math.max(1, Math.min(15, Number(process.env.HISTORICAL_PAGES || 2)));
const ROUNDS = Math.max(0, Math.min(60, Number(process.env.HISTORICAL_ROUNDS || 0)));
const TOURNAMENT_ID = process.env.HISTORICAL_TOURNAMENT_ID?.trim();
const FORCE = process.env.HISTORICAL_FORCE === "1";
const PYTHON_BIN = process.env.PYTHON_BIN || "python3";
const TSX_BIN = join(process.cwd(), "node_modules", ".bin", "tsx");
const FETCH_SCRIPT = join(process.cwd(), "scripts", "sofascore_fetch_historical_matches.py");
const IMPORT_SCRIPT = join(process.cwd(), "scripts", "provider-sofascore-matches-sync.ts");
const LOG_SCRIPT = join(process.cwd(), "scripts", "sync-run-log.ts");

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
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout = (stdout + chunk.toString()).slice(-500_000); });
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk.toString()).slice(-80_000); });
    child.on("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
    child.on("error", (error) => resolve({ code: -1, signal: null, stdout, stderr: `${stderr}${error.message}` }));
  });
}

function syncLog(phase, payload) {
  return new Promise((resolve) => {
    if (!DATABASE_URL) return resolve();
    const args = [
      LOG_SCRIPT, "--job", "historical-backfill", "--phase", phase,
      "--status", payload.status, "--mode", "execute", "--summary", JSON.stringify(payload.summary ?? {})
    ];
    if (payload.error) args.push("--error", redact(payload.error).slice(0, 500));
    const child = spawn(process.execPath, args, { cwd: process.cwd(), env: process.env, stdio: "ignore" });
    child.on("close", resolve);
    child.on("error", resolve);
  });
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
      log("already_completed", { completedAt: completed.completedAt, events: completed.events });
      return;
    } catch {
      // No completed marker; run the backfill.
    }
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputPath = join(STATE_DIR, `historical-${stamp}.json`);
  log("fetch_started", { seasons: SEASONS, pages: PAGES, rounds: ROUNDS, tournamentId: TOURNAMENT_ID ?? null });
  await syncLog("begin", { status: "running", summary: { seasons: SEASONS, pages: PAGES, rounds: ROUNDS, tournamentId: TOURNAMENT_ID ?? null } });

  const fetchArgs = [
    FETCH_SCRIPT, "--output", outputPath, "--seasons", String(SEASONS), "--pages", String(PAGES), "--rounds", String(ROUNDS)
  ];
  if (TOURNAMENT_ID) fetchArgs.push("--tournament-id", TOURNAMENT_ID);
  const fetch = await run(PYTHON_BIN, fetchArgs);
  const fetchSummary = parseLastJson(fetch.stdout);
  if (fetch.code !== 0 || !fetchSummary?.events) {
    const error = redact(fetch.stderr).slice(-700) || `fetch exit ${fetch.code}`;
    log("fetch_failed", { error: error.slice(0, 300), fetchSummary });
    await syncLog("final", { status: "failed", summary: { stage: "fetch", fetchSummary }, error });
    process.exitCode = 1;
    return;
  }
  log("fetch_finished", { events: fetchSummary.events, seasons: fetchSummary.seasons, leagues: fetchSummary.leagues });

  const importResult = await run(TSX_BIN, [
    IMPORT_SCRIPT, "--capture", outputPath, "--execute", "--no-log-run"
  ]);
  const report = parseLastJson(importResult.stdout);
  const succeeded = importResult.code === 0;
  const counts = report?.counts ?? null;
  const error = succeeded ? undefined : redact(importResult.stderr).slice(-700) || `import exit ${importResult.code}`;
  if (succeeded) {
    await writeFile(COMPLETED_PATH, JSON.stringify({
      completedAt: new Date().toISOString(),
      seasons: SEASONS,
      pages: PAGES,
      rounds: ROUNDS,
      events: fetchSummary.events,
      counts
    }, null, 2), "utf8");
  }
  await syncLog("final", {
    status: succeeded ? "succeeded" : "failed",
    summary: {
      events: fetchSummary.events,
      leagues: fetchSummary.leagues,
      seasons: fetchSummary.seasons,
      importCounts: counts,
      capturedAt: fetchSummary.capturedAt ?? null
    },
    error
  });
  log("backfill_finished", { succeeded, events: fetchSummary.events, counts });
  if (!succeeded) process.exitCode = 1;
}

main().catch(async (error) => {
  const message = redact(error instanceof Error ? error.message : String(error));
  log("backfill_fatal", { error: message });
  await syncLog("final", { status: "failed", summary: { stage: "fatal" }, error: message });
  process.exitCode = 1;
});
