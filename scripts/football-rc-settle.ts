import "dotenv/config";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
const client = await pool.connect();
try {
  const rows = await client.query<{ id: string; match_id: string; competition_id: string; status: string; home_score: number | null; away_score: number | null; extra: boolean; pens: boolean }>(`
    select p.id, p.match_id, m.competition_id, m.status::text as status, fs.home_score_current as home_score, fs.away_score_current as away_score,
           (fs.home_score_extra_time is not null or fs.away_score_extra_time is not null) as extra,
           (fs.home_score_penalties is not null or fs.away_score_penalties is not null) as pens
    from football_rc_prematch_predictions p
    join matches m on m.id = p.match_id
    left join football_match_scores fs on fs.match_id = m.id
    where p.status = 'published'
      and m.status in ('finished', 'after_extra_time', 'after_penalties')
      and not exists (select 1 from football_rc_prematch_results r where r.prediction_id = p.id)
  `);
  let inserted = 0;
  await client.query("begin");
  for (const row of rows.rows) {
    let normal = "unknown_normal_time";
    if (row.status === "finished" && !row.extra && !row.pens && row.home_score !== null && row.away_score !== null) normal = "verified_normal_time";
    else if (row.status === "after_extra_time" || row.extra) normal = "after_extra_time";
    else if (row.status === "after_penalties" || row.pens) normal = "after_penalties";
    const label = normal === "verified_normal_time" && row.home_score !== null && row.away_score !== null
      ? (row.home_score > row.away_score ? "1" : row.home_score === row.away_score ? "X" : "2") : null;
    const result = await client.query(`insert into football_rc_prematch_results
      (prediction_id, match_id, competition_id, home_score_90, away_score_90, normal_time_status, result_label, resolved_at, source_label, metadata_json)
      values ($1,$2,$3,$4,$5,$6,$7,now(),'production_db',$8) on conflict (prediction_id) do nothing`,
      [row.id, row.match_id, row.competition_id, row.home_score, row.away_score, normal, label, JSON.stringify({ settledBy: "football-rc-settle" })]);
    inserted += result.rowCount ?? 0;
  }
  await client.query("commit");
  console.log(JSON.stringify({ mode: "settle", scanned: rows.rows.length, inserted }));
} catch (error) {
  await client.query("rollback");
  throw error;
} finally {
  client.release(); await pool.end();
}
