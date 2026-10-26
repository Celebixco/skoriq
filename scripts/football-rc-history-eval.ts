import "dotenv/config";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { applyPreprocessor, featureVector, pick, predict, validateModelArtifact, type ModelDefinition } from "./football-rc-prematch.js";
import { resolveCompetitionScope } from "./football-rc-scope.js";

const dir = dirname(fileURLToPath(import.meta.url));
const SPLIT = new Date("2025-07-01T00:00:00Z");
const CLASSES = ["1", "X", "2"] as const;
type Match = { match_id: string; competition_id: string; competition_name: string; country: string; season: string; source_event_id: string | null; kickoff_at: Date; status: string; home_id: string; home_team: string; away_id: string; away_team: string; home_score: number | null; away_score: number | null; home_extra: number | null; away_extra: number | null; home_pen: number | null; away_pen: number | null };
function normal(row: Match) { return row.status === "finished" && row.home_score !== null && row.away_score !== null && row.home_extra === null && row.away_extra === null && row.home_pen === null && row.away_pen === null; }
function classIndex(row: Match) { return row.home_score! > row.away_score! ? 0 : row.home_score! === row.away_score! ? 1 : 2; }
function logLoss(y: number, p: number[]) { return -Math.log(Math.max(1e-15, p[y]!)); }
function brier(y: number, p: number[]) { return p.reduce((sum, value, i) => sum + (value - (i === y ? 1 : 0)) ** 2, 0); }
function emptyMetrics() { return { n: 0, correct: 0, logLoss: 0, brier: 0, classCounts: [0,0,0], classCorrect: [0,0,0] }; }
function add(m: ReturnType<typeof emptyMetrics>, y: number, p: number[]) { m.n++; const pred = CLASSES.indexOf(pick(p)); if (pred === y) { m.correct++; m.classCorrect[y]++; } m.classCounts[y]++; m.logLoss += logLoss(y,p); m.brier += brier(y,p); }
async function main() {
  const model = JSON.parse(await readFile(join(dir, "football-rc-model.json"), "utf8")) as ModelDefinition;
  validateModelArtifact(model);
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const client = await pool.connect();
  try {
    const scope = await resolveCompetitionScope(client);
    const ids = scope.approved.map((entry) => entry.competitionId);
    const rows = (await client.query<Match>(`
      select m.id as match_id, c.id::text as competition_id, c.name as competition_name, coalesce(co.name,'') as country,
             s.name as season, m.metadata_json->>'sofascoreId' as source_event_id, m.scheduled_start_at as kickoff_at, m.status::text as status,
             ht.id as home_id, ht.name as home_team, at.id as away_id, at.name as away_team,
             fs.home_score_current as home_score, fs.away_score_current as away_score,
             fs.home_score_extra_time as home_extra, fs.away_score_extra_time as away_extra,
             fs.home_score_penalties as home_pen, fs.away_score_penalties as away_pen
      from matches m join competitions c on c.id=m.competition_id left join countries co on co.id=c.country_id
      join seasons s on s.id=m.season_id join teams ht on ht.id=m.home_team_id join teams at on at.id=m.away_team_id
      left join football_match_scores fs on fs.match_id=m.id
      where m.competition_id = any($1::uuid[]) and m.scheduled_start_at >= '2024-07-01'
      order by m.scheduled_start_at, m.id`, [ids])).rows;
    const history = new Map<string, Match[]>();
    for (const row of rows) if (normal(row)) { const list = history.get(row.competition_id) ?? []; list.push(row); history.set(row.competition_id, list); }
    const prior = new Map<string, number[]>();
    for (const comp of ids) {
      const training = rows.filter((row) => row.competition_id === comp && normal(row) && row.kickoff_at < SPLIT);
      const counts = [0,0,0]; for (const row of training) counts[classIndex(row)]!++;
      const total = counts.reduce((a,b)=>a+b,0); prior.set(comp, total ? counts.map((n)=>n/total) : [1/3,1/3,1/3]);
    }
    const result: Record<string, { league: string; split: string; rc: ReturnType<typeof emptyMetrics>; ra: ReturnType<typeof emptyMetrics>; fixed: ReturnType<typeof emptyMetrics>; allHome: { n: number; correct: number }; predictions: number }> = {};
    for (const target of rows) {
      if (!normal(target) || target.kickoff_at < SPLIT) continue;
      const h = history.get(target.competition_id) ?? [];
      const f = featureVector(target, h, model);
      if (f.homeN < 3 || f.awayN < 3) continue;
      let x: number[]; let rc: number[]; let ra: number[];
      try { x = applyPreprocessor(f.features, model); rc = predict(model, x, "R-C"); ra = predict(model, x, "R-A"); } catch { continue; }
      const y = classIndex(target);
      const key = target.competition_name;
      const entry = result[key] ??= { league: key, split: SPLIT.toISOString(), rc: emptyMetrics(), ra: emptyMetrics(), fixed: emptyMetrics(), allHome: { n: 0, correct: 0 }, predictions: 0 };
      add(entry.rc, y, rc); add(entry.ra, y, ra); add(entry.fixed, y, prior.get(target.competition_id) ?? [1/3,1/3,1/3]);
      entry.allHome.n++; if (y === 0) entry.allHome.correct++;
      entry.predictions++;
    }
    for (const entry of Object.values(result)) {
      for (const m of [entry.rc, entry.ra, entry.fixed]) { m.logLoss /= m.n; m.brier /= m.n; }
    }
    console.log(JSON.stringify({ mode: "history_eval", split: SPLIT.toISOString(), results: result, prior: Object.fromEntries(prior) }, null, 2));
  } finally { client.release(); await pool.end(); }
}
main().catch((error) => { console.error(error); process.exit(1); });
