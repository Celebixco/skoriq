import "dotenv/config";
import { pathToFileURL } from "node:url";
import pg from "pg";
import {
  fitFootballPoissonModel,
  outcomeOf,
  predictFootballMarkets,
  type FootballModelMatch
} from "@sports-data/analysis";
import { writeSyncRunLog } from "./sync-run-log.js";

interface BacktestOptions {
  databaseUrl: string;
  competitionId?: string;
  limit: number;
  minTraining: number;
  refitEvery: number;
  maxPredictions: number;
  iterations: number;
  logRun: boolean;
}

interface BacktestMatch extends FootballModelMatch {
  id: string;
}

interface BacktestAccumulator {
  predictions: number;
  correct: number;
  homeBaselineCorrect: number;
  logLoss: number;
  brier: number;
  over25Predictions: number;
  over25Correct: number;
  bttsPredictions: number;
  bttsCorrect: number;
  probabilityBuckets: Map<string, { count: number; correct: number; probabilitySum: number }>;
}

export interface BacktestReport {
  competitionId: string | null;
  trainingMatches: number;
  predictions: number;
  skipped: number;
  accuracy1x2: number;
  homeBaselineAccuracy: number;
  logLoss: number;
  brierScore: number;
  over25Accuracy: number;
  bttsAccuracy: number;
  averageTopProbability: number;
  probabilityBuckets: Array<{ bucket: string; count: number; accuracy: number; averageProbability: number }>;
  firstPredictionAt: string | null;
  lastPredictionAt: string | null;
}

export function parseBacktestArgs(argv: string[]): BacktestOptions {
  const options: BacktestOptions = {
    databaseUrl: process.env.DATABASE_URL ?? "",
    limit: 5000,
    minTraining: 300,
    refitEvery: 100,
    maxPredictions: 1500,
    iterations: 180,
    logRun: true,
    competitionId: undefined
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg.startsWith("--competition-id=")) options.competitionId = arg.slice("--competition-id=".length);
    else if (arg === "--competition-id") options.competitionId = requireValue(argv, ++index, arg);
    else if (arg.startsWith("--limit=")) options.limit = positiveInteger(arg.slice("--limit=".length), arg);
    else if (arg === "--limit") options.limit = positiveInteger(requireValue(argv, ++index, arg), arg);
    else if (arg.startsWith("--min-training=")) options.minTraining = positiveInteger(arg.slice("--min-training=".length), arg);
    else if (arg === "--min-training") options.minTraining = positiveInteger(requireValue(argv, ++index, arg), arg);
    else if (arg.startsWith("--refit-every=")) options.refitEvery = positiveInteger(arg.slice("--refit-every=".length), arg);
    else if (arg === "--refit-every") options.refitEvery = positiveInteger(requireValue(argv, ++index, arg), arg);
    else if (arg.startsWith("--max-predictions=")) options.maxPredictions = positiveInteger(arg.slice("--max-predictions=".length), arg);
    else if (arg === "--max-predictions") options.maxPredictions = positiveInteger(requireValue(argv, ++index, arg), arg);
    else if (arg.startsWith("--iterations=")) options.iterations = positiveInteger(arg.slice("--iterations=".length), arg);
    else if (arg === "--iterations") options.iterations = positiveInteger(requireValue(argv, ++index, arg), arg);
    else if (arg === "--no-log") options.logRun = false;
    else throw new Error(`Unknown backtest argument "${arg}".`);
  }
  if (!options.databaseUrl) throw new Error("DATABASE_URL is required for the model backtest.");
  if (options.limit < options.minTraining + 1) throw new Error("--limit must exceed --min-training.");
  return options;
}

