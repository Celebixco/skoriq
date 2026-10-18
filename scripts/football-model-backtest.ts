import "dotenv/config";
import { pathToFileURL } from "node:url";
import pg from "pg";
import {
  coverageAtConfidence,
  evaluateCalibration,
  evaluateRollingCalibration,
  evaluateRollingIsotonic,
  evaluateRollingPlatt,
  fitTemperatureScaling,
  fitFootballPoissonModel,
  outcomeOf,
  predictFootballMarkets,
  type FootballCalibrationSample,
  type FootballModelMatch,
  type FootballOutcome
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

interface ProbabilityTriple {
  home: number;
  draw: number;
  away: number;
}

interface ProbabilityPair {
  poisson: ProbabilityTriple;
  elo: ProbabilityTriple;
  outcome: FootballOutcome;
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
  homePicks: number;
  drawPicks: number;
  awayPicks: number;
  calibrationSamples: FootballCalibrationSample[];
  probabilityPairs: ProbabilityPair[];
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
  homePickRate: number;
  drawPickRate: number;
  awayPickRate: number;
  probabilityBuckets: Array<{ bucket: string; count: number; accuracy: number; averageProbability: number }>;
  calibration: {
    temperature: number;
    calibrationSamples: number;
    evaluationSamples: number;
    rawLogLoss: number;
    calibratedLogLoss: number;
    rawBrierScore: number;
    calibratedBrierScore: number;
    rawEce: number;
    calibratedEce: number;
    coverage: Array<{ threshold: number; coverage: number; selected: number; accuracy: number }>;
  };
  rollingCalibration: {
    windowSize: number;
    evaluations: number;
    latestTemperature: number;
    minTemperature: number;
    maxTemperature: number;
    logLoss: number;
    expectedCalibrationError: number;
    coverage: Array<{ threshold: number; coverage: number; selected: number; accuracy: number }>;
  };
  rollingIsotonic: {
    windowSize: number;
    evaluations: number;
    expectedCalibrationError: number;
    coverage: Array<{ threshold: number; coverage: number; selected: number; accuracy: number }>;
  };
  rollingPlatt: {
    windowSize: number;
    evaluations: number;
    expectedCalibrationError: number;
    coverage: Array<{ threshold: number; coverage: number; selected: number; accuracy: number }>;
  };
  eloBlend: {
    weight: number;
    calibrationAccuracy: number;
    evaluationAccuracy: number;
    argmaxEvaluationAccuracy: number;
    evaluationLogLoss: number;
  };
  drawPolicy: {
    margin: number;
    calibrationAccuracy: number;
    evaluationAccuracy: number;
    argmaxEvaluationAccuracy: number;
    drawPicks: number;
  };
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
       order by m.scheduled_start_at desc, m.id desc
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
    })).reverse();
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
      homePicks: 0,
      drawPicks: 0,
      awayPicks: 0,
      calibrationSamples: [],
      probabilityPairs: [],
      probabilityBuckets: new Map()
    };
    let model: ReturnType<typeof fitFootballPoissonModel> | null = null;
    const elo = new EloRatings();
    for (let index = 0; index < options.minTraining; index++) elo.update(matches[index]!);
    let skipped = 0;
    let firstPredictionAt: string | null = null;
    let lastPredictionAt: string | null = null;

    for (let index = options.minTraining; index < matches.length; index++) {
      if (accumulator.predictions >= options.maxPredictions) break;
      const target = matches[index]!;
      const eloProbabilities = elo.probabilities(target.homeTeamId, target.awayTeamId);
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
        elo.update(target);
        continue;
      }
      let probabilities;
      try {
        probabilities = predictFootballMarkets(model, target.homeTeamId, target.awayTeamId);
      } catch {
        skipped += 1;
        elo.update(target);
        continue;
      }
      const actual = outcomeOf(target.homeGoals, target.awayGoals);
      accumulator.calibrationSamples.push({
        probabilities: { home: probabilities.homeWin, draw: probabilities.draw, away: probabilities.awayWin },
        outcome: actual
      });
      accumulator.probabilityPairs.push({
        poisson: { home: probabilities.homeWin, draw: probabilities.draw, away: probabilities.awayWin },
        elo: eloProbabilities,
        outcome: actual
      });
      const predicted = probabilities.homeWin >= probabilities.draw && probabilities.homeWin >= probabilities.awayWin
        ? "home"
        : probabilities.draw >= probabilities.awayWin
          ? "draw"
          : "away";
      const probabilityByOutcome = { home: probabilities.homeWin, draw: probabilities.draw, away: probabilities.awayWin };
      accumulator.predictions += 1;
      accumulator.correct += predicted === actual ? 1 : 0;
      accumulator.homeBaselineCorrect += actual === "home" ? 1 : 0;
      if (predicted === "home") accumulator.homePicks += 1;
      else if (predicted === "draw") accumulator.drawPicks += 1;
      else accumulator.awayPicks += 1;
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
      elo.update(target);
    }

    if (accumulator.predictions === 0) throw new Error("No predictions were produced.");
    const samples = accumulator.calibrationSamples;
    const split = Math.min(samples.length - 1, Math.floor(samples.length / 2));
    const calibrationSet = samples.slice(0, split);
    const evaluationSet = samples.slice(split);
    const temperature = fitTemperatureScaling(calibrationSet);
    const rawCalibration = evaluateCalibration(evaluationSet, 1);
    const calibratedCalibration = evaluateCalibration(evaluationSet, temperature);
    const rollingCalibration = evaluateRollingCalibration(samples, {
      windowSize: Math.max(40, Math.min(200, Math.floor(samples.length / 3))),
      refitEvery: 10
    });
    const rollingIsotonic = evaluateRollingIsotonic(samples, {
      windowSize: Math.max(40, Math.min(200, Math.floor(samples.length / 3))),
      refitEvery: 10
    });
    const rollingPlatt = evaluateRollingPlatt(samples, {
      windowSize: Math.max(40, Math.min(200, Math.floor(samples.length / 3))),
      refitEvery: 10
    });
    const drawPolicy = fitDrawPolicy(calibrationSet, evaluationSet);
    const eloBlend = fitEloBlend(accumulator.probabilityPairs);
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
      homePickRate: ratio(accumulator.homePicks, accumulator.predictions),
      drawPickRate: ratio(accumulator.drawPicks, accumulator.predictions),
      awayPickRate: ratio(accumulator.awayPicks, accumulator.predictions),
      probabilityBuckets: [...accumulator.probabilityBuckets.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([bucket, value]) => ({
          bucket,
          count: value.count,
          accuracy: ratio(value.correct, value.count),
          averageProbability: ratio(value.probabilitySum, value.count)
        })),
      calibration: {
        temperature,
        calibrationSamples: calibrationSet.length,
        evaluationSamples: evaluationSet.length,
        rawLogLoss: rawCalibration.logLoss,
        calibratedLogLoss: calibratedCalibration.logLoss,
        rawBrierScore: rawCalibration.brierScore,
        calibratedBrierScore: calibratedCalibration.brierScore,
        rawEce: rawCalibration.expectedCalibrationError,
        calibratedEce: calibratedCalibration.expectedCalibrationError,
        coverage: [0.5, 0.6, 0.7, 0.8].map((threshold) => coverageAtConfidence(evaluationSet, temperature, threshold))
      },
      rollingCalibration: {
        windowSize: rollingCalibration.windowSize,
        evaluations: rollingCalibration.evaluations,
        latestTemperature: rollingCalibration.latestTemperature,
        minTemperature: rollingCalibration.minTemperature,
        maxTemperature: rollingCalibration.maxTemperature,
        logLoss: rollingCalibration.report.logLoss,
        expectedCalibrationError: rollingCalibration.report.expectedCalibrationError,
        coverage: rollingCalibration.coverage
      },
      rollingIsotonic: {
        windowSize: rollingIsotonic.windowSize,
        evaluations: rollingIsotonic.evaluations,
        expectedCalibrationError: rollingIsotonic.expectedCalibrationError,
        coverage: rollingIsotonic.coverage
      },
      rollingPlatt: {
        windowSize: rollingPlatt.windowSize,
        evaluations: rollingPlatt.evaluations,
        expectedCalibrationError: rollingPlatt.expectedCalibrationError,
        coverage: rollingPlatt.coverage
      },
      drawPolicy,
      eloBlend,
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

