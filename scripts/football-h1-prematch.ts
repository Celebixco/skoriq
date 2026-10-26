import "dotenv/config";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import { resolveCompetitionScope, normalizeCompetitionText } from "./football-rc-scope.js";

const dir = dirname(fileURLToPath(import.meta.url));
const MODEL_VERSION = "h1-stage1-logistic-blend";
const MODEL_ID = "H1-A";
const HORIZON_SECONDS = 86_400;
const SETTLE_SECONDS = 10_800;

export interface H1LeagueConstants {
  label: string;
  h1Home: number;
  h1Away: number;
  ftHome: number;
  ftAway: number;
  n: number;
}

export interface H1ModelDefinition {
  modelId: string;
  modelVersion: string;
  displayVersion: string;
  features: string[];
  weights: Record<string, number>;
  leagueConstants: Record<string, H1LeagueConstants>;
  globalFallback: H1LeagueConstants;
  tuning: {
    recentWindow: number;
    venueWindow: number;
    h2hWindow: number;
    shrinkAlpha: number;
    invShrinkAlpha: number;
    seasonShrinkAlpha: number;
    venueShrinkAlpha: number;
    venueBlend: number;
    ftBlend: number;
    lambdaFloor: number;
    ftRatioFloor: number;
    minPriorMatches: number;
    pickThreshold: number;
  };
  evaluationGroup: string;
  training?: unknown;
}

export interface H1MatchRow {
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
  home_ht: number | null;
  away_ht: number | null;
  home_extra: number | null;
  away_extra: number | null;
  home_pen: number | null;
  away_pen: number | null;
}

export interface H1Features {
  logit_league: number;
  inv_recent: number;
  inv_season: number;
  log_lam_ratio: number;
  h2h: number;
  log_ft_ratio: number;
  n_avg: number;
}

