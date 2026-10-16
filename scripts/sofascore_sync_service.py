"""Run the SkorIQ SofaScore refresh jobs on a fixed cadence inside the deployment."""

import argparse
import json
import os
import shutil
import signal
import subprocess
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_JOB_TIMEOUT_SECONDS = 900
DEFAULT_CAPTURE_RETENTION_DAYS = 7
DEFAULT_POLL_SECONDS = 60

Runner = Callable[..., "subprocess.CompletedProcess[str]"]


@dataclass(frozen=True)
class Job:
    name: str
    interval_minutes: int
    fetch_script: Path
    import_script: Path


def build_jobs(env: dict[str, str]) -> list[Job]:
    interval = int(env.get("SYNC_FINISHED_INTERVAL_MINUTES", "180"))
    return [Job(
        name="finished-matches",
        interval_minutes=max(15, interval),
        fetch_script=ROOT / "scripts" / "sofascore_fetch_recent_matches.py",
        import_script=ROOT / "scripts" / "provider-sofascore-matches-sync.ts",
    )]


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def parse_instant(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return None
    return parsed.astimezone(timezone.utc)


def state_file(state_dir: Path) -> Path:
    return state_dir / "state.json"


def load_state(state_dir: Path) -> dict[str, Any]:
    path = state_file(state_dir)
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return document if isinstance(document, dict) else {}


def save_state(state_dir: Path, state: dict[str, Any]) -> None:
    state_dir.mkdir(parents=True, exist_ok=True)
    temporary = state_dir / f".state-{os.getpid()}.tmp"
    temporary.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, state_file(state_dir))


def due_jobs(jobs: list[Job], state: dict[str, Any], now: datetime) -> list[Job]:
    due: list[Job] = []
    for job in jobs:
        last = parse_instant(state.get(job.name, {}).get("last_finished_at")) if isinstance(state.get(job.name), dict) else None
        if last is None or now - last >= timedelta(minutes=job.interval_minutes):
            due.append(job)
    return due


def parse_last_json_line(output: str) -> dict[str, Any] | None:
    for line in reversed(output.strip().splitlines()):
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            document = json.loads(line)
        except ValueError:
            continue
        if isinstance(document, dict):
            return document
    return None


def capture_path_for(state_dir: Path, job: Job, now: datetime) -> Path:
    stamp = now.strftime("%Y%m%dT%H%M%SZ")
    return state_dir / "captures" / f"{job.name}-{stamp}-{os.getpid()}.json"


def prune_captures(capture_dir: Path, retention_days: int, now: datetime) -> int:
    if retention_days <= 0 or not capture_dir.is_dir():
        return 0
    removed = 0
    cutoff = now - timedelta(days=retention_days)
    for candidate in capture_dir.iterdir():
        if not candidate.is_file():
            continue
        try:
            modified = datetime.fromtimestamp(candidate.stat().st_mtime, tz=timezone.utc)
        except OSError:
            continue
        if modified < cutoff:
            try:
                candidate.unlink()
                removed += 1
            except OSError:
                continue
    return removed


def run_job(job: Job, env: dict[str, str], state_dir: Path, now: datetime, *, runner: Runner = subprocess.run) -> dict[str, Any]:
    execute = env.get("SYNC_EXECUTE", "0").strip().lower() in {"1", "true", "yes"}
    timeout = int(env.get("SYNC_JOB_TIMEOUT_SECONDS", str(DEFAULT_JOB_TIMEOUT_SECONDS)))
    capture = capture_path_for(state_dir, job, now)
    capture.parent.mkdir(parents=True, exist_ok=True)

    fetch_command = [sys.executable, str(job.fetch_script), "--output", str(capture)]
    catalog = env.get("SYNC_CATALOG")
    if catalog:
        fetch_command += ["--catalog", catalog]
    fetch_result = runner(fetch_command, capture_output=True, text=True, timeout=timeout)
    fetch_summary = parse_last_json_line(fetch_result.stdout or "")
    log_step(job, env, "fetch_completed", {"fetchSummary": fetch_summary, "captureExists": capture.exists()}, runner=runner)

    import_summary: dict[str, Any] | None = None
    import_status = "skipped_no_capture"
    if capture.exists():
        import_command = [node_binary(), str(job.import_script), "--capture", str(capture)]
        if execute:
            import_command.append("--execute")
        import_result = runner(import_command, capture_output=True, text=True, timeout=timeout)
        import_summary = parse_last_json_line(import_result.stdout or "")
        import_status = "executed" if import_result.returncode == 0 and import_summary else "import_failed"

    removed = prune_captures(capture.parent, int(env.get("SYNC_CAPTURE_RETENTION_DAYS", str(DEFAULT_CAPTURE_RETENTION_DAYS))), now)
    summary = {
        "job": job.name,
        "status": classify_run_status(capture.exists(), import_status),
        "mode": "execute" if execute else "dry_run",
        "capture": str(capture) if capture.exists() else None,
        "importStatus": import_status,
        "fetchSummary": fetch_summary,
        "importSummary": import_summary,
        "prunedCaptures": removed,
        "finishedAt": now.isoformat(timespec="seconds").replace("+00:00", "Z"),
    }
    log_run_outcome(job, env, summary, runner=runner)
    return summary


