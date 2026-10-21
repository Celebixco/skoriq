import "dotenv/config";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import { resolveCompetitionScope } from "./football-rc-scope.js";

const dir = dirname(fileURLToPath(import.meta.url));
const MODEL_VERSION = "stage11-fixed-R-A-R-C";
const HORIZON_SECONDS = 86_400;
const SETTLE_SECONDS = 10_800;
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
  competition_id: string;
  competition_name: string;
  country: string;
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

export function prior(history: MatchRow[], competitionId: string, teamId: string, kickoff: Date, cutoff: Date, side?: "home" | "away", limit = 10): MatchRow[] {
  return history.filter((row) => {
    if (row.competition_id !== competitionId) return false;
    if (row.home_id !== teamId && row.away_id !== teamId) return false;
    if (row.kickoff_at >= kickoff) return false;
    if (addSeconds(row.kickoff_at, SETTLE_SECONDS) > cutoff) return false;
    if (side === "home" && row.home_id !== teamId) return false;
    if (side === "away" && row.away_id !== teamId) return false;
    return true;
  }).sort((a, b) => a.kickoff_at.getTime() - b.kickoff_at.getTime() || a.match_id.localeCompare(b.match_id)).slice(-limit);
}

export function featureVector(target: MatchRow, history: MatchRow[], model: ModelDefinition) {
  const kickoff = target.kickoff_at;
  const cutoff = addSeconds(kickoff, -HORIZON_SECONDS);
  const h5 = prior(history, target.competition_id, target.home_id, kickoff, cutoff, undefined, 5);
  const h10 = prior(history, target.competition_id, target.home_id, kickoff, cutoff, undefined, 10);
  const a5 = prior(history, target.competition_id, target.away_id, kickoff, cutoff, undefined, 5);
  const a10 = prior(history, target.competition_id, target.away_id, kickoff, cutoff, undefined, 10);
  const hh5 = prior(history, target.competition_id, target.home_id, kickoff, cutoff, "home", 5);
  const aa5 = prior(history, target.competition_id, target.away_id, kickoff, cutoff, "away", 5);
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

export function validateModelArtifact(model: ModelDefinition): void {
  if (model.features.length !== 34) throw new Error("invalid_model_features");
  if (model.classOrder.length !== 3 || model.classOrder.join(",") !== "1,X,2") throw new Error("invalid_class_order");
  for (const key of ["medians", "mean", "std"] as const) {
    const values = model.preprocessor?.[key];
    if (!Array.isArray(values) || values.length !== model.features.length || values.some((value) => !Number.isFinite(value))) throw new Error(`invalid_preprocessor_${key}`);
  }
  if (model.preprocessor.std.some((value) => value <= 0)) throw new Error("invalid_preprocessor_std");
  for (const arm of ["R-A", "R-C"] as const) {
    const weights = model.models[arm]?.weights;
    if (!Array.isArray(weights) || weights.length !== model.features.length + 1) throw new Error(`invalid_weights_${arm}`);
    if (weights.some((row) => !Array.isArray(row) || row.length !== 3 || row.some((value) => !Number.isFinite(value)))) throw new Error(`invalid_weights_${arm}`);
  }
}

export function validateProbabilities(probabilities: number[]): asserts probabilities is [number, number, number] {
  if (!Array.isArray(probabilities) || probabilities.length !== 3) throw new Error("invalid_probability_length");
  if (probabilities.some((value) => typeof value !== "number" || !Number.isFinite(value))) throw new Error("invalid_probability_value");
  if (probabilities.some((value) => value < 0 || value > 1)) throw new Error("probability_out_of_range");
  const total = probabilities[0]! + probabilities[1]! + probabilities[2]!;
  if (Math.abs(total - 1) > 1e-9) throw new Error("probability_sum_not_one");
}

export function applyPreprocessor(features: Record<string, number>, model: ModelDefinition): number[] {
  return model.features.map((name, index) => {
    if (!Object.prototype.hasOwnProperty.call(features, name)) throw new Error(`missing_required_feature:${name}`);
    const raw = features[name];
    if (typeof raw !== "number" || !Number.isFinite(raw)) throw new Error(`non_finite_feature:${name}`);
    return (raw - model.preprocessor.mean[index]!) / model.preprocessor.std[index]!;
  });
}

function softmax(values: number[]): number[] {
  const max = Math.max(...values);
  const exp = values.map((v) => Math.exp(v - max));
  const total = exp.reduce((a, b) => a + b, 0);
  return exp.map((v) => v / total);
}

export function predict(model: ModelDefinition, x: number[], arm: "R-A" | "R-C"): number[] {
  const weights = model.models[arm].weights;
  const logits = [0, 1, 2].map((k) => weights[0]![k]! + x.reduce((sum, value, i) => sum + value * weights[i + 1]![k]!, 0));
  const probabilities = softmax(logits);
  validateProbabilities(probabilities);
  return probabilities;
}

export function pick(probabilities: number[]): ClassLabel {
  validateProbabilities(probabilities);
  let best = 0;
  for (let i = 1; i < probabilities.length; i++) if (probabilities[i]! > probabilities[best]!) best = i;
  return CLASSES[best]!;
}

function rankX(probabilities: number[]): number {
  const order = [0, 1, 2].sort((a, b) => probabilities[b]! - probabilities[a]! || a - b);
  return order.indexOf(1) + 1;
}

async function insertInitial(client: pg.PoolClient, model: ModelDefinition, startedAt: Date) {
  const document = JSON.parse(await readFile(join(dir, "football-rc-initial-predictions.json"), "utf8")) as { predictions: InitialPrediction[] };
  let inserted = 0; let skipped = 0;
  for (const item of document.predictions) {
    const match = await client.query<{ id: string; competition_id: string; scheduled_start_at: Date; status: string }>("select id, competition_id, scheduled_start_at, status from matches where id = $1", [item.matchId]);
    if (!match.rows[0] || match.rows[0].status !== "scheduled" || match.rows[0].scheduled_start_at <= startedAt) { skipped += 2; continue; }
    for (const arm of ["R-A", "R-C"] as const) {
      const p = item[arm];
      const result = await client.query(`insert into football_rc_prematch_predictions
        (match_id, competition_id, model_id, model_version, kickoff_at, prediction_generated_at, published_at,
         prediction_cutoff_at, feature_as_of_at, actual_lead_seconds, p1, px, p2, pick,
         history_home_n, history_away_n, scope_level, history_completeness, feature_hash, model_hash,
         source_snapshot_hash, evaluation_group, status, metadata_json)
        values ($1,$2,$3,$4,$5,$6,now(),$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,'stage12_1','published',$21)
        on conflict (match_id, model_id, model_version) do nothing`,
        [item.matchId, match.rows[0].competition_id, arm, model.modelVersion, new Date(item.kickoffAt), new Date(item.predictionGeneratedAt),
         new Date(new Date(item.kickoffAt).getTime() - HORIZON_SECONDS * 1000), new Date(item.featureAsOfAt), Math.round(item.actualLeadSeconds),
         p.p1, p.px, p.p2, p.pick, item.historyHomeN, item.historyAwayN, item.scopeLevel, item.historyCompleteness,
         item.featureHash, p.modelHash, item.sourceSnapshotHash, JSON.stringify({ displayVersion: model.displayVersion, seededFrom: "stage12_1_initial_package" })]);
      inserted += result.rowCount ?? 0;
    }
  }
  return { inserted, skipped };
}

async function main() {
  const args = process.argv.slice(2);
  const execute = args.includes("--execute");
  const seed = args.includes("--seed");
  const scopeCheck = args.includes("--scope-check");
  if (!execute && !scopeCheck) throw new Error("--execute is required unless --scope-check is used; this job never writes in dry-run mode.");
  if (process.env.RC_PREMATCH_ENABLED === "false") { console.log(JSON.stringify({ mode: "disabled", execute, at: new Date().toISOString() })); return; }
  const model = JSON.parse(await readFile(join(dir, "football-rc-model.json"), "utf8")) as ModelDefinition;
  validateModelArtifact(model);
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
  const client = await pool.connect();
  const startedAt = new Date();
  try {
    await client.query("begin");
    if (seed) {
      const result = await insertInitial(client, model, startedAt);
      await client.query("commit");
      console.log(JSON.stringify({ mode: "seed", execute, ...result, modelVersion: model.modelVersion, at: startedAt.toISOString() }));
      return;
    }
    const initial = scopeCheck ? { inserted: 0, skipped: 0 } : await insertInitial(client, model, startedAt);

    const scope = await resolveCompetitionScope(client);
    if (scope.approved.length === 0) throw new Error("No reviewed and enabled national competition matched production data.");
    const approvedIds = scope.approved.map((competition) => competition.competitionId);
    const rows = await client.query<MatchRow>(`
      select m.id as match_id, c.id::text as competition_id, c.name as competition_name,
             coalesce(co.name, '') as country,
             m.metadata_json->>'sofascoreId' as source_event_id, s.name as season,
             m.scheduled_start_at as kickoff_at, m.status::text as status,
             ht.id as home_id, ht.name as home_team, at.id as away_id, at.name as away_team,
             fs.home_score_current as home_score, fs.away_score_current as away_score,
             fs.home_score_extra_time as home_extra, fs.away_score_extra_time as away_extra,
             fs.home_score_penalties as home_pen, fs.away_score_penalties as away_pen
      from matches m
      join competitions c on c.id = m.competition_id
      left join countries co on co.id = c.country_id
      join seasons s on s.id = m.season_id
      join teams ht on ht.id = m.home_team_id
      join teams at on at.id = m.away_team_id
      left join football_match_scores fs on fs.match_id = m.id
      where m.competition_id = any($1::uuid[]) and m.scheduled_start_at >= '2024-07-01'
      order by m.scheduled_start_at, m.id`, [approvedIds]);
    const historyByCompetition = new Map<string, MatchRow[]>();
    for (const row of rows.rows) {
      if (!isNormalResult(row)) continue;
      const list = historyByCompetition.get(row.competition_id) ?? [];
      list.push(row);
      historyByCompetition.set(row.competition_id, list);
    }
    const windowStart = new Date(startedAt.getTime() + 24 * 3600 * 1000);
    const windowEnd = new Date(startedAt.getTime() + 7 * 24 * 3600 * 1000);
    const candidates = rows.rows.filter((row) => row.status === "scheduled" && row.kickoff_at >= windowStart && row.kickoff_at <= windowEnd);
    const sourceHash = sha(stable(rows.rows.map((row) => ({ ...row, kickoff_at: row.kickoff_at.toISOString() }))));
    const generatedAt = new Date();
    if (scopeCheck) {
      const byCompetition = new Map<string, { name: string; candidates: number; eligible: number; blocked: number; reasons: Record<string, number> }>();
      for (const candidate of candidates) {
        const entry = byCompetition.get(candidate.competition_id) ?? { name: candidate.competition_name, candidates: 0, eligible: 0, blocked: 0, reasons: {} };
        entry.candidates += 1;
        const history = historyByCompetition.get(candidate.competition_id) ?? [];
        const f = featureVector(candidate, history, model);
        if (f.homeN < 3 || f.awayN < 3) {
          entry.blocked += 1; entry.reasons.fewer_than_3_prior_results = (entry.reasons.fewer_than_3_prior_results ?? 0) + 1;
        } else {
          entry.eligible += 1;
        }
        byCompetition.set(candidate.competition_id, entry);
      }
      await client.query("rollback");
      console.log(JSON.stringify({ mode: "scope_check", approvedCompetitions: scope.approved, competitions: [...byCompetition.values()], totals: { candidates: candidates.length, eligible: [...byCompetition.values()].reduce((sum, entry) => sum + entry.eligible, 0), blocked: [...byCompetition.values()].reduce((sum, entry) => sum + entry.blocked, 0) }, modelVersion: model.modelVersion, at: startedAt.toISOString() }));
      return;
    }
    let inserted = 0;
    const blocked: Array<{ matchId: string; competitionId: string; competitionName: string; homeTeam: string; awayTeam: string; kickoffAt: string; reason: string; homeN: number; awayN: number }> = [];
    for (const candidate of candidates) {
      const history = historyByCompetition.get(candidate.competition_id) ?? [];
      const f = featureVector(candidate, history, model);
      if (f.homeN < 3 || f.awayN < 3) {
        blocked.push({ matchId: candidate.match_id, competitionId: candidate.competition_id, competitionName: candidate.competition_name, homeTeam: candidate.home_team, awayTeam: candidate.away_team, kickoffAt: candidate.kickoff_at.toISOString(), reason: "fewer_than_3_prior_results", homeN: f.homeN, awayN: f.awayN });
        continue;
      }
      const cutoff = addSeconds(candidate.kickoff_at, -HORIZON_SECONDS);
      if (generatedAt > cutoff) { blocked.push({ matchId: candidate.match_id, competitionId: candidate.competition_id, competitionName: candidate.competition_name, homeTeam: candidate.home_team, awayTeam: candidate.away_team, kickoffAt: candidate.kickoff_at.toISOString(), reason: "prediction_after_cutoff", homeN: f.homeN, awayN: f.awayN }); continue; }
      const featureHash = sha(stable(f.features));
      const armResults: Array<{ arm: "R-A" | "R-C"; probabilities: number[]; selected: ClassLabel }> = [];
      try {
        const x = applyPreprocessor(f.features, model);
        for (const arm of ["R-A", "R-C"] as const) {
          const probabilities = predict(model, x, arm);
          armResults.push({ arm, probabilities, selected: pick(probabilities) });
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message.slice(0, 180) : "invalid_prediction_input";
        blocked.push({ matchId: candidate.match_id, competitionId: candidate.competition_id, competitionName: candidate.competition_name, homeTeam: candidate.home_team, awayTeam: candidate.away_team, kickoffAt: candidate.kickoff_at.toISOString(), reason, homeN: f.homeN, awayN: f.awayN });
        continue;
      }
      for (const { arm, probabilities, selected } of armResults) {
        const result = await client.query(`insert into football_rc_prematch_predictions
          (match_id, competition_id, model_id, model_version, kickoff_at, prediction_generated_at, published_at,
           prediction_cutoff_at, feature_as_of_at, actual_lead_seconds, p1, px, p2, pick,
           history_home_n, history_away_n, scope_level, history_completeness, feature_hash, model_hash,
           source_snapshot_hash, evaluation_group, status, metadata_json)
          values ($1,$2,$3,$4,$5,$6,now(),$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'unverified',$17,$18,$19,'multi_league_unassessed','published',$20)
          on conflict (match_id, model_id, model_version) do nothing`,
          [candidate.match_id, candidate.competition_id, arm, model.modelVersion, candidate.kickoff_at, generatedAt, cutoff, startedAt,
           Math.round((candidate.kickoff_at.getTime() - generatedAt.getTime()) / 1000), probabilities[0], probabilities[1], probabilities[2],
           selected, f.homeN, f.awayN, f.scope, featureHash, model.models[arm].modelHash, sourceHash,
           JSON.stringify({ displayVersion: model.displayVersion, source: "production_db_read_only", featureSource: "matches+football_match_scores", competitionId: candidate.competition_id, competitionName: candidate.competition_name })]);
        inserted += result.rowCount ?? 0;
      }
    }
    await client.query("commit");
    console.log(JSON.stringify({ mode: execute ? "execute" : "dry_run", execute, windowStart: windowStart.toISOString(), windowEnd: windowEnd.toISOString(),
      approvedCompetitions: scope.approved, scopeUnmatched: scope.unmatched, candidates: candidates.length, inserted, initial, blocked, modelVersion: model.modelVersion, at: startedAt.toISOString() }));
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release(); await pool.end();
  }
}

const isMain = Boolean(process.argv[1]) && pathToFileURL(process.argv[1]!).href === import.meta.url;
if (isMain) main().catch((error) => { console.error(error); process.exit(1); });