export interface H1Prediction {
  pGoal: number;
  expectedH1Goals: number;
  pick: "over_0_5" | "under_0_5";
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

/** A prior row is usable when its result could be known before the cutoff. */
function isUsablePrior(row: H1MatchRow, kickoff: Date, cutoff: Date): boolean {
  if (row.kickoff_at >= kickoff) return false;
  if (addSeconds(row.kickoff_at, SETTLE_SECONDS) > cutoff) return false;
  return true;
}

/** Prior matches must be normal finished results with a recorded halftime score. */
export function isH1NormalResult(row: H1MatchRow): boolean {
  return row.status === "finished" && row.home_score !== null && row.away_score !== null &&
    row.home_ht !== null && row.away_ht !== null &&
    row.home_extra === null && row.away_extra === null && row.home_pen === null && row.away_pen === null;
}

interface SideStats {
  n: number;
  h1_gf: number;
  h1_ga: number;
  ft_gf: number;
  ft_ga: number;
  involved: number;
}

function sideStats(rows: H1MatchRow[], teamId: string): SideStats | null {
  const n = rows.length;
  if (n === 0) return null;
  let h1Gf = 0; let h1Ga = 0; let ftGf = 0; let ftGa = 0; let involved = 0;
  for (const row of rows) {
    const home = row.home_id === teamId;
    const gfHt = home ? row.home_ht! : row.away_ht!;
    const gaHt = home ? row.away_ht! : row.home_ht!;
    const gfFt = home ? row.home_score! : row.away_score!;
    const gaFt = home ? row.away_score! : row.home_score!;
    h1Gf += gfHt; h1Ga += gaHt; ftGf += gfFt; ftGa += gaFt;
    if (gfHt + gaHt >= 1) involved += 1;
  }
  return { n, h1_gf: h1Gf / n, h1_ga: h1Ga / n, ft_gf: ftGf / n, ft_ga: ftGa / n, involved: involved / n };
}

export function leagueKeyFor(competitionName: string, model: H1ModelDefinition): { key: string; constants: H1LeagueConstants } {
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
 * .research/h1 experiment exactly (same windows, shrinkage, blends).
 */
export function h1FeaturesFor(
  target: H1MatchRow,
  history: H1MatchRow[],
  pairHistory: H1MatchRow[],
  constants: H1LeagueConstants,
  tuning: H1ModelDefinition["tuning"]
): { features: H1Features; pLeague: number; lambdaTeam: number; homeN: number; awayN: number } | null {
  const t = tuning;
  const kickoff = target.kickoff_at;
  const cutoff = addSeconds(kickoff, -HORIZON_SECONDS);

  const base = { home: constants.h1Home, away: constants.h1Away, ftHome: constants.ftHome, ftAway: constants.ftAway };
  const lamLeague = base.home + base.away;
  const pLeague = 1 - Math.exp(-lamLeague);

  const lamParts: Record<"home" | "away", number> = { home: 0, away: 0 };
  const invs: Record<"home" | "away", number> = { home: pLeague, away: pLeague };
  const seasonInvs: number[] = [];
  const ns: number[] = [];
  let ftExp = 0;

  for (const side of ["home", "away"] as const) {
    const teamId = side === "home" ? target.home_id : target.away_id;
    const past = history
      .filter((row) => row.home_id === teamId || row.away_id === teamId)
      .filter((row) => isUsablePrior(row, kickoff, cutoff))
      .sort((a, b) => a.kickoff_at.getTime() - b.kickoff_at.getTime() || a.match_id.localeCompare(b.match_id));
    const recent = sideStats(past.slice(-t.recentWindow), teamId);
    if (!recent) return null;
    const seasonRows = past.filter((row) => row.season === target.season);
    const season = seasonRows.length > 0 ? sideStats(seasonRows, teamId) : null;
    const venueRows = past.slice(-t.venueWindow).filter((row) =>
      side === "home" ? row.home_id === teamId : row.away_id === teamId);
    const venue = sideStats(venueRows, teamId);

    const opp: "away" | "home" = side === "home" ? "away" : "home";
    const baseSide = base[side];
    const baseOpp = base[opp];
    const ftBaseSide = side === "home" ? base.ftHome : base.ftAway;
    const ftBaseOpp = opp === "home" ? base.ftHome : base.ftAway;

    let att = shrink(recent.h1_gf, recent.n, baseSide, t.shrinkAlpha);
    let dfn = shrink(recent.h1_ga, recent.n, baseOpp, t.shrinkAlpha);
    const attFt = shrink(recent.ft_gf, recent.n, ftBaseSide, t.shrinkAlpha);
    const dfnFt = shrink(recent.ft_ga, recent.n, ftBaseOpp, t.shrinkAlpha);
    if (venue && venue.n >= 2) {
      att = (1 - t.venueBlend) * att + t.venueBlend * shrink(venue.h1_gf, venue.n, att, t.venueShrinkAlpha);
      dfn = (1 - t.venueBlend) * dfn + t.venueBlend * shrink(venue.h1_ga, venue.n, dfn, t.venueShrinkAlpha);
    }
    const attRatio = (1 - t.ftBlend) * (att / baseSide) + t.ftBlend * (attFt / ftBaseSide);
    const dfnRatio = (1 - t.ftBlend) * (dfn / baseOpp) + t.ftBlend * (dfnFt / ftBaseOpp);
    lamParts[side] = baseSide * attRatio * dfnRatio;

    invs[side] = shrink(recent.involved, recent.n, pLeague, t.invShrinkAlpha);
    if (season && season.n >= 3) seasonInvs.push(shrink(season.involved, season.n, pLeague, t.seasonShrinkAlpha));
    ns.push(recent.n);
    ftExp += shrink(recent.ft_gf, recent.n, ftBaseSide, t.shrinkAlpha);
  }

  if (Math.min(...ns) < t.minPriorMatches) return null;
  const lambdaTeam = lamParts.home + lamParts.away;

  const pairPast = pairHistory
    .filter((row) => (row.home_id === target.home_id && row.away_id === target.away_id) ||
      (row.home_id === target.away_id && row.away_id === target.home_id))
    .filter((row) => isUsablePrior(row, kickoff, cutoff))
    .sort((a, b) => a.kickoff_at.getTime() - b.kickoff_at.getTime())
    .slice(-t.h2hWindow);
  let h2hSignal = 0;
  if (pairPast.length >= 2) {
    const rate = pairPast.filter((row) => row.home_ht! + row.away_ht! >= 1).length / pairPast.length;
    h2hSignal = shrink(rate, pairPast.length, pLeague, t.invShrinkAlpha) - pLeague;
  }

  const seasonInv = seasonInvs.length > 0 ? seasonInvs.reduce((a, b) => a + b, 0) / seasonInvs.length : pLeague;
  const features: H1Features = {
    logit_league: logit(pLeague),
    inv_recent: (invs.home + invs.away) / 2 - pLeague,
    inv_season: seasonInv - pLeague,
    log_lam_ratio: Math.log(Math.max(lambdaTeam, t.lambdaFloor) / Math.max(lamLeague, t.lambdaFloor)),
    h2h: h2hSignal,
    log_ft_ratio: Math.log(Math.max(ftExp / (base.ftHome + base.ftAway), t.ftRatioFloor)),
    n_avg: (ns[0]! + ns[1]!) / 2 / t.recentWindow
  };
  return { features, pLeague, lambdaTeam, homeN: ns[0]!, awayN: ns[1]! };
}

export function validateModelArtifact(model: H1ModelDefinition): void {
  const requiredFeatures = ["logit_league", "inv_recent", "inv_season", "log_lam_ratio", "h2h", "log_ft_ratio", "n_avg"];
  if (model.modelId !== MODEL_ID || model.modelVersion !== MODEL_VERSION) throw new Error("invalid_model_identity");
  for (const feature of requiredFeatures) {
    const weight = model.weights?.[feature];
    if (typeof weight !== "number" || !Number.isFinite(weight)) throw new Error(`invalid_weight:${feature}`);
  }
  const fallback = model.globalFallback;
  for (const key of ["h1Home", "h1Away", "ftHome", "ftAway"] as const) {
    if (!Number.isFinite(fallback?.[key]) || (fallback[key] as number) <= 0) throw new Error("invalid_global_fallback");
  }
  for (const [key, constants] of Object.entries(model.leagueConstants ?? {})) {
    if (!constants || [constants.h1Home, constants.h1Away, constants.ftHome, constants.ftAway].some((v) => !Number.isFinite(v) || v <= 0)) {
      throw new Error(`invalid_league_constants:${key}`);
    }
  }
  const t = model.tuning;
  if (!t || t.recentWindow < 5 || t.minPriorMatches < 1 || t.pickThreshold <= 0 || t.pickThreshold >= 1) throw new Error("invalid_tuning");
}

export function predictH1(model: H1ModelDefinition, features: H1Features): H1Prediction {
  const z = model.features.reduce((sum, name) => {
    const value = (features as unknown as Record<string, number>)[name];
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`invalid_feature:${name}`);
    return sum + model.weights[name]! * value;
  }, 0);
  const pGoal = sigmoid(z);
  if (!Number.isFinite(pGoal) || pGoal <= 0 || pGoal >= 1) throw new Error("invalid_probability");
  const pick = pGoal >= model.tuning.pickThreshold ? "over_0_5" : "under_0_5";
  const expected = -(Math.log(Math.max(1 - pGoal, 1e-12)));
  return { pGoal, expectedH1Goals: expected, pick };
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
         fs.home_score_halftime as home_ht, fs.away_score_halftime as away_ht,
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
  if (process.env.H1_PREMATCH_ENABLED === "false") { console.log(JSON.stringify({ mode: "disabled", execute, at: new Date().toISOString() })); return; }
  const model = JSON.parse(await readFile(join(dir, "football-h1-model.json"), "utf8")) as H1ModelDefinition;
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
    const rows = (await client.query<H1MatchRow>(MATCH_QUERY, [approvedIds])).rows;

    const historyByCompetition = new Map<string, H1MatchRow[]>();
    const pairIndex = new Map<string, H1MatchRow[]>();
    for (const row of rows) {
      if (!isH1NormalResult(row)) continue;
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
        const f = h1FeaturesFor(candidate, history, pairIndex.get(pairKey) ?? [], leagueKeyFor(candidate.competition_name, model).constants, model.tuning);
        if (f) entry.eligible += 1; else entry.blocked += 1;
        byCompetition.set(candidate.competition_id, entry);
      }
      await client.query("rollback");
      console.log(JSON.stringify({ mode: "scope_check", approvedCompetitions: scope.approved, competitions: [...byCompetition.values()], totals: { candidates: candidates.length, eligible: [...byCompetition.values()].reduce((s, e) => s + e.eligible, 0), blocked: [...byCompetition.values()].reduce((s, e) => s + e.blocked, 0) }, modelVersion: model.modelVersion, at: startedAt.toISOString() }));
      return;
    }

