import type {
  FootballPredictionCandidate,
  FootballPredictionCandidateConsistencyStatus,
  FootballPredictionCandidateReport
} from "./football-prediction-candidate-generator.js";

export type FootballPredictionConflictSeverity = "blocking" | "warning" | "info";
export type FootballPredictionConflictType =
  | "scoreline_goal_conflict"
  | "btts_scoreline_conflict"
  | "total_goals_scoreline_conflict"
  | "first_half_goal_conflict"
  | "result_profile_conflict"
  | "same_match_correlation_warning"
  | "low_goal_high_goal_conflict"
  | "missing_evidence_warning"
  | "h2h_missing_warning"
  | "team_total_goal_conflict";

export interface FootballPredictionCanonicalExpectation {
  expectedHomeGoals?: number;
  expectedAwayGoals?: number;
  expectedTotalGoals?: number;
  expectedScoreline?: string;
  bttsExpected?: boolean;
  firstHalfGoalExpected?: boolean;
  goalProfile: "low_goal" | "medium_goal" | "high_goal" | "unknown";
  firstHalfGoalProfile: "low_goal" | "likely_goal" | "unknown";
  bttsProfile: "yes_lean" | "no_lean" | "balanced" | "unknown";
  homeTeamGoalProfile: "weak" | "moderate" | "strong" | "unknown";
  awayTeamGoalProfile: "weak" | "moderate" | "strong" | "unknown";
  resultProfile: "home_lean" | "away_lean" | "draw_lean" | "balanced" | "unknown";
  h2hMissing: boolean;
  confidenceCeiling?: number;
}

export interface FootballPredictionConsistencyConflict {
  candidatePredictionType: string;
  candidatePredictionValue: string;
  conflictType: FootballPredictionConflictType;
  severity: FootballPredictionConflictSeverity;
  sourcePredictionType?: string;
  conflictingPredictionType?: string;
  reason: string;
}

export interface FootballPredictionConsistencyBundleResult {
  candidates: FootballPredictionCandidate[];
  conflicts: FootballPredictionConsistencyConflict[];
  canonicalExpectation: FootballPredictionCanonicalExpectation;
  blockingConflictCount: number;
  warningConflictCount: number;
  consistencySummary: string;
}

export class FootballPredictionConsistencyEngine {
  checkCandidateBundle(bundle: FootballPredictionCandidateReport): FootballPredictionConsistencyBundleResult {
    const canonicalExpectation = deriveCanonicalExpectation(bundle.candidates);
    const conflicts = bundle.candidates.flatMap((candidate) => this.checkCandidate(candidate, canonicalExpectation, bundle.candidates));
    const candidates = bundle.candidates.map((candidate) =>
      applyConsistencyStatusToCandidate(candidate, statusForCandidate(candidate, conflicts) satisfies FootballPredictionCandidateConsistencyStatus)
    );
    const blockingConflictCount = conflicts.filter((conflict) => conflict.severity === "blocking").length;
    const warningConflictCount = conflicts.filter((conflict) => conflict.severity === "warning").length;

    return {
      candidates,
      conflicts,
      canonicalExpectation,
      blockingConflictCount,
      warningConflictCount,
      consistencySummary: summarizeConsistency(candidates, blockingConflictCount, warningConflictCount)
    };
  }

