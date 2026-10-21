import "dotenv/config";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const dir = dirname(fileURLToPath(import.meta.url));
const MODEL_VERSION = "stage11-fixed-R-A-R-C";
const HORIZON_SECONDS = 86_400;
const SETTLE_SECONDS = 10_800;
const COMPETITION_NAME = "Trendyol Süper Lig";
const CLASSES = ["1", "X", "2"] as const;

type ClassLabel = (typeof CLASSES)[number];

interface ModelDefinition {
  modelVersion: string;
  displayVersion: string;
  features: string[];
  preprocessor: { medians: number[]; mean: number[]; std: number[] };
  lambda: number;
  classOrder: ClassLabel[];
  models: Record<"R-A" | "R-C", { trainingExamples: number; weights: number[][]; modelHash: string }>;
}

interface MatchRow {
  match_id: string;
  source_event_id: string | null;
  season: string;
  kickoff_at: Date;
  status: string;
  home_id: string;
  home_team: string;
  away_id: string;
  away_team: string;
  home_score: number | null;
  away_score: number | null;
  home_extra: number | null;
  away_extra: number | null;
  home_pen: number | null;
  away_pen: number | null;
}

interface InitialPrediction {
  matchId: string;
  kickoffAt: string;
  predictionGeneratedAt: string;
  featureAsOfAt: string;
  actualLeadSeconds: number;
  historyHomeN: number;
  historyAwayN: number;
  scopeLevel: string;
  historyCompleteness: string;
  featureHash: string;
  sourceSnapshotHash: string;
  "R-A": { p1: number; px: number; p2: number; pick: string; modelHash: string };
  "R-C": { p1: number; px: number; p2: number; pick: string; modelHash: string };
}