def classify_run_status(capture_exists: bool, import_status: str) -> str:
    if not capture_exists:
        return "fetch_failed"
    if import_status == "import_failed":
        return "import_failed"
    if import_status == "executed":
        return "succeeded"
    return "fetch_failed"


def log_run_outcome(job: Job, env: dict[str, str], summary: dict[str, Any], *, runner: Runner) -> None:
    # Executed runs are recorded by the importer itself; this helper makes fetch
    # and import failures visible in sync_jobs even when no importer ever ran.
    if not env.get("DATABASE_URL") or summary.get("importStatus") == "executed":
        return
    payload = {
        "fetchSummary": summary.get("fetchSummary"),
        "importStatus": summary.get("importStatus"),
        "capture": summary.get("capture"),
    }
    command = [node_binary(), str(ROOT / "scripts" / "sync-run-log.ts"),
               "--job", job.name, "--status", str(summary.get("status", "service_error")),
               "--mode", str(summary.get("mode", "dry_run")),
               "--summary", json.dumps(payload, ensure_ascii=False),
               "--error", str(summary.get("error") or summary.get("status", "service_error"))]
    try:
        runner(command, capture_output=True, text=True,
               timeout=int(env.get("SYNC_JOB_TIMEOUT_SECONDS", str(DEFAULT_JOB_TIMEOUT_SECONDS))))
    except Exception:
        # Logging is best effort; the refresh loop must keep running.
        return


def node_binary() -> str:
    # Node runs the TypeScript entry points natively (type stripping); tsx is not required.
    return shutil.which("node") or "node"


def log_step(job: Job, env: dict[str, str], step: str, payload: dict[str, Any], *, runner: Runner) -> None:
    # Step markers make a slow fetch or importer visible while it is still running.
    if not env.get("DATABASE_URL"):
        return
    command = [node_binary(), str(ROOT / "scripts" / "sync-run-log.ts"), "--job", job.name,
               "--status", "running",
               "--mode", "execute" if env.get("SYNC_EXECUTE", "0").strip().lower() in {"1", "true", "yes"} else "dry_run",
               "--summary", json.dumps(payload, ensure_ascii=False), "--message", step]
    try:
        runner(command, capture_output=True, text=True, timeout=60)
    except Exception:
        return


def send_heartbeat(env: dict[str, str], *, runner: Runner = subprocess.run) -> None:
    # A single start marker makes a dead service or a broken node chain visible
    # in sync telemetry instead of silence.
    if not env.get("DATABASE_URL"):
        return
    command = [node_binary(), str(ROOT / "scripts" / "sync-run-log.ts"), "--job", "finished-matches",
               "--status", "running", "--mode", "execute" if env.get("SYNC_EXECUTE", "0").strip().lower() in {"1", "true", "yes"} else "dry_run",
               "--summary", json.dumps({"event": "service_started"})]
    try:
        runner(command, capture_output=True, text=True, timeout=60)
    except Exception:
        return