export async function runBacktest(options: BacktestOptions): Promise<BacktestReport> {
  const pool = new pg.Pool({ connectionString: options.databaseUrl, max: 2, connectionTimeoutMillis: 10_000, query_timeout: 60_000 });
  pool.on("error", () => {});
  try {
    const params: unknown[] = [];
    const competitionFilter = options.competitionId ? `and m.competition_id = $${params.push(options.competitionId)}` : "";
    const result = await pool.query<BacktestRow>(
      `select m.id::text as id,
              m.scheduled_start_at as date,
              m.home_team_id::text as home_team_id,
              m.away_team_id::text as away_team_id,
              s.home_score_fulltime::int as home_goals,
              s.away_score_fulltime::int as away_goals
       from matches m
       inner join football_match_scores s on s.match_id = m.id
       where m.status in ('finished', 'after_extra_time', 'after_penalties')
         and s.home_score_fulltime is not null
         and s.away_score_fulltime is not null
         and s.home_score_fulltime between 0 and 20
         and s.away_score_fulltime between 0 and 20
         ${competitionFilter}
       order by m.scheduled_start_at asc, m.id asc
       limit $${params.push(options.limit)}`,
      params
    );
    const matches: BacktestMatch[] = result.rows.map((row) => ({
      id: row.id,
      date: new Date(row.date),
      homeTeamId: row.home_team_id,
      awayTeamId: row.away_team_id,
      homeGoals: Number(row.home_goals),
      awayGoals: Number(row.away_goals)
    }));
    if (matches.length <= options.minTraining) throw new Error("Not enough finished matches for the requested minimum training window.");

    const accumulator: BacktestAccumulator = {
      predictions: 0,
      correct: 0,
      homeBaselineCorrect: 0,
      logLoss: 0,
      brier: 0,
      over25Predictions: 0,
      over25Correct: 0,
      bttsPredictions: 0,
      bttsCorrect: 0,
      probabilityBuckets: new Map()
    };
    let model: ReturnType<typeof fitFootballPoissonModel> | null = null;
    let skipped = 0;
    let firstPredictionAt: string | null = null;
    let lastPredictionAt: string | null = null;

    for (let index = options.minTraining; index < matches.length; index++) {
      if (accumulator.predictions >= options.maxPredictions) break;
      const target = matches[index]!;
      if (!model || index % options.refitEvery === 0) {
        model = fitFootballPoissonModel(matches.slice(0, index), {
          iterations: options.iterations,
          learningRate: 0.035,
          regularization: 0.02,
          timeDecayHalfLifeDays: 365,
          dixonColesRho: -0.06,
          maxGoals: 10
        });
      }
      if (!model.teams[target.homeTeamId] || !model.teams[target.awayTeamId]) {
        skipped += 1;
        continue;
      }
      let probabilities;
      try {
        probabilities = predictFootballMarkets(model, target.homeTeamId, target.awayTeamId);
      } catch {
        skipped += 1;
        continue;
      }
      const actual = outcomeOf(target.homeGoals, target.awayGoals);
      const predicted = probabilities.homeWin >= probabilities.draw && probabilities.homeWin >= probabilities.awayWin
        ? "home"
        : probabilities.draw >= probabilities.awayWin
          ? "draw"
          : "away";
      const probabilityByOutcome = { home: probabilities.homeWin, draw: probabilities.draw, away: probabilities.awayWin };
      accumulator.predictions += 1;
      accumulator.correct += predicted === actual ? 1 : 0;
      accumulator.homeBaselineCorrect += actual === "home" ? 1 : 0;
      accumulator.logLoss += -Math.log(Math.max(1e-12, probabilityByOutcome[actual]));
      accumulator.brier += (probabilities.homeWin - (actual === "home" ? 1 : 0)) ** 2
        + (probabilities.draw - (actual === "draw" ? 1 : 0)) ** 2
        + (probabilities.awayWin - (actual === "away" ? 1 : 0)) ** 2;
      const over25Actual = target.homeGoals + target.awayGoals > 2.5;
      accumulator.over25Predictions += 1;
      accumulator.over25Correct += (probabilities.over25 >= 0.5) === over25Actual ? 1 : 0;
      const bttsActual = target.homeGoals > 0 && target.awayGoals > 0;
      accumulator.bttsPredictions += 1;
      accumulator.bttsCorrect += (probabilities.bttsYes >= 0.5) === bttsActual ? 1 : 0;
      const topProbability = Math.max(probabilities.homeWin, probabilities.draw, probabilities.awayWin);
      const bucket = probabilityBucket(topProbability);
      const existing = accumulator.probabilityBuckets.get(bucket) ?? { count: 0, correct: 0, probabilitySum: 0 };
      existing.count += 1;
      existing.correct += predicted === actual ? 1 : 0;
      existing.probabilitySum += topProbability;
      accumulator.probabilityBuckets.set(bucket, existing);
      firstPredictionAt ??= target.date.toISOString();
      lastPredictionAt = target.date.toISOString();
    }

    if (accumulator.predictions === 0) throw new Error("No predictions were produced.");
    return {
      competitionId: options.competitionId ?? null,
      trainingMatches: matches.length,
      predictions: accumulator.predictions,
      skipped,
      accuracy1x2: ratio(accumulator.correct, accumulator.predictions),
      homeBaselineAccuracy: ratio(accumulator.homeBaselineCorrect, accumulator.predictions),
      logLoss: round(accumulator.logLoss / accumulator.predictions, 4),
      brierScore: round(accumulator.brier / accumulator.predictions, 4),
      over25Accuracy: ratio(accumulator.over25Correct, accumulator.over25Predictions),
      bttsAccuracy: ratio(accumulator.bttsCorrect, accumulator.bttsPredictions),
      averageTopProbability: round(
        [...accumulator.probabilityBuckets.values()].reduce((sum, bucket) => sum + bucket.probabilitySum, 0) / accumulator.predictions,
        4
      ),
      probabilityBuckets: [...accumulator.probabilityBuckets.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([bucket, value]) => ({
          bucket,
          count: value.count,
          accuracy: ratio(value.correct, value.count),
          averageProbability: ratio(value.probabilitySum, value.count)
        })),
      firstPredictionAt,
      lastPredictionAt
    };
  } finally {
    await pool.end();
  }
}

