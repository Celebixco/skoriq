import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchDashboardOverview,
  fetchFootballAnalyticsMatch,
  fetchFootballAnalyticsMatches,
  fetchCurrentUser,
  fetchFootballCompetition,
  fetchFootballCompetitions,
  fetchFootballMemberPredictionPreview,
  fetchFootballMatchPredictionDrafts,
  fetchFootballMatchPublicEligibility,
  fetchFootballMatchPredictionSettlements,
  fetchFootballPredictionDraft,
  fetchFootballPredictionDrafts,
  fetchFootballPredictionSettlement,
  fetchFootballPredictionSettlements,
  fetchFootballPublicEligibility,
  fetchFootballTeam,
  fetchFootballTeams,
  login,
  register,
  logout
} from "./api";

const fetchMock = vi.fn();
globalThis.fetch = fetchMock;

describe("football analytics dashboard API client", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("fetches match list with filters", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ items: [], pagination: { limit: 20, offset: 0, total: 0 } }));

    await fetchFootballAnalyticsMatches({
      featureStatus: "ready",
      predictionEligible: true,
      kuponEligible: false,
      limit: 20
    });

    const requestedUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(requestedUrl).toContain("/analytics/football/matches?");
    expect(requestedUrl).toContain("featureStatus=ready");
    expect(requestedUrl).toContain("predictionEligible=true");
    expect(requestedUrl).toContain("kuponEligible=false");
    expect(requestedUrl).toContain("limit=20");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ credentials: "include" });
  });

  it("fetches dashboard overview with credentials", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ user: { email: "member@example.test", role: "member" }, overview: {}, upcomingMatches: [] }));

    await fetchDashboardOverview();

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/dashboard/overview");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ credentials: "include" });
  });

  it("logs in, checks current user, and logs out with credentials", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ user: { id: "user-1", email: "admin@example.test", role: "admin", status: "active" } }));

    await login("admin@example.test", "password-123");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/auth/login");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      credentials: "include"
    });
    expect(String(fetchMock.mock.calls[0]?.[1]?.body)).not.toContain("password_hash");

    await fetchCurrentUser();
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/auth/me");

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    await logout();
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain("/auth/logout");
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({ method: "POST", credentials: "include" });
  });

  it("registers with credentials and never sends role fields", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ user: { id: "user-2", email: "member@example.test", role: "member", status: "active" } }));

    await register({
      email: "member@example.test",
      firstName: "Ada",
      lastName: "Yılmaz",
      phoneNumber: "+905551112233",
      password: "StrongPass123",
      confirmPassword: "StrongPass123",
      mathLeft: 4,
      mathOperator: "+",
      mathRight: 5,
      mathAnswer: 9
    });

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/auth/register");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      credentials: "include"
    });
    const body = String(fetchMock.mock.calls[0]?.[1]?.body);
    expect(body).toContain("member@example.test");
    expect(body).toContain("Ada");
    expect(body).toContain("+905551112233");
    expect(body).toContain("mathAnswer");
    expect(body).not.toContain("password_hash");
    expect(body).not.toContain("admin");
    expect(body).not.toContain("role");
  });

  it("fetches one match by id", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ match: { matchId: "match-1" } }));

    await fetchFootballAnalyticsMatch("match-1");

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/analytics/football/matches/match-1");
  });

  it("fetches football teams with catalog filters", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ items: [], pagination: { limit: 50, offset: 0, total: 0 } }));

    await fetchFootballTeams({
      competitionId: "competition-1",
      search: "Dortmund",
      limit: 50,
      offset: 10
    });

    const requestedUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(requestedUrl).toContain("/football/teams?");
    expect(requestedUrl).toContain("competitionId=competition-1");
    expect(requestedUrl).toContain("search=Dortmund");
    expect(requestedUrl).toContain("limit=50");
    expect(requestedUrl).toContain("offset=10");
  });

  it("fetches one football team by id", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ teamId: "team-1" }));

    await fetchFootballTeam("team-1");

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/football/teams/team-1");
  });

  it("fetches football competitions", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ items: [], pagination: { limit: 50, offset: 0, total: 0 } }));

    await fetchFootballCompetitions({ limit: 25, offset: 5 });

    const requestedUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(requestedUrl).toContain("/football/competitions?");
    expect(requestedUrl).toContain("limit=25");
    expect(requestedUrl).toContain("offset=5");
  });

  it("fetches one football competition by id", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ competitionId: "competition-1" }));

    await fetchFootballCompetition("competition-1");

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/football/competitions/competition-1");
  });

  it("fetches draft prediction review endpoints with credentials", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ items: [], pagination: { limit: 20, offset: 0, total: 0 } }));

    await fetchFootballPredictionDrafts({
      matchId: "match-1",
      consistencyStatus: "warning",
      recommendationTier: "primary",
      limit: 20,
      offset: 5
    });

    let requestedUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(requestedUrl).toContain("/football/predictions/drafts?");
    expect(requestedUrl).toContain("matchId=match-1");
    expect(requestedUrl).toContain("consistencyStatus=warning");
    expect(requestedUrl).toContain("recommendationTier=primary");
    expect(requestedUrl).toContain("offset=5");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ credentials: "include" });

    fetchMock.mockResolvedValueOnce(jsonResponse({ predictionId: "prediction-1" }));
    await fetchFootballPredictionDraft("prediction-1");
    requestedUrl = String(fetchMock.mock.calls[1]?.[0]);
    expect(requestedUrl).toContain("/football/predictions/drafts/prediction-1");

    fetchMock.mockResolvedValueOnce(jsonResponse({ memberVisible: false }));
    await fetchFootballMatchPredictionDrafts("match-1");
    requestedUrl = String(fetchMock.mock.calls[2]?.[0]);
    expect(requestedUrl).toContain("/football/matches/match-1/prediction-drafts");
  });

  it("fetches member-safe prediction preview endpoint with credentials", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status: "available", groups: { primary: [], try: [], alternative: [] } }));

    await fetchFootballMemberPredictionPreview("match-1");

    const requestedUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(requestedUrl).toContain("/member/football/matches/match-1/prediction-preview");
    expect(requestedUrl).not.toContain("/prediction-drafts");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ credentials: "include" });
  });

  it("fetches settlement review endpoints with credentials", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ items: [], pagination: { limit: 20, offset: 0, total: 0 } }));

    await fetchFootballPredictionSettlements({
      matchId: "match-1",
      predictionId: "prediction-1",
      settlementStatus: "settled_success",
      consistencyStatus: "warning",
      recommendationTier: "primary",
      auditOnly: true,
      limit: 20,
      offset: 5
    });

    let requestedUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(requestedUrl).toContain("/football/predictions/settlements?");
    expect(requestedUrl).toContain("matchId=match-1");
    expect(requestedUrl).toContain("predictionId=prediction-1");
    expect(requestedUrl).toContain("settlementStatus=settled_success");
    expect(requestedUrl).toContain("consistencyStatus=warning");
    expect(requestedUrl).toContain("recommendationTier=primary");
    expect(requestedUrl).toContain("auditOnly=true");
    expect(requestedUrl).toContain("offset=5");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ credentials: "include" });

    fetchMock.mockResolvedValueOnce(jsonResponse({ settlementId: "settlement-1" }));
    await fetchFootballPredictionSettlement("settlement-1");
    requestedUrl = String(fetchMock.mock.calls[1]?.[0]);
    expect(requestedUrl).toContain("/football/predictions/settlements/settlement-1");

    fetchMock.mockResolvedValueOnce(jsonResponse({ settlementSummary: { success: 1 } }));
    await fetchFootballMatchPredictionSettlements("match-1");
    requestedUrl = String(fetchMock.mock.calls[2]?.[0]);
    expect(requestedUrl).toContain("/football/matches/match-1/prediction-settlements");
  });

  it("fetches public eligibility review endpoints with credentials", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ eligible: [], excluded: [], summary: {}, publicSafetyNotes: [] }));

    await fetchFootballPublicEligibility({
      matchId: "match-1",
      predictionId: "prediction-1",
      settlementStatus: "settled_success",
      consistencyStatus: "warning",
      recommendationTier: "primary",
      limit: 20,
      offset: 5
    });

    let requestedUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(requestedUrl).toContain("/football/public-eligibility/evaluate?");
    expect(requestedUrl).toContain("matchId=match-1");
    expect(requestedUrl).toContain("predictionId=prediction-1");
    expect(requestedUrl).toContain("settlementStatus=settled_success");
    expect(requestedUrl).toContain("consistencyStatus=warning");
    expect(requestedUrl).toContain("recommendationTier=primary");
    expect(requestedUrl).toContain("offset=5");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ credentials: "include" });

    fetchMock.mockResolvedValueOnce(jsonResponse({ match: { matchId: "match-1" }, eligible: [], excluded: [] }));
    await fetchFootballMatchPublicEligibility("match-1");
    requestedUrl = String(fetchMock.mock.calls[1]?.[0]);
    expect(requestedUrl).toContain("/football/matches/match-1/public-eligibility");
  });

  it("throws a readable API error for failed requests", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: vi.fn() });

    await expect(fetchFootballAnalyticsMatch("missing")).rejects.toThrow("API request failed with status 404.");
  });
});

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue(body)
  };
}
