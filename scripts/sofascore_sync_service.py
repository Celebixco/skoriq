"""Run the SkorIQ SofaScore refresh jobs on a fixed cadence inside the deployment."""

import argparse
import json
import os
import re
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
# A lock written before this process started cannot belong to it; the previous
# container is gone after a deploy, so such a lock is safe to steal.
PROCESS_STARTED_AT = time.time()

Runner = Callable[..., "subprocess.CompletedProcess[str]"]


def robust_runner(command, *, capture_output: bool = False, text: bool = False, timeout: float | None = None, **kwargs):
    # Mirrors subprocess.run, but a child that survives SIGKILL (uninterruptible
    # I/O on a stuck mount) is abandoned instead of blocking the service forever.
    process = subprocess.Popen(
        command,
        stdout=subprocess.PIPE if capture_output else None,
        stderr=subprocess.PIPE if capture_output else None,
        text=text
    )
    try:
        stdout, stderr = process.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        process.kill()
        try:
            stdout, stderr = process.communicate(timeout=10)
        except subprocess.TimeoutExpired:
            stdout, stderr = "", ""
        raise subprocess.TimeoutExpired(command, timeout, output=stdout, stderr=stderr)
    return subprocess.CompletedProcess(command, process.returncode, stdout, stderr)


@dataclass(frozen=True)
class Job:
    name: str
    interval_minutes: int
    fetch_script: Path
    import_script: Path
    fetch_args: tuple[str, ...] = ()
    import_args: tuple[str, ...] = ()


def build_jobs(env: dict[str, str]) -> list[Job]:
    interval = int(env.get("SYNC_FINISHED_INTERVAL_MINUTES", "180"))
    upcoming_interval = int(env.get("SYNC_UPCOMING_INTERVAL_MINUTES", "720"))
    standings_interval = int(env.get("SYNC_STANDINGS_INTERVAL_MINUTES", "720"))
    matches_fetch = ROOT / "scripts" / "sofascore_fetch_recent_matches.py"
    matches_import = ROOT / "scripts" / "provider-sofascore-matches-sync.ts"
    return [
        Job("finished-matches", max(15, interval), matches_fetch, matches_import,
            import_args=("--job", "finished-matches")),
        Job("upcoming-matches", max(15, upcoming_interval), matches_fetch, matches_import,
            fetch_args=("--window", "next"), import_args=("--job", "upcoming-matches")),
        Job("standings", max(15, standings_interval),
            ROOT / "scripts" / "sofascore_fetch_standings.py",
            ROOT / "scripts" / "provider-sofascore-standings-sync.ts"),
    ]


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
    lines = output.strip().splitlines()
    for index in range(len(lines) - 1, -1, -1):
        line = lines[index].strip()
        if not line.startswith("{"):
            continue
        # Try the line alone first, then the line joined with everything after it
        # so a pretty-printed multi-line document is still readable.
        for candidate in (line, "\n".join(lines[index:]).strip()):
            try:
                document = json.loads(candidate)
            except ValueError:
                continue
            if isinstance(document, dict):
                return document
    return None


_POSTGRES_URL_PATTERN = re.compile(r"postgres(?:ql)?://[^\s]+", re.IGNORECASE)


def redact(text: str) -> str:
    return _POSTGRES_URL_PATTERN.sub("DATABASE_URL=<redacted>", text)


def capture_dir_for(env: dict[str, str], state_dir: Path) -> Path:
    configured = env.get("SYNC_CAPTURE_DIR")
    return Path(configured) if configured else state_dir / "captures"


def capture_path_for(capture_dir: Path, job: Job, now: datetime) -> Path:
    stamp = now.strftime("%Y%m%dT%H%M%SZ")
    return capture_dir / f"{job.name}-{stamp}-{os.getpid()}.json"


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


def read_tournament_ids(catalog_path: Path) -> list[int]:
    document = json.loads(catalog_path.read_text(encoding="utf-8"))
    leagues = document.get("leagues") if isinstance(document, dict) else document
    if not isinstance(leagues, list):
        raise ValueError("Catalog must contain a league list.")
    ids: list[int] = []
    seen: set[int] = set()
    for league in leagues:
        if not isinstance(league, dict):
            continue
        value = league.get("sofascore_tournament_id")
        if isinstance(value, bool) or not isinstance(value, int) or value <= 0 or value in seen:
            continue
        seen.add(value)
        ids.append(value)
    if not ids:
        raise ValueError("Catalog contains no usable tournament ids.")
    return ids


