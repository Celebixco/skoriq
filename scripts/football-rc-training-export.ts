import "dotenv/config";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { featureVector, validateModelArtifact, type ModelDefinition } from "./football-rc-prematch.js";
import { resolveCompetitionScope } from "./football-rc-scope.js";

const dir = dirname(fileURLToPath(import.meta.url));
type Match = { match_id: string; competition_id: string; competition_name: string; country: string; season: string; source_event_id: string | null; kickoff_at: Date; status: string; home_id: string; home_team: string; away_id: string; away_team: string; home_score: number | null; away_score: number | null; home_extra: number | null; away_extra: number | null; home_pen: number | null; away_pen: number | null };
function normal(row: Match) { return row.status === "finished" && row.home_score !== null && row.away_score !== null && row.home_extra === null && row.away_extra === null && row.home_pen === null && row.away_pen === null; }
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
    const samples = [];
    for (const target of rows) {
      if (!normal(target)) continue;
      const f = featureVector(target, history.get(target.competition_id) ?? [], model);
      if (f.homeN < 3 || f.awayN < 3) continue;
      const label = target.home_score! > target.away_score! ? 1 : target.home_score! === target.away_score! ? 2 : 3;
      samples.push({ matchId: target.match_id, league: target.competition_name, kickoffAt: target.kickoff_at.toISOString(), features: f.features, label });
    }
    console.log(JSON.stringify({ modelVersion: model.modelVersion, featureOrder: model.features, samples }));
  } finally { client.release(); await pool.end(); }
}
main().catch((error) => { console.error(error); process.exit(1); });