  checkCandidate(
    candidate: FootballPredictionCandidate,
    canonicalExpectation: FootballPredictionCanonicalExpectation,
    allCandidates: FootballPredictionCandidate[]
  ): FootballPredictionConsistencyConflict[] {
    const conflicts: FootballPredictionConsistencyConflict[] = [];
    const expectedScore = parseScoreline(canonicalExpectation.expectedScoreline);
    const candidateValue = candidate.prediction_value;

    if (candidate.recommendation_tier === "avoid") {
      if (candidate.prediction_type === "first_half_over_0_5" && candidateValue === "avoid_missing_first_half_evidence") {
        conflicts.push(conflict(candidate, "missing_evidence_warning", "blocking", "First-half evidence is missing; candidate must not be recommended."));
      } else {
        conflicts.push(conflict(candidate, "missing_evidence_warning", "warning", "Candidate is marked Uzak Dur and must not be treated as a recommendation."));
      }
    }

    if (expectedScore) {
      const totalGoals = expectedScore.home + expectedScore.away;
      const homeScored = expectedScore.home > 0;
      const awayScored = expectedScore.away > 0;

      if (totalGoals === 0) {
        if (isGoalRequiredCandidate(candidate)) {
          conflicts.push(conflict(candidate, conflictTypeForGoalRequiredCandidate(candidate), "blocking", "Expected scoreline is 0-0, so goal-required candidates are contradictory."));
        }
      }

      if ((expectedScore.home === 1 && expectedScore.away === 0) || (expectedScore.home === 0 && expectedScore.away === 1)) {
        if (isBttsYes(candidate)) {
          conflicts.push(conflict(candidate, "btts_scoreline_conflict", "blocking", "Expected scoreline has only one scoring team, so BTTS yes is contradictory."));
        }
        if (isOver(candidate, 2.5)) {
          conflicts.push(conflict(candidate, "total_goals_scoreline_conflict", "blocking", "Expected scoreline has one total goal, so over 2.5 is contradictory."));
        }
      }

      if ((expectedScore.home === 2 && expectedScore.away === 1) || (expectedScore.home === 1 && expectedScore.away === 2)) {
        if (isBttsNo(candidate)) {
          conflicts.push(conflict(candidate, "btts_scoreline_conflict", "blocking", "Expected scoreline has both teams scoring, so BTTS no is contradictory."));
        }
        if (isUnder(candidate, 1.5)) {
          conflicts.push(conflict(candidate, "total_goals_scoreline_conflict", "blocking", "Expected scoreline has three total goals, so under 1.5 is contradictory."));
        }
      }

      if (isBttsYes(candidate) && (!homeScored || !awayScored)) {
        conflicts.push(conflict(candidate, "btts_scoreline_conflict", "blocking", "Expected scoreline does not have both teams scoring."));
      }
    }

    if (isBttsYes(candidate) && hasCandidate(allCandidates, (other) => isUnder(other, 1.5))) {
      conflicts.push(conflict(candidate, "btts_scoreline_conflict", "blocking", "BTTS yes conflicts with under 1.5 in the same candidate bundle.", "under_1_5"));
    }

    if (candidate.prediction_type === "double_chance" && candidateValue === "1X" && hasHighConfidenceAwayWin(allCandidates)) {
      conflicts.push(conflict(candidate, "result_profile_conflict", "blocking", "Double chance 1X conflicts with a strong away-win candidate.", "match_result_1x2"));
    }

    if (candidate.prediction_type === "match_result_1x2" && candidateValue === "1") {
      if (hasHighConfidenceAwayWin(allCandidates)) {
        conflicts.push(conflict(candidate, "result_profile_conflict", "blocking", "Home-win candidate conflicts with a strong away-win candidate.", "match_result_1x2"));
      }
      if (hasCandidate(allCandidates, (other) => other.prediction_type === "double_chance" && other.prediction_value === "X2" && other.confidence_score >= 58)) {
        conflicts.push(conflict(candidate, "result_profile_conflict", "blocking", "Home-win candidate conflicts with a strong X2 double-chance candidate.", "double_chance"));
      }
    }

    if (canonicalExpectation.h2hMissing && candidate.recommendation_tier !== "avoid") {
      conflicts.push(conflict(candidate, "h2h_missing_warning", "warning", "H2H sample is missing; confidence is capped and future usage should stay cautious."));
    }

    conflicts.push(...checkTotalGoalProfileConsistency(candidate, canonicalExpectation));
    conflicts.push(...checkFirstHalfProfileConsistency(candidate, canonicalExpectation));
    conflicts.push(...checkBttsProfileConsistency(candidate, canonicalExpectation));
    conflicts.push(...checkTeamTotalProfileConsistency(candidate, canonicalExpectation));

    if (isBttsYes(candidate) && !hasStrongBttsEvidence(candidate, canonicalExpectation)) {
      conflicts.push(conflict(candidate, "missing_evidence_warning", "warning", "BTTS yes has usable but not strong balanced scoring evidence."));
    }

    if (candidate.recommendation_tier !== "avoid" && allCandidates.filter((other) => other.recommendation_tier !== "avoid").length > 1) {
      conflicts.push(conflict(candidate, "same_match_correlation_warning", "warning", "Same-match candidates are correlated and must be controlled before future tahmin kombini use."));
    }

    return conflicts;
  }
}