def run_job(job: Job, env: dict[str, str], state_dir: Path, now: datetime, *, runner: Runner = robust_runner) -> dict[str, Any]:
    execute = env.get("SYNC_EXECUTE", "0").strip().lower() in {"1", "true", "yes"}
    # One run has exactly one job row: open it here, keep step markers log-only,
    # and close it with a single final outcome after every league is imported.
    begin_run(job, env, execute=execute, runner=runner)
    timeout = int(env.get("SYNC_JOB_TIMEOUT_SECONDS", str(DEFAULT_JOB_TIMEOUT_SECONDS)))
    fetch_timeout = int(env.get("SYNC_FETCH_TIMEOUT_SECONDS", "120"))
    capture = capture_path_for(capture_dir_for(env, state_dir), job, now)
    capture.parent.mkdir(parents=True, exist_ok=True)
    catalog = env.get("SYNC_CATALOG")
    catalog_path = Path(catalog) if catalog else job.fetch_script.with_name("sofascore_catalog.json")

    tournament_ids = read_tournament_ids(catalog_path)
    parts: list[Path] = []
    fetch_entries: list[dict[str, Any]] = []
    for tournament_id in tournament_ids:
        part = capture.with_name(f"{capture.stem}-t{tournament_id}.json")
        command = [sys.executable, str(job.fetch_script), "--output", str(part), "--tournament-id", str(tournament_id)]
        if catalog:
            command += ["--catalog", catalog]
        command += list(job.fetch_args)
        result = runner(command, capture_output=True, text=True, timeout=fetch_timeout)
        part_summary = parse_last_json_line(result.stdout or "")
        published = part.exists()
        if published:
            parts.append(part)
        fetch_entries.append({"tournamentId": tournament_id, "fetched": published, "summary": part_summary})
        log_step(job, env, "fetch_completed",
                 {"tournamentId": tournament_id, "captureExists": published, "summary": part_summary}, runner=runner)

    if parts:
        log_step(job, env, "fetch_phase_complete", {"partsPublished": len(parts), "tournamentsRequested": len(tournament_ids)}, runner=runner)
    fetch_summary = {
        "tournaments": fetch_entries,
        "partsPublished": len(parts),
        "tournamentsRequested": len(tournament_ids),
    }

    # Import each league as its own invocation: a single wedged league is killed
    # by its own timeout and cannot hold the whole refresh hostage.
    import_timeout = int(env.get("SYNC_IMPORT_TIMEOUT_SECONDS", "180"))
    part_summaries: list[dict[str, Any]] = []
    aggregate_counts: dict[str, int] = {}
    imported_parts = 0
    for part_summary in fetch_entries:
        if not part_summary["fetched"]:
            part_summaries.append({"tournamentId": part_summary["tournamentId"], "status": "skipped_no_capture"})
            continue
        part_path = capture.with_name(f"{capture.stem}-t{part_summary['tournamentId']}.json")
        if not part_path.exists():
            part_summaries.append({"tournamentId": part_summary["tournamentId"], "status": "skipped_no_capture"})
            continue
        log_step(job, env, "import_started", {"tournamentId": part_summary["tournamentId"]}, runner=runner)
        import_summary = import_part(job, part_path, env, execute, import_timeout, runner)
        part_summaries.append(import_summary)
        log_step(job, env, "import_part_result",
                 {"tournamentId": part_summary["tournamentId"], "partStatus": import_summary["status"]}, runner=runner)
        if import_summary["status"] == "executed":
            imported_parts += 1
            for action, count in (import_summary.get("counts") or {}).items():
                aggregate_counts[action] = aggregate_counts.get(action, 0) + int(count)

    fetched_count = len([entry for entry in fetch_entries if entry["fetched"]])
    executed_count = len([summary for summary in part_summaries if summary["status"] == "executed"])
    if fetched_count > 0 and executed_count == fetched_count:
        import_status = "executed"
    elif imported_parts > 0:
        import_status = "partial_import"
    elif fetched_count > 0:
        import_status = "import_failed"
    else:
        import_status = "skipped_no_capture"

    removed = prune_captures(capture.parent, int(env.get("SYNC_CAPTURE_RETENTION_DAYS", str(DEFAULT_CAPTURE_RETENTION_DAYS))), now)
    summary = {
        "job": job.name,
        "status": classify_run_status(any(entry["fetched"] for entry in fetch_entries), import_status),
        "mode": "execute" if execute else "dry_run",
        "capture": None,
        "capturesRetained": len(parts),
        "importStatus": import_status,
        "importError": next((entry.get("error") for entry in part_summaries if entry.get("error")), None),
        "fetchSummary": fetch_summary,
        "importSummary": {"parts": part_summaries, "counts": aggregate_counts},
        "prunedCaptures": removed,
        "finishedAt": now.isoformat(timespec="seconds").replace("+00:00", "Z"),
    }
    log_run_outcome(job, env, summary, runner=runner)
    return summary


