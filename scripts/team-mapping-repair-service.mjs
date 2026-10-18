/**
 * Runs the SofaScore team identity repair on a daily cadence.
 *
 * The catalog changes as clubs are promoted/relegated and new competitions are
 * added. A single one-shot repair is not enough; this loop keeps the mapping
 * aligned without blocking the sync service.
 */
import { spawn } from "node:child_process";
import { join } from "node:path";

const INTERVAL_MS = Math.max(60, Number(process.env.TEAM_MAPPING_REPAIR_INTERVAL_MINUTES || 1440)) * 60_000;
const TSX_BIN = join(process.cwd(), "node_modules", ".bin", "tsx");
const SCRIPT = join(process.cwd(), "scripts", "repair-sofascore-team-mappings.ts");
let stopping = false;
let currentChild;

function log(event, extra = {}) {
  console.log(JSON.stringify({ event, at: new Date().toISOString(), ...extra }));
}

function redact(text) {
  return String(text ?? "").replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "DATABASE_URL=<redacted>");
}

function run() {
  return new Promise((resolve) => {
    const child = spawn(TSX_BIN, [SCRIPT, "--execute"], { cwd: process.cwd(), env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    currentChild = child;
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout = (stdout + chunk.toString()).slice(-200_000); });
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk.toString()).slice(-50_000); });
    child.on("close", (code) => {
      currentChild = undefined;
      const lines = stdout.trim().split(/\r?\n/);
      let report = null;
      for (let index = lines.length - 1; index >= 0; index--) {
        if (!lines[index].trim().startsWith("{")) continue;
        try { report = JSON.parse(lines.slice(index).join("\n")); break; } catch { /* keep looking */ }
      }
      resolve({ code, report, stderr });
    });
    child.on("error", (error) => {
      currentChild = undefined;
      resolve({ code: -1, report: null, stderr: error.message });
    });
  });
}

async function main() {
  log("service_started", { intervalMinutes: INTERVAL_MS / 60_000 });
  while (!stopping) {
    const startedAt = Date.now();
    const result = await run();
    const report = result.report;
    if (result.code === 0 && report) {
      log("repair_completed", {
        teams: report.teams,
        matchedById: report.matchedById,
        matchedByName: report.matchedByName,
        created: report.created,
        ambiguous: report.ambiguous,
        mappingsUpserted: report.mappingsUpserted,
        durationMs: Date.now() - startedAt
      });
    } else {
      log("repair_failed", { code: result.code, error: redact(result.stderr).slice(-400) });
    }
    if (stopping) break;
    await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
  }
  log("service_stopped");
}

process.on("SIGTERM", () => { stopping = true; currentChild?.kill("SIGTERM"); });
process.on("SIGINT", () => { stopping = true; currentChild?.kill("SIGTERM"); });

main().catch((error) => {
  log("service_fatal", { error: redact(error instanceof Error ? error.message : String(error)) });
  process.exitCode = 1;
});
