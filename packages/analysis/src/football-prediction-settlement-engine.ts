import type { FootballPredictionSettlementStatus, MatchStatus } from "@sports-data/shared";

const finalStatuses = new Set<MatchStatus>(["finished", "after_extra_time", "after_penalties"]);
const voidStatuses = new Set<MatchStatus>(["cancelled", "postponed", "abandoned"]);

export interface FootballPredictionSettlementPrediction {
  id: string;
  matchId: string;
  predictionType: string;
  predictionValue: string;
  consistencyStatus?: string | null;
  recommendationTier?: string | null;
}

export interface FootballPredictionSettlementMatch {
  id: string;
  status: MatchStatus;
}

export interface FootballPredictionSettlementScore {
  homeScoreFulltime?: number | null;
  awayScoreFulltime?: number | null;
  homeScoreHalftime?: number | null;
  awayScoreHalftime?: number | null;
  status?: MatchStatus | null;
}

export interface FootballPredictionSettlementInput {
  prediction: FootballPredictionSettlementPrediction;
  match: FootballPredictionSettlementMatch;
  score?: FootballPredictionSettlementScore | null;
  evaluatedAt?: Date;
}

export interface FootballPredictionSettlementResult {
  predictionOutputId: string;
  matchId: string;
  settlementStatus: FootballPredictionSettlementStatus;
  actualResult: string;
  evaluatedAt: Date;
  settlementReason: string;
  settlementMetadata: Record<string, unknown>;
}

export class FootballPredictionSettlementEngine {
  settle(input: FootballPredictionSettlementInput): FootballPredictionSettlementResult {
    const evaluatedAt = input.evaluatedAt ?? new Date();
    const base = {
      predictionOutputId: input.prediction.id,
      matchId: input.prediction.matchId,
      evaluatedAt,
      settlementMetadata: {
        predictionType: input.prediction.predictionType,
        predictionValue: input.prediction.predictionValue,
        consistencyStatus: input.prediction.consistencyStatus ?? null,
        recommendationTier: input.prediction.recommendationTier ?? null,
        blockedOrAvoidAuditOnly: input.prediction.consistencyStatus === "blocked" || input.prediction.recommendationTier === "avoid"
      }
    };

    if (voidStatuses.has(input.match.status)) {
      return voidResult(base, "match_status_void", `Match status ${input.match.status} cannot be settled.`);
    }

    if (!finalStatuses.has(input.match.status)) {
      return voidResult(base, "match_not_final", `Match status ${input.match.status} is not final.`);
    }

    if (!input.score) {
      return voidResult(base, "missing_score", "Required normalized football_match_scores row is missing.");
    }

    switch (input.prediction.predictionType) {
      case "match_result_1x2":
        return this.settleMatchResult(input, base);
      case "double_chance":
        return this.settleDoubleChance(input, base);
      case "over_under_goals":
        return this.settleOverUnderGoals(input, base);
      case "both_teams_to_score":
        return this.settleBtts(input, base);
      case "first_half_over_0_5":
        return this.settleFirstHalfOver05(input, base);
      default:
        return voidResult(base, "unsupported_prediction_type", `Prediction type ${input.prediction.predictionType} is not supported by the MVP settlement engine.`);
    }
  }

  private settleMatchResult(input: FootballPredictionSettlementInput, base: BaseSettlementFields) {
    const fulltime = getFulltimeScore(input.score);
    if (!fulltime) return voidResult(base, "missing_final_score", "Fulltime score is required for match_result_1x2 settlement.");
    const result = fulltime.home > fulltime.away ? "1" : fulltime.home === fulltime.away ? "X" : "2";
    if (!["1", "X", "2"].includes(input.prediction.predictionValue)) {
      return voidResult(base, "unsupported_prediction_value", `Unsupported match_result_1x2 value ${input.prediction.predictionValue}.`);
    }
    return decidedResult(base, result === input.prediction.predictionValue, actualResult(fulltime, `result=${result}`), `Match result was ${result}.`);
  }