interface BacktestRow {
  id: string;
  date: Date;
  home_team_id: string;
  away_team_id: string;
  home_goals: number;
  away_goals: number;
}

function probabilityBucket(probability: number): string {
  const lower = Math.min(0.9, Math.floor(probability * 10) / 10);
  return `${lower.toFixed(1)}-${(lower + 0.1).toFixed(1)}`;
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
  return value;
}

function positiveInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${flag} must be a positive integer.`);
  return parsed;
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? round(numerator / denominator, 4) : 0;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void (async () => {
    let options: BacktestOptions | undefined;
    try {
      options = parseBacktestArgs(process.argv.slice(2));
      if (options.logRun) {
        await writeSyncRunLog({
          job: "model-backtest",
          status: "running",
          mode: "execute",
          phase: "begin",
          summary: JSON.stringify({
            limit: options.limit,
            minTraining: options.minTraining,
            maxPredictions: options.maxPredictions,
            refitEvery: options.refitEvery,
            iterations: options.iterations
          })
        }, options.databaseUrl);
      }
      const report = await runBacktest(options);
      if (options.logRun) {
        await writeSyncRunLog({
          job: "model-backtest",
          status: "succeeded",
          mode: "execute",
          phase: "final",
          summary: JSON.stringify(report)
        }, options.databaseUrl);
      }
      console.log(JSON.stringify(report, null, 2));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Model backtest failed.";
      if (options?.logRun) {
        await writeSyncRunLog({
          job: "model-backtest",
          status: "failed",
          mode: "execute",
          phase: "final",
          error: message.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "DATABASE_URL=<redacted>").slice(0, 500),
          summary: JSON.stringify({ error: message.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "DATABASE_URL=<redacted>").slice(0, 500) })
        }, options.databaseUrl).catch(() => undefined);
      }
      console.error(message);
      process.exitCode = 1;
    }
  })();
}
