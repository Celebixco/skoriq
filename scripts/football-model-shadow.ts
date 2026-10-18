import "dotenv/config";
import { pathToFileURL } from "node:url";
import pg from "pg";
import {
  fitFootballPoissonModel,
  predictFootballMarkets,
  type FootballModelMatch
} from "@sports-data/analysis";
import { writeSyncRunLog } from "./sync-run-log.js";

interface ShadowOptions {
  databaseUrl: string;
  windowHours: number;
  minTraining: number;
  logRun: boolean;
}

interface UpcomingRow {
  match_id: string;
  competition_id: string;
  competition_name: string;
  kickoff_at: Date;
  home_team_id: string;
  away_team_id: string;
  home_name: string;
  away_name: string;
}

interface TrainingRow {
  home_team_id: string;
  away_team_id: string;
  home_goals: number;
  away_goals: number;
  date: Date;
}

export interface ShadowPrediction {
  matchId: string;
  competition: string;
  kickoffAt: string;
  homeTeam: string;
  awayTeam: string;
  pick: "home" | "draw" | "away";
  confidence: number;
  homeWin: number;
  draw: number;
  awayWin: number;
  expectedGoals: number;
  homeExpectedGoals: number;
  awayExpectedGoals: number;
}

export interface ShadowReport {
  upcoming: number;
  competitions: number;
  eligibleCompetitions: number;
  predictions: number;
  insufficientData: number;
  highConfidencePredictions: number;
  averageConfidence: number;
  picks: ShadowPrediction[];
}

export function parseShadowArgs(argv: string[]): ShadowOptions {
  const options: ShadowOptions = {
    databaseUrl: process.env.DATABASE_URL ?? "",
    windowHours: 72,
    minTraining: 200,
    logRun: true
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg.startsWith("--window-hours=")) options.windowHours = positiveInteger(arg.slice("--window-hours=".length), arg);
    else if (arg === "--window-hours") options.windowHours = positiveInteger(requireValue(argv, ++index, arg), arg);
    else if (arg.startsWith("--min-training=")) options.minTraining = positiveInteger(arg.slice("--min-training=".length), arg);
    else if (arg === "--min-training") options.minTraining = positiveInteger(requireValue(argv, ++index, arg), arg);
    else if (arg === "--no-log") options.logRun = false;
    else throw new Error(`Unknown shadow argument "${arg}".`);
  }
  if (!options.databaseUrl) throw new Error("DATABASE_URL is required for shadow predictions.");
  return options;
}

