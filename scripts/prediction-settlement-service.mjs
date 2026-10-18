/**
 * Frequent prediction settlement.
 *
 * Finished scores arrive every ~15 minutes, but the daily 09:30 settlement job
 * leaves predictions pending for up to a day. This loop settles finished
 * matches continuously without publishing or changing member visibility.
 */
import { spawn } from "node:child_process";
import { join } from "node:path";

const INTERVAL_MS = Math.max(60, Number(process.env.PREDICTION_SETTLEMENT_INTERVAL_MINUTES || 15)) * 60_000;
const LOOKBACK_HOURS = Math.max(6, Number(process.env.PREDICTION_SETTLEMENT_LOOKBACK_HOURS || 48));
const TSX_BIN = join(process.cwd(), "node_modules", ".bin", "tsx");
const SETTLEMENT_SCRIPT = join(process.cwd(), "scripts", "analytics-football-predictions-settle.ts");
let stopping = false;
let currentChild;

function log(event, extra = {}) {
  console.log(JSON.stringify({ event, at: new Date().toISOString(), ...extra }));
}

function redact(text) {
  return String(text ?? "").replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "DATABASE_URL=<redacted>");
}

function runSettlement() {
  return new Promise((resolve) => {
    const child = spawn(TSX_BIN, [SETTLEMENT_SCRIPT, "--all-competitions", `--lookback-hours=${LOOKBACK_HOURS}`, "--execute"], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    currentChild = child;
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout = (stdout + chunk.toString()).slice(-300_000); });
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk.toString()).slice(-80_000); });
    child.on("close", (code) => {
      currentChild = undefined;
      resolve({ code, stdout, stderr });
    });
    child.on("error", (error) => {
      currentChild = undefined;
      resolve({ code: -1, stdout, stderr: error.message });
    });
  });
}

function summarize(stdout) {
  const lines = String(stdout ?? "").trim().split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index].trim();
    if (!line.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // Keep looking for the last JSON summary.
    }
  }
  return null;
}

async function main() {
  log("service_started", { intervalMinutes: INTERVAL_MS / 60_000, lookbackHours: LOOKBACK_HOURS });
  while (!stopping) {
    const startedAt = Date.now();
    const result = await runSettlement();
    const summary = summarize(result.stdout);
    if (result.code === 0) {
      log("settlement_completed", {
        durationMs: Date.now() - startedAt,
        summary: summary ? {
          settled: summary.settled ?? summary.settledCount ?? null,
          candidates: summary.candidates ?? summary.candidateCount ?? null,
          skipped: summary.skipped ?? null
        } : null
      });
    } else {
      log("settlement_failed", { code: result.code, error: redact(result.stderr).slice(-500) });
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
