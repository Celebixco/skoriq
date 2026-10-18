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

interface TuneOptions {
  databaseUrl: string;
  competitionId?: string;
  limit: number;
  trainRatio: number;
  logRun: boolean;
}

interface TuneRow {
  id: string;
  date: Date;
  home_team_id: string;
  away_team_id: string;
  home_goals: number;
  away_goals: number;
}

interface TuneConfig {
  regularization: number;
  dixonColesRho: number;
  timeDecayHalfLifeDays: number;
  learningRate: number;
  iterations: number;
}

interface TuneResult {
  config: TuneConfig;
  accuracy: number;
  logLoss: number;
  brierScore: number;
  predictions: number;
}

export interface TuneReport {
  competitionId: string | null;
  trainingMatches: number;
  validationMatches: number;
  evaluatedConfigs: number;
  best: TuneResult;
  top: TuneResult[];
}

export function parseTuneArgs(argv: string[]): TuneOptions {
  const options: TuneOptions = {
    databaseUrl: process.env.DATABASE_URL ?? "",
    limit: 2500,
    trainRatio: 0.7,
    logRun: true
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg.startsWith("--competition-id=")) options.competitionId = arg.slice("--competition-id=".length);
    else if (arg === "--competition-id") options.competitionId = requireValue(argv, ++index, arg);
    else if (arg.startsWith("--limit=")) options.limit = positiveInteger(arg.slice("--limit=".length), arg);
    else if (arg === "--limit") options.limit = positiveInteger(requireValue(argv, ++index, arg), arg);
    else if (arg.startsWith("--train-ratio=")) options.trainRatio = Number(arg.slice("--train-ratio=".length));
    else if (arg === "--train-ratio") options.trainRatio = Number(requireValue(argv, ++index, arg));
    else if (arg === "--no-log") options.logRun = false;
    else throw new Error(`Unknown tune argument "${arg}".`);
  }
  if (!options.databaseUrl) throw new Error("DATABASE_URL is required for model tuning.");
  if (!(options.trainRatio > 0.5 && options.trainRatio < 0.95)) throw new Error("--train-ratio must be between 0.5 and 0.95.");
  return options;
}

export async function runTune(options: TuneOptions): Promise<TuneReport> {
  const pool = new pg.Pool({ connectionString: options.databaseUrl, max: 2, connectionTimeoutMillis: 10_000, query_timeout: 60_000 });
  pool.on("error", () => {});
  try {
    const params: unknown[] = [];
    const competitionFilter = options.competitionId ? `AND m.competition_id = $${params.push(options.competitionId)}` : "";
    const rows = (await pool.query<TuneRow>(
      `SELECT m.id::text AS id,
              m.scheduled_start_at AS date,
              m.home_team_id::text AS home_team_id,
              m.away_team_id::text AS away_team_id,
              s.home_score_fulltime::int AS home_goals,
              s.away_score_fulltime::int AS away_goals
       FROM matches m
       INNER JOIN football_match_scores s ON s.match_id = m.id
       WHERE m.status IN ('finished', 'after_extra_time', 'after_penalties')
         AND s.home_score_fulltime IS NOT NULL
         AND s.away_score_fulltime IS NOT NULL
         ${competitionFilter}
       ORDER BY m.scheduled_start_at ASC, m.id ASC
       LIMIT $${params.push(options.limit)}`,
      params
    )).rows;
    const matches: FootballModelMatch[] = rows.map((row) => ({
      date: new Date(row.date),
      homeTeamId: row.home_team_id,
      awayTeamId: row.away_team_id,
      homeGoals: Number(row.home_goals),
      awayGoals: Number(row.away_goals)
    }));
    const split = Math.floor(matches.length * options.trainRatio);
    if (split < 100 || matches.length - split < 50) throw new Error("Not enough matches for tuning split.");
    const training = matches.slice(0, split);
    const validation = matches.slice(split);

    const configs: TuneConfig[] = [];
    for (const regularization of [0.001, 0.005, 0.01, 0.02, 0.05]) {
      for (const dixonColesRho of [-0.12, -0.06, 0, 0.06]) {
        for (const timeDecayHalfLifeDays of [180, 365, 730, 3650]) {
          for (const learningRate of [0.05, 0.08, 0.12]) {
            configs.push({ regularization, dixonColesRho, timeDecayHalfLifeDays, learningRate, iterations: 400 });
          }
        }
      }
    }

    const results: TuneResult[] = [];
    for (const config of configs) {
      const model = fitFootballPoissonModel(training, config);
      let predictions = 0;
      let correct = 0;
      let logLoss = 0;
      let brier = 0;
      for (const match of validation) {
        if (!model.teams[match.homeTeamId] || !model.teams[match.awayTeamId]) continue;
        const probabilities = predictFootballMarkets(model, match.homeTeamId, match.awayTeamId);
        const values = [probabilities.homeWin, probabilities.draw, probabilities.awayWin];
        const predicted = values.indexOf(Math.max(...values));
        const actual = outcomeOf(match.homeGoals, match.awayGoals);
        const actualIndex = actual === "home" ? 0 : actual === "draw" ? 1 : 2;
        predictions += 1;
        correct += predicted === actualIndex ? 1 : 0;
        logLoss += -Math.log(Math.max(1e-12, values[actualIndex]!));
        brier += values.reduce((sum, value, index) => sum + (value - (index === actualIndex ? 1 : 0)) ** 2, 0);
      }
      if (predictions === 0) continue;
      results.push({
        config,
        accuracy: round(correct / predictions, 4),
        logLoss: round(logLoss / predictions, 4),
        brierScore: round(brier / predictions, 4),
        predictions
      });
    }
    results.sort((left, right) => left.logLoss - right.logLoss || right.accuracy - left.accuracy);
    const best = results[0];
    if (!best) throw new Error("No tuning configuration produced predictions.");
    return {
      competitionId: options.competitionId ?? null,
      trainingMatches: training.length,
      validationMatches: validation.length,
      evaluatedConfigs: results.length,
      best,
      top: results.slice(0, 10)
    };
  } finally {
    await pool.end().catch(() => {});
  }
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

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void (async () => {
    let options: TuneOptions | undefined;
    try {
      options = parseTuneArgs(process.argv.slice(2));
      if (options.logRun) {
        await writeSyncRunLog({
          job: "model-tune",
          status: "running",
          mode: "execute",
          phase: "begin",
          summary: JSON.stringify({ competitionId: options.competitionId ?? null, limit: options.limit })
        }, options.databaseUrl);
      }
      const report = await runTune(options);
      if (options.logRun) {
        await writeSyncRunLog({
          job: "model-tune",
          status: "succeeded",
          mode: "execute",
          phase: "final",
          summary: JSON.stringify(report)
        }, options.databaseUrl);
      }
      console.log(JSON.stringify(report, null, 2));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Model tuning failed.";
      if (options?.logRun) {
        await writeSyncRunLog({
          job: "model-tune",
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
