"""Tests for the SofaScore sync service runner."""

import json
import os
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import sofascore_sync_service as service  # noqa: E402

NOW = datetime(2026, 10, 16, 12, 0, tzinfo=timezone.utc)


def completed(command: list[str], returncode: int, stdout: str) -> subprocess.CompletedProcess:
    return subprocess.CompletedProcess(command, returncode, stdout=stdout, stderr="")


class FakeRunner:
    def __init__(self, *, publish: bool = True, import_returncode: int = 0, import_summary: dict | None = None):
        self.publish = publish
        self.import_returncode = import_returncode
        self.import_summary = import_summary if import_summary is not None else {"mode": "dry_run", "counts": {"planned_update": 2}}
        self.commands: list[list[str]] = []

    def __call__(self, command, **kwargs):
        self.commands.append(list(command))
        if "sofascore_fetch_recent_matches.py" in command[1]:
            tournament_id = int(command[command.index("--tournament-id") + 1])
            if self.publish:
                output = Path(command[command.index("--output") + 1])
                output.parent.mkdir(parents=True, exist_ok=True)
                output.write_text(json.dumps({
                    "source": "sofascore",
                    "capturedAt": "2026-10-16T12:00:00.000Z",
                    "tournaments": [{"sofascore_tournament_id": tournament_id, "season_id": 1,
                                     "events": [{"sofascore_id": tournament_id * 100 + 1}]}],
                }), encoding="utf-8")
            return completed(command, 0, json.dumps({"fetched_leagues": 1 if self.publish else 0,
                                                     "events_total": 1 if self.publish else 0}))
        if any("provider-sofascore-matches-sync.ts" in part for part in command):
            return completed(command, self.import_returncode, json.dumps(self.import_summary) + "\nnoise line")
        if any("sync-run-log.ts" in part for part in command):
            return completed(command, 0, json.dumps({"logged": True}))
        raise AssertionError(f"Unexpected command: {command}")


class JobTests(unittest.TestCase):
    def test_build_jobs_reads_interval_with_floor(self):
        jobs = service.build_jobs({"SYNC_FINISHED_INTERVAL_MINUTES": "5"})
        self.assertEqual(jobs[0].interval_minutes, 15)
        jobs = service.build_jobs({})
        self.assertEqual(jobs[0].interval_minutes, 180)
        self.assertTrue(str(jobs[0].fetch_script).endswith("sofascore_fetch_recent_matches.py"))

    def test_due_jobs_uses_last_finished_at(self):
        job = service.build_jobs({})[0]
        self.assertEqual(service.due_jobs([job], {}, NOW), [job])
        recent = {job.name: {"last_finished_at": (NOW - timedelta(minutes=30)).isoformat()}}
        self.assertEqual(service.due_jobs([job], recent, NOW), [])
        old = {job.name: {"last_finished_at": (NOW - timedelta(minutes=200)).isoformat()}}
        self.assertEqual(service.due_jobs([job], old, NOW), [job])
        malformed = {job.name: {"last_finished_at": "not-a-date"}}
        self.assertEqual(service.due_jobs([job], malformed, NOW), [job])


class SummaryParsingTests(unittest.TestCase):
    def test_reads_the_last_json_line(self):
        output = 'log line\n{"a": 1}\nmore\n{"b": 2}\n'
        self.assertEqual(service.parse_last_json_line(output), {"b": 2})
        self.assertIsNone(service.parse_last_json_line("no json here"))
        self.assertIsNone(service.parse_last_json_line(""))


class RunJobTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.state_dir = Path(self.directory.name)
        self.job = service.build_jobs({})[0]
        self.catalog = self.state_dir / "catalog.json"
        self.catalog.write_text(json.dumps([
            {"sofascore_tournament_id": 52, "season_id": 98080, "league_name": "Süper Lig"},
            {"sofascore_tournament_id": 98, "season_id": 87876, "league_name": "1. Lig"},
        ]), encoding="utf-8")
        self.base_env = {"SYNC_CATALOG": str(self.catalog)}

    def test_dry_run_fetches_per_league_and_merges_before_import(self):
        runner = FakeRunner()
        summary = service.run_job(self.job, dict(self.base_env), self.state_dir, NOW, runner=runner)
        self.assertEqual(summary["mode"], "dry_run")
        self.assertEqual(summary["importStatus"], "executed")
        self.assertEqual(summary["fetchSummary"]["tournamentsRequested"], 2)
        self.assertEqual(summary["fetchSummary"]["partsPublished"], 2)
        self.assertEqual(summary["importSummary"], {"mode": "dry_run", "counts": {"planned_update": 2}})
        fetch_commands = [command for command in runner.commands if "sofascore_fetch_recent_matches.py" in command[1]]
        self.assertEqual(len(fetch_commands), 2)
        self.assertIn("--tournament-id", fetch_commands[0])
        import_command = runner.commands[-1]
        self.assertIn("--capture", import_command)
        self.assertNotIn("--execute", import_command)
        merged = json.loads(Path(summary["capture"]).read_text(encoding="utf-8"))
        self.assertEqual(len(merged["tournaments"]), 2)

    def test_execute_adds_the_flag_and_passes_catalog(self):
        runner = FakeRunner()
        env = {**self.base_env, "SYNC_EXECUTE": "true"}
        summary = service.run_job(self.job, env, self.state_dir, NOW, runner=runner)
        self.assertEqual(summary["mode"], "execute")
        fetch_command = runner.commands[0]
        import_command = runner.commands[-1]
        self.assertIn("--catalog", fetch_command)
        self.assertIn("--execute", import_command)

    def test_missing_capture_skips_import_but_reports_fetch_summary(self):
        runner = FakeRunner(publish=False)
        summary = service.run_job(self.job, dict(self.base_env), self.state_dir, NOW, runner=runner)
        self.assertEqual(summary["importStatus"], "skipped_no_capture")
        self.assertIsNone(summary["importSummary"])
        self.assertEqual(summary["fetchSummary"]["tournamentsRequested"], 2)
        self.assertEqual(summary["fetchSummary"]["partsPublished"], 0)
        self.assertEqual(len(runner.commands), 2)
        self.assertEqual(summary["status"], "fetch_failed")

    def test_import_failure_is_reported(self):
        runner = FakeRunner(import_returncode=1)
        summary = service.run_job(self.job, dict(self.base_env), self.state_dir, NOW, runner=runner)
        self.assertEqual(summary["importStatus"], "import_failed")
        self.assertEqual(summary["status"], "import_failed")

    def test_fetch_failure_is_recorded_via_run_log_helper(self):
        runner = FakeRunner(publish=False)
        env = {**self.base_env, "DATABASE_URL": "postgres://example"}
        summary = service.run_job(self.job, env, self.state_dir, NOW, runner=runner)
        self.assertEqual(summary["status"], "fetch_failed")
        helper = [command for command in runner.commands if any("sync-run-log.ts" in part for part in command)]
        self.assertEqual(len(helper), 3)
        self.assertIn("fetch_completed", helper[0])
        self.assertIn("fetch_failed", helper[-1])
        self.assertIn("--error", helper[-1])

    def test_import_failure_is_recorded_via_run_log_helper(self):
        runner = FakeRunner(import_returncode=1)
        env = {**self.base_env, "DATABASE_URL": "postgres://example"}
        summary = service.run_job(self.job, env, self.state_dir, NOW, runner=runner)
        self.assertEqual(summary["status"], "import_failed")
        helper = [command for command in runner.commands if any("sync-run-log.ts" in part for part in command)]
        self.assertEqual(len(helper), 3)
        self.assertIn("fetch_completed", helper[0])
        self.assertIn("import_failed", helper[-1])

    def test_executed_run_is_not_double_logged(self):
        runner = FakeRunner()
        env = {**self.base_env, "DATABASE_URL": "postgres://example"}
        summary = service.run_job(self.job, env, self.state_dir, NOW, runner=runner)
        self.assertEqual(summary["status"], "succeeded")
        helper = [command for command in runner.commands if any("sync-run-log.ts" in part for part in command)]
        self.assertEqual(len(helper), 2)
        self.assertTrue(all("fetch_completed" in command for command in helper))

    def test_containment_keeps_service_alive_and_updates_state(self):
        def failing_runner(command, **kwargs):
            raise FileNotFoundError("node is unavailable")

        summary = service.execute_job_with_containment(self.job, dict(self.base_env), self.state_dir, runner=failing_runner)
        self.assertEqual(summary["status"], "service_error")
        self.assertEqual(summary["error"], "FileNotFoundError")
        state = service.load_state(self.state_dir)
        self.assertIn("finished-matches", state)


class StateAndLockTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.state_dir = Path(self.directory.name)

    def test_state_roundtrip_and_corrupt_recovery(self):
        service.save_state(self.state_dir, {"finished-matches": {"last_finished_at": "x"}})
        self.assertEqual(service.load_state(self.state_dir)["finished-matches"]["last_finished_at"], "x")
        service.state_file(self.state_dir).write_text("{not json", encoding="utf-8")
        self.assertEqual(service.load_state(self.state_dir), {})

    def test_lock_lifecycle_and_stale_takeover(self):
        self.assertTrue(service.acquire_lock(self.state_dir, NOW, stale_after_seconds=600))
        self.assertFalse(service.acquire_lock(self.state_dir, NOW, stale_after_seconds=600))
        service.release_lock(self.state_dir)
        self.assertTrue(service.acquire_lock(self.state_dir, NOW, stale_after_seconds=600))
        lock = self.state_dir / "sync.lock"
        old = (NOW - timedelta(seconds=3600)).timestamp()
        os.utime(lock, (old, old))
        self.assertTrue(service.acquire_lock(self.state_dir, NOW, stale_after_seconds=600))
        service.release_lock(self.state_dir)

    def test_run_once_updates_state(self):
        runner = FakeRunner()
        catalog = self.state_dir / "catalog.json"
        catalog.write_text(json.dumps([{"sofascore_tournament_id": 52, "season_id": 1}]), encoding="utf-8")
        summary = service.run_once(service.build_jobs({})[0], {"SYNC_CATALOG": str(catalog)}, self.state_dir, runner=runner)
        state = service.load_state(self.state_dir)
        self.assertEqual(state["finished-matches"]["last_finished_at"], summary["finishedAt"])

    def test_prune_captures_removes_only_old_files(self):
        capture_dir = self.state_dir / "captures"
        capture_dir.mkdir()
        old_file = capture_dir / "old.json"
        new_file = capture_dir / "new.json"
        old_file.write_text("{}", encoding="utf-8")
        new_file.write_text("{}", encoding="utf-8")
        old = (NOW - timedelta(days=10)).timestamp()
        os.utime(old_file, (old, old))
        removed = service.prune_captures(capture_dir, retention_days=7, now=NOW)
        self.assertEqual(removed, 1)
        self.assertFalse(old_file.exists())
        self.assertTrue(new_file.exists())


if __name__ == "__main__":
    unittest.main()
