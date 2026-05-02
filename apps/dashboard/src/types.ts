export type FeatureStatus = "ready" | "partial" | "insufficient_data";

export interface AuthUser {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  phoneNumber?: string | null;
  role: "admin" | "member";
  status: "active" | "disabled";
  createdAt?: string;
  lastLoginAt?: string | null;
}

export type AnalysisWindowStatus = "within_window" | "too_early" | "too_late" | "stale" | "unknown";

export interface DashboardOverviewResponse {
  user: {
    email: string;
    role: "member" | "admin";
  };
  overview: {
    analyzedMatchesCount: number;
    readyMatchesCount: number;
    partialMatchesCount: number;
    insufficientMatchesCount: number;
    averageCombinedCoverageScore: number | null;
    predictionEligibleCount: number;
    h2hMissingCount: number;
  };
  upcomingMatches: DashboardUpcomingMatch[];
  analysisDistribution: {
    ready: number;
    partial: number;
    insufficient: number;
    unknown: number;
  };
  coverageSummary: {
    averageCombinedCoverageScore: number | null;
    averageHomeFormCoverage: number | null;
    averageAwayFormCoverage: number | null;
    averageH2hCoverage: number | null;
  };
  predictionPreview: {
    status: "available" | "not_available" | "stale" | "not_ready";
    items: DashboardPredictionPreviewItem[];
  };
  dataStatus: {
    analyticsApi: "ok" | "empty" | "error";
    teamsCatalog: "ok" | "empty" | "error";
    competitionsCatalog: "ok" | "empty" | "error";
    predictionPreview: "ok" | "empty" | "error";
  };
  admin?: {
    draftPredictionCount: number;
    settlementCount: number;
    publicEligibilityExcludedCount: number | null;
    publicEligibilityEligibleCount: number | null;
    rebuildRequiredCount: number;
  };
}

export interface DashboardUpcomingMatch {
  matchId: string;
  competition: CompetitionSummary;
  kickoffAt: string;
  status: string;
  homeTeam: TeamSummary;
  awayTeam: TeamSummary;
  featureStatus: FeatureStatus | null;
  predictionEligible: boolean;
  combinedCoverageScore: number | null;
  analysisWindowStatus: AnalysisWindowStatus | null;
  hasPredictionPreview: boolean;
}

export interface DashboardPredictionPreviewItem {
  matchId: string;
  matchLabel: string;
  displayLabel: string;
  recommendationTier: "primary" | "try" | "alternative";
  confidenceScore: number | null;
  riskLevel: string;
}

export interface TeamSummary {
  id: string;
  name: string;
  logoUrl?: string | null;
}

export interface CompetitionSummary {
  id: string;
  name: string;
  country: string | null;
}

export interface CoverageBlock {
  sampleSize: number;
  coverageScore: number | null;
  scope?: string | null;
  windowSize?: number | null;
}

export interface H2HBlock {
  sampleSize: number;
  coverageScore: number | null;
  h2hMissing: boolean;
}

export interface FootballAnalyticsMatchReport {
  match: {
    matchId: string;
    competition: CompetitionSummary;
    kickoffAt: string;
    status: string;
    homeTeam: TeamSummary;
    awayTeam: TeamSummary;
  };
  featureStatus: FeatureStatus;
  predictionEligible: boolean;
  kuponEligible: boolean;
  confidenceCeiling: number;
  combinedCoverageScore: number;
  homeForm: CoverageBlock;
  awayForm: CoverageBlock;
  h2h: H2HBlock;
  positiveSignals: string[];
  riskFactors: string[];
  missingDataWarnings: string[];
  summary: string;
  expectedTotalGoalsProxy?: number | null;
  expectedHomeGoalsProxy?: number | null;
  expectedAwayGoalsProxy?: number | null;
  goalProfile?: string | null;
  firstHalfGoalProfile?: string | null;
  bttsProfile?: string | null;
  homeTeamGoalProfile?: string | null;
  awayTeamGoalProfile?: string | null;
  homeGoalSignalScore?: number | null;
  awayGoalSignalScore?: number | null;
  firstHalfGoalSignalScore?: number | null;
  bttsSignalScore?: number | null;
  debug?: {
    sourceFeatureIds: {
      homeFormFeatureId?: string | null;
      awayFormFeatureId?: string | null;
      h2hFeatureId?: string | null;
    };
    metadata: Record<string, unknown>;
  };
}