function deriveCanonicalExpectation(candidates: FootballPredictionCandidate[]): FootballPredictionCanonicalExpectation {
  const metadata = candidates.find((candidate) => Number.isFinite(asNumber(candidate.metadata.expected_total_goals)))?.metadata ?? candidates[0]?.metadata ?? {};
  const expectedHomeGoals = asNumber(metadata.expected_home_goals);
  const expectedAwayGoals = asNumber(metadata.expected_away_goals);
  const expectedTotalGoals = asNumber(metadata.expected_total_goals);
  const expectedScoreline = typeof metadata.expected_scoreline === "string" ? metadata.expected_scoreline : deriveScoreline(expectedHomeGoals, expectedAwayGoals);
  const h2hMissing = metadata.h2h_missing === true || metadata.h2hMissing === true;
  const confidenceCeiling = asNumber(metadata.confidence_ceiling);
  const explicitGoalProfile = asGoalProfile(metadata.goal_profile);
  const firstHalfGoalProfile = asFirstHalfGoalProfile(metadata.first_half_goal_profile);
  const bttsProfile = asBttsProfile(metadata.btts_profile);
  const homeTeamGoalProfile = asTeamGoalProfile(metadata.home_team_goal_profile);
  const awayTeamGoalProfile = asTeamGoalProfile(metadata.away_team_goal_profile);

  return {
    expectedHomeGoals,
    expectedAwayGoals,
    expectedTotalGoals,
    expectedScoreline,
    bttsExpected: expectedHomeGoals === undefined || expectedAwayGoals === undefined ? undefined : expectedHomeGoals >= 1 && expectedAwayGoals >= 1,
    goalProfile: explicitGoalProfile ?? goalProfile(expectedTotalGoals),
    firstHalfGoalProfile: firstHalfGoalProfile ?? "unknown",
    bttsProfile: bttsProfile ?? "unknown",
    homeTeamGoalProfile: homeTeamGoalProfile ?? "unknown",
    awayTeamGoalProfile: awayTeamGoalProfile ?? "unknown",
    resultProfile: resultProfile(expectedHomeGoals, expectedAwayGoals),
    h2hMissing,
    confidenceCeiling
  };
}

function checkTotalGoalProfileConsistency(
  candidate: FootballPredictionCandidate,
  expectation: FootballPredictionCanonicalExpectation
): FootballPredictionConsistencyConflict[] {
  const conflicts: FootballPredictionConsistencyConflict[] = [];

  if (isUnder(candidate, 2.5) && expectation.goalProfile === "high_goal") {
    conflicts.push(conflict(candidate, "low_goal_high_goal_conflict", "warning", "High goal profile conflicts with under 2.5; keep this as a cautious alternative only."));
  }

  if (isOver(candidate, 2.5)) {
    if (expectation.expectedTotalGoals !== undefined && expectation.expectedTotalGoals < 1.5) {
      conflicts.push(conflict(candidate, "low_goal_high_goal_conflict", "blocking", "Expected total goal proxy is below 1.5, so over 2.5 is logically unsupported."));
    } else if (expectation.goalProfile === "low_goal") {
      conflicts.push(
        conflict(
          candidate,
          "low_goal_high_goal_conflict",
          candidate.confidence_score >= 58 ? "blocking" : "warning",
          "Low goal profile conflicts with over 2.5."
        )
      );
    } else if (expectation.goalProfile === "medium_goal" && candidate.confidence_score < 65) {
      conflicts.push(conflict(candidate, "low_goal_high_goal_conflict", "warning", "Medium goal profile supports over 1.5 more than over 2.5."));
    } else if (expectation.goalProfile !== "high_goal" && candidate.confidence_score < 65) {
      conflicts.push(conflict(candidate, "low_goal_high_goal_conflict", "warning", "Over 2.5 is not backed by a strongly high goal profile."));
    }
  }

  if (isUnder(candidate, 2.5) && expectation.expectedTotalGoals !== undefined && expectation.expectedTotalGoals >= 2.75) {
    conflicts.push(
      conflict(
        candidate,
        "low_goal_high_goal_conflict",
        candidate.confidence_score >= 65 ? "blocking" : "warning",
        "Expected total goal proxy is high, so under 2.5 needs caution."
      )
    );
  }

  return conflicts;
}

