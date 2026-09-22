import { Controller, Get, Post, UseGuards } from "@nestjs/common";
import { allQueueNames } from "@sports-data/queue";
import { loadConfig } from "@sports-data/config";
import pg from "pg";

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
      const [compRes, teamRes, matchRes, statRes, playerRes] = await Promise.all([
        pool.query("SELECT COUNT(*) AS total FROM competitions"),
        pool.query("SELECT COUNT(*) AS total, COUNT(CASE WHEN metadata_json->'season_statistics' IS NOT NULL THEN 1 END) AS with_stats FROM teams"),
        pool.query("SELECT COUNT(*) AS total, COUNT(CASE WHEN status = 'finished' THEN 1 END) AS finished, COUNT(CASE WHEN status = 'scheduled' THEN 1 END) AS scheduled FROM matches"),
        pool.query("SELECT COUNT(DISTINCT match_id) AS matches_with_stats, COUNT(*) AS total_records FROM football_match_team_statistics"),
        pool.query("SELECT COUNT(*) AS total FROM players").catch(() => ({ rows: [{ total: 0 }] }))
      ]);

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
          daemonEnabled: true,
          mode: "continuous",
          intervalHours: 3,
          source: "sofascore_catalog.json"
        },
        timestamp: new Date().toISOString()
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        status: "degraded",
        error: msg,
        queues: allQueueNames,
        timestamp: new Date().toISOString()
      };
    } finally {
      await pool.end().catch(() => {});
    }
  }
}