export interface FootballAnalyticsMatchListResponse {
  items: FootballAnalyticsMatchReport[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
  };
}

export interface FootballAnalyticsMatchFilters {
  featureStatus?: FeatureStatus | "";
  predictionEligible?: boolean | "";
  kuponEligible?: boolean | "";
  status?: "upcoming" | "all" | "not_started" | "scheduled";
  analysisWindowStatus?: AnalysisWindowStatus;
  hasH2h?: boolean | "";
  hasPrediction?: boolean | "";
  countryId?: string;
  limit?: number;
  offset?: number;
  competitionId?: string;
  teamId?: string;
  search?: string;
}

export interface Pagination {
  limit: number;
  offset: number;
  total: number;
}

export interface FootballCatalogCompetitionSummary {
  competitionId: string;
  name: string;
  country: string | null;
}

export interface FootballTeamListItem {
  teamId: string;
  name: string;
  shortName: string | null;
  logoUrl: string | null;
  country: string | null;
  competitions: FootballCatalogCompetitionSummary[];
  matchesCount: number;
  hasLogo: boolean;
  latestFormCoverage: number | null;
}

export interface FootballTeamsListResponse {
  items: FootballTeamListItem[];
  pagination: Pagination;
}

export interface FootballCatalogMatchSummary {
  matchId: string;
  competition: CompetitionSummary;
  kickoffAt: string;
  status: string;
  homeTeam: TeamSummary;
  awayTeam: TeamSummary;
  featureStatus: FeatureStatus | null;
  combinedCoverageScore: number | null;
}

export interface FootballTeamDetail extends FootballTeamListItem {
  recentMatches: FootballCatalogMatchSummary[];
  latestForm: Array<{
    featureId: string;
    competitionId: string | null;
    windowSize: number;
    scope: string;
    sampleSize: number;
    coverageScore: number;
    points: number;
    avgGoalsFor: number | null;
    avgGoalsAgainst: number | null;
  }>;
  analyticsReadiness: AnalyticsReadinessSummary;
}

export interface FootballCompetitionListItem {
  competitionId: string;
  name: string;
  country: string | null;
  teamsCount: number;
  matchesCount: number;
  readyMatchesCount: number;
  averageCoverage: number | null;
}

export interface FootballCompetitionsListResponse {
  items: FootballCompetitionListItem[];
  pagination: Pagination;
}

export interface FootballCompetitionDetail extends FootballCompetitionListItem {
  teams: FootballTeamListItem[];
  matches: FootballCatalogMatchSummary[];
  standings: Array<{
    teamId: string;
    teamName: string;
    logoUrl: string | null;
    position: number;
    played: number;
    wins: number;
    draws: number;
    losses: number;
    goalsFor: number;
    goalsAgainst: number;
    goalDifference: number;
    points: number;
  }>;
  analyticsReadiness: AnalyticsReadinessSummary;
}

export interface AnalyticsReadinessSummary {
  analyzedMatchesCount: number;
  readyMatchesCount: number;
  partialMatchesCount: number;
  insufficientDataMatchesCount: number;
  averageCoverage: number | null;
}

export type PredictionConsistencyStatus = "unchecked" | "passed" | "warning" | "blocked";
export type RecommendationTier = "primary" | "try" | "alternative" | "avoid";
export type FootballCompetitionDataStatus = "ready" | "partial" | "insufficient";

export interface FootballCountrySummary {
  id: string;
  name: string;
  logoUrl: string | null;
  competitionCount: number;
  teamCount: number;
  matchCount: number;
  finishedMatchCount: number;
  upcomingMatchCount: number;
  averageCoverage: number | null;
}

export interface FootballCompetitionExplorerSummary {
  id: string;
  name: string;
  country: {
    id: string;
    name: string;
  };
  logoUrl: string | null;
  teamCount: number;
  standingRows: number;
  matchCount: number;
  finishedMatchCount: number;
  upcomingMatchCount: number;
  averageCoverage: number | null;
  dataStatus: FootballCompetitionDataStatus;
}