function sha(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function parseDate(value: string): Date {
  return new Date(value);
}

function addSeconds(value: Date, seconds: number): Date {
  return new Date(value.getTime() + seconds * 1000);
}

function isNormalResult(row: MatchRow): boolean {
  return row.status === "finished" && row.home_score !== null && row.away_score !== null &&
    row.home_extra === null && row.away_extra === null && row.home_pen === null && row.away_pen === null;
}

function aggregate(rows: MatchRow[], teamId: string) {
  const n = rows.length;
  if (n === 0) return { ppg: Number.NaN, gf: Number.NaN, ga: Number.NaN, draw: Number.NaN, n: 0 };
  let points = 0; let gf = 0; let ga = 0; let draws = 0;
  for (const row of rows) {
    const home = row.home_id === teamId;
    const f = home ? row.home_score! : row.away_score!;
    const a = home ? row.away_score! : row.home_score!;
    gf += f; ga += a;
    if (f > a) points += 3; else if (f === a) { points += 1; draws += 1; }
  }
  return { ppg: points / n, gf: gf / n, ga: ga / n, draw: draws / n, n };
}

function prior(history: MatchRow[], teamId: string, kickoff: Date, cutoff: Date, side?: "home" | "away", limit = 10): MatchRow[] {
  return history.filter((row) => {
    if (row.home_id !== teamId && row.away_id !== teamId) return false;
    if (row.kickoff_at >= kickoff) return false;
    if (addSeconds(row.kickoff_at, SETTLE_SECONDS) > cutoff) return false;
    if (side === "home" && row.home_id !== teamId) return false;
    if (side === "away" && row.away_id !== teamId) return false;
    return true;
  }).sort((a, b) => a.kickoff_at.getTime() - b.kickoff_at.getTime() || a.match_id.localeCompare(b.match_id)).slice(-limit);
}

function featureVector(target: MatchRow, history: MatchRow[], model: ModelDefinition) {
  const kickoff = target.kickoff_at;
  const cutoff = addSeconds(kickoff, -HORIZON_SECONDS);
  const h5 = prior(history, target.home_id, kickoff, cutoff, undefined, 5);
  const h10 = prior(history, target.home_id, kickoff, cutoff, undefined, 10);
  const a5 = prior(history, target.away_id, kickoff, cutoff, undefined, 5);
  const a10 = prior(history, target.away_id, kickoff, cutoff, undefined, 10);
  const hh5 = prior(history, target.home_id, kickoff, cutoff, "home", 5);
  const aa5 = prior(history, target.away_id, kickoff, cutoff, "away", 5);
  const h5a = aggregate(h5, target.home_id); const h10a = aggregate(h10, target.home_id);
  const a5a = aggregate(a5, target.away_id); const a10a = aggregate(a10, target.away_id);
  const hha = aggregate(hh5, target.home_id); const aaa = aggregate(aa5, target.away_id);
  const features: Record<string, number> = {
    h_ppg5: h5a.ppg, h_gf5: h5a.gf, h_ga5: h5a.ga, h_draw5: h5a.draw, h_n5: h5a.n,
    h_ppg10: h10a.ppg, h_gf10: h10a.gf, h_ga10: h10a.ga, h_draw10: h10a.draw, h_n10: h10a.n,
    a_ppg5: a5a.ppg, a_gf5: a5a.gf, a_ga5: a5a.ga, a_draw5: a5a.draw, a_n5: a5a.n,
    a_ppg10: a10a.ppg, a_gf10: a10a.gf, a_ga10: a10a.ga, a_draw10: a10a.draw, a_n10: a10a.n,
    h_home_ppg5: hha.ppg, h_home_gf5: hha.gf, h_home_ga5: hha.ga, h_home_n5: hha.n,
    a_away_ppg5: aaa.ppg, a_away_gf5: aaa.gf, a_away_ga5: aaa.ga, a_away_n5: aaa.n,
    diff_ppg5: h5a.ppg - a5a.ppg, diff_gf5: h5a.gf - a5a.gf, diff_ga5: h5a.ga - a5a.ga, diff_draw5: h5a.draw - a5a.draw,
    h_short5: h5a.n < 5 ? 1 : 0, a_short5: a5a.n < 5 ? 1 : 0
  };
  const scope = h10a.n >= 10 && a10a.n >= 10 ? "last10_available_unverified"
    : h5a.n >= 5 && a5a.n >= 5 ? "last5_available_unverified"
    : h5a.n > 0 && a5a.n > 0 ? "partial_history_unverified"
    : h5a.n === 0 && a5a.n === 0 ? "no_history" : "one_side_no_history";
  return { features, scope, homeN: h10a.n, awayN: a10a.n, trace: { home5: h5, home10: h10, away5: a5, away10: a10, homeSide5: hh5, awaySide5: aa5 } };
}

function applyPreprocessor(features: Record<string, number>, model: ModelDefinition): number[] {
  return model.features.map((name, index) => {
    const raw = Number.isFinite(features[name]) ? features[name]! : model.preprocessor.medians[index]!;
    return (raw - model.preprocessor.mean[index]!) / model.preprocessor.std[index]!;
  });
}

function softmax(values: number[]): number[] {
  const max = Math.max(...values);
  const exp = values.map((v) => Math.exp(v - max));
  const total = exp.reduce((a, b) => a + b, 0);
  return exp.map((v) => v / total);
}

function predict(model: ModelDefinition, x: number[], arm: "R-A" | "R-C"): number[] {
  const weights = model.models[arm].weights;
  const logits = [0, 1, 2].map((k) => weights[0]![k]! + x.reduce((sum, value, i) => sum + value * weights[i + 1]![k]!, 0));
  return softmax(logits);
}

function pick(probabilities: number[]): ClassLabel {
  let best = 0;
  for (let i = 1; i < probabilities.length; i++) if (probabilities[i]! > probabilities[best]!) best = i;
  return CLASSES[best]!;
}

function rankX(probabilities: number[]): number {
  const order = [0, 1, 2].sort((a, b) => probabilities[b]! - probabilities[a]! || a - b);
  return order.indexOf(1) + 1;
}

async function main() {
  const args = process.argv.slice(2);
  const execute = args.includes("--execute");
  const seed = args.includes("--seed");
  if (!execute) throw new Error("--execute is required; this job never writes in dry-run mode.");
  const model = JSON.parse(await readFile(join(dir, "football-rc-model.json"), "utf8")) as ModelDefinition;
  if (model.features.length !== 34 || model.classOrder.join(",") !== "1,X,2") throw new Error("invalid production model artifact");
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
  const client = await pool.connect();
  const startedAt = new Date();
  try {
    await client.query("begin");
    if (seed) {
      const document = JSON.parse(await readFile(join(dir, "football-rc-initial-predictions.json"), "utf8")) as { predictions: InitialPrediction[] };
      let inserted = 0; let skipped = 0;
      for (const item of document.predictions) {
        const match = await client.query<{ id: string; scheduled_start_at: Date; status: string }>("select id, scheduled_start_at, status from matches where id = $1", [item.matchId]);
        if (!match.rows[0] || match.rows[0].status !== "scheduled" || match.rows[0].scheduled_start_at <= startedAt) { skipped += 2; continue; }
        for (const arm of ["R-A", "R-C"] as const) {
          const p = item[arm];
          const result = await client.query(`insert into football_rc_prematch_predictions
            (match_id, model_id, model_version, kickoff_at, prediction_generated_at, published_at,
             prediction_cutoff_at, feature_as_of_at, actual_lead_seconds, p1, px, p2, pick,
             history_home_n, history_away_n, scope_level, history_completeness, feature_hash, model_hash,
             source_snapshot_hash, status, metadata_json)
            values ($1,$2,$3,$4,$5,now(),$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'published',$20)
            on conflict (match_id, model_id, model_version) do nothing`,
            [item.matchId, arm, model.modelVersion, new Date(item.kickoffAt), new Date(item.predictionGeneratedAt),
             new Date(new Date(item.kickoffAt).getTime() - HORIZON_SECONDS * 1000), new Date(item.featureAsOfAt), item.actualLeadSeconds,
             p.p1, p.px, p.p2, p.pick, item.historyHomeN, item.historyAwayN, item.scopeLevel, item.historyCompleteness,
             item.featureHash, p.modelHash, item.sourceSnapshotHash, JSON.stringify({ displayVersion: model.displayVersion, seededFrom: "stage12_1_initial_package" })]);
          inserted += result.rowCount ?? 0;
        }
      }
      await client.query("commit");
      console.log(JSON.stringify({ mode: "seed", execute, inserted, skipped, modelVersion: model.modelVersion, at: startedAt.toISOString() }));
      return;
    }

    const rows = await client.query<MatchRow>(`
      select m.id as match_id, m.metadata_json->>'sofascoreId' as source_event_id, s.name as season,
             m.scheduled_start_at as kickoff_at, m.status::text as status,
             ht.id as home_id, ht.name as home_team, at.id as away_id, at.name as away_team,
             fs.home_score_current as home_score, fs.away_score_current as away_score,
             fs.home_score_extra_time as home_extra, fs.away_score_extra_time as away_extra,
             fs.home_score_penalties as home_pen, fs.away_score_penalties as away_pen
      from matches m
      join competitions c on c.id = m.competition_id
      join seasons s on s.id = m.season_id
      join teams ht on ht.id = m.home_team_id
      join teams at on at.id = m.away_team_id
      left join football_match_scores fs on fs.match_id = m.id
      where c.name = $1 and m.scheduled_start_at >= '2024-07-01'
      order by m.scheduled_start_at, m.id`, [COMPETITION_NAME]);
    const history = rows.rows.filter(isNormalResult);
    const windowStart = new Date(startedAt.getTime() + 24 * 3600 * 1000);
    const windowEnd = new Date(startedAt.getTime() + 7 * 24 * 3600 * 1000);
    const candidates = rows.rows.filter((row) => row.status === "scheduled" && row.kickoff_at >= windowStart && row.kickoff_at <= windowEnd);
    const sourceHash = sha(stable(rows.rows.map((row) => ({ ...row, kickoff_at: row.kickoff_at.toISOString() }))));
    const generatedAt = new Date();
    let inserted = 0; const blocked: Array<{ matchId: string; reason: string }> = [];
    for (const candidate of candidates) {
      const f = featureVector(candidate, history, model);
      if (f.homeN < 3 || f.awayN < 3) { blocked.push({ matchId: candidate.match_id, reason: "fewer_than_3_prior_results" }); continue; }
      const x = applyPreprocessor(f.features, model);
      const cutoff = addSeconds(candidate.kickoff_at, -HORIZON_SECONDS);
      if (generatedAt > cutoff) { blocked.push({ matchId: candidate.match_id, reason: "prediction_after_cutoff" }); continue; }
      const featureHash = sha(stable(f.features));
      for (const arm of ["R-A", "R-C"] as const) {
        const probabilities = predict(model, x, arm);
        const result = await client.query(`insert into football_rc_prematch_predictions
          (match_id, model_id, model_version, kickoff_at, prediction_generated_at, published_at,
           prediction_cutoff_at, feature_as_of_at, actual_lead_seconds, p1, px, p2, pick,
           history_home_n, history_away_n, scope_level, history_completeness, feature_hash, model_hash,
           source_snapshot_hash, status, metadata_json)
          values ($1,$2,$3,$4,$5,now(),$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'unverified',$16,$17,$18,'published',$19)
          on conflict (match_id, model_id, model_version) do nothing`,
          [candidate.match_id, arm, model.modelVersion, candidate.kickoff_at, generatedAt, cutoff, startedAt,
           Math.round((candidate.kickoff_at.getTime() - generatedAt.getTime()) / 1000), probabilities[0], probabilities[1], probabilities[2],
           pick(probabilities), f.homeN, f.awayN, f.scope, featureHash, model.models[arm].modelHash, sourceHash,
           JSON.stringify({ displayVersion: model.displayVersion, source: "production_db_read_only", featureSource: "matches+football_match_scores" })]);
        inserted += result.rowCount ?? 0;
      }
    }
    await client.query("commit");
    console.log(JSON.stringify({ mode: execute ? "execute" : "dry_run", execute, windowStart: windowStart.toISOString(), windowEnd: windowEnd.toISOString(),
      candidates: candidates.length, inserted, blocked, modelVersion: model.modelVersion, at: startedAt.toISOString() }));
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release(); await pool.end();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
