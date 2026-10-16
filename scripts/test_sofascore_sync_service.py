"""Tests for the SofaScore sync service runner."""

import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import sofascore_sync_service as service  # noqa: E402

NOW = datetime(2026, 10, 16, 12, 0, tzinfo=timezone.utc)


def completed(command: list[str], returncode: int, stdout: str, stderr: str = "") -> subprocess.CompletedProcess:
    return subprocess.CompletedProcess(command, returncode, stdout=stdout, stderr=stderr)


class FakeRunner:
    def __init__(self, *, publish: bool = True, import_returncode: int = 0, import_summary: dict | None = None,
                 fail_tournaments: set | None = None):
        self.publish = publish
        self.import_returncode = import_returncode
        self.import_summary = import_summary if import_summary is not None else {"mode": "dry_run", "counts": {"planned_update": 2}}
        self.fail_tournaments = fail_tournaments or set()
        self.commands: list[list[str]] = []

    def __call__(self, command, **kwargs):
        self.commands.append(list(command))
        if "sofascore_fetch_" in command[1]:
            tournament_id = int(command[command.index("--tournament-id") + 1])
            if self.publish:
                output = Path(command[command.index("--output") + 1])
                output.parent.mkdir(parents=True, exist_ok=True)
                if "standings" in command[1]:
                    document = {"source": "sofascore-standings", "capturedAt": "2026-10-16T12:00:00.000Z",
                                "tournaments": [{"sofascore_tournament_id": tournament_id, "season_id": 1, "standings": [
                                    {"team_id": tournament_id * 100 + 1, "position": 1, "played": 8, "wins": 6, "draws": 1,
                                     "losses": 1, "goals_for": 18, "goals_against": 6, "points": 19}]}]}
                else:
                    document = {"source": "sofascore", "capturedAt": "2026-10-16T12:00:00.000Z",
                                "tournaments": [{"sofascore_tournament_id": tournament_id, "season_id": 1,
                                                 "events": [{"sofascore_id": tournament_id * 100 + 1}]}]}
                output.write_text(json.dumps(document), encoding="utf-8")
            return completed(command, 0, json.dumps({"fetched_leagues": 1 if self.publish else 0,
                                                     "events_total": 1 if self.publish else 0}))
        if any("provider-sofascore-matches-sync.ts" in part or "provider-sofascore-standings-sync.ts" in part for part in command):
            capture_arg = command[command.index("--capture") + 1]
            tournament_id = int(Path(capture_arg).stem.rsplit("-t", 1)[1])
            Path(f"{capture_arg}.progress").write_text("2026-10-16T12:00:00.000Z cli_start\n2026-10-16T12:00:00.100Z begin_logged\n", encoding="utf-8")
            if tournament_id in self.fail_tournaments or self.import_returncode != 0:
                return completed(command, 1, "", stderr="boom postgres://user:secret@db:5432/x failed")
            return completed(command, 0, json.dumps(self.import_summary) + "\nnoise line")
        if any("sync-run-log.ts" in part for part in command):
            return completed(command, 0, json.dumps({"logged": True}))
        raise AssertionError(f"Unexpected command: {command}")