class EloRatings {
  private readonly ratings = new Map<string, number>();
  private readonly homeAdvantage = 60;
  private readonly kFactor = 20;

  probabilities(homeTeamId: string, awayTeamId: string): ProbabilityTriple {
    const homeRating = this.ratings.get(homeTeamId) ?? 1500;
    const awayRating = this.ratings.get(awayTeamId) ?? 1500;
    const expectedHome = 1 / (1 + 10 ** ((awayRating - homeRating - this.homeAdvantage) / 400));
    const draw = clamp(0.28 - 0.12 * Math.abs(expectedHome - 0.5), 0.16, 0.3);
    const home = Math.max(0.01, expectedHome - draw / 2);
    const away = Math.max(0.01, 1 - home - draw);
    const total = home + draw + away;
    return { home: home / total, draw: draw / total, away: away / total };
  }

  update(match: FootballModelMatch): void {
    const homeRating = this.ratings.get(match.homeTeamId) ?? 1500;
    const awayRating = this.ratings.get(match.awayTeamId) ?? 1500;
    const expectedHome = 1 / (1 + 10 ** ((awayRating - homeRating - this.homeAdvantage) / 400));
    const actualHome = match.homeGoals > match.awayGoals ? 1 : match.homeGoals < match.awayGoals ? 0 : 0.5;
    const marginMultiplier = 1 + Math.min(1, Math.abs(match.homeGoals - match.awayGoals) / 3);
    const change = this.kFactor * marginMultiplier * (actualHome - expectedHome);
    this.ratings.set(match.homeTeamId, homeRating + change);
    this.ratings.set(match.awayTeamId, awayRating - change);
  }
}

