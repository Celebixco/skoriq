/**
 * Probabilistic football goal model (v2 foundation).
 *
 * This is deliberately separate from the existing heuristic candidate engine.
 * It fits a regularized Poisson attack/defence model, applies a Dixon-Coles
 * low-score adjustment, and derives market probabilities from the scoreline
 * matrix. No rule-based "confidence" is used here.
 */
export interface FootballModelMatch {
  id?: string;
  date: Date;
  homeTeamId: string;
  awayTeamId: string;
  homeGoals: number;
  awayGoals: number;
}

export interface FootballPoissonModelOptions {
  iterations?: number;
  learningRate?: number;
  regularization?: number;
  timeDecayHalfLifeDays?: number;
  dixonColesRho?: number;
  maxGoals?: number;
}

export interface FootballTeamStrength {
  attack: number;
  defense: number;
  homeBoost: number;
  matches: number;
}

export interface FootballPoissonModel {
  leagueIntercept: number;
  homeAdvantage: number;
  teams: Record<string, FootballTeamStrength>;
  rho: number;
  options: Required<FootballPoissonModelOptions>;
  trainedMatches: number;
  trainedThrough: string | null;
}

export interface FootballScoreProbability {
  home: number;
  away: number;
  probability: number;
}

export interface FootballMarketProbabilities {
  homeWin: number;
  draw: number;
  awayWin: number;
  doubleChance1X: number;
  doubleChanceX2: number;
  over15: number;
  under15: number;
  over25: number;
  under25: number;
  over35: number;
  under35: number;
  bttsYes: number;
  bttsNo: number;
  homeOver05: number;
  awayOver05: number;
  homeOver15: number;
  awayOver15: number;
  expectedHomeGoals: number;
  expectedAwayGoals: number;
  expectedTotalGoals: number;
  correctScores: FootballScoreProbability[];
}

const DEFAULTS: Required<FootballPoissonModelOptions> = {
  iterations: 600,
  learningRate: 0.08,
  regularization: 0.01,
  timeDecayHalfLifeDays: 365,
  dixonColesRho: -0.06,
  maxGoals: 10
};

const MIN_LAMBDA = 0.05;
const MAX_LAMBDA = 6;

