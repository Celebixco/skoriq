import "dotenv/config";
import pg from "pg";

/**
 * Settles published H1 (first-half goal) predictions once the match has a
 * recorded halftime score. The first-half result is valid regardless of extra
 * time or penalties, so unlike R-C these matches still settle; only matches
 * without any halftime score stay pending for a later pass.
 */
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
const client = await pool.connect();
try {
  const rows = await client.query<{ id: string; match_id: string; competition_id: string; status: string; home_ht: number | null; away_ht: number | null }>(`
    select p.id, p.match_id, m.competition_id, m.status::text as status,
           fs.home_score_halftime as home_ht, fs.away_score_halftime as away_ht
    from football_h1_prematch_predictions p
    join matches m on m.id = p.match_id
    left join football_match_scores fs on fs.match_id = m.id
    where p.status = 'published'
      and m.status in ('finished', 'after_extra_time', 'after_penalties')
  `);
  let written = 0;
  const skippedNoScore: string[] = [];
  await client.query("begin");
  for (const row of rows.rows) {
    if (row.home_ht === null || row.away_ht === null) {
      // Halftime score not synced yet: stay pending, a later pass settles it.
      skippedNoScore.push(row.id);
      continue;
    }
    const h1Goals = row.home_ht + row.away_ht;
    const label = h1Goals >= 1 ? "over_0_5" : "under_0_5";
    const result = await client.query(`insert into football_h1_prematch_results
      (prediction_id, match_id, competition_id, home_score_halftime, away_score_halftime, h1_goals, halftime_status, result_label, resolved_at, source_label, metadata_json)
      values ($1,$2,$3,$4,$5,$6,'verified_halftime',$7,now(),'production_db',$8)
      on conflict (prediction_id) do update set
        home_score_halftime = excluded.home_score_halftime,
        away_score_halftime = excluded.away_score_halftime,
        h1_goals = excluded.h1_goals,
        halftime_status = excluded.halftime_status,
        result_label = excluded.result_label,
        resolved_at = now(),
        metadata_json = football_h1_prematch_results.metadata_json || '{"repairedBy":"football-h1-settle"}'::jsonb
      where football_h1_prematch_results.home_score_halftime is distinct from excluded.home_score_halftime
         or football_h1_prematch_results.away_score_halftime is distinct from excluded.away_score_halftime
         or football_h1_prematch_results.h1_goals is distinct from excluded.h1_goals
         or football_h1_prematch_results.result_label is distinct from excluded.result_label`,
      [row.id, row.match_id, row.competition_id, row.home_ht, row.away_ht, h1Goals, label,
       JSON.stringify({ settledBy: "football-h1-settle", matchStatus: row.status })]);
    written += result.rowCount ?? 0;
  }
  await client.query("commit");
  console.log(JSON.stringify({ mode: "settle", scanned: rows.rows.length, writtenOrCorrected: written, skippedNoScore: skippedNoScore.length }));
} catch (error) {
  await client.query("rollback");
  throw error;
} finally {
  client.release(); await pool.end();
}