class JobTests(unittest.TestCase):
    def test_build_jobs_reads_interval_with_floor(self):
        jobs = service.build_jobs({"SYNC_FINISHED_INTERVAL_MINUTES": "5"})
        self.assertEqual(jobs[0].interval_minutes, 15)
        jobs = service.build_jobs({})
        self.assertEqual(len(jobs), 3)
        self.assertEqual(jobs[0].interval_minutes, 180)
        self.assertEqual(jobs[1].name, "upcoming-matches")
        self.assertEqual(jobs[1].fetch_args, ("--window", "next"))
        self.assertEqual(jobs[2].name, "standings")
        self.assertTrue(str(jobs[2].fetch_script).endswith("sofascore_fetch_standings.py"))
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

    def test_reads_a_multiline_pretty_printed_document(self):
        output = 'header\n{\n  "a": 1,\n  "b": {"c": 2},\n  "counts": {\n    "x": 3\n  }\n}\n'
        self.assertEqual(service.parse_last_json_line(output), {"a": 1, "b": {"c": 2}, "counts": {"x": 3}})


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

    def test_runs_one_import_per_league_and_aggregates_counts(self):
        runner = FakeRunner()
        summary = service.run_job(self.job, dict(self.base_env), self.state_dir, NOW, runner=runner)
        self.assertEqual(summary["mode"], "dry_run")
        self.assertEqual(summary["importStatus"], "executed")
        self.assertEqual(summary["status"], "succeeded")
        self.assertEqual(summary["fetchSummary"]["tournamentsRequested"], 2)
        self.assertEqual(summary["fetchSummary"]["partsPublished"], 2)
        self.assertEqual(len(summary["importSummary"]["parts"]), 2)
        self.assertEqual(summary["importSummary"]["counts"], {"planned_update": 4})
        self.assertIn("begin_logged", summary["importSummary"]["parts"][0]["progressTail"])
        fetch_commands = [command for command in runner.commands if "sofascore_fetch_recent_matches.py" in command[1]]
        import_commands = [command for command in runner.commands if any("provider-sofascore-matches-sync.ts" in part for part in command)]
        self.assertEqual(len(fetch_commands), 2)
        self.assertEqual(len(import_commands), 2)
        self.assertNotIn("--execute", import_commands[0])

    def test_execute_adds_the_flag_and_passes_catalog(self):
        runner = FakeRunner()
        env = {**self.base_env, "SYNC_EXECUTE": "true"}
        summary = service.run_job(self.job, env, self.state_dir, NOW, runner=runner)
        self.assertEqual(summary["mode"], "execute")
        fetch_command = runner.commands[0]
        import_commands = [command for command in runner.commands if any("provider-sofascore-matches-sync.ts" in part for part in command)]
        self.assertIn("--catalog", fetch_command)
        self.assertEqual(len(import_commands), 2)
        self.assertTrue(all("--execute" in command for command in import_commands))

    def test_partial_import_still_reports_success_with_failed_parts(self):
        runner = FakeRunner(fail_tournaments={98})
        env = {**self.base_env, "DATABASE_URL": "postgres://example"}
        summary = service.run_job(self.job, env, self.state_dir, NOW, runner=runner)
        self.assertEqual(summary["importStatus"], "partial_import")
        self.assertEqual(summary["status"], "succeeded")
        self.assertIsNotNone(summary["importError"])
        part_statuses = {entry["tournamentId"]: entry["status"] for entry in summary["importSummary"]["parts"]}
        self.assertEqual(part_statuses, {52: "executed", 98: "import_failed"})
        helper = [command for command in runner.commands if any("sync-run-log.ts" in part for part in command)]
        self.assertGreaterEqual(len(helper), 6)
        self.assertTrue(any("import_failed" in part for part in helper[-1]))

    def test_missing_capture_skips_import_but_reports_fetch_summary(self):
        runner = FakeRunner(publish=False)
        summary = service.run_job(self.job, dict(self.base_env), self.state_dir, NOW, runner=runner)
        self.assertEqual(summary["importStatus"], "skipped_no_capture")
        self.assertEqual(summary["importSummary"]["counts"], {})
        self.assertEqual([entry["status"] for entry in summary["importSummary"]["parts"]], ["skipped_no_capture", "skipped_no_capture"])
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
        self.assertIn("DATABASE_URL=<redacted>", summary["importError"])
        self.assertNotIn("secret", summary["importError"])
        helper = [command for command in runner.commands if any("sync-run-log.ts" in part for part in command)]
        self.assertGreaterEqual(len(helper), 6)
        self.assertIn("import_failed", helper[-1])
        self.assertTrue(any("DATABASE_URL=<redacted>" in part for part in helper[-1]))

    def test_executed_run_is_not_double_logged(self):
        runner = FakeRunner()
        env = {**self.base_env, "DATABASE_URL": "postgres://example"}
        summary = service.run_job(self.job, env, self.state_dir, NOW, runner=runner)
        self.assertEqual(summary["status"], "succeeded")
        helper = [command for command in runner.commands if any("sync-run-log.ts" in part for part in command)]
        self.assertGreaterEqual(len(helper), 6)
        self.assertTrue(any("import_started" in part for part in helper))
        self.assertTrue(any("import_part_result" in part for part in helper))

    def test_standings_job_uses_the_standings_scripts(self):
        runner = FakeRunner()
        standings_job = service.build_jobs({})[2]
        service.run_job(standings_job, dict(self.base_env), self.state_dir, NOW, runner=runner)
        fetch_commands = [command for command in runner.commands if "sofascore_fetch_standings.py" in command[1]]
        import_commands = [command for command in runner.commands if any("provider-sofascore-standings-sync.ts" in part for part in command)]
        self.assertEqual(len(fetch_commands), 2)
        self.assertEqual(len(import_commands), 2)
        self.assertFalse(any("--job" in command for command in import_commands))

    def test_upcoming_job_uses_the_next_window_and_job_flag(self):
        runner = FakeRunner()
        upcoming_job = service.build_jobs({})[1]
        service.run_job(upcoming_job, dict(self.base_env), self.state_dir, NOW, runner=runner)
        fetch_commands = [command for command in runner.commands if "sofascore_fetch_recent_matches.py" in command[1]]
        import_commands = [command for command in runner.commands if any("provider-sofascore-matches-sync.ts" in part for part in command)]
        self.assertEqual(len(fetch_commands), 2)
        self.assertTrue(all("--window" in command and "next" in command for command in fetch_commands))
        self.assertEqual(len(import_commands), 2)
        self.assertTrue(all("--job" in command and "upcoming-matches" in command for command in import_commands))

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

    def test_lock_from_a_previous_container_is_stolen(self):
        self.state_dir.mkdir(parents=True, exist_ok=True)
        lock = self.state_dir / "sync.lock"
        lock.write_text(json.dumps({"pid": 1, "processStartedAt": time.time() - 3600}), encoding="utf-8")
        self.assertTrue(service.acquire_lock(self.state_dir, NOW, stale_after_seconds=99999))
        payload = json.loads(lock.read_text(encoding="utf-8"))
        self.assertEqual(payload["pid"], os.getpid())
        service.release_lock(self.state_dir)

    def test_legacy_plain_text_lock_is_stolen(self):
        self.state_dir.mkdir(parents=True, exist_ok=True)
        lock = self.state_dir / "sync.lock"
        lock.write_text("1", encoding="utf-8")
        self.assertTrue(service.acquire_lock(self.state_dir, NOW, stale_after_seconds=99999))
        payload = json.loads(lock.read_text(encoding="utf-8"))
        self.assertEqual(payload["pid"], os.getpid())
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
