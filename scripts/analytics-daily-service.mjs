/**
 * Daily analytics service: runs the draft-only pre-match pipeline and the
 * prediction settlement slice against the self-hosted production database.
 *
 * It is intentionally separate from the SofaScore sync service: analytics reads
 * normalized data only, never calls providers, and only persists draft/audit
 * rows. The first start bootstraps one run of each job so a fresh deployment is
 * observable immediately; later runs follow the Europe/Istanbul schedule.
 */
import { spawn } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const TIME_ZONE = "Europe/Istanbul";
const STATE_DIR = process.env.ANALYTICS_STATE_DIR || "/var/lib/skoriq-analytics";
const STATE_FILE = join(STATE_DIR, "state.json");
const TSX_BIN = join(process.cwd(), "node_modules", ".bin", "tsx");
const POLL_MS = 30_000;

const JOBS = [
  {
    key: "prematch",
    hour: 9,
    minute: 0,
    script: "scripts/pipeline-football-daily-prematch.ts",
    args: ["--all-competitions", "--execute", "--timezone=Europe/Istanbul", "--limit=100", "--max-runtime-seconds=900"],
    timeoutSeconds: 1_200
  },
  {
    key: "settlement",
    hour: 9,
    minute: 30,
    script: "scripts/analytics-football-predictions-settle.ts",
    args: ["--all-competitions", "--lookback-hours=96", "--execute"],
    timeoutSeconds: 900
  },
  {
    key: "model-shadow",
    hour: 9,
    minute: 45,
    script: "scripts/football-model-shadow.ts",
    args: ["--window-hours=72", "--min-training=200"],
    timeoutSeconds: 900
  }
];

const INTERVAL_JOBS = [
  {
    key: "settlement",
    intervalMinutes: 15,
    script: "scripts/analytics-football-predictions-settle.ts",
    args: ["--all-competitions", "--lookback-hours=48", "--execute"],
    timeoutSeconds: 300
  }
];

let stopping = false;
let currentChild;

function log(event, extra = {}) {
  console.log(JSON.stringify({ event, at: new Date().toISOString(), timeZone: TIME_ZONE, ...extra }));
}

function localParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    hour: Number(values.hour),
    minute: Number(values.minute)
  };
}

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function loadState() {
  try {
    const document = JSON.parse(await readFile(STATE_FILE, "utf8"));
    return document && typeof document === "object" ? document : {};
  } catch {
    return {};
  }
}

async function saveState(state) {
  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, "utf8");
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

function runSyncLog(job, phase, payload) {
  return new Promise((resolve) => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      resolve();
      return;
    }
    const args = [
      "scripts/sync-run-log.ts",
      "--job", job.key,
      "--phase", phase,
      "--status", payload.status,
      "--mode", "execute",
      "--summary", JSON.stringify(payload.summary ?? {})
    ];
    if (payload.error) args.push("--error", redact(payload.error).slice(0, 500));
    const child = spawn(process.execPath, args, { cwd: process.cwd(), env: process.env, stdio: "ignore" });
    child.on("close", resolve);
    child.on("error", resolve);
  });
}

function spawnJob(job) {
  return new Promise((resolve) => {
    const child = spawn(TSX_BIN, [job.script, ...job.args], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    currentChild = child;
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout = (stdout + chunk.toString()).slice(-200_000);
    });
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-50_000);
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, (job.timeoutSeconds ?? 1_200) * 1_000);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      currentChild = undefined;
      resolve({ code, signal, stdout, stderr });
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      currentChild = undefined;
      resolve({ code: -1, signal: null, stdout, stderr: `${stderr}${error.message}` });
    });
  });
}

async function runJob(job) {
  log("job_started", { job: job.key });
  await runSyncLog(job, "begin", { status: "running", summary: { event: "run_started" } });
  const startedAt = Date.now();
  const result = await spawnJob(job);
  const report = parseLastJson(result.stdout);
  const succeeded = result.code === 0 && report !== null;
  const status = succeeded ? "succeeded" : "failed";
  const error = succeeded ? undefined : redact(result.stderr).slice(-500) || `exit ${result.code}`;
  await runSyncLog(job, "final", {
    status,
    summary: report ?? {
      event: "job_failed",
      exitCode: result.code,
      signal: result.signal,
      stdoutTail: redact(result.stdout).slice(-800),
      stderrTail: redact(result.stderr).slice(-800)
    },
    error
  });
  log("job_finished", { job: job.key, status, durationMs: Date.now() - startedAt, exitCode: result.code });
  return { status, report };
}

async function runDueJob(job, state, now) {
  if (state[job.key] === now.date) return;
  if (now.hour < job.hour || (now.hour === job.hour && now.minute < job.minute)) return;
  await runJob(job);
  state[job.key] = now.date;
  await saveState(state);
}

async function bootstrap(state) {
  // A fresh volume should prove the pipeline immediately instead of waiting
  // until 09:00 on the next calendar day.
  for (const job of [...JOBS].reverse()) {
    await runJob(job);
    state[job.key] = localParts().date;
    await saveState(state);
  }
}

async function main() {
  log("service_started", { stateDir: STATE_DIR, jobs: JOBS.map((job) => job.key), intervalJobs: INTERVAL_JOBS.map((job) => job.key) });
  const state = await loadState();
  const freshVolume = !(await fileExists(STATE_FILE));
  if (freshVolume) {
    log("bootstrap_started");
    await bootstrap(state);
    log("bootstrap_finished", { state });
  }
  const intervalLast = new Map();
  for (const job of INTERVAL_JOBS) {
    if (stopping) break;
    await runJob(job);
    intervalLast.set(job.key, Date.now());
  }
  while (!stopping) {
    const now = localParts();
    for (const job of JOBS) {
      if (stopping) break;
      await runDueJob(job, state, now);
    }
    for (const job of INTERVAL_JOBS) {
      if (stopping) break;
      const last = intervalLast.get(job.key) ?? 0;
      if (Date.now() - last >= job.intervalMinutes * 60_000) {
        await runJob(job);
        intervalLast.set(job.key, Date.now());
      }
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
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
