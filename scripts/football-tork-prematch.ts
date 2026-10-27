import "dotenv/config";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import { resolveCompetitionScope, normalizeCompetitionText } from "./football-rc-scope.js";

const dir = dirname(fileURLToPath(import.meta.url));
const MODEL_VERSION = "tork-stage1-logistic-blend";
const MODEL_ID = "TORK-A";
const HORIZON_SECONDS = 86_400;
const SETTLE_SECONDS = 10_800;

export interface TorkLeagueConstants {
  label: string;
  gfHome: number;
  gfAway: number;
  btts: number;
  n: number;
}

export interface TorkModelDefinition {
  modelId: string;
  modelVersion: string;
  displayVersion: string;
  features: string[];
  weights: Record<string, number>;
  leagueConstants: Record<string, TorkLeagueConstants>;
  globalFallback: TorkLeagueConstants;
  tuning: {
    recentWindow: number;
    venueWindow: number;
    h2hWindow: number;
    shrinkAlpha: number;
    bttsShrinkAlpha: number;
    seasonShrinkAlpha: number;
    venueShrinkAlpha: number;
    venueBlend: number;
    lambdaAsymFloor: number;
    minPriorMatches: number;
    pickThreshold: number;
    verdictThreshold: number;
    globalHomeScoredPrior: number;
    globalAwayScoredPrior: number;
  };
  evaluationGroup: string;
  training?: unknown;
}