def import_part(job: Job, part_path: Path, env: dict[str, str], execute: bool, timeout: int, runner: Runner) -> dict[str, Any]:
    tournament_id = int(part_path.stem.rsplit("-t", 1)[1])
    progress_path = Path(f"{part_path}.progress")
    progress_path.unlink(missing_ok=True)
    command = [node_binary(), str(job.import_script), "--capture", str(part_path)]
    command += list(job.import_args)
    if execute:
        command.append("--execute")
    # The service owns the sync_jobs row for the whole run. A per-league child
    # must not increment attempt_count or flip a finished run back to running.
    command.append("--no-log-run")

    def progress_tail() -> str | None:
        try:
            lines = progress_path.read_text(encoding="utf-8").strip().splitlines()
        except OSError:
            return None
        return redact(" | ".join(lines[-5:])) if lines else None

    try:
        result = runner(command, capture_output=True, text=True, timeout=timeout)
    except Exception as error:
        return {"tournamentId": tournament_id, "status": "import_timeout",
                "error": type(error).__name__, "progressTail": progress_tail()}
    summary = parse_last_json_line(result.stdout or "")
    if result.returncode == 0 and summary:
        return {"tournamentId": tournament_id, "status": "executed", "counts": summary.get("counts"),
                "queriesExecuted": summary.get("queriesExecuted"), "progressTail": progress_tail()}
    stderr_tail = redact((result.stderr or "").strip()[-400:])
    return {"tournamentId": tournament_id, "status": "import_failed",
            "error": stderr_tail or f"exit {result.returncode}", "progressTail": progress_tail()}


def classify_run_status(fetched_any: bool, import_status: str) -> str:
    if not fetched_any:
        return "fetch_failed"
    if import_status in {"executed", "partial_import"}:
        return "succeeded"
    if import_status == "import_failed":
        return "import_failed"
    return "fetch_failed"


def log_run_outcome(job: Job, env: dict[str, str], summary: dict[str, Any], *, runner: Runner) -> None:
    # Every finished run closes its job row, including fully successful ones.
    # The per-league importers run with --no-log-run, so this is the final write.
    if not env.get("DATABASE_URL"):
        return
    payload = {
        "fetchSummary": summary.get("fetchSummary"),
        "importStatus": summary.get("importStatus"),
        "importError": summary.get("importError"),
        "failedParts": [entry for entry in (summary.get("importSummary") or {}).get("parts", [])
                        if entry.get("status") not in {"executed"}][:8],
        "capture": summary.get("capture"),
    }
    status = str(summary.get("status", "service_error"))
    error_value = summary.get("error") or (status if status in {"fetch_failed", "import_failed", "service_error"} else None)
    command = [node_binary(), str(ROOT / "scripts" / "sync-run-log.ts"),
               "--job", job.name, "--phase", "final", "--status", status,
               "--mode", str(summary.get("mode", "dry_run")),
               "--summary", json.dumps(payload, ensure_ascii=False)]
    if error_value:
        command += ["--error", str(error_value)]
    try:
        runner(command, capture_output=True, text=True,
               timeout=int(env.get("SYNC_JOB_TIMEOUT_SECONDS", str(DEFAULT_JOB_TIMEOUT_SECONDS))))
    except Exception:
        # Logging is best effort; the refresh loop must keep running.
        return