    let inserted = 0;
    const blocked: Array<{ matchId: string; competitionName: string; reason: string; homeN: number; awayN: number }> = [];
    for (const candidate of candidates) {
      const history = historyByCompetition.get(candidate.competition_id) ?? [];
      const pairKey = [candidate.home_id, candidate.away_id].sort().join("|");
      const { key: leagueKey, constants } = leagueKeyFor(candidate.competition_name, model);
      const f = h1FeaturesFor(candidate, history, pairIndex.get(pairKey) ?? [], constants, model.tuning);
      if (!f) {
        blocked.push({ matchId: candidate.match_id, competitionName: candidate.competition_name, reason: "fewer_than_3_prior_results_with_halftime", homeN: 0, awayN: 0 });
        continue;
      }
      const cutoff = addSeconds(candidate.kickoff_at, -HORIZON_SECONDS);
      if (generatedAt > cutoff) {
        blocked.push({ matchId: candidate.match_id, competitionName: candidate.competition_name, reason: "prediction_after_cutoff", homeN: f.homeN, awayN: f.awayN });
        continue;
      }
      let prediction: H1Prediction;
      try {
        prediction = predictH1(model, f.features);
      } catch (error) {
        blocked.push({ matchId: candidate.match_id, competitionName: candidate.competition_name, reason: error instanceof Error ? error.message.slice(0, 120) : "invalid_prediction_input", homeN: f.homeN, awayN: f.awayN });
        continue;
      }
      const featureHash = sha(stable({ ...f.features, lambdaTeam: f.lambdaTeam }));
      const result = await client.query(`insert into football_h1_prematch_predictions
        (match_id, competition_id, model_id, model_version, kickoff_at, prediction_generated_at, published_at,
         prediction_cutoff_at, feature_as_of_at, actual_lead_seconds, p_goal, expected_h1_goals, pick,
         history_home_n, history_away_n, scope_level, history_completeness, feature_hash, model_hash,
         source_snapshot_hash, evaluation_group, status, metadata_json)
        values ($1,$2,$3,$4,$5,$6,now(),$7,$8,$9,$10,$11,$12,$13,$14,$15,'unverified',$16,$17,$18,$19,'published',$20)
        on conflict (match_id, model_id, model_version) do nothing`,
        [candidate.match_id, candidate.competition_id, MODEL_ID, model.modelVersion, candidate.kickoff_at, generatedAt, cutoff, startedAt,
         Math.round((candidate.kickoff_at.getTime() - generatedAt.getTime()) / 1000),
         prediction.pGoal, prediction.expectedH1Goals, prediction.pick,
         f.homeN, f.awayN, scopeLevelFor(f.homeN, f.awayN), featureHash, modelHash, sourceHash, model.evaluationGroup,
         JSON.stringify({ displayVersion: model.displayVersion, source: "production_db_read_only", leagueKey, pLeague: f.pLeague, lambdaTeam: f.lambdaTeam, competitionName: candidate.competition_name, training: model.training })]);
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