export async function runShadow(options: ShadowOptions): Promise<ShadowReport> {
  const pool = new pg.Pool({ connectionString: options.databaseUrl, max: 2, connectionTimeoutMillis: 10_000, query_timeout: 60_000 });
  pool.on("error", () => {});
  try {
    const upcoming = (await pool.query<UpcomingRow>(
      `SELECT m.id::text AS match_id,
              m.competition_id::text AS competition_id,
              c.name AS competition_name,
              m.scheduled_start_at AS kickoff_at,
              home.id::text AS home_team_id,
              away.id::text AS away_team_id,
              home.name AS home_name,
              away.name AS away_name
       FROM matches m
       INNER JOIN competitions c ON c.id = m.competition_id
       INNER JOIN teams home ON home.id = m.home_team_id
       INNER JOIN teams away ON away.id = m.away_team_id
       WHERE m.status IN ('scheduled', 'not_started')
         AND m.scheduled_start_at > now()
         AND m.scheduled_start_at <= now() + ($1::int * interval '1 hour')
       ORDER BY m.scheduled_start_at ASC, m.id ASC`,
      [options.windowHours]
    )).rows;

    const competitionIds = [...new Set(upcoming.map((row) => row.competition_id))];
    const trainingRows = competitionIds.length
      ? (await pool.query<TrainingRow & { competition_id: string }>(
          `SELECT m.competition_id::text AS competition_id,
                  m.home_team_id::text AS home_team_id,
                  m.away_team_id::text AS away_team_id,
                  s.home_score_fulltime::int AS home_goals,
                  s.away_score_fulltime::int AS away_goals,
                  m.scheduled_start_at AS date
           FROM matches m
           INNER JOIN football_match_scores s ON s.match_id = m.id
           WHERE m.competition_id = ANY($1::uuid[])
             AND m.status IN ('finished', 'after_extra_time', 'after_penalties')
             AND s.home_score_fulltime IS NOT NULL
             AND s.away_score_fulltime IS NOT NULL
             AND m.scheduled_start_at < now()
           ORDER BY m.scheduled_start_at ASC, m.id ASC`,
          [competitionIds]
        )).rows
      : [];

    const trainingByCompetition = new Map<string, FootballModelMatch[]>();
    for (const row of trainingRows) {
      const matches = trainingByCompetition.get(row.competition_id) ?? [];
      matches.push({
        date: new Date(row.date),
        homeTeamId: row.home_team_id,
        awayTeamId: row.away_team_id,
        homeGoals: Number(row.home_goals),
        awayGoals: Number(row.away_goals)
      });
      trainingByCompetition.set(row.competition_id, matches);
    }

    const predictions: ShadowPrediction[] = [];
    let insufficientData = 0;
    for (const competitionId of competitionIds) {
      const matches = trainingByCompetition.get(competitionId) ?? [];
      if (matches.length < options.minTraining) {
        insufficientData += upcoming.filter((row) => row.competition_id === competitionId).length;
        continue;
      }
      let model: ReturnType<typeof fitFootballPoissonModel>;
      try {
        model = fitFootballPoissonModel(matches, { iterations: 500, learningRate: 0.08, regularization: 0.01, timeDecayHalfLifeDays: 365, dixonColesRho: -0.06, maxGoals: 10 });
      } catch {
        insufficientData += upcoming.filter((row) => row.competition_id === competitionId).length;
        continue;
      }
      for (const row of upcoming.filter((candidate) => candidate.competition_id === competitionId)) {
        if (!model.teams[row.home_team_id] || !model.teams[row.away_team_id]) {
          insufficientData += 1;
          continue;
        }
        const probabilities = predictFootballMarkets(model, row.home_team_id, row.away_team_id);
        const pick = probabilities.homeWin >= probabilities.draw && probabilities.homeWin >= probabilities.awayWin
          ? "home"
          : probabilities.draw >= probabilities.awayWin
            ? "draw"
            : "away";
        const confidence = pick === "home" ? probabilities.homeWin : pick === "draw" ? probabilities.draw : probabilities.awayWin;
        predictions.push({
          matchId: row.match_id,
          competition: row.competition_name,
          kickoffAt: new Date(row.kickoff_at).toISOString(),
          homeTeam: row.home_name,
          awayTeam: row.away_name,
          pick,
          confidence: round(confidence, 4),
          homeWin: probabilities.homeWin,
          draw: probabilities.draw,
          awayWin: probabilities.awayWin,
          expectedGoals: probabilities.expectedTotalGoals,
          homeExpectedGoals: probabilities.expectedHomeGoals,
          awayExpectedGoals: probabilities.expectedAwayGoals
        });
      }
    }

    predictions.sort((left, right) => right.confidence - left.confidence);
    const highConfidence = predictions.filter((prediction) => prediction.confidence >= 0.6);
    return {
      upcoming: upcoming.length,
      competitions: competitionIds.length,
      eligibleCompetitions: [...trainingByCompetition.entries()].filter(([, matches]) => matches.length >= options.minTraining).length,
      predictions: predictions.length,
      insufficientData,
      highConfidencePredictions: highConfidence.length,
      averageConfidence: predictions.length ? round(predictions.reduce((sum, prediction) => sum + prediction.confidence, 0) / predictions.length, 4) : 0,
      picks: predictions
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
    let options: ShadowOptions | undefined;
    try {
      options = parseShadowArgs(process.argv.slice(2));
      if (options.logRun) {
        await writeSyncRunLog({
          job: "model-shadow",
          status: "running",
          mode: "execute",
          phase: "begin",
          summary: JSON.stringify({ windowHours: options.windowHours, minTraining: options.minTraining })
        }, options.databaseUrl);
      }
      const report = await runShadow(options);
      if (options.logRun) {
        await writeSyncRunLog({
          job: "model-shadow",
          status: "succeeded",
          mode: "execute",
          phase: "final",
          summary: JSON.stringify({
            upcoming: report.upcoming,
            competitions: report.competitions,
            eligibleCompetitions: report.eligibleCompetitions,
            predictions: report.predictions,
            insufficientData: report.insufficientData,
            highConfidencePredictions: report.highConfidencePredictions,
            averageConfidence: report.averageConfidence,
            topPicks: report.picks.slice(0, 10)
          })
        }, options.databaseUrl);
      }
      console.log(JSON.stringify(report, null, 2));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Shadow model failed.";
      if (options?.logRun) {
        await writeSyncRunLog({
          job: "model-shadow",
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