function checkFirstHalfProfileConsistency(
  candidate: FootballPredictionCandidate,
  expectation: FootballPredictionCanonicalExpectation
): FootballPredictionConsistencyConflict[] {
  if (candidate.prediction_type !== "first_half_over_0_5" || candidate.recommendation_tier === "avoid") return [];

  if (expectation.firstHalfGoalProfile === "likely_goal") return [];
  if (expectation.firstHalfGoalProfile === "low_goal") {
    return [conflict(candidate, "first_half_goal_conflict", "blocking", "Low first-half goal profile blocks first_half_over_0_5 recommendations.")];
  }
  return [conflict(candidate, "first_half_goal_conflict", "blocking", "First-half goal profile is unknown; recommendation requires direct first-half evidence.")];
}

function checkBttsProfileConsistency(
  candidate: FootballPredictionCandidate,
  expectation: FootballPredictionCanonicalExpectation
): FootballPredictionConsistencyConflict[] {
  if (!isBttsYes(candidate)) return [];
  const conflicts: FootballPredictionConsistencyConflict[] = [];

  if (expectation.bttsProfile === "balanced") {
    conflicts.push(conflict(candidate, "missing_evidence_warning", "warning", "BTTS profile is balanced, not a direct yes lean."));
  }
  if (expectation.bttsProfile === "no_lean") {
    conflicts.push(
      conflict(
        candidate,
        "btts_scoreline_conflict",
        candidate.confidence_score >= 58 ? "blocking" : "warning",
        "BTTS profile leans no, so BTTS yes is contradictory."
      )
    );
  }

  const weakestExpectedTeamGoals =
    expectation.expectedHomeGoals === undefined || expectation.expectedAwayGoals === undefined
      ? undefined
      : Math.min(expectation.expectedHomeGoals, expectation.expectedAwayGoals);
  if (weakestExpectedTeamGoals !== undefined && weakestExpectedTeamGoals < 0.8) {
    conflicts.push(
      conflict(
        candidate,
        "btts_scoreline_conflict",
        candidate.confidence_score >= 58 ? "blocking" : "warning",
        "One side has a very low expected team-goals proxy, so BTTS yes is unsafe."
      )
    );
  }

  return conflicts;
}

function checkTeamTotalProfileConsistency(
  candidate: FootballPredictionCandidate,
  expectation: FootballPredictionCanonicalExpectation
): FootballPredictionConsistencyConflict[] {
  if (candidate.prediction_family !== "team_total_goals") return [];

  const teamSide = teamTotalSide(candidate);
  const expectedTeamGoals = teamSide === "home" ? expectation.expectedHomeGoals : teamSide === "away" ? expectation.expectedAwayGoals : undefined;
  const teamProfile = teamSide === "home" ? expectation.homeTeamGoalProfile : teamSide === "away" ? expectation.awayTeamGoalProfile : "unknown";
  if (!teamSide) return [];

  if (isTeamTotalOver(candidate, 0.5) && expectedTeamGoals !== undefined && expectedTeamGoals < 0.8) {
    return [
      conflict(
        candidate,
        "team_total_goal_conflict",
        candidate.confidence_score >= 58 ? "blocking" : "warning",
        "Expected team-goals proxy is below 0.8, so team over 0.5 is unsafe."
      )
    ];
  }

  if (isTeamTotalOver(candidate, 0.5) && teamProfile === "weak") {
    return [conflict(candidate, "team_total_goal_conflict", "warning", "Team goal profile is weak; team-total over needs caution.")];
  }

  return [];
}

