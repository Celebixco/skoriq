export interface FootballPublicEligibilityPrediction {
  id: string;
  matchId: string;
  status: string;
  predictionType: string;
  predictionValue: string;
  recommendationTier?: string | null;
  displayLabel?: string | null;
  confidenceScore?: number | null;
  consistencyStatus: string;
  blockingConflictCount?: number | null;
  generatedAt: Date | string;
  metadataJson?: Record<string, unknown> | null;
}

export interface FootballPublicEligibilitySettlement {
  settlementStatus: string;
  actualResult?: string | null;
  settlementMetadata?: Record<string, unknown> | null;
}

export interface FootballPublicEligibilityMatch {
  id: string;
  kickoffAt: Date | string;
  homeTeamName?: string | null;
  awayTeamName?: string | null;
  competitionName?: string | null;
}

export interface FootballPublicEligibilityConflict {
  severity: string;
  conflictType?: string | null;
  reason?: string | null;
}

export interface FootballPublicEligibilityInput {
  prediction: FootballPublicEligibilityPrediction;
  settlement?: FootballPublicEligibilitySettlement | null;
  match: FootballPublicEligibilityMatch;
  conflicts?: FootballPublicEligibilityConflict[];
}

export interface FootballPublicEligibilityResult {
  predictionOutputId: string;
  matchId: string;
  eligible: boolean;
  reasons: string[];
  blockers: string[];
  warnings: string[];
  suggestedPublicTitle?: string;
  suggestedPublicSummary?: string;
  sourceClassification: {
    outputStatus: string;
    settlementStatus?: string;
    recommendationTier?: string | null;
    consistencyStatus: string;
    auditOnly: boolean;
    blockingConflictCount: number;
    generatedBeforeKickoff: boolean;
    supportedPublicPredictionType: boolean;
  };
}

const publicRecommendationTiers = new Set(["primary", "try"]);
const publicConsistencyStatuses = new Set(["passed", "warning"]);
const supportedPublicPredictionTypes = new Set([
  "match_result_1x2",
  "double_chance",
  "over_under_goals",
  "both_teams_to_score",
  "first_half_over_0_5"
]);

const unsafeMetadataKeyFragments = ["password", "secret", "token", "cookie", "api_key", "apikey", "database_url", "raw_payload", "raw_provider_payload"];

export class FootballPublicEligibilityEvaluator {
  evaluate(input: FootballPublicEligibilityInput): FootballPublicEligibilityResult {
    const blockers: string[] = [];
    const warnings: string[] = [];
    const reasons: string[] = [];
    const prediction = input.prediction;
    const settlement = input.settlement;
    const blockingConflictCount = countBlockingConflicts(input);
    const auditOnly = isAuditOnly(input);
    const generatedBeforeKickoff = toTime(prediction.generatedAt) < toTime(input.match.kickoffAt);
    const supportedPublicPredictionType = supportedPublicPredictionTypes.has(prediction.predictionType);

    if (prediction.status !== "settled_success") blockers.push("Prediction output status is not settled_success.");
    if (settlement?.settlementStatus !== "settled_success") blockers.push("Settlement status is not settled_success.");
    if (!publicRecommendationTiers.has(prediction.recommendationTier ?? "")) blockers.push("Recommendation tier is not public-eligible.");
    if (!publicConsistencyStatuses.has(prediction.consistencyStatus)) blockers.push("Consistency status is not passed or warning.");
    if (auditOnly) blockers.push("Prediction is audit-only and cannot become public.");
    if (blockingConflictCount > 0) blockers.push("Prediction has blocking conflicts.");
    if (!generatedBeforeKickoff) blockers.push("Prediction was generated after match kickoff.");
    if (!supportedPublicPredictionType) blockers.push("Prediction type is not supported for public cards.");
    if (containsUnsafeMetadata(prediction.metadataJson) || containsUnsafeMetadata(settlement?.settlementMetadata)) {
      blockers.push("Metadata contains unsafe or raw internal fields.");
    }
    if (!input.match.homeTeamName || !input.match.awayTeamName) blockers.push("Match team names are missing for public summary.");

    if (prediction.consistencyStatus === "warning") warnings.push("Consistency warning requires internal review before public eligibility.");
    warnings.push("Eligible means candidate-only; public publishing still requires a separate future review step.");

    if (blockers.length === 0) {
      reasons.push("Settled successfully.");
      reasons.push("Recommendation tier is primary/try.");
      reasons.push("Consistency status has no blocking conflict.");
      reasons.push("Prediction was generated before kickoff.");
    }

    return {
      predictionOutputId: prediction.id,
      matchId: prediction.matchId,
      eligible: blockers.length === 0,
      reasons,
      blockers,
      warnings,
      suggestedPublicTitle: blockers.length === 0 ? buildPublicTitle(input) : undefined,
      suggestedPublicSummary: blockers.length === 0 ? buildPublicSummary(input) : undefined,
      sourceClassification: {
        outputStatus: prediction.status,
        settlementStatus: settlement?.settlementStatus,
        recommendationTier: prediction.recommendationTier,
        consistencyStatus: prediction.consistencyStatus,
        auditOnly,
        blockingConflictCount,
        generatedBeforeKickoff,
        supportedPublicPredictionType
      }
    };
  }