  private settleDoubleChance(input: FootballPredictionSettlementInput, base: BaseSettlementFields) {
    const fulltime = getFulltimeScore(input.score);
    if (!fulltime) return voidResult(base, "missing_final_score", "Fulltime score is required for double_chance settlement.");
    const result = fulltime.home > fulltime.away ? "1" : fulltime.home === fulltime.away ? "X" : "2";
    const value = input.prediction.predictionValue.toUpperCase();
    const success =
      (value === "1X" && (result === "1" || result === "X")) ||
      (value === "X2" && (result === "X" || result === "2")) ||
      (value === "12" && (result === "1" || result === "2"));
    if (!["1X", "X2", "12"].includes(value)) {
      return voidResult(base, "unsupported_prediction_value", `Unsupported double_chance value ${input.prediction.predictionValue}.`);
    }
    return decidedResult(base, success, actualResult(fulltime, `result=${result}`), `Double chance ${value} evaluated against result ${result}.`);
  }

  private settleOverUnderGoals(input: FootballPredictionSettlementInput, base: BaseSettlementFields) {
    const fulltime = getFulltimeScore(input.score);
    if (!fulltime) return voidResult(base, "missing_final_score", "Fulltime score is required for over_under_goals settlement.");
    const parsed = parseOverUnderValue(input.prediction.predictionValue);
    if (!parsed) return voidResult(base, "unsupported_prediction_value", `Unsupported over_under_goals value ${input.prediction.predictionValue}.`);
    const total = fulltime.home + fulltime.away;
    const success = parsed.kind === "over" ? total >= parsed.minimumForOver : total < parsed.minimumForOver;
    return decidedResult(base, success, actualResult(fulltime, `total=${total}`), `${input.prediction.predictionValue} evaluated against fulltime total ${total}.`);
  }

  private settleBtts(input: FootballPredictionSettlementInput, base: BaseSettlementFields) {
    const fulltime = getFulltimeScore(input.score);
    if (!fulltime) return voidResult(base, "missing_final_score", "Fulltime score is required for both_teams_to_score settlement.");
    const value = input.prediction.predictionValue.toLowerCase();
    if (!["yes", "no"].includes(value)) return voidResult(base, "unsupported_prediction_value", `Unsupported both_teams_to_score value ${input.prediction.predictionValue}.`);
    const btts = fulltime.home >= 1 && fulltime.away >= 1;
    return decidedResult(base, value === "yes" ? btts : !btts, actualResult(fulltime, `btts=${btts ? "yes" : "no"}`), `BTTS was ${btts ? "yes" : "no"}.`);
  }

  private settleFirstHalfOver05(input: FootballPredictionSettlementInput, base: BaseSettlementFields) {
    const home = input.score?.homeScoreHalftime;
    const away = input.score?.awayScoreHalftime;
    if (home === null || away === null || home === undefined || away === undefined) {
      return voidResult(base, "missing_halftime_score", "Halftime score is required for first_half_over_0_5 settlement.");
    }
    const total = home + away;
    return decidedResult(
      base,
      total >= 1,
      `halftime=${home}-${away}; halftime_total=${total}`,
      `first_half_over_0_5 evaluated against halftime total ${total}.`
    );
  }
}

interface BaseSettlementFields {
  predictionOutputId: string;
  matchId: string;
  evaluatedAt: Date;
  settlementMetadata: Record<string, unknown>;
}

function getFulltimeScore(score?: FootballPredictionSettlementScore | null) {
  const home = score?.homeScoreFulltime;
  const away = score?.awayScoreFulltime;
  if (home === null || away === null || home === undefined || away === undefined) return undefined;
  return { home, away };
}

function actualResult(score: { home: number; away: number }, suffix: string) {
  return `fulltime=${score.home}-${score.away}; ${suffix}`;
}

function parseOverUnderValue(value: string) {
  const match = value.match(/^(over|under)_(0|1|2|3)_5$/);
  if (!match) return undefined;
  const line = Number(match[2]);
  return {
    kind: match[1] as "over" | "under",
    minimumForOver: line + 1
  };
}

function decidedResult(base: BaseSettlementFields, success: boolean, actualResultValue: string, reason: string): FootballPredictionSettlementResult {
  return {
    ...base,
    settlementStatus: success ? "settled_success" : "settled_failed",
    actualResult: actualResultValue,
    settlementReason: reason,
    settlementMetadata: { ...base.settlementMetadata, decision: success ? "success" : "failed" }
  };
}

function voidResult(base: BaseSettlementFields, reasonCode: string, reason: string): FootballPredictionSettlementResult {
  return {
    ...base,
    settlementStatus: "settled_void",
    actualResult: reasonCode,
    settlementReason: reason,
    settlementMetadata: { ...base.settlementMetadata, decision: "void", reasonCode }
  };
}
