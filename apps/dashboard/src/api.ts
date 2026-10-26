import type {
  AuthUser,
  AuthPasswordActionResponse,
  DashboardOverviewResponse,
  FootballAnalyticsMatchFilters,
  FootballAnalyticsMatchListResponse,
  FootballAnalyticsMatchReport,
  FootballCompetitionDetail,
  FootballCompetitionsListResponse,
  FootballCompetitionExplorerSummary,
  FootballCompetitionProfile,
  FootballCountrySummary,
  FootballMatchPredictionDraftsResponse,
  FootballMatchLineupsResponse,
  FootballMatchStatisticsResponse,
  FootballMemberPredictionPreviewResponse,
  RcPrematchItem,
  RcPrematchResponse,
  H1PrematchItem,
  H1PrematchResponse,
  H1PredictionResultsResponse,
  H1PredictionResultsSummary,
  FootballPlayerProfileResponse,
  FootballMatchPublicEligibilityResponse,
  FootballMatchPredictionSettlementsResponse,
  FootballPredictionDraftDetail,
  FootballPredictionDraftFilters,
  FootballPredictionDraftsListResponse,
  FootballPublicEligibilityFilters,
  FootballPublicEligibilityResponse,
  FootballPredictionSettlementDetail,
  FootballPredictionSettlementFilters,
  FootballPredictionResultsFilters,
  FootballPredictionResultsResponse,
  FootballPredictionResultsSummary,
  RcPredictionResultsResponse,
  RcPredictionResultsSummary,
  FootballPredictionSettlementsListResponse,
  FootballTeamDetail,
  FootballTeamPlayersResponse,
  FootballTeamProfileResponse,
  FootballTeamsListResponse
} from "./types";

export const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000/api").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

export async function login(email: string, password: string): Promise<{ user: AuthUser }> {
  return requestJson<{ user: AuthUser }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
}