export interface FootballCompetitionProfile {
  competition: {
    id: string;
    name: string;
    logoUrl: string | null;
    country: {
      id: string;
      name: string;
      logoUrl: string | null;
    };
  };
  summary: {
    teamCount: number;
    standingRows: number;
    matchCount: number;
    finishedMatchCount: number;
    upcomingMatchCount: number;
    averageCoverage: number | null;
    h2hSupportedUpcomingCount: number;
    predictionReadyUpcomingCount: number;
  };
  standings: Array<{
    teamId: string;
    teamName: string;
    logoUrl: string | null;
    position: number;
    played: number;
    wins: number;
    draws: number;
    losses: number;
    goalsFor: number;
    goalsAgainst: number;
    goalDifference: number;
    points: number;
  }>;
  teams: FootballTeamListItem[];
  upcomingMatches: FootballCatalogMatchSummary[];
  recentMatches: FootballCatalogMatchSummary[];
  dataCoverage: {
    dataStatus: FootballCompetitionDataStatus;
    hasStandings: boolean;
    hasTeams: boolean;
    hasRecentScores: boolean;
    hasUpcomingMatches: boolean;
    averageCoverage: number | null;
  };
}

export type FootballPredictionSettlementStatus = "settled_success" | "settled_failed" | "settled_void";

export interface FootballPredictionDraftFilters {
  matchId?: string;
  consistencyStatus?: PredictionConsistencyStatus | "";
  recommendationTier?: RecommendationTier | "";
  limit?: number;
  offset?: number;
}

export interface FootballPredictionDraftListItem {
  predictionId: string;
  matchId: string;
  match: {
    matchId: string;
    competition: CompetitionSummary;
    kickoffAt: string;
    status: string;
    homeTeam: TeamSummary;
    awayTeam: TeamSummary;
  };
  predictionType: string;
  predictionValue: string;
  predictionFamily: string;
  recommendationTier: RecommendationTier | null;
  displayLabel: string | null;
  confidenceScore: number | null;
  confidenceCeiling: number | null;
  riskLevel: string;
  status: string;
  consistencyStatus: PredictionConsistencyStatus;
  conflictCount: number;
  blockingConflictCount: number;
  warningConflictCount: number;
  reasoningSummary: string | null;
  generatedAt: string;
  createdAt: string;
}

export interface FootballPredictionDraftsListResponse {
  items: FootballPredictionDraftListItem[];
  pagination: Pagination;
}

export interface FootballPredictionDraftDetail extends FootballPredictionDraftListItem {
  expectationSnapshot: Record<string, unknown> | null;
  consistencySummary: string | null;
  conflicts: Array<{
    conflictType: string;
    severity: "blocking" | "warning" | "info";
    sourcePredictionType: string | null;
    conflictingPredictionType: string | null;
    reason: string;
  }>;
  metadata: Record<string, unknown>;
}

export interface FootballMatchPredictionDraftsResponse {
  match: FootballPredictionDraftListItem["match"];
  outputsByRecommendationTier: Record<RecommendationTier, { label: string; items: FootballPredictionDraftListItem[] }>;
  conflictsSummary: {
    total: number;
    blocking: number;
    warning: number;
    info: number;
  };
  memberVisible: false;
  note: string;
}

export interface FootballMemberPredictionPreviewCandidate {
  predictionId: string;
  displayLabel: string;
  predictionType: string;
  predictionValue: string;
  recommendationTier: "primary" | "try" | "alternative";
  confidenceScore: number | null;
  riskLevel: string;
  reasoningSummary: string | null;
  generatedAt: string;
  kickoffAt: string;
  isFresh: boolean;
  analysisWindowStatus: string | null;
}

export interface FootballMemberPredictionPreviewResponse {
  matchId: string;
  status: "available" | "not_available" | "stale" | "not_ready" | "closed";
  reasonCode:
    | "available"
    | "stale"
    | "not_ready"
    | "too_early"
    | "pending_generation"
    | "too_late"
    | "closed"
    | "not_available";
  message: string;
  analysisWindow: {
    status: "within_window" | "too_early" | "too_late" | "closed" | "unknown";
    windowHours: number;
    minimumLeadMinutes: number;
  };
  groups: Record<"primary" | "try" | "alternative", FootballMemberPredictionPreviewCandidate[]>;
  summary: string;
  warnings: string[];
}