export interface TorkMatchRow {
  match_id: string;
  competition_id: string;
  competition_name: string;
  country: string;
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

export interface TorkFeatures {
  logit_league: number;
  logit_poisson: number;
  btts_season: number;
  cross_score: number;
  cross_emp: number;
  h2h: number;
  log_asym: number;
}

export interface TorkPrediction {
  pBtts: number;
  expectedBttsGoals: number;
  pick: "btts_yes" | "btts_no";
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

function addSeconds(value: Date, seconds: number): Date {
  return new Date(value.getTime() + seconds * 1000);
}

function logit(p: number): number {
  const clamped = Math.min(Math.max(p, 1e-6), 1 - 1e-6);
  return Math.log(clamped / (1 - clamped));
}

function sigmoid(z: number): number {
  if (z >= 0) return 1 / (1 + Math.exp(-z));
  const eq = Math.exp(z);
  return eq / (1 + eq);
}

function shrink(value: number, n: number, prior: number, alpha: number): number {
  return (value * n + prior * alpha) / (n + alpha);
}

function isUsablePrior(row: TorkMatchRow, kickoff: Date, cutoff: Date): boolean {
  if (row.kickoff_at >= kickoff) return false;
  if (addSeconds(row.kickoff_at, SETTLE_SECONDS) > cutoff) return false;
  return true;
}

/** Priors need a normal finished result (fulltime scores, no extra/pen). */
export function isTorkNormalResult(row: TorkMatchRow): boolean {
  return row.status === "finished" && row.home_score !== null && row.away_score !== null &&
    row.home_extra === null && row.away_extra === null && row.home_pen === null && row.away_pen === null;
}

interface SideStats {
  n: number;
  gf: number;
  ga: number;
  btts: number;
}

function sideStats(rows: TorkMatchRow[], teamId: string): SideStats | null {
  const n = rows.length;
  if (n === 0) return null;
  let gf = 0; let ga = 0; let btts = 0;
  for (const row of rows) {
    const home = row.home_id === teamId;
    const f = home ? row.home_score! : row.away_score!;
    const a = home ? row.away_score! : row.home_score!;
    gf += f; ga += a;
    if (f >= 1 && a >= 1) btts += 1;
  }
  return { n, gf: gf / n, ga: ga / n, btts: btts / n };
}

export function leagueKeyFor(competitionName: string, model: TorkModelDefinition): { key: string; constants: TorkLeagueConstants } {
  const normalized = normalizeCompetitionText(competitionName);
  const exact = model.leagueConstants[normalized];
  if (exact) return { key: normalized, constants: exact };
  for (const [key, constants] of Object.entries(model.leagueConstants)) {
    if (normalized.includes(key) || key.includes(normalized)) return { key, constants };
  }
  return { key: "global", constants: model.globalFallback };
}

/**
 * Feature computation for one target match, mirroring the validated
 * .research/tork experiment exactly (same windows, shrinkage, blends).
 */
export function torkFeaturesFor(
  target: TorkMatchRow,
  history: TorkMatchRow[],
  pairHistory: TorkMatchRow[],
  constants: TorkLeagueConstants,
  tuning: TorkModelDefinition["tuning"],
  globalBtts: number,
  globalHomeScored: number,
  globalAwayScored: number,
  globalCrossBase: number
): { features: TorkFeatures; pLeague: number; lambdaHome: number; lambdaAway: number; homeN: number; awayN: number } | null {
  const kickoff = target.kickoff_at;
  const cutoff = addSeconds(kickoff, -HORIZON_SECONDS);
  const pLeague = constants.btts;

  const lam: Record<"home" | "away", number> = { home: 0, away: 0 };
  const parts: Record<string, number> = {};
  const seasonBtts: number[] = [];
  const ns: number[] = [];

  for (const side of ["home", "away"] as const) {
    const teamId = side === "home" ? target.home_id : target.away_id;
    const past = history
      .filter((row) => row.home_id === teamId || row.away_id === teamId)
      .filter((row) => isUsablePrior(row, kickoff, cutoff))
      .sort((a, b) => a.kickoff_at.getTime() - b.kickoff_at.getTime() || a.match_id.localeCompare(b.match_id));
    const recent = sideStats(past.slice(-tuning.recentWindow), teamId);
    if (!recent) return null;
    const seasonRows = past.filter((row) => row.season === target.season);
    const season = seasonRows.length > 0 ? sideStats(seasonRows, teamId) : null;

    const baseGf = side === "home" ? constants.gfHome : constants.gfAway;
    const baseGa = side === "home" ? constants.gfAway : constants.gfHome;

    let att = shrink(recent.gf, recent.n, baseGf, tuning.shrinkAlpha);
    let dfn = shrink(recent.ga, recent.n, baseGa, tuning.shrinkAlpha);
    const venueRows = past.slice(-tuning.venueWindow).filter((row) =>
      side === "home" ? row.home_id === teamId : row.away_id === teamId);
    const venue = sideStats(venueRows, teamId);
    if (venue && venue.n >= 2) {
      att = (1 - tuning.venueBlend) * att + tuning.venueBlend * shrink(venue.gf, venue.n, att, tuning.venueShrinkAlpha);
      dfn = (1 - tuning.venueBlend) * dfn + tuning.venueBlend * shrink(venue.ga, venue.n, dfn, tuning.venueShrinkAlpha);
    }
    lam[side] = baseGf * (att / baseGf) * (dfn / baseGa);

    if (season && season.n >= 3) {
      seasonBtts.push(shrink(season.btts, season.n, pLeague, tuning.seasonShrinkAlpha));
    }

    const recentWindow = past.slice(-tuning.recentWindow);
    const scoredFlags: number[] = [];
    const concededFlags: number[] = [];
    for (const row of recentWindow) {
      const home = row.home_id === teamId;
      scoredFlags.push((home ? row.home_score! : row.away_score!) >= 1 ? 1 : 0);
      concededFlags.push((home ? row.away_score! : row.home_score!) >= 1 ? 1 : 0);
    }
    const priorScored = side === "home" ? globalHomeScored : globalAwayScored;
    const priorConceded = side === "home" ? globalAwayScored : globalHomeScored;
    parts[`${side}_score_rate`] = 1 - Math.exp(-att);
    parts[`${side}_concede_rate`] = 1 - Math.exp(-dfn);
    parts[`${side}_emp_scored`] = shrink(scoredFlags.reduce((a, b) => a + b, 0) / scoredFlags.length, scoredFlags.length, priorScored, tuning.bttsShrinkAlpha);
    parts[`${side}_emp_conceded`] = shrink(concededFlags.reduce((a, b) => a + b, 0) / concededFlags.length, concededFlags.length, priorConceded, tuning.bttsShrinkAlpha);
    ns.push(recent.n);
  }

  if (Math.min(...ns) < tuning.minPriorMatches) return null;

  const lambdaHome = lam.home;
  const lambdaAway = lam.away;
  const pPoisson = (1 - Math.exp(-lambdaHome)) * (1 - Math.exp(-lambdaAway));

  const pairPast = pairHistory
    .filter((row) => (row.home_id === target.home_id && row.away_id === target.away_id) ||
      (row.home_id === target.away_id && row.away_id === target.home_id))
    .filter((row) => isUsablePrior(row, kickoff, cutoff))
    .sort((a, b) => a.kickoff_at.getTime() - b.kickoff_at.getTime())
    .slice(-tuning.h2hWindow);
  let h2hSignal = 0;
  if (pairPast.length >= 2) {
    const rate = pairPast.filter((row) => row.home_score! >= 1 && row.away_score! >= 1).length / pairPast.length;
    h2hSignal = shrink(rate, pairPast.length, pLeague, tuning.bttsShrinkAlpha) - pLeague;
  }

  const seasonInv = seasonBtts.length > 0 ? seasonBtts.reduce((a, b) => a + b, 0) / seasonBtts.length : pLeague;
  const crossPoisson = (parts.home_score_rate! * parts.away_concede_rate! +
    parts.away_score_rate! * parts.home_concede_rate!) / 2;
  const crossEmp = (parts.home_emp_scored! * parts.away_emp_conceded! +
    parts.away_emp_scored! * parts.home_emp_conceded!) / 2;
  const asym = Math.abs(Math.log((lambdaHome + tuning.lambdaAsymFloor) / (lambdaAway + tuning.lambdaAsymFloor)));

  const features: TorkFeatures = {
    logit_league: logit(pLeague),
    logit_poisson: logit(pPoisson),
    btts_season: seasonInv - pLeague,
    cross_score: crossPoisson - globalCrossBase,
    cross_emp: crossEmp - globalBtts,
    h2h: h2hSignal,
    log_asym: asym
  };
  return { features, pLeague, lambdaHome, lambdaAway, homeN: ns[0]!, awayN: ns[1]! };
}

export function validateModelArtifact(model: TorkModelDefinition): void {
  const requiredFeatures = ["logit_league", "logit_poisson", "btts_season", "cross_score", "cross_emp", "h2h", "log_asym"];
  if (model.modelId !== MODEL_ID || model.modelVersion !== MODEL_VERSION) throw new Error("invalid_model_identity");
  for (const feature of requiredFeatures) {
    const weight = model.weights?.[feature];
    if (typeof weight !== "number" || !Number.isFinite(weight)) throw new Error(`invalid_weight:${feature}`);
  }
  const fallback = model.globalFallback;
  for (const key of ["gfHome", "gfAway", "btts"] as const) {
    if (!Number.isFinite(fallback?.[key]) || (fallback[key] as number) <= 0) throw new Error("invalid_global_fallback");
  }
  for (const [key, constants] of Object.entries(model.leagueConstants ?? {})) {
    if (!constants || [constants.gfHome, constants.gfAway, constants.btts].some((v) => !Number.isFinite(v) || v <= 0)) {
      throw new Error(`invalid_league_constants:${key}`);
    }
  }
  const t = model.tuning;
  if (!t || t.recentWindow < 5 || t.minPriorMatches < 1 || t.pickThreshold <= 0 || t.pickThreshold >= 1) throw new Error("invalid_tuning");
}

export function predictTork(model: TorkModelDefinition, features: TorkFeatures): TorkPrediction {
  const z = model.features.reduce((sum, name) => {
    const value = (features as unknown as Record<string, number>)[name];
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`invalid_feature:${name}`);
    return sum + model.weights[name]! * value;
  }, 0);
  const pBtts = sigmoid(z);
  if (!Number.isFinite(pBtts) || pBtts <= 0 || pBtts >= 1) throw new Error("invalid_probability");
  const pick = pBtts >= model.tuning.pickThreshold ? "btts_yes" : "btts_no";
  const expected = pBtts * 2;
  return { pBtts, expectedBttsGoals: expected, pick };
}

function scopeLevelFor(homeN: number, awayN: number): string {
  if (homeN >= 8 && awayN >= 8) return "last10_available_unverified";
  if (homeN >= 5 && awayN >= 5) return "last5_available_unverified";
  if (homeN > 0 && awayN > 0) return "partial_history_unverified";
  if (homeN === 0 && awayN === 0) return "no_history";
  return "one_side_no_history";
}

const MATCH_QUERY = `
  select m.id as match_id, c.id::text as competition_id, c.name as competition_name,
         coalesce(co.name, '') as country, s.name as season,
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
  order by m.scheduled_start_at, m.id`;

async function main() {
  const args = process.argv.slice(2);
  const execute = args.includes("--execute");
  const scopeCheck = args.includes("--scope-check");
  if (!execute && !scopeCheck) throw new Error("--execute is required unless --scope-check is used; this job never writes in dry-run mode.");
  if (process.env.TORK_PREMATCH_ENABLED === "false") { console.log(JSON.stringify({ mode: "disabled", execute, at: new Date().toISOString() })); return; }
  const model = JSON.parse(await readFile(join(dir, "football-tork-model.json"), "utf8")) as TorkModelDefinition;
  validateModelArtifact(model);
  const modelHash = sha(stable({ weights: model.weights, leagueConstants: model.leagueConstants, globalFallback: model.globalFallback, tuning: model.tuning }));
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
  const client = await pool.connect();
  const startedAt = new Date();
  try {
    await client.query("begin");
    const scope = await resolveCompetitionScope(client);
    if (scope.approved.length === 0) throw new Error("No reviewed and enabled national competition matched production data.");
    const approvedIds = scope.approved.map((competition) => competition.competitionId);
    const rows = (await client.query<TorkMatchRow>(MATCH_QUERY, [approvedIds])).rows;

    const historyByCompetition = new Map<string, TorkMatchRow[]>();
    const pairIndex = new Map<string, TorkMatchRow[]>();
    for (const row of rows) {
      if (!isTorkNormalResult(row)) continue;
      const list = historyByCompetition.get(row.competition_id) ?? [];
      list.push(row);
      historyByCompetition.set(row.competition_id, list);
      const key = [row.home_id, row.away_id].sort().join("|");
      const pair = pairIndex.get(key) ?? [];
      pair.push(row);
      pairIndex.set(key, pair);
    }

    const windowStart = new Date(startedAt.getTime() + 24 * 3600 * 1000);
    const windowEnd = new Date(startedAt.getTime() + 7 * 24 * 3600 * 1000);
    const candidates = rows.filter((row) => row.status === "scheduled" && row.kickoff_at >= windowStart && row.kickoff_at <= windowEnd);
    const sourceHash = sha(stable(rows.map((row) => ({ ...row, kickoff_at: row.kickoff_at.toISOString() }))));
    const generatedAt = new Date();

    if (scopeCheck) {
      const byCompetition = new Map<string, { name: string; candidates: number; eligible: number; blocked: number; leagueKey: string }>();
      for (const candidate of candidates) {
        const entry = byCompetition.get(candidate.competition_id) ?? { name: candidate.competition_name, candidates: 0, eligible: 0, blocked: 0, leagueKey: leagueKeyFor(candidate.competition_name, model).key };
        entry.candidates += 1;
        const history = historyByCompetition.get(candidate.competition_id) ?? [];
        const pairKey = [candidate.home_id, candidate.away_id].sort().join("|");
        const f = torkFeaturesFor(candidate, history, pairIndex.get(pairKey) ?? [], leagueKeyFor(candidate.competition_name, model).constants, model.tuning, model.globalFallback.btts, model.tuning.globalHomeScoredPrior, model.tuning.globalAwayScoredPrior,
          (1 - Math.exp(-model.globalFallback.gfHome)) * (1 - Math.exp(-model.globalFallback.gfAway)));
        if (f) entry.eligible += 1; else entry.blocked += 1;
        byCompetition.set(candidate.competition_id, entry);
      }
      await client.query("rollback");
      console.log(JSON.stringify({ mode: "scope_check", approvedCompetitions: scope.approved, competitions: [...byCompetition.values()], totals: { candidates: candidates.length, eligible: [...byCompetition.values()].reduce((s, e) => s + e.eligible, 0), blocked: [...byCompetition.values()].reduce((s, e) => s + e.blocked, 0) }, modelVersion: model.modelVersion, at: startedAt.toISOString() }));
      return;
    }

    let inserted = 0;
    const blocked: Array<{ matchId: string; competitionName: string; reason: string }> = [];
    for (const candidate of candidates) {
      const history = historyByCompetition.get(candidate.competition_id) ?? [];
      const pairKey = [candidate.home_id, candidate.away_id].sort().join("|");
      const { key: leagueKey, constants } = leagueKeyFor(candidate.competition_name, model);
      const f = torkFeaturesFor(candidate, history, pairIndex.get(pairKey) ?? [], constants, model.tuning, model.globalFallback.btts, model.tuning.globalHomeScoredPrior, model.tuning.globalAwayScoredPrior,
          (1 - Math.exp(-model.globalFallback.gfHome)) * (1 - Math.exp(-model.globalFallback.gfAway)));
      if (!f) {
        blocked.push({ matchId: candidate.match_id, competitionName: candidate.competition_name, reason: "fewer_than_3_prior_results" });
        continue;
      }
      const cutoff = addSeconds(candidate.kickoff_at, -HORIZON_SECONDS);
      if (generatedAt > cutoff) {
        blocked.push({ matchId: candidate.match_id, competitionName: candidate.competition_name, reason: "prediction_after_cutoff" });
        continue;
      }
      let prediction: TorkPrediction;
      try {
        prediction = predictTork(model, f.features);
      } catch (error) {
        blocked.push({ matchId: candidate.match_id, competitionName: candidate.competition_name, reason: error instanceof Error ? error.message.slice(0, 120) : "invalid_prediction_input" });
        continue;
      }
      const featureHash = sha(stable({ ...f.features, lambdaHome: f.lambdaHome, lambdaAway: f.lambdaAway }));
      const result = await client.query(`insert into football_tork_prematch_predictions
        (match_id, competition_id, model_id, model_version, kickoff_at, prediction_generated_at, published_at,
         prediction_cutoff_at, feature_as_of_at, actual_lead_seconds, p_btts, expected_btts_goals, pick,
         history_home_n, history_away_n, scope_level, history_completeness, feature_hash, model_hash,
         source_snapshot_hash, evaluation_group, status, metadata_json)
        values ($1,$2,$3,$4,$5,$6,now(),$7,$8,$9,$10,$11,$12,$13,$14,$15,'unverified',$16,$17,$18,$19,'published',$20)
        on conflict (match_id, model_id, model_version) do nothing`,
        [candidate.match_id, candidate.competition_id, MODEL_ID, model.modelVersion, candidate.kickoff_at, generatedAt, cutoff, startedAt,
         Math.round((candidate.kickoff_at.getTime() - generatedAt.getTime()) / 1000),
         prediction.pBtts, prediction.expectedBttsGoals, prediction.pick,
         f.homeN, f.awayN, scopeLevelFor(f.homeN, f.awayN), featureHash, modelHash, sourceHash, model.evaluationGroup,
         JSON.stringify({ displayVersion: model.displayVersion, source: "production_db_read_only", leagueKey, pLeague: f.pLeague, lambdaHome: f.lambdaHome, lambdaAway: f.lambdaAway, competitionName: candidate.competition_name, training: model.training })]);
      inserted += result.rowCount ?? 0;
    }
    await client.query("commit");
    console.log(JSON.stringify({ mode: execute ? "execute" : "dry_run", execute, windowStart: windowStart.toISOString(), windowEnd: windowEnd.toISOString(),
      approvedCompetitions: scope.approved, candidates: candidates.length, inserted, blocked, modelVersion: model.modelVersion, at: startedAt.toISOString() }));
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release(); await pool.end();
  }
}

const isMain = Boolean(process.argv[1]) && pathToFileURL(process.argv[1]!).href === import.meta.url;
if (isMain) main().catch((error) => { console.error(error); process.exit(1); });
