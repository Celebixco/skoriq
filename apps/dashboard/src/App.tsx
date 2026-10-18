import { useEffect, useMemo, useState } from "react";
import type { DependencyList, KeyboardEvent, ReactNode } from "react";
import {
  fetchDashboardOverview,
  fetchFootballAnalyticsMatch,
  fetchFootballAnalyticsMatches,
  fetchFootballCompetitions,
  fetchFootballCountries,
  fetchFootballCountryCompetitions,
  fetchFootballCompetitionProfile,
  fetchFootballMatchLineups,
  fetchFootballMatchStatistics,
  fetchFootballMatchPlayerAvailability,
  fetchFootballMemberPredictionPreview,
  fetchFootballPlayerProfile,
  fetchFootballMatchPredictionDrafts,
  fetchFootballMatchPublicEligibility,
  fetchFootballMatchPredictionSettlements,
  fetchFootballPredictionDraft,
  fetchFootballPredictionDrafts,
  fetchFootballPredictionSettlement,
  fetchFootballPredictionResults,
  fetchFootballPredictionResultsSummary,
  fetchFootballPredictionSettlements,
  fetchFootballPublicEligibility,
  fetchFootballTeamAvailability,
  fetchFootballTeamPlayers,
  fetchFootballTeamProfile,
  fetchFootballTeams,
  fetchCurrentUser,
  logout as logoutRequest
} from "./api";
import { CompetitionLogo, MetricCard, ProgressBar, StatusBadge, TeamLogo } from "./components";
import { formatDate, formatDateTime, formatDecimal, formatPercent, formatRatePercent, matchStatusLabel, statusLabel } from "./format";
import type {
  FeatureStatus,
  AuthUser,
  DashboardOverviewResponse,
  FootballAnalyticsMatchReport,
  FootballAnalyticsMatchFilters,
  FootballAnalyticsMatchListResponse,
  FootballMatchPredictionDraftsResponse,
  FootballMatchLineupsResponse,
  FootballMatchStatisticsResponse,
  FootballMemberPredictionPreviewResponse,
  FootballMatchPredictionSettlementsResponse,
  FootballPredictionDraftDetail,
  FootballPredictionDraftFilters,
  FootballPredictionDraftListItem,
  FootballPredictionDraftsListResponse,
  FootballPublicEligibilityFilters,
  FootballPublicEligibilityItem,
  FootballPublicEligibilityResponse,
  FootballMatchPublicEligibilityResponse,
  FootballPredictionSettlementDetail,
  FootballPredictionSettlementFilters,
  FootballPredictionResultItem,
  FootballPredictionResultsFilters,
  FootballPredictionSettlementListItem,
  FootballPredictionSettlementsListResponse,
  FootballTeamListItem,
  FootballTeamPlayersResponse,
  FootballTeamProfileResponse,
  FootballTeamProfileFormSummary,
  FootballTeamProfileRecentMatch,
  FootballTeamProfileUpcomingMatch,
  RecommendationTier
} from "./types";
import "./styles.css";
import { LandingPage } from "./landing/LandingPage";
import { AppShell } from "./app/AppShell";
import "./app/app.css";
import { LoginPage, RegisterPage, ForgotPasswordPage, ResetPasswordPage } from "./arena/AuthPages";
import { ArenaHome } from "./arena/ArenaHome";
import { SkorIQMark } from "./arena/SkorIQMark";
import "./arena/theme.css";
import { FilterDisclosure, SectionTabs } from "./arena/SectionTabs";
import { clearWorkspaceChoices, useWorkspaceState } from "./arena/useWorkspaceState";
import "./arena/workspace.css";
import "./arena/match-center.css";
import "./arena/explorer.css";
import "./arena/results.css";

export { LandingPage };

const initialFilters: FootballAnalyticsMatchFilters = {
  featureStatus: "",
  predictionEligible: "",
  kuponEligible: "",
  status: "upcoming",
  limit: 20,
  offset: 0
};

const EXCLUDED_ANALYTICS_STATUSES = ["finished", "after_extra_time", "after_penalties", "abandoned", "cancelled"] as const;

export const analyticsExpandedPageSize = 200;
const withinWindowHours = 36;

export function isWithinNextHours(kickoffAt: string, now = new Date(), hours = withinWindowHours) {
  const kickoffTime = Date.parse(kickoffAt);
  const nowTime = now.getTime();
  if (!Number.isFinite(kickoffTime)) return false;
  return kickoffTime >= nowTime && kickoffTime <= nowTime + hours * 60 * 60 * 1000;
}

export function expandAnalyticsFiltersForQuickChip(filters: FootballAnalyticsMatchFilters, chip: QuickChipId): FootballAnalyticsMatchFilters {
  if (chip !== "within24h") return filters;
  return {
    ...filters,
    analysisWindowStatus: "within_window",
    limit: Math.max(filters.limit ?? 20, analyticsExpandedPageSize),
    offset: 0
  };
}

export function filterFootballAnalyticsItems(
  items: FootballAnalyticsMatchListResponse["items"],
  frontendFilters: FrontendFilters,
  searchQuery: string,
  now = new Date()
) {
  // Defense-in-depth: the API defaults this page to upcoming matches, but the
  // UI still refuses finished/result statuses if stale cached data arrives.
  // Some provider sync paths can briefly leave a match as scheduled even after
  // kickoff, so we also drop already-started rows on the client.
  let filtered = items.filter(item => {
    if (EXCLUDED_ANALYTICS_STATUSES.includes(item.match.status as typeof EXCLUDED_ANALYTICS_STATUSES[number])) {
      return false;
    }

    const kickoffTime = Date.parse(item.match.kickoffAt);
    if (Number.isFinite(kickoffTime) && kickoffTime <= now.getTime()) {
      return false;
    }

    return true;
  });

  if (searchQuery.trim()) {
    const query = searchQuery.toLowerCase().trim();
    filtered = filtered.filter(item => {
      const home = item.match.homeTeam.name.toLowerCase();
      const away = item.match.awayTeam.name.toLowerCase();
      const competition = item.match.competition.name.toLowerCase();
      const country = item.match.competition.country?.toLowerCase() ?? "";
      return home.includes(query) || away.includes(query) || competition.includes(query) || country.includes(query);
    });
  }

  if (frontendFilters.competitionName) {
    filtered = filtered.filter(item => item.match.competition.name === frontendFilters.competitionName);
  }

  if (frontendFilters.countryName) {
    filtered = filtered.filter(item => item.match.competition.country === frontendFilters.countryName);
  }

  if (frontendFilters.within24h) {
    filtered = filtered.filter(item => isWithinNextHours(item.match.kickoffAt, now));
  }

  if (frontendFilters.hasH2h) {
    filtered = filtered.filter(item => !item.h2h.h2hMissing);
  }

  if (frontendFilters.hasPrediction) {
    filtered = filtered.filter(item => item.hasPredictionPreview);
  }

  return filtered;
}

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
}

export interface FrontendFilters {
  searchQuery: string;
  competitionName: string;
  countryName: string;
  within24h: boolean;
  hasH2h: boolean;
  hasPrediction: boolean;
}

const emptyFrontendFilters: FrontendFilters = {
  searchQuery: "",
  competitionName: "",
  countryName: "",
  within24h: false,
  hasH2h: false,
  hasPrediction: false
};

export type QuickChipId = "all" | "ready" | "predictionEligible" | "within24h" | "hasH2h" | "hasPrediction";

