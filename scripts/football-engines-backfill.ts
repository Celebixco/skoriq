import "dotenv/config";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import { resolveCompetitionScope } from "./football-rc-scope.js";
import { applyPreprocessor, featureVector, pick, predict, validateModelArtifact, type MatchRow, type ModelDefinition } from "./football-rc-prematch.js";
import { leagueKeyFor, predictTork, scopeLevelFor as torkScopeLevel, torkFeaturesFor, validateModelArtifact as validateTorkModel, type TorkMatchRow, type TorkModelDefinition } from "./football-tork-prematch.js";

const dir = dirname(fileURLToPath(import.meta.url));
const HORIZON_SECONDS = 86_400;
const SETTLE_SECONDS = 10_800;
const BACKFILL_GROUP = "simulation_backfill";

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

function isRcNormal(row: MatchRow): boolean {
  return row.status === "finished" && row.home_score !== null && row.away_score !== null &&
    row.home_extra === null && row.away_extra === null && row.home_pen === null && row.away_pen === null;
}

function isTorkNormal(row: TorkMatchRow): boolean {
  return row.status === "finished" && row.home_score !== null && row.away_score !== null &&
    row.home_extra === null && row.away_extra === null && row.home_pen === null && row.away_pen === null;
}

const BASE_QUERY = `
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
  where m.competition_id = any($1::uuid[]) and m.scheduled_start_at >= $2
  order by m.scheduled_start_at, m.id`;