function deriveScoreline(homeGoals: number | undefined, awayGoals: number | undefined): string | undefined {
  if (homeGoals === undefined || awayGoals === undefined) return undefined;
  return `${Math.max(0, Math.round(homeGoals))}-${Math.max(0, Math.round(awayGoals))}`;
}

function goalProfile(expectedTotalGoals: number | undefined): FootballPredictionCanonicalExpectation["goalProfile"] {
  if (expectedTotalGoals === undefined) return "unknown";
  if (expectedTotalGoals >= 3.1) return "high_goal";
  if (expectedTotalGoals >= 1.75) return "medium_goal";
  return "low_goal";
}

function resultProfile(homeGoals: number | undefined, awayGoals: number | undefined): FootballPredictionCanonicalExpectation["resultProfile"] {
  if (homeGoals === undefined || awayGoals === undefined) return "unknown";
  const edge = homeGoals - awayGoals;
  if (edge >= 0.35) return "home_lean";
  if (edge <= -0.35) return "away_lean";
  if (Math.abs(edge) <= 0.15) return "draw_lean";
  return "balanced";
}

function parseScoreline(scoreline: string | undefined): { home: number; away: number } | undefined {
  if (!scoreline) return undefined;
  const match = /^(\d+)-(\d+)$/.exec(scoreline.trim());
  if (!match) return undefined;
  return { home: Number(match[1]), away: Number(match[2]) };
}

function statusForCandidate(
  candidate: FootballPredictionCandidate,
  conflicts: FootballPredictionConsistencyConflict[]
): FootballPredictionCandidateConsistencyStatus {
  const candidateConflicts = conflicts.filter(
    (item) => item.candidatePredictionType === candidate.prediction_type && item.candidatePredictionValue === candidate.prediction_value
  );
  if (candidateConflicts.some((item) => item.severity === "blocking")) return "blocked";
  if (candidateConflicts.some((item) => item.severity === "warning")) return "warning";
  return "passed";
}

function applyConsistencyStatusToCandidate(
  candidate: FootballPredictionCandidate,
  consistencyStatus: FootballPredictionCandidateConsistencyStatus
): FootballPredictionCandidate {
  if (consistencyStatus !== "blocked") {
    return {
      ...candidate,
      consistency_status: consistencyStatus
    };
  }

  return {
    ...candidate,
    consistency_status: consistencyStatus,
    recommendation_tier: "avoid",
    display_label: "Uzak Dur",
    risk_level: "high",
    reasoning_summary: `Bu aday tutarlılık kontrolünden geçmediği için öneri olarak gösterilmez. ${candidate.reasoning_summary}`
  };
}

function summarizeConsistency(candidates: FootballPredictionCandidate[], blockingCount: number, warningCount: number): string {
  const passed = candidates.filter((candidate) => candidate.consistency_status === "passed").length;
  const warned = candidates.filter((candidate) => candidate.consistency_status === "warning").length;
  const blocked = candidates.filter((candidate) => candidate.consistency_status === "blocked").length;
  return `Consistency dry-run complete: ${passed} passed, ${warned} warning, ${blocked} blocked (${blockingCount} blocking conflicts, ${warningCount} warnings).`;
}

function conflict(
  candidate: FootballPredictionCandidate,
  conflictType: FootballPredictionConflictType,
  severity: FootballPredictionConflictSeverity,
  reason: string,
  conflictingPredictionType?: string
): FootballPredictionConsistencyConflict {
  return {
    candidatePredictionType: candidate.prediction_type,
    candidatePredictionValue: candidate.prediction_value,
    conflictType,
    severity,
    sourcePredictionType: candidate.prediction_type,
    conflictingPredictionType,
    reason
  };
}

function conflictTypeForGoalRequiredCandidate(candidate: FootballPredictionCandidate): FootballPredictionConflictType {
  if (isBttsYes(candidate)) return "btts_scoreline_conflict";
  if (candidate.prediction_type === "first_half_over_0_5") return "first_half_goal_conflict";
  return "scoreline_goal_conflict";
}