export async function register(input: {
  email: string;
  firstName: string;
  lastName: string;
  phoneNumber: string;
  password: string;
  confirmPassword: string;
  mathLeft: number;
  mathOperator: "+" | "-";
  mathRight: number;
  mathAnswer: number;
}): Promise<{ user: AuthUser }> {
  return requestJson<{ user: AuthUser }>("/auth/register", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function requestPasswordReset(email: string): Promise<AuthPasswordActionResponse> {
  return requestJson<AuthPasswordActionResponse>("/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({ email })
  });
}

export async function resetPassword(input: {
  token: string;
  password: string;
  confirmPassword: string;
}): Promise<AuthPasswordActionResponse> {
  return requestJson<AuthPasswordActionResponse>("/auth/reset-password", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function logout(): Promise<{ ok: boolean }> {
  return requestJson<{ ok: boolean }>("/auth/logout", {
    method: "POST"
  });
}

export async function fetchCurrentUser(): Promise<{ user: AuthUser }> {
  return requestJson<{ user: AuthUser }>("/auth/me");
}

export async function fetchDashboardOverview(): Promise<DashboardOverviewResponse> {
  return requestJson<DashboardOverviewResponse>("/dashboard/overview");
}

export async function fetchFootballAnalyticsMatches(filters: FootballAnalyticsMatchFilters = {}): Promise<FootballAnalyticsMatchListResponse> {
  const params = new URLSearchParams();
  params.set("limit", String(filters.limit ?? 20));
  params.set("offset", String(filters.offset ?? 0));
  params.set("status", filters.status ?? "upcoming");
  if (filters.featureStatus) params.set("featureStatus", filters.featureStatus);
  if (filters.predictionEligible !== "" && filters.predictionEligible !== undefined) params.set("predictionEligible", String(filters.predictionEligible));
  if (filters.kuponEligible !== "" && filters.kuponEligible !== undefined) params.set("kuponEligible", String(filters.kuponEligible));
  if (filters.analysisWindowStatus) params.set("analysisWindowStatus", filters.analysisWindowStatus);
  if (filters.hasH2h !== "" && filters.hasH2h !== undefined) params.set("hasH2h", String(filters.hasH2h));
  if (filters.hasPrediction !== "" && filters.hasPrediction !== undefined) params.set("hasPrediction", String(filters.hasPrediction));
  if (filters.countryId) params.set("countryId", filters.countryId);
  if (filters.competitionId) params.set("competitionId", filters.competitionId);
  if (filters.teamId) params.set("teamId", filters.teamId);
  if (filters.search?.trim()) params.set("search", filters.search.trim());
  return requestJson<FootballAnalyticsMatchListResponse>(`/analytics/football/matches?${params.toString()}`);
}

export async function fetchFootballAnalyticsMatch(matchId: string): Promise<FootballAnalyticsMatchReport> {
  return requestJson<FootballAnalyticsMatchReport>(`/analytics/football/matches/${encodeURIComponent(matchId)}`);
}

export async function fetchFootballTeams(filters: { competitionId?: string; search?: string; limit?: number; offset?: number } = {}): Promise<FootballTeamsListResponse> {
  const params = new URLSearchParams();
  params.set("limit", String(filters.limit ?? 50));
  params.set("offset", String(filters.offset ?? 0));
  if (filters.competitionId) params.set("competitionId", filters.competitionId);
  if (filters.search) params.set("search", filters.search);
  return requestJson<FootballTeamsListResponse>(`/football/teams?${params.toString()}`);
}

export async function fetchFootballTeam(teamId: string): Promise<FootballTeamDetail> {
  return requestJson<FootballTeamDetail>(`/football/teams/${encodeURIComponent(teamId)}`);
}

export async function fetchFootballTeamProfile(teamId: string): Promise<FootballTeamProfileResponse> {
  return requestJson<FootballTeamProfileResponse>(`/football/teams/${encodeURIComponent(teamId)}/profile`);
}

export async function fetchFootballPlayerProfile(playerId: string): Promise<FootballPlayerProfileResponse> {
  return requestJson<FootballPlayerProfileResponse>(`/football/players/${encodeURIComponent(playerId)}`);
}

export async function fetchFootballTeamPlayers(teamId: string): Promise<FootballTeamPlayersResponse> {
  return requestJson<FootballTeamPlayersResponse>(`/football/teams/${encodeURIComponent(teamId)}/players`);
}

export async function fetchFootballTeamAvailability(teamId: string): Promise<{ team: { id: string; name: string; logoUrl: string | null }; items: FootballTeamProfileResponse["playerAvailability"] }> {
  return requestJson(`/football/teams/${encodeURIComponent(teamId)}/availability`);
}

export async function fetchFootballCompetitions(filters: { limit?: number; offset?: number } = {}): Promise<FootballCompetitionsListResponse> {
  const params = new URLSearchParams();
  params.set("limit", String(filters.limit ?? 50));
  params.set("offset", String(filters.offset ?? 0));
  return requestJson<FootballCompetitionsListResponse>(`/football/competitions?${params.toString()}`);
}

export async function fetchFootballCompetition(competitionId: string): Promise<FootballCompetitionDetail> {
  return requestJson<FootballCompetitionDetail>(`/football/competitions/${encodeURIComponent(competitionId)}`);
}

export async function fetchFootballCountries(): Promise<FootballCountrySummary[]> {
  return requestJson<FootballCountrySummary[]>("/football/countries");
}

export async function fetchFootballCountryCompetitions(countryId: string): Promise<FootballCompetitionExplorerSummary[]> {
  return requestJson<FootballCompetitionExplorerSummary[]>(`/football/countries/${encodeURIComponent(countryId)}/competitions`);
}

export async function fetchFootballCompetitionProfile(competitionId: string): Promise<FootballCompetitionProfile> {
  return requestJson<FootballCompetitionProfile>(`/football/competitions/${encodeURIComponent(competitionId)}/profile`);
}

export async function fetchFootballPredictionDrafts(filters: FootballPredictionDraftFilters = {}): Promise<FootballPredictionDraftsListResponse> {
  const params = new URLSearchParams();
  params.set("limit", String(filters.limit ?? 20));
  params.set("offset", String(filters.offset ?? 0));
  if (filters.matchId) params.set("matchId", filters.matchId);
  if (filters.consistencyStatus) params.set("consistencyStatus", filters.consistencyStatus);
  if (filters.recommendationTier) params.set("recommendationTier", filters.recommendationTier);
  return requestJson<FootballPredictionDraftsListResponse>(`/football/predictions/drafts?${params.toString()}`);
}

export async function fetchFootballPredictionDraft(predictionId: string): Promise<FootballPredictionDraftDetail> {
  return requestJson<FootballPredictionDraftDetail>(`/football/predictions/drafts/${encodeURIComponent(predictionId)}`);
}

export async function fetchFootballMatchPredictionDrafts(matchId: string): Promise<FootballMatchPredictionDraftsResponse> {
  return requestJson<FootballMatchPredictionDraftsResponse>(`/football/matches/${encodeURIComponent(matchId)}/prediction-drafts`);
}

export async function fetchFootballMemberPredictionPreview(matchId: string): Promise<FootballMemberPredictionPreviewResponse> {
  return requestJson<FootballMemberPredictionPreviewResponse>(`/member/football/matches/${encodeURIComponent(matchId)}/prediction-preview`);
}

export async function fetchRcUpcomingPredictions(): Promise<RcPrematchResponse> {
  return requestJson<RcPrematchResponse>("/member/football/predictions/upcoming");
}

export async function fetchRcMatchPrediction(matchId: string): Promise<RcPrematchItem> {
  return requestJson<RcPrematchItem>(`/member/football/matches/${encodeURIComponent(matchId)}/rc-prediction`);
}

export async function fetchH1UpcomingPredictions(): Promise<H1PrematchResponse> {
  return requestJson<H1PrematchResponse>("/member/football/h1-predictions/upcoming");
}

export async function fetchH1MatchPrediction(matchId: string): Promise<H1PrematchItem> {
  return requestJson<H1PrematchItem>(`/member/football/matches/${encodeURIComponent(matchId)}/h1-prediction`);
}

export async function fetchH1PredictionResults(filters: FootballPredictionResultsFilters = {}): Promise<H1PredictionResultsResponse> {
  const params = new URLSearchParams();
  params.set("limit", String(filters.limit ?? 50));
  params.set("offset", String(filters.offset ?? 0));
  if (filters.countryId) params.set("countryId", filters.countryId);
  if (filters.competitionId) params.set("competitionId", filters.competitionId);
  if (filters.teamId) params.set("teamId", filters.teamId);
  if (filters.matchId) params.set("matchId", filters.matchId);
  if (filters.status) params.set("status", filters.status);
  if (filters.search?.trim()) params.set("search", filters.search.trim());
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  return requestJson<H1PredictionResultsResponse>(`/member/football/h1-prediction-results?${params.toString()}`);
}

export async function fetchH1PredictionResultsSummary(filters: FootballPredictionResultsFilters = {}): Promise<H1PredictionResultsSummary> {
  const params = new URLSearchParams();
  if (filters.countryId) params.set("countryId", filters.countryId);
  if (filters.competitionId) params.set("competitionId", filters.competitionId);
  if (filters.teamId) params.set("teamId", filters.teamId);
  if (filters.matchId) params.set("matchId", filters.matchId);
  if (filters.status) params.set("status", filters.status);
  if (filters.search?.trim()) params.set("search", filters.search.trim());
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  return requestJson<H1PredictionResultsSummary>(`/member/football/h1-prediction-results/summary?${params.toString()}`);
}

export async function fetchFootballMatchLineups(matchId: string): Promise<FootballMatchLineupsResponse> {
  return requestJson<FootballMatchLineupsResponse>(`/football/matches/${encodeURIComponent(matchId)}/lineups`);
}

export async function fetchFootballMatchStatistics(matchId: string): Promise<FootballMatchStatisticsResponse> {
  return requestJson<FootballMatchStatisticsResponse>(`/football/matches/${encodeURIComponent(matchId)}/statistics`);
}

export async function fetchFootballMatchPlayerAvailability(matchId: string): Promise<{ match: { id: string }; items: FootballTeamProfileResponse["playerAvailability"] }> {
  return requestJson(`/football/matches/${encodeURIComponent(matchId)}/player-availability`);
}

export async function fetchFootballPredictionSettlements(filters: FootballPredictionSettlementFilters = {}): Promise<FootballPredictionSettlementsListResponse> {
  const params = new URLSearchParams();
  params.set("limit", String(filters.limit ?? 20));
  params.set("offset", String(filters.offset ?? 0));
  if (filters.matchId) params.set("matchId", filters.matchId);
  if (filters.predictionId) params.set("predictionId", filters.predictionId);
  if (filters.settlementStatus) params.set("settlementStatus", filters.settlementStatus);
  if (filters.consistencyStatus) params.set("consistencyStatus", filters.consistencyStatus);
  if (filters.recommendationTier) params.set("recommendationTier", filters.recommendationTier);
  if (filters.auditOnly !== "" && filters.auditOnly !== undefined) params.set("auditOnly", String(filters.auditOnly));
  return requestJson<FootballPredictionSettlementsListResponse>(`/football/predictions/settlements?${params.toString()}`);
}

export async function fetchFootballPredictionSettlement(settlementId: string): Promise<FootballPredictionSettlementDetail> {
  return requestJson<FootballPredictionSettlementDetail>(`/football/predictions/settlements/${encodeURIComponent(settlementId)}`);
}

export async function fetchFootballMatchPredictionSettlements(matchId: string): Promise<FootballMatchPredictionSettlementsResponse> {
  return requestJson<FootballMatchPredictionSettlementsResponse>(`/football/matches/${encodeURIComponent(matchId)}/prediction-settlements`);
}

export async function fetchFootballPredictionResults(filters: FootballPredictionResultsFilters = {}): Promise<FootballPredictionResultsResponse> {
  const params = new URLSearchParams();
  params.set("limit", String(filters.limit ?? 50));
  params.set("offset", String(filters.offset ?? 0));
  if (filters.countryId) params.set("countryId", filters.countryId);
  if (filters.competitionId) params.set("competitionId", filters.competitionId);
  if (filters.teamId) params.set("teamId", filters.teamId);
  if (filters.matchId) params.set("matchId", filters.matchId);
  if (filters.status) params.set("status", filters.status);
  if (filters.tier) params.set("tier", filters.tier);
  if (filters.marketType) params.set("marketType", filters.marketType);
  if (filters.search?.trim()) params.set("search", filters.search.trim());
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  return requestJson<FootballPredictionResultsResponse>(`/football/prediction-results?${params.toString()}`);
}

export async function fetchFootballPredictionResultsSummary(filters: FootballPredictionResultsFilters = {}): Promise<FootballPredictionResultsSummary> {
  const params = new URLSearchParams();
  if (filters.countryId) params.set("countryId", filters.countryId);
  if (filters.competitionId) params.set("competitionId", filters.competitionId);
  if (filters.teamId) params.set("teamId", filters.teamId);
  if (filters.matchId) params.set("matchId", filters.matchId);
  if (filters.status) params.set("status", filters.status);
  if (filters.tier) params.set("tier", filters.tier);
  if (filters.marketType) params.set("marketType", filters.marketType);
  if (filters.search?.trim()) params.set("search", filters.search.trim());
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  return requestJson<FootballPredictionResultsSummary>(`/football/prediction-results/summary?${params.toString()}`);
}

export async function fetchRcPredictionResults(filters: FootballPredictionResultsFilters = {}): Promise<RcPredictionResultsResponse> {
  const params = new URLSearchParams();
  params.set("limit", String(filters.limit ?? 50));
  params.set("offset", String(filters.offset ?? 0));
  if (filters.countryId) params.set("countryId", filters.countryId);
  if (filters.competitionId) params.set("competitionId", filters.competitionId);
  if (filters.teamId) params.set("teamId", filters.teamId);
  if (filters.matchId) params.set("matchId", filters.matchId);
  if (filters.status) params.set("status", filters.status);
  if (filters.search?.trim()) params.set("search", filters.search.trim());
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  return requestJson<RcPredictionResultsResponse>(`/member/football/prediction-results?${params.toString()}`);
}

export async function fetchRcPredictionResultsSummary(filters: FootballPredictionResultsFilters = {}): Promise<RcPredictionResultsSummary> {
  const params = new URLSearchParams();
  if (filters.countryId) params.set("countryId", filters.countryId);
  if (filters.competitionId) params.set("competitionId", filters.competitionId);
  if (filters.teamId) params.set("teamId", filters.teamId);
  if (filters.matchId) params.set("matchId", filters.matchId);
  if (filters.status) params.set("status", filters.status);
  if (filters.search?.trim()) params.set("search", filters.search.trim());
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  return requestJson<RcPredictionResultsSummary>(`/member/football/prediction-results/summary?${params.toString()}`);
}

export async function fetchFootballPublicEligibility(filters: FootballPublicEligibilityFilters = {}): Promise<FootballPublicEligibilityResponse> {
  const params = new URLSearchParams();
  params.set("limit", String(filters.limit ?? 20));
  params.set("offset", String(filters.offset ?? 0));
  if (filters.matchId) params.set("matchId", filters.matchId);
  if (filters.predictionId) params.set("predictionId", filters.predictionId);
  if (filters.settlementStatus) params.set("settlementStatus", filters.settlementStatus);
  if (filters.consistencyStatus) params.set("consistencyStatus", filters.consistencyStatus);
  if (filters.recommendationTier) params.set("recommendationTier", filters.recommendationTier);
  return requestJson<FootballPublicEligibilityResponse>(`/football/public-eligibility/evaluate?${params.toString()}`);
}

export async function fetchFootballMatchPublicEligibility(matchId: string): Promise<FootballMatchPublicEligibilityResponse> {
  return requestJson<FootballMatchPublicEligibilityResponse>(`/football/matches/${encodeURIComponent(matchId)}/public-eligibility`);
}

const REQUEST_TIMEOUT_MS = 20_000;
const GET_RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 300;
const RETRY_JITTER_MS = 200;

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const attempts = method === "GET" ? GET_RETRY_ATTEMPTS : 1;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const retryDelayMs = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1) + Math.random() * RETRY_JITTER_MS;
    try {
      const response = await fetch(`${apiBaseUrl}${path}`, {
        ...init,
        credentials: "include",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: {
          accept: "application/json",
          ...(init.body ? { "content-type": "application/json" } : {}),
          ...init.headers
        }
      });
      if (response.ok) {
        return (await response.json()) as T;
      }
      const message = await readApiErrorMessage(response);
      if (attempt < attempts && isRetryableStatus(response.status)) {
        await delay(retryDelayMs);
        continue;
      }
      throw new ApiError(message, response.status);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (attempt < attempts && isTransientRequestFailure(error)) {
        await delay(retryDelayMs);
        continue;
      }
      throw error;
    }
  }
  throw new ApiError("API request failed without receiving a response.", 0);
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function isTransientRequestFailure(error: unknown): boolean {
  // Network failures reject with TypeError; the per-attempt timeout rejects with a TimeoutError DOMException.
  return error instanceof TypeError || error instanceof DOMException;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readApiErrorMessage(response: Response) {
  try {
    const body = (await response.json()) as { message?: unknown };
    if (typeof body.message === "string" && body.message.trim()) {
      return body.message;
    }
  } catch {
    // Keep API errors safe even when the response body is empty or not JSON.
  }
  return `API request failed with status ${response.status}.`;
}
