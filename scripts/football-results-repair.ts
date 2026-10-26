import "dotenv/config";
import pg from "pg";

/**
 * One-shot repair for stale score data that surfaced as wrong "0-0" results:
 *
 * 1. REPORT (always): finished matches with missing/zero/suspicious
 *    football_match_scores fields over the last 30 days.
 * 2. REPAIR (--execute): backfill home/away_score_fulltime from
 *    home/away_score_current on finished matches where fulltime is null.
 *    Self-healing settle jobs (football-rc-settle / football-h1-settle) then
 *    correct any stale settlement rows on their next 15-minute pass.
 *
 * Matches whose current score is itself stuck at 0-0 cannot be fixed here;
 * re-run the provider finished sync (npm run provider:football:finished-sync)
 * against production first, then run this script again.
 */
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const execute = process.argv.includes("--execute");
const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
const client = await pool.connect();

interface MatchAuditRow {
  match_id: string;
  league: string;
  kickoff_at: Date;
  home_team: string;
  away_team: string;
  status: string;
  has_score_row: boolean;
  home_current: number | null;
  away_current: number | null;
  home_fulltime: number | null;
  away_fulltime: number | null;
  home_ht: number | null;
  away_ht: number | null;
}

try {
  const rows = (await client.query<MatchAuditRow>(`
    select m.id as match_id, c.name as league, m.scheduled_start_at as kickoff_at,
           ht.name as home_team, at.name as away_team, m.status::text as status,
           (fs.id is not null) as has_score_row,
           fs.home_score_current as home_current, fs.away_score_current as away_current,
           fs.home_score_fulltime as home_fulltime, fs.away_score_fulltime as away_fulltime,
           fs.home_score_halftime as home_ht, fs.away_score_halftime as away_ht
    from matches m
    join competitions c on c.id = m.competition_id
    join teams ht on ht.id = m.home_team_id
    join teams at on at.id = m.away_team_id
    left join football_match_scores fs on fs.match_id = m.id
    where m.status in ('finished', 'after_extra_time', 'after_penalties')
      and m.scheduled_start_at > now() - interval '30 days'
    order by m.scheduled_start_at desc
  `)).rows;

  const audit = {
    total: rows.length,
    missingScoreRow: [] as MatchAuditRow[],
    missingCurrentScore: [] as MatchAuditRow[],
    missingFulltime: [] as MatchAuditRow[],
    missingHalftime: [] as MatchAuditRow[],
    zeroZeroSuspicious: [] as MatchAuditRow[]
  };
  for (const row of rows) {
    if (!row.has_score_row) audit.missingScoreRow.push(row);
    if (row.has_score_row && (row.home_current === null || row.away_current === null)) audit.missingCurrentScore.push(row);
    if (row.has_score_row && row.home_current !== null && row.home_fulltime === null) audit.missingFulltime.push(row);
    if (row.has_score_row && (row.home_ht === null || row.away_ht === null)) audit.missingHalftime.push(row);
    if (row.has_score_row && row.home_current === 0 && row.away_current === 0 && row.home_fulltime === 0 && row.away_fulltime === 0) audit.zeroZeroSuspicious.push(row);
  }

  let repairedFulltime = 0;
  if (execute) {
    await client.query("begin");
    const result = await client.query(`
      update football_match_scores fs
      set home_score_fulltime = fs.home_score_current,
          away_score_fulltime = fs.away_score_current,
          updated_at = now()
      from matches m
      where m.id = fs.match_id
        and m.status in ('finished', 'after_extra_time', 'after_penalties')
        and fs.home_score_current is not null
        and fs.away_score_current is not null
        and (fs.home_score_fulltime is null or fs.away_score_fulltime is null)
      `);
    repairedFulltime = result.rowCount ?? 0;
    await client.query("commit");
  }

  const brief = (list: MatchAuditRow[], limit = 8) => list.slice(0, limit).map((row) => ({
    matchId: row.match_id, league: row.league, kickoffAt: row.kickoff_at.toISOString(),
    match: `${row.home_team} - ${row.away_team}`, status: row.status,
    current: row.home_current !== null ? `${row.home_current}-${row.away_current}` : null,
    fulltime: row.home_fulltime !== null ? `${row.home_fulltime}-${row.away_fulltime}` : null,
    halftime: row.home_ht !== null ? `${row.home_ht}-${row.away_ht}` : null
  }));

  console.log(JSON.stringify({
    mode: execute ? "execute" : "dry_run",
    windowDays: 30,
    scanned: audit.total,
    counts: {
      missingScoreRow: audit.missingScoreRow.length,
      missingCurrentScore: audit.missingCurrentScore.length,
      missingFulltime: audit.missingFulltime.length,
      missingHalftime: audit.missingHalftime.length,
      zeroZeroSuspicious: audit.zeroZeroSuspicious.length
    },
    samples: {
      missingScoreRow: brief(audit.missingScoreRow),
      missingCurrentScore: brief(audit.missingCurrentScore),
      missingFulltime: brief(audit.missingFulltime),
      zeroZeroSuspicious: brief(audit.zeroZeroSuspicious, 20)
    },
    repairedFulltime,
    note: "Skorları 0-0 kalmış maçlar için önce üretimde provider finished-sync çalıştır, sonra bu scripti tekrar koştur; settle işleri kalıntı sonuçları 15 dakika içinde kendiliğinden düzeltir."
  }, null, 2));
} finally {
  client.release();
  await pool.end();
}
