import "dotenv/config";
import pg from "pg";

/**
 * Settles published Tork (BTTS) predictions once a finished match has a
 * verified normal-time score. Rows are only written when the score is
 * present; an existing row is corrected in place when the stored outcome no
 * longer matches the current football_match_scores record.
 */
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
const client = await pool.connect();
try {
  const rows = await client.query<{ id: string; match_id: string; competition_id: string; status: string; home_score: number | null; away_score: number | null; extra: boolean; pens: boolean }>(`
    select p.id, p.match_id, m.competition_id, m.status::text as status,
           fs.home_score_current as home_score, fs.away_score_current as away_score,
           (fs.home_score_extra_time is not null or fs.away_score_extra_time is not null) as extra,
           (fs.home_score_penalties is not null or fs.away_score_penalties is not null) as pens
    from football_tork_prematch_predictions p
    join matches m on m.id = p.match_id
    left join football_match_scores fs on fs.match_id = m.id
    where p.status = 'published'
      and m.status in ('finished', 'after_extra_time', 'after_penalties')
  `);
  let written = 0;
  const skippedNoScore: string[] = [];
  await client.query("begin");
  for (const row of rows.rows) {
    let normal = "unknown_normal_time";
    if (row.status === "finished" && !row.extra && !row.pens && row.home_score !== null && row.away_score !== null) normal = "verified_normal_time";
    else if (row.status === "after_extra_time" || row.extra) normal = "after_extra_time";
    else if (row.status === "after_penalties" || row.pens) normal = "after_penalties";
    if (normal === "unknown_normal_time" || row.home_score === null || row.away_score === null) {
      skippedNoScore.push(row.id);
      continue;
    }
    const label = normal === "verified_normal_time"
      ? (row.home_score! >= 1 && row.away_score! >= 1 ? "btts_yes" : "btts_no") : null;
    const result = await client.query(`insert into football_tork_prematch_results
      (prediction_id, match_id, competition_id, home_score_fulltime, away_score_fulltime, btts_outcome, fulltime_status, result_label, resolved_at, source_label, metadata_json)
      values ($1,$2,$3,$4,$5,$6,$7,$8,now(),'production_db',$9)
      on conflict (prediction_id) do update set
        home_score_fulltime = excluded.home_score_fulltime,
        away_score_fulltime = excluded.away_score_fulltime,
        btts_outcome = excluded.btts_outcome,
        fulltime_status = excluded.fulltime_status,
        result_label = excluded.result_label,
        resolved_at = now(),
        metadata_json = football_tork_prematch_results.metadata_json || '{"repairedBy":"football-tork-settle"}'::jsonb
      where football_tork_prematch_results.home_score_fulltime is distinct from excluded.home_score_fulltime
         or football_tork_prematch_results.away_score_fulltime is distinct from excluded.away_score_fulltime
         or football_tork_prematch_results.btts_outcome is distinct from excluded.btts_outcome
         or football_tork_prematch_results.result_label is distinct from excluded.result_label`,
      [row.id, row.match_id, row.competition_id, row.home_score, row.away_score,
       normal === "verified_normal_time" ? (row.home_score! >= 1 && row.away_score! >= 1 ? 1 : 0) : null,
       normal, label, JSON.stringify({ settledBy: "football-tork-settle" })]);
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