export interface FootballPredictionSettlementFilters {
  matchId?: string;
  predictionId?: string;
  settlementStatus?: FootballPredictionSettlementStatus | "";
  consistencyStatus?: PredictionConsistencyStatus | "";
  recommendationTier?: RecommendationTier | "";
  auditOnly?: boolean | "";
  limit?: number;
  offset?: number;
}

export interface FootballPredictionSettlementListItem {
  settlementId: string;
  predictionId: string;
  matchId: string;
  match: FootballPredictionDraftListItem["match"];
  predictionType: string;
  predictionValue: string;
  predictionFamily: string;
  recommendationTier: RecommendationTier | null;
  displayLabel: string | null;
  confidenceScore: number | null;
  confidenceCeiling: number | null;
  riskLevel: string;
  status: string;
  consistencyStatus: PredictionConsistencyStatus;
  settlementStatus: FootballPredictionSettlementStatus;
  actualResult: string;
  settlementReason: string;
  auditOnly: boolean;
  memberVisible: boolean;
  publicStatus: {
    publicEligible: boolean;
    publicPublished: boolean;
    status: string;
  };
  conflictCount: number;
  blockingConflictCount: number;
  warningConflictCount: number;
  reasoningSummary: string | null;
  evaluatedAt: string;
  createdAt: string;
}

export interface FootballPredictionSettlementsListResponse {
  items: FootballPredictionSettlementListItem[];
  pagination: Pagination;
}

export interface FootballPredictionSettlementDetail extends FootballPredictionSettlementListItem {
  expectationSnapshot: Record<string, unknown> | null;
  consistencySummary: string | null;
  conflicts: FootballPredictionDraftDetail["conflicts"];
  settlementMetadata: Record<string, unknown>;
  predictionMetadata: Record<string, unknown>;
  guardNotes: string[];
}

export interface FootballMatchPredictionSettlementsResponse {
  match: FootballPredictionDraftListItem["match"];
  outputsByRecommendationTier: Record<RecommendationTier, { label: string; items: FootballPredictionSettlementListItem[] }>;
  settlementSummary: {
    success: number;
    failed: number;
    void: number;
    auditOnly: number;
    memberVisible: number;
    publicEligible: number;
    publicPublished: number;
  };
  conflictsSummary: {
    total: number;
    blocking: number;
    warning: number;
    info: number;
  };
  note: string;
}