def execute_job_with_containment(job: Job, env: dict[str, str], state_dir: Path, *, runner: Runner = subprocess.run) -> dict[str, Any]:
    try:
        summary = run_job(job, env, state_dir, utc_now(), runner=runner)
    except Exception as error:  # keep the service alive across controlled failures
        summary = {
            "job": job.name,
            "status": "service_error",
            "mode": "execute" if env.get("SYNC_EXECUTE", "0").strip().lower() in {"1", "true", "yes"} else "dry_run",
            "error": type(error).__name__,
            "capture": None,
            "importStatus": "not_attempted",
            "fetchSummary": None,
            "importSummary": None,
            "prunedCaptures": 0,
            "finishedAt": utc_now().isoformat(timespec="seconds").replace("+00:00", "Z"),
        }
        try:
            log_run_outcome(job, env, summary, runner=runner)
        except Exception:
            pass
    state = load_state(state_dir)
    state[job.name] = {"last_finished_at": summary["finishedAt"]}
    save_state(state_dir, state)
    return summary


def acquire_lock(state_dir: Path, now: datetime, stale_after_seconds: int) -> bool:
    state_dir.mkdir(parents=True, exist_ok=True)
    lock = state_dir / "sync.lock"
    try:
        descriptor = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        try:
            age = now.timestamp() - lock.stat().st_mtime
        except OSError:
            return False
        if age <= stale_after_seconds:
            return False
        try:
            lock.unlink()
        except OSError:
            return False
        try:
            descriptor = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError:
            return False
    with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
        stream.write(str(os.getpid()))
    return True


def release_lock(state_dir: Path) -> None:
    try:
        (state_dir / "sync.lock").unlink()
    except OSError:
        pass


def run_once(job: Job, env: dict[str, str], state_dir: Path, *, runner: Runner = subprocess.run) -> dict[str, Any]:
    return execute_job_with_containment(job, env, state_dir, runner=runner)


def run_loop(env: dict[str, str], state_dir: Path, *, runner: Runner = subprocess.run, poll_seconds: int | None = None,
             sleep: Callable[[float], None] = time.sleep) -> None:
    jobs = build_jobs(env)
    poll = poll_seconds or int(env.get("SYNC_POLL_SECONDS", str(DEFAULT_POLL_SECONDS)))
    timeout = int(env.get("SYNC_JOB_TIMEOUT_SECONDS", str(DEFAULT_JOB_TIMEOUT_SECONDS)))
    stop = False

    def request_stop(signum: int, frame: Any) -> None:
        nonlocal stop
        stop = True

    signal.signal(signal.SIGTERM, request_stop)
    signal.signal(signal.SIGINT, request_stop)
    print(json.dumps({"event": "sync_service_started", "jobs": [job.name for job in jobs], "execute": env.get("SYNC_EXECUTE", "0")}), flush=True)
    while not stop:
        now = utc_now()
        state = load_state(state_dir)
        pending = due_jobs(jobs, state, now)
        if pending and acquire_lock(state_dir, now, stale_after_seconds=timeout * 2):
            try:
                for job in pending:
                    if stop:
                        break
                    summary = execute_job_with_containment(job, env, state_dir, runner=runner)
                    print(json.dumps({"event": "sync_run", **summary}, ensure_ascii=False), flush=True)
            finally:
                release_lock(state_dir)
        for _ in range(poll):
            if stop:
                break
            sleep(1)
    print(json.dumps({"event": "sync_service_stopped"}), flush=True)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--once", metavar="JOB", help="Run a single job immediately and exit.")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    options = parse_args(argv)
    env = dict(os.environ)
    state_dir = Path(env.get("SYNC_STATE_DIR", str(ROOT / ".provider-runs")))
    jobs = build_jobs(env)
    send_heartbeat(env)
    if options.once:
        job = next((candidate for candidate in jobs if candidate.name == options.once), None)
        if job is None:
            print(json.dumps({"error": f"Unknown job \"{options.once}\"; known jobs: {[candidate.name for candidate in jobs]}"}))
            return 2
        summary = run_once(job, env, state_dir)
        print(json.dumps(summary, ensure_ascii=False))
        return 0 if summary["importStatus"] in {"executed", "skipped_no_capture"} else 1
    run_loop(env, state_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