export function SearchBar({ query, onChange, onClear }: {
  query: string;
  onChange: (value: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="analytics-search-bar">
      <svg className="analytics-search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3" />
      </svg>
      <input
        type="text"
        value={query}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
        placeholder="Takım veya lig ara…"
        aria-label="Takım veya lig ara"
      />
      {query ? (
        <button type="button" className="analytics-search-clear" onClick={onClear} aria-label="Aramayı temizle">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6 6 18" /><path d="m6 6 12 12" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}

export function QuickFilterChips({ activeChip, onChipClick, counts }: {
  activeChip: QuickChipId | null;
  onChipClick: (chip: QuickChipId) => void;
  counts: { ready: number; predictionEligible: number; within24h: number; hasH2h: number; hasPrediction: number };
}) {
  const chips: { id: QuickChipId; label: string; count?: number; hint?: string }[] = [
    { id: "all", label: "Hepsi", hint: "Tüm yaklaşan maçlar" },
    { id: "ready", label: "Analizi Hazır", count: counts.ready, hint: "İncelemesi tamamlanmış maçlar" },
    { id: "predictionEligible", label: "Tahmine Uygun", count: counts.predictionEligible, hint: "SkorIQ bu maç için tahmin üretebiliyor" },
    { id: "within24h", label: "Çok Yakında", count: counts.within24h, hint: "Başlamasına 36 saatten az kalan maçlar" },
    { id: "hasH2h", label: "İkili Rekabet", count: counts.hasH2h, hint: "İki takım daha önce karşılaşmış" },
    { id: "hasPrediction", label: "Tahmin Hazır", count: counts.hasPrediction, hint: "SkorIQ bu maç için tahminini yayınladı" },
  ];

  return (
    <div className="analytics-quick-chips" role="group" aria-label="Hızlı filtreler">
      {chips.map((chip) => (
        <button
          key={chip.id}
          type="button"
          className={`analytics-chip${activeChip === chip.id ? " analytics-chip-active" : ""}`}
          onClick={() => onChipClick(chip.id)}
          aria-pressed={activeChip === chip.id}
          title={chip.hint}
        >
          {chip.label}
          {chip.count !== undefined ? <span className="analytics-chip-count">{chip.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function ActiveFilterPills({ filters, frontendFilters, quickChip, onClearFilter, onClearAll }: {
  filters: FootballAnalyticsMatchFilters;
  frontendFilters: FrontendFilters;
  quickChip: QuickChipId | null;
  onClearFilter: (key: string) => void;
  onClearAll: () => void;
}) {
  const pills: { key: string; label: string }[] = [];

  if (filters.featureStatus) {
    const labels: Record<string, string> = { ready: "Hazır", partial: "Biraz Eksik", insufficient_data: "Veri Yetersiz" };
    pills.push({ key: "featureStatus", label: `Durum: ${labels[filters.featureStatus] ?? filters.featureStatus}` });
  }
  if (filters.predictionEligible !== "" && filters.predictionEligible !== undefined) {
    pills.push({ key: "predictionEligible", label: `Tahmin: ${filters.predictionEligible ? "Var" : "Yok"}` });
  }
  if (filters.kuponEligible !== "" && filters.kuponEligible !== undefined) {
    pills.push({ key: "kuponEligible", label: `Sonuç takibi: ${filters.kuponEligible ? "Açık" : "Kapalı"}` });
  }
  if (frontendFilters.searchQuery.trim()) {
    pills.push({ key: "searchQuery", label: `Arama: ${frontendFilters.searchQuery.trim()}` });
  }
  if (frontendFilters.competitionName) {
    pills.push({ key: "competitionName", label: `Lig: ${frontendFilters.competitionName}` });
  }
  if (frontendFilters.countryName) {
    pills.push({ key: "countryName", label: `Ülke: ${frontendFilters.countryName}` });
  }
  if (frontendFilters.within24h || quickChip === "within24h") {
    pills.push({ key: "within24h", label: "Çok Yakında" });
  }
  if (frontendFilters.hasH2h || quickChip === "hasH2h") {
    pills.push({ key: "hasH2h", label: "Geçmiş Maçlar" });
  }
  if (frontendFilters.hasPrediction || quickChip === "hasPrediction") {
    pills.push({ key: "hasPrediction", label: "Tahmin Hazır" });
  }

  if (pills.length === 0) return null;

  return (
    <div className="analytics-active-filters">
      {pills.map((pill) => (
        <span key={pill.key} className="analytics-filter-pill">
          {pill.label}
          <button type="button" onClick={() => onClearFilter(pill.key)} aria-label={`${pill.label} filtresini kaldır`}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18" /><path d="m6 6 12 12" />
            </svg>
          </button>
        </span>
      ))}
      <button type="button" className="analytics-clear-all-btn" onClick={onClearAll}>
        Tümünü temizle
      </button>
    </div>
  );
}

export function ResultSummaryBar({ showing, total, loaded, limit, offset, frontendFiltered, hasPrev, hasNext, onPrev, onNext }: {
  showing: number;
  total: number;
  loaded: number;
  limit: number;
  offset: number;
  frontendFiltered?: boolean;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  const start = total > 0 ? offset + 1 : 0;
  const end = Math.min(offset + loaded, total);
  const pageSize = Math.max(1, limit);
  const page = Math.floor(offset / pageSize) + 1;

  return (
    <div className="analytics-results-bar">
      <p className="analytics-results-count">
        {frontendFiltered
          ? `Gösterilen: ${showing.toLocaleString("tr-TR")} maç`
          : total > 0
          ? `Sayfa ${page.toLocaleString("tr-TR")} · Gösterilen: ${start.toLocaleString("tr-TR")}–${end.toLocaleString("tr-TR")} · Toplam: ${total.toLocaleString("tr-TR")} maç`
          : `Sayfa ${page.toLocaleString("tr-TR")} · Gösterilen: ${showing.toLocaleString("tr-TR")} · Toplam: ${total.toLocaleString("tr-TR")} maç`}
      </p>
      <div className="analytics-pagination">
        <button
          type="button"
          className="analytics-page-btn"
          onClick={onPrev}
          disabled={!hasPrev}
          aria-label="Önceki sayfa"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6" />
          </svg>
          Önceki
        </button>
        <button
          type="button"
          className="analytics-page-btn"
          onClick={onNext}
          disabled={!hasNext}
          aria-label="Sonraki sayfa"
        >
          Sonraki
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m9 18 6-6-6-6" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export function EmptySearchState({ hasFilters, apiHasData, onClear, navigate }: {
  hasFilters: boolean;
  apiHasData: boolean;
  onClear: () => void;
  navigate: (path: string) => void;
}) {
  const title = apiHasData ? "Eşleşen maç bulunamadı." : "Şu an yaklaşan maç yok.";
  const body = apiHasData
    ? "Başka bir takım ya da lig adı denemeyi istersin belki."
    : "Merak etme: oynanmış maçların ve tahminlerin sonuçlarına bakabilirsin.";

  return (
    <div className="analytics-empty-state">
      <p className="analytics-empty-title">{title}</p>
      <p className="analytics-empty-body">{body}</p>
      {hasFilters ? (
        <button type="button" className="analytics-empty-btn" onClick={onClear}>
          Filtreleri temizle
        </button>
      ) : null}
      {!apiHasData ? (
        <button
          type="button"
          className="analytics-empty-btn"
          onClick={() => navigate("/football/prediction-results")}
        >
          Sonuçlara Bak →
        </button>
      ) : null}
    </div>
  );
}

type TeamDirectoryFilter = "all" | "logos" | "matches" | "highCoverage";

export function App() {
  const [path, setPath] = useState(window.location.pathname);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [routeLoading, setRouteLoading] = useState(false);

  useEffect(() => {
    const onPopState = () => {
      setRouteLoading(true);
      setPath(window.location.pathname);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = (nextPath: string) => {
    if (nextPath === window.location.pathname) return;
    setRouteLoading(true);
    window.history.pushState({}, "", nextPath);
    setPath(nextPath);
  };

  const route = resolveRoute(path);
  const isAuthRoute = route.kind === "login" || route.kind === "register" || route.kind === "forgot-password" || route.kind === "reset-password";
  const isPublicRoute = route.kind === "landing";

  useEffect(() => {
    let cancelled = false;
    fetchCurrentUser()
      .then((response) => {
        if (!cancelled) setCurrentUser(response.user);
      })
      .catch(() => {
        if (!cancelled) setCurrentUser(null);
      })
      .finally(() => {
        if (!cancelled) setAuthLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!routeLoading) return;
    const timeout = window.setTimeout(() => setRouteLoading(false), 520);
    return () => window.clearTimeout(timeout);
  }, [path, routeLoading]);

  useEffect(() => {
    if (!authLoading && !currentUser && !isAuthRoute && !isPublicRoute) {
      navigate("/login");
    }
    if (!authLoading && currentUser && isAuthRoute) {
      navigate("/football/analytics");
    }
  }, [authLoading, currentUser, isAuthRoute, isPublicRoute, navigate]);

  const handleLogout = async () => {
    await logoutRequest();
    clearWorkspaceChoices();
    setCurrentUser(null);
    navigate("/login");
  };

  if (authLoading) {
    return (
      <main className="arena-session-loading">
        <StatePanel title="Üyelik kontrol ediliyor..." />
      </main>
    );
  }

  if (route.kind === "register" && !currentUser) {
    return <RegisterPage onRegister={(user) => setCurrentUser(user)} navigate={navigate} />;
  }

  if (route.kind === "forgot-password" && !currentUser) {
    return <ForgotPasswordPage navigate={navigate} />;
  }

  if (route.kind === "reset-password" && !currentUser) {
    return <ResetPasswordPage navigate={navigate} />;
  }

  if (!currentUser && route.kind === "landing") {
    return <LandingPage navigate={navigate} />;
  }

  if (route.kind === "login" || !currentUser) {
    return <LoginPage onLogin={(user) => setCurrentUser(user)} navigate={navigate} />;
  }

  const forbidden = isAdminOnlyRoute(route) && currentUser.role !== "admin";

  return (
    <AppShell currentPath={path} navigate={navigate} user={currentUser} onLogout={handleLogout} routeLoading={routeLoading}>
      {forbidden ? <ForbiddenPage navigate={navigate} /> : null}
      {!forbidden && (
        <>
      {shouldRenderOverviewPage(route.kind) ? <OverviewPage navigate={navigate} user={currentUser} /> : null}
      {route.kind === "match-list" ? <MatchListPage navigate={navigate} /> : null}
      {route.kind === "match-detail" ? <MatchDetailPage key={route.id} matchId={route.id} navigate={navigate} user={currentUser} /> : null}
      {route.kind === "team-list" ? <TeamListPage navigate={navigate} /> : null}
      {route.kind === "team-detail" ? <TeamDetailPage key={route.id} teamId={route.id} navigate={navigate} /> : null}
      {route.kind === "player-detail" ? <PlayerDetailPage key={route.id} playerId={route.id} navigate={navigate} /> : null}
      {route.kind === "competition-list" ? <CompetitionListPage navigate={navigate} /> : null}
      {route.kind === "competition-detail" ? <CompetitionDetailPage key={route.id} competitionId={route.id} navigate={navigate} /> : null}
      {route.kind === "country-list" ? <CountryListPage navigate={navigate} /> : null}
      {route.kind === "country-detail" ? <CountryDetailPage key={route.id} countryId={route.id} navigate={navigate} /> : null}
      {route.kind === "draft-list" ? <DraftPredictionListPage navigate={navigate} /> : null}
      {route.kind === "draft-detail" ? <DraftPredictionDetailPage predictionId={route.id} navigate={navigate} /> : null}
      {route.kind === "match-drafts" ? <MatchPredictionDraftsPage matchId={route.id} navigate={navigate} /> : null}
      {route.kind === "prediction-results" ? <PredictionResultsPage navigate={navigate} /> : null}
      {route.kind === "settlement-list" ? <SettlementListPage navigate={navigate} /> : null}
      {route.kind === "settlement-detail" ? <SettlementDetailPage settlementId={route.id} navigate={navigate} /> : null}
      {route.kind === "match-settlements" ? <MatchSettlementsPage matchId={route.id} navigate={navigate} /> : null}
      {route.kind === "public-eligibility-list" ? <PublicEligibilityListPage navigate={navigate} /> : null}
      {route.kind === "match-public-eligibility" ? <MatchPublicEligibilityPage matchId={route.id} navigate={navigate} /> : null}
        </>
      )}
    </AppShell>
  );
}

export function shouldRenderOverviewPage(routeKind: ReturnType<typeof resolveRoute>["kind"]) {
  return routeKind === "overview" || routeKind === "landing";
}

function OverviewPage({ navigate, user }: { navigate: (path: string) => void; user: AuthUser }) {
  const overview = useLoad(() => fetchDashboardOverview(), []);

  return (
    <OverviewDashboardView
      user={user}
      overview={overview}
      navigate={navigate}
    />
  );
}

type LoadState<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
};

export function OverviewDashboardView({ user, overview, navigate }: {
  user: AuthUser;
  overview: LoadState<DashboardOverviewResponse>;
  navigate: (path: string) => void;
}) {
  return <>
    <ArenaHome overview={overview} navigate={navigate} authenticated />
    {user.role === "admin" && overview.data?.admin ? <details className="arena-admin-overview"><summary>İç Denetim Özeti</summary><div><p>Draft Tahminler: {overview.data.admin.draftPredictionCount}</p><p>Tahmin Sonuçları: {overview.data.admin.settlementCount}</p><p>Public Uygunluk: {overview.data.admin.publicEligibilityEligibleCount ?? "—"}</p></div></details> : null}
  </>;
}

function ForbiddenPage({ navigate }: { navigate: (path: string) => void }) {
  return (
    <section className="forbidden-panel">
      <p className="eyebrow">Erişim sınırı</p>
      <h1>Bu alan yalnızca admin kullanıcılar içindir.</h1>
      <p>Maç analizlerini görüntülemeye devam edebilirsin.</p>
      <button type="button" onClick={() => navigate("/football/analytics")}>
        Maç analizlerine dön
      </button>
    </section>
  );
}

export function MatchListPage({ navigate }: { navigate: (path: string) => void }) {
  const [filters, setFilters] = useWorkspaceState<FootballAnalyticsMatchFilters>("matches.filters", {
    ...initialFilters,
    offset: 0
  });
  const [frontendFilters, setFrontendFilters] = useWorkspaceState<FrontendFilters>("matches.search", emptyFrontendFilters);
  const [quickChip, setQuickChip] = useWorkspaceState<QuickChipId | null>("matches.quick", null);

  const debouncedSearch = useDebounce(frontendFilters.searchQuery, 300);

  const { data, loading, error } = useLoad(
    () => fetchFootballAnalyticsMatches({ ...filters, status: "upcoming", search: debouncedSearch }),
    [filters, debouncedSearch]
  );

  const visibleBaseItems = useMemo(() => {
    if (!data) return [];
    return filterFootballAnalyticsItems(data.items, emptyFrontendFilters, "");
  }, [data]);

  const availableCompetitions = useMemo(() => {
    if (!visibleBaseItems.length) return [];
    const names = new Set<string>();
    visibleBaseItems.forEach(item => names.add(item.match.competition.name));
    return Array.from(names).sort();
  }, [visibleBaseItems]);

  const availableCountries = useMemo(() => {
    if (!visibleBaseItems.length) return [];
    const names = new Set<string>();
    visibleBaseItems.forEach(item => {
      if (item.match.competition.country) {
        names.add(item.match.competition.country);
      }
    });
    return Array.from(names).sort();
  }, [visibleBaseItems]);

  const filteredItems = useMemo(() => {
    if (!data) return [];
    return filterFootballAnalyticsItems(data.items, frontendFilters, debouncedSearch);
  }, [data, debouncedSearch, frontendFilters]);

  const matchStats = useMemo(() => {
    return filteredItems.length > 0 ? getMatchAnalyticsStats(filteredItems) : null;
  }, [filteredItems]);

  const quickChipCounts = useMemo(() => {
    if (!visibleBaseItems.length) return { ready: 0, predictionEligible: 0, within24h: 0, hasH2h: 0, hasPrediction: 0 };
    const now = new Date();

    return {
      ready: visibleBaseItems.filter(item => item.featureStatus === "ready").length,
      predictionEligible: visibleBaseItems.filter(item => item.predictionEligible).length,
      within24h: visibleBaseItems.filter(item => isWithinNextHours(item.match.kickoffAt, now)).length,
      hasH2h: visibleBaseItems.filter(item => !item.h2h.h2hMissing).length,
      hasPrediction: visibleBaseItems.filter(item => item.hasPredictionPreview).length
    };
  }, [visibleBaseItems]);

  useEffect(() => {
    if (quickChip === "ready" && filters.featureStatus !== "ready") {
      setQuickChip(null);
    }
    if (quickChip === "predictionEligible" && filters.predictionEligible !== true) {
      setQuickChip(null);
    }
    if (quickChip === "within24h" && !frontendFilters.within24h) {
      setQuickChip(null);
    }
    if (quickChip === "hasH2h" && !frontendFilters.hasH2h) {
      setQuickChip(null);
    }
    if (quickChip === "hasPrediction" && !frontendFilters.hasPrediction) {
      setQuickChip(null);
    }
  }, [filters, frontendFilters, quickChip]);

  const totalLoaded = visibleBaseItems.length;
  const totalFromApi = data?.pagination.total ?? 0;
  const effectiveTotal = totalLoaded === 0 ? 0 : totalFromApi;
  const offset = filters.offset ?? 0;
  const hasNextPage = offset + totalLoaded < effectiveTotal;
  const hasPrevPage = offset > 0;

  const handlePrevPage = () => {
    setFilters(prev => ({ ...prev, offset: Math.max(0, (prev.offset ?? 0) - (prev.limit ?? 20)) }));
  };

  const handleNextPage = () => {
    setFilters(prev => ({ ...prev, offset: (prev.offset ?? 0) + (prev.limit ?? 20) }));
  };

  const handleClearAll = () => {
    setFilters({ ...initialFilters, offset: 0 });
    setFrontendFilters(emptyFrontendFilters);
    setQuickChip(null);
  };

  const handleClearFilter = (key: string) => {
    switch (key) {
      case "featureStatus":
        setFilters(prev => ({ ...prev, featureStatus: "" }));
        break;
      case "predictionEligible":
        setFilters(prev => ({ ...prev, predictionEligible: "" }));
        break;
      case "kuponEligible":
        setFilters(prev => ({ ...prev, kuponEligible: "" }));
        break;
      case "searchQuery":
        setFilters(prev => ({ ...prev, offset: 0 }));
        setFrontendFilters(prev => ({ ...prev, searchQuery: "" }));
        break;
      case "competitionName":
        setFrontendFilters(prev => ({ ...prev, competitionName: "" }));
        break;
      case "countryName":
        setFrontendFilters(prev => ({ ...prev, countryName: "" }));
        break;
      case "within24h":
        setFilters(prev => ({ ...prev, analysisWindowStatus: undefined, limit: initialFilters.limit, offset: 0 }));
        setFrontendFilters(prev => ({ ...prev, within24h: false }));
        setQuickChip(prev => prev === "within24h" ? null : prev);
        break;
      case "hasH2h":
        setFilters(prev => ({ ...prev, hasH2h: "" }));
        setFrontendFilters(prev => ({ ...prev, hasH2h: false }));
        setQuickChip(prev => prev === "hasH2h" ? null : prev);
        break;
      case "hasPrediction":
        setFilters(prev => ({ ...prev, hasPrediction: "" }));
        setFrontendFilters(prev => ({ ...prev, hasPrediction: false }));
        setQuickChip(prev => prev === "hasPrediction" ? null : prev);
        break;
    }
  };

  const handleChipClick = (chip: QuickChipId) => {
    if (chip === "all") {
      handleClearAll();
      return;
    }
    if (quickChip === chip) {
      setQuickChip(null);
      if (chip === "ready") setFilters(prev => ({ ...prev, featureStatus: "" }));
      if (chip === "predictionEligible") setFilters(prev => ({ ...prev, predictionEligible: "" }));
      if (chip === "within24h") {
        setFilters(prev => ({ ...prev, analysisWindowStatus: undefined, limit: initialFilters.limit, offset: 0 }));
        setFrontendFilters(prev => ({ ...prev, within24h: false }));
      }
      if (chip === "hasH2h") {
        setFilters(prev => ({ ...prev, hasH2h: "" }));
        setFrontendFilters(prev => ({ ...prev, hasH2h: false }));
      }
      if (chip === "hasPrediction") {
        setFilters(prev => ({ ...prev, hasPrediction: "" }));
        setFrontendFilters(prev => ({ ...prev, hasPrediction: false }));
      }
    } else {
      setQuickChip(chip);
      if (chip === "ready") setFilters(prev => ({ ...prev, featureStatus: "ready" }));
      if (chip === "predictionEligible") setFilters(prev => ({ ...prev, predictionEligible: true }));
      if (chip === "within24h") {
        setFilters(prev => expandAnalyticsFiltersForQuickChip(prev, chip));
        setFrontendFilters(prev => ({ ...prev, within24h: true }));
      }
      if (chip === "hasH2h") {
        setFilters(prev => ({ ...prev, hasH2h: true, offset: 0 }));
        setFrontendFilters(prev => ({ ...prev, hasH2h: true }));
      }
      if (chip === "hasPrediction") {
        setFilters(prev => ({ ...prev, hasPrediction: true, offset: 0 }));
        setFrontendFilters(prev => ({ ...prev, hasPrediction: true }));
      }
    }
  };

  const hasActiveFilters = Boolean(
    filters.featureStatus ||
    filters.predictionEligible !== "" ||
    filters.kuponEligible !== "" ||
    filters.analysisWindowStatus ||
    (filters.hasH2h !== undefined && filters.hasH2h !== "") ||
    (filters.hasPrediction !== undefined && filters.hasPrediction !== "") ||
    frontendFilters.searchQuery.trim() ||
    frontendFilters.competitionName ||
    frontendFilters.countryName ||
    frontendFilters.within24h ||
    frontendFilters.hasH2h ||
    frontendFilters.hasPrediction ||
    quickChip !== null
  );

  const hasFrontendFilters = Boolean(
    frontendFilters.competitionName ||
    frontendFilters.countryName
  );

  return (
    <>
      <header className="hero analytics-header">
        <div>
          <h1>Yaklaşan Maçlar</h1>
          <p>Bir maça dokun; SkorIQ o maç için ne bulduğunu sade bir dille anlatsın.</p>
        </div>
        {matchStats ? (
          <div className="analytics-summary-grid" aria-label="Maç analizi özet metrikleri">
            <AnalyticsSummaryStat label="Analizi Hazır" value={matchStats.ready} hint="İncelemesi tamamlanmış maçlar." />
            <AnalyticsSummaryStat label="Biraz Eksik" value={matchStats.partial} hint="Bazı bilgiler eksik ama analiz yapılabiliyor." />
            <AnalyticsSummaryStat label="Veri Yetersiz" value={matchStats.insufficient} hint="Yeterli bilgi yok; SkorIQ tahmin yapmıyor." />
            <AnalyticsSummaryStat label="Ortalama Veri" value={formatPercent(matchStats.averageCoverage)} hint="Maç verilerinin ortalama doluluk oranı." />
          </div>
        ) : null}
      </header>

      <div className="analytics-controls">
        <div className="analytics-search-row">
          <SearchBar
            query={frontendFilters.searchQuery}
            onChange={(value) => {
              setFilters(prev => ({ ...prev, offset: 0 }));
              setFrontendFilters(prev => ({ ...prev, searchQuery: value }));
            }}
            onClear={() => {
              setFilters(prev => ({ ...prev, offset: 0 }));
              setFrontendFilters(prev => ({ ...prev, searchQuery: "" }));
            }}
          />
          <button
            type="button"
            className="analytics-clear-filters-btn"
            onClick={handleClearAll}
            disabled={!hasActiveFilters}
          >
            Filtreleri temizle
          </button>
        </div>

        <QuickFilterChips
          activeChip={quickChip}
          onChipClick={handleChipClick}
          counts={quickChipCounts}
        />

        <FilterDisclosure active={hasActiveFilters}>
        <FilterBar
          filters={filters}
          setFilters={setFilters}
          frontendFilters={frontendFilters}
          setFrontendFilters={setFrontendFilters}
          competitions={availableCompetitions}
          countries={availableCountries}
        />
        </FilterDisclosure>

        <ActiveFilterPills
          filters={filters}
          frontendFilters={frontendFilters}
          quickChip={quickChip}
          onClearFilter={handleClearFilter}
          onClearAll={handleClearAll}
        />

        {!loading && data ? (
          <ResultSummaryBar
            showing={filteredItems.length}
            total={effectiveTotal}
            loaded={totalLoaded}
            limit={filters.limit ?? initialFilters.limit ?? 20}
            offset={offset}
            frontendFiltered={hasFrontendFilters}
            hasPrev={hasPrevPage}
            hasNext={hasNextPage}
            onPrev={handlePrevPage}
            onNext={handleNextPage}
          />
        ) : null}
      </div>

      {loading ? <StatePanel title="Maç analizleri yükleniyor..." /> : null}
      {error ? <StatePanel title="Analizler yüklenemedi" body={error} /> : null}
      {!loading && !error && filteredItems.length === 0 ? (
        <EmptySearchState
          hasFilters={hasActiveFilters}
          apiHasData={visibleBaseItems.length > 0}
          onClear={handleClearAll}
          navigate={navigate}
        />
      ) : null}
      {!loading && !error && filteredItems.length > 0 ? (
        <MatchList data={{ items: filteredItems, pagination: data!.pagination }} navigate={navigate} />
      ) : null}
      <div className="analytics-results-link-panel">
        <span>Oynanmış maçları ve tahminlerin sonuçlarını merak ediyorsan buraya bak.</span>
        <button type="button" onClick={() => navigate("/football/prediction-results")}>Sonuçlara Bak →</button>
      </div>
    </>
  );
}

function AnalyticsSummaryStat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="analytics-summary-stat" title={hint}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function FilterBar({
  filters,
  setFilters,
  frontendFilters,
  setFrontendFilters,
  competitions,
  countries
}: {
  filters: FootballAnalyticsMatchFilters;
  setFilters: (filters: FootballAnalyticsMatchFilters) => void;
  frontendFilters: FrontendFilters;
  setFrontendFilters: (filters: FrontendFilters) => void;
  competitions: string[];
  countries: string[];
}) {
  const updateApi = (patch: Partial<FootballAnalyticsMatchFilters>) => setFilters({ ...filters, ...patch });
  const updateUi = (patch: Partial<FrontendFilters>) => setFrontendFilters({ ...frontendFilters, ...patch });

  return (
    <section className="analytics-filters" aria-label="Futbol analiz filtreleri">
      <label>
        Analiz Durumu
        <select value={filters.featureStatus} onChange={(event) => updateApi({ featureStatus: event.target.value as FeatureStatus | "" })}>
          <option value="">Hepsi</option>
          <option value="ready">Hazır</option>
          <option value="partial">Biraz Eksik</option>
          <option value="insufficient_data">Veri Yetersiz</option>
        </select>
      </label>
      <label>
        Tahmin
        <select value={String(filters.predictionEligible)} onChange={(event) => updateApi({ predictionEligible: parseBooleanFilter(event.target.value) })}>
          <option value="">Hepsi</option>
          <option value="true">Tahmin var</option>
          <option value="false">Tahmin yok</option>
        </select>
      </label>
      <label>
        Sonuç Takibi
        <select value={String(filters.kuponEligible)} onChange={(event) => updateApi({ kuponEligible: parseBooleanFilter(event.target.value) })}>
          <option value="">Hepsi</option>
          <option value="true">Açık</option>
          <option value="false">Kapalı</option>
        </select>
      </label>
      {competitions.length > 0 ? (
        <label>
          Lig
          <select value={frontendFilters.competitionName} onChange={(event) => updateUi({ competitionName: event.target.value })}>
            <option value="">Hepsi</option>
            {competitions.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </label>
      ) : null}
      {countries.length > 0 ? (
        <label>
          Ülke
          <select value={frontendFilters.countryName} onChange={(event) => updateUi({ countryName: event.target.value })}>
            <option value="">Hepsi</option>
            {countries.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </label>
      ) : null}
      <label>
        Sayfa boyutu
        <select value={filters.limit ?? 20} onChange={(event) => updateApi({ limit: Number(event.target.value), offset: 0 })}>
          <option value={20}>20</option>
          <option value={50}>50</option>
          <option value={100}>100</option>
          <option value={200}>200</option>
        </select>
      </label>
    </section>
  );
}

function MatchList({ data, navigate }: { data: FootballAnalyticsMatchListResponse; navigate: (path: string) => void }) {
  return (
    <section className="panel analytics-list-panel">
      <div className="match-grid">
        {data.items.map((item) => {
          const detailPath = `/football/analytics/${item.match.matchId}`;
          return (
            <article
              className="match-row analytics-match-row"
              key={item.match.matchId}
              role="button"
              tabIndex={0}
              onClick={() => navigate(detailPath)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  navigate(detailPath);
                }
              }}
              aria-label={`${item.match.homeTeam.name} vs ${item.match.awayTeam.name} analizini aç`}
            >
              <div className="analytics-card-topline">
                <p className="analytics-match-meta">
                  <span className="analytics-match-date">{formatDateTime(item.match.kickoffAt)}</span>
                </p>
        {item.featureStatus ? <StatusBadge status={item.featureStatus} /> : null}
              </div>
              <div className="analytics-match-main">
                <div className="analytics-team-line">
                  <div className="analytics-team-side analytics-team-home">
                    <h3>{item.match.homeTeam.name}</h3>
                    <div className="analytics-team-logo-wrap">
                      <TeamLogo name={item.match.homeTeam.name} logoUrl={item.match.homeTeam.logoUrl} />
                    </div>
                  </div>
                  <span className="analytics-versus-label">VS</span>
                  <div className="analytics-team-side analytics-team-away">
                    <div className="analytics-team-logo-wrap">
                      <TeamLogo name={item.match.awayTeam.name} logoUrl={item.match.awayTeam.logoUrl} />
                    </div>
                    <h3>{item.match.awayTeam.name}</h3>
                  </div>
                </div>
                <div className="coverage-cell analytics-coverage-cell">
                  <ProgressBar value={item.combinedCoverageScore} />
                  <span title="Bu maç için elimizdeki bilgilerin doluluk oranı.">Veri Tamlığı: {formatPercent(item.combinedCoverageScore)}</span>
                </div>
                <span className="analytics-match-league">{item.match.competition.name}</span>
                <div className="analytics-match-badges">
                  {item.predictionEligible ? <span className="badge badge-good" title="SkorIQ bu maç için tahmin üretebiliyor.">Tahmine Uygun</span> : null}
                  {item.hasPredictionPreview ? <span className="badge badge-info" title="Tahmin yayında; analizi açıp okuyabilirsin.">Tahmin Hazır</span> : null}
                  <span className="analytics-row-cta" aria-hidden="true">Analizi Aç →</span>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function getMatchAnalyticsStats(items: FootballAnalyticsMatchListResponse["items"]) {
  const coverageValues = items.map((item) => item.combinedCoverageScore).filter((value): value is number => value !== null);
  const averageCoverage = coverageValues.length > 0 ? coverageValues.reduce((total, value) => total + value, 0) / coverageValues.length : null;

  return {
    ready: items.filter((item) => item.featureStatus === "ready").length,
    partial: items.filter((item) => item.featureStatus === "partial").length,
    insufficient: items.filter((item) => item.featureStatus === "insufficient_data").length,
    averageCoverage
  };
}

function MatchDetailPage({ matchId, navigate, user }: { matchId: string; navigate: (path: string) => void; user: AuthUser }) {
  const { data: report, loading, error } = useLoad(() => fetchFootballAnalyticsMatch(matchId), [matchId]);
  const { data: lineups } = useLoad(() => fetchFootballMatchLineups(matchId), [matchId]);
  const { data: statistics } = useLoad(() => fetchFootballMatchStatistics(matchId), [matchId]);
  const { data: availability } = useLoad(() => fetchFootballMatchPlayerAvailability(matchId), [matchId]);

  const effectiveReport: FootballAnalyticsMatchReport | null = useMemo(() => {
    if (report) return report;
    if (statistics?.match) {
      return {
        match: {
          matchId: statistics.match.id,
          competition: { id: "", name: statistics.match.competition, country: null },
          kickoffAt: statistics.match.kickoffAt,
          status: statistics.match.status,
          homeTeam: statistics.match.homeTeam,
          awayTeam: statistics.match.awayTeam
        },
        featureStatus: "ready",
        predictionEligible: false,
        kuponEligible: false,
        hasPredictionPreview: false,
        confidenceCeiling: 0,
        combinedCoverageScore: 100,
        homeForm: { sampleSize: 5, coverageScore: 100 },
        awayForm: { sampleSize: 5, coverageScore: 100 },
        h2h: { sampleSize: 0, coverageScore: null, h2hMissing: true },
        positiveSignals: [],
        riskFactors: [],
        missingDataWarnings: [],
        summary: "Karşılaşma tamamlandı. Canlı SofaScore telemetri ve detaylı maç istatistikleri kaydedildi."
      };
    }
    return null;
  }, [report, statistics]);

  const homeTeamId = effectiveReport?.match.homeTeam.id;
  const awayTeamId = effectiveReport?.match.awayTeam.id;

  const { data: homeProfile } = useLoad(
    () => (homeTeamId ? fetchFootballTeamProfile(homeTeamId) : Promise.resolve(null)),
    [homeTeamId]
  );
  const { data: awayProfile } = useLoad(
    () => (awayTeamId ? fetchFootballTeamProfile(awayTeamId) : Promise.resolve(null)),
    [awayTeamId]
  );

  return (
    <>
      <button className="back-button match-detail-back" type="button" onClick={() => navigate("/football/analytics")}>
        <span aria-hidden="true">←</span> Maç analizlerine dön
      </button>
      {loading && !effectiveReport ? <StatePanel title="Maç analizi yükleniyor..." /> : null}
      {error && !effectiveReport ? <StatePanel title="Veri yüklenemedi" body={error} /> : null}
      {!loading && !effectiveReport ? <StatePanel title="Analiz raporu bulunamadı" /> : null}
      {effectiveReport ? (
        <MatchDetailReportView
          report={effectiveReport}
          matchId={matchId}
          user={user}
          navigate={navigate}
          lineups={lineups ?? undefined}
          statistics={statistics ?? undefined}
          availability={availability?.items ?? []}
          homeProfile={homeProfile}
          awayProfile={awayProfile}
        />
      ) : null}
    </>
  );
}

type MatchCenterTab = "overview" | "form" | "lineups" | "stats" | "signals";

export function MatchDetailReportView({
  report,
  matchId,
  user,
  navigate,
  lineups,
  statistics,
  availability,
  homeProfile,
  awayProfile
}: {
  report: FootballAnalyticsMatchReport;
  matchId: string;
  user: AuthUser;
  navigate: (path: string) => void;
  lineups?: FootballMatchLineupsResponse;
  statistics?: FootballMatchStatisticsResponse;
  availability: FootballTeamProfileResponse["playerAvailability"];
  homeProfile?: FootballTeamProfileResponse | null;
  awayProfile?: FootballTeamProfileResponse | null;
}) {
  const isFinished = ["finished", "ended", "after_extra_time", "after_penalties"].includes(report.match.status);
  const [activeTab, setActiveTab] = useState<MatchCenterTab>(
    isFinished && statistics?.hasStatistics ? "stats" : "overview"
  );
  const competitionName = report.match.competition?.name || "Lig bilgisi yok";
  const kickoffLabel = report.match.kickoffAt ? formatDateTime(report.match.kickoffAt) : "Tarih bilgisi yok";
  const matchStatus = report.match.status ? matchStatusLabel(report.match.status) : "Durum bilgisi yok";
  const analysisSummary = formatAnalysisSummary(report);

  return (
    <div className="match-report-layout">
      <header className="match-report-hero">
        <h1 className="arena-sr-only">{report.match.homeTeam.name} — {report.match.awayTeam.name} maç analizi</h1>
        <div className="match-report-meta">
          <span>{competitionName}</span>
          <span aria-hidden="true">•</span>
          <span>{kickoffLabel}</span>
          <span aria-hidden="true">•</span>
          <span>{matchStatus}</span>
        </div>
        <div className="match-report-status">
          <StatusBadge status={report.featureStatus} />
        </div>
        <div className="match-report-matchup">
          <MatchHeroTeam role="Ev sahibi" name={report.match.homeTeam.name} logoUrl={report.match.homeTeam.logoUrl} />
          <div className="match-report-vs" aria-label="versus">
            {statistics?.match?.homeScore !== null && statistics?.match?.awayScore !== null && typeof statistics?.match?.homeScore !== "undefined" ? (
              <div className="match-scoreboard-display">
                <span className="scoreboard-score tabular-num">{statistics.match.homeScore} - {statistics.match.awayScore}</span>
                <span className="scoreboard-badge">{isFinished ? "MS" : matchStatus}</span>
              </div>
            ) : (
              "VS"
            )}
          </div>
          <MatchHeroTeam role="Deplasman" name={report.match.awayTeam.name} logoUrl={report.match.awayTeam.logoUrl} />
        </div>
      </header>

      {/* Match Center Segmented Sub-Navigation */}
      <SectionTabs idPrefix="match-details" label="Maç analiz sekmeleri" value={activeTab} onChange={setActiveTab} items={[
        { id: "overview", label: "Genel Bakış", icon: "overview" },
        { id: "form", label: "Form & H2H", icon: "form" },
        { id: "lineups", label: "Kadro", icon: "team" },
        { id: "stats", label: "İstatistik", icon: "chart" },
        { id: "signals", label: "Sinyaller", icon: "signal" }
      ]} />
      <div className="arena-tab-panel" id="match-details-panel" role="tabpanel" aria-labelledby={`match-details-${activeTab}-tab`} tabIndex={0}>

      {/* 1. OVERVIEW TAB */}
      {activeTab === "overview" && (
        <>
          <MemberPredictionPreview matchId={matchId} />




          <div className="analysis-kpi-grid">
            <AnalysisKpiCard title="Analiz Durumu" value={statusLabel(report.featureStatus)} body={analysisStatusHelper(report.featureStatus)} tone={report.featureStatus === "ready" ? "success" : report.featureStatus === "partial" ? "warning" : "muted"} icon="shield" />
            <AnalysisKpiCard title="Tahmine Uygunluk" value={report.predictionEligible ? "Uygun" : "Uygun değil"} body={report.predictionEligible ? "Ön analiz üretilebilir" : "Tahmin için yeterli değil"} tone={report.predictionEligible ? "success" : "muted"} icon="star" />
            <AnalysisKpiCard title="Güven Tavanı" value={report.confidenceCeiling} body="En yüksek güven sınırı" tone="blue" icon="trend" />
            <AnalysisKpiCard title="Veri Kapsamı" value={formatPercent(report.combinedCoverageScore)} body="Kullanılan veri yeterliliği" tone="blue" icon="target">
              <ProgressBar value={report.combinedCoverageScore} />
            </AnalysisKpiCard>
          </div>

          <GoalProfileSection report={report} />

          {analysisSummary ? (
            <section className="panel analysis-summary-panel">
              <div>
                <p className="eyebrow">Rapor yorumu</p>
                <h2>Analiz Özeti</h2>
              </div>
              <p>{analysisSummary}</p>
            </section>
          ) : null}


          <MatchCenterH2HFormComparison
            homeTeam={report.match.homeTeam}
            awayTeam={report.match.awayTeam}
            homeProfile={homeProfile}
            awayProfile={awayProfile}
            h2h={report.h2h}
            navigate={navigate}
            compact
          />

          <div className="signal-grid analysis-signal-grid">
            <ReportSignalCard title="Pozitif Sinyaller" items={report.positiveSignals.map((item) => formatSignalText(item, report))} tone="positive" />
            <ReportSignalCard title="Risk Faktörleri" items={report.riskFactors.map((item) => formatRiskText(item, report))} tone="risk" />
            <ReportSignalCard title="Eksik Veriler" items={report.missingDataWarnings.map((item) => formatMissingText(item, report))} tone="missing" />
          </div>
        </>
      )}

      {/* 2. FORM & H2H TAB */}
      {activeTab === "form" && (
        <>
          <MatchCenterH2HFormComparison
            homeTeam={report.match.homeTeam}
            awayTeam={report.match.awayTeam}
            homeProfile={homeProfile}
            awayProfile={awayProfile}
            h2h={report.h2h}
            navigate={navigate}
          />

          <div className="analysis-form-grid">
            <AnalysisCoverageCard teamName={report.match.homeTeam.name} label="İç saha formu" block={report.homeForm} side="home" />
            <AnalysisCoverageCard teamName={report.match.awayTeam.name} label="Dış saha formu" block={report.awayForm} side="away" />
            <AnalysisH2HCard block={report.h2h} />
          </div>

          {analysisSummary ? (
            <section className="panel analysis-summary-panel">
              <div>
                <p className="eyebrow">Rapor yorumu</p>
                <h2>Analiz Özeti</h2>
              </div>
              <p>{analysisSummary}</p>
            </section>
          ) : null}
        </>
      )}

      {/* 3. LINEUPS & TACTICS TAB */}
      {activeTab === "lineups" && (
        <>
          <MatchLineupsSection lineups={lineups} navigate={navigate} />
          <MatchAvailabilitySection items={availability} />
        </>
      )}

      {/* 4. TELEMETRY & STATS TAB */}
      {activeTab === "stats" && (
        <>
          {statistics?.hasStatistics ? (
            <MatchTelemetrySection statistics={statistics} showEmptyNotice={false} />
          ) : (
            <section className="panel match-telemetry-empty-panel">
              <div className="section-header">
                <div>
                  <p className="eyebrow">Maç istatistikleri</p>
                  <h2>Maç istatistikleri henüz hazır değil</h2>
                </div>
                <span className="badge badge-muted">Veri bekleniyor</span>
              </div>
              <p className="muted">
                Bu karşılaşma için istatistik verisi henüz bulunmuyor. Mevcut sezon verilerini aşağıdaki karşılaştırmadan inceleyebilirsin.
              </p>
            </section>
          )}

          <MatchCenterSeasonTelemetryComparison
            homeTeam={report.match.homeTeam}
            awayTeam={report.match.awayTeam}
            homeProfile={homeProfile}
            awayProfile={awayProfile}
          />

          <GoalProfileSection report={report} />
        </>
      )}

      {/* 5. SIGNALS TAB */}
      {activeTab === "signals" && (
        <>
          <div className="analysis-kpi-grid">
            <AnalysisKpiCard title="Analiz Durumu" value={statusLabel(report.featureStatus)} body={analysisStatusHelper(report.featureStatus)} tone={report.featureStatus === "ready" ? "success" : report.featureStatus === "partial" ? "warning" : "muted"} icon="shield" />
            <AnalysisKpiCard title="Tahmine Uygunluk" value={report.predictionEligible ? "Uygun" : "Uygun değil"} body={report.predictionEligible ? "Ön analiz üretilebilir" : "Tahmin için yeterli değil"} tone={report.predictionEligible ? "success" : "muted"} icon="star" />
            <AnalysisKpiCard title="Güven Tavanı" value={report.confidenceCeiling} body="En yüksek güven sınırı" tone="blue" icon="trend" />
            <AnalysisKpiCard title="Veri Kapsamı" value={formatPercent(report.combinedCoverageScore)} body="Kullanılan veri yeterliliği" tone="blue" icon="target">
              <ProgressBar value={report.combinedCoverageScore} />
            </AnalysisKpiCard>
          </div>

          <div className="signal-grid analysis-signal-grid">
            <ReportSignalCard title="Pozitif Sinyaller" items={report.positiveSignals.map((item) => formatSignalText(item, report))} tone="positive" />
            <ReportSignalCard title="Risk Faktörleri" items={report.riskFactors.map((item) => formatRiskText(item, report))} tone="risk" />
            <ReportSignalCard title="Eksik Veriler" items={report.missingDataWarnings.map((item) => formatMissingText(item, report))} tone="missing" />
          </div>

          {analysisSummary ? (
            <section className="panel analysis-summary-panel">
              <div>
                <p className="eyebrow">Rapor yorumu</p>
                <h2>Analiz Özeti</h2>
              </div>
              <p>{analysisSummary}</p>
            </section>
          ) : null}
        </>
      )}

      </div>

      {user.role === "admin" ? (
        <>
          <AdminMatchReviewLinks matchId={matchId} navigate={navigate} />
          <PredictionReviewSummaryCard matchId={matchId} navigate={navigate} />
        </>
      ) : null}

    </div>
  );
}

function analysisStatusHelper(status: FootballAnalyticsMatchReport["featureStatus"]) {
  if (status === "ready") return "Analiz için yeterli veri var";
  if (status === "partial") return "Bazı veri alanları sınırlı";
  return "Analiz için veri eksik";
}

export function MatchCenterH2HFormComparison({
  homeTeam,
  awayTeam,
  homeProfile,
  awayProfile,
  h2h,
  navigate,
  compact = false
}: {
  homeTeam: { id: string; name: string; logoUrl?: string | null };
  awayTeam: { id: string; name: string; logoUrl?: string | null };
  homeProfile?: FootballTeamProfileResponse | null;
  awayProfile?: FootballTeamProfileResponse | null;
  h2h?: FootballAnalyticsMatchReport["h2h"];
  navigate?: (path: string) => void;
  compact?: boolean;
}) {
  const homeStanding = homeProfile?.standing;
  const awayStanding = awayProfile?.standing;
  const homeForm = homeProfile?.formSummary?.home ?? homeProfile?.formSummary?.overall;
  const awayForm = awayProfile?.formSummary?.away ?? awayProfile?.formSummary?.overall;
  const homeOverall = homeProfile?.formSummary?.overall;
  const awayOverall = awayProfile?.formSummary?.overall;

  const homeRecent = homeProfile?.recentMatches?.slice(0, 5) ?? [];
  const awayRecent = awayProfile?.recentMatches?.slice(0, 5) ?? [];

  const directH2HMatches = useMemo(() => {
    const list: FootballTeamProfileRecentMatch[] = [];
    if (homeProfile?.recentMatches) {
      for (const m of homeProfile.recentMatches) {
        if (m.opponent.id === awayTeam.id) {
          list.push(m);
        }
      }
    }
    return list;
  }, [homeProfile, awayTeam.id]);

  const hasDirectH2H = directH2HMatches.length > 0;
  const isFirstMeetingNotice = !hasDirectH2H && (!h2h || h2h.sampleSize === 0 || h2h.h2hMissing);

  return (
    <div className="match-center-h2h-comparison">
      {/* 1. Standings Comparison Header */}
      {homeStanding && awayStanding ? (
        <section className="panel h2h-standings-panel">
          <div className="section-header">
            <div>
              <p className="eyebrow">Lig Sıralaması & Performans</p>
              <h2>Puan Durumu Karşılaştırması</h2>
            </div>
            <span className="badge badge-accent">2026/27 Sezonu</span>
          </div>

          <div className="h2h-standings-table-wrap">
            <table className="h2h-standings-table">
              <thead>
                <tr>
                  <th className="th-rank">Sıra</th>
                  <th className="th-team">Takım</th>
                  <th className="th-num">OM</th>
                  <th className="th-num">G</th>
                  <th className="th-num">B</th>
                  <th className="th-num">M</th>
                  <th className="th-num">AG</th>
                  <th className="th-num">YG</th>
                  <th className="th-num">AV</th>
                  <th className="th-pts">Puan</th>
                </tr>
              </thead>
              <tbody>
                <tr className="standing-row home-row">
                  <td className="td-rank">
                    <span className="rank-badge rank-top">#{homeStanding.position}</span>
                  </td>
                  <td className="td-team">
                    <div className="table-team-cell">
                      <TeamLogo name={homeTeam.name} logoUrl={homeTeam.logoUrl} size="sm" />
                      <strong>{homeTeam.name}</strong>
                      <span className="team-role-pill home-pill">Ev Sahibi</span>
                    </div>
                  </td>
                  <td className="td-num tabular-num">{homeStanding.played}</td>
                  <td className="td-num tabular-num">{homeStanding.wins}</td>
                  <td className="td-num tabular-num">{homeStanding.draws}</td>
                  <td className="td-num tabular-num">{homeStanding.losses}</td>
                  <td className="td-num tabular-num">{homeStanding.goalsFor}</td>
                  <td className="td-num tabular-num">{homeStanding.goalsAgainst}</td>
                  <td className={`td-num tabular-num ${homeStanding.goalDifference > 0 ? "text-positive" : homeStanding.goalDifference < 0 ? "text-danger" : ""}`}>
                    {homeStanding.goalDifference > 0 ? `+${homeStanding.goalDifference}` : homeStanding.goalDifference}
                  </td>
                  <td className="td-pts tabular-num">
                    <strong>{homeStanding.points}</strong>
                  </td>
                </tr>
                <tr className="standing-row away-row">
                  <td className="td-rank">
                    <span className="rank-badge">#{awayStanding.position}</span>
                  </td>
                  <td className="td-team">
                    <div className="table-team-cell">
                      <TeamLogo name={awayTeam.name} logoUrl={awayTeam.logoUrl} size="sm" />
                      <strong>{awayTeam.name}</strong>
                      <span className="team-role-pill away-pill">Deplasman</span>
                    </div>
                  </td>
                  <td className="td-num tabular-num">{awayStanding.played}</td>
                  <td className="td-num tabular-num">{awayStanding.wins}</td>
                  <td className="td-num tabular-num">{awayStanding.draws}</td>
                  <td className="td-num tabular-num">{awayStanding.losses}</td>
                  <td className="td-num tabular-num">{awayStanding.goalsFor}</td>
                  <td className="td-num tabular-num">{awayStanding.goalsAgainst}</td>
                  <td className={`td-num tabular-num ${awayStanding.goalDifference > 0 ? "text-positive" : awayStanding.goalDifference < 0 ? "text-danger" : ""}`}>
                    {awayStanding.goalDifference > 0 ? `+${awayStanding.goalDifference}` : awayStanding.goalDifference}
                  </td>
                  <td className="td-pts tabular-num">
                    <strong>{awayStanding.points}</strong>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {/* 2. Form Telemetry Comparison Grid */}
      {(homeForm || homeOverall) && (awayForm || awayOverall) ? (
        <section className="panel h2h-form-metrics-panel">
          <div className="section-header">
            <div>
              <p className="eyebrow">Form Göstergeleri</p>
              <h2>Son 5 Maç Performans Dengesi</h2>
            </div>
            <div className="h2h-legend">
              <span className="legend-item home-item"><span className="legend-dot home-dot" /> {homeTeam.name}</span>
              <span className="legend-item away-item"><span className="legend-dot away-dot" /> {awayTeam.name}</span>
            </div>
          </div>

          <div className="h2h-split-metrics-grid">
            <FormMetricSplitRow
              label="Form Puanı (Son 5)"
              homeVal={homeForm?.points ?? homeOverall?.points ?? 0}
              awayVal={awayForm?.points ?? awayOverall?.points ?? 0}
              homeStr={`${homeForm?.points ?? homeOverall?.points ?? 0} P`}
              awayStr={`${awayForm?.points ?? awayOverall?.points ?? 0} P`}
              maxVal={15}
            />
            <FormMetricSplitRow
              label="Bilanço (G-B-M)"
              homeVal={(homeForm?.wins ?? 0) * 3 + (homeForm?.draws ?? 0)}
              awayVal={(awayForm?.wins ?? 0) * 3 + (awayForm?.draws ?? 0)}
              homeStr={`${homeForm?.wins ?? 0}G ${homeForm?.draws ?? 0}B ${homeForm?.losses ?? 0}M`}
              awayStr={`${awayForm?.wins ?? 0}G ${awayForm?.draws ?? 0}B ${awayForm?.losses ?? 0}M`}
              maxVal={15}
            />
            <FormMetricSplitRow
              label="Maç Başı Atılan Gol"
              homeVal={homeForm?.avgGoalsFor ?? homeOverall?.avgGoalsFor ?? 0}
              awayVal={awayForm?.avgGoalsFor ?? awayOverall?.avgGoalsFor ?? 0}
              homeStr={formatDecimal(homeForm?.avgGoalsFor ?? homeOverall?.avgGoalsFor)}
              awayStr={formatDecimal(awayForm?.avgGoalsFor ?? awayOverall?.avgGoalsFor)}
              maxVal={3.5}
            />
            <FormMetricSplitRow
              label="Maç Başı Yenilen Gol"
              homeVal={homeForm?.avgGoalsAgainst ?? homeOverall?.avgGoalsAgainst ?? 0}
              awayVal={awayForm?.avgGoalsAgainst ?? awayOverall?.avgGoalsAgainst ?? 0}
              homeStr={formatDecimal(homeForm?.avgGoalsAgainst ?? homeOverall?.avgGoalsAgainst)}
              awayStr={formatDecimal(awayForm?.avgGoalsAgainst ?? awayOverall?.avgGoalsAgainst)}
              maxVal={3.5}
              lowerIsBetter
            />
            <FormMetricSplitRow
              label="2.5 Gol Üstü Oranı"
              homeVal={(homeForm?.over25Rate ?? homeOverall?.over25Rate ?? 0) * 100}
              awayVal={(awayForm?.over25Rate ?? awayOverall?.over25Rate ?? 0) * 100}
              homeStr={formatRatePercent(homeForm?.over25Rate ?? homeOverall?.over25Rate)}
              awayStr={formatRatePercent(awayForm?.over25Rate ?? awayOverall?.over25Rate)}
              maxVal={100}
            />
            <FormMetricSplitRow
              label="Karşılıklı Gol (KG Var)"
              homeVal={(homeForm?.bothTeamsToScoreRate ?? homeOverall?.bothTeamsToScoreRate ?? 0) * 100}
              awayVal={(awayForm?.bothTeamsToScoreRate ?? awayOverall?.bothTeamsToScoreRate ?? 0) * 100}
              homeStr={formatRatePercent(homeForm?.bothTeamsToScoreRate ?? homeOverall?.bothTeamsToScoreRate)}
              awayStr={formatRatePercent(awayForm?.bothTeamsToScoreRate ?? awayOverall?.bothTeamsToScoreRate)}
              maxVal={100}
            />
            <FormMetricSplitRow
              label="İlk Yarı 0.5 Üstü"
              homeVal={(homeForm?.firstHalfOver05Rate ?? homeOverall?.firstHalfOver05Rate ?? 0) * 100}
              awayVal={(awayForm?.firstHalfOver05Rate ?? awayOverall?.firstHalfOver05Rate ?? 0) * 100}
              homeStr={formatRatePercent(homeForm?.firstHalfOver05Rate ?? homeOverall?.firstHalfOver05Rate)}
              awayStr={formatRatePercent(awayForm?.firstHalfOver05Rate ?? awayOverall?.firstHalfOver05Rate)}
              maxVal={100}
            />
          </div>
        </section>
      ) : null}

      {/* 3. Recent Matches Comparison (Side-by-Side) */}
      {!compact && (homeRecent.length > 0 || awayRecent.length > 0) ? (
        <section className="panel h2h-recent-matches-panel">
          <div className="section-header">
            <div>
              <p className="eyebrow">Puan & Sonuç Trendi</p>
              <h2>Son Maçlar Karşılaştırması</h2>
            </div>
          </div>

          <div className="h2h-matches-side-grid">
            {/* Home Column */}
            <div className="h2h-matches-col">
              <div className="h2h-col-header">
                <TeamLogo name={homeTeam.name} logoUrl={homeTeam.logoUrl} size="sm" />
                <h3>{homeTeam.name}</h3>
                <span className="h2h-count-badge">{homeRecent.length} Maç</span>
              </div>
              <div className="h2h-recent-list">
                {homeRecent.map((m) => (
                  <RecentMatchPillRow key={m.matchId} match={m} navigate={navigate} />
                ))}
              </div>
            </div>

            {/* Away Column */}
            <div className="h2h-matches-col">
              <div className="h2h-col-header">
                <TeamLogo name={awayTeam.name} logoUrl={awayTeam.logoUrl} size="sm" />
                <h3>{awayTeam.name}</h3>
                <span className="h2h-count-badge">{awayRecent.length} Maç</span>
              </div>
              <div className="h2h-recent-list">
                {awayRecent.map((m) => (
                  <RecentMatchPillRow key={m.matchId} match={m} navigate={navigate} />
                ))}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {/* 4. Direct H2H or Season Notice */}
      {hasDirectH2H ? (
        <section className="panel direct-h2h-panel">
          <div className="section-header">
            <div>
              <p className="eyebrow">Tarihsel Rekabet</p>
              <h2>Doğrudan İkili Karşılaşmalar</h2>
            </div>
            <span className="badge badge-accent">{directH2HMatches.length} Maç</span>
          </div>
          <div className="h2h-recent-list">
            {directH2HMatches.map((m) => (
              <RecentMatchPillRow key={m.matchId} match={m} navigate={navigate} />
            ))}
          </div>
        </section>
      ) : isFirstMeetingNotice ? (
        <section className="panel h2h-notice-panel">
          <div className="h2h-notice-content">
            <span className="h2h-notice-icon">⚡</span>
            <div>
              <strong>2026/27 Sezonu İlk Randevu</strong>
              <p>
                İki takım bu sezon ligde ilk kez karşılaşıyor. Son 5 maçlık zaman penceresinde doğrudan eşleşme bulunmadığı için modelimiz
                takımların güncel lig formu, iç/dış saha gol ortalamaları ve SofaScore sezon telemetrisi üzerinden analizi şekillendirmektedir.
              </p>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function FormMetricSplitRow({
  label,
  homeVal,
  awayVal,
  homeStr,
  awayStr,
  lowerIsBetter = false
}: {
  label: string;
  homeVal: number;
  awayVal: number;
  homeStr: string;
  awayStr: string;
  maxVal?: number;
  lowerIsBetter?: boolean;
}) {
  const sum = (homeVal || 0) + (awayVal || 0);
  const homePct = sum > 0 ? Math.min(100, Math.max(0, Math.round((homeVal / sum) * 100))) : 50;
  const awayPct = 100 - homePct;

  const isHomeWinner = lowerIsBetter ? homeVal < awayVal : homeVal > awayVal;
  const isAwayWinner = lowerIsBetter ? awayVal < homeVal : awayVal > homeVal;

  return (
    <div className="h2h-split-row">
      <div className="h2h-split-header">
        <span className={`h2h-split-val home ${isHomeWinner ? "leader" : ""}`}>{homeStr}</span>
        <span className="h2h-split-label">{label}</span>
        <span className={`h2h-split-val away ${isAwayWinner ? "leader" : ""}`}>{awayStr}</span>
      </div>
      <div className="h2h-split-bar-track">
        <div className="h2h-bar-segment home-seg" style={{ width: `${homePct}%` }} />
        <div className="h2h-bar-segment away-seg" style={{ width: `${awayPct}%` }} />
      </div>
    </div>
  );
}

function RecentMatchPillRow({
  match,
  navigate
}: {
  match: FootballTeamProfileRecentMatch;
  navigate?: (path: string) => void;
}) {
  const resultClass = match.result === "W" ? "res-w" : match.result === "D" ? "res-d" : match.result === "L" ? "res-l" : "res-u";
  const resultText = match.result === "W" ? "G" : match.result === "D" ? "B" : match.result === "L" ? "M" : "—";

  return (
    <div className="recent-match-pill-row">
      <span className={`match-result-pill ${resultClass}`}>{resultText}</span>
      <div className="match-pill-opponent">
        <TeamLogo name={match.opponent.name} logoUrl={match.opponent.logoUrl} size="sm" />
        <span className="opponent-name">{match.opponent.name}</span>
        <span className="opponent-ha">{match.homeAway === "home" ? "(E)" : "(D)"}</span>
      </div>
      <div className="match-pill-meta">
        <span className="match-pill-date">{formatDate(match.date)}</span>
        {match.fulltimeScore ? <span className="match-pill-score tabular-num">{match.fulltimeScore}</span> : null}
        {navigate ? (
          <button
            type="button"
            className="match-pill-link-btn"
            onClick={() => navigate(`/football/analytics/${match.matchId}`)}
            title="Maç analizini görüntüle"
          >
            →
          </button>
        ) : null}
      </div>
    </div>
  );
}

function seasonMetricValue(statistics: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = statistics[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function formatSeasonMetric(value: number | null): string {
  return value === null ? "—" : String(value);
}

function seasonSingleMetric(statistics: Record<string, unknown>, label: string, totalKeys: string[], perGameLabel: string, perGameKeys: string[]) {
  const total = seasonMetricValue(statistics, totalKeys);
  const perGame = seasonMetricValue(statistics, perGameKeys);
  return total !== null || perGame === null ? { label, value: total } : { label: perGameLabel, value: perGame };
}

function seasonComparisonMetric(home: Record<string, unknown>, away: Record<string, unknown>, label: string, totalKeys: string[], perGameLabel = label, perGameKeys: string[] = []) {
  const homeTotal = seasonMetricValue(home, totalKeys);
  const awayTotal = seasonMetricValue(away, totalKeys);
  const homePerGame = seasonMetricValue(home, perGameKeys);
  const awayPerGame = seasonMetricValue(away, perGameKeys);
  if ((homeTotal === null || awayTotal === null) && (homePerGame !== null || awayPerGame !== null)) {
    return { label: perGameLabel, home: homePerGame, away: awayPerGame };
  }
  return { label, home: homeTotal, away: awayTotal };
}

export function MatchCenterSeasonTelemetryComparison({
  homeProfile,
  awayProfile
}: {
  homeTeam: { id: string; name: string; logoUrl?: string | null };
  awayTeam: { id: string; name: string; logoUrl?: string | null };
  homeProfile?: FootballTeamProfileResponse | null;
  awayProfile?: FootballTeamProfileResponse | null;
}) {
  const hs = (homeProfile?.team?.seasonStatistics ?? {}) as Record<string, unknown>;
  const as = (awayProfile?.team?.seasonStatistics ?? {}) as Record<string, unknown>;

  const hasStats = Object.keys(hs).length > 0 || Object.keys(as).length > 0;

  if (!hasStats) {
    return (
      <section className="panel season-telemetry-empty-panel">
        <div className="section-header">
          <div>
            <h2>Sezon İstatistikleri</h2>
          </div>
          <span className="badge badge-muted">Veri Bekleniyor</span>
        </div>
        <p className="muted">
          Bu iki takım için sezon istatistikleri henüz mevcut değil.
        </p>
      </section>
    );
  }

  const metric = (label: string, totalKeys: string[], perGameLabel?: string, perGameKeys?: string[]) =>
    seasonComparisonMetric(hs, as, label, totalKeys, perGameLabel, perGameKeys);
  const possession = metric("Topa Sahip Olma", ["averageBallPossession"]);
  const goals = metric("Toplam Atılan Gol", ["goalsScored"], "Gol / maç", ["goalsScoredPerGame"]);
  const conceded = metric("Yenilen Gol", ["goalsConceded"], "Yenilen Gol / maç", ["goalsConcededPerGame"]);
  const shots = metric("Toplam Şut", ["shots", "shotsTotal"], "Şut / maç", ["shotsPerGame"]);
  const onTarget = metric("İsabetli Şut", ["shotsOnTarget"], "İsabetli Şut / maç", ["shotsOnTargetPerGame"]);
  const chances = metric("Büyük Şanslar", ["bigChances"], "Büyük Şans / maç", ["bigChancesPerGame"]);
  const passing = metric("Pas İsabet Oranı", ["accuratePassesPercentage"]);
  const attackRows = [goals, shots, onTarget, chances,
    metric("Başarılı Çalım", ["successfulDribbles"], "Başarılı Çalım / maç", ["successfulDribblesPerGame"]),
    metric("Kazanılan Korner", ["corners"], "Korner / maç", ["cornersPerGame"])];
  const defenseRows = [conceded, metric("Gol Yememe (Clean Sheet)", ["cleanSheets"]),
    metric("Top Çalma (Tackles)", ["tackles"], "Top Çalma / maç", ["tacklesPerGame"]),
    metric("Pas Arası (Interceptions)", ["interceptions"], "Pas Arası / maç", ["interceptionsPerGame"]),
    metric("Sarı Kart", ["yellowCards"], "Sarı Kart / maç", ["yellowCardsPerGame"]),
    metric("Kırmızı Kart (toplam)", ["redCards"])];

  return (
    <section className="panel season-telemetry-panel">
      <div className="section-header">
        <div>
          <h2>Sezon Karşılaştırması</h2>
        </div>
      </div>

      <div className="telemetry-key-metrics">
        {[possession, goals, shots, onTarget, chances, passing].map((item) => {
          const percentage = item === possession || item === passing;
          const format = (value: number | null) => percentage && value !== null ? `%${value.toFixed(1)}` : formatSeasonMetric(value);
          return <TelemetryComparisonBar key={item.label} label={item.label} homeValue={format(item.home)} awayValue={format(item.away)} homeNum={item.home} awayNum={item.away} highlight={item === possession} />;
        })}
      </div>

      <div className="telemetry-details-grid">
        <div className="telemetry-table-card">
          <h3>Hücum & Üretkenlik (Sezon)</h3>
          <div className="telemetry-rows">
            {attackRows.map((item) => <TelemetryRow key={item.label} {...item} />)}
          </div>
        </div>

        <div className="telemetry-table-card">
          <h3>Savunma & Disiplin (Sezon)</h3>
          <div className="telemetry-rows">
            {defenseRows.map((item) => <TelemetryRow key={item.label} {...item} />)}
          </div>
        </div>
      </div>
    </section>
  );
}

function MatchHeroTeam({ role, name, logoUrl }: { role: string; name: string; logoUrl?: string | null }) {
  return (
    <div className="match-hero-team">
      <TeamLogo name={name} logoUrl={logoUrl} size="lg" />
      <div>
        <span>{role}</span>
        <h2>{name}</h2>
      </div>
    </div>
  );
}

function AnalysisKpiCard({
  title,
  value,
  body,
  tone,
  icon,
  children
}: {
  title: string;
  value: ReactNode;
  body: string;
  tone: "success" | "warning" | "blue" | "muted";
  icon: "shield" | "star" | "trend" | "target";
  children?: ReactNode;
}) {
  return (
    <section className={`analysis-kpi-card analysis-kpi-${tone}`}>
      <div className="analysis-card-title">
        <AnalysisIcon name={icon} />
        <span>{title}</span>
      </div>
      <strong>{value}</strong>
      <p>{body}</p>
      {children}
    </section>
  );
}

export function AnalysisCoverageCard({ teamName, label, block, side }: { teamName: string; label: string; block: FootballAnalyticsMatchReport["homeForm"]; side: "home" | "away" }) {
  return (
    <section className="analysis-form-card">
      <div>
        <h2>{teamName}</h2>
        <p>{label}</p>
      </div>
      <strong>{formatPercent(block.coverageScore)}</strong>
      <ProgressBar value={block.coverageScore ?? 0} />
      <div className="analysis-form-meta">
        <span>Örneklem: {block.sampleSize}</span>
        {block.scope ? <span>Kapsam: {formatCoverageScope(block.scope, side)}</span> : null}
        {block.windowSize ? <span>Son {block.windowSize} maç</span> : null}
      </div>
    </section>
  );
}

export function AnalysisH2HCard({ block }: { block: FootballAnalyticsMatchReport["h2h"] }) {
  return (
    <section className="analysis-form-card analysis-h2h-card">
      <div>
        <h2>Takımlar Arası Geçmiş</h2>
        <p>{block.h2hMissing ? "Bu eşleşme için yeterli H2H verisi yok" : "Geçmiş eşleşme verisi mevcut"}</p>
      </div>
      <strong>{formatPercent(block.coverageScore)}</strong>
      <ProgressBar value={block.coverageScore ?? 0} />
      <div className="analysis-form-meta">
        <span>Örneklem: {block.sampleSize}</span>
        <span>{block.h2hMissing ? "Eksik veri" : "H2H mevcut"}</span>
      </div>
      <div className="h2h-watermark" aria-hidden="true">
        <NavIcon name="teams" />
      </div>
    </section>
  );
}

function formatCoverageScope(scope: string, side: "home" | "away") {
  const normalized = scope.trim().toLowerCase();
  if (normalized === "home") return "İç saha";
  if (normalized === "away") return "Dış saha";
  if (normalized === "overall" || normalized === "all") return "Genel";
  return side === "home" ? "İç saha" : "Dış saha";
}

function GoalProfileSection({ report }: { report: FootballAnalyticsMatchReport }) {
  const goalProfileItems = getGoalProfileItems(report);
  if (goalProfileItems.length === 0) return null;

  const hasGoalSplit =
    report.expectedHomeGoalsProxy !== null &&
    report.expectedHomeGoalsProxy !== undefined &&
    report.expectedAwayGoalsProxy !== null &&
    report.expectedAwayGoalsProxy !== undefined;

  const homeXG = report.expectedHomeGoalsProxy ?? 0;
  const awayXG = report.expectedAwayGoalsProxy ?? 0;
  const totalXG = homeXG + awayXG || 1;
  const homePct = Math.min(100, Math.max(0, Math.round((homeXG / totalXG) * 100)));
  const awayPct = 100 - homePct;

  return (
    <section className="panel goal-profile-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Gol profili</p>
          <h2>Gol Profili</h2>
        </div>
      </div>

      {hasGoalSplit ? (
        <div className="telemetry-goal-split-gauge">
          <div className="goal-split-header">
            <div className="goal-split-team">
              <span className="goal-split-team-role">Ev Sahibi Beklenti</span>
              <strong className="goal-split-val">{formatGoalProfileNumber(homeXG)}</strong>
            </div>
            <div className="goal-split-center">
              <span className="goal-split-center-title">Gol Beklentisi Split (xG Proxy)</span>
              {report.expectedTotalGoalsProxy !== null && report.expectedTotalGoalsProxy !== undefined ? (
                <span className="goal-split-total">Toplam: {formatGoalProfileNumber(report.expectedTotalGoalsProxy)}</span>
              ) : null}
            </div>
            <div className="goal-split-team away">
              <span className="goal-split-team-role">Deplasman Beklenti</span>
              <strong className="goal-split-val">{formatGoalProfileNumber(awayXG)}</strong>
            </div>
          </div>
          <div className="telemetry-dual-track">
            <div className="telemetry-track-home" style={{ width: `${homePct}%` }} />
            <div className="telemetry-track-away" style={{ width: `${awayPct}%` }} />
          </div>
        </div>
      ) : null}

      <div className="goal-profile-grid">
        {goalProfileItems.map((item) => (
          <MetricCard key={item.label} title={item.label} value={item.value} />
        ))}
      </div>
    </section>
  );
}

function MatchLineupsSection({ lineups, navigate }: { lineups?: FootballMatchLineupsResponse; navigate?: (path: string) => void }) {
  return (
    <section className="panel match-lineups-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Taktik Düzen</p>
          <h2>Takım Kadroları</h2>
        </div>
      </div>
      {!lineups || lineups.dataStatus !== "ok" || lineups.items.length === 0 ? <p className="muted">Muhtemel kadro verisi henüz yok.</p> : null}
      <div className="form-summary-grid tactical-lineups-board">
        {lineups?.items.map((item) => (
          <div className="form-summary-card lineup-team-column" key={item.team.id}>
            <div className="lineup-team-header">
              <div className="lineup-team-title">
                <h3>{item.team.name}</h3>
                <p className="muted">
                  {item.confirmed ? "Onaylı ilk 11" : "Muhtemel kadro"}
                  {item.formation ? ` · ${item.formation}` : ""}
                </p>
              </div>
              {item.formation ? <span className="badge badge-muted">{item.formation}</span> : null}
            </div>
            <div className="form-summary-body">
              <div className="form-summary-row">
                <span>İlk 11</span>
                <strong>{item.startingXi.length}</strong>
              </div>
              <div className="form-summary-row">
                <span>Yedekler</span>
                <strong>{item.substitutes.length}</strong>
              </div>
              <div className="form-summary-row">
                <span>Kadroda yok</span>
                <strong>{item.unavailable.length}</strong>
              </div>
            </div>

            {item.startingXi.length > 0 ? (
              <div className="lineup-player-list">
                <h4 className="lineup-group-title">İlk 11</h4>
                <div className="lineup-players-grid">
                  {item.startingXi.map((p) => (
                    <div className="lineup-player-row" key={`${item.team.id}-${p.playerId || p.name}`}>
                      <span className="lineup-shirt-number">{p.shirtNumber !== null && p.shirtNumber !== undefined ? `#${p.shirtNumber}` : "—"}</span>
                      {navigate ? (
                        <button type="button" className="lineup-player-name lineup-player-link" onClick={() => navigate(`/football/players/${p.playerId}`)}>
                          {p.name}
                        </button>
                      ) : (
                        <span className="lineup-player-name">{p.name}</span>
                      )}
                      {p.position ? (
                        <span className={`lineup-pos-badge pos-${p.position.toLowerCase()}`}>{p.position}</span>
                      ) : null}
                      {p.rating !== null && p.rating !== undefined ? (
                        <span className="lineup-rating-badge">{p.rating.toFixed(1)}</span>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {item.substitutes.length > 0 ? (
              <div className="lineup-substitutes-list">
                <h4 className="lineup-group-title">Yedekler</h4>
                <div className="lineup-substitutes-chips">
                  {item.substitutes.map((p) => (
                    <span className="lineup-sub-chip" key={`${item.team.id}-${p.playerId || p.name}`}>
                      {p.shirtNumber !== null && p.shirtNumber !== undefined ? (
                        <strong className="lineup-shirt-number">#{p.shirtNumber}</strong>
                      ) : null}
                      {navigate ? (
                        <button type="button" className="lineup-player-link" onClick={() => navigate(`/football/players/${p.playerId}`)}>
                          {p.name}
                        </button>
                      ) : (
                        <span>{p.name}</span>
                      )}
                      {p.position ? <small>({p.position})</small> : null}
                      {p.rating !== null && p.rating !== undefined ? (
                        <small className="lineup-rating-badge">{p.rating.toFixed(1)}</small>
                      ) : null}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {item.unavailable.length > 0 ? (
              <div className="lineup-unavailable-list">
                <h4 className="lineup-group-title">Kadro Dışı</h4>
                <div className="lineup-substitutes-chips">
                  {item.unavailable.map((p) => (
                    <span className="lineup-sub-chip unavailable" key={`${item.team.id}-${p.playerId || p.name}`}>
                      <span>{p.name}</span>
                      {p.position ? <small>({p.position})</small> : null}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

function MatchAvailabilitySection({ items }: { items: FootballTeamProfileResponse["playerAvailability"] }) {
  return (
    <section className="panel match-availability-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Kadro Durumu</p>
          <h2>Sakat-Cezalı Oyuncular</h2>
        </div>
        {items.length > 0 ? <span className="badge badge-muted">{items.length} Kayıt</span> : null}
      </div>
      {items.length === 0 ? <p className="muted">Oyuncu durumu verisi henüz yok.</p> : null}
      <div className="recent-matches-list availability-grid">
        {items.map((item) => (
          <article className="recent-match-row availability-card" key={`${item.playerId}-${item.status}-${item.reason ?? ""}`}>
            <div className="recent-match-opponent">
              <div>
                <strong>{item.playerName}</strong>
                <span className="muted">
                  {item.team.name} · {mapAvailabilityStatusLabel(item.status)}
                  {item.reason ? ` · ${item.reason}` : ""}
                </span>
              </div>
            </div>
            <span className={`availability-status-pill status-${item.status.toLowerCase()}`}>
              {mapAvailabilityStatusLabel(item.status)}
            </span>
          </article>
        ))}
      </div>
    </section>
  );
}

export function MatchTelemetrySection({ statistics, showEmptyNotice = false }: { statistics?: FootballMatchStatisticsResponse; showEmptyNotice?: boolean }) {
  if (!statistics?.hasStatistics || !statistics.home || !statistics.away) {
    if (showEmptyNotice) {
      return (
        <section className="panel match-telemetry-empty-panel">
          <div className="section-header">
            <div>
              <h2>Maç İstatistikleri & xG Analizi</h2>
            </div>
            <span className="badge badge-muted">Beklemede</span>
          </div>
          <p className="muted">
            Bu karşılaşma için detaylı istatistik verisi henüz bulunmuyor. Veriler hazır olduğunda bu alandan inceleyebilirsin.
          </p>
        </section>
      );
    }
    return null;
  }

  const h = statistics.home;
  const a = statistics.away;

  return (
    <section className="panel match-telemetry-panel">
      <div className="section-header">
        <div>
          <h2>Maç İstatistikleri & xG Analizi</h2>
        </div>
      </div>

      <div className="telemetry-key-metrics">
        <TelemetryComparisonBar
          label="Beklenen Gol (xG)"
          homeValue={h.expectedGoals !== null ? h.expectedGoals.toFixed(2) : "—"}
          awayValue={a.expectedGoals !== null ? a.expectedGoals.toFixed(2) : "—"}
          homeNum={h.expectedGoals ?? 0}
          awayNum={a.expectedGoals ?? 0}
          highlight
        />

        <TelemetryComparisonBar
          label="Topa Sahip Olma"
          homeValue={h.possessionPercent !== null ? `%${Math.round(h.possessionPercent)}` : "—"}
          awayValue={a.possessionPercent !== null ? `%${Math.round(a.possessionPercent)}` : "—"}
          homeNum={h.possessionPercent ?? 50}
          awayNum={a.possessionPercent ?? 50}
        />

        <TelemetryComparisonBar
          label="Toplam Şut"
          homeValue={h.shotsTotal !== null ? String(h.shotsTotal) : "—"}
          awayValue={a.shotsTotal !== null ? String(a.shotsTotal) : "—"}
          homeNum={h.shotsTotal ?? 0}
          awayNum={a.shotsTotal ?? 0}
        />

        <TelemetryComparisonBar
          label="İsabetli Şut"
          homeValue={h.shotsOnTarget !== null ? String(h.shotsOnTarget) : "—"}
          awayValue={a.shotsOnTarget !== null ? String(a.shotsOnTarget) : "—"}
          homeNum={h.shotsOnTarget ?? 0}
          awayNum={a.shotsOnTarget ?? 0}
        />

        <TelemetryComparisonBar
          label="Büyük Şanslar"
          homeValue={h.bigChances !== null ? String(h.bigChances) : "—"}
          awayValue={a.bigChances !== null ? String(a.bigChances) : "—"}
          homeNum={h.bigChances ?? 0}
          awayNum={a.bigChances ?? 0}
        />

        <TelemetryComparisonBar
          label="Pas İsabeti"
          homeValue={h.passAccuracyPercent !== null ? `%${Math.round(h.passAccuracyPercent)}` : h.accuratePasses ? `${h.accuratePasses}/${h.passes}` : "—"}
          awayValue={a.passAccuracyPercent !== null ? `%${Math.round(a.passAccuracyPercent)}` : a.accuratePasses ? `${a.accuratePasses}/${a.passes}` : "—"}
          homeNum={h.passAccuracyPercent ?? (h.accuratePasses && h.passes ? (h.accuratePasses / h.passes) * 100 : 50)}
          awayNum={a.passAccuracyPercent ?? (a.accuratePasses && a.passes ? (a.accuratePasses / a.passes) * 100 : 50)}
        />
      </div>

      <div className="telemetry-details-grid">
        <div className="telemetry-table-card">
          <h3>Hücum & Son Vuruş</h3>
          <div className="telemetry-rows">
            <TelemetryRow label="İsabetli Şut" home={h.shotsOnTarget} away={a.shotsOnTarget} />
            <TelemetryRow label="İsabetsiz Şut" home={h.shotsOffTarget} away={a.shotsOffTarget} />
            <TelemetryRow label="Engellenen Şut" home={h.blockedShots} away={a.blockedShots} />
            <TelemetryRow label="Direkten Dönen" home={h.hitWoodwork} away={a.hitWoodwork} />
            <TelemetryRow label="Kaçan Büyük Şans" home={h.bigChancesMissed} away={a.bigChancesMissed} />
            <TelemetryRow label="Korner" home={h.corners} away={a.corners} />
            <TelemetryRow label="Ofsayt" home={h.offsides} away={a.offsides} />
          </div>
        </div>

        <div className="telemetry-table-card">
          <h3>Savunma & Mücadele</h3>
          <div className="telemetry-rows">
            <TelemetryRow label="Başarılı Müdahale" home={h.tackles} away={a.tackles} />
            <TelemetryRow label="Pas Arası" home={h.interceptions} away={a.interceptions} />
            <TelemetryRow label="Tehlike Uzaklaştırma" home={h.clearances} away={a.clearances} />
            <TelemetryRow label="Kaleci Kurtarışı" home={h.goalkeeperSaves} away={a.goalkeeperSaves} />
            <TelemetryRow label="Kazanılan İkili Mücadele" home={h.duelsWon} away={a.duelsWon} />
            <TelemetryRow label="Fauller" home={h.fouls} away={a.fouls} />
            <TelemetryRow label="Sarı Kart" home={h.yellowCards} away={a.yellowCards} />
            <TelemetryRow label="Kırmızı Kart" home={h.redCards} away={a.redCards} />
          </div>
        </div>
      </div>
    </section>
  );
}

function TelemetryComparisonBar({
  label,
  homeValue,
  awayValue,
  homeNum,
  awayNum,
  highlight = false
}: {
  label: string;
  homeValue: string;
  awayValue: string;
  homeNum: number | null;
  awayNum: number | null;
  highlight?: boolean;
}) {
  const comparable = homeNum !== null && awayNum !== null && Number.isFinite(homeNum) && Number.isFinite(awayNum)
    && homeNum >= 0 && awayNum >= 0 && homeValue !== "—" && awayValue !== "—" && homeNum + awayNum > 0;
  const homePct = comparable ? Math.round((homeNum / (homeNum + awayNum)) * 100) : null;

  return (
    <div className={`telemetry-bar-item ${highlight ? "highlight" : ""}`}>
      <div className="telemetry-bar-header">
        <strong className="telemetry-val-home">{homeValue}</strong>
        <span className="telemetry-bar-label">{label}</span>
        <strong className="telemetry-val-away">{awayValue}</strong>
      </div>
      {homePct !== null ? <div className="telemetry-dual-track">
        <div className="telemetry-track-home" style={{ width: `${homePct}%` }} />
        <div className="telemetry-track-away" style={{ width: `${100 - homePct}%` }} />
      </div> : null}
    </div>
  );
}

function TelemetryRow({ label, home, away }: { label: string; home: number | null | undefined; away: number | null | undefined }) {
  const hVal = typeof home === "number" && Number.isFinite(home) ? home : null;
  const aVal = typeof away === "number" && Number.isFinite(away) ? away : null;
  const comparable = hVal !== null && aVal !== null;
  const homeLeads = comparable && hVal > aVal;
  const awayLeads = comparable && aVal > hVal;

  return (
    <div className="telemetry-stat-row">
      <span className={`telemetry-side-val ${homeLeads ? "lead" : ""}`}>{hVal ?? "—"}</span>
      <span className="telemetry-stat-label">{label}</span>
      <span className={`telemetry-side-val ${awayLeads ? "lead" : ""}`}>{aVal ?? "—"}</span>
    </div>
  );
}

function getGoalProfileItems(report: FootballAnalyticsMatchReport) {
  const fields: Array<[keyof FootballAnalyticsMatchReport, string]> = [
    ["goalProfile", "Maç Gol Profili"],
    ["firstHalfGoalProfile", "İlk Yarı Gol Profili"],
    ["bttsProfile", "KG Profili"],
    ["homeTeamGoalProfile", "Ev Sahibi Gol Profili"],
    ["awayTeamGoalProfile", "Deplasman Gol Profili"],
    ["expectedTotalGoalsProxy", "Toplam Gol Beklentisi"],
    ["expectedHomeGoalsProxy", "Ev Sahibi Gol Beklentisi"],
    ["expectedAwayGoalsProxy", "Deplasman Gol Beklentisi"],
    ["homeGoalSignalScore", "Ev Sahibi Gol Sinyali"],
    ["awayGoalSignalScore", "Deplasman Gol Sinyali"],
    ["firstHalfGoalSignalScore", "İlk Yarı Gol Sinyali"],
    ["bttsSignalScore", "KG sinyal skoru"]
  ];

  return fields
    .map(([key, label]) => ({ label, value: report[key] }))
    .filter((item): item is { label: string; value: string | number | boolean } => item.value !== null && item.value !== undefined && typeof item.value !== "object")
    .map((item) => ({ label: item.label, value: typeof item.value === "number" ? formatGoalProfileNumber(item.value) : formatGoalProfileText(String(item.value)) }));
}

function formatGoalProfileNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function formatGoalProfileText(value: string) {
  const normalized = value.trim().toLowerCase();
  const labels: Record<string, string> = {
    high_goal: "Yüksek gol profili",
    medium_goal: "Orta gol profili",
    low_goal: "Düşük gol profili",
    unknown: "Belirsiz",
    likely_goal: "Gol ihtimali güçlü",
    no_lean: "KG Yok eğilimi",
    yes_lean: "KG Var eğilimi",
    balanced: "Dengeli"
  };
  return labels[normalized] ?? value;
}

function mapAvailabilityStatusLabel(value: string) {
  const normalized = value.trim().toLowerCase();
  const labels: Record<string, string> = {
    injured: "Sakat",
    suspended: "Cezalı",
    doubtful: "Şüpheli",
    questionable: "Oynaması belirsiz",
    unavailable: "Kadroda yok",
    unknown: "Veri yok",
    returned: "Döndü"
  };
  return labels[normalized] ?? value;
}

function formatAnalysisSummary(report: FootballAnalyticsMatchReport) {
  const summary = report.summary?.trim();
  if (summary && !looksLikeRawEnglish(summary)) return summary;

  const statusSentence =
    report.featureStatus === "ready"
      ? "Bu maç analiz için hazır görünüyor."
      : report.featureStatus === "partial"
        ? "Bu maçta analiz yapılabilir; ancak bazı veri alanları sınırlı görünüyor."
        : "Bu maç için analiz verisi henüz yeterli görünmüyor.";
  const coverageSentence = `Veri kapsamı ${formatPercent(report.combinedCoverageScore)} seviyesinde ve güven tavanı ${report.confidenceCeiling} olarak sınırlanıyor.`;
  const formSentence =
    (report.homeForm.coverageScore ?? 0) >= (report.awayForm.coverageScore ?? 0)
      ? "Ev sahibi form verisi deplasman tarafına göre daha güçlü okunuyor."
      : "Deplasman form verisi ev sahibi tarafına göre daha güçlü okunuyor.";
  const h2hSentence = report.h2h.h2hMissing
    ? "Takımlar arası geçmiş veri eksik olduğu için sistem daha temkinli davranıyor."
    : "Takımlar arası geçmiş veri analize dahil edilebiliyor.";

  return `${statusSentence} ${formSentence} ${h2hSentence} ${coverageSentence}`;
}

function looksLikeRawEnglish(value: string) {
  const normalized = value.toLowerCase();
  return /\b(feature|readiness|coverage|sufficient|insufficient|sample|window|head-to-head|confidence ceiling|team-form|missing|history|minimum|mvp)\b/.test(normalized);
}

function formatSignalText(text: string, report: FootballAnalyticsMatchReport) {
  return formatReportListText(text, report, "signal");
}

function formatRiskText(text: string, report: FootballAnalyticsMatchReport) {
  return formatReportListText(text, report, "risk");
}

function formatMissingText(text: string, report: FootballAnalyticsMatchReport) {
  return formatReportListText(text, report, "missing");
}

function formatReportListText(text: string, report: FootballAnalyticsMatchReport, kind: "signal" | "risk" | "missing") {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return "Kayıt yok.";
  if (!looksLikeRawEnglish(text)) return text;
  if (normalized.includes("minimum") && normalized.includes("readiness")) return "Minimum analiz veri eşiği sağlandı.";
  if (normalized.includes("team-form") && normalized.includes("sufficient")) return "Takım formu verisi analiz için yeterli seviyede.";
  if (normalized.includes("head-to-head") && (normalized.includes("missing") || normalized.includes("zero-sample"))) return "Takımlar arası geçmiş veri eksik olduğu için güven sınırı düşürüldü.";
  if (normalized.includes("head-to-head") && (normalized.includes("sample") || normalized.includes("unavailable"))) return "Bu eşleşme için yeterli H2H örneklemi bulunmuyor.";
  if (normalized.includes("confidence ceiling")) return `Güven tavanı ${report.confidenceCeiling} seviyesinde sınırlandı.`;
  if (kind === "signal") return "Sistem bu maç için olumlu bir veri sinyali üretti.";
  if (kind === "risk") return "Sistem bu alan için temkinli olunması gerektiğini belirtti.";
  return "Sistem bu alan için ek inceleme uyarısı üretti.";
}

function ReportSignalCard({ title, items, tone }: { title: string; items: string[]; tone: "positive" | "risk" | "missing" }) {
  const visibleItems = items.slice(0, 3);
  const hiddenCount = Math.max(0, items.length - visibleItems.length);
  return (
    <section className={`panel report-signal-card report-signal-${tone}`}>
      <h3>{title}</h3>
      {visibleItems.length === 0 ? (
        <p className="muted">Kayıt yok.</p>
      ) : (
        <ul>
          {visibleItems.map((item, index) => (
            <li key={`${title}-${index}-${item}`}>
              <span aria-hidden="true" />
              <p>{item}</p>
            </li>
          ))}
        </ul>
      )}
      {hiddenCount > 0 ? <p className="signal-more">+{hiddenCount} kayıt daha</p> : null}
    </section>
  );
}

function AnalysisIcon({ name }: { name: "shield" | "star" | "trend" | "target" }) {
  const paths: Record<typeof name, ReactNode> = {
    shield: (
      <>
        <path d="M12 3.8 19 6v5.4c0 4.2-2.8 7.3-7 8.8-4.2-1.5-7-4.6-7-8.8V6z" />
        <path d="m9 12.2 2 2 4-4.4" />
      </>
    ),
    star: <path d="m12 3.8 2.4 5 5.5.8-4 3.9.9 5.5-4.8-2.6L7.2 19l.9-5.5-4-3.9 5.5-.8z" />,
    trend: (
      <>
        <path d="M4 16.5 9 11l4 3.2L20 6" />
        <path d="M15.5 6H20v4.5" />
      </>
    ),
    target: (
      <>
        <circle cx="12" cy="12" r="8" />
        <circle cx="12" cy="12" r="4.2" />
        <circle cx="12" cy="12" r="1.2" />
      </>
    )
  };
  return (
    <svg className="analysis-icon" viewBox="0 0 24 24" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

function AdminMatchReviewLinks({ matchId, navigate }: { matchId: string; navigate: (path: string) => void }) {
  return (
    <section className="panel admin-review-links">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Admin</p>
          <h2>İç İnceleme</h2>
          <p className="muted">Bu alan yalnızca iç denetim içindir.</p>
        </div>
        <span className="badge badge-muted">Salt okunur</span>
      </div>
      <div className="button-row">
        <button type="button" data-review-path={`/football/matches/${matchId}/prediction-drafts`} onClick={() => navigate(`/football/matches/${matchId}/prediction-drafts`)}>
          Taslakları gör
        </button>
        <button type="button" data-review-path={`/football/matches/${matchId}/prediction-settlements`} onClick={() => navigate(`/football/matches/${matchId}/prediction-settlements`)}>
          Sonuçları gör
        </button>
        <button type="button" data-review-path={`/football/matches/${matchId}/public-eligibility`} onClick={() => navigate(`/football/matches/${matchId}/public-eligibility`)}>
          Public uygunluğu gör
        </button>
      </div>
    </section>
  );
}

function MemberPredictionPreview({ matchId }: { matchId: string }) {
  const { data, loading, error } = useLoad(() => fetchFootballMemberPredictionPreview(matchId), [matchId]);

  if (loading) {
    return (
      <section className="panel prediction-preview-panel prediction-preview-loading">
        <p className="eyebrow">Ön tahmin</p>
        <h2>SkorIQ Tahmin Yorumu</h2>
        <p className="muted">Tahmin yorumu yükleniyor...</p>
      </section>
    );
  }

  if (error) {
    return <MemberPredictionPreviewErrorNotice />;
  }

  if (!data) return null;

  return <MemberPredictionPreviewSection data={data} />;
}

export function MemberPredictionPreviewSection({ data }: { data: FootballMemberPredictionPreviewResponse }) {
  const hasCandidates = countMemberPreviewItems(data.groups) > 0;
  const tiers = ["primary", "try", "alternative"] as const;

  return (
    <section className="panel prediction-preview-panel member-prediction-preview-panel">
      <div className="panel-header prediction-preview-header">
        <div>
          <h2>SkorIQ Tahmin Yorumu</h2>
        </div>
      </div>
      {data.status !== "available" ? (
        <section className="notice compact-notice">
          <strong>{memberPredictionPreviewStatusText(data)}</strong>
          {data.summary ? <span>{data.summary}</span> : null}
        </section>
      ) : null}
      {data.status === "available" && data.summary ? <p className="member-prediction-summary">{data.summary}</p> : null}
      {data.status === "available" && data.warnings.length > 0 ? (
        <div className="member-prediction-warnings" aria-label="Tahmin yorumu uyarıları">
          {data.warnings.map((warning) => (
            <span key={warning}>{warning}</span>
          ))}
        </div>
      ) : null}
      {data.status === "available" ? (
        <div className="prediction-preview-grid member-prediction-preview-grid">
          {tiers.map((tier) => (
            <MemberPredictionPreviewGroup key={tier} tier={tier} items={data.groups[tier] ?? []} />
          ))}
        </div>
      ) : null}
      {data.status === "available" && !hasCandidates ? <p className="muted member-prediction-empty">Bu maç için yayınlanabilir tahmin önizlemesi henüz yok.</p> : null}
      <div className="arena-prediction-footnote">
        <p className="muted">Bu bölüm mevcut veri kapsamına göre üretilen ön tahminleri gösterir. Nihai sonuç garantisi değildir.</p>
        <p className="muted">Tahminler minimum güvenli süre korunarak maç başlayana kadar gösterilebilir.</p>
      </div>
    </section>
  );
}

export function MemberPredictionPreviewErrorNotice() {
  return (
    <section className="notice prediction-preview-warning">
      <strong>Tahmin yorumu yüklenemedi.</strong>
      <span>Ana maç analizi etkilenmedi. Lütfen daha sonra tekrar dene.</span>
    </section>
  );
}

function memberPredictionPreviewStatusText(data: FootballMemberPredictionPreviewResponse) {
  if (data.status === "stale") return data.message || "Tahminler yenilenmeli.";
  if (data.status === "closed") return data.message || "Maç başladı; aktif tahmin önizlemesi kapandı.";
  if (data.status === "not_ready") return data.message || "Veri kapsamı tahmin üretmek için yeterli değil.";
  if (data.reasonCode === "too_early") return data.message || "Tahmin üretimi bekliyor.";
  if (data.reasonCode === "pending_generation") return data.message || "Tahmin üretimi bekliyor.";
  if (data.reasonCode === "too_late") return data.message || "Maç başladı; aktif tahmin önizlemesi kapandı.";
  if (data.status === "not_available") return data.message || "Bu maç için yayınlanabilir tahmin önizlemesi henüz yok.";
  return data.message;
}

function MemberPredictionPreviewGroup({
  tier,
  items
}: {
  tier: "primary" | "try" | "alternative";
  items: FootballMemberPredictionPreviewResponse["groups"]["primary"];
}) {
  return (
    <section className={`prediction-preview-group member-prediction-preview-group prediction-preview-${tier}`}>
      <div className="prediction-preview-group-title">
        <h3>{tierLabel(tier)}</h3>
        <span className="badge badge-muted">Ön tahmin</span>
      </div>
      <div className="prediction-preview-cards">
        {items.length === 0 ? <p className="muted prediction-preview-empty">Bu grupta aday yok.</p> : null}
        {items.map((item) => (
          <MemberPredictionPreviewCard key={item.predictionId} item={item} />
        ))}
      </div>
    </section>
  );
}

function MemberPredictionPreviewCard({ item }: { item: FootballMemberPredictionPreviewResponse["groups"]["primary"][number] }) {
  return (
    <article className="prediction-preview-card member-prediction-preview-card">
      <div className="prediction-preview-card-main">
        <strong>{predictionMarketLabel(item.predictionType, item.predictionValue)}</strong>
        {item.displayLabel && item.displayLabel !== predictionMarketLabel(item.predictionType, item.predictionValue) ? <span>{item.displayLabel}</span> : null}
      </div>
      <div className="prediction-preview-meta">
        <span>Ön tahmin</span>
        <span>{tierLabel(item.recommendationTier)}</span>
        <span>Güven skoru: {formatScore(item.confidenceScore)}</span>
        <span>Risk seviyesi: {riskLevelLabel(item.riskLevel)}</span>
      </div>
      {item.reasoningSummary ? <p>{formatDraftReasoning(item.reasoningSummary)}</p> : null}
    </article>
  );
}

export function PredictionPreviewErrorNotice() {
  return (
    <section className="notice prediction-preview-warning">
      <strong>Tahmin önizlemesi alınamadı.</strong>
      <span>Ana maç analizi etkilenmedi. Taslaklar yalnızca iç denetim amacıyla okunur.</span>
    </section>
  );
}

export function PredictionPreviewSection({
  data,
  matchId,
  navigate
}: {
  data: FootballMatchPredictionDraftsResponse;
  matchId: string;
  navigate: (path: string) => void;
}) {
  return (
    <section className="panel prediction-preview-panel">
      <div className="panel-header prediction-preview-header">
        <div>
          <p className="eyebrow">İç denetim</p>
          <h2>Tahmin Önizleme</h2>
          <p className="muted">Bu alan iç denetim amaçlıdır. Tahminler henüz üyelere veya public alana yayınlanmamıştır.</p>
        </div>
        <div className="prediction-preview-actions">
          <div className="prediction-safety-badges" aria-label="Tahmin güvenlik durumu">
            <span className="badge badge-muted">Taslak</span>
            <span className="badge badge-muted">Üyelere görünür değil</span>
            <span className="badge badge-muted">Public değil</span>
          </div>
          <button type="button" onClick={() => navigate(`/football/matches/${matchId}/prediction-drafts`)}>
            Tüm taslakları gör
          </button>
        </div>
      </div>
      <div className="prediction-preview-grid">
        {(["primary", "try", "alternative", "avoid"] as const).map((tier) => (
          <PredictionPreviewGroup key={tier} tier={tier} items={data.outputsByRecommendationTier[tier]?.items ?? []} />
        ))}
      </div>
    </section>
  );
}

function PredictionPreviewGroup({ tier, items }: { tier: RecommendationTier; items: FootballPredictionDraftListItem[] }) {
  return (
    <section className={`prediction-preview-group prediction-preview-${tier}`}>
      <div className="prediction-preview-group-title">
        <h3>{tierLabel(tier)}</h3>
        <DraftBadge value={tier} kind="tier" />
      </div>
      {items.length === 0 ? <p className="muted">Bu grupta aday yok.</p> : null}
      <div className="prediction-preview-cards">
        {items.map((item) => (
          <PredictionPreviewCard key={item.predictionId} item={item} />
        ))}
      </div>
    </section>
  );
}

function PredictionPreviewCard({ item }: { item: FootballPredictionDraftListItem }) {
  const mappedLabel = predictionMarketLabel(item.predictionType, item.predictionValue);
  const displayLabel = item.displayLabel?.trim();
  return (
    <article className="prediction-preview-card">
      <div className="prediction-preview-card-main">
        <strong>{mappedLabel}</strong>
        {displayLabel && displayLabel !== mappedLabel ? <span>{displayLabel}</span> : null}
      </div>
      <div className="prediction-preview-meta">
        <span>Güven: {formatScore(item.confidenceScore)}</span>
        <span>Risk: {riskLevelLabel(item.riskLevel)}</span>
        <span>Tutarlılık: {draftStatusLabel(item.consistencyStatus)}</span>
        <span>Çakışma: {item.conflictCount}</span>
      </div>
      {item.reasoningSummary ? <p>{formatDraftReasoning(item.reasoningSummary)}</p> : null}
    </article>
  );
}

function predictionMarketLabel(type: string, value: string) {
  const key = `${type}=${value}`;
  const labels: Record<string, string> = {
    "match_result_1x2=1": "MS 1",
    "match_result_1x2=X": "MS X",
    "match_result_1x2=2": "MS 2",
    "double_chance=1X": "Çifte Şans 1X",
    "double_chance=X2": "Çifte Şans X2",
    "double_chance=12": "Çifte Şans 12",
    "over_under_goals=over_2_5": "MS 2.5 Üst",
    "over_under_goals=under_2_5": "MS 2.5 Alt",
    "first_half_over_0_5=over_0_5": "İY 0.5 Üst",
    "both_teams_to_score=yes": "KG Var",
    "both_teams_to_score=no": "KG Yok"
  };
  return labels[key] ?? `${type} ${value}`;
}

function formatScore(value: number | null) {
  if (value === null) return "Yok";
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function riskLevelLabel(value: string) {
  const normalized = value.toLowerCase();
  if (normalized === "low") return "Düşük";
  if (normalized === "medium") return "Orta";
  if (normalized === "high") return "Yüksek";
  return value;
}

function formatDraftReasoning(value: string) {
  if (looksLikeRawEnglish(value)) return "Sistem bu aday için iç inceleme gerekçesi üretti.";
  return value;
}

function PredictionReviewSummaryCard({ matchId, navigate }: { matchId: string; navigate: (path: string) => void }) {
  const { data, loading, error } = usePredictionReviewSummary(matchId);

  if (loading) {
    return <StatePanel title="Tahmin inceleme durumu yükleniyor..." />;
  }

  if (error) {
    return (
      <section className="notice review-warning">
        <strong>Tahmin inceleme durumu yüklenemedi.</strong>
        <span>Ana maç analizi etkilenmedi. Draft veya settlement review API yanıtı geçici olarak alınamadı.</span>
      </section>
    );
  }

  if (!data) return null;

  const hasReviewData = data.draftCount > 0 || data.settlementCount > 0;

  return (
    <section className="panel review-summary-card">
      <div className="panel-header">
        <div>
          <p className="eyebrow">İç denetim</p>
          <h2>Tahmin İnceleme Durumu</h2>
        </div>
        <span className="badge badge-muted">Salt okunur</span>
      </div>
      <section className="notice compact-notice">
        <strong>Bu alan yalnızca iç denetim içindir.</strong>
        <span>Tahminler üyeye veya public alana otomatik yayınlanmaz. Uzak Dur / blocked adaylar gerçekleşse bile öneri sayılmaz.</span>
      </section>
      {!hasReviewData ? <p className="muted">Bu maç için henüz taslak tahmin veya settlement sonucu yok.</p> : null}
      <div className="metric-grid review-summary-grid">
        <MetricCard title="Draft tahmin sayısı" value={data.draftCount} />
        <MetricCard title="Settlement sonucu sayısı" value={data.settlementCount} />
        <MetricCard title="Başarılı settlement" value={data.successCount} />
        <MetricCard title="Başarısız settlement" value={data.failedCount} />
        <MetricCard title="Void" value={data.voidCount} />
        <MetricCard title="Audit-only" value={data.auditOnlyCount} />
        <MetricCard title="Member-visible" value={data.memberVisibleCount > 0 ? "Evet" : "Hayır"} />
        <MetricCard title="Public published" value={data.publicPublishedCount > 0 ? "Evet" : "Hayır"} />
      </div>
      <div className="button-row">
        <button type="button" onClick={() => navigate(`/football/matches/${matchId}/prediction-drafts`)}>
          Draft tahminleri gör
        </button>
        <button type="button" onClick={() => navigate(`/football/matches/${matchId}/prediction-settlements`)}>
          Tahmin sonuçlarını gör
        </button>
      </div>
    </section>
  );
}

interface PredictionReviewSummary {
  draftCount: number;
  settlementCount: number;
  successCount: number;
  failedCount: number;
  voidCount: number;
  auditOnlyCount: number;
  memberVisibleCount: number;
  publicPublishedCount: number;
}

function usePredictionReviewSummary(matchId: string) {
  const [data, setData] = useState<PredictionReviewSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.allSettled([fetchFootballMatchPredictionDrafts(matchId), fetchFootballMatchPredictionSettlements(matchId)])
      .then(([draftResult, settlementResult]) => {
        if (cancelled) return;
        if (draftResult.status === "rejected" || settlementResult.status === "rejected") {
          setData(null);
          setError("Tahmin inceleme verisi alınamadı.");
          return;
        }
        const draftCount = countTieredItems(draftResult.value.outputsByRecommendationTier);
        const settlementCount = countTieredItems(settlementResult.value.outputsByRecommendationTier);
        setData({
          draftCount: Math.max(draftCount, settlementCount),
          settlementCount,
          successCount: settlementResult.value.settlementSummary.success,
          failedCount: settlementResult.value.settlementSummary.failed,
          voidCount: settlementResult.value.settlementSummary.void,
          auditOnlyCount: settlementResult.value.settlementSummary.auditOnly,
          memberVisibleCount: settlementResult.value.settlementSummary.memberVisible,
          publicPublishedCount: settlementResult.value.settlementSummary.publicPublished
        });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [matchId]);

  return { data, loading, error };
}

function countTieredItems<T>(groups: Record<RecommendationTier, { items: T[] }>) {
  return (["primary", "try", "alternative", "avoid"] as const).reduce((total, tier) => total + (groups[tier]?.items.length ?? 0), 0);
}

function countMemberPreviewItems(groups: FootballMemberPredictionPreviewResponse["groups"]) {
  return (["primary", "try", "alternative"] as const).reduce((total, tier) => total + (groups[tier]?.length ?? 0), 0);
}

function TeamListPage({ navigate }: { navigate: (path: string) => void }) {
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<TeamDirectoryFilter>("all");
  const [selectedCompetition, setSelectedCompetition] = useState<string>("all");
  const [selectedCountry, setSelectedCountry] = useState<string>("all");
  const [selectedLetter, setSelectedLetter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"name" | "matches" | "coverage">("name");
  const [pageSize, setPageSize] = useState<number | "all">(50);
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Fetch all teams (up to 500 covers all 308 teams in DB)
  const { data, loading, error } = useLoad(() => fetchFootballTeams({ limit: 500 }), []);
  const { data: compsData } = useLoad(() => fetchFootballCompetitions({ limit: 100 }), []);
  const competitions = useMemo(() => compsData?.items ?? [], [compsData]);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [search, activeFilter, selectedCompetition, selectedCountry, selectedLetter, sortBy, pageSize]);

  const allTeams = useMemo(() => data?.items ?? [], [data]);
  const teamStats = useMemo(() => (data ? getTeamDirectoryStats(data.items) : null), [data]);

  // Available countries
  const countries = useMemo(() => {
    const map = new Map<string, number>();
    for (const team of allTeams) {
      if (team.country) {
        map.set(team.country, (map.get(team.country) ?? 0) + 1);
      }
    }
    return Array.from(map.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [allTeams]);

  // Alphabet jump list & counts
  const alphabetLetters = [
    "A", "B", "C", "Ç", "D", "E", "F", "G", "H", "I", "İ", "J",
    "K", "L", "M", "N", "O", "Ö", "P", "R", "S", "Ş", "T", "U", "Ü", "V", "Y", "Z"
  ];
  const letterCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const team of allTeams) {
      const firstChar = team.name.trim().charAt(0).toLocaleUpperCase("tr-TR");
      counts.set(firstChar, (counts.get(firstChar) ?? 0) + 1);
    }
    return counts;
  }, [allTeams]);

  // Multi-dimensional filtering
  const filteredTeams = useMemo(() => {
    let list = allTeams;

    if (selectedCompetition !== "all") {
      list = list.filter((t) => t.competitions.some((c) => c.competitionId === selectedCompetition));
    }
    if (selectedCountry !== "all") {
      list = list.filter((t) => t.country === selectedCountry);
    }
    if (selectedLetter !== "all") {
      list = list.filter((t) => t.name.trim().toLocaleUpperCase("tr-TR").startsWith(selectedLetter));
    }
    if (search.trim()) {
      const q = search.trim().toLocaleLowerCase("tr-TR");
      list = list.filter(
        (t) =>
          t.name.toLocaleLowerCase("tr-TR").includes(q) ||
          (t.shortName && t.shortName.toLocaleLowerCase("tr-TR").includes(q)) ||
          (t.country && t.country.toLocaleLowerCase("tr-TR").includes(q)) ||
          t.competitions.some((c) => c.name.toLocaleLowerCase("tr-TR").includes(q))
      );
    }
    list = list.filter((team) => matchesTeamDirectoryFilter(team, activeFilter));

    return [...list].sort((a, b) => {
      if (sortBy === "matches") return b.matchesCount - a.matchesCount;
      if (sortBy === "coverage") return (b.latestFormCoverage ?? 0) - (a.latestFormCoverage ?? 0);
      return a.name.localeCompare(b.name, "tr");
    });
  }, [allTeams, selectedCompetition, selectedCountry, selectedLetter, search, activeFilter, sortBy]);

  // Pagination calculations
  const totalItems = filteredTeams.length;
  const effectivePageSize = pageSize === "all" ? Math.max(1, totalItems) : pageSize;
  const totalPages = Math.max(1, Math.ceil(totalItems / effectivePageSize));
  const safePage = Math.min(Math.max(1, currentPage), totalPages);
  const pagedTeams = useMemo(() => {
    if (pageSize === "all") return filteredTeams;
    const start = (safePage - 1) * effectivePageSize;
    return filteredTeams.slice(start, start + effectivePageSize);
  }, [filteredTeams, safePage, effectivePageSize, pageSize]);

  // Numeric page buttons (up to 7 visible buttons around current page)
  const pageNumbers = useMemo(() => {
    const pages: number[] = [];
    const maxVisible = 7;
    let start = Math.max(1, safePage - Math.floor(maxVisible / 2));
    const end = Math.min(totalPages, start + maxVisible - 1);
    if (end - start + 1 < maxVisible) {
      start = Math.max(1, end - maxVisible + 1);
    }
    for (let i = start; i <= end; i++) {
      pages.push(i);
    }
    return pages;
  }, [safePage, totalPages]);

  return (
    <>
      <header className="hero teams-header">
        <div>
          <h1>Takımlar</h1>
          <p>Tüm liglerdeki takımları, logoları ve analiz kapsamlarını incele.</p>
        </div>
        {teamStats ? (
          <div className="teams-summary-grid" aria-label="Takım özet metrikleri">
            <TeamSummaryStat label="Toplam takım" value={teamStats.totalTeams} />
            <TeamSummaryStat label="Logolu takım" value={teamStats.teamsWithLogos} />
            <TeamSummaryStat label="Ortalama form kapsamı" value={formatPercent(teamStats.averageFormCoverage)} />
            <TeamSummaryStat label="Maç verisi olan takım" value={teamStats.teamsWithMatches} />
          </div>
        ) : null}
      </header>

      <section className="teams-toolbar" aria-label="Takım arama ve filtreleri">
        <div className="teams-toolbar-controls">
          <div className="teams-search-wrap">
            <span className="search-icon" aria-hidden="true"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg></span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Takım, lig veya ülke ara..."
              aria-label="Takım ara"
            />
            {search ? (
              <button
                type="button"
                className="teams-search-clear"
                onClick={() => setSearch("")}
                aria-label="Aramayı temizle"
              >
                ✕
              </button>
            ) : null}
          </div>

          {/* League Dropdown Filter */}
          <select
            className="team-filter-select"
            value={selectedCompetition}
            onChange={(e) => setSelectedCompetition(e.target.value)}
            aria-label="Lig filtresi"
          >
            <option value="all">Tüm Ligler ({competitions.length || 16})</option>
            {competitions.map((comp) => (
              <option key={comp.competitionId} value={comp.competitionId}>
                {comp.name} ({comp.teamsCount})
              </option>
            ))}
          </select>

          {/* Sort By Dropdown */}
          <select
            className="team-filter-select"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            aria-label="Sıralama ölçütü"
          >
            <option value="name">İsim (A-Z)</option>
            <option value="matches">En Çok Maç</option>
            <option value="coverage">Form Kapsamı</option>
          </select>

          {/* Page Size Dropdown */}
          <select
            className="team-filter-select"
            value={String(pageSize)}
            onChange={(e) => setPageSize(e.target.value === "all" ? "all" : Number(e.target.value))}
            aria-label="Sayfa boyutu"
          >
            <option value="50">50 / Sayfa</option>
            <option value="100">100 / Sayfa</option>
            <option value="all">Tümü ({totalItems})</option>
          </select>
        </div>

        {/* Quality Filter Chips */}
        <div className="team-filter-chips" aria-label="Takım filtreleri">
          <TeamFilterChip label="Tümü" value="all" activeFilter={activeFilter} setActiveFilter={setActiveFilter} />
          <TeamFilterChip label="Logolu takımlar" value="logos" activeFilter={activeFilter} setActiveFilter={setActiveFilter} />
          <TeamFilterChip label="Maç verisi olanlar" value="matches" activeFilter={activeFilter} setActiveFilter={setActiveFilter} />
          <TeamFilterChip label="Yüksek kapsam" value="highCoverage" activeFilter={activeFilter} setActiveFilter={setActiveFilter} />
        </div>

        {/* Country Quick Filter Chips */}
        {countries.length > 0 ? (
          <div className="team-country-chips" role="group" aria-label="Ülke filtreleri">
            <button
              type="button"
              className={`country-chip ${selectedCountry === "all" ? "active" : ""}`}
              onClick={() => setSelectedCountry("all")}
            >
              Tüm Ülkeler ({allTeams.length})
            </button>
            {countries.map((c) => (
              <button
                type="button"
                key={c.name}
                className={`country-chip ${selectedCountry === c.name ? "active" : ""}`}
                onClick={() => setSelectedCountry(c.name)}
              >
                {c.name} ({c.count})
              </button>
            ))}
          </div>
        ) : null}

        {/* Alphabet Quick Jump Ribbon */}
        <div className="alphabet-ribbon" aria-label="Harfe göre filtrele">
          <span className="alphabet-ribbon-label">Alfabe:</span>
          <button
            type="button"
            className={`alphabet-letter-btn ${selectedLetter === "all" ? "active" : ""}`}
            onClick={() => setSelectedLetter("all")}
          >
            Tümü
          </button>
          {alphabetLetters.map((letter) => {
            const count = letterCounts.get(letter) ?? 0;
            const isActive = selectedLetter === letter;
            return (
              <button
                type="button"
                key={letter}
                className={`alphabet-letter-btn ${isActive ? "active" : ""}`}
                onClick={() => setSelectedLetter(isActive ? "all" : letter)}
                disabled={count === 0}
                title={`${letter}: ${count} takım`}
              >
                {letter}
              </button>
            );
          })}
        </div>
      </section>

      {loading ? <StatePanel title="Takımlar yükleniyor..." /> : null}
      {error ? <StatePanel title="Takımlar yüklenemedi" body={error} /> : null}
      {!loading && !error && data && filteredTeams.length === 0 ? <StatePanel title="Takım bulunamadı" /> : null}

      {!loading && !error && data && filteredTeams.length > 0 ? (
        <section className="panel team-directory-panel">
          <div className="panel-header">
            <h2>Futbol Takımları</h2>
            <span className="muted">
              {pageSize === "all"
                ? `Toplam ${totalItems} takım listeleniyor`
                : `Toplam ${totalItems} takımdan ${(safePage - 1) * effectivePageSize + 1} - ${Math.min(safePage * effectivePageSize, totalItems)} gösteriliyor (Sayfa ${safePage} / ${totalPages})`}
            </span>
          </div>
          <div className="team-directory-grid">
            {pagedTeams.map((team) => (
              <TeamDirectoryCard key={team.teamId} team={team} navigate={navigate} />
            ))}
          </div>

          {/* Pagination Controls */}
          {totalPages > 1 && pageSize !== "all" ? (
            <div className="team-pagination-bar" aria-label="Takım sayfalama">
              <div className="team-pagination-info">
                Sayfa <strong>{safePage}</strong> / <strong>{totalPages}</strong> (Toplam <strong>{totalItems}</strong> takım)
              </div>
              <div className="team-pagination-nav">
                <button
                  type="button"
                  className="team-page-btn"
                  onClick={() => setCurrentPage(1)}
                  disabled={safePage === 1}
                  aria-label="İlk sayfa"
                >
                  « İlk
                </button>
                <button
                  type="button"
                  className="team-page-btn"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={safePage === 1}
                  aria-label="Önceki sayfa"
                >
                  ‹ Önceki
                </button>
                {pageNumbers.map((p) => (
                  <button
                    type="button"
                    key={p}
                    className={`team-page-btn ${safePage === p ? "active" : ""}`}
                    onClick={() => setCurrentPage(p)}
                    aria-current={safePage === p ? "page" : undefined}
                  >
                    {p}
                  </button>
                ))}
                <button
                  type="button"
                  className="team-page-btn"
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={safePage === totalPages}
                  aria-label="Sonraki sayfa"
                >
                  Sonraki ›
                </button>
                <button
                  type="button"
                  className="team-page-btn"
                  onClick={() => setCurrentPage(totalPages)}
                  disabled={safePage === totalPages}
                  aria-label="Son sayfa"
                >
                  Son »
                </button>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}
    </>
  );
}

function TeamSummaryStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="teams-summary-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function TeamFilterChip({
  label,
  value,
  activeFilter,
  setActiveFilter
}: {
  label: string;
  value: TeamDirectoryFilter;
  activeFilter: TeamDirectoryFilter;
  setActiveFilter: (value: TeamDirectoryFilter) => void;
}) {
  const active = activeFilter === value;
  return (
    <button className={`team-filter-chip${active ? " active" : ""}`} type="button" aria-pressed={active} onClick={() => setActiveFilter(value)}>
      {label}
    </button>
  );
}

function TeamDirectoryCard({ team, navigate }: { team: FootballTeamListItem; navigate: (path: string) => void }) {
  const destination = `/football/teams/${team.teamId}`;
  const primaryCompetition = team.competitions[0]?.name;
  const openTeam = () => navigate(destination);
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openTeam();
    }
  };

  return (
    <article className="team-card" role="button" tabIndex={0} aria-label={`${team.name} detaylarını aç`} onClick={openTeam} onKeyDown={handleKeyDown}>
      <div className="team-card-main">
        <div className="team-card-logo">
          <TeamLogo name={team.name} logoUrl={team.logoUrl} size="lg" />
        </div>
        <div className="team-card-body">
          <div>
            <h3>{team.name}</h3>
            <div className="team-card-meta">
              {primaryCompetition ? <span>{primaryCompetition}</span> : null}
              {team.country ? <span>{team.country}</span> : null}
            </div>
          </div>
        </div>
      </div>
      <div className="team-card-stats" aria-label={`${team.name} analiz metrikleri`}>
        <span>
          <strong>{team.matchesCount}</strong>
          Maç
        </span>
        <span>
          <strong>{team.latestFormCoverage === null ? "—" : formatPercent(team.latestFormCoverage)}</strong>
          Form verisi
        </span>
      </div>
      <div className="team-card-footer">
        <div className="team-card-coverage" aria-hidden="true">
          <ProgressBar value={team.latestFormCoverage ?? 0} />
        </div>
      </div>
      <span className="team-card-action" aria-hidden="true">↗</span>
    </article>
  );
}

function getTeamDirectoryStats(teams: FootballTeamListItem[]) {
  const coverageValues = teams.map((team) => team.latestFormCoverage).filter((value): value is number => value !== null);
  const averageFormCoverage = coverageValues.length > 0 ? coverageValues.reduce((total, value) => total + value, 0) / coverageValues.length : null;

  return {
    totalTeams: teams.length,
    teamsWithLogos: teams.filter((team) => team.hasLogo).length,
    averageFormCoverage,
    teamsWithMatches: teams.filter((team) => team.matchesCount > 0).length
  };
}

function matchesTeamDirectoryFilter(team: FootballTeamListItem, activeFilter: TeamDirectoryFilter) {
  if (activeFilter === "logos") return team.hasLogo;
  if (activeFilter === "matches") return team.matchesCount > 0;
  if (activeFilter === "highCoverage") return (team.latestFormCoverage ?? 0) >= 70;
  return true;
}

function PlayerDetailPage({ playerId, navigate }: { playerId: string; navigate: (path: string) => void }) {
  const { data: profile, loading, error } = useLoad(() => fetchFootballPlayerProfile(playerId), [playerId]);

  return (
    <div className="player-detail-shell">
      {loading ? <StatePanel title="Oyuncu profili yükleniyor..." /> : null}
      {error ? <StatePanel title="Oyuncu profili yüklenemedi" body={error} /> : null}
      {!loading && !error && !profile ? <StatePanel title="Oyuncu bulunamadı" /> : null}
      {profile ? (
        <>
          <div className="explorer-breadcrumbs">
            <button type="button" onClick={() => navigate("/football")}>Futbol Keşfi</button>
            <span className="breadcrumb-sep">/</span>
            <button type="button" onClick={() => navigate("/football/teams")}>Takımlar</button>
            {profile.player.team ? (
              <>
                <span className="breadcrumb-sep">/</span>
                <button type="button" onClick={() => navigate(`/football/teams/${profile.player.team!.id}`)}>
                  {profile.player.team.name}
                </button>
              </>
            ) : null}
            <span className="breadcrumb-sep">/</span>
            <span className="breadcrumb-current">{profile.player.name}</span>
          </div>

          <section className="panel player-profile-hero">
            <div className="player-avatar" aria-hidden="true">
              {profile.player.photoUrl ? (
                <img src={profile.player.photoUrl} alt="" />
              ) : (
                profile.player.name.trim().charAt(0).toUpperCase()
              )}
            </div>
            <div className="player-profile-copy">
              {profile.player.team ? (
                <button type="button" className="player-team-link" onClick={() => navigate(`/football/teams/${profile.player.team!.id}`)}>
                  {profile.player.team.name}
                </button>
              ) : <p className="eyebrow">Serbest oyuncu</p>}
              <h1>{profile.player.name}</h1>
              <p className="muted">
                {[profile.player.position, profile.player.shirtNumber ? `#${profile.player.shirtNumber}` : null]
                  .filter(Boolean)
                  .join(" · ") || "Pozisyon bilgisi yok"}
              </p>
            </div>
            <div className="player-summary-grid">
              <div className="player-summary-card"><span>Maç</span><strong>{profile.summary.appearances}</strong></div>
              <div className="player-summary-card"><span>İlk 11</span><strong>{profile.summary.starts}</strong></div>
              <div className="player-summary-card"><span>Yedek</span><strong>{profile.summary.substitutes}</strong></div>
              <div className="player-summary-card"><span>Ort. Puan</span><strong>{profile.summary.averageRating !== null ? profile.summary.averageRating.toFixed(1) : "—"}</strong></div>
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <div>
                <h2>Son Kadro Kayıtları</h2>
              </div>
              {profile.recentMatches.length > 0 ? <span className="badge badge-muted">{profile.recentMatches.length} Maç</span> : null}
            </div>
            {profile.recentMatches.length === 0 ? (
              <p className="muted">Bu oyuncu için henüz kadro kaydı yok.</p>
            ) : (
              <div className="recent-matches-list">
                {profile.recentMatches.map((match) => (
                  <button
                    className="recent-match-row player-match-row"
                    type="button"
                    key={`${match.matchId}-${match.role}`}
                    onClick={() => navigate(`/football/analytics/${match.matchId}`)}
                  >
                    <div className="recent-match-date">
                      <strong>{formatDate(match.kickoffAt)}</strong>
                      <span className="muted">{match.competition.name}</span>
                    </div>
                    <div className="recent-match-opponent">
                      <div>
                        <strong>{match.homeTeam.name} - {match.awayTeam.name}</strong>
                        <span className="muted">
                          {match.role === "starting" ? "İlk 11" : match.role === "substitute" ? "Yedek" : match.role}
                          {match.position ? ` · ${match.position}` : ""}
                          {match.shirtNumber !== null ? ` · #${match.shirtNumber}` : ""}
                        </span>
                      </div>
                    </div>
                    <span className={`player-match-rating ${match.rating !== null ? "has-rating" : ""}`}>
                      {match.rating !== null ? match.rating.toFixed(1) : "—"}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}

function TeamDetailPage({ teamId, navigate }: { teamId: string; navigate: (path: string) => void }) {
  const { data: profile, loading, error } = useLoad(() => fetchFootballTeamProfile(teamId), [teamId]);
  const { data: players } = useLoad(() => fetchFootballTeamPlayers(teamId), [teamId]);
  const { data: availability } = useLoad(() => fetchFootballTeamAvailability(teamId), [teamId]);
  const [activeTab, setActiveTab] = useState<"overview" | "form" | "matches" | "squad">("overview");

  return (
    <div className="team-detail-shell">
      {loading ? <StatePanel title="Takım profili yükleniyor..." /> : null}
      {error ? <StatePanel title="Takım profili yüklenemedi" body={error} /> : null}
      {!loading && !error && !profile ? <StatePanel title="Takım bulunamadı" /> : null}
      {profile ? (
        <>
          <div className="explorer-breadcrumbs">
            <button type="button" onClick={() => navigate("/football")}>Futbol Keşfi</button>
            <span className="breadcrumb-sep">/</span>
            <button type="button" onClick={() => navigate("/football/teams")}>Takımlar</button>
            {(() => {
              const pc = profile.team.primaryCompetition;
              if (!pc) return null;
              return (
                <>
                  <span className="breadcrumb-sep">/</span>
                  <button type="button" onClick={() => navigate(`/football/competitions/${pc.id}`)}>
                    {pc.name}
                  </button>
                </>
              );
            })()}
            <span className="breadcrumb-sep">/</span>
            <span className="breadcrumb-current">{profile.team.name}</span>
          </div>

          <TeamProfileHero profile={profile} standing={profile.standing} navigate={navigate} />

          <SectionTabs idPrefix="team-profile" label="Takım Sekmeleri" value={activeTab} onChange={setActiveTab} className="team-nav-tabs" buttonClassName="team-nav-tab" items={[
            { id: "overview", label: "Genel Bakış", icon: "overview" },
            { id: "form", label: "Form & Goller", icon: "form" },
            { id: "matches", label: "Maçlar", icon: "calendar", count: (profile.upcomingMatches?.length ?? 0) + (profile.recentMatches?.length ?? 0) },
            { id: "squad", label: "Kadro", icon: "team", count: players?.items?.length }
          ]} />

          <div className="team-tab-viewport arena-tab-panel" id="team-profile-panel" role="tabpanel" aria-labelledby={`team-profile-${activeTab}-tab`} tabIndex={0}>
            {activeTab === "overview" ? (
              <div className="team-profile-grid">
                <TeamProfileStanding standing={profile.standing} />
                <TeamSeasonTelemetrySection seasonStatistics={profile.team.seasonStatistics} />
                <TeamFormTrendChart profile={profile} navigate={navigate} />
              </div>
            ) : null}

            {activeTab === "form" ? (
              <div className="team-profile-grid">
                <TeamProfileFormSummary formSummary={profile.formSummary} />
                <TeamProfileGoalProfile goalProfile={profile.goalProfile} />
                <TeamProfileDataCoverage coverage={profile.dataCoverage} />
              </div>
            ) : null}

            {activeTab === "matches" ? (
              <div className="team-profile-grid">
                <TeamProfileUpcomingMatches matches={profile.upcomingMatches} navigate={navigate} />
                <TeamProfileRecentMatches matches={profile.recentMatches} navigate={navigate} />
              </div>
            ) : null}

            {activeTab === "squad" ? (
              <div className="team-profile-grid">
                <TeamSquadSection players={players?.items ?? []} />
                <TeamProfileAvailability items={availability?.items ?? profile.playerAvailability ?? []} />
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

export function TeamProfileStanding({ standing }: { standing: FootballTeamProfileResponse["standing"] }) {
  if (!standing) return null;
  const stats = [
    { label: "Oynanan", value: standing.played },
    { label: "Galibiyet", value: standing.wins },
    { label: "Beraberlik", value: standing.draws },
    { label: "Mağlubiyet", value: standing.losses },
    { label: "Atılan", value: standing.goalsFor },
    { label: "Yenen", value: standing.goalsAgainst },
    { label: "Averaj", value: standing.goalDifference },
    { label: "Puan", value: standing.points }
  ];
  return (
    <section className="panel team-profile-standing">
      <div className="standing-stats">
        {stats.map((s) => (
          <div className="standing-stat" key={s.label}>
            <span>{s.label}</span>
            <strong>{s.value}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

export function TeamSeasonTelemetrySection({ seasonStatistics }: { seasonStatistics?: Record<string, unknown> | null }) {
  if (!seasonStatistics || Object.keys(seasonStatistics).length === 0) {
    return null;
  }

  const s = seasonStatistics;
  const value = (key: string) => formatSeasonMetric(seasonMetricValue(s, [key]));
  const metric = (label: string, totalKeys: string[], perGameLabel: string, perGameKeys: string[]) => seasonSingleMetric(s, label, totalKeys, perGameLabel, perGameKeys);
  const shots = metric("Toplam Şut", ["shots", "shotsTotal"], "Şut / maç", ["shotsPerGame"]);
  const onTarget = metric("İsabetli", ["shotsOnTarget"], "İsabetli / maç", ["shotsOnTargetPerGame"]);
  const chances = metric("Büyük Şanslar", ["bigChances"], "Büyük Şans / maç", ["bigChancesPerGame"]);
  const missed = metric("Kaçan", ["bigChancesMissed"], "Kaçan / maç", ["bigChancesMissedPerGame"]);
  const yellow = metric("Sarı Kart (toplam)", ["yellowCards"], "Sarı Kart / maç", ["yellowCardsPerGame"]);
  const fouls = metric("Faul", ["fouls"], "Faul / maç", ["foulsPerGame"]);
  const percent = (key: string) => {
    const number = seasonMetricValue(s, [key]);
    return number === null ? "—" : `%${Math.round(number)}`;
  };
  const expectedGoals = seasonMetricValue(s, ["expectedGoals"]);
  const stats = [
    { label: "Gol / xG", value: `${value("goalsScored")} / ${expectedGoals === null ? "—" : expectedGoals.toFixed(1)}`, sub: "Atılan Gol / xG" },
    { label: "Yenilen Gol", value: value("goalsConceded"), sub: "Kalede Görülen" },
    { label: "Topa Sahip Olma", value: percent("averageBallPossession"), sub: "Ortalama" },
    { label: "Gol Yemeden (CS)", value: value("cleanSheets"), sub: "Temiz Sayfa" },
    { label: "Pas İsabeti", value: percent("accuratePassesPercentage"), sub: "Başarılı Pas" },
    { label: chances.label, value: formatSeasonMetric(chances.value), sub: `${missed.label}: ${formatSeasonMetric(missed.value)}` },
    { label: shots.label, value: formatSeasonMetric(shots.value), sub: `${onTarget.label}: ${formatSeasonMetric(onTarget.value)}` },
    { label: yellow.label, value: formatSeasonMetric(yellow.value), sub: "Sarı Kart" },
    { label: "Kırmızı Kart (toplam)", value: value("redCards"), sub: "Kırmızı Kart" },
    { label: fouls.label, value: formatSeasonMetric(fouls.value), sub: "Faul" }
  ] as const;

  return (
    <section className="panel team-season-telemetry">
      <div className="section-header">
        <div>
          <h2>Sezon İstatistikleri</h2>
        </div>
      </div>
      <div className="standing-stats season-telemetry-grid">
        {[
          { title: "Gol & şut", featured: stats[0], items: [stats[1], stats[5], stats[6]] },
          { title: "Oyun kontrolü", featured: stats[2], items: [stats[4], stats[3]] },
          { title: "Disiplin", featured: null, items: [stats[7], stats[8], stats[9]] }
        ].map((group) => (
          <div className="season-stat-group" key={group.title}>
            <h3>{group.title}</h3>
            {group.featured ? <div className="standing-stat season-stat-featured">
              <span>{group.featured.label}</span>
              <strong>{group.featured.value}</strong>
              <small className="muted">{group.featured.sub}</small>
            </div> : null}
            <div className="season-stat-lines">
              {group.items.map((item) => <div className="standing-stat" key={item.label}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
                <small className="muted">{item.sub}</small>
              </div>)}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function TeamProfileHero({
  profile,
  standing,
  navigate
}: {
  profile: FootballTeamProfileResponse;
  standing: FootballTeamProfileResponse["standing"];
  navigate?: (path: string) => void;
}) {
  const team = profile.team;
  const recent = profile.recentMatches || [];
  const overall = profile.formSummary?.overall;

  return (
    <header className="hero detail-hero team-profile-hero">
      <div className="entity-title team-hero-entity">
        <TeamLogo name={team.name} logoUrl={team.logoUrl} size="lg" />
        <div className="team-hero-info">
          <div className="team-hero-eyebrow-row">
            {team.primaryCompetition ? (
              <button
                type="button"
                className="team-hero-comp-pill"
                onClick={() => navigate?.(`/football/competitions/${team.primaryCompetition!.id}`)}
              >
                <span>{team.primaryCompetition.name}</span>
              </button>
            ) : null}
            {team.country ? (
              <span className="team-hero-country-pill">{team.country}</span>
            ) : (
              <span className="muted">Ülke bilgisi yok</span>
            )}
          </div>
          <h1 className="team-hero-name">{team.name}</h1>
          {recent.length > 0 ? (
            <div className="team-hero-quick-strip">
              <span className="quick-label">Son Seri:</span>
              <div className="team-hero-streak-pills">
                {recent.slice(0, 5).map((m) => {
                  const res = m.result ?? "D";
                  const resClass = res === "W" ? "streak-win" : res === "L" ? "streak-loss" : "streak-draw";
                  const resLabel = res === "W" ? "G" : res === "L" ? "M" : "B";
                  return (
                    <span
                      key={m.matchId}
                      className={`streak-dot ${resClass}`}
                      title={`${m.opponent.name} (${m.homeAway === "home" ? "İç" : "Dış"}) ${m.fulltimeScore || ""}`}
                    >
                      {resLabel}
                    </span>
                  );
                })}
              </div>
              {overall?.avgGoalsFor !== null && overall?.avgGoalsFor !== undefined ? (
                <span className="quick-metric">
                  <small className="muted">Gol Ort:</small> <strong>{overall.avgGoalsFor.toFixed(2)}</strong>
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      {standing ? (
        <div className="team-hero-badges">
          <span className="team-hero-stat">
            <strong>{standing.position}</strong>
            <span>Sıra</span>
          </span>
          <span className="team-hero-stat">
            <strong>{standing.points}</strong>
            <span>Puan</span>
          </span>
        </div>
      ) : null}
    </header>
  );
}

export function TeamProfileFormSummary({ formSummary }: { formSummary: FootballTeamProfileResponse["formSummary"] }) {
  const cards: Array<{ label: string; data: FootballTeamProfileFormSummary | null }> = [
    { label: "Genel form", data: formSummary.overall },
    { label: "İç saha", data: formSummary.home },
    { label: "Deplasman", data: formSummary.away }
  ];

  return (
    <section className="panel">
      <h2>Form Özeti</h2>
      <div className="form-summary-grid">
        {cards.map((card) => (
          <div className="form-summary-card" key={card.label}>
            <h3>{card.label}</h3>
            {card.data ? (
              <div className="form-summary-body">
                <div className="form-summary-row">
                  <span>Örneklem</span>
                  <strong>{card.data.sampleSize}</strong>
                </div>
                <div className="form-summary-row">
                  <span>Kapsam</span>
                  <strong>{formatPercent(card.data.coverageScore)}</strong>
                </div>
                <div className="form-summary-row">
                  <span>Puan</span>
                  <strong>{card.data.points}</strong>
                </div>
                <div className="form-summary-row">
                  <span>Ortalama gol</span>
                  <strong>{card.data.avgGoalsFor !== null ? card.data.avgGoalsFor.toFixed(2) : "—"}</strong>
                </div>
                <div className="form-summary-row">
                  <span>Yenen gol</span>
                  <strong>{card.data.avgGoalsAgainst !== null ? card.data.avgGoalsAgainst.toFixed(2) : "—"}</strong>
                </div>
                {card.data.bothTeamsToScoreRate !== null ? (
                  <div className="form-summary-row">
                    <span>KG oranı</span>
                    <strong>{formatRatePercent(card.data.bothTeamsToScoreRate)}</strong>
                  </div>
                ) : null}
                {card.data.over25Rate !== null ? (
                  <div className="form-summary-row">
                    <span>2.5 üst</span>
                    <strong>{formatRatePercent(card.data.over25Rate)}</strong>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="muted">Form verisi bulunmuyor.</p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

export function TeamProfileGoalProfile({ goalProfile }: { goalProfile: FootballTeamProfileResponse["goalProfile"] }) {
  const fields: Array<{ label: string; value: number | null; asPercent?: boolean }> = [
    { label: "Gol bulma oranı", value: goalProfile.scoredRate, asPercent: true },
    { label: "Gol yeme oranı", value: goalProfile.concededRate, asPercent: true },
    { label: "Takım 0.5 üst", value: goalProfile.teamOver05Rate, asPercent: true },
    { label: "Takım 1.5 üst", value: goalProfile.teamOver15Rate, asPercent: true },
    { label: "2.5 alt eğilimi", value: goalProfile.under25Rate, asPercent: true },
    { label: "İlk yarı 0.5 üst", value: goalProfile.firstHalfOver05Rate, asPercent: true },
    { label: "İlk yarı atılan gol", value: goalProfile.firstHalfAvgGoalsFor, asPercent: false },
    { label: "İlk yarı yenilen gol", value: goalProfile.firstHalfAvgGoalsAgainst, asPercent: false }
  ];

  const hasAnyValue = fields.some((f) => f.value !== null);

  return (
    <section className="panel">
      <h2>Gol Profili</h2>
      {!hasAnyValue ? <p className="muted">Gol profili verisi bulunmuyor.</p> : null}
      <div className="goal-profile-compact-grid">
        {fields.map((field) =>
          field.value !== null ? (
            <div className="goal-profile-compact-item" key={field.label}>
              <span>{field.label}</span>
              <strong>{field.asPercent ? formatRatePercent(field.value) : formatDecimal(field.value)}</strong>
            </div>
          ) : null
        )}
      </div>
    </section>
  );
}

export function TeamProfileRecentMatches({
  matches,
  navigate
}: {
  matches: FootballTeamProfileRecentMatch[];
  navigate?: (path: string) => void;
}) {
  return (
    <section className="panel team-matches-panel">
      <h2>Son Maçlar</h2>
      {matches.length === 0 ? <p className="muted">Son maç kaydı bulunmuyor.</p> : null}
      <div className="recent-matches-list">
        {matches.map((match) => (
          <article className="recent-match-row" key={match.matchId}>
            <span className={`recent-match-corner result-${match.result?.toLowerCase() ?? "unknown"}`}>
              {match.result === "W" ? "Galibiyet" : match.result === "D" ? "Beraberlik" : match.result === "L" ? "Mağlubiyet" : "—"}
            </span>
            <div className="recent-match-opponent">
              <TeamLogo name={match.opponent.name} logoUrl={match.opponent.logoUrl} size="sm" />
              <div>
                <strong>{match.opponent.name}</strong>
                <span className="muted">{match.competition} · {formatDate(match.date)}</span>
              </div>
            </div>
            <div className="recent-match-meta">
              <span className="recent-match-homeaway">{match.homeAway === "home" ? "İç saha" : "Deplasman"}</span>
              {match.fulltimeScore ? <span className="recent-match-score tabular-num">{match.fulltimeScore}</span> : null}
              {match.halftimeScore ? <span className="recent-match-halftime tabular-num">İY {match.halftimeScore}</span> : null}
              {navigate ? (
                <button
                  type="button"
                  className="upcoming-match-link"
                  onClick={() => navigate(`/football/analytics/${match.matchId}`)}
                >
                  Analiz
                </button>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export function TeamProfileUpcomingMatches({ matches, navigate }: { matches: FootballTeamProfileUpcomingMatch[]; navigate: (path: string) => void }) {
  return (
    <section className="panel">
      <h2>Yaklaşan Maçlar</h2>
      {matches.length === 0 ? <p className="muted">Yaklaşan maç bulunmuyor.</p> : null}
      <div className="upcoming-matches-list">
        {matches.map((match) => (
          <article className="upcoming-match-row" key={match.matchId}>
            <div className="upcoming-match-opponent">
              <TeamLogo name={match.opponent.name} logoUrl={match.opponent.logoUrl} size="sm" />
              <div>
                <strong>{match.opponent.name}</strong>
                <span className="muted">{match.competition} · {formatDateTime(match.date)}</span>
              </div>
            </div>
            <div className="upcoming-match-meta">
              <span className="upcoming-match-homeaway">{match.homeAway === "home" ? "İç saha" : "Deplasman"}</span>
              <span className="pill">{match.status}</span>
              {match.analysisStatus ? <span className={`badge badge-${match.analysisStatus === "ready" ? "good" : match.analysisStatus === "partial" ? "warn" : "muted"}`}>{statusLabel(match.analysisStatus as FeatureStatus)}</span> : null}
              <button
                className="upcoming-match-link"
                type="button"
                onClick={() => navigate(`/football/analytics/${match.matchId}`)}
              >
                Analiz
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export function TeamFormTrendChart({
  profile,
  navigate
}: {
  profile: FootballTeamProfileResponse;
  navigate?: (path: string) => void;
}) {
  const matches = profile.recentMatches || [];
  const formSummary = profile.formSummary;

  if (matches.length === 0 && !formSummary?.overall) {
    return null;
  }

  const chronological = [...matches].reverse();
  const overall = formSummary?.overall;
  const home = formSummary?.home;
  const away = formSummary?.away;

  let rollingPts = 0;
  const trendPoints = chronological.map((m) => {
    const pts = m.result === "W" ? 3 : m.result === "D" ? 1 : 0;
    rollingPts += pts;
    return {
      match: m,
      pts,
      rollingPts
    };
  });

  const svgWidth = 600;
  const svgHeight = 160;
  const paddingX = 35;
  const paddingY = 25;
  const chartW = svgWidth - paddingX * 2;
  const chartH = svgHeight - paddingY * 2;

  const maxPoints = Math.max(1, ...trendPoints.map((p) => p.rollingPts));
  const pointsCoords = trendPoints.map((p, idx) => {
    const x = trendPoints.length > 1 ? paddingX + (idx / (trendPoints.length - 1)) * chartW : svgWidth / 2;
    const y = svgHeight - paddingY - (p.rollingPts / maxPoints) * chartH;
    return { x, y, ...p };
  });

  let pathD = "";
  if (pointsCoords.length > 0 && pointsCoords[0]) {
    pathD = `M ${pointsCoords[0].x} ${pointsCoords[0].y}`;
    for (let i = 1; i < pointsCoords.length; i++) {
      const prev = pointsCoords[i - 1];
      const curr = pointsCoords[i];
      if (prev && curr) {
        const midX = (prev.x + curr.x) / 2;
        pathD += ` C ${midX} ${prev.y}, ${midX} ${curr.y}, ${curr.x} ${curr.y}`;
      }
    }
  }

  const firstPt = pointsCoords[0];
  const lastPt = pointsCoords[pointsCoords.length - 1];
  const areaD = pointsCoords.length > 0 && firstPt && lastPt
    ? `${pathD} L ${lastPt.x} ${svgHeight - paddingY} L ${firstPt.x} ${svgHeight - paddingY} Z`
    : "";

  return (
    <section className="panel team-form-analytics-panel">
      <div className="section-header">
        <div>
          <h2>Takım Formu & Momentum Trendi</h2>
        </div>
        {overall ? (
          <div className="form-streak-badge">
            <span>Son {overall.matchesPlayed} Maç: </span>
            <strong className="text-emerald">{overall.wins}G</strong>
            <strong className="text-muted">{overall.draws}B</strong>
            <strong className="text-rose">{overall.losses}M</strong>
            <span className="pill pill-cyan">{overall.points} Puan</span>
          </div>
        ) : null}
      </div>

      <div className="form-results-strip">
        {matches.map((m) => {
          const res = m.result ?? "D";
          const resClass = res === "W" ? "res-win" : res === "L" ? "res-loss" : "res-draw";
          const resLabel = res === "W" ? "G" : res === "L" ? "M" : "B";
          return (
            <div
              className={`form-result-node ${resClass} ${navigate ? "form-result-clickable" : ""}`}
              key={m.matchId}
              onClick={() => navigate?.(`/football/analytics/${m.matchId}`)}
              onKeyDown={(event) => {
                if (navigate && (event.key === "Enter" || event.key === " ")) {
                  event.preventDefault();
                  navigate(`/football/analytics/${m.matchId}`);
                }
              }}
              role={navigate ? "button" : undefined}
              tabIndex={navigate ? 0 : undefined}
            >
              <div className="form-result-pill" title={`${m.opponent.name} (${m.homeAway === "home" ? "İç" : "Dış"}) ${m.fulltimeScore || ""}`}>
                {resLabel}
              </div>
              <div className="form-result-details">
                <TeamLogo name={m.opponent.name} logoUrl={m.opponent.logoUrl} size="sm" />
                <span className="form-opponent-name">{m.opponent.name}</span>
                <span className="form-score">{m.fulltimeScore ?? "—"}</span>
                <span className="form-venue">{m.homeAway === "home" ? "İç" : "Dış"}</span>
              </div>
            </div>
          );
        })}
      </div>

      {trendPoints.length > 1 ? (
        <div className="form-chart-wrapper">
          <div className="form-chart-header">
            <span>Kümülatif Puan Momentumu</span>
            <small className="muted">Zaman Çizelgesi ({trendPoints.length} Karşılaşma)</small>
          </div>
          <svg className="form-momentum-svg" viewBox={`0 0 ${svgWidth} ${svgHeight}`} preserveAspectRatio="none">
            <defs>
              <linearGradient id="formMomentumGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#facc15" stopOpacity="0.4" />
                <stop offset="100%" stopColor="#facc15" stopOpacity="0.0" />
              </linearGradient>
            </defs>
            <line x1={paddingX} y1={paddingY} x2={svgWidth - paddingX} y2={paddingY} stroke="rgba(28,24,12,0.06)" strokeDasharray="3 3" />
            <line x1={paddingX} y1={svgHeight / 2} x2={svgWidth - paddingX} y2={svgHeight / 2} stroke="rgba(28,24,12,0.06)" strokeDasharray="3 3" />
            <line x1={paddingX} y1={svgHeight - paddingY} x2={svgWidth - paddingX} y2={svgHeight - paddingY} stroke="rgba(28,24,12,0.12)" />

            <path d={areaD} fill="url(#formMomentumGrad)" />
            <path d={pathD} fill="none" stroke="#facc15" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />

            {pointsCoords.map((pt, idx) => {
              const color = pt.match.result === "W" ? "#18794E" : pt.match.result === "L" ? "#C13B30" : "#5C5A52";
              return (
                <g
                  key={idx}
                  style={navigate ? { cursor: "pointer" } : undefined}
                  onClick={() => navigate?.(`/football/analytics/${pt.match.matchId}`)}
                >
                  <circle cx={pt.x} cy={pt.y} r="5" fill="#ffffff" stroke={color} strokeWidth="2.5" />
                  <circle cx={pt.x} cy={pt.y} r="2" fill={color} />
                  <title>{`${pt.match.opponent.name} (${pt.match.homeAway === "home" ? "İç" : "Dış"}) ${pt.match.fulltimeScore || ""}`}</title>
                </g>
              );
            })}
          </svg>
        </div>
      ) : null}

      {home && away ? (
        <div className="home-away-split-matrix">
          <h3>İç Saha vs Dış Saha Form Ayrımı</h3>
          <div className="split-grid">
            <SplitMetricRow
              label="Galibiyet Oranı"
              homeVal={home.matchesPlayed > 0 ? (home.wins / home.matchesPlayed) * 100 : 0}
              awayVal={away.matchesPlayed > 0 ? (away.wins / away.matchesPlayed) * 100 : 0}
              unit="%"
            />
            <SplitMetricRow
              label="Maç Başına Gol"
              homeVal={home.avgGoalsFor ?? 0}
              awayVal={away.avgGoalsFor ?? 0}
              unit=""
            />
            <SplitMetricRow
              label="Kalesini Kapatma (CS)"
              homeVal={home.concededRate !== null ? Math.max(0, 100 - home.concededRate) : 0}
              awayVal={away.concededRate !== null ? Math.max(0, 100 - away.concededRate) : 0}
              unit="%"
            />
            <SplitMetricRow
              label="2.5 Üst Oranı"
              homeVal={home.over25Rate ?? 0}
              awayVal={away.over25Rate ?? 0}
              unit="%"
            />
            <SplitMetricRow
              label="Karşılıklı Gol (KG)"
              homeVal={home.bothTeamsToScoreRate ?? 0}
              awayVal={away.bothTeamsToScoreRate ?? 0}
              unit="%"
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}

function SplitMetricRow({ label, homeVal, awayVal, unit }: { label: string; homeVal: number; awayVal: number; unit: string }) {
  const total = (homeVal + awayVal) || 1;
  const homePercent = Math.round((homeVal / total) * 100);
  const awayPercent = 100 - homePercent;

  return (
    <div className="split-metric-row">
      <div className="split-metric-label">
        <span>{label}</span>
      </div>
      <div className="split-metric-comparison">
        <div className="split-val split-val-home">
          <strong>{typeof homeVal === "number" ? homeVal.toFixed(unit ? 0 : 2) : "—"}{unit}</strong>
          <small>İç Saha</small>
        </div>
        <div className="split-dual-bar">
          <div className="split-bar-fill home-fill" style={{ width: `${homePercent}%` }} />
          <div className="split-bar-fill away-fill" style={{ width: `${awayPercent}%` }} />
        </div>
        <div className="split-val split-val-away">
          <strong>{typeof awayVal === "number" ? awayVal.toFixed(unit ? 0 : 2) : "—"}{unit}</strong>
          <small>Dış Saha</small>
        </div>
      </div>
    </div>
  );
}

export function TeamSquadSection({ players }: { players: FootballTeamPlayersResponse["items"] }) {
  const [selectedPos, setSelectedPos] = useState<string>("ALL");

  if (!players || players.length === 0) {
    return (
      <section className="panel">
        <h2>Takım Kadrosu</h2>
        <p className="muted">Kadro verisi bulunmuyor.</p>
      </section>
    );
  }

  const posMap: Record<string, string> = {
    G: "Kaleci",
    D: "Defans",
    M: "Orta Saha",
    F: "Forvet"
  };

  const filtered = selectedPos === "ALL"
    ? players
    : players.filter((p) => p.position === selectedPos);

  const counts = {
    ALL: players.length,
    G: players.filter((p) => p.position === "G").length,
    D: players.filter((p) => p.position === "D").length,
    M: players.filter((p) => p.position === "M").length,
    F: players.filter((p) => p.position === "F").length
  };

  return (
    <section className="panel team-squad-panel">
      <div className="section-header">
        <div>
          <h2>Takım Kadrosu</h2>
        </div>
        <span className="live-telemetry-badge">{players.length} Futbolcu</span>
      </div>

      <div className="squad-filter-tabs">
        <button
          type="button"
          className={`squad-tab-btn ${selectedPos === "ALL" ? "active" : ""}`}
          onClick={() => setSelectedPos("ALL")}
        >
          Tümü ({counts.ALL})
        </button>
        <button
          type="button"
          className={`squad-tab-btn ${selectedPos === "G" ? "active" : ""}`}
          onClick={() => setSelectedPos("G")}
        >
          Kaleciler ({counts.G})
        </button>
        <button
          type="button"
          className={`squad-tab-btn ${selectedPos === "D" ? "active" : ""}`}
          onClick={() => setSelectedPos("D")}
        >
          Defans ({counts.D})
        </button>
        <button
          type="button"
          className={`squad-tab-btn ${selectedPos === "M" ? "active" : ""}`}
          onClick={() => setSelectedPos("M")}
        >
          Orta Saha ({counts.M})
        </button>
        <button
          type="button"
          className={`squad-tab-btn ${selectedPos === "F" ? "active" : ""}`}
          onClick={() => setSelectedPos("F")}
        >
          Forvet ({counts.F})
        </button>
      </div>

      <div className="squad-grid">
        {filtered.map((player) => {
          const initials = player.name
            .split(" ")
            .map((n) => n[0])
            .slice(0, 2)
            .join("")
            .toUpperCase();
          const posLabel = player.position ? posMap[player.position] || player.position : "Bilinmiyor";

          return (
            <article className="squad-player-card" key={player.playerId}>
              <div className="squad-player-avatar-wrap">
                {player.photoUrl ? (
                  <img
                    className="squad-player-avatar"
                    src={player.photoUrl}
                    alt={player.name}
                    loading="lazy"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = "none";
                    }}
                  />
                ) : null}
                <div className="squad-player-initials">{initials}</div>
                {player.shirtNumber !== null ? (
                  <span className="squad-jersey-badge">#{player.shirtNumber}</span>
                ) : null}
              </div>
              <div className="squad-player-info">
                <strong>{player.name}</strong>
                <span className={`squad-pos-tag pos-${player.position?.toLowerCase() || "unknown"}`}>
                  {posLabel}
                </span>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function TeamProfilePlayers({ players }: { players: FootballTeamPlayersResponse["items"] }) {
  return <TeamSquadSection players={players} />;
}

export function TeamProfileAvailability({ items }: { items: FootballTeamProfileResponse["playerAvailability"] }) {
  return (
    <section className="panel">
      <h2>Oyuncu Durumu</h2>
      {items.length === 0 ? <p className="muted">Oyuncu durumu verisi henüz yok.</p> : null}
      <div className="recent-matches-list">
        {items.map((item) => (
          <article className="recent-match-row" key={`${item.playerId}-${item.status}-${item.reason ?? ""}`}>
            <div className="recent-match-opponent">
              <div>
                <strong>{item.playerName}</strong>
                <span className="muted">
                  {mapAvailabilityStatusLabel(item.status)}
                  {item.reason ? ` · ${item.reason}` : ""}
                  {item.expectedReturnDate ? ` · Dönüş ${formatDate(item.expectedReturnDate)}` : ""}
                </span>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export function TeamProfileDataCoverage({ coverage }: { coverage: FootballTeamProfileResponse["dataCoverage"] }) {
  const items: Array<{ label: string; available: boolean; count?: number; soonMessage?: string }> = [
    { label: "Maç verisi", available: coverage.matchesAvailable > 0, count: coverage.matchesAvailable },
    { label: "Skor verisi", available: coverage.scoresAvailable > 0, count: coverage.scoresAvailable },
    { label: "Puan durumu", available: coverage.hasStanding },
    { label: "Form kapsamı", available: coverage.formCoverageScore !== null && coverage.formCoverageScore > 0 },
    { label: "Logo", available: coverage.hasLogo },
    { label: "Oyuncu verisi", available: coverage.playersAvailable },
    { label: "Kadro verisi", available: coverage.lineupsAvailable },
    { label: "Sakatlık verisi", available: coverage.injuriesAvailable }
  ];

  return (
    <section className="panel">
      <h2>Veri Durumu</h2>
      <div className="data-coverage-grid">
        {items.map((item) => (
          <div className="data-coverage-item" key={item.label}>
            <span>{item.label}</span>
            {item.available ? (
              <span className="badge badge-good">Mevcut{item.count !== undefined ? ` (${item.count})` : ""}</span>
            ) : item.soonMessage ? (
              <span className="badge badge-muted">{item.soonMessage}</span>
            ) : (
              <span className="badge badge-muted">Veri yok</span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function CompetitionListPage({ navigate }: { navigate: (path: string) => void }) {
  const { data, loading, error } = useLoad(() => fetchFootballCompetitions({ limit: 100 }), []);
  const [search, setSearch] = useState("");
  const [countryFilter, setCountryFilter] = useState("all");
  const [sortBy, setSortBy] = useState<"matches" | "teams" | "name" | "coverage">("matches");

  const items = data?.items ?? [];

  const countries = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of items) {
      if (item.country) {
        map.set(item.country, (map.get(item.country) ?? 0) + 1);
      }
    }
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));
  }, [items]);

  const filteredItems = useMemo(() => {
    let list = items;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          (c.country && c.country.toLowerCase().includes(q))
      );
    }
    if (countryFilter !== "all") {
      list = list.filter((c) => c.country === countryFilter);
    }
    return [...list].sort((a, b) => {
      if (sortBy === "matches") return b.matchesCount - a.matchesCount;
      if (sortBy === "teams") return b.teamsCount - a.teamsCount;
      if (sortBy === "coverage") return (b.averageCoverage ?? 0) - (a.averageCoverage ?? 0);
      return a.name.localeCompare(b.name, "tr");
    });
  }, [items, search, countryFilter, sortBy]);

  const totals = useMemo(() => {
    return {
      competitions: items.length,
      teams: items.reduce((sum, c) => sum + c.teamsCount, 0),
      matches: items.reduce((sum, c) => sum + c.matchesCount, 0),
      readyMatches: items.reduce((sum, c) => sum + c.readyMatchesCount, 0)
    };
  }, [items]);

  return (
    <div className="competitions-shell">
      <header className="hero competitions-hero">
        <div>
          <h1>Ligler & Turnuvalar</h1>
          <p>Normalize futbol verisinden doğrulanmış lig kapsamı, puan durumları ve analiz hazırlık özetleri.</p>
        </div>
      </header>

      {loading ? <StatePanel title="Ligler yükleniyor..." /> : null}
      {error ? <StatePanel title="Ligler yüklenemedi" body={error} /> : null}
      {!loading && !error && data?.items.length === 0 ? <StatePanel title="Futbol ligi bulunamadı" /> : null}

      {!loading && !error && data ? (
        <>
          {/* Global Statistics Strip */}
          <section className="explorer-global-stats competitions-stats-strip" aria-label="Global lig istatistikleri">
            <div className="explorer-stat-item">
              <span className="explorer-stat-value">{totals.competitions}</span>
              <span className="explorer-stat-label">Lig / Kupa</span>
            </div>
            <div className="explorer-stat-divider" />
            <div className="explorer-stat-item">
              <span className="explorer-stat-value">{totals.teams.toLocaleString("tr-TR")}</span>
              <span className="explorer-stat-label">Takım</span>
            </div>
            <div className="explorer-stat-divider" />
            <div className="explorer-stat-item">
              <span className="explorer-stat-value">{totals.matches.toLocaleString("tr-TR")}</span>
              <span className="explorer-stat-label">Toplam Maç</span>
            </div>
            <div className="explorer-stat-divider" />
            <div className="explorer-stat-item">
              <span className="explorer-stat-value">{totals.readyMatches.toLocaleString("tr-TR")}</span>
              <span className="explorer-stat-label">Analize Hazır</span>
            </div>
          </section>

          {/* Filter Bar */}
          <section className="competition-filter-bar">
            <div className="competition-search-wrap">
              <span className="search-icon" aria-hidden="true">🔍</span>
              <input
                type="text"
                className="competition-search-input"
                placeholder="Lig veya ülke ara..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Lig ara"
              />
              {search ? (
                <button type="button" className="search-clear-btn" onClick={() => setSearch("")} aria-label="Aramayı temizle">
                  ✕
                </button>
              ) : null}
            </div>

            <div className="competition-sort-wrap">
              <label htmlFor="comp-sort-select">Sırala:</label>
              <select
                id="comp-sort-select"
                className="competition-sort-select"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              >
                <option value="matches">En Çok Maç</option>
                <option value="teams">En Çok Takım</option>
                <option value="coverage">Veri Kapsamı</option>
                <option value="name">İsim (A-Z)</option>
              </select>
            </div>
          </section>

          {/* Country Filter Chips */}
          {countries.length > 0 ? (
            <div className="competition-country-chips" role="group" aria-label="Ülke filtreleri">
              <button
                type="button"
                className={`country-chip ${countryFilter === "all" ? "active" : ""}`}
                onClick={() => setCountryFilter("all")}
              >
                Tümü ({items.length})
              </button>
              {countries.map((c) => (
                <button
                  type="button"
                  key={c.name}
                  className={`country-chip ${countryFilter === c.name ? "active" : ""}`}
                  onClick={() => setCountryFilter(c.name)}
                >
                  {c.name} ({c.count})
                </button>
              ))}
            </div>
          ) : null}

          {/* Bento Grid of Competitions */}
          {filteredItems.length === 0 ? (
            <section className="panel empty-competitions-panel">
              <p className="muted">Filtrelere uygun lig bulunamadı.</p>
            </section>
          ) : (
            <div className="competition-bento-grid">
              {filteredItems.map((competition) => {
                const openComp = () => navigate(`/football/competitions/${competition.competitionId}`);
                return (
                  <article
                    className="competition-bento-card"
                    key={competition.competitionId}
                    role="button"
                    tabIndex={0}
                    aria-label={`${competition.name} detaylarını aç`}
                    onClick={openComp}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openComp();
                      }
                    }}
                  >
                    <div className="comp-card-header">
                      <span className="comp-country-pill">
                        {competition.country ?? "Uluslararası"}
                      </span>
                      {competition.readyMatchesCount > 0 ? (
                        <span className="badge badge-ready">
                          {competition.readyMatchesCount} Hazır Maç
                        </span>
                      ) : (
                        <span className="badge badge-muted">Arşiv / Kapsam</span>
                      )}
                    </div>

                    <div className="comp-card-body">
                      <CompetitionLogo name={competition.name} logoUrl={competition.logoUrl} size="lg" />
                      <h3 className="comp-card-title">{competition.name}</h3>
                    </div>

                    <div className="comp-card-telemetry">
                      <div className="comp-telemetry-item">
                        <span className="comp-telemetry-val">{competition.teamsCount}</span>
                        <span className="comp-telemetry-lbl">Takım</span>
                      </div>
                      <div className="comp-telemetry-item">
                        <span className="comp-telemetry-val">{competition.matchesCount}</span>
                        <span className="comp-telemetry-lbl">Maç</span>
                      </div>
                      <div className="comp-telemetry-item">
                        <span className="comp-telemetry-val">
                          {competition.averageCoverage != null ? `${Math.round(competition.averageCoverage)}%` : "—"}
                        </span>
                        <span className="comp-telemetry-lbl">Kapsam</span>
                      </div>
                    </div>

                    <div className="comp-card-footer">
                      <span className="comp-view-link">Ligi İncele →</span>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

type CompetitionDetailTab = "standings" | "teams" | "upcoming" | "recent";

export function CompetitionDetailPage({ competitionId, navigate }: { competitionId: string; navigate: (path: string) => void }) {
  const { data: profile, loading, error } = useLoad(() => fetchFootballCompetitionProfile(competitionId), [competitionId]);
  const [activeTab, setActiveTab] = useState<CompetitionDetailTab>("standings");

  const statusLabel = (s: string) => {
    if (s === "ready") return "Hazır";
    if (s === "partial") return "Kısmi";
    if (s === "insufficient") return "Veri bekleniyor";
    return s;
  };

  const statusClass = (s: string) => {
    if (s === "ready") return "status-badge status-ready";
    if (s === "partial") return "status-badge status-partial";
    return "status-badge status-insufficient";
  };

  return (
    <>
      <button className="back-button" type="button" onClick={() => navigate(profile ? `/football/countries/${profile.competition.country.id}` : "/football")}>
        ← Geri
      </button>
      {loading ? <StatePanel title="Lig yükleniyor..." /> : null}
      {error ? <StatePanel title="Lig yüklenemedi" body={error} /> : null}
      {profile ? (
        <div className="competition-detail-shell">
          <header className="explorer-hero competition-detail-hero">
            <div className="explorer-hero-main">
              <div className="explorer-hero-logo">
                <CompetitionLogo name={profile.competition.name} logoUrl={profile.competition.logoUrl} size="xl" />
              </div>
              <div>
                <p className="explorer-hero-eyebrow">{profile.competition.country.name}</p>
                <h1>{profile.competition.name}</h1>
                <div className="explorer-hero-meta">
                  <span className={statusClass(profile.dataCoverage.dataStatus)}>{statusLabel(profile.dataCoverage.dataStatus)}</span>
                  {profile.dataCoverage.averageCoverage != null ? (
                    <span className="coverage-pill">Veri Kapsamı {Math.round(profile.dataCoverage.averageCoverage)}%</span>
                  ) : null}
                </div>
              </div>
            </div>
          </header>

          <section className="explorer-summary-cards">
            <div className="summary-card">
              <span className="summary-card-value">{profile.summary.teamCount}</span>
              <span className="summary-card-label">Takım</span>
            </div>
            <div className="summary-card">
              <span className="summary-card-value">{profile.summary.standingRows}</span>
              <span className="summary-card-label">Puan Durumu</span>
            </div>
            <div className="summary-card">
              <span className="summary-card-value">{profile.summary.finishedMatchCount}</span>
              <span className="summary-card-label">Son Maç</span>
            </div>
            <div className="summary-card">
              <span className="summary-card-value">{profile.summary.upcomingMatchCount}</span>
              <span className="summary-card-label">Yaklaşan Maç</span>
            </div>
            <div className="summary-card">
              <span className="summary-card-value">{profile.summary.predictionReadyUpcomingCount}</span>
              <span className="summary-card-label">Analiz Hazır</span>
            </div>
          </section>

          {/* Sub-Navigation Tabs */}
          <SectionTabs idPrefix="competition-details" label="Lig detay sekmeleri" value={activeTab} onChange={setActiveTab} className="match-center-tab-bar competition-tab-bar" items={[
            { id: "standings", label: "Puan Durumu", icon: "table", count: profile.standings.length },
            { id: "teams", label: "Takımlar", icon: "team", count: profile.teams.length },
            { id: "upcoming", label: "Fikstür", icon: "calendar", count: profile.upcomingMatches.length },
            { id: "recent", label: "Sonuçlar", icon: "chart", count: profile.recentMatches.length }
          ]} />
          <div className="arena-tab-panel" id="competition-details-panel" role="tabpanel" aria-labelledby={`competition-details-${activeTab}-tab`} tabIndex={0}>

          {/* Tab Content: Standings */}
          {activeTab === "standings" ? (
            profile.standings.length > 0 ? (
              <section className="explorer-panel standings-panel">
                <div className="explorer-panel-header">
                  <h2>Puan Durumu</h2>
                  <span className="arena-table-hint">Diğer istatistikler için yana kaydır →</span>
                </div>
                <div className="standings-table-wrap">
                  <table className="standings-table">
                    <thead>
                      <tr>
                        <th>Sıra</th>
                        <th>Takım</th>
                        <th>Puan</th>
                        <th>O</th>
                        <th>G</th>
                        <th>B</th>
                        <th>M</th>
                        <th>A</th>
                        <th>Y</th>
                        <th>Av</th>
                      </tr>
                    </thead>
                    <tbody>
                      {profile.standings.map((row) => {
                        const rowZoneClass = row.position === 1 ? "zone-leader" : "";
                        return (
                          <tr key={row.teamId} className={rowZoneClass}>
                            <td className="standings-pos-cell">
                              <span className="pos-indicator">{row.position}</span>
                            </td>
                            <td>
                              <button type="button" className="standings-team" onClick={() => navigate(`/football/teams/${row.teamId}`)}>
                                <TeamLogo name={row.teamName} logoUrl={row.logoUrl} size="sm" />
                                <span>{row.teamName}</span>
                              </button>
                            </td>
                            <td className="tabular-cell points-cell"><strong>{row.points}</strong></td>
                            <td className="tabular-cell">{row.played}</td>
                            <td className="tabular-cell">{row.wins}</td>
                            <td className="tabular-cell">{row.draws}</td>
                            <td className="tabular-cell">{row.losses}</td>
                            <td className="tabular-cell">{row.goalsFor}</td>
                            <td className="tabular-cell">{row.goalsAgainst}</td>
                            <td className={`tabular-cell ${row.goalDifference > 0 ? "gd-positive" : row.goalDifference < 0 ? "gd-negative" : ""}`}>
                              {row.goalDifference > 0 ? `+${row.goalDifference}` : row.goalDifference}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : (
              <section className="explorer-panel">
                <p className="empty-message">Puan durumu verisi bulunmuyor.</p>
              </section>
            )
          ) : null}

          {/* Tab Content: Teams */}
          {activeTab === "teams" ? (
            profile.teams.length > 0 ? (
              <section className="explorer-panel">
                <div className="explorer-panel-header">
                  <h2>Takımlar</h2>
                  <span className="muted">{profile.teams.length} takım listeleniyor</span>
                </div>
                <div className="explorer-team-grid">
                  {profile.teams.map((team) => (
                    <button type="button" className="explorer-team-card" key={team.teamId} onClick={() => navigate(`/football/teams/${team.teamId}`)}>
                      <TeamLogo name={team.name} logoUrl={team.logoUrl} size="md" />
                      <span className="explorer-team-name">{team.name}</span>
                      {team.latestFormCoverage != null ? (
                        <span className="coverage-pill">{Math.round(team.latestFormCoverage)}% form kapsamı</span>
                      ) : null}
                    </button>
                  ))}
                </div>
              </section>
            ) : (
              <section className="explorer-panel">
                <p className="empty-message">Takım verisi bulunmuyor.</p>
              </section>
            )
          ) : null}

          {/* Tab Content: Upcoming Matches */}
          {activeTab === "upcoming" ? (
            profile.upcomingMatches.length > 0 ? (
              <section className="explorer-panel">
                <div className="explorer-panel-header">
                  <h2>Yaklaşan Karşılaşmalar</h2>
                  <span className="muted">{profile.upcomingMatches.length} maç</span>
                </div>
                <div className="explorer-match-list">
                  {profile.upcomingMatches.map((match) => (
                    <div className="explorer-match-row" key={match.matchId}>
                      <div className="explorer-match-teams">
                        <span className="explorer-match-team">
                          <TeamLogo name={match.homeTeam.name} logoUrl={match.homeTeam.logoUrl} size="sm" />
                          {match.homeTeam.name}
                        </span>
                        <span className="explorer-match-vs">vs</span>
                        <span className="explorer-match-team">
                          <TeamLogo name={match.awayTeam.name} logoUrl={match.awayTeam.logoUrl} size="sm" />
                          {match.awayTeam.name}
                        </span>
                      </div>
                      <span className="explorer-match-kickoff">{formatDateTime(match.kickoffAt)}</span>
                      <button type="button" className="explorer-match-cta" onClick={() => navigate(`/football/analytics/${match.matchId}`)}>
                        Analizi Aç
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            ) : (
              <section className="explorer-panel">
                <p className="empty-message">Yaklaşan maç bulunmuyor.</p>
              </section>
            )
          ) : null}

          {/* Tab Content: Recent Matches */}
          {activeTab === "recent" ? (
            profile.recentMatches.length > 0 ? (
              <section className="explorer-panel">
                <div className="explorer-panel-header">
                  <h2>Son Karşılaşmalar</h2>
                  <span className="muted">{profile.recentMatches.length} maç</span>
                </div>
                <div className="explorer-match-list">
                  {profile.recentMatches.map((match) => (
                    <div className="explorer-match-row" key={match.matchId}>
                      <div className="explorer-match-teams">
                        <span className="explorer-match-team">
                          <TeamLogo name={match.homeTeam.name} logoUrl={match.homeTeam.logoUrl} size="sm" />
                          {match.homeTeam.name}
                        </span>
                        <span className="explorer-match-score">
                          {matchStatusLabel(match.status)}
                        </span>
                        <span className="explorer-match-team">
                          <TeamLogo name={match.awayTeam.name} logoUrl={match.awayTeam.logoUrl} size="sm" />
                          {match.awayTeam.name}
                        </span>
                      </div>
                      <span className="explorer-match-kickoff">{formatDate(match.kickoffAt)}</span>
                      <button type="button" className="explorer-match-cta" onClick={() => navigate(`/football/analytics/${match.matchId}`)}>
                        Maç detayı
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            ) : (
              <section className="explorer-panel">
                <p className="empty-message">Son maç verisi bulunmuyor.</p>
              </section>
            )
          ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

const initialDraftFilters: FootballPredictionDraftFilters = {
  consistencyStatus: "",
  recommendationTier: "",
  limit: 20,
  offset: 0
};

function DraftPredictionListPage({ navigate }: { navigate: (path: string) => void }) {
  const [filters, setFilters] = useState<FootballPredictionDraftFilters>(initialDraftFilters);
  const { data, loading, error } = useLoad(() => fetchFootballPredictionDrafts(filters), [filters]);

  return (
    <>
      <header className="hero">
        <div>
          <h1>Draft Tahminler</h1>
          <p>İç inceleme için taslak adaylar. Yayınlama, settlement veya tahmin kombini işlemi yapılmaz.</p>
        </div>
      </header>
      <section className="notice">
        <strong>Bu ekran salt okunurdur.</strong>
        <span>Taslak adaylar üyelere yayınlanmamıştır; public başarılı tahmin veya tahmin kombini değildir.</span>
      </section>
      <FilterDisclosure active={Boolean(filters.consistencyStatus || filters.recommendationTier || filters.matchId)}><DraftFilterBar filters={filters} setFilters={setFilters} /></FilterDisclosure>
      {loading ? <StatePanel title="Draft tahminler yükleniyor..." /> : null}
      {error ? <StatePanel title="Draft tahminler yüklenemedi" body={error} /> : null}
      {!loading && !error && data?.items.length === 0 ? <StatePanel title="Draft tahmin bulunamadı" /> : null}
      {!loading && !error && data ? <DraftPredictionList data={data} navigate={navigate} /> : null}
    </>
  );
}

function DraftFilterBar({
  filters,
  setFilters
}: {
  filters: FootballPredictionDraftFilters;
  setFilters: (filters: FootballPredictionDraftFilters) => void;
}) {
  const update = (patch: Partial<FootballPredictionDraftFilters>) => setFilters({ ...filters, ...patch });
  return (
    <section className="filters" aria-label="Draft tahmin filtreleri">
      <label>
        Tutarlılık
        <select value={filters.consistencyStatus} onChange={(event) => update({ consistencyStatus: event.target.value as FootballPredictionDraftFilters["consistencyStatus"] })}>
          <option value="">Tümü</option>
          <option value="warning">Uyarı</option>
          <option value="blocked">Bloke</option>
          <option value="passed">Geçti</option>
          <option value="unchecked">Kontrol edilmedi</option>
        </select>
      </label>
      <label>
        Seviye
        <select value={filters.recommendationTier} onChange={(event) => update({ recommendationTier: event.target.value as FootballPredictionDraftFilters["recommendationTier"] })}>
          <option value="">Tümü</option>
          <option value="primary">Tahminim</option>
          <option value="try">Denenir</option>
          <option value="alternative">Alternatif</option>
          <option value="avoid">Uzak Dur</option>
        </select>
      </label>
      <label>
        Maç ID
          <input value={filters.matchId ?? ""} onChange={(event) => update({ matchId: event.target.value.trim() || undefined })} placeholder="maç uuid" />
      </label>
      <label>
        Limit
        <select value={filters.limit} onChange={(event) => update({ limit: Number(event.target.value) })}>
          <option value={10}>10</option>
          <option value={20}>20</option>
          <option value={50}>50</option>
        </select>
      </label>
    </section>
  );
}

function DraftPredictionList({ data, navigate }: { data: FootballPredictionDraftsListResponse; navigate: (path: string) => void }) {
  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Taslak adaylar</h2>
        <span className="muted">
          {data.pagination.total} kayıttan {data.items.length} gösteriliyor
        </span>
      </div>
      <div className="draft-grid">
        {data.items.map((item) => (
          <DraftPredictionCard key={item.predictionId} item={item} navigate={navigate} />
        ))}
      </div>
    </section>
  );
}

function DraftPredictionDetailPage({ predictionId, navigate }: { predictionId: string; navigate: (path: string) => void }) {
  const { data, loading, error } = useLoad(() => fetchFootballPredictionDraft(predictionId), [predictionId]);

  return (
    <>
      <button className="back-button" type="button" onClick={() => navigate("/football/predictions/drafts")}>
        Draft listesine dön
      </button>
      {loading ? <StatePanel title="Draft detayı yükleniyor..." /> : null}
      {error ? <StatePanel title="Draft detayı yüklenemedi" body={error} /> : null}
      {data ? (
        <>
          <DraftDetailHeader draft={data} navigate={navigate} />
          <DraftGuardNotice />
          <div className="metric-grid">
            <MetricCard title="Güven skoru" value={data.confidenceScore ?? "Yok"} />
            <MetricCard title="Güven tavanı" value={data.confidenceCeiling ?? "Yok"} />
            <MetricCard title="Risk seviyesi" value={data.riskLevel} />
            <MetricCard title="Çakışmalar" value={data.conflictCount} />
          </div>
          <section className="panel">
            <h2>Gerekçe</h2>
            <p>{data.reasoningSummary ?? "Gerekçe özeti yok."}</p>
          </section>
          <ConflictsPanel conflicts={data.conflicts} />
          <JsonPanel title="Beklenti anlık görüntüsü" value={data.expectationSnapshot} />
          <JsonPanel title="Temizlenmiş metadata" value={data.metadata} />
        </>
      ) : null}
    </>
  );
}

function MatchPredictionDraftsPage({ matchId, navigate }: { matchId: string; navigate: (path: string) => void }) {
  const { data, loading, error } = useLoad(() => fetchFootballMatchPredictionDrafts(matchId), [matchId]);

  return (
    <>
      <button className="back-button" type="button" onClick={() => navigate("/football/predictions/drafts")}>
        Draft listesine dön
      </button>
      {loading ? <StatePanel title="Maç draftları yükleniyor..." /> : null}
      {error ? <StatePanel title="Maç draftları yüklenemedi" body={error} /> : null}
      {data ? (
        <>
          <header className="hero detail-hero">
            <div className="match-title">
              <TeamLogo name={data.match.homeTeam.name} logoUrl={data.match.homeTeam.logoUrl} size="lg" />
              <div>
                <p className="eyebrow">{data.match.competition.name}</p>
                <h1>
                  {data.match.homeTeam.name} <span>vs</span> {data.match.awayTeam.name}
                </h1>
                <p className="muted">{formatDateTime(data.match.kickoffAt)}</p>
              </div>
              <TeamLogo name={data.match.awayTeam.name} logoUrl={data.match.awayTeam.logoUrl} size="lg" />
            </div>
            <span className="badge badge-muted">Üyelere görünür değil</span>
          </header>
          <section className="notice">
            <strong>Bu ekran iç inceleme amaçlıdır. Kullanıcıya açık tahmin yayını değildir.</strong>
            <span>{data.note}</span>
          </section>
          <div className="metric-grid">
            <MetricCard title="Toplam çakışma" value={data.conflictsSummary.total} />
            <MetricCard title="Uyarı" value={data.conflictsSummary.warning} />
            <MetricCard title="Bloke" value={data.conflictsSummary.blocking} />
            <MetricCard title="Üyelere görünür" value={data.memberVisible ? "Evet" : "Hayır"} />
          </div>
          <DraftTierGroups data={data} navigate={navigate} />
        </>
      ) : null}
    </>
  );
}

function DraftDetailHeader({ draft, navigate }: { draft: FootballPredictionDraftDetail; navigate: (path: string) => void }) {
  return (
    <header className="hero detail-hero">
      <div>
        <p className="eyebrow">{draft.displayLabel ?? tierLabel(draft.recommendationTier)}</p>
        <h1>
          {draft.predictionType} <span>{draft.predictionValue}</span>
        </h1>
        <p className="muted">
          {draft.match.homeTeam.name} vs {draft.match.awayTeam.name} · {formatDateTime(draft.match.kickoffAt)}
        </p>
      </div>
      <div className="hero-actions">
        <DraftBadge value={draft.status} kind="status" />
        <DraftBadge value={draft.consistencyStatus} kind="consistency" />
        <button type="button" onClick={() => navigate(`/football/matches/${draft.matchId}/prediction-drafts`)}>
          Maç gruplarını aç
        </button>
      </div>
    </header>
  );
}

function DraftGuardNotice() {
  return (
    <section className="notice">
      <strong>Bu tahmin taslak durumundadır. Üyelere yayınlanmamıştır.</strong>
      <span>Settlement yapılmamıştır. Public başarılı tahmin değildir. Tahmin kombini için kullanılamaz.</span>
    </section>
  );
}

function DraftPredictionCard({ item, navigate }: { item: FootballPredictionDraftListItem; navigate: (path: string) => void }) {
  return (
    <article className="draft-card">
      <div className="draft-card-header">
        <div>
          <p className="eyebrow">{item.match.competition.name}</p>
          <h3>
            {item.match.homeTeam.name} vs {item.match.awayTeam.name}
          </h3>
          <p className="muted">{formatDateTime(item.match.kickoffAt)}</p>
        </div>
        <DraftBadge value={item.status} kind="status" />
      </div>
      <div className="draft-main">
        <strong>{item.displayLabel ?? tierLabel(item.recommendationTier)}</strong>
        <span>
          {item.predictionType} = {item.predictionValue}
        </span>
      </div>
      <div className="draft-meta">
        <DraftBadge value={item.recommendationTier ?? "unknown"} kind="tier" />
        <DraftBadge value={item.consistencyStatus} kind="consistency" />
        <span>Güven skoru {item.confidenceScore ?? "Yok"}</span>
        <span>Risk seviyesi {item.riskLevel}</span>
        <span>{item.conflictCount} çakışma</span>
          <span>Üyelere görünür değil</span>
      </div>
      <p>{item.reasoningSummary}</p>
      <div className="button-row">
        <button type="button" onClick={() => navigate(`/football/predictions/drafts/${item.predictionId}`)}>
          Detay
        </button>
        <button type="button" onClick={() => navigate(`/football/matches/${item.matchId}/prediction-drafts`)}>
          Maç grupları
        </button>
      </div>
    </article>
  );
}

function DraftTierGroups({ data, navigate }: { data: FootballMatchPredictionDraftsResponse; navigate: (path: string) => void }) {
  return (
    <div className="draft-tier-grid">
      {(["primary", "try", "alternative", "avoid"] as const).map((tier) => (
        <section className="panel" key={tier}>
          <div className="panel-header">
            <h2>{data.outputsByRecommendationTier[tier].label}</h2>
            <DraftBadge value={tier} kind="tier" />
          </div>
          {data.outputsByRecommendationTier[tier].items.length === 0 ? <p className="muted">Bu grupta aday yok.</p> : null}
          <div className="draft-grid">
            {data.outputsByRecommendationTier[tier].items.map((item) => (
              <DraftPredictionCard key={item.predictionId} item={item} navigate={navigate} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function ConflictsPanel({ conflicts }: { conflicts: FootballPredictionDraftDetail["conflicts"] }) {
  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Tutarlılık çakışmaları</h2>
        <span className="muted">{conflicts.length} kayıt</span>
      </div>
      {conflicts.length === 0 ? <p className="muted">Çakışma yok.</p> : null}
      <div className="table-list">
        {conflicts.map((conflict, index) => (
          <article className="compact-row conflict-row" key={`${conflict.conflictType}-${index}`}>
            <DraftBadge value={conflict.severity} kind="consistency" />
            <strong>{conflict.conflictType}</strong>
            <span>{conflict.sourcePredictionType ?? "kaynak yok"}</span>
            <span>{conflict.conflictingPredictionType ?? "doğrudan"}</span>
            <p>{conflict.reason}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function JsonPanel({ title, value }: { title: string; value: Record<string, unknown> | null }) {
  return (
    <section className="panel">
      <h2>{title}</h2>
      <pre className="json-box">{JSON.stringify(value ?? {}, null, 2)}</pre>
    </section>
  );
}

function DraftBadge({ value, kind }: { value: string; kind: "status" | "consistency" | "tier" }) {
  const className = kind === "tier" ? tierClass(value) : consistencyClass(value);
  return <span className={`badge ${className}`}>{kind === "tier" ? tierLabel(value) : draftStatusLabel(value)}</span>;
}

const initialSettlementFilters: FootballPredictionSettlementFilters = {
  settlementStatus: "",
  consistencyStatus: "",
  recommendationTier: "",
  auditOnly: "",
  limit: 20,
  offset: 0
};

const initialPredictionResultsFilters: FootballPredictionResultsFilters = {
  status: "",
  tier: "",
  marketType: "",
  limit: 50,
  offset: 0
};

export function PredictionResultsPage({ navigate }: { navigate: (path: string) => void }) {
  const [filters, setFilters] = useState<FootballPredictionResultsFilters>(initialPredictionResultsFilters);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedLeagues, setExpandedLeagues] = useState<Set<string>>(new Set());
  const [expandedMatches, setExpandedMatches] = useState<Set<string>>(new Set());
  const debouncedSearch = useDebounce(searchQuery, 300);

  const requestFilters = useMemo(() => ({ ...filters, search: debouncedSearch }), [filters, debouncedSearch]);
  const { data, loading, error } = useLoad(() => fetchFootballPredictionResults(requestFilters), [requestFilters]);
  const { data: summary } = useLoad(() => fetchFootballPredictionResultsSummary(requestFilters), [requestFilters]);

  const filteredItems = useMemo(() => {
    if (!data) return [];
    if (!debouncedSearch.trim()) return data.items;
    const query = debouncedSearch.toLowerCase().trim();
    return data.items.filter(item => {
      const home = item.match.homeTeam.name.toLowerCase();
      const away = item.match.awayTeam.name.toLowerCase();
      const competition = item.competition.name.toLowerCase();
      const country = item.country.name?.toLowerCase() ?? "";
      return home.includes(query) || away.includes(query) || competition.includes(query) || country.includes(query);
    });
  }, [data, debouncedSearch]);

  const groupedLeagues = useMemo(() => groupResultsByLeague(filteredItems), [filteredItems]);
  const notSettleableCount = useMemo(
    () => filteredItems.filter(item => ["not_settleable", "missing_score", "unsupported_market", "void", "push"].includes(item.settlement.status)).length,
    [filteredItems]
  );

  useEffect(() => {
    if (groupedLeagues.length > 0) {
      setExpandedLeagues(prev => {
        const next = new Set(prev);
        groupedLeagues.forEach(l => next.add(leagueKey(l)));
        return next;
      });
    }
  }, [groupedLeagues.length]);

  const handleClearFilters = () => {
    setFilters(initialPredictionResultsFilters);
    setSearchQuery("");
  };

  const hasActiveFilters = Boolean(
    filters.status || filters.tier || filters.countryId || filters.competitionId ||
    filters.marketType || filters.from || filters.to || searchQuery.trim()
  );

  const totalFromApi = data?.total ?? 0;
  const offset = filters.offset ?? 0;
  const hasNextPage = offset + (data?.items.length ?? 0) < totalFromApi;
  const hasPrevPage = offset > 0;

  const handlePrevPage = () => setFilters(prev => ({ ...prev, offset: Math.max(0, (prev.offset ?? 0) - (prev.limit ?? 50)) }));
  const handleNextPage = () => setFilters(prev => ({ ...prev, offset: (prev.offset ?? 0) + (prev.limit ?? 50) }));

  const toggleLeague = (key: string) => {
    setExpandedLeagues(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleMatch = (matchId: string) => {
    setExpandedMatches(prev => {
      const next = new Set(prev);
      if (next.has(matchId)) next.delete(matchId);
      else next.add(matchId);
      return next;
    });
  };

  const successRate = summary && summary.totalSettled > 0
    ? Math.round((summary.won / summary.totalSettled) * 100)
    : null;

  return (
    <>
      <header className="hero results-header">
        <div>
          <h1>Sonuçlar</h1>
          <p>SkorIQ tahminlerinin maç sonuçlarına göre değerlendirmesini incele.</p>
          <p className="results-helper-note">Bu sayfada yalnızca sonuçlanmış veya değerlendirilmeyi bekleyen tahminler gösterilir.</p>
        </div>
      </header>

      <section className="panel results-summary-panel">
        <div className="results-summary-grid">
          <div className="results-summary-card">
            <span>Toplam tahmin</span>
            <strong>{summary ? data?.total ?? summary.totalSettled : "—"}</strong>
          </div>
          <div className="results-summary-card results-won">
            <span>Başarılı</span>
            <strong>{summary?.won ?? "—"}</strong>
          </div>
          <div className="results-summary-card results-lost">
            <span>Başarısız</span>
            <strong>{summary?.lost ?? "—"}</strong>
          </div>
          <div className="results-summary-card results-pending">
            <span>Bekleyen</span>
            <strong>{summary?.pending ?? "—"}</strong>
          </div>
          <div className="results-summary-card results-unsettleable">
            <span>Değerlendirilemedi</span>
            <strong>{summary ? notSettleableCount : "—"}</strong>
          </div>
          {successRate !== null ? (
            <div className="results-summary-card results-rate">
              <span>Başarı oranı</span>
              <strong>{successRate}%</strong>
            </div>
          ) : null}
        </div>
      </section>

      <div className="results-controls">
        <div className="results-search-row">
          <div className="results-search-bar">
            <svg className="results-search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setFilters(prev => ({ ...prev, offset: 0 }));
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  setFilters(prev => ({ ...prev, search: searchQuery.trim() || undefined, offset: 0 }));
                  e.currentTarget.blur();
                }
              }}
              placeholder="Takım, lig veya maç ara…"
              aria-label="Sonuç ara"
            />
            {searchQuery ? (
              <button type="button" className="results-search-clear" onClick={() => {
                setSearchQuery("");
                setFilters(prev => ({ ...prev, search: undefined, offset: 0 }));
              }} aria-label="Aramayı temizle">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6 6 18" /><path d="m6 6 12 12" />
                </svg>
              </button>
            ) : null}
          </div>
          <button type="button" className="results-clear-btn" onClick={handleClearFilters} disabled={!hasActiveFilters}>
            Filtreleri temizle
          </button>
        </div>

        <FilterDisclosure active={hasActiveFilters}>
          <ResultsFilterBar filters={filters} setFilters={setFilters} countries={summary?.byCountry ?? []} leagues={summary?.byLeague ?? []} />
        </FilterDisclosure>

        {!loading && data ? (
          <div className="results-pagination-bar">
            <p className="results-count">
              {totalFromApi === 0 ? 0 : offset + 1}–{Math.min(offset + data.items.length, totalFromApi)} / {totalFromApi.toLocaleString("tr-TR")} sonuç
            </p>
            <div className="results-pagination">
              <button type="button" className="results-page-btn" onClick={handlePrevPage} disabled={!hasPrevPage} aria-label="Önceki sayfa">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m15 18-6-6 6-6" />
                </svg>
                Önceki
              </button>
              <button type="button" className="results-page-btn" onClick={handleNextPage} disabled={!hasNextPage} aria-label="Sonraki sayfa">
                Sonraki
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m9 18 6-6-6-6" />
                </svg>
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {loading ? <ResultsSkeleton /> : null}
      {error ? <StatePanel title="Sonuçlar yüklenemedi" body={error} /> : null}
      {!loading && !error && groupedLeagues.length === 0 ? (
        <ResultsEmptyState hasFilters={hasActiveFilters} onClear={handleClearFilters} />
      ) : null}
      {!loading && !error && groupedLeagues.length > 0 ? (
        <section className="results-list" aria-label="Maç sonuçları listesi">
          {groupedLeagues.map((league) => (
            <LeagueGroup
              key={leagueKey(league)}
              league={league}
              expanded={expandedLeagues.has(leagueKey(league))}
              onToggle={() => toggleLeague(leagueKey(league))}
              expandedMatches={expandedMatches}
              onToggleMatch={toggleMatch}
              navigate={navigate}
            />
          ))}
        </section>
      ) : null}
    </>
  );
}

export function ResultsFilterBar({
  filters,
  setFilters,
  countries,
  leagues
}: {
  filters: FootballPredictionResultsFilters;
  setFilters: (filters: FootballPredictionResultsFilters) => void;
  countries: Array<{ id: string | null; name: string | null; count: number }>;
  leagues: Array<{ id: string; name: string; count: number }>;
}) {
  const update = (patch: Partial<FootballPredictionResultsFilters>) => setFilters({ ...filters, ...patch, offset: 0 });
  return (
    <section className="results-filter-bar" aria-label="Sonuç filtreleri">
      <label>
        Ülke
        <select value={filters.countryId ?? ""} onChange={(e) => update({ countryId: e.target.value || undefined })}>
          <option value="">Tümü</option>
          {countries.map((c) => (
            <option key={c.id ?? c.name ?? "unknown"} value={c.id ?? ""}>{c.name ?? "Bilinmiyor"}</option>
          ))}
        </select>
      </label>
      <label>
        Lig
        <select value={filters.competitionId ?? ""} onChange={(e) => update({ competitionId: e.target.value || undefined })}>
          <option value="">Tümü</option>
          {leagues.map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
      </label>
      <label>
        Durum
        <select value={filters.status} onChange={(e) => update({ status: e.target.value as FootballPredictionResultsFilters["status"] })}>
          <option value="">Tümü</option>
          <option value="won">Başarılı</option>
          <option value="lost">Başarısız</option>
          <option value="pending">Bekliyor</option>
          <option value="not_settleable">Değerlendirilemedi</option>
          <option value="missing_score">Skor bekleniyor</option>
          <option value="unsupported_market">Desteklenmeyen tahmin tipi</option>
        </select>
      </label>
      <label>
        Kademe
        <select value={filters.tier} onChange={(e) => update({ tier: e.target.value as FootballPredictionResultsFilters["tier"] })}>
          <option value="">Tümü</option>
          <option value="primary">Tahminim</option>
          <option value="try">Denenir</option>
          <option value="alternative">Alternatif</option>
        </select>
      </label>
      <label>
        Başlangıç
        <input type="date" value={filters.from ?? ""} onChange={(e) => update({ from: e.target.value || undefined })} />
      </label>
      <label>
        Bitiş
        <input type="date" value={filters.to ?? ""} onChange={(e) => update({ to: e.target.value || undefined })} />
      </label>
      <label>
        Sayfa boyutu
        <select value={filters.limit ?? 50} onChange={(e) => update({ limit: Number(e.target.value) })}>
          <option value={20}>20</option>
          <option value={50}>50</option>
          <option value={100}>100</option>
        </select>
      </label>
    </section>
  );
}

export function LeagueGroup({
  league,
  expanded,
  onToggle,
  expandedMatches,
  onToggleMatch,
  navigate
}: {
  league: GroupedLeague;
  expanded: boolean;
  onToggle: () => void;
  expandedMatches: Set<string>;
  onToggleMatch: (matchId: string) => void;
  navigate: (path: string) => void;
}) {
  return (
    <div className="league-group">
      <button
        type="button"
        className="league-group-header"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <div className="league-group-identity">
          {league.competition.logoUrl ? (
            <img src={league.competition.logoUrl} alt="" className="league-group-logo" loading="lazy" />
          ) : (
            <span className="league-group-initials">{league.competition.name.slice(0, 2).toUpperCase()}</span>
          )}
          <div className="league-group-names">
            <span className="league-group-name">{league.competition.name}</span>
            <span className="league-group-country">{league.country.name ?? ""}</span>
          </div>
        </div>
        <div className="league-group-meta">
          <span className="league-group-count">{league.matches.length} maç</span>
          <svg
            className={`league-group-chevron${expanded ? " expanded" : ""}`}
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </div>
      </button>
      {expanded ? (
        <div className="league-group-body">
          {league.matches.map((match) => (
            <MatchResultRow
              key={match.match.id}
              match={match}
              expanded={expandedMatches.has(match.match.id)}
              onToggle={() => onToggleMatch(match.match.id)}
              navigate={navigate}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function MatchResultRow({
  match,
  expanded,
  onToggle,
  navigate
}: {
  match: GroupedMatch;
  expanded: boolean;
  onToggle: () => void;
  navigate: (path: string) => void;
}) {
  const matchStatus = getMatchStatus(match.match);
  const tierSummaries = getTierSummaries(match.predictions);

  return (
    <div className="match-result-row">
      <button
        type="button"
        className="match-result-main"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <div className="match-result-left">
          <span className="match-result-date">{formatDate(match.match.kickoffAt)}</span>
          <span className={`match-result-status status-${matchStatus.toLowerCase().replace(/\s+/g, "-")}`}>{matchStatus}</span>
        </div>
        <div className="match-result-teams">
          <div className="match-result-team match-result-home">
            <TeamLogo name={match.match.homeTeam.name} logoUrl={match.match.homeTeam.logoUrl} />
            <span>{match.match.homeTeam.name}</span>
          </div>
          <div className="match-result-team match-result-away">
            <TeamLogo name={match.match.awayTeam.name} logoUrl={match.match.awayTeam.logoUrl} />
            <span>{match.match.awayTeam.name}</span>
          </div>
        </div>
        <div className="match-result-score">
          {match.match.finalScore ? (
            <>
              <span className="match-result-final">{match.match.finalScore}</span>
              {match.match.halftimeScore ? (
                <span className="match-result-halftime">İY {match.match.halftimeScore}</span>
              ) : null}
            </>
          ) : (
            <span className="match-result-no-score">—</span>
          )}
        </div>
        <div className="match-result-badges">
          {Object.entries(tierSummaries).map(([tier, summary]) => (
            <span key={tier} className={`match-result-tier-badge tier-${tier} status-${summary.status}`}>
              {tierLabel(tier)}: {summary.label}
            </span>
          ))}
        </div>
        <svg
          className={`match-result-chevron${expanded ? " expanded" : ""}`}
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {expanded ? (
        <div className="match-result-detail">
          {(["primary", "try", "alternative"] as const).map((tier) => {
            const preds = match.predictions.filter(p => p.prediction.tier === tier);
            if (preds.length === 0) return null;
            return (
              <div key={tier} className="prediction-tier-group">
                <h4 className="prediction-tier-title">{tierLabel(tier)}</h4>
                <div className="prediction-tier-list">
                  {preds.map((p, i) => (
                    <div key={i} className="prediction-line">
                      <div className="prediction-line-main">
                        <span className="prediction-label">{p.prediction.displayLabel}</span>
                        <SettlementBadge status={p.settlement.status} />
                      </div>
                      {p.prediction.confidence !== null ? (
                        <span className="prediction-confidence">Güven: {p.prediction.confidence}</span>
                      ) : null}
                      {p.settlement.explanation ? (
                        <p className="prediction-explanation">{p.settlement.explanation}</p>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          <button
            type="button"
            className="match-detail-link"
            onClick={() => navigate(`/football/analytics/${match.match.id}`)}
          >
            Maç detayını görüntüle
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14" /><path d="m12 5 7 7-7 7" />
            </svg>
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function SettlementBadge({ status }: { status: FootballPredictionResultItem["settlement"]["status"] }) {
  return <span className={`settlement-badge settlement-${status}`}>{predictionResultStatusLabel(status)}</span>;
}

function ResultsEmptyState({ hasFilters, onClear }: { hasFilters: boolean; onClear: () => void }) {
  return (
    <div className="results-empty-state">
      <p className="results-empty-title">
        {hasFilters ? "Filtrelere uygun sonuç bulunamadı." : "Henüz değerlendirilen tahmin yok."}
      </p>
      <p className="results-empty-body">
        {hasFilters
          ? "Farklı filtreler veya arama terimleri deneyebilirsin."
          : "Maçlar tamamlandıkça SkorIQ tahminleri burada sonuçlarıyla birlikte listelenecek."}
      </p>
      {hasFilters ? (
        <button type="button" className="results-empty-btn" onClick={onClear}>
          Filtreleri temizle
        </button>
      ) : null}
    </div>
  );
}

function ResultsSkeleton() {
  return (
    <section className="results-list" aria-label="Sonuçlar yükleniyor">
      {[1, 2, 3].map((i) => (
        <div key={i} className="league-group">
          <div className="league-group-header skeleton-shimmer">
            <div className="league-group-identity">
              <span className="league-group-initials" style={{ background: "rgba(28,24,12,0.12)" }} />
              <div className="league-group-names">
                <span className="league-group-name" style={{ width: "8rem", height: "0.9rem", background: "rgba(28,24,12,0.12)", borderRadius: "0.3rem" }} />
                <span className="league-group-country" style={{ width: "5rem", height: "0.7rem", background: "rgba(28,24,12,0.08)", borderRadius: "0.3rem" }} />
              </div>
            </div>
          </div>
          <div className="league-group-body">
            {[1, 2].map((j) => (
              <div key={j} className="match-result-row skeleton-shimmer">
                <div className="match-result-main">
                  <div className="match-result-left">
                    <span style={{ width: "3rem", height: "0.75rem", background: "rgba(28,24,12,0.1)", borderRadius: "0.2rem" }} />
                  </div>
                  <div className="match-result-teams">
                    <div className="match-result-team">
                      <span style={{ width: "1.5rem", height: "1.5rem", borderRadius: "0.3rem", background: "rgba(28,24,12,0.1)" }} />
                      <span style={{ width: "6rem", height: "0.85rem", background: "rgba(28,24,12,0.1)", borderRadius: "0.2rem" }} />
                    </div>
                    <div className="match-result-team">
                      <span style={{ width: "1.5rem", height: "1.5rem", borderRadius: "0.3rem", background: "rgba(28,24,12,0.1)" }} />
                      <span style={{ width: "6rem", height: "0.85rem", background: "rgba(28,24,12,0.1)", borderRadius: "0.2rem" }} />
                    </div>
                  </div>
                  <div className="match-result-score">
                    <span style={{ width: "2rem", height: "1.2rem", background: "rgba(28,24,12,0.1)", borderRadius: "0.2rem" }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

// Helper types and functions
interface GroupedMatch {
  match: FootballPredictionResultItem["match"];
  country: FootballPredictionResultItem["country"];
  competition: FootballPredictionResultItem["competition"];
  predictions: Array<{
    prediction: FootballPredictionResultItem["prediction"];
    settlement: FootballPredictionResultItem["settlement"];
  }>;
}

interface GroupedLeague {
  country: FootballPredictionResultItem["country"];
  competition: FootballPredictionResultItem["competition"];
  matches: GroupedMatch[];
}

export function groupResultsByLeague(items: FootballPredictionResultItem[]): GroupedLeague[] {
  const leagueMap = new Map<string, GroupedLeague>();
  for (const item of items) {
    const leagueKey = `${item.country.id ?? item.country.name ?? "unknown"}|${item.competition.id}`;
    if (!leagueMap.has(leagueKey)) {
      leagueMap.set(leagueKey, {
        country: item.country,
        competition: item.competition,
        matches: []
      });
    }
    const league = leagueMap.get(leagueKey)!;
    const matchKey = item.match.id;
    let match = league.matches.find(m => m.match.id === matchKey);
    if (!match) {
      match = {
        match: item.match,
        country: item.country,
        competition: item.competition,
        predictions: []
      };
      league.matches.push(match);
    }
    match.predictions.push({
      prediction: item.prediction,
      settlement: item.settlement
    });
  }
  return Array.from(leagueMap.values());
}

function leagueKey(league: GroupedLeague): string {
  return `${league.country.id ?? league.country.name ?? "unknown"}|${league.competition.id}`;
}

function getMatchStatus(match: FootballPredictionResultItem["match"]): string {
  if (match.finalScore) return "FT";
  const kickoff = new Date(match.kickoffAt);
  const now = new Date();
  if (kickoff < now) return "Finished";
  return "Bekliyor";
}

function getTierSummaries(predictions: GroupedMatch["predictions"]) {
  const summaries: Record<string, { label: string; status: string }> = {};
  const tiers: Array<"primary" | "try" | "alternative"> = ["primary", "try", "alternative"];

  for (const tier of tiers) {
    const tierPreds = predictions.filter(p => p.prediction.tier === tier);
    if (tierPreds.length === 0) continue;

    const won = tierPreds.filter(p => p.settlement.status === "won").length;
    const lost = tierPreds.filter(p => p.settlement.status === "lost").length;
    const pending = tierPreds.filter(p => p.settlement.status === "pending").length;

    if (tier === "try" && tierPreds.length > 1) {
      const allWon = won === tierPreds.length;
      const allLost = lost === tierPreds.length;
      const allPending = pending === tierPreds.length;
      const label = allWon ? `${won}/${tierPreds.length} Kazandı` : allLost ? `${lost}/${tierPreds.length} Kaybetti` : allPending ? "Bekliyor" : `${won}/${tierPreds.length} Kazandı`;
      const status = allWon ? "won" : allLost ? "lost" : allPending ? "pending" : "mixed";
      summaries[tier] = { label, status };
    } else {
      const first = tierPreds[0]!;
      const status = first.settlement.status;
      const label = status === "won" ? "Kazandı" : status === "lost" ? "Kaybetti" : status === "pending" ? "Bekliyor" : predictionResultStatusLabel(status);
      summaries[tier] = { label, status };
    }
  }

  return summaries;
}

export function predictionResultStatusLabel(status: FootballPredictionResultItem["settlement"]["status"]) {
  const labels: Record<FootballPredictionResultItem["settlement"]["status"], string> = {
    won: "Kazandı",
    lost: "Kaybetti",
    void: "Geçersiz",
    push: "İade",
    pending: "Bekliyor",
    missing_score: "Skor bekleniyor",
    unsupported_market: "Desteklenmeyen tahmin tipi",
    not_settleable: "Değerlendirilemedi"
  };
  return labels[status];
}

function SettlementListPage({ navigate }: { navigate: (path: string) => void }) {
  const [filters, setFilters] = useState<FootballPredictionSettlementFilters>(initialSettlementFilters);
  const { data, loading, error } = useLoad(() => fetchFootballPredictionSettlements(filters), [filters]);

  return (
    <>
      <header className="hero">
        <div>
          <h1>Tahmin Sonuçları</h1>
          <p>Settlement sonuçları yalnızca iç denetim içindir. Public yayın, üye yayını veya tahmin kombini işlemi yapılmaz.</p>
        </div>
      </header>
      <SettlementGuardNotice />
      <FilterDisclosure active={Boolean(filters.settlementStatus || filters.recommendationTier || filters.matchId)}><SettlementFilterBar filters={filters} setFilters={setFilters} /></FilterDisclosure>
      {loading ? <StatePanel title="Tahmin sonuçları yükleniyor..." /> : null}
      {error ? <StatePanel title="Tahmin sonuçları yüklenemedi" body={error} /> : null}
      {!loading && !error && data?.items.length === 0 ? <StatePanel title="Settlement sonucu bulunamadı" /> : null}
      {!loading && !error && data ? <SettlementList data={data} navigate={navigate} /> : null}
    </>
  );
}

function SettlementFilterBar({
  filters,
  setFilters
}: {
  filters: FootballPredictionSettlementFilters;
  setFilters: (filters: FootballPredictionSettlementFilters) => void;
}) {
  const update = (patch: Partial<FootballPredictionSettlementFilters>) => setFilters({ ...filters, ...patch });
  return (
    <section className="filters" aria-label="Tahmin sonucu filtreleri">
      <label>
        Sonuç
        <select value={filters.settlementStatus} onChange={(event) => update({ settlementStatus: event.target.value as FootballPredictionSettlementFilters["settlementStatus"] })}>
          <option value="">Tümü</option>
          <option value="settled_success">Başarılı</option>
          <option value="settled_failed">Başarısız</option>
          <option value="settled_void">Geçersiz</option>
        </select>
      </label>
      <label>
        Tutarlılık
        <select value={filters.consistencyStatus} onChange={(event) => update({ consistencyStatus: event.target.value as FootballPredictionSettlementFilters["consistencyStatus"] })}>
          <option value="">Tümü</option>
          <option value="warning">Uyarı</option>
          <option value="blocked">Bloke</option>
          <option value="passed">Geçti</option>
          <option value="unchecked">Kontrol edilmedi</option>
        </select>
      </label>
      <label>
        Seviye
        <select value={filters.recommendationTier} onChange={(event) => update({ recommendationTier: event.target.value as FootballPredictionSettlementFilters["recommendationTier"] })}>
          <option value="">Tümü</option>
          <option value="primary">Tahminim</option>
          <option value="try">Denenir</option>
          <option value="alternative">Alternatif</option>
          <option value="avoid">Uzak Dur</option>
        </select>
      </label>
      <label>
        Audit-only
        <select value={filters.auditOnly === "" || filters.auditOnly === undefined ? "" : String(filters.auditOnly)} onChange={(event) => update({ auditOnly: parseBooleanFilter(event.target.value) })}>
          <option value="">Tümü</option>
          <option value="true">Evet</option>
          <option value="false">Hayır</option>
        </select>
      </label>
      <label>
        Maç ID
        <input value={filters.matchId ?? ""} onChange={(event) => update({ matchId: event.target.value.trim() || undefined })} placeholder="maç uuid" />
      </label>
      <label>
        Limit
        <select value={filters.limit} onChange={(event) => update({ limit: Number(event.target.value) })}>
          <option value={10}>10</option>
          <option value={20}>20</option>
          <option value={50}>50</option>
        </select>
      </label>
    </section>
  );
}

function SettlementList({ data, navigate }: { data: FootballPredictionSettlementsListResponse; navigate: (path: string) => void }) {
  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Settlement kayıtları</h2>
        <span className="muted">
          {data.pagination.total} kayıttan {data.items.length} gösteriliyor
        </span>
      </div>
      <div className="draft-grid">
        {data.items.map((item) => (
          <SettlementCard key={item.settlementId} item={item} navigate={navigate} />
        ))}
      </div>
    </section>
  );
}

function SettlementDetailPage({ settlementId, navigate }: { settlementId: string; navigate: (path: string) => void }) {
  const { data, loading, error } = useLoad(() => fetchFootballPredictionSettlement(settlementId), [settlementId]);

  return (
    <>
      <button className="back-button" type="button" onClick={() => navigate("/football/predictions/settlements")}>
        Sonuç listesine dön
      </button>
      {loading ? <StatePanel title="Settlement detayı yükleniyor..." /> : null}
      {error ? <StatePanel title="Settlement detayı yüklenemedi" body={error} /> : null}
      {data ? (
        <>
          <SettlementDetailHeader settlement={data} navigate={navigate} />
          <SettlementGuardNotice auditOnly={data.auditOnly} />
          <div className="metric-grid">
            <MetricCard title="Settlement" value={settlementStatusLabel(data.settlementStatus)} />
            <MetricCard title="Gerçek sonuç" value={data.actualResult} />
            <MetricCard title="Audit-only" value={data.auditOnly ? "Evet" : "Hayır"} />
            <MetricCard title="Çakışmalar" value={data.conflictCount} />
          </div>
          <section className="panel">
            <h2>Settlement gerekçesi</h2>
            <p>{data.settlementReason}</p>
          </section>
          <section className="panel">
            <h2>Tahmin gerekçesi</h2>
            <p>{data.reasoningSummary ?? "Gerekçe özeti yok."}</p>
          </section>
          <ConflictsPanel conflicts={data.conflicts} />
          <JsonPanel title="Beklenti anlık görüntüsü" value={data.expectationSnapshot} />
          <JsonPanel title="Temizlenmiş settlement metadata" value={data.settlementMetadata} />
          <JsonPanel title="Temizlenmiş tahmin metadata" value={data.predictionMetadata} />
        </>
      ) : null}
    </>
  );
}

function MatchSettlementsPage({ matchId, navigate }: { matchId: string; navigate: (path: string) => void }) {
  const { data, loading, error } = useLoad(() => fetchFootballMatchPredictionSettlements(matchId), [matchId]);

  return (
    <>
      <button className="back-button" type="button" onClick={() => navigate("/football/predictions/settlements")}>
        Sonuç listesine dön
      </button>
      {loading ? <StatePanel title="Maç settlement sonuçları yükleniyor..." /> : null}
      {error ? <StatePanel title="Maç settlement sonuçları yüklenemedi" body={error} /> : null}
      {data ? (
        <>
          <header className="hero detail-hero">
            <div className="match-title">
              <TeamLogo name={data.match.homeTeam.name} logoUrl={data.match.homeTeam.logoUrl} size="lg" />
              <div>
                <p className="eyebrow">{data.match.competition.name}</p>
                <h1>
                  {data.match.homeTeam.name} <span>vs</span> {data.match.awayTeam.name}
                </h1>
                <p className="muted">{formatDateTime(data.match.kickoffAt)}</p>
              </div>
              <TeamLogo name={data.match.awayTeam.name} logoUrl={data.match.awayTeam.logoUrl} size="lg" />
            </div>
            <span className="badge badge-muted">İç denetim</span>
          </header>
          <SettlementGuardNotice />
          <div className="metric-grid">
            <MetricCard title="Başarılı" value={data.settlementSummary.success} />
            <MetricCard title="Başarısız" value={data.settlementSummary.failed} />
            <MetricCard title="Geçersiz" value={data.settlementSummary.void} />
            <MetricCard title="Audit-only" value={data.settlementSummary.auditOnly} />
            <MetricCard title="Üyelere görünür" value={data.settlementSummary.memberVisible} />
            <MetricCard title="Public yayın" value={data.settlementSummary.publicPublished} />
          </div>
          <section className="notice">
            <strong>Bu ekran iç inceleme amaçlıdır.</strong>
            <span>{data.note}</span>
          </section>
          <SettlementTierGroups data={data} navigate={navigate} />
        </>
      ) : null}
    </>
  );
}

function SettlementDetailHeader({ settlement, navigate }: { settlement: FootballPredictionSettlementDetail; navigate: (path: string) => void }) {
  return (
    <header className="hero detail-hero">
      <div>
        <p className="eyebrow">{settlement.displayLabel ?? tierLabel(settlement.recommendationTier)}</p>
        <h1>
          {settlement.predictionType} <span>{settlement.predictionValue}</span>
        </h1>
        <p className="muted">
          {settlement.match.homeTeam.name} vs {settlement.match.awayTeam.name} · {formatDateTime(settlement.match.kickoffAt)}
        </p>
      </div>
      <div className="hero-actions">
        <DraftBadge value={settlement.settlementStatus} kind="status" />
        <DraftBadge value={settlement.consistencyStatus} kind="consistency" />
        <button type="button" onClick={() => navigate(`/football/matches/${settlement.matchId}/prediction-settlements`)}>
          Maç sonuçlarını aç
        </button>
      </div>
    </header>
  );
}

function SettlementGuardNotice({ auditOnly = false }: { auditOnly?: boolean }) {
  return (
    <section className="notice">
      <strong>Bu sonuç iç denetim amaçlıdır.</strong>
      <span>Public başarılı tahmin olarak yayınlanmamıştır. Üyelere görünür tahmin değildir. {auditOnly ? "Uzak Dur / blocked adaylar gerçekleşse bile öneri sayılmaz." : "Settlement sonucu public uygunluk anlamına gelmez."}</span>
    </section>
  );
}

function SettlementCard({ item, navigate }: { item: FootballPredictionSettlementListItem; navigate: (path: string) => void }) {
  return (
    <article className="draft-card">
      <div className="draft-card-header">
        <div>
          <p className="eyebrow">{item.match.competition.name}</p>
          <h3>
            {item.match.homeTeam.name} vs {item.match.awayTeam.name}
          </h3>
          <p className="muted">{formatDateTime(item.match.kickoffAt)}</p>
        </div>
        <DraftBadge value={item.settlementStatus} kind="status" />
      </div>
      <div className="draft-main">
        <strong>{item.displayLabel ?? tierLabel(item.recommendationTier)}</strong>
        <span>
          {item.predictionType} = {item.predictionValue}
        </span>
      </div>
      <div className="draft-meta">
        <DraftBadge value={item.recommendationTier ?? "unknown"} kind="tier" />
        <DraftBadge value={item.consistencyStatus} kind="consistency" />
        <span>Gerçek sonuç {item.actualResult}</span>
        <span>Risk seviyesi {item.riskLevel}</span>
        <span>{item.conflictCount} çakışma</span>
        {item.auditOnly ? <span>Audit-only</span> : null}
        <span>{item.memberVisible ? "Üyelere görünür" : "Üyelere görünür değil"}</span>
        <span>{item.publicStatus.publicEligible ? "Public eligible" : "Public eligible değil"}</span>
        <span>{item.publicStatus.publicPublished ? "Public published" : "Public published değil"}</span>
      </div>
      <p>{item.settlementReason}</p>
      <div className="button-row">
        <button type="button" onClick={() => navigate(`/football/predictions/settlements/${item.settlementId}`)}>
          Detay
        </button>
        <button type="button" onClick={() => navigate(`/football/matches/${item.matchId}/prediction-settlements`)}>
          Maç sonuçları
        </button>
      </div>
    </article>
  );
}

function SettlementTierGroups({ data, navigate }: { data: FootballMatchPredictionSettlementsResponse; navigate: (path: string) => void }) {
  return (
    <div className="draft-tier-grid">
      {(["primary", "try", "alternative", "avoid"] as const).map((tier) => (
        <section className="panel" key={tier}>
          <div className="panel-header">
            <h2>{data.outputsByRecommendationTier[tier].label}</h2>
            <DraftBadge value={tier} kind="tier" />
          </div>
          {data.outputsByRecommendationTier[tier].items.length === 0 ? <p className="muted">Bu grupta sonuç yok.</p> : null}
          <div className="draft-grid">
            {data.outputsByRecommendationTier[tier].items.map((item) => (
              <SettlementCard key={item.settlementId} item={item} navigate={navigate} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

const initialPublicEligibilityFilters: FootballPublicEligibilityFilters = {
  settlementStatus: "",
  consistencyStatus: "",
  recommendationTier: "",
  limit: 20,
  offset: 0
};

function PublicEligibilityListPage({ navigate }: { navigate: (path: string) => void }) {
  const [filters, setFilters] = useState<FootballPublicEligibilityFilters>(initialPublicEligibilityFilters);
  const { data, loading, error } = useLoad(() => fetchFootballPublicEligibility(filters), [filters]);

  return (
    <>
      <header className="hero">
        <div>
          <h1>Public Uygunluk</h1>
          <p>Settled tahminlerin public başarılı tahmin adayı olup olmadığını salt okunur olarak değerlendir.</p>
        </div>
      </header>
      <PublicEligibilityGuardNotice />
      <FilterDisclosure active={Boolean(filters.settlementStatus || filters.consistencyStatus || filters.recommendationTier || filters.matchId)}><PublicEligibilityFilterBar filters={filters} setFilters={setFilters} /></FilterDisclosure>
      {loading ? <StatePanel title="Public uygunluk değerlendirmesi yükleniyor..." /> : null}
      {error ? <StatePanel title="Public uygunluk verisi yüklenemedi" body={error} /> : null}
      {!loading && !error && data ? <PublicEligibilityPanels data={data} navigate={navigate} /> : null}
    </>
  );
}

function MatchPublicEligibilityPage({ matchId, navigate }: { matchId: string; navigate: (path: string) => void }) {
  const { data, loading, error } = useLoad(() => fetchFootballMatchPublicEligibility(matchId), [matchId]);

  return (
    <>
      <button className="back-button" type="button" onClick={() => navigate("/football/public-eligibility")}>
        Public uygunluk listesine dön
      </button>
      {loading ? <StatePanel title="Maç public uygunluğu yükleniyor..." /> : null}
      {error ? <StatePanel title="Maç public uygunluğu yüklenemedi" body={error} /> : null}
      {data ? (
        <>
          <header className="hero detail-hero">
            <div className="match-title">
              <TeamLogo name={data.match.homeTeam.name} logoUrl={data.match.homeTeam.logoUrl} size="lg" />
              <div>
                <p className="eyebrow">{data.match.competition.name}</p>
                <h1>
                  {data.match.homeTeam.name} <span>vs</span> {data.match.awayTeam.name}
                </h1>
                <p className="muted">{formatDateTime(data.match.kickoffAt)}</p>
              </div>
              <TeamLogo name={data.match.awayTeam.name} logoUrl={data.match.awayTeam.logoUrl} size="lg" />
            </div>
            <span className="badge badge-muted">Public yayın yok</span>
          </header>
          <PublicEligibilityGuardNotice />
          <PublicEligibilityPanels data={data} navigate={navigate} />
        </>
      ) : null}
    </>
  );
}

function PublicEligibilityFilterBar({
  filters,
  setFilters
}: {
  filters: FootballPublicEligibilityFilters;
  setFilters: (filters: FootballPublicEligibilityFilters) => void;
}) {
  const update = (patch: Partial<FootballPublicEligibilityFilters>) => setFilters({ ...filters, ...patch });
  return (
    <section className="filters" aria-label="Public uygunluk filtreleri">
      <label>
        Settlement
        <select value={filters.settlementStatus} onChange={(event) => update({ settlementStatus: event.target.value as FootballPublicEligibilityFilters["settlementStatus"] })}>
          <option value="">Tümü</option>
          <option value="settled_success">Başarılı</option>
          <option value="settled_failed">Başarısız</option>
          <option value="settled_void">Geçersiz</option>
        </select>
      </label>
      <label>
        Tutarlılık
        <select value={filters.consistencyStatus} onChange={(event) => update({ consistencyStatus: event.target.value as FootballPublicEligibilityFilters["consistencyStatus"] })}>
          <option value="">Tümü</option>
          <option value="warning">Uyarı</option>
          <option value="blocked">Bloke</option>
          <option value="passed">Geçti</option>
          <option value="unchecked">Kontrol edilmedi</option>
        </select>
      </label>
      <label>
        Seviye
        <select value={filters.recommendationTier} onChange={(event) => update({ recommendationTier: event.target.value as FootballPublicEligibilityFilters["recommendationTier"] })}>
          <option value="">Tümü</option>
          <option value="primary">Tahminim</option>
          <option value="try">Denenir</option>
          <option value="alternative">Alternatif</option>
          <option value="avoid">Uzak Dur</option>
        </select>
      </label>
      <label>
        Maç ID
        <input value={filters.matchId ?? ""} onChange={(event) => update({ matchId: event.target.value.trim() || undefined })} placeholder="maç uuid" />
      </label>
      <label>
        Limit
        <select value={filters.limit} onChange={(event) => update({ limit: Number(event.target.value) })}>
          <option value={10}>10</option>
          <option value={20}>20</option>
          <option value={50}>50</option>
        </select>
      </label>
    </section>
  );
}

function PublicEligibilityPanels({ data, navigate }: { data: FootballPublicEligibilityResponse | FootballMatchPublicEligibilityResponse; navigate: (path: string) => void }) {
  return (
    <>
      <div className="metric-grid">
        <MetricCard title="Public aday" value={data.summary.eligibleCount} />
        <MetricCard title="Hariç" value={data.summary.excludedCount} />
        <MetricCard title="Maç sonrası üretilen" value={data.summary.lateGeneratedCount} />
        <MetricCard title="Audit-only" value={data.summary.auditOnlyCount} />
        <MetricCard title="Başarısız settlement" value={data.summary.failedCount} />
        <MetricCard title="Bloke" value={data.summary.blockedCount} />
      </div>
      <section className="notice">
        <strong>Public güvenlik notları</strong>
        <span>{data.publicSafetyNotes.join(" ")}</span>
      </section>
      <PublicEligibilityGroup title="Public adaylar" items={data.eligible} empty="Public adayı yok." navigate={navigate} />
      <PublicEligibilityGroup title="Hariç tutulanlar" items={data.excluded} empty="Hariç tutulan kayıt yok." navigate={navigate} />
    </>
  );
}

function PublicEligibilityGroup({ title, items, empty, navigate }: { title: string; items: FootballPublicEligibilityItem[]; empty: string; navigate: (path: string) => void }) {
  return (
    <section className="panel">
      <div className="panel-header">
        <h2>{title}</h2>
        <span className="muted">{items.length} kayıt</span>
      </div>
      {items.length === 0 ? <p className="muted">{empty}</p> : null}
      <div className="draft-grid">
        {items.map((item) => (
          <PublicEligibilityCard key={item.predictionOutputId} item={item} navigate={navigate} />
        ))}
      </div>
    </section>
  );
}

function PublicEligibilityCard({ item, navigate }: { item: FootballPublicEligibilityItem; navigate: (path: string) => void }) {
  return (
    <article className="draft-card">
      <div className="draft-card-header">
        <div>
          <p className="eyebrow">{item.match.competition.name}</p>
          <h3>
            {item.match.homeTeam.name} vs {item.match.awayTeam.name}
          </h3>
          <p className="muted">{formatDateTime(item.match.kickoffAt)}</p>
        </div>
        <span className={`badge ${item.eligible ? "badge-good" : "badge-warn"}`}>{item.eligible ? "Public adayı" : "Hariç"}</span>
      </div>
      <div className="draft-main">
        <strong>{item.displayLabel ?? tierLabel(item.recommendationTier)}</strong>
        <span>
          {item.predictionType} = {item.predictionValue}
        </span>
      </div>
      <div className="draft-meta">
        <DraftBadge value={item.recommendationTier ?? "unknown"} kind="tier" />
        <DraftBadge value={item.sourceClassification.consistencyStatus} kind="consistency" />
        <span>{item.settlementStatus ? settlementStatusLabel(item.settlementStatus) : "Settlement yok"}</span>
        <span>Güven skoru {item.confidenceScore ?? "Yok"}</span>
        {item.sourceClassification.auditOnly ? <span>Audit-only</span> : null}
      </div>
      {item.blockers.length > 0 ? (
        <div className="warning-list">
          <strong>Neden hariç?</strong>
          {item.blockers.map((blocker, index) => (
            <span key={`${blocker}-${index}`}>{publicBlockerLabel(blocker)}</span>
          ))}
        </div>
      ) : null}
      {item.suggestedPublicTitle ? <p>{item.suggestedPublicTitle}</p> : null}
      {item.suggestedPublicSummary ? <p>{item.suggestedPublicSummary}</p> : null}
      <div className="button-row">
        <button type="button" onClick={() => navigate(`/football/matches/${item.matchId}/public-eligibility`)}>
          Maç public uygunluğu
        </button>
        <button type="button" onClick={() => navigate(`/football/matches/${item.matchId}/prediction-settlements`)}>
          Settlement incele
        </button>
      </div>
    </article>
  );
}

function PublicEligibilityGuardNotice() {
  return (
    <section className="notice">
      <strong>Settled success otomatik public yayın anlamına gelmez.</strong>
      <span>Maçtan sonra üretilen tahminler public kanıt olarak kullanılamaz. Uzak Dur / blocked / audit-only adaylar public başarılı tahmin olamaz. Bu ekranda yayınlama veya onaylama kontrolü yoktur.</span>
    </section>
  );
}

function publicBlockerLabel(value: string) {
  if (value === "generated_after_kickoff") return "Maçtan sonra üretildi";
  if (value === "not_settled_success") return "Settlement başarılı değil";
  if (value === "recommendation_tier_not_public") return "Seviye public uygun değil";
  if (value === "consistency_not_allowed") return "Tutarlılık durumu uygun değil";
  if (value === "audit_only") return "Audit-only";
  if (value === "blocking_conflict") return "Bloke çakışma var";
  if (value === "unsafe_metadata") return "Public için güvenli olmayan metadata";
  if (value === "unsupported_prediction_type") return "Tahmin tipi desteklenmiyor";
  return value;
}

function tierLabel(value: string | null) {
  if (value === "primary") return "Tahminim";
  if (value === "try") return "Denenir";
  if (value === "alternative") return "Alternatif";
  if (value === "avoid") return "Uzak Dur";
  return "Taslak";
}

function tierClass(value: string) {
  if (value === "primary") return "badge-tier-primary";
  if (value === "try") return "badge-tier-try";
  if (value === "avoid") return "badge-tier-avoid";
  return "badge-muted";
}

function consistencyClass(value: string) {
  if (value === "draft") return "badge-muted";
  if (value === "warning") return "badge-warn";
  if (value === "blocked" || value === "blocking") return "badge-danger";
  if (value === "passed") return "badge-good";
  if (value === "settled_success") return "badge-good";
  if (value === "settled_failed") return "badge-danger";
  if (value === "settled_void") return "badge-warn";
  return "badge-muted";
}

function draftStatusLabel(value: string) {
  if (value === "draft") return "Taslak";
  if (value === "warning") return "Uyarı";
  if (value === "blocked" || value === "blocking") return "Bloke";
  if (value === "passed") return "Geçti";
  if (value === "unchecked") return "Kontrol edilmedi";
  if (value === "info") return "Bilgi";
  if (value === "settled_success") return "Başarılı";
  if (value === "settled_failed") return "Başarısız";
  if (value === "settled_void") return "Geçersiz";
  return value;
}

function settlementStatusLabel(value: string) {
  if (value === "settled_success") return "Başarılı";
  if (value === "settled_failed") return "Başarısız";
  if (value === "settled_void") return "Geçersiz";
  return value;
}

export function Shell({
  children,
  currentPath,
  navigate,
  user,
  onLogout,
  routeLoading
}: {
  children: ReactNode;
  currentPath: string;
  navigate: (path: string) => void;
  user: AuthUser;
  onLogout: () => Promise<void>;
  routeLoading: boolean;
}) {
  const [adminMenuOpen, setAdminMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userInitial = user.email.trim().charAt(0).toUpperCase() || "S";
  const isAdmin = user.role === "admin";
  const closeMenus = () => {
    setAdminMenuOpen(false);
    setUserMenuOpen(false);
  };

  useEffect(() => {
    if (!adminMenuOpen && !userMenuOpen) return;
    const onPointerDown = (event: globalThis.MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.closest(".tb-menu") || target.closest(".tb-user"))) return;
      closeMenus();
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") closeMenus();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [adminMenuOpen, userMenuOpen]);

  const go = (path: string) => {
    closeMenus();
    navigate(path);
  };

  return (
    <div className="topshell">
      <header className="topband">
        <div className="topband-in">
          <button className="tb-brand" type="button" onClick={() => go("/")} aria-label="SkorIQ ana sayfa">
            <BrandMark size={26} /><span className="brand-text">Skor<i>IQ</i></span>
          </button>
          <nav className="tb-nav" aria-label="Dashboard navigation">
            <TopNavLink label="Genel Bakış" path="/" currentPath={currentPath} navigate={go} />
            <TopNavLink label="Maç Analizi" path="/football/analytics" currentPath={currentPath} navigate={go} />
            <TopNavLink label="Futbol Keşfi" path="/football" currentPath={currentPath} navigate={go} activeWhen={(path) => path === "/football" || path.startsWith("/football/countries")} />
            <TopNavLink label="Takımlar" path="/football/teams" currentPath={currentPath} navigate={go} />
            <TopNavLink label="Ligler" path="/football/competitions" currentPath={currentPath} navigate={go} />
            <TopNavLink label="Sonuçlar" path="/football/prediction-results" currentPath={currentPath} navigate={go} />
            <span className="tb-soon" title="Basketbol modülü yakında">Basketbol · yakında</span>
          </nav>
          <div className="tb-actions">
            {isAdmin ? (
              <div className={`tb-menu${adminMenuOpen ? " open" : ""}`}>
                <button
                  type="button"
                  className="tb-menu-btn"
                  aria-expanded={adminMenuOpen}
                  aria-haspopup="true"
                  onClick={() => {
                    setUserMenuOpen(false);
                    setAdminMenuOpen((value) => !value);
                  }}
                >
                  <NavIcon name="shield" />
                  <span>İç Denetim</span>
                  <span className="tb-caret" aria-hidden="true">▾</span>
                </button>
                <div className="tb-pop" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    className={`tb-pop-item${currentPath.startsWith("/football/predictions/drafts") || currentPath.includes("/prediction-drafts") ? " tb-pop-item-active" : ""}`}
                    onClick={() => go("/football/predictions/drafts")}
                  >
                    Draft Tahminler
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className={`tb-pop-item${currentPath.startsWith("/football/predictions/settlements") || currentPath.includes("/prediction-settlements") ? " tb-pop-item-active" : ""}`}
                    onClick={() => go("/football/predictions/settlements")}
                  >
                    Tahmin Sonuçları
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className={`tb-pop-item${currentPath.startsWith("/football/public-eligibility") || currentPath.includes("/public-eligibility") ? " tb-pop-item-active" : ""}`}
                    onClick={() => go("/football/public-eligibility")}
                  >
                    Public Uygunluk
                  </button>
                  <p className="tb-pop-note">Bu panel yalnızca iç analiz ve denetim amaçlıdır. Public yayın yapılmaz.</p>
                </div>
              </div>
            ) : null}
            <div className={`tb-user${userMenuOpen ? " open" : ""}`}>
              <button
                type="button"
                className="tb-user-btn"
                aria-expanded={userMenuOpen}
                aria-haspopup="true"
                onClick={() => {
                  setAdminMenuOpen(false);
                  setUserMenuOpen((value) => !value);
                }}
              >
                <span className="user-avatar" aria-hidden="true">{userInitial}</span>
                <span className="tb-user-mail">{user.email}</span>
                <span className={`tb-role${isAdmin ? " tb-role-admin" : ""}`}>{user.role}</span>
              </button>
              <div className="tb-pop tb-pop-right" role="menu">
                <div className="tb-pop-info">
                  <strong>{user.email}</strong>
                  <span>{isAdmin ? "İç denetim yetkisi" : "Üye hesabı"}</span>
                </div>
                <button type="button" className="tb-logout" onClick={() => void onLogout()}>
                  <NavIcon name="logout" />
                  <span>Çıkış Yap</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>
      <main className="page-container">
        {children}
        {routeLoading ? <RouteTransitionLoader /> : null}
      </main>
    </div>
  );
}

function TopNavLink({ label, path, currentPath, navigate, activeWhen }: {
  label: string;
  path: string;
  currentPath: string;
  navigate: (path: string) => void;
  activeWhen?: (path: string) => boolean;
}) {
  const active = activeWhen ? activeWhen(currentPath) : path === "/" ? currentPath === "/" : currentPath.startsWith(path);
  return (
    <button
      type="button"
      className={`tb-link${active ? " tb-link-active" : ""}`}
      onClick={() => navigate(path)}
      aria-current={active ? "page" : undefined}
    >
      {label}
    </button>
  );
}

function RouteTransitionLoader() {
  return (
    <div className="route-transition-loader" role="status" aria-live="polite" aria-label="Sayfa yükleniyor">
      <div className="route-loader-card">
        <div className="route-loader-logo" aria-hidden="true">
          <span className="route-loader-logo-base"><BrandMark size={76} /></span>
          <span className="route-loader-logo-fill"><BrandMark size={76} /></span>
        </div>
        <strong>Yükleniyor</strong>
      </div>
    </div>
  );
}

type NavIconName =
  | "overview"
  | "analytics"
  | "drafts"
  | "results"
  | "teams"
  | "leagues"
  | "basketball"
  | "provider"
  | "users"
  | "settings"
  | "globe"
  | "shield"
  | "logout"
  | "collapse"
  | "expand"
  | "menu";

function BrandMark({ size = 26 }: { size?: number }) {
  return <SkorIQMark size={size} className="brand-mark" />;
}

function NavIcon({ name }: { name: NavIconName }) {
  const paths: Record<NavIconName, ReactNode> = {
    overview: (
      <>
        <path d="M4 10.5 12 4l8 6.5" />
        <path d="M6.5 10v8.5h4v-5h3v5h4V10" />
      </>
    ),
    analytics: (
      <>
        <path d="M4 17V9" />
        <path d="M9.3 17V6.5" />
        <path d="M14.6 17v-5.8" />
        <path d="M19.5 17V4.5" />
        <path d="M4 19.5h16" />
      </>
    ),
    drafts: (
      <>
        <path d="M6 4.5h8.5L18 8v11.5H6z" />
        <path d="M14.5 4.5V8H18" />
        <path d="M8.5 12h7" />
        <path d="M8.5 15h5" />
      </>
    ),
    results: (
      <>
        <path d="M5 12.5 9.2 17 19 7" />
        <path d="M4 4.5h16v15H4z" />
      </>
    ),
    teams: (
      <>
        <path d="M8.2 11.2a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
        <path d="M15.8 11.2a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
        <path d="M3.8 19c.6-3 2.3-4.7 4.4-4.7s3.8 1.7 4.4 4.7" />
        <path d="M11.4 19c.6-3 2.3-4.7 4.4-4.7 2 0 3.7 1.7 4.4 4.7" />
      </>
    ),
    leagues: (
      <>
        <path d="M5 5h14v4H5z" />
        <path d="M5 10.5h14v4H5z" />
        <path d="M5 16h14v3H5z" />
      </>
    ),
    basketball: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M4.6 10h14.8" />
        <path d="M4.6 14h14.8" />
        <path d="M12 4a12 12 0 0 0 0 16" />
        <path d="M12 4a12 12 0 0 1 0 16" />
      </>
    ),
    provider: (
      <>
        <path d="M6 7.5h12" />
        <path d="M6 12h12" />
        <path d="M6 16.5h12" />
        <path d="M3.8 7.5h.1" />
        <path d="M3.8 12h.1" />
        <path d="M3.8 16.5h.1" />
      </>
    ),
    users: (
      <>
        <path d="M9 11.5a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z" />
        <path d="M3.8 19c.6-3.3 2.6-5 5.2-5s4.6 1.7 5.2 5" />
        <path d="M16.2 11.5a2.6 2.6 0 1 0 0-5.2" />
        <path d="M15.2 14.2c2.5.2 4.2 1.8 4.9 4.8" />
      </>
    ),
    settings: (
      <>
        <path d="M12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6Z" />
        <path d="m19.4 15.2-.9 1.6 1.2 2.2-2 1.2-1.5-1.2a8 8 0 0 1-1.9.8l-.5 1.8h-2.4l-.5-1.8a8 8 0 0 1-1.9-.8l-1.5 1.2-2-1.2 1.2-2.2-.9-1.6-2.1-.6v-2.3l2.1-.6.9-1.6-1.2-2.2 2-1.2L8 7.9c.6-.3 1.2-.6 1.9-.8l.5-1.8h2.4l.5 1.8c.7.2 1.3.5 1.9.8l1.5-1.2 2 1.2-1.2 2.2.9 1.6 2.1.6v2.3z" />
      </>
    ),
    shield: (
      <>
        <path d="M12 3.8 19 6v5.4c0 4.2-2.8 7.3-7 8.8-4.2-1.5-7-4.6-7-8.8V6z" />
        <path d="m9 12.2 2 2 4-4.4" />
      </>
    ),
    logout: (
      <>
        <path d="M10 6H6.5v12H10" />
        <path d="M13.5 8.5 17 12l-3.5 3.5" />
        <path d="M17 12H9" />
      </>
    ),
    collapse: (
      <>
        <path d="M15 6 9 12l6 6" />
        <path d="M20 6v12" />
      </>
    ),
    expand: (
      <>
        <path d="m9 6 6 6-6 6" />
        <path d="M4 6v12" />
      </>
    ),
    menu: (
      <>
        <path d="M4 7h16" />
        <path d="M4 12h16" />
        <path d="M4 17h16" />
      </>
    ),
    globe: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M2 12h20" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </>
    )
  };

  return (
    <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

function StatePanel({ title, body }: { title: string; body?: string }) {
  return (
    <section className="panel state-panel">
      <h2>{title}</h2>
      {body ? <p>{body}</p> : null}
    </section>
  );
}

function useLoad<T>(loader: () => Promise<T>, deps: DependencyList) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    loader()
      .then((response) => {
        if (!cancelled) setData(response);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Failed to load dashboard data.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, deps);

  return { data, loading, error };
}

function resolveRoute(path: string):
  | { kind: "landing" }
  | { kind: "overview" }
  | { kind: "login" }
  | { kind: "register" }
  | { kind: "forgot-password" }
  | { kind: "reset-password" }
  | { kind: "match-list" }
  | { kind: "match-detail"; id: string }
  | { kind: "team-list" }
  | { kind: "team-detail"; id: string }
  | { kind: "player-detail"; id: string }
  | { kind: "competition-list" }
  | { kind: "competition-detail"; id: string }
  | { kind: "country-list" }
  | { kind: "country-detail"; id: string }
  | { kind: "draft-list" }
  | { kind: "draft-detail"; id: string }
  | { kind: "match-drafts"; id: string }
  | { kind: "prediction-results" }
  | { kind: "settlement-list" }
  | { kind: "settlement-detail"; id: string }
  | { kind: "match-settlements"; id: string }
  | { kind: "public-eligibility-list" }
  | { kind: "match-public-eligibility"; id: string } {
  if (path === "/") return { kind: "landing" };
  const matchDetail = path.match(/^\/football\/analytics\/([^/]+)$/);
  if (path === "/login") return { kind: "login" };
  if (path === "/register") return { kind: "register" };
  if (path === "/forgot-password") return { kind: "forgot-password" };
  if (path === "/reset-password") return { kind: "reset-password" };
  if (matchDetail?.[1]) return { kind: "match-detail", id: matchDetail[1] };
  const draftDetail = path.match(/^\/football\/predictions\/drafts\/([^/]+)$/);
  if (draftDetail?.[1]) return { kind: "draft-detail", id: draftDetail[1] };
  const settlementDetail = path.match(/^\/football\/predictions\/settlements\/([^/]+)$/);
  if (settlementDetail?.[1]) return { kind: "settlement-detail", id: settlementDetail[1] };
  const matchDrafts = path.match(/^\/football\/matches\/([^/]+)\/prediction-drafts$/);
  if (matchDrafts?.[1]) return { kind: "match-drafts", id: matchDrafts[1] };
  const matchSettlements = path.match(/^\/football\/matches\/([^/]+)\/prediction-settlements$/);
  if (matchSettlements?.[1]) return { kind: "match-settlements", id: matchSettlements[1] };
  const matchPublicEligibility = path.match(/^\/football\/matches\/([^/]+)\/public-eligibility$/);
  if (matchPublicEligibility?.[1]) return { kind: "match-public-eligibility", id: matchPublicEligibility[1] };
  const teamDetail = path.match(/^\/football\/teams\/([^/]+)$/);
  if (teamDetail?.[1]) return { kind: "team-detail", id: teamDetail[1] };
  const playerDetail = path.match(/^\/football\/players\/([^/]+)$/);
  if (playerDetail?.[1]) return { kind: "player-detail", id: playerDetail[1] };
  const competitionDetail = path.match(/^\/football\/competitions\/([^/]+)$/);
  if (competitionDetail?.[1]) return { kind: "competition-detail", id: competitionDetail[1] };
  const countryDetail = path.match(/^\/football\/countries\/([^/]+)$/);
  if (countryDetail?.[1]) return { kind: "country-detail", id: countryDetail[1] };
  if (path === "/football/analytics") return { kind: "match-list" };
  if (path === "/football/prediction-results") return { kind: "prediction-results" };
  if (path === "/football/predictions/drafts") return { kind: "draft-list" };
  if (path === "/football/predictions/settlements") return { kind: "settlement-list" };
  if (path === "/football/public-eligibility") return { kind: "public-eligibility-list" };
  if (path === "/football/teams") return { kind: "team-list" };
  if (path === "/football/competitions") return { kind: "competition-list" };
  if (path === "/football") return { kind: "country-list" };
  return { kind: "overview" };
}

function isAdminOnlyRoute(route: ReturnType<typeof resolveRoute>) {
  return (
    route.kind === "draft-list" ||
    route.kind === "draft-detail" ||
    route.kind === "match-drafts" ||
    route.kind === "settlement-list" ||
    route.kind === "settlement-detail" ||
    route.kind === "match-settlements" ||
    route.kind === "public-eligibility-list" ||
    route.kind === "match-public-eligibility"
  );
}

function parseBooleanFilter(value: string): boolean | "" {
  if (value === "true") return true;
  if (value === "false") return false;
  return "";
}

export function CountryListPage({ navigate }: { navigate: (path: string) => void }) {
  const { data: countries, loading: countriesLoading, error: countriesError } = useLoad(() => fetchFootballCountries(), []);
  const { data: compsData, loading: compsLoading, error: compsError } = useLoad(() => fetchFootballCompetitions({ limit: 100 }), []);

  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<"all" | "countries">("all");
  const [countryFilter, setCountryFilter] = useState("all");

  const loading = countriesLoading && compsLoading;
  const error = countriesError || compsError;
  const competitions = useMemo(() => compsData?.items ?? [], [compsData]);

  const totals = useMemo(() => {
    if (!countries && competitions.length === 0) return null;
    return {
      countries: countries?.length ?? new Set(competitions.map((item) => item.country).filter(Boolean)).size,
      competitions: countries ? countries.reduce((s, c) => s + c.competitionCount, 0) : competitions.length,
      teams: countries ? countries.reduce((s, c) => s + c.teamCount, 0) : competitions.reduce((s, c) => s + c.teamsCount, 0),
      matches: countries ? countries.reduce((s, c) => s + c.matchCount, 0) : competitions.reduce((s, c) => s + c.matchesCount, 0),
      upcoming: countries ? countries.reduce((s, c) => s + c.upcomingMatchCount, 0) : 0
    };
  }, [countries, competitions]);

  // Featured marquee leagues (top tier leagues with authentic visuals)
  const featuredCompetitions = useMemo(() => {
    const featuredNames = [
      "premier league",
      "trendyol süper lig",
      "super lig",
      "uefa champions league",
      "champions league",
      "laliga",
      "bundesliga",
      "serie a",
      "ligue 1"
    ];
    return competitions.filter((c) =>
      featuredNames.some((fn) => c.name.toLowerCase().includes(fn))
    );
  }, [competitions]);

  // Available countries for quick chips
  const countryChips = useMemo(() => {
    const set = new Set<string>();
    competitions.forEach((c) => {
      if (c.country) set.add(c.country);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "tr"));
  }, [competitions]);

  // Filtered competitions list
  const filteredCompetitions = useMemo(() => {
    let list = competitions;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          (c.country && c.country.toLowerCase().includes(q))
      );
    }
    if (countryFilter !== "all") {
      list = list.filter((c) => c.country === countryFilter);
    }
    return list;
  }, [competitions, search, countryFilter]);

  // Map competitions grouped by country
  const competitionsByCountry = useMemo(() => {
    const map = new Map<string, typeof competitions>();
    competitions.forEach((c) => {
      const key = c.country ?? "Uluslararası";
      const existing = map.get(key) ?? [];
      existing.push(c);
      map.set(key, existing);
    });
    return map;
  }, [competitions]);

  return (
    <div className="explorer-shell">
      {/* Broadcast Header */}
      <header className="explorer-hero-header">
        <h1 className="explorer-hero-title">Futbol Keşfi</h1>
        <p className="explorer-hero-desc">Ligleri keşfet, takımları ve maç analizlerini incele.</p>
      </header>

      {/* Skeleton Loading (strictly satisfies test suite) */}
      {loading ? (
        <div className="explorer-skeleton-grid" aria-label="Yükleniyor">
          {Array.from({ length: 6 }).map((_, i) => (
            <div className="explorer-skeleton-card" key={i} style={{ animationDelay: `${i * 0.08}s` }}>
              <div className="explorer-skeleton-line explorer-skeleton-line-lg" />
              <div className="explorer-skeleton-line" />
              <div className="explorer-skeleton-line explorer-skeleton-line-sm" />
            </div>
          ))}
        </div>
      ) : null}

      {error ? <StatePanel title="Ülkeler yüklenemedi" body={error} /> : null}

      {!loading && totals ? (
        <>
          {/* Global Telemetry Ribbon — Ultra Clean Tabular Borderless */}
          <section className="explorer-global-stats" aria-label="Global istatistikler">
            <div className="explorer-stat-item">
              <span className="explorer-stat-value">{totals.competitions}</span>
              <span className="explorer-stat-label">Lig / Kupa</span>
            </div>
            <div className="explorer-stat-divider" />
            <div className="explorer-stat-item">
              <span className="explorer-stat-value">{totals.teams.toLocaleString("tr-TR")}</span>
              <span className="explorer-stat-label">Takım</span>
            </div>
            <div className="explorer-stat-divider" />
            <div className="explorer-stat-item">
              <span className="explorer-stat-value">{totals.matches.toLocaleString("tr-TR")}</span>
              <span className="explorer-stat-label">Toplam Maç</span>
            </div>
            <div className="explorer-stat-divider" />
            <div className="explorer-stat-item">
              <span className="explorer-stat-value">{totals.upcoming.toLocaleString("tr-TR")}</span>
              <span className="explorer-stat-label">Yaklaşan</span>
            </div>
            <div className="explorer-stat-divider" />
            <div className="explorer-stat-item">
              <span className="explorer-stat-value">{totals.countries}</span>
              <span className="explorer-stat-label">Ülke</span>
            </div>
          </section>

          {/* Featured competitions */}
          {featuredCompetitions.length > 0 && !search.trim() && countryFilter === "all" ? (
            <section className="featured-leagues-section" aria-label="Öne çıkan turnuvalar">
              <div className="section-title-strip">
                <span className="section-title-label">Öne Çıkan Ligler</span>
              </div>
              <div className="featured-leagues-grid">
                {featuredCompetitions.map((league) => (
                  <button
                    type="button"
                    key={league.competitionId}
                    className="featured-league-card"
                    onClick={() => navigate(`/football/competitions/${league.competitionId}`)}
                  >
                    <div className="featured-card-crest">
                      <CompetitionLogo name={league.name} logoUrl={league.logoUrl} size="md" />
                    </div>
                    <div className="featured-card-info">
                      <span className="featured-card-country">{league.country ?? "Avrupa"}</span>
                      <strong className="featured-card-name">{league.name}</strong>
                      <div className="featured-card-meta">
                        <span><strong>{league.teamsCount}</strong> Takım</span>
                        <span>·</span>
                        <span><strong>{league.matchesCount}</strong> Maç</span>
                      </div>
                    </div>
                    <span className="featured-card-arrow" aria-hidden="true">→</span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          {/* Section 2: Segmented Tabs & Instant League Search */}
          <div className="explorer-controls-shell">
            <div className="explorer-tabs-row">
              <div className="explorer-segmented-tabs" role="group" aria-label="Keşif görünümü">
                <button
                  type="button"
                  aria-pressed={activeTab === "all"}
                  className={`explorer-tab-btn ${activeTab === "all" ? "active" : ""}`}
                  onClick={() => setActiveTab("all")}
                >
                  Tüm Ligler ({competitions.length})
                </button>
                <button
                  type="button"
                  aria-pressed={activeTab === "countries"}
                  className={`explorer-tab-btn ${activeTab === "countries" ? "active" : ""}`}
                  onClick={() => setActiveTab("countries")}
                >
                  Ülkelere Göre ({countries?.length ?? countryChips.length})
                </button>
              </div>

              {/* Instant Search Bar */}
              <div className="explorer-search-box">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
                </svg>
                <input
                  type="search"
                  className="explorer-search-input"
                  placeholder="Lig veya ülke ara"
                  aria-label="Lig veya ülke ara"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                {search ? (
                  <button type="button" className="explorer-search-clear" onClick={() => setSearch("")} aria-label="Aramayı temizle">
                    ✕
                  </button>
                ) : null}
              </div>
            </div>

            {/* Quick Country Filters */}
            {countryChips.length > 0 ? (
              <div className="explorer-country-chips" role="group" aria-label="Ülke filtreleri">
                <button
                  type="button"
                  className={`explorer-chip ${countryFilter === "all" ? "active" : ""}`}
                  onClick={() => setCountryFilter("all")}
                >
                  Tümü ({competitions.length})
                </button>
                {countryChips.map((name) => {
                  const count = competitions.filter((c) => c.country === name).length;
                  return (
                    <button
                      type="button"
                      key={name}
                      className={`explorer-chip ${countryFilter === name ? "active" : ""}`}
                      onClick={() => setCountryFilter(name)}
                    >
                      {name} ({count})
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>

          {/* View Mode 1: All Competitions Grid with Visual Crests */}
          {activeTab === "all" ? (
            <div className="explorer-leagues-grid">
              {filteredCompetitions.length === 0 ? (
                <div className="empty-results-box">
                  <p>Arama kriterinize uygun turnuva bulunamadı.</p>
                </div>
              ) : (
                filteredCompetitions.map((comp) => (
                  <button
                    type="button"
                    key={comp.competitionId}
                    className="explorer-league-row-card"
                    onClick={() => navigate(`/football/competitions/${comp.competitionId}`)}
                  >
                    <div className="league-row-crest-wrap">
                      <CompetitionLogo name={comp.name} logoUrl={comp.logoUrl} size="md" />
                    </div>
                    <div className="league-row-details">
                      <div className="league-row-title-strip">
                        <h3 className="league-row-title">{comp.name}</h3>
                        <span className="league-row-country-tag">{comp.country ?? "Uluslararası"}</span>
                      </div>
                      <div className="league-row-metrics">
                        <span className="league-stat"><strong>{comp.teamsCount}</strong> Takım</span>
                        <span className="league-stat-sep">·</span>
                        <span className="league-stat"><strong>{comp.matchesCount}</strong> Maç</span>
                        {comp.readyMatchesCount > 0 ? (
                          <>
                            <span className="league-stat-sep">·</span>
                            <span className="league-ready-pill">{comp.readyMatchesCount} Analize Hazır</span>
                          </>
                        ) : null}
                        {comp.averageCoverage != null ? (
                          <span className="league-cov-pill">%{Math.round(comp.averageCoverage)} Kapsam</span>
                        ) : null}
                      </div>
                    </div>
                    <div className="league-row-action">
                      <span>Ligi İncele</span>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
                    </div>
                  </button>
                ))
              )}
            </div>
          ) : (
            /* View Mode 2: Grouped by Country with Visual League Badges */
            <div className="country-stream-grid">
              {Array.from(competitionsByCountry.entries())
                .filter(([countryName]) => countryFilter === "all" || countryFilter === countryName)
                .filter(([countryName, countryComps]) => {
                  if (!search.trim()) return true;
                  const q = search.trim().toLowerCase();
                  return countryName.toLowerCase().includes(q) || countryComps.some((c) => c.name.toLowerCase().includes(q));
                })
                .map(([countryName, countryComps]) => {
                  const countryObj = countries?.find((c) => c.name.toLowerCase() === countryName.toLowerCase());
                  const countryId = countryObj?.id;
                  const totalTeams = countryComps.reduce((s, c) => s + c.teamsCount, 0);
                  const totalMatches = countryComps.reduce((s, c) => s + c.matchesCount, 0);

                  return (
                    <article key={countryName} className="country-stream-block">
                      <header className="country-stream-header">
                        <div className="country-stream-identity">
                          {countryObj?.logoUrl ? (
                            <img src={countryObj.logoUrl} alt="" className="country-stream-flag" loading="lazy" />
                          ) : (
                            <span className="country-stream-initials">{countryName.slice(0, 2).toUpperCase()}</span>
                          )}
                          <div>
                            <h2 className="country-stream-name">{countryName}</h2>
                            <p className="country-stream-meta">
                              {countryComps.length} Lig · {totalTeams} Takım · {totalMatches} Karşılaşma
                            </p>
                          </div>
                        </div>
                        {countryId ? (
                          <button
                            type="button"
                            className="country-stream-view-all"
                            onClick={() => navigate(`/football/countries/${countryId}`)}
                          >
                            Ülke Sayfası →
                          </button>
                        ) : null}
                      </header>

                      {/* Visual League Badges inside this Country */}
                      <div className="country-leagues-shelf">
                        {countryComps.map((comp) => (
                          <button
                            type="button"
                            key={comp.competitionId}
                            className="country-league-pill-btn"
                            onClick={() => navigate(`/football/competitions/${comp.competitionId}`)}
                          >
                            <div className="pill-btn-crest">
                              <CompetitionLogo name={comp.name} logoUrl={comp.logoUrl} size="sm" />
                            </div>
                            <div className="pill-btn-info">
                              <strong className="pill-comp-name">{comp.name}</strong>
                              <span className="pill-comp-meta">{comp.teamsCount} Takım · {comp.matchesCount} Maç</span>
                            </div>
                            <span className="pill-btn-arrow" aria-hidden="true">→</span>
                          </button>
                        ))}
                      </div>
                    </article>
                  );
                })}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

export function CountryDetailPage({ countryId, navigate }: { countryId: string; navigate: (path: string) => void }) {
  const { data: competitions, loading, error } = useLoad(() => fetchFootballCountryCompetitions(countryId), [countryId]);

  const statusLabel = (s: string) => {
    if (s === "ready") return "Hazır";
    if (s === "partial") return "Kısmi";
    if (s === "insufficient") return "Veri bekleniyor";
    return s;
  };

  const statusClass = (s: string) => {
    if (s === "ready") return "status-badge status-ready";
    if (s === "partial") return "status-badge status-partial";
    return "status-badge status-insufficient";
  };

  const countryName = competitions?.[0]?.country.name ?? "Ülke";

  return (
    <div className="country-detail-shell">
      <button className="back-button" type="button" onClick={() => navigate("/football")}>
        ← Ülkelere dön
      </button>
      <header className="country-detail-hero">
        <h1 className="country-detail-title">{countryName}</h1>
        <p className="country-detail-desc">{competitions ? `${competitions.length} resmi lig ve kupa turnuvası` : "Ligler yükleniyor..."}</p>
      </header>

      {loading ? <StatePanel title="Ligler yükleniyor..." /> : null}
      {error ? <StatePanel title="Ligler yüklenemedi" body={error} /> : null}

      {competitions ? (
        <div className="country-leagues-list">
          {competitions.map((league) => (
            <button
              type="button"
              className="country-league-detail-card"
              key={league.id}
              onClick={() => navigate(`/football/competitions/${league.id}`)}
            >
              <div className="cld-crest-wrap">
                <CompetitionLogo name={league.name} logoUrl={league.logoUrl} size="md" />
              </div>
              <div className="cld-main-info">
                <div className="cld-title-row">
                  <h3 className="cld-name">{league.name}</h3>
                  <span className={statusClass(league.dataStatus)}>{statusLabel(league.dataStatus)}</span>
                </div>
                <div className="cld-telemetry-row">
                  <span><strong>{league.teamCount}</strong> Takım</span>
                  <span>·</span>
                  <span><strong>{league.standingRows}</strong> Sıralama</span>
                  <span>·</span>
                  <span><strong>{league.finishedMatchCount}</strong> Sonuç</span>
                  <span>·</span>
                  <span><strong>{league.upcomingMatchCount}</strong> Fikstür</span>
                  {league.averageCoverage != null ? (
                    <span className="cld-cov-badge">%{Math.round(league.averageCoverage)} Kapsam</span>
                  ) : null}
                </div>
              </div>
              <span className="cld-cta">Ligi Aç →</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