export function fitFootballPoissonModel(matches: readonly FootballModelMatch[], options: FootballPoissonModelOptions = {}): FootballPoissonModel {
  const resolved = { ...DEFAULTS, ...options };
  const rows = matches.filter(validMatch);
  if (rows.length === 0) throw new Error("At least one finished match with scores is required.");

  const teams = new Set<string>();
  for (const match of rows) {
    teams.add(match.homeTeamId);
    teams.add(match.awayTeamId);
  }
  const attack: Record<string, number> = {};
  const defense: Record<string, number> = {};
  const homeBoost: Record<string, number> = {};
  const counts: Record<string, number> = {};
  const homeCounts: Record<string, number> = {};
  for (const teamId of teams) {
    attack[teamId] = 0;
    defense[teamId] = 0;
    homeBoost[teamId] = 0;
    counts[teamId] = 0;
    homeCounts[teamId] = 0;
  }

  const latest = Math.max(...rows.map((match) => match.date.getTime()));
  const weights = rows.map((match) => timeWeight(latest, match.date, resolved.timeDecayHalfLifeDays));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const homeAverage = rows.reduce((sum, match, index) => sum + match.homeGoals * weights[index]!, 0) / totalWeight;
  const awayAverage = rows.reduce((sum, match, index) => sum + match.awayGoals * weights[index]!, 0) / totalWeight;
  let leagueIntercept = Math.log(Math.max(0.1, (homeAverage + awayAverage) / 2));
  let homeAdvantage = clamp(Math.log(Math.max(0.1, homeAverage) / Math.max(0.1, awayAverage)), -0.6, 0.6);

  for (const match of rows) {
    counts[match.homeTeamId] = (counts[match.homeTeamId] ?? 0) + 1;
    counts[match.awayTeamId] = (counts[match.awayTeamId] ?? 0) + 1;
    homeCounts[match.homeTeamId] = (homeCounts[match.homeTeamId] ?? 0) + 1;
  }

  for (let iteration = 0; iteration < resolved.iterations; iteration++) {
    const attackGradient: Record<string, number> = {};
    const defenseGradient: Record<string, number> = {};
    const homeBoostGradient: Record<string, number> = {};
    let interceptGradient = 0;
    let homeGradient = 0;
    for (const teamId of teams) {
      attackGradient[teamId] = 0;
      defenseGradient[teamId] = 0;
      homeBoostGradient[teamId] = 0;
    }

    for (let index = 0; index < rows.length; index++) {
      const match = rows[index]!;
      const weight = weights[index]!;
      const homeLambda = expectedGoals(leagueIntercept, homeAdvantage + homeBoost[match.homeTeamId]!, attack[match.homeTeamId]!, defense[match.awayTeamId]!);
      const awayLambda = expectedGoals(leagueIntercept, 0, attack[match.awayTeamId]!, defense[match.homeTeamId]!);
      const homeResidual = (match.homeGoals - homeLambda) * weight;
      const awayResidual = (match.awayGoals - awayLambda) * weight;
      interceptGradient += homeResidual + awayResidual;
      homeGradient += homeResidual;
      attackGradient[match.homeTeamId]! += homeResidual;
      attackGradient[match.awayTeamId]! += awayResidual;
      defenseGradient[match.awayTeamId]! -= homeResidual;
      defenseGradient[match.homeTeamId]! -= awayResidual;
      homeBoostGradient[match.homeTeamId]! += homeResidual;
    }

    const scale = resolved.learningRate;
    leagueIntercept = clamp(leagueIntercept + scale * interceptGradient / Math.max(1, rows.length), Math.log(0.4), Math.log(2.4));
    homeAdvantage = clamp(homeAdvantage + scale * homeGradient / Math.max(1, rows.length), -0.8, 0.8);
    for (const teamId of teams) {
      const teamMatches = Math.max(1, counts[teamId] ?? 1);
      const homeMatches = Math.max(1, homeCounts[teamId] ?? 1);
      attack[teamId] = clampParam(attack[teamId]! + scale * attackGradient[teamId]! / teamMatches - scale * resolved.regularization * attack[teamId]!);
      defense[teamId] = clampParam(defense[teamId]! + scale * defenseGradient[teamId]! / teamMatches - scale * resolved.regularization * defense[teamId]!);
      homeBoost[teamId] = clampParam(homeBoost[teamId]! + scale * homeBoostGradient[teamId]! / homeMatches - scale * resolved.regularization * homeBoost[teamId]!);
    }
    centerParameters(attack, teams);
    centerParameters(defense, teams);
    centerParameters(homeBoost, teams);
  }

  const teamStrengths: Record<string, FootballTeamStrength> = {};
  for (const teamId of teams) {
    teamStrengths[teamId] = {
      attack: round(attack[teamId]!, 4),
      defense: round(defense[teamId]!, 4),
      homeBoost: round(homeBoost[teamId]!, 4),
      matches: counts[teamId] ?? 0
    };
  }

  return {
    leagueIntercept: round(leagueIntercept, 4),
    homeAdvantage: round(homeAdvantage, 4),
    teams: teamStrengths,
    rho: resolved.dixonColesRho,
    options: resolved,
    trainedMatches: rows.length,
    trainedThrough: rows.reduce((latestDate, match) => (match.date > latestDate ? match.date : latestDate), rows[0]!.date).toISOString()
  };
}

export function predictFootballMarkets(model: FootballPoissonModel, homeTeamId: string, awayTeamId: string): FootballMarketProbabilities {
  const home = model.teams[homeTeamId];
  const away = model.teams[awayTeamId];
  if (!home || !away) throw new Error("Both teams must exist in the fitted model.");

  const homeLambda = expectedGoals(model.leagueIntercept, model.homeAdvantage + home.homeBoost, home.attack, away.defense);
  const awayLambda = expectedGoals(model.leagueIntercept, 0, away.attack, home.defense);
  const matrix = scoreMatrix(homeLambda, awayLambda, model.options.maxGoals, model.rho);

  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;
  let over15 = 0;
  let over25 = 0;
  let over35 = 0;
  let btts = 0;
  let homeOver05 = 0;
  let awayOver05 = 0;
  let homeOver15 = 0;
  let awayOver15 = 0;
  const correctScores: FootballScoreProbability[] = [];

  for (const cell of matrix) {
    const total = cell.home + cell.away;
    if (cell.home > cell.away) homeWin += cell.probability;
    else if (cell.home === cell.away) draw += cell.probability;
    else awayWin += cell.probability;
    if (total > 1.5) over15 += cell.probability;
    if (total > 2.5) over25 += cell.probability;
    if (total > 3.5) over35 += cell.probability;
    if (cell.home > 0 && cell.away > 0) btts += cell.probability;
    if (cell.home > 0) homeOver05 += cell.probability;
    if (cell.away > 0) awayOver05 += cell.probability;
    if (cell.home > 1) homeOver15 += cell.probability;
    if (cell.away > 1) awayOver15 += cell.probability;
    correctScores.push(cell);
  }

  const normalized = normalizeProbabilities({ homeWin, draw, awayWin });
  const total = normalized.homeWin + normalized.draw + normalized.awayWin;
  const over15Norm = normalizePair(over15, total);
  const over25Norm = normalizePair(over25, total);
  const over35Norm = normalizePair(over35, total);
  const bttsNorm = normalizePair(btts, total);

  return {
    homeWin: normalized.homeWin,
    draw: normalized.draw,
    awayWin: normalized.awayWin,
    doubleChance1X: round(normalized.homeWin + normalized.draw, 6),
    doubleChanceX2: round(normalized.draw + normalized.awayWin, 6),
    over15: round(over15Norm, 6),
    under15: round(1 - over15Norm, 6),
    over25: round(over25Norm, 6),
    under25: round(1 - over25Norm, 6),
    over35: round(over35Norm, 6),
    under35: round(1 - over35Norm, 6),
    bttsYes: round(bttsNorm, 6),
    bttsNo: round(1 - bttsNorm, 6),
    homeOver05: round(homeOver05 / total, 6),
    awayOver05: round(awayOver05 / total, 6),
    homeOver15: round(homeOver15 / total, 6),
    awayOver15: round(awayOver15 / total, 6),
    expectedHomeGoals: round(homeLambda, 4),
    expectedAwayGoals: round(awayLambda, 4),
    expectedTotalGoals: round(homeLambda + awayLambda, 4),
    correctScores: correctScores
      .sort((left, right) => right.probability - left.probability)
      .slice(0, 10)
      .map((cell) => ({ home: cell.home, away: cell.away, probability: round(cell.probability / total, 6) }))
  };
}

