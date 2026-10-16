import { Controller, Get } from "@nestjs/common";
import { allQueueNames } from "@sports-data/queue";
import { loadConfig } from "@sports-data/config";
import pg from "pg";

interface SyncRunLogRow {
  message?: string;
  metadata?: unknown;
  createdAt?: string;
}

interface SyncRunRow {
  job_key?: string;
  job_name?: string;
  status?: string;
  attempt_count?: number;
  last_error?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  duration_ms?: number | null;
  latest_log?: SyncRunLogRow | null;
  recent_logs?: SyncRunLogRow[] | null;
}

@Controller("sync")
export class SyncStatusController {
  @Get("status")
  async getSyncStatus() {
    const config = loadConfig();
    const pool = new pg.Pool({
      connectionString: config.DATABASE_URL,
      max: 2
    });

    try {
      const [compRes, teamRes, matchRes, statRes, playerRes, runsRes] = await Promise.all([
        pool.query("SELECT COUNT(*) AS total FROM competitions"),
        pool.query(`
          SELECT COUNT(*) AS total,
            COUNT(CASE WHEN
              jsonb_typeof(coalesce(nullif(metadata_json->'seasonStatistics', 'null'::jsonb), metadata_json->'season_statistics')) = 'object'
              AND coalesce(nullif(metadata_json->'seasonStatistics', 'null'::jsonb), metadata_json->'season_statistics') <> '{}'::jsonb
              THEN 1 END) AS with_stats
          FROM teams
        `),
        pool.query("SELECT COUNT(*) AS total, COUNT(CASE WHEN status = 'finished' THEN 1 END) AS finished, COUNT(CASE WHEN status = 'scheduled' THEN 1 END) AS scheduled FROM matches"),
        pool.query("SELECT COUNT(DISTINCT match_id) AS matches_with_stats, COUNT(*) AS total_records FROM football_match_team_statistics"),
        pool.query("SELECT COUNT(*) AS total FROM players").catch(() => ({ rows: [{ total: 0 }] })),
        pool.query(`
          SELECT j.job_key, j.job_name, j.status, j.attempt_count, j.last_error, j.started_at, j.finished_at, j.duration_ms,
            (SELECT jsonb_build_object('message', l.message, 'metadata', l.metadata_json, 'createdAt', l.created_at)
              FROM sync_job_logs l WHERE l.sync_job_id = j.id ORDER BY l.created_at DESC LIMIT 1) AS latest_log,
            (SELECT jsonb_agg(jsonb_build_object('message', l.message, 'metadata', l.metadata_json, 'createdAt', l.created_at) ORDER BY l.created_at DESC)
              FROM (SELECT message, metadata_json, created_at FROM sync_job_logs WHERE sync_job_id = j.id ORDER BY created_at DESC LIMIT 20) l) AS recent_logs
          FROM sync_jobs j
          WHERE j.queue_name = 'sync-service'
          ORDER BY j.updated_at DESC
          LIMIT 5
        `)
      ]);

      const syncRuns = (runsRes.rows as SyncRunRow[]).map((row) => ({
        jobKey: row.job_key ?? null,
        jobName: row.job_name ?? null,
        status: row.status ?? null,
        attemptCount: Number(row.attempt_count ?? 0),
        lastError: row.last_error ?? null,
        startedAt: row.started_at ?? null,
        finishedAt: row.finished_at ?? null,
        durationMs: row.duration_ms ?? null,
        lastMessage: row.latest_log?.message ?? null,
        lastMetadata: row.latest_log?.metadata ?? null,
        recentLogs: (row.recent_logs ?? []).map((entry) => ({
          message: entry.message ?? null,
          metadata: entry.metadata ?? null,
          createdAt: entry.createdAt ?? null
        }))
      }));
      const latestRun = syncRuns[0] ?? null;

      return {
        status: "operational",
        season: "2026/2027",
        provider: "SofaScore",
        queues: allQueueNames,
        telemetry: {
          leaguesCount: Number(compRes.rows[0]?.total || 0),
          teamsCount: Number(teamRes.rows[0]?.total || 0),
          teamsWithSeasonStats: Number(teamRes.rows[0]?.with_stats || 0),
          matchesTotal: Number(matchRes.rows[0]?.total || 0),
          matchesFinished: Number(matchRes.rows[0]?.finished || 0),
          matchesScheduled: Number(matchRes.rows[0]?.scheduled || 0),
          matchesWithTelemetryStats: Number(statRes.rows[0]?.matches_with_stats || 0),
          telemetryRecords: Number(statRes.rows[0]?.total_records || 0),
          playersCount: Number(playerRes.rows[0]?.total || 0)
        },
        automation: {
          daemonEnabled: null,
          mode: latestRun ? "scheduled_service" : "not_verified",
          intervalHours: null,
          source: "sofascore_api",
          lastRunStatus: latestRun?.status ?? null,
          lastRunAt: latestRun?.finishedAt ?? null
        },
        syncRuns,
        timestamp: new Date().toISOString()
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        status: "degraded",
        error: msg,
        queues: allQueueNames,
        syncRuns: [],
        timestamp: new Date().toISOString()
      };
    } finally {
      await pool.end().catch(() => {});
    }
  }
}
