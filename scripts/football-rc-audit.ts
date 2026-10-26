import "dotenv/config";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { applyPreprocessor, featureVector, pick, predict, validateModelArtifact, validateProbabilities, type ModelDefinition } from "./football-rc-prematch.js";
import { resolveCompetitionScope } from "./football-rc-scope.js";

const dir = dirname(fileURLToPath(import.meta.url));
type Match = {
  match_id: string; competition_id: string; competition_name: string; country: string; season: string;
  source_event_id: string | null; kickoff_at: Date; status: string; home_id: string; home_team: string; away_id: string; away_team: string;
  home_score: number | null; away_score: number | null; home_extra: number | null; away_extra: number | null;
  home_pen: number | null; away_pen: number | null;
};
type Stored = {
  match_id: string; competition_id: string; p1: number; px: number; p2: number; pick: string;
  feature_hash: string; model_version: string; model_id: string; history_home_n: number; history_away_n: number;
  prediction_generated_at: Date; source_snapshot_hash: string;
};
function sha(value: string) { return createHash("sha256").update(value).digest("hex"); }
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
function normal(row: Match) {
  return row.status === "finished" && row.home_score !== null && row.away_score !== null && row.home_extra === null && row.away_extra === null && row.home_pen === null && row.away_pen === null;
}
function contributions(model: ModelDefinition, x: number[], against: 1 | 2) {
  const w = model.models["R-C"].weights;
  const rows = model.features.map((name, i) => ({ name, value: x[i]!, contribution: x[i]! * (w[i + 1]![0]! - w[i + 1]![against]!) }));
  const intercept = w[0]![0]! - w[0]![against]!;
  return { intercept, total: intercept + rows.reduce((sum, row) => sum + row.contribution, 0), top: rows.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution)).slice(0, 6) };
}
async function main() {
  const model = JSON.parse(await readFile(join(dir, "football-rc-model.json"), "utf8")) as ModelDefinition;
  validateModelArtifact(model);
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const client = await pool.connect();
  try {
    const scope = await resolveCompetitionScope(client);
    const ids = scope.approved.map((entry) => entry.competitionId);
    const all = await client.query<Match>(`
      select m.id as match_id, c.id::text as competition_id, c.name as competition_name, coalesce(co.name, '') as country,
             m.metadata_json->>'sofascoreId' as source_event_id,
             s.name as season, m.scheduled_start_at as kickoff_at, m.status::text as status,
             ht.id as home_id, ht.name as home_team, at.id as away_id, at.name as away_team,
             fs.home_score_current as home_score, fs.away_score_current as away_score,
             fs.home_score_extra_time as home_extra, fs.away_score_extra_time as away_extra,
             fs.home_score_penalties as home_pen, fs.away_score_penalties as away_pen
      from matches m join competitions c on c.id=m.competition_id left join countries co on co.id=c.country_id
      join seasons s on s.id=m.season_id join teams ht on ht.id=m.home_team_id join teams at on at.id=m.away_team_id
      left join football_match_scores fs on fs.match_id=m.id
      where m.competition_id = any($1::uuid[]) and m.scheduled_start_at >= '2024-07-01'
      order by m.scheduled_start_at, m.id`, [ids]);
    const history = new Map<string, Match[]>();
    for (const row of all.rows) if (normal(row)) { const list = history.get(row.competition_id) ?? []; list.push(row); history.set(row.competition_id, list); }
    const stored = await client.query<Stored>(`
      select p.match_id, p.competition_id::text, p.p1, p.px, p.p2, p.pick, p.feature_hash, p.model_version, p.model_id,
             p.history_home_n, p.history_away_n, p.prediction_generated_at, p.source_snapshot_hash
      from football_rc_prematch_predictions p
      where p.model_id='R-C' and p.status='published' and p.competition_id = any($1::uuid[])
      order by p.competition_id, p.match_id`, [ids]);
    const byId = new Map(all.rows.map((row) => [row.match_id, row]));
    const results: Array<Record<string, unknown>> = [];
    for (const s of stored.rows) {
      const target = byId.get(s.match_id);
      if (!target) { results.push({ matchId: s.match_id, status: "target_missing" }); continue; }
      const f = featureVector(target, history.get(target.competition_id) ?? [], model);
      const featureHash = sha(stable(f.features));
      const missing = Object.values(f.features).filter((value) => !Number.isFinite(value)).length;
      const audit: Record<string, unknown> = { matchId: s.match_id, league: target.competition_name, home: target.home_team, away: target.away_team, kickoffAt: target.kickoff_at.toISOString(), features: f.features, featureHash, storedFeatureHash: s.feature_hash, featureHashMatch: featureHash === s.feature_hash, missingFeatures: missing, historyHomeN: f.homeN, historyAwayN: f.awayN, sourceMatchIds: [...new Set([...f.trace.home5, ...f.trace.home10, ...f.trace.away5, ...f.trace.away10, ...f.trace.homeSide5, ...f.trace.awaySide5].map((row) => row.match_id))], stored: { p1: s.p1, px: s.px, p2: s.p2, pick: s.pick } };
      try {
        const x = applyPreprocessor(f.features, model);
        const rc = predict(model, x, "R-C");
        validateProbabilities(rc);
        const ra = predict(model, x, "R-A");
        const selected = pick(rc);
        audit.calculated = { rc: { p1: rc[0], px: rc[1], p2: rc[2], pick: selected }, ra: { p1: ra[0], px: ra[1], p2: ra[2], pick: pick(ra) } };
        audit.probabilityMaxDiff = Math.max(Math.abs(rc[0]! - s.p1), Math.abs(rc[1]! - s.px), Math.abs(rc[2]! - s.p2));
        audit.pickMatch = selected === s.pick;
        audit.relative = { homeVsDraw: contributions(model, x, 1), homeVsAway: contributions(model, x, 2) };
      } catch (error) {
        audit.calculationError = error instanceof Error ? error.message : String(error);
      }
      results.push(audit);
    }
    const leagues: Record<string, { matches: number; picks: Record<string, number>; avgP1: number; avgPx: number; avgP2: number; avgGap12: number; hashMismatches: number; probabilityMismatches: number; pickMismatches: number; missingFeatures: number }> = {};
    for (const row of results) {
      if (!row.league) continue;
      const l = leagues[String(row.league)] ??= { matches: 0, picks: {}, avgP1: 0, avgPx: 0, avgP2: 0, avgGap12: 0, hashMismatches: 0, probabilityMismatches: 0, pickMismatches: 0, missingFeatures: 0 };
      l.matches++;
      const storedRow = row.stored as { p1: number; px: number; p2: number; pick: string };
      l.picks[storedRow.pick] = (l.picks[storedRow.pick] ?? 0) + 1;
      l.avgP1 += storedRow.p1; l.avgPx += storedRow.px; l.avgP2 += storedRow.p2; l.avgGap12 += Math.abs(storedRow.p1 - storedRow.px);
      if (!row.featureHashMatch) l.hashMismatches++;
      if (typeof row.probabilityMaxDiff === "number" && row.probabilityMaxDiff > 1e-12) l.probabilityMismatches++;
      if (!row.pickMatch) l.pickMismatches++;
      if (row.missingFeatures) l.missingFeatures++;
    }
    for (const l of Object.values(leagues)) { l.avgP1 /= l.matches; l.avgPx /= l.matches; l.avgP2 /= l.matches; l.avgGap12 /= l.matches; }
    console.log(JSON.stringify({ mode: "audit", approved: scope.approved, modelVersion: model.modelVersion, matches: stored.rows.length, leagues, results }, null, 2));
  } finally { client.release(); await pool.end(); }
}
main().catch((error) => { console.error(error); process.exit(1); });