function isGoalRequiredCandidate(candidate: FootballPredictionCandidate): boolean {
  return isOver(candidate, 0.5) || isOver(candidate, 1.5) || isOver(candidate, 2.5) || isBttsYes(candidate) || candidate.prediction_type === "first_half_over_0_5";
}

function isOver(candidate: FootballPredictionCandidate, threshold: number): boolean {
  return normalize(candidate.prediction_value) === `over_${formatThreshold(threshold)}` || normalize(candidate.prediction_type) === `over_${formatThreshold(threshold)}_goals`;
}

function isUnder(candidate: FootballPredictionCandidate, threshold: number): boolean {
  return normalize(candidate.prediction_value) === `under_${formatThreshold(threshold)}` || normalize(candidate.prediction_type) === `under_${formatThreshold(threshold)}_goals`;
}

function isTeamTotalOver(candidate: FootballPredictionCandidate, threshold: number): boolean {
  const normalizedValue = normalize(candidate.prediction_value);
  const thresholdText = formatThreshold(threshold);
  return normalizedValue.includes(`over_${thresholdText}`) || normalizedValue.includes(`_${thresholdText}_üst`) || normalizedValue.includes(`${thresholdText}_ust`);
}

function teamTotalSide(candidate: FootballPredictionCandidate): "home" | "away" | undefined {
  const normalized = `${normalize(candidate.prediction_type)} ${normalize(candidate.prediction_value)}`;
  if (normalized.includes("home") || normalized.includes("ev_sahibi")) return "home";
  if (normalized.includes("away") || normalized.includes("deplasman")) return "away";
  return undefined;
}

function isBttsYes(candidate: FootballPredictionCandidate): boolean {
  return candidate.prediction_family === "both_teams_to_score" && ["yes", "btts_yes"].includes(normalize(candidate.prediction_value));
}

function isBttsNo(candidate: FootballPredictionCandidate): boolean {
  return candidate.prediction_family === "both_teams_to_score" && ["no", "btts_no"].includes(normalize(candidate.prediction_value));
}

function hasHighConfidenceAwayWin(candidates: FootballPredictionCandidate[]) {
  return hasCandidate(candidates, (candidate) => candidate.prediction_type === "match_result_1x2" && candidate.prediction_value === "2" && candidate.confidence_score >= 65);
}

function hasStrongBttsEvidence(candidate: FootballPredictionCandidate, expectation: FootballPredictionCanonicalExpectation) {
  if (expectation.expectedHomeGoals === undefined || expectation.expectedAwayGoals === undefined) return false;
  return Math.min(expectation.expectedHomeGoals, expectation.expectedAwayGoals) >= 1.1 && candidate.confidence_score >= 62;
}

function hasCandidate(candidates: FootballPredictionCandidate[], predicate: (candidate: FootballPredictionCandidate) => boolean) {
  return candidates.some(predicate);
}

function formatThreshold(threshold: number) {
  return String(threshold).replace(".", "_");
}

function normalize(value: string) {
  return value.toLowerCase();
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asGoalProfile(value: unknown): FootballPredictionCanonicalExpectation["goalProfile"] | undefined {
  return value === "low_goal" || value === "medium_goal" || value === "high_goal" || value === "unknown" ? value : undefined;
}

function asFirstHalfGoalProfile(value: unknown): FootballPredictionCanonicalExpectation["firstHalfGoalProfile"] | undefined {
  return value === "low_goal" || value === "likely_goal" || value === "unknown" ? value : undefined;
}

function asBttsProfile(value: unknown): FootballPredictionCanonicalExpectation["bttsProfile"] | undefined {
  return value === "yes_lean" || value === "no_lean" || value === "balanced" || value === "unknown" ? value : undefined;
}

function asTeamGoalProfile(value: unknown): FootballPredictionCanonicalExpectation["homeTeamGoalProfile"] | undefined {
  return value === "weak" || value === "moderate" || value === "strong" || value === "unknown" ? value : undefined;
}
