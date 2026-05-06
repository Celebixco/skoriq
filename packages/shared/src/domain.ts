export const matchStatuses = [
  "scheduled",
  "not_started",
  "postponed",
  "cancelled",
  "finished",
  "after_extra_time",
  "after_penalties",
  "abandoned"
] as const;

export type MatchStatus = (typeof matchStatuses)[number];

export const providerEntityTypes = [
  "sport",
  "country",
  "competition",
  "season",
  "team",
  "player",
  "match",
  "football_match_score",
  "basketball_match_score",
  "basketball_period_score",
  "football_match_team_statistics",
  "basketball_team_match_statistics",
  "football_standing",
  "basketball_standing",
  "match_score",
  "match_event",
  "match_statistics",
  "standing"
] as const;

export type ProviderEntityType = (typeof providerEntityTypes)[number];

export const rawPayloadStatuses = ["received", "processed", "failed", "expired"] as const;
export type RawPayloadStatus = (typeof rawPayloadStatuses)[number];

export const syncJobStatuses = ["queued", "running", "succeeded", "failed", "dead_lettered"] as const;
export type SyncJobStatus = (typeof syncJobStatuses)[number];

export const logLevels = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof logLevels)[number];

export const scorePeriods = ["final", "halftime", "fulltime", "extra_time", "penalties"] as const;
export type ScorePeriod = (typeof scorePeriods)[number];

export const basketballPeriodTypes = ["q1", "q2", "q3", "q4", "overtime"] as const;
export type BasketballPeriodType = (typeof basketballPeriodTypes)[number];

export const footballTeamFormScopes = ["overall", "home", "away"] as const;
export type FootballTeamFormScope = (typeof footballTeamFormScopes)[number];

export const basketballTeamFormScopes = ["overall", "home", "away"] as const;
export type BasketballTeamFormScope = (typeof basketballTeamFormScopes)[number];

export const footballPredictionFamilies = [
  "match_result",
  "scoreline",
  "total_goals",
  "first_half_goals",
  "both_teams_to_score",
  "team_total_goals",
  "double_chance",
  "score_range"
] as const;
export type FootballPredictionFamily = (typeof footballPredictionFamilies)[number];

export const footballPredictionRiskLevels = ["low", "medium", "high", "unknown"] as const;
export type FootballPredictionRiskLevel = (typeof footballPredictionRiskLevels)[number];

export const footballPredictionStatuses = [
  "draft",
  "generated",
  "member_visible",
  "locked",
  "settlement_pending",
  "settled_success",
  "settled_failed",
  "settled_void",
  "public_eligible",
  "public_published",
  "archived"
] as const;
export type FootballPredictionStatus = (typeof footballPredictionStatuses)[number];

export const footballPredictionConsistencyStatuses = ["unchecked", "passed", "warning", "blocked"] as const;
export type FootballPredictionConsistencyStatus = (typeof footballPredictionConsistencyStatuses)[number];

export const footballPredictionConflictSeverities = ["blocking", "warning", "info"] as const;
export type FootballPredictionConflictSeverity = (typeof footballPredictionConflictSeverities)[number];

export const footballPredictionSettlementStatuses = ["settled_success", "settled_failed", "settled_void"] as const;
export type FootballPredictionSettlementStatus = (typeof footballPredictionSettlementStatuses)[number];

export const publicSuccessfulPredictionStatuses = ["draft", "published", "hidden"] as const;
export type PublicSuccessfulPredictionStatus = (typeof publicSuccessfulPredictionStatuses)[number];

export const footballPlayerAvailabilityStatuses = [
  "injured",
  "suspended",
  "doubtful",
  "unavailable",
  "questionable",
  "returned",
  "unknown"
] as const;

export type FootballPlayerAvailabilityStatus = (typeof footballPlayerAvailabilityStatuses)[number];

export const footballMatchLineupRoles = ["starting", "substitute", "coach", "unavailable", "unknown"] as const;
export type FootballMatchLineupRole = (typeof footballMatchLineupRoles)[number];

export const footballPlayerContextRiskLevels = ["low", "medium", "high", "unknown"] as const;
export type FootballPlayerContextRiskLevel = (typeof footballPlayerContextRiskLevels)[number];