def begin_run(job: Job, env: dict[str, str], *, execute: bool, runner: Runner = robust_runner) -> None:
    # One begin marker per run. attempt_count represents this run's attempt (1),
    # not the sixteen per-league importer invocations or a lifetime counter.
    if not env.get("DATABASE_URL"):
        return
    command = [node_binary(), str(ROOT / "scripts" / "sync-run-log.ts"),
               "--job", job.name, "--phase", "begin", "--status", "running",
               "--mode", "execute" if execute else "dry_run",
               "--summary", json.dumps({"event": "run_started"})]
    try:
        runner(command, capture_output=True, text=True, timeout=60)
    except Exception:
        return


def node_binary() -> str:
    # Node runs the TypeScript entry points natively (type stripping); tsx is not required.
    return shutil.which("node") or "node"


def log_step(job: Job, env: dict[str, str], step: str, payload: dict[str, Any], *, runner: Runner) -> None:
    # Step markers make a slow fetch or importer visible while it is still running.
    if not env.get("DATABASE_URL"):
        return
    command = [node_binary(), str(ROOT / "scripts" / "sync-run-log.ts"), "--job", job.name,
               "--phase", "step", "--status", "running",
               "--mode", "execute" if env.get("SYNC_EXECUTE", "0").strip().lower() in {"1", "true", "yes"} else "dry_run",
               "--summary", json.dumps(payload, ensure_ascii=False), "--message", step]
    try:
        runner(command, capture_output=True, text=True, timeout=60)
    except Exception:
        return


def send_heartbeat(env: dict[str, str], *, runner: Runner = robust_runner) -> None:
    # A single start marker makes a dead service or a broken node chain visible
    # in sync telemetry instead of silence.
    if not env.get("DATABASE_URL"):
        return
    command = [node_binary(), str(ROOT / "scripts" / "sync-run-log.ts"), "--job", "finished-matches",
               "--phase", "step", "--status", "running", "--mode", "execute" if env.get("SYNC_EXECUTE", "0").strip().lower() in {"1", "true", "yes"} else "dry_run",
               "--summary", json.dumps({"event": "service_started"})]
    try:
        runner(command, capture_output=True, text=True, timeout=60)
    except Exception:
        return


def execute_job_with_containment(job: Job, env: dict[str, str], state_dir: Path, *, runner: Runner = robust_runner) -> dict[str, Any]:
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
            payload = json.loads(lock.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            payload = None
        owner_started = float(payload.get("processStartedAt", 0)) if isinstance(payload, dict) else 0.0
        try:
            age = now.timestamp() - lock.stat().st_mtime
        except OSError:
            return False
        if owner_started >= PROCESS_STARTED_AT - 2:
            # Written after this process started: an active lock or a same-process leftover.
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
        stream.write(json.dumps({"pid": os.getpid(), "processStartedAt": PROCESS_STARTED_AT}))
    return True


def release_lock(state_dir: Path) -> None:
    try:
        (state_dir / "sync.lock").unlink()
    except OSError:
        pass


def run_once(job: Job, env: dict[str, str], state_dir: Path, *, runner: Runner = robust_runner) -> dict[str, Any]:
    return execute_job_with_containment(job, env, state_dir, runner=runner)


def run_loop(env: dict[str, str], state_dir: Path, *, runner: Runner = robust_runner, poll_seconds: int | None = None,
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
    first_pass = True
    while not stop:
        try:
            now = utc_now()
            state = load_state(state_dir)
            pending = due_jobs(jobs, state, now)
            if first_pass:
                log_step(jobs[0], env, "loop_begin",
                         {"state": state, "dueJobs": [job.name for job in pending], "stateDir": str(state_dir)},
                         runner=runner)
                first_pass = False
            if pending:
                if acquire_lock(state_dir, now, stale_after_seconds=timeout * 2):
                    try:
                        for job in pending:
                            if stop:
                                break
                            summary = execute_job_with_containment(job, env, state_dir, runner=runner)
                            print(json.dumps({"event": "sync_run", **summary}, ensure_ascii=False), flush=True)
                    finally:
                        release_lock(state_dir)
                else:
                    log_step(jobs[0], env, "lock_busy", {}, runner=runner)
        except Exception as error:
            # The loop must never die silently; record the controlled category and continue.
            try:
                log_step(jobs[0], env, "loop_error", {"error": type(error).__name__}, runner=runner)
            except Exception:
                pass
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