function fitEloBlend(pairs: readonly ProbabilityPair[]) {
  const split = Math.floor(pairs.length / 2);
  const calibration = pairs.slice(0, split);
  const evaluation = pairs.slice(split);
  const weights = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.75, 1];
  let bestWeight = 0;
  let bestCalibrationAccuracy = -1;
  for (const weight of weights) {
    const metrics = evaluateBlend(calibration, weight);
    if (metrics.accuracy > bestCalibrationAccuracy + 1e-9) {
      bestCalibrationAccuracy = metrics.accuracy;
      bestWeight = weight;
    }
  }
  const evaluationMetrics = evaluateBlend(evaluation, bestWeight);
  const argmaxMetrics = evaluateBlend(evaluation, 0);
  return {
    weight: bestWeight,
    calibrationAccuracy: round(bestCalibrationAccuracy, 4),
    evaluationAccuracy: round(evaluationMetrics.accuracy, 4),
    argmaxEvaluationAccuracy: round(argmaxMetrics.accuracy, 4),
    evaluationLogLoss: round(evaluationMetrics.logLoss, 4)
  };
}

function evaluateBlend(pairs: readonly ProbabilityPair[], weight: number): { accuracy: number; logLoss: number } {
  if (pairs.length === 0) return { accuracy: 0, logLoss: 0 };
  let correct = 0;
  let logLoss = 0;
  for (const pair of pairs) {
    const probabilities = blendProbabilities(pair, weight);
    const values = [probabilities.home, probabilities.draw, probabilities.away];
    const predicted = values.indexOf(Math.max(...values));
    const actual = pair.outcome === "home" ? 0 : pair.outcome === "draw" ? 1 : 2;
    correct += predicted === actual ? 1 : 0;
    logLoss += -Math.log(Math.max(1e-12, values[actual]!));
  }
  return { accuracy: correct / pairs.length, logLoss: logLoss / pairs.length };
}

function blendProbabilities(pair: ProbabilityPair, weight: number): ProbabilityTriple {
  const eloWeight = clamp(weight, 0, 1);
  return {
    home: pair.poisson.home * (1 - eloWeight) + pair.elo.home * eloWeight,
    draw: pair.poisson.draw * (1 - eloWeight) + pair.elo.draw * eloWeight,
    away: pair.poisson.away * (1 - eloWeight) + pair.elo.away * eloWeight
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function fitDrawPolicy(calibration: readonly FootballCalibrationSample[], evaluation: readonly FootballCalibrationSample[]) {
  const margins = Array.from({ length: 11 }, (_, index) => round(index / 100, 2));
  let bestMargin = 0;
  let bestCalibrationAccuracy = -1;
  for (const margin of margins) {
    const accuracy = accuracyAtMargin(calibration, margin);
    if (accuracy > bestCalibrationAccuracy + 1e-9) {
      bestCalibrationAccuracy = accuracy;
      bestMargin = margin;
    }
  }
  return {
    margin: bestMargin,
    calibrationAccuracy: round(bestCalibrationAccuracy, 4),
    evaluationAccuracy: round(accuracyAtMargin(evaluation, bestMargin), 4),
    argmaxEvaluationAccuracy: round(accuracyAtMargin(evaluation, 0), 4),
    drawPicks: evaluation.filter((sample) => chooseOutcome(sample.probabilities, bestMargin) === "draw").length
  };
}

function accuracyAtMargin(samples: readonly FootballCalibrationSample[], drawMargin: number): number {
  if (samples.length === 0) return 0;
  let correct = 0;
  for (const sample of samples) {
    if (chooseOutcome(sample.probabilities, drawMargin) === sample.outcome) correct += 1;
  }
  return correct / samples.length;
}

function chooseOutcome(
  probabilities: { home: number; draw: number; away: number },
  drawMargin: number
): FootballOutcome {
  const top = Math.max(probabilities.home, probabilities.away);
  if (probabilities.draw + drawMargin >= top) return "draw";
  return probabilities.home >= probabilities.away ? "home" : "away";
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