async function main() {
  const execute = process.argv.includes("--execute");
  const torkOnly = process.argv.includes("--tork-only");
  if (!execute) throw new Error("--execute is required; this job never writes in dry-run mode.");
  const rcModel = JSON.parse(await readFile(join(dir, "football-rc-model.json"), "utf8")) as ModelDefinition;
  validateModelArtifact(rcModel);
  const torkModel = JSON.parse(await readFile(join(dir, "football-tork-model.json"), "utf8")) as TorkModelDefinition;
  validateTorkModel(torkModel);
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
  const client = await pool.connect();
  const now = new Date();
  try {
    await client.query("begin");
    const scope = await resolveCompetitionScope(client);
    const approvedIds = scope.approved.map((c) => c.competitionId);

    if (!torkOnly) {
      const already = await client.query<{ n: string }>(`select count(*)::text as n from football_rc_prematch_predictions where evaluation_group = $1`, [BACKFILL_GROUP]);
      if (Number(already.rows[0]?.n ?? 0) > 0) {
        await client.query("rollback");
        console.log(JSON.stringify({ mode: "engines-backfill", skipped: "already_backfilled", existing: Number(already.rows[0]!.n), at: now.toISOString() }));
        return;
      }
    }
    if (torkOnly) {
      // Rebuild ONLY the Tork history under the current pick rule; Trey stays untouched.
      await client.query("delete from football_tork_prematch_results");
      await client.query("delete from football_tork_prematch_predictions");
    }

    // Wipe ALL Trey (R-C) predictions + results (full mode only), then rebuild from simulations.
    const deletedResults = torkOnly ? { rowCount: 0 } : await client.query("delete from football_rc_prematch_results");
    const deletedPredictions = torkOnly ? { rowCount: 0 } : await client.query("delete from football_rc_prematch_predictions");

    const rows = (await client.query<MatchRow & TorkMatchRow>(BASE_QUERY, [approvedIds, "2025-08-01"])).rows;
    const rcHistory = new Map<string, MatchRow[]>();
    const torkHistory = new Map<string, TorkMatchRow[]>();
    const pairIndex = new Map<string, TorkMatchRow[]>();
    for (const row of rows) {
      if (isRcNormal(row)) {
        const list = rcHistory.get(row.competition_id) ?? [];
        list.push(row);
        rcHistory.set(row.competition_id, list);
      }
      if (isTorkNormal(row)) {
        const list = torkHistory.get(row.competition_id) ?? [];
        list.push(row);
        torkHistory.set(row.competition_id, list);
        const key = [row.home_id, row.away_id].sort().join("|");
        const pair = pairIndex.get(key) ?? [];
        pair.push(row);
        pairIndex.set(key, pair);
      }
    }

    const finished = rows.filter((row) => isRcNormal(row) && row.kickoff_at.getTime() < now.getTime() - 4 * 3600 * 1000);
    let rcInserted = 0;
    let torkInserted = 0;
    const blockedRc: string[] = [];
    for (const target of finished) {
      const generatedAt = new Date(target.kickoff_at.getTime() - (HORIZON_SECONDS + 60) * 1000);
      const cutoff = new Date(target.kickoff_at.getTime() - HORIZON_SECONDS * 1000);
      if (!torkOnly) {
      const history = rcHistory.get(target.competition_id) ?? [];
      const f = featureVector(target, history, rcModel);
      if (f.homeN < 3 || f.awayN < 3) { blockedRc.push(target.match_id); continue; }
      let probabilities: number[];
      try {
        const x = applyPreprocessor(f.features, rcModel);
        probabilities = predict(rcModel, x, "R-C");
      } catch { blockedRc.push(target.match_id); continue; }
      const result = await client.query(`insert into football_rc_prematch_predictions
        (match_id, competition_id, model_id, model_version, kickoff_at, prediction_generated_at, published_at,
         prediction_cutoff_at, feature_as_of_at, actual_lead_seconds, p1, px, p2, pick,
         history_home_n, history_away_n, scope_level, history_completeness, feature_hash, model_hash,
         source_snapshot_hash, evaluation_group, status, metadata_json)
        values ($1,$2,'R-C',$3,$4,$5,$5,$6,$5,$7,$8,$9,$10,$11,$12,$13,$14,'unverified',$15,$16,$17,$18,'published',$19)
        on conflict (match_id, model_id, model_version) do nothing`,
        [target.match_id, target.competition_id, rcModel.modelVersion, target.kickoff_at, generatedAt, cutoff,
         HORIZON_SECONDS + 60, probabilities[0], probabilities[1], probabilities[2], pick(probabilities),
         f.homeN, f.awayN, f.scope, sha(stable(f.features)), rcModel.models["R-C"].modelHash,
         sha(stable({ backfill: now.toISOString() })), BACKFILL_GROUP,
         JSON.stringify({ displayVersion: rcModel.displayVersion, simulation: true, backfilledAt: now.toISOString(), competitionName: target.competition_name })]);
      rcInserted += result.rowCount ?? 0;
      }

      const { key: leagueKey, constants } = leagueKeyFor(target.competition_name, torkModel);
      const tf = torkFeaturesFor(target, torkHistory.get(target.competition_id) ?? [], pairIndex.get([target.home_id, target.away_id].sort().join("|")) ?? [],
        constants, torkModel.tuning, torkModel.globalFallback.btts, torkModel.tuning.globalHomeScoredPrior, torkModel.tuning.globalAwayScoredPrior,
        (1 - Math.exp(-torkModel.globalFallback.gfHome)) * (1 - Math.exp(-torkModel.globalFallback.gfAway)));
      if (tf) {
        let prediction;
        try { prediction = predictTork(torkModel, tf.features); } catch { prediction = null; }
        if (prediction) {
          const featureHash = sha(stable({ ...tf.features, lambdaHome: tf.lambdaHome, lambdaAway: tf.lambdaAway }));
          const modelHash = sha(stable({ weights: torkModel.weights, leagueConstants: torkModel.leagueConstants, globalFallback: torkModel.globalFallback, tuning: torkModel.tuning }));
          const t = await client.query(`insert into football_tork_prematch_predictions
            (match_id, competition_id, model_id, model_version, kickoff_at, prediction_generated_at, published_at,
             prediction_cutoff_at, feature_as_of_at, actual_lead_seconds, p_btts, expected_btts_goals, pick,
             history_home_n, history_away_n, scope_level, history_completeness, feature_hash, model_hash,
             source_snapshot_hash, evaluation_group, status, metadata_json)
            values ($1,$2,'TORK-A',$3,$4,$5,$5,$6,$5,$7,$8,$9,$10,$11,$12,$13,'unverified',$14,$15,$16,$17,'published',$18)
            on conflict (match_id, model_id, model_version) do nothing`,
            [target.match_id, target.competition_id, torkModel.modelVersion, target.kickoff_at, generatedAt, cutoff,
             HORIZON_SECONDS + 60, prediction.pBtts, prediction.expectedBttsGoals, prediction.pick,
             tf.homeN, tf.awayN, torkScopeLevel(tf.homeN, tf.awayN), featureHash, modelHash,
             sha(stable({ backfill: now.toISOString() })), BACKFILL_GROUP,
             JSON.stringify({ displayVersion: torkModel.displayVersion, simulation: true, backfilledAt: now.toISOString(), leagueKey, competitionName: target.competition_name })]);
          torkInserted += t.rowCount ?? 0;
        }
      }
    }
    await client.query("commit");
    console.log(JSON.stringify({ mode: "engines-backfill", execute, torkOnly, finishedTargets: finished.length,
      deleted: { rcResults: deletedResults.rowCount ?? 0, rcPredictions: deletedPredictions.rowCount ?? 0 },
      inserted: { rc: rcInserted, tork: torkInserted }, blockedRc: blockedRc.length, at: now.toISOString() }));
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release(); await pool.end();
  }
}

const isMain = Boolean(process.argv[1]) && pathToFileURL(process.argv[1]!).href === import.meta.url;
if (isMain) main().catch((error) => { console.error(error); process.exit(1); });