  evaluateMany(inputs: FootballPublicEligibilityInput[]): FootballPublicEligibilityResult[] {
    return inputs.map((input) => this.evaluate(input));
  }
}

function isAuditOnly(input: FootballPublicEligibilityInput) {
  return (
    input.settlement?.settlementMetadata?.blockedOrAvoidAuditOnly === true ||
    input.prediction.metadataJson?.blockedOrAvoidAuditOnly === true ||
    input.prediction.recommendationTier === "avoid" ||
    input.prediction.consistencyStatus === "blocked"
  );
}

function countBlockingConflicts(input: FootballPublicEligibilityInput) {
  const conflictCount = input.conflicts?.filter((conflict) => conflict.severity === "blocking").length ?? 0;
  return Math.max(conflictCount, input.prediction.blockingConflictCount ?? 0);
}

function buildPublicTitle(input: FootballPublicEligibilityInput) {
  const label = input.prediction.displayLabel ?? publicPredictionLabel(input.prediction.predictionType, input.prediction.predictionValue);
  return `${input.match.homeTeamName} - ${input.match.awayTeamName}: ${label}`;
}

function buildPublicSummary(input: FootballPublicEligibilityInput) {
  const competition = input.match.competitionName ? `${input.match.competitionName} maçında` : "Maç analizinde";
  const confidence = typeof input.prediction.confidenceScore === "number" ? ` Güven skoru ${input.prediction.confidenceScore}.` : "";
  return `${competition} ${publicPredictionLabel(input.prediction.predictionType, input.prediction.predictionValue)} analiz sonucu başarılı olarak kapandı.${confidence} Güven skoru kesinlik anlamına gelmez.`;
}

function publicPredictionLabel(type: string, value: string) {
  if (type === "match_result_1x2") return `MS ${value}`;
  if (type === "double_chance") return `Çifte şans ${value}`;
  if (type === "over_under_goals") return value.replaceAll("_", " ");
  if (type === "both_teams_to_score") return value === "yes" ? "Karşılıklı gol var" : "Karşılıklı gol yok";
  if (type === "first_half_over_0_5") return "İlk yarı 0.5 üst";
  return `${type}: ${value}`;
}

function containsUnsafeMetadata(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") {
    return value.includes("postgres://") || value.includes("DATABASE_URL") || value.includes("rawProviderPayload");
  }
  if (Array.isArray(value)) return value.some((item) => containsUnsafeMetadata(item));
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).some(([key, nested]) => {
      const normalizedKey = key.toLowerCase();
      return unsafeMetadataKeyFragments.some((fragment) => normalizedKey.includes(fragment)) || containsUnsafeMetadata(nested);
    });
  }
  return false;
}

function toTime(value: Date | string) {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}