export function scoreMatrix(homeLambda: number, awayLambda: number, maxGoals = 10, rho = -0.06): FootballScoreProbability[] {
  const homeDistribution = poissonDistribution(homeLambda, maxGoals);
  const awayDistribution = poissonDistribution(awayLambda, maxGoals);
  const cells: FootballScoreProbability[] = [];
  let total = 0;
  for (let home = 0; home <= maxGoals; home++) {
    for (let away = 0; away <= maxGoals; away++) {
      const adjustment = lowScoreAdjustment(home, away, homeLambda, awayLambda, rho);
      const probability = Math.max(0, homeDistribution[home]! * awayDistribution[away]! * adjustment);
      cells.push({ home, away, probability });
      total += probability;
    }
  }
  return cells.map((cell) => ({ ...cell, probability: cell.probability / total }));
}

export function outcomeOf(homeGoals: number, awayGoals: number): "home" | "draw" | "away" {
  if (homeGoals > awayGoals) return "home";
  if (homeGoals < awayGoals) return "away";
  return "draw";
}

function expectedGoals(intercept: number, advantage: number, attack: number, defense: number): number {
  return clamp(Math.exp(intercept + advantage + attack - defense), MIN_LAMBDA, MAX_LAMBDA);
}

function lowScoreAdjustment(home: number, away: number, homeLambda: number, awayLambda: number, rho: number): number {
  if (home === 0 && away === 0) return Math.max(0.01, 1 - homeLambda * awayLambda * rho);
  if (home === 0 && away === 1) return Math.max(0.01, 1 + homeLambda * rho);
  if (home === 1 && away === 0) return Math.max(0.01, 1 + awayLambda * rho);
  if (home === 1 && away === 1) return Math.max(0.01, 1 - rho);
  return 1;
}

function poissonDistribution(lambda: number, maxGoals: number): number[] {
  const distribution = [Math.exp(-lambda)];
  for (let goals = 1; goals <= maxGoals; goals++) {
    distribution[goals] = distribution[goals - 1]! * lambda / goals;
  }
  return distribution;
}

function timeWeight(latest: number, date: Date, halfLifeDays: number): number {
  const ageDays = Math.max(0, (latest - date.getTime()) / 86_400_000);
  return Math.max(0.05, 0.5 ** (ageDays / Math.max(1, halfLifeDays)));
}

function normalizeProbabilities(values: { homeWin: number; draw: number; awayWin: number }) {
  const total = values.homeWin + values.draw + values.awayWin;
  if (total <= 0) return { homeWin: 1 / 3, draw: 1 / 3, awayWin: 1 / 3 };
  return { homeWin: values.homeWin / total, draw: values.draw / total, awayWin: values.awayWin / total };
}

function normalizePair(value: number, total: number): number {
  return total > 0 ? clamp(value / total, 0, 1) : 0;
}

function centerParameters(parameters: Record<string, number>, teams: Set<string>) {
  const values = [...teams].map((teamId) => parameters[teamId]!);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  for (const teamId of teams) parameters[teamId] = clampParam(parameters[teamId]! - mean);
}

function clampParam(value: number): number {
  return Math.max(-2.5, Math.min(2.5, value));
}

function validMatch(match: FootballModelMatch): boolean {
  return (
    Boolean(match.homeTeamId) &&
    Boolean(match.awayTeamId) &&
    match.homeTeamId !== match.awayTeamId &&
    Number.isInteger(match.homeGoals) &&
    Number.isInteger(match.awayGoals) &&
    match.homeGoals >= 0 &&
    match.awayGoals >= 0 &&
    match.homeGoals <= 20 &&
    match.awayGoals <= 20 &&
    Number.isFinite(match.date.getTime())
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