export interface FootballPredictionResultsFilters {
  countryId?: string;
  competitionId?: string;
  teamId?: string;
  matchId?: string;
  status?: "won" | "lost" | "void" | "pending" | "not_settleable" | "missing_score" | "unsupported_market" | "";
  tier?: "primary" | "try" | "alternative" | "";
  marketType?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface FootballPredictionResultItem {
  country: { id: string | null; name: string | null };
  competition: { id: string; name: string; logoUrl: string | null };
  match: {
    id: string;
    homeTeam: { id: string; name: string; logoUrl: string | null };
    awayTeam: { id: string; name: string; logoUrl: string | null };
    kickoffAt: string;
    finalScore: string | null;
    halftimeScore: string | null;
  };
  prediction: {
    marketType: string;
    selection: string;
    displayLabel: string;
    tier: "primary" | "try" | "alternative";
    confidence: number | null;
  };
  settlement: {
    status: "won" | "lost" | "void" | "pending" | "not_settleable" | "missing_score" | "unsupported_market";
    settledAt: string | null;
    explanation: string;
  };
}

export interface FootballPredictionResultsResponse {
  items: FootballPredictionResultItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface FootballPredictionResultsSummary {
  totalSettled: number;
  won: number;
  lost: number;
  pending: number;
  byCountry: Array<{ id: string | null; name: string | null; count: number }>;
  byLeague: Array<{ id: string; name: string; count: number }>;
  byTier: Array<{ tier: string; count: number }>;
  byMarketType: Array<{ marketType: string; count: number }>;
}

export interface FootballPublicEligibilityFilters {
  matchId?: string;
  predictionId?: string;
  settlementStatus?: FootballPredictionSettlementStatus | "";
  consistencyStatus?: PredictionConsistencyStatus | "";
  recommendationTier?: RecommendationTier | "";
  limit?: number;
  offset?: number;
}

export interface FootballPublicEligibilityItem {
  predictionOutputId: string;
  matchId: string;
  match: FootballPredictionDraftListItem["match"];
  predictionType: string;
  predictionValue: string;
  displayLabel: string | null;
  recommendationTier: RecommendationTier | null;
  confidenceScore: number | null;
  settlementStatus?: FootballPredictionSettlementStatus;
  eligible: boolean;
  reasons: string[];
  blockers: string[];
  blockerMessages: string[];
  warnings: string[];
  suggestedPublicTitle?: string;
  suggestedPublicSummary?: string;
  sourceClassification: {
    outputStatus: string;
    settlementStatus?: string;
    recommendationTier?: string | null;
    consistencyStatus: PredictionConsistencyStatus;
    auditOnly: boolean;
    blockingConflictCount: number;
    generatedBeforeKickoff: boolean;
    supportedPublicPredictionType: boolean;
  };
}

export interface FootballPublicEligibilitySummary {
  eligibleCount: number;
  excludedCount: number;
  lateGeneratedCount: number;
  auditOnlyCount: number;
  failedCount: number;
  blockedCount: number;
}

export interface FootballPublicEligibilityResponse {
  eligible: FootballPublicEligibilityItem[];
  excluded: FootballPublicEligibilityItem[];
  summary: FootballPublicEligibilitySummary;
  pagination?: Pagination;
  publicSafetyNotes: string[];
}

export interface FootballMatchPublicEligibilityResponse extends FootballPublicEligibilityResponse {
  match: FootballPredictionDraftListItem["match"];
}

export interface FootballTeamProfileResponse {
  team: {
    id: string;
    name: string;
    logoUrl: string | null;
    country: string | null;
    primaryCompetition: {
      id: string;
      name: string;
      country: string | null;
    } | null;
  };
  standing: FootballTeamProfileStanding | null;
  formSummary: {
    overall: FootballTeamProfileFormSummary | null;
    home: FootballTeamProfileFormSummary | null;
    away: FootballTeamProfileFormSummary | null;
  };
  goalProfile: FootballTeamProfileGoalProfile;
  recentMatches: FootballTeamProfileRecentMatch[];
  upcomingMatches: FootballTeamProfileUpcomingMatch[];
  dataCoverage: FootballTeamProfileDataCoverage;
}

export interface FootballTeamProfileStanding {
  position: number;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
}

export interface FootballTeamProfileFormSummary {
  featureId: string;
  competitionId: string | null;
  windowSize: number;
  scope: string;
  sampleSize: number;
  coverageScore: number;
  matchesPlayed: number;
  wins: number;
  draws: number;
  losses: number;
  points: number;
  avgGoalsFor: number | null;
  avgGoalsAgainst: number | null;
  bothTeamsToScoreRate: number | null;
  over05Rate: number | null;
  over15Rate: number | null;
  over25Rate: number | null;
  under25Rate: number | null;
  scoredRate: number | null;
  concededRate: number | null;
  teamOver05Rate: number | null;
  teamOver15Rate: number | null;
  firstHalfOver05Rate: number | null;
  firstHalfAvgGoalsFor: number | null;
  firstHalfAvgGoalsAgainst: number | null;
}

export interface FootballTeamProfileGoalProfile {
  scoredRate: number | null;
  concededRate: number | null;
  teamOver05Rate: number | null;
  teamOver15Rate: number | null;
  under25Rate: number | null;
  firstHalfOver05Rate: number | null;
  firstHalfAvgGoalsFor: number | null;
  firstHalfAvgGoalsAgainst: number | null;
}

export interface FootballTeamProfileRecentMatch {
  matchId: string;
  date: string;
  competition: string;
  opponent: {
    id: string;
    name: string;
    logoUrl: string | null;
  };
  homeAway: "home" | "away";
  fulltimeScore: string | null;
  halftimeScore: string | null;
  result: "W" | "D" | "L" | null;
}

export interface FootballTeamProfileUpcomingMatch {
  matchId: string;
  date: string;
  competition: string;
  opponent: {
    id: string;
    name: string;
    logoUrl: string | null;
  };
  homeAway: "home" | "away";
  status: string;
  analysisStatus: string | null;
}

export interface FootballTeamProfileDataCoverage {
  matchesAvailable: number;
  scoresAvailable: number;
  formCoverageScore: number | null;
  hasStanding: boolean;
  hasLogo: boolean;
  playersAvailable: boolean;
  lineupsAvailable: boolean;
  injuriesAvailable: boolean;
}
