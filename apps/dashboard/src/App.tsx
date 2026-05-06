import { useEffect, useMemo, useState } from "react";
import type { DependencyList, FormEvent, KeyboardEvent, ReactNode } from "react";
import {
  fetchDashboardOverview,
  fetchFootballAnalyticsMatch,
  fetchFootballAnalyticsMatches,
  fetchFootballCompetitions,
  fetchFootballCountries,
  fetchFootballCountryCompetitions,
  fetchFootballCompetitionProfile,
  fetchFootballMemberPredictionPreview,
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
  fetchFootballTeamProfile,
  fetchFootballTeams,
  fetchCurrentUser,
  ApiError,
  login as loginRequest,
  requestPasswordReset as requestPasswordResetRequest,
  register as registerRequest,
  resetPassword as resetPasswordRequest,
  logout as logoutRequest
} from "./api";
import { MetricCard, ProgressBar, StatusBadge, TeamLogo } from "./components";
import { formatDate, formatDateTime, formatDecimal, formatPercent, formatRatePercent, statusLabel } from "./format";
import skoriqLogo from "./assets/skoriq-logo-wordmark.png";
import skoriqMark from "./assets/skoriq-logo.png";
import type {
  FeatureStatus,
  AuthUser,
  DashboardOverviewResponse,
  DashboardUpcomingMatch,
  FootballAnalyticsMatchReport,
  FootballAnalyticsMatchFilters,
  FootballAnalyticsMatchListResponse,
  FootballCompetitionsListResponse,
  FootballMatchPredictionDraftsResponse,
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
  FootballTeamProfileResponse,
  FootballTeamProfileFormSummary,
  FootballTeamProfileRecentMatch,
  FootballTeamProfileUpcomingMatch,
  RecommendationTier
} from "./types";
import "./styles.css";

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
        placeholder="Takım, lig veya maç ara…"
        aria-label="Maç ara"
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
  const chips: { id: QuickChipId; label: string; count?: number }[] = [
    { id: "all", label: "Tümü" },
    { id: "ready", label: "Hazır", count: counts.ready },
    { id: "predictionEligible", label: "Tahmine uygun", count: counts.predictionEligible },
    { id: "within24h", label: "36 saat içinde", count: counts.within24h },
    { id: "hasH2h", label: "H2H mevcut", count: counts.hasH2h },
    { id: "hasPrediction", label: "Tahmin var", count: counts.hasPrediction },
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
    const labels: Record<string, string> = { ready: "Hazır", partial: "Kısmi", insufficient_data: "Yetersiz" };
    pills.push({ key: "featureStatus", label: `Durum: ${labels[filters.featureStatus] ?? filters.featureStatus}` });
  }
  if (filters.predictionEligible !== "" && filters.predictionEligible !== undefined) {
    pills.push({ key: "predictionEligible", label: `Tahmin: ${filters.predictionEligible ? "Uygun" : "Uygun değil"}` });
  }
  if (filters.kuponEligible !== "" && filters.kuponEligible !== undefined) {
    pills.push({ key: "kuponEligible", label: `Sonuç: ${filters.kuponEligible ? "Aktif" : "Pasif"}` });
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
    pills.push({ key: "within24h", label: "36 saat içinde" });
  }
  if (frontendFilters.hasH2h || quickChip === "hasH2h") {
    pills.push({ key: "hasH2h", label: "H2H mevcut" });
  }
  if (frontendFilters.hasPrediction || quickChip === "hasPrediction") {
    pills.push({ key: "hasPrediction", label: "Tahmin var" });
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
          ? `Sayfa ${page.toLocaleString("tr-TR")} · Gösterilen: ${start.toLocaleString("tr-TR")}–${end.toLocaleString("tr-TR")} · Toplam: ${total.toLocaleString("tr-TR")}`
          : `Sayfa ${page.toLocaleString("tr-TR")} · Gösterilen: ${showing.toLocaleString("tr-TR")} · Toplam: ${total.toLocaleString("tr-TR")}`}
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
  const title = apiHasData ? "Eşleşen maç bulunamadı." : "Yaklaşan analiz maçı bulunmuyor.";
  const body = apiHasData
    ? "Takım adı, lig adı veya farklı bir arama terimi deneyebilirsin."
    : "Biten maçlar ve tahmin sonuçları için Sonuçlar sayfasına git.";

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
          Sonuçlar sayfasına git →
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
    setCurrentUser(null);
    navigate("/login");
  };

  if (authLoading) {
    return (
      <main className="login-shell">
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
    <Shell currentPath={path} navigate={navigate} user={currentUser} onLogout={handleLogout} routeLoading={routeLoading}>
      {forbidden ? <ForbiddenPage navigate={navigate} /> : null}
      {!forbidden && (
        <>
      {shouldRenderOverviewPage(route.kind) ? <OverviewPage navigate={navigate} user={currentUser} /> : null}
      {route.kind === "match-list" ? <MatchListPage navigate={navigate} /> : null}
      {route.kind === "match-detail" ? <MatchDetailPage matchId={route.id} navigate={navigate} user={currentUser} /> : null}
      {route.kind === "team-list" ? <TeamListPage navigate={navigate} /> : null}
      {route.kind === "team-detail" ? <TeamDetailPage teamId={route.id} navigate={navigate} /> : null}
      {route.kind === "competition-list" ? <CompetitionListPage navigate={navigate} /> : null}
      {route.kind === "competition-detail" ? <CompetitionDetailPage competitionId={route.id} navigate={navigate} /> : null}
      {route.kind === "country-list" ? <CountryListPage navigate={navigate} /> : null}
      {route.kind === "country-detail" ? <CountryDetailPage countryId={route.id} navigate={navigate} /> : null}
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
    </Shell>
  );
}

export function shouldRenderOverviewPage(routeKind: ReturnType<typeof resolveRoute>["kind"]) {
  return routeKind === "overview" || routeKind === "landing";
}

function LoginPage({ onLogin, navigate }: { onLogin: (user: AuthUser) => void; navigate: (path: string) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const response = await loginRequest(email, password);
      onLogin(response.user);
      navigate("/football/analytics");
    } catch (error) {
      setError(error instanceof ApiError && error.status < 500 ? error.message : "Giriş servisine şu an ulaşılamıyor. Lütfen birazdan tekrar deneyin.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="login-shell">
      <section className="login-experience" aria-label="SkorIQ giriş ekranı">
        <div className="login-intelligence" aria-hidden="true">
          <div className="brain-stage">
            <div className="brain-orbit brain-orbit-one" />
            <div className="brain-orbit brain-orbit-two" />
            <div className="brain-core">
              <span className="brain-node node-a" />
              <span className="brain-node node-b" />
              <span className="brain-node node-c" />
              <span className="brain-node node-d" />
              <span className="brain-node node-e" />
              <span className="brain-path path-a" />
              <span className="brain-path path-b" />
              <span className="brain-path path-c" />
              <span className="brain-bar bar-a" />
              <span className="brain-bar bar-b" />
              <span className="brain-bar bar-c" />
              <span className="brain-bar bar-d" />
            </div>
            <span className="data-chip chip-a">Senin için analiz yapıyorum</span>
            <span className="data-chip chip-b">Bu maçta tempo yüksek olabilir</span>
            <span className="data-chip chip-c">Verileri karşılaştırıyorum</span>
            <span className="data-chip chip-d">2.5 üst ihtimalini inceliyorum</span>
          </div>
        </div>
        <section className="login-card">
          <div className="login-brand">
            <img src={skoriqLogo} alt="SkorIQ" />
          </div>
          <form className="login-form" onSubmit={submit}>
            <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" placeholder="E-posta" aria-label="E-posta" required />
            <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" placeholder="Şifre" aria-label="Şifre" required />
            {error ? <p className="error-text">{error}</p> : null}
            <button type="submit" disabled={loading}>
              {loading ? "Giriş yapılıyor..." : "Giriş yap"}
            </button>
          </form>
          <p className="auth-link-row">
            <button type="button" className="text-link" onClick={() => navigate("/forgot-password")}>
              Şifremi unuttum
            </button>
          </p>
          <p className="auth-switch">
            Hesabın yok mu?{" "}
            <button type="button" className="text-link" onClick={() => navigate("/register")}>
              Kayıt ol
            </button>
          </p>
        </section>
      </section>
    </main>
  );
}

function ForgotPasswordPage({ navigate }: { navigate: (path: string) => void }) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await requestPasswordResetRequest(email);
      setSuccess(response.message);
    } catch (error) {
      setError(error instanceof ApiError && error.status < 500 ? error.message : "Şifre sıfırlama servisine şu an ulaşılamıyor. Lütfen birazdan tekrar deneyin.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="login-shell">
      <section className="login-experience" aria-label="SkorIQ şifre sıfırlama ekranı">
        <div className="login-intelligence" aria-hidden="true">
          <div className="brain-stage">
            <div className="brain-orbit brain-orbit-one" />
            <div className="brain-orbit brain-orbit-two" />
            <div className="brain-core">
              <span className="brain-node node-a" />
              <span className="brain-node node-b" />
              <span className="brain-node node-c" />
              <span className="brain-node node-d" />
              <span className="brain-node node-e" />
              <span className="brain-path path-a" />
              <span className="brain-path path-b" />
              <span className="brain-path path-c" />
              <span className="brain-bar bar-a" />
              <span className="brain-bar bar-b" />
              <span className="brain-bar bar-c" />
              <span className="brain-bar bar-d" />
            </div>
            <span className="data-chip chip-a">Guvenli baglanti hazirlaniyor</span>
            <span className="data-chip chip-b">Hesap erisimi geri aliniyor</span>
            <span className="data-chip chip-c">Mail teslimi kontrol ediliyor</span>
            <span className="data-chip chip-d">Tek kullanimlik baglanti olusturuluyor</span>
          </div>
        </div>
        <section className="login-card">
          <div className="login-brand">
            <img src={skoriqLogo} alt="SkorIQ" />
          </div>
          <div className="auth-copy">
            <h1>Şifreni yenile</h1>
            <p>E-posta adresini gir. Hesabın varsa sana güvenli bir yenileme bağlantısı gönderelim.</p>
          </div>
          <form className="login-form" onSubmit={submit}>
            <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" placeholder="E-posta" aria-label="E-posta" required />
            {error ? <p className="error-text">{error}</p> : null}
            {success ? <p className="success-text">{success}</p> : null}
            <button type="submit" disabled={loading}>
              {loading ? "Baglanti hazirlaniyor..." : "Sıfırlama bağlantısı gönder"}
            </button>
          </form>
          <p className="auth-switch">
            <button type="button" className="text-link" onClick={() => navigate("/login")}>
              Giriş ekranına dön
            </button>
          </p>
        </section>
      </section>
    </main>
  );
}

function ResetPasswordPage({ navigate }: { navigate: (path: string) => void }) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const token = new URLSearchParams(window.location.search).get("token")?.trim() ?? "";

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token) {
      setError("Şifre sıfırlama bağlantısı eksik veya geçersiz.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Şifre onayı eşleşmiyor.");
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await resetPasswordRequest({ token, password, confirmPassword });
      setSuccess(response.message);
      window.setTimeout(() => navigate("/login"), 1200);
    } catch (error) {
      setError(error instanceof ApiError && error.status < 500 ? error.message : "Şifre yenileme işlemi şu an tamamlanamıyor. Lütfen birazdan tekrar deneyin.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="login-shell">
      <section className="login-experience" aria-label="SkorIQ yeni şifre ekranı">
        <div className="login-intelligence" aria-hidden="true">
          <div className="brain-stage">
            <div className="brain-orbit brain-orbit-one" />
            <div className="brain-orbit brain-orbit-two" />
            <div className="brain-core">
              <span className="brain-node node-a" />
              <span className="brain-node node-b" />
              <span className="brain-node node-c" />
              <span className="brain-node node-d" />
              <span className="brain-node node-e" />
              <span className="brain-path path-a" />
              <span className="brain-path path-b" />
              <span className="brain-path path-c" />
              <span className="brain-bar bar-a" />
              <span className="brain-bar bar-b" />
              <span className="brain-bar bar-c" />
              <span className="brain-bar bar-d" />
            </div>
            <span className="data-chip chip-a">Yeni sifre güvenliği ölçülüyor</span>
            <span className="data-chip chip-b">Erisim anahtari dogrulaniyor</span>
            <span className="data-chip chip-c">Hesap kalkanlari yenileniyor</span>
            <span className="data-chip chip-d">Oturum yeniden hazirlaniyor</span>
          </div>
        </div>
        <section className="login-card">
          <div className="login-brand">
            <img src={skoriqLogo} alt="SkorIQ" />
          </div>
          <div className="auth-copy">
            <h1>Yeni şifreni belirle</h1>
            <p>En az 12 karakter; büyük harf, küçük harf ve rakam içeren güçlü bir şifre kullan.</p>
          </div>
          {!token ? <p className="error-text">Şifre sıfırlama bağlantısı eksik veya geçersiz.</p> : null}
          <form className="login-form" onSubmit={submit}>
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              autoComplete="new-password"
              placeholder="Yeni şifre"
              aria-label="Yeni şifre"
              minLength={12}
              required
            />
            <input
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              type="password"
              autoComplete="new-password"
              placeholder="Yeni şifre tekrar"
              aria-label="Yeni şifre tekrar"
              minLength={12}
              required
            />
            {error ? <p className="error-text">{error}</p> : null}
            {success ? <p className="success-text">{success}</p> : null}
            <button type="submit" disabled={loading || !token}>
              {loading ? "Şifre güncelleniyor..." : "Şifreyi güncelle"}
            </button>
          </form>
          <p className="auth-switch">
            <button type="button" className="text-link" onClick={() => navigate("/login")}>
              Giriş ekranına dön
            </button>
          </p>
        </section>
      </section>
    </main>
  );
}

function RegisterPage({ onRegister, navigate }: { onRegister: (user: AuthUser) => void; navigate: (path: string) => void }) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [mathChallenge, setMathChallenge] = useState(() => createMathChallenge());
  const [mathAnswer, setMathAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    if (password !== confirmPassword) {
      setError("Şifre onayı eşleşmiyor.");
      setLoading(false);
      return;
    }
    if (mathAnswer.trim() === "" || Number(mathAnswer) !== mathChallenge.answer) {
      setError("Güvenlik sorusunu kontrol edip tekrar deneyin.");
      setMathChallenge(createMathChallenge());
      setMathAnswer("");
      setLoading(false);
      return;
    }
    try {
      const response = await registerRequest({
        email,
        firstName,
        lastName,
        phoneNumber: `+90${phoneNumber}`,
        password,
        confirmPassword,
        mathLeft: mathChallenge.left,
        mathOperator: mathChallenge.operator,
        mathRight: mathChallenge.right,
        mathAnswer: Number(mathAnswer)
      });
      onRegister(response.user);
      navigate("/football/analytics");
    } catch (error) {
      setError(error instanceof ApiError && error.status < 500 ? error.message : "Kayıt servisine şu an ulaşılamıyor. Birazdan tekrar deneyin.");
      setMathChallenge(createMathChallenge());
      setMathAnswer("");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="login-shell">
      <section className="login-experience" aria-label="SkorIQ kayıt ekranı">
        <div className="login-intelligence" aria-hidden="true">
          <div className="brain-stage">
            <div className="brain-orbit brain-orbit-one" />
            <div className="brain-orbit brain-orbit-two" />
            <div className="brain-core">
              <span className="brain-node node-a" />
              <span className="brain-node node-b" />
              <span className="brain-node node-c" />
              <span className="brain-node node-d" />
              <span className="brain-node node-e" />
              <span className="brain-path path-a" />
              <span className="brain-path path-b" />
              <span className="brain-path path-c" />
              <span className="brain-bar bar-a" />
              <span className="brain-bar bar-b" />
              <span className="brain-bar bar-c" />
              <span className="brain-bar bar-d" />
            </div>
            <span className="data-chip chip-a">Üyelik oluşturuluyor</span>
            <span className="data-chip chip-b">Analiz paneli hazırlanıyor</span>
            <span className="data-chip chip-c">Veri kapsamı kontrol ediliyor</span>
            <span className="data-chip chip-d">Güven skoru sinyalleri ayrıştırılıyor</span>
          </div>
        </div>
        <section className="login-card">
          <div className="login-brand">
            <img src={skoriqLogo} alt="SkorIQ" />
          </div>
          <form className="login-form" onSubmit={submit}>
            <input value={firstName} onChange={(event) => setFirstName(event.target.value)} type="text" autoComplete="given-name" placeholder="Ad" aria-label="Ad" minLength={2} maxLength={80} required />
            <input value={lastName} onChange={(event) => setLastName(event.target.value)} type="text" autoComplete="family-name" placeholder="Soyad" aria-label="Soyad" minLength={2} maxLength={80} required />
            <label className="phone-field">
              <span className="phone-prefix" aria-hidden="true">
                <span className="flag-tr">🇹🇷</span>
                +90
              </span>
              <input
                value={phoneNumber}
                onChange={(event) => setPhoneNumber(onlyDigits(event.target.value).slice(0, 10))}
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                placeholder="5XX XXX XX XX"
                aria-label="Telefon numarası"
                minLength={10}
                maxLength={10}
                pattern="[0-9]{10}"
                required
              />
            </label>
            <input className="email-field" value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" placeholder="E-posta adresi" aria-label="E-posta" required />
            <div className="password-field">
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                placeholder="Şifre"
                aria-label="Şifre"
                minLength={12}
                required
              />
              <button type="button" aria-label={showPassword ? "Şifreyi gizle" : "Şifreyi göster"} onClick={() => setShowPassword((value) => !value)}>
                {showPassword ? "🙈" : "👁"}
              </button>
            </div>
            <div className="password-field">
              <input
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                placeholder="Şifre tekrar"
                aria-label="Şifre tekrar"
                minLength={12}
                required
              />
            </div>
            <label className="math-field">
              <span>{mathChallenge.left} {mathChallenge.operator} {mathChallenge.right} = ?</span>
              <input
                value={mathAnswer}
                onChange={(event) => setMathAnswer(onlyDigits(event.target.value).slice(0, 2))}
                type="text"
                inputMode="numeric"
                placeholder="Cevap"
                aria-label="Güvenlik sorusu cevabı"
                required
              />
            </label>
            <p className="auth-hint">En az 12 karakter; büyük harf, küçük harf ve rakam içermeli.</p>
            {error ? <p className="error-text">{error}</p> : null}
            <button type="submit" disabled={loading}>
              {loading ? "Kayıt oluşturuluyor..." : "Kayıt Ol"}
            </button>
          </form>
          <p className="auth-switch">
            Zaten hesabın var mı?{" "}
            <button type="button" className="text-link" onClick={() => navigate("/login")}>
              Giriş yap
            </button>
          </p>
        </section>
      </section>
    </main>
  );
}

function onlyDigits(value: string) {
  return value.replace(/\D/g, "");
}

function createMathChallenge() {
  const operator: "+" | "-" = Math.random() > 0.5 ? "+" : "-";
  const left = randomInt(3, 12);
  const right = operator === "-" ? randomInt(1, left - 1) : randomInt(1, 9);

  return {
    left,
    operator,
    right,
    answer: operator === "+" ? left + right : left - right
  };
}

function randomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
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

export function OverviewDashboardView({
  user,
  overview,
  navigate
}: {
  user: AuthUser;
  overview: LoadState<DashboardOverviewResponse>;
  navigate: (path: string) => void;
}) {
  const data = overview.data;
  const items = data?.upcomingMatches ?? [];
  const health = buildOverviewHealth(data, overview);
  const currentDate = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(new Date());
  const previewCount = data?.predictionPreview.items.length ?? 0;

  return (
    <div className="overview-dashboard">
      <header className="overview-hero">
        <div>
          <p className="eyebrow">SkorIQ</p>
          <h1>Hoş geldin, {data?.user.email ?? displayUserName(user)}</h1>
          <p>Veri destekli analizlerle maçları daha bilinçli değerlendir.</p>
        </div>
        <div className="overview-hero-side">
          <span>{currentDate}</span>
          <strong>Rol: {roleLabel(data?.user.role ?? user.role)}</strong>
          <strong>Veri Durumu: {overview.error ? "Kontrol edilemedi" : overview.loading ? "Kontrol ediliyor" : dataStatusSummary(data)}</strong>
        </div>
      </header>

      <div className="overview-stat-grid">
        <DashboardStatCard title="Analiz Edilen Maç" value={overview.loading ? "..." : data?.overview.analyzedMatchesCount ?? "—"} helper="Listelenen analiz raporları" tone="blue" />
        <DashboardStatCard title="Hazır Analiz" value={overview.loading ? "..." : data?.overview.readyMatchesCount ?? "—"} helper="Tahmine uygun analizler" tone="success" />
        <DashboardStatCard title="Ortalama Veri Kapsamı" value={overview.loading ? "..." : formatPercent(data?.overview.averageCombinedCoverageScore ?? null)} helper="Genel veri kapsamı" tone="cyan" />
        <DashboardStatCard title="Ön Tahmin" value={overview.loading ? "..." : data ? previewCount || data.overview.predictionEligibleCount : "—"} helper={previewCount ? "Güvenli önizleme adayı" : "Hazır olduğunda görünür"} tone="purple" />
      </div>

      <div className="overview-main-grid">
        <DashboardSectionCard
          className="overview-matches-card"
          title="Maç listesi"
          hideHeader
        >
          {overview.loading ? <OverviewInlineState text="Dashboard özeti yükleniyor..." /> : null}
          {overview.error ? <OverviewInlineState text="Dashboard özeti yüklenemedi." tone="warning" /> : null}
          {!overview.loading && !overview.error && items.length === 0 ? <OverviewEmptyState title="Gösterilecek maç bulunmuyor." /> : null}
          {items.length > 0 ? (
            <div className="overview-match-list">
              {items.map((item) => (
                <OverviewMatchRow key={item.matchId} item={item} navigate={navigate} />
              ))}
            </div>
          ) : null}
        </DashboardSectionCard>

        <div className="overview-side-stack">
          <DashboardSectionCard title="Analiz Dağılımı">
            <OverviewDistribution overview={data} />
          </DashboardSectionCard>
          <DashboardSectionCard title="Veri Kapsamı Ortalamaları">
            <OverviewCoverageAverages overview={data} />
          </DashboardSectionCard>
        </div>

        <div className="overview-side-stack">
          <DashboardSectionCard title="SkorIQ Tahmin Yorumu">
            <OverviewPredictionPreview overview={overview} />
          </DashboardSectionCard>
          <DashboardSectionCard title="Veri Durumu">
            <OverviewHealthList items={health} />
          </DashboardSectionCard>
        </div>
      </div>

      <div className="overview-bottom-grid">
        {data?.admin ? (
          <DashboardSectionCard title="İç Denetim Özeti">
            <OverviewAdminSummary admin={data.admin} />
          </DashboardSectionCard>
        ) : (
          <DashboardSectionCard title="Özet Notu">
            <OverviewEmptyState title="Üye görünümü aktif." body="İç denetim özetleri yalnızca admin kullanıcılar için gösterilir." />
          </DashboardSectionCard>
        )}
        <DashboardSectionCard title="Hızlı İşlemler">
          <OverviewQuickActions userRole={data?.user.role ?? user.role} navigate={navigate} />
        </DashboardSectionCard>
      </div>

      <p className="overview-disclaimer">SkorIQ, istatistiksel modelleme ve veri destekli analizlerle hazırlanır. Analizler kesin sonuç garantisi vermez.</p>
    </div>
  );
}

function DashboardStatCard({ title, value, helper, tone }: { title: string; value: ReactNode; helper: string; tone: "blue" | "cyan" | "success" | "purple" }) {
  return (
    <section className={`dashboard-stat-card dashboard-stat-${tone}`}>
      <div className="dashboard-stat-icon" aria-hidden="true" />
      <span>{title}</span>
      <strong>{value}</strong>
      <p>{helper}</p>
    </section>
  );
}

function DashboardSectionCard({
  title,
  children,
  className = "",
  actionLabel,
  onAction,
  hideHeader = false
}: {
  title: string;
  children: ReactNode;
  className?: string;
  actionLabel?: string;
  onAction?: () => void;
  hideHeader?: boolean;
}) {
  return (
    <section className={`overview-section-card ${className}`} aria-label={hideHeader ? title : undefined}>
      {!hideHeader ? (
        <div className="overview-section-header">
          <h2>{title}</h2>
          {actionLabel && onAction ? (
            <button type="button" onClick={onAction}>
              {actionLabel}
            </button>
          ) : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

function OverviewMatchRow({ item, navigate }: { item: DashboardUpcomingMatch; navigate: (path: string) => void }) {
  const detailPath = `/football/analytics/${item.matchId}`;
  const openDetail = () => navigate(detailPath);
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openDetail();
    }
  };

  return (
    <article
      className="overview-match-row"
      role="button"
      tabIndex={0}
      aria-label={`${item.homeTeam.name} - ${item.awayTeam.name} maç analizini aç`}
      onClick={openDetail}
      onKeyDown={handleKeyDown}
    >
      <div className="overview-match-time">
        <strong>{formatDateTime(item.kickoffAt)}</strong>
        <span>{item.competition.name || "Lig bilgisi yok"}</span>
      </div>
      <div className="overview-match-teams">
        <div className="overview-match-team overview-match-home">
          <TeamLogo name={item.homeTeam.name} logoUrl={item.homeTeam.logoUrl} size="sm" />
          <span className="dashboard-match-name">{item.homeTeam.name}</span>
        </div>
        <em>VS</em>
        <div className="overview-match-team overview-match-away">
          <TeamLogo name={item.awayTeam.name} logoUrl={item.awayTeam.logoUrl} size="sm" />
          <span className="dashboard-match-name">{item.awayTeam.name}</span>
        </div>
      </div>
      <div className="overview-match-meta">
        {item.featureStatus ? <StatusBadge status={item.featureStatus} /> : null}
        {item.combinedCoverageScore !== null && item.combinedCoverageScore !== undefined ? <span>{formatPercent(item.combinedCoverageScore)}</span> : null}
        {item.predictionEligible ? <span className="badge badge-good">Tahmine uygun</span> : null}
        {item.hasPredictionPreview ? <span className="badge badge-info">Ön tahmin var</span> : null}
      </div>
    </article>
  );
}

function OverviewDistribution({ overview }: { overview: DashboardOverviewResponse | null }) {
  const distribution = overview?.analysisDistribution ?? { ready: 0, partial: 0, insufficient: 0, unknown: 0 };
  const total = distribution.ready + distribution.partial + distribution.insufficient + distribution.unknown;
  const rows = [
    { label: "Hazır", value: distribution.ready, tone: "success" },
    { label: "Kısmi", value: distribution.partial, tone: "warning" },
    { label: "Yetersiz", value: distribution.insufficient, tone: "muted" },
    { label: "Bilinmeyen", value: distribution.unknown, tone: "muted" }
  ];
  return (
    <div className="overview-bars">
      {rows.map((row) => (
        <div className="overview-bar-row" key={row.label}>
          <span>{row.label}</span>
          <div className="overview-bar-track">
            <i className={`overview-bar-fill overview-bar-${row.tone}`} style={{ width: `${total > 0 ? (row.value / total) * 100 : 0}%` }} />
          </div>
          <strong>{row.value}</strong>
        </div>
      ))}
    </div>
  );
}

function OverviewCoverageAverages({ overview }: { overview: DashboardOverviewResponse | null }) {
  const summary = overview?.coverageSummary;
  const rows = [
    ["Genel kapsam", summary?.averageCombinedCoverageScore ?? null],
    ["Ev sahibi formu", summary?.averageHomeFormCoverage ?? null],
    ["Deplasman formu", summary?.averageAwayFormCoverage ?? null],
    ["Takımlar arası geçmiş", summary?.averageH2hCoverage ?? null]
  ].filter(([, value]) => value !== null) as Array<[string, number]>;
  if (rows.length === 0) return <OverviewEmptyState title="Veri kapsamı ortalaması yok." />;
  return (
    <div className="overview-bars">
      {rows.map(([label, value]) => (
        <div className="overview-bar-row" key={label}>
          <span>{label}</span>
          <div className="overview-bar-track">
            <i className="overview-bar-fill overview-bar-cyan" style={{ width: `${value ?? 0}%` }} />
          </div>
          <strong>{formatPercent(value)}</strong>
        </div>
      ))}
    </div>
  );
}

function OverviewPredictionPreview({ overview }: { overview: LoadState<DashboardOverviewResponse> }) {
  if (overview.loading) return <OverviewInlineState text="Tahmin yorumları kontrol ediliyor..." />;
  if (overview.error) return <OverviewInlineState text="Tahmin yorumu şu anda alınamadı." tone="warning" />;
  const preview = overview.data?.predictionPreview;
  if (!preview || preview.status !== "available" || preview.items.length === 0) {
    return <OverviewEmptyState title={predictionPreviewEmptyTitle(preview?.status)} body={predictionPreviewEmptyBody(preview?.status)} />;
  }
  return (
    <div className="overview-preview-list">
      {preview.items.slice(0, 5).map((item) => (
        <article className="overview-preview-row" key={`${item.matchId}-${item.displayLabel}-${item.recommendationTier}`}>
          <div>
            <strong>{item.displayLabel}</strong>
            <span>{item.matchLabel}</span>
          </div>
          <div>
            <span className="badge badge-muted">{tierLabel(item.recommendationTier)}</span>
            <small>Güven Skoru: {formatScore(item.confidenceScore)}</small>
            <small>Risk: {riskLabel(item.riskLevel)}</small>
          </div>
        </article>
      ))}
    </div>
  );
}

function OverviewHealthList({ items }: { items: Array<{ label: string; value: string; ok: boolean | null }> }) {
  return (
    <div className="overview-health-list">
      {items.map((item) => (
        <div className="overview-health-row" key={item.label}>
          <span className={item.ok === true ? "health-dot ok" : item.ok === false ? "health-dot warn" : "health-dot muted"} />
          <span>{item.label}</span>
          <strong>{item.value}</strong>
        </div>
      ))}
    </div>
  );
}

function OverviewAdminSummary({ admin }: { admin: NonNullable<DashboardOverviewResponse["admin"]> }) {
  const rows = [
    ["Draft tahmin", admin.draftPredictionCount],
    ["Settlement sonucu", admin.settlementCount],
    ["Public uygun", admin.publicEligibilityEligibleCount],
    ["Public hariç", admin.publicEligibilityExcludedCount],
    ["Rebuild gerekli", admin.rebuildRequiredCount]
  ] as const;
  return (
    <div className="overview-update-list">
      {rows.map(([label, value]) => (
        <div className="overview-update-row" key={label}>
          <span>İç denetim</span>
          <p>{label}</p>
          <strong>{value ?? "—"}</strong>
        </div>
      ))}
    </div>
  );
}

function OverviewQuickActions({ userRole, navigate }: { userRole: AuthUser["role"]; navigate: (path: string) => void }) {
  const actions = [
    { label: "Maç Analizleri", path: "/football/analytics" },
    { label: "Takımlar", path: "/football/teams" },
    { label: "Ligler", path: "/football/competitions" },
    { label: "Sonuçlar", path: "/football/prediction-results" }
  ];
  const adminActions = [
    { label: "Draft Tahminler", path: "/football/predictions/drafts" },
    { label: "Tahmin Sonuçları", path: "/football/predictions/settlements" },
    { label: "Public Uygunluk", path: "/football/public-eligibility" }
  ];
  return (
    <div className="overview-action-grid">
      {[...actions, ...(userRole === "admin" ? adminActions : [])].map((action) => (
        <button key={action.path} type="button" onClick={() => navigate(action.path)}>
          {action.label}
        </button>
      ))}
    </div>
  );
}

function OverviewInlineState({ text, tone = "muted" }: { text: string; tone?: "muted" | "warning" }) {
  return <p className={`overview-inline-state overview-inline-${tone}`}>{text}</p>;
}

function OverviewEmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <div className="overview-empty-state">
      <strong>{title}</strong>
      {body ? <span>{body}</span> : null}
    </div>
  );
}

function buildOverviewHealth(data: DashboardOverviewResponse | null, overview: LoadState<DashboardOverviewResponse>) {
  const status = data?.dataStatus;
  return [
    { label: "Analiz API", value: statusValue(status?.analyticsApi, overview), ok: statusOk(status?.analyticsApi, overview) },
    { label: "Takım verisi", value: statusValue(status?.teamsCatalog, overview), ok: statusOk(status?.teamsCatalog, overview) },
    { label: "Lig verisi", value: statusValue(status?.competitionsCatalog, overview), ok: statusOk(status?.competitionsCatalog, overview) },
    { label: "Tahmin önizleme", value: statusValue(status?.predictionPreview, overview), ok: statusOk(status?.predictionPreview, overview) }
  ];
}

function statusValue(status: DashboardOverviewResponse["dataStatus"][keyof DashboardOverviewResponse["dataStatus"]] | undefined, overview: LoadState<DashboardOverviewResponse>) {
  if (overview.loading) return "Kontrol ediliyor";
  if (overview.error || status === "error") return "Erişilemedi";
  if (status === "empty") return "Boş";
  if (status === "ok") return "Bağlı";
  return "Bilinmiyor";
}

function statusOk(status: DashboardOverviewResponse["dataStatus"][keyof DashboardOverviewResponse["dataStatus"]] | undefined, overview: LoadState<DashboardOverviewResponse>) {
  if (overview.loading) return null;
  if (overview.error || status === "error") return false;
  if (status === "ok") return true;
  return null;
}

function dataStatusSummary(data: DashboardOverviewResponse | null) {
  if (!data) return "Bilinmiyor";
  const values = Object.values(data.dataStatus);
  if (values.some((value) => value === "error")) return "Kısmi hata";
  if (values.every((value) => value === "ok")) return "Kontrol edildi";
  return "Kısmi veri";
}

function roleLabel(role: AuthUser["role"]) {
  return role === "admin" ? "Admin" : "Üye";
}

function predictionPreviewEmptyTitle(status?: DashboardOverviewResponse["predictionPreview"]["status"]) {
  if (status === "stale") return "Tahmin yorumu yenilenmeli.";
  if (status === "not_ready") return "Tahmin yorumu hazır değil.";
  return "Henüz yayınlanabilir tahmin yorumu yok.";
}

function predictionPreviewEmptyBody(status?: DashboardOverviewResponse["predictionPreview"]["status"]) {
  if (status === "stale") return "Bu maç için tahminler güncel analiz penceresinde yenilenmelidir.";
  if (status === "not_ready") return "Yeterli veri oluştuğunda ön tahmin burada görünür.";
  return "Tahminler analiz penceresi içinde hazırlandığında burada görünür.";
}

function riskLabel(risk: string) {
  const labels: Record<string, string> = {
    low: "Düşük",
    medium: "Orta",
    high: "Yüksek",
    unknown: "Bilinmiyor"
  };
  return labels[risk] ?? risk;
}

function displayUserName(user: AuthUser) {
  return user.email ? user.email.split("@")[0] : user.role === "admin" ? "SkorIQ Admin" : "SkorIQ Üye";
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
  const [filters, setFilters] = useState<FootballAnalyticsMatchFilters>({
    ...initialFilters,
    offset: 0
  });
  const [frontendFilters, setFrontendFilters] = useState<FrontendFilters>(emptyFrontendFilters);
  const [quickChip, setQuickChip] = useState<QuickChipId | null>(null);

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
    filters.hasH2h !== "" ||
    filters.hasPrediction !== "" ||
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
          <p className="eyebrow">SkorIQ Futbol</p>
          <h1>Yaklaşan Maç Analizleri</h1>
          <p>Analiz ve tahmin üretimi için yaklaşan maçları incele.</p>
        </div>
        {matchStats ? (
          <div className="analytics-summary-grid" aria-label="Maç analizi özet metrikleri">
            <AnalyticsSummaryStat label="Hazır analiz" value={matchStats.ready} />
            <AnalyticsSummaryStat label="Kısmi veri" value={matchStats.partial} />
            <AnalyticsSummaryStat label="Yetersiz veri" value={matchStats.insufficient} />
            <AnalyticsSummaryStat label="Ortalama kapsam" value={formatPercent(matchStats.averageCoverage)} />
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

        <FilterBar
          filters={filters}
          setFilters={setFilters}
          frontendFilters={frontendFilters}
          setFrontendFilters={setFrontendFilters}
          competitions={availableCompetitions}
          countries={availableCountries}
        />

        <ActiveFilterPills
          filters={filters}
          frontendFilters={frontendFilters}
          quickChip={quickChip}
          onClearFilter={handleClearFilter}
          onClearAll={handleClearAll}
        />

        <div className="analytics-results-link-panel">
          <span>Biten maçlar ve tahmin sonuçları için Sonuçlar sayfasına git.</span>
          <button type="button" onClick={() => navigate("/football/prediction-results")}>
            Sonuçlar sayfası
          </button>
        </div>

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
    </>
  );
}

function AnalyticsSummaryStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="analytics-summary-stat">
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
        Analiz durumu
        <select value={filters.featureStatus} onChange={(event) => updateApi({ featureStatus: event.target.value as FeatureStatus | "" })}>
          <option value="">Tümü</option>
          <option value="ready">Hazır</option>
          <option value="partial">Kısmi</option>
          <option value="insufficient_data">Yetersiz</option>
        </select>
      </label>
      <label>
        Tahmin uygunluğu
        <select value={String(filters.predictionEligible)} onChange={(event) => updateApi({ predictionEligible: parseBooleanFilter(event.target.value) })}>
          <option value="">Tümü</option>
          <option value="true">Uygun</option>
          <option value="false">Uygun değil</option>
        </select>
      </label>
      <label>
        Sonuç durumu
        <select value={String(filters.kuponEligible)} onChange={(event) => updateApi({ kuponEligible: parseBooleanFilter(event.target.value) })}>
          <option value="">Tümü</option>
          <option value="true">Aktif</option>
          <option value="false">Pasif</option>
        </select>
      </label>
      {competitions.length > 0 ? (
        <label>
          Lig
          <select value={frontendFilters.competitionName} onChange={(event) => updateUi({ competitionName: event.target.value })}>
            <option value="">Tümü</option>
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
            <option value="">Tümü</option>
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
                  <span>Kapsam: {formatPercent(item.combinedCoverageScore)}</span>
                </div>
                <span className="analytics-match-league">{item.match.competition.name}</span>
                <div className="analytics-match-badges">
                  {item.predictionEligible ? <span className="badge badge-good">Tahmine uygun</span> : null}
                  {item.hasPredictionPreview ? <span className="badge badge-info">Ön tahmin var</span> : null}
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

  return (
    <>
      <button className="back-button match-detail-back" type="button" onClick={() => navigate("/football/analytics")}>
        <span aria-hidden="true">←</span> Maç analizlerine dön
      </button>
      {loading ? <StatePanel title="Maç analizi yükleniyor..." /> : null}
      {error ? <StatePanel title="Veri yüklenemedi" body={error} /> : null}
      {!loading && !error && !report ? <StatePanel title="Analiz raporu bulunamadı" /> : null}
      {report ? (
        <MatchDetailReportView report={report} matchId={matchId} user={user} navigate={navigate} />
      ) : null}
    </>
  );
}

export function MatchDetailReportView({
  report,
  matchId,
  user,
  navigate
}: {
  report: FootballAnalyticsMatchReport;
  matchId: string;
  user: AuthUser;
  navigate: (path: string) => void;
}) {
  const competitionName = report.match.competition?.name || "Lig bilgisi yok";
  const kickoffLabel = report.match.kickoffAt ? formatDateTime(report.match.kickoffAt) : "Tarih bilgisi yok";
  const matchStatus = report.match.status || "Durum bilgisi yok";
  const analysisSummary = formatAnalysisSummary(report);

  return (
    <div className="match-report-layout">
      <header className="match-report-hero">
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
            VS
          </div>
          <MatchHeroTeam role="Deplasman" name={report.match.awayTeam.name} logoUrl={report.match.awayTeam.logoUrl} />
        </div>
      </header>

      <section className="match-report-notice">
        <span className="match-report-info-icon">i</span>
        <div>
          <strong>Bu bir maç analizi raporudur, nihai tahmin değildir.</strong>
          <p>Güven skoru kazanma olasılığı değildir. Tahmin üretimi ve public yayın ayrı kontrollü süreçlerdir.</p>
        </div>
      </section>

      <div className="analysis-kpi-grid">
        <AnalysisKpiCard title="Analiz Durumu" value={statusLabel(report.featureStatus)} body={analysisStatusHelper(report.featureStatus)} tone={report.featureStatus === "ready" ? "success" : report.featureStatus === "partial" ? "warning" : "muted"} icon="shield" />
        <AnalysisKpiCard title="Tahmine Uygunluk" value={report.predictionEligible ? "Uygun" : "Uygun değil"} body={report.predictionEligible ? "Ön analiz üretilebilir" : "Tahmin için yeterli değil"} tone={report.predictionEligible ? "success" : "muted"} icon="star" />
        <AnalysisKpiCard title="Güven Tavanı" value={report.confidenceCeiling} body="En yüksek güven sınırı" tone="blue" icon="trend" />
        <AnalysisKpiCard title="Veri Kapsamı" value={formatPercent(report.combinedCoverageScore)} body="Kullanılan veri yeterliliği" tone="blue" icon="target">
          <ProgressBar value={report.combinedCoverageScore} />
        </AnalysisKpiCard>
      </div>

      <div className="analysis-form-grid">
        <AnalysisCoverageCard teamName={report.match.homeTeam.name} label="İç saha formu" block={report.homeForm} side="home" />
        <AnalysisCoverageCard teamName={report.match.awayTeam.name} label="Dış saha formu" block={report.awayForm} side="away" />
        <AnalysisH2HCard block={report.h2h} />
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

      <MemberPredictionPreview matchId={matchId} />

      <div className="signal-grid analysis-signal-grid">
        <ReportSignalCard title="Pozitif Sinyaller" items={report.positiveSignals.map((item) => formatSignalText(item, report))} tone="positive" />
        <ReportSignalCard title="Risk Faktörleri" items={report.riskFactors.map((item) => formatRiskText(item, report))} tone="risk" />
        <ReportSignalCard title="Eksik Veriler" items={report.missingDataWarnings.map((item) => formatMissingText(item, report))} tone="missing" />
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

function MatchHeroTeam({ role, name, logoUrl }: { role: string; name: string; logoUrl?: string | null }) {
  return (
    <div className="match-hero-team">
      <TeamLogo name={name} logoUrl={logoUrl} size="lg" />
      <div>
        <span>{role}</span>
        <h1>{name}</h1>
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

function AnalysisCoverageCard({ teamName, label, block, side }: { teamName: string; label: string; block: FootballAnalyticsMatchReport["homeForm"]; side: "home" | "away" }) {
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

function AnalysisH2HCard({ block }: { block: FootballAnalyticsMatchReport["h2h"] }) {
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

  return (
    <section className="panel goal-profile-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Gol profili</p>
          <h2>Gol Profili</h2>
        </div>
      </div>
      <div className="goal-profile-grid">
        {goalProfileItems.map((item) => (
          <MetricCard key={item.label} title={item.label} value={item.value} />
        ))}
      </div>
    </section>
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
          <p className="muted">Bu bölüm mevcut veri kapsamına göre üretilen ön tahminleri gösterir. Nihai sonuç garantisi değildir.</p>
          <p className="muted">Tahminler minimum güvenli süre korunarak maç başlayana kadar gösterilebilir.</p>
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
  const { data, loading, error } = useLoad(() => fetchFootballTeams({ search, limit: 50 }), [search]);
  const teamStats = useMemo(() => (data ? getTeamDirectoryStats(data.items) : null), [data]);
  const filteredTeams = useMemo(() => {
    if (!data) return [];
    return data.items.filter((team) => matchesTeamDirectoryFilter(team, activeFilter));
  }, [activeFilter, data]);

  return (
    <>
      <header className="hero teams-header">
        <div>
          <p className="eyebrow">SkorIQ Futbol</p>
          <h1>Takımlar</h1>
          <p>Liglerdeki takımları, logoları ve analiz kapsamlarını incele.</p>
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
        <label className="teams-search">
          <span>Takım ara</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Takım ara..." />
        </label>
        <div className="team-filter-chips" aria-label="Takım filtreleri">
          <TeamFilterChip label="Tümü" value="all" activeFilter={activeFilter} setActiveFilter={setActiveFilter} />
          <TeamFilterChip label="Logolu takımlar" value="logos" activeFilter={activeFilter} setActiveFilter={setActiveFilter} />
          <TeamFilterChip label="Maç verisi olanlar" value="matches" activeFilter={activeFilter} setActiveFilter={setActiveFilter} />
          <TeamFilterChip label="Yüksek kapsam" value="highCoverage" activeFilter={activeFilter} setActiveFilter={setActiveFilter} />
        </div>
      </section>
      {loading ? <StatePanel title="Takımlar yükleniyor..." /> : null}
      {error ? <StatePanel title="Takımlar yüklenemedi" body={error} /> : null}
      {!loading && !error && data && filteredTeams.length === 0 ? <StatePanel title="Takım bulunamadı" /> : null}
      {!loading && !error && data && filteredTeams.length > 0 ? (
        <section className="panel">
          <div className="panel-header">
            <h2>Futbol takımları</h2>
            <span className="muted">
              {data.pagination.total} kayıttan {filteredTeams.length} gösteriliyor
            </span>
          </div>
          <div className="team-directory-grid">
            {filteredTeams.map((team) => (
              <TeamDirectoryCard key={team.teamId} team={team} navigate={navigate} />
            ))}
          </div>
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
          <div className="team-card-stats" aria-label={`${team.name} analiz metrikleri`}>
            <span>
              <strong>{team.matchesCount}</strong>
              maç
            </span>
            <span>
              <strong>{formatPercent(team.latestFormCoverage)}</strong>
              form kapsamı
            </span>
          </div>
        </div>
      </div>
      <div className="team-card-footer">
        <div className="team-card-coverage">
          <span>Kapsam: {formatPercent(team.latestFormCoverage)}</span>
          <ProgressBar value={team.latestFormCoverage ?? 0} />
        </div>
        <button
          className="team-card-action"
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            openTeam();
          }}
        >
          Takımı incele
        </button>
      </div>
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

function TeamDetailPage({ teamId, navigate }: { teamId: string; navigate: (path: string) => void }) {
  const { data: profile, loading, error } = useLoad(() => fetchFootballTeamProfile(teamId), [teamId]);

  return (
    <>
      {loading ? <StatePanel title="Takım profili yükleniyor..." /> : null}
      {error ? <StatePanel title="Takım profili yüklenemedi" body={error} /> : null}
      {!loading && !error && !profile ? <StatePanel title="Takım bulunamadı" /> : null}
      {profile ? (
        <>
          <div className="explorer-breadcrumbs">
            <button type="button" onClick={() => navigate("/football")}>Futbol Keşfi</button>
            {(() => {
              const pc = profile.team.primaryCompetition;
              if (!pc) return null;
              return (
                <>
                  <span>/</span>
                  <button type="button" onClick={() => navigate(`/football/competitions/${pc.id}`)}>
                    {pc.name}
                  </button>
                </>
              );
            })()}
            <span>/</span>
            <span className="breadcrumb-current">{profile.team.name}</span>
          </div>
          <TeamProfileHero profile={profile} standing={profile.standing} />
          <div className="team-profile-grid">
            <TeamProfileStanding standing={profile.standing} />
            <TeamProfileFormSummary formSummary={profile.formSummary} />
            <TeamProfileGoalProfile goalProfile={profile.goalProfile} />
            <TeamProfileRecentMatches matches={profile.recentMatches} />
            <TeamProfileUpcomingMatches matches={profile.upcomingMatches} navigate={navigate} />
            <TeamProfileDataCoverage coverage={profile.dataCoverage} />
          </div>
        </>
      ) : null}
    </>
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

export function TeamProfileHero({ profile, standing }: { profile: FootballTeamProfileResponse; standing: FootballTeamProfileResponse["standing"] }) {
  const team = profile.team;
  return (
    <header className="hero detail-hero team-profile-hero">
      <div className="entity-title">
        <TeamLogo name={team.name} logoUrl={team.logoUrl} size="lg" />
        <div>
          <p className="eyebrow">{team.primaryCompetition?.name ?? "Futbol takımı"}</p>
          <h1>{team.name}</h1>
          <p className="muted">{team.country ?? "Ülke bilgisi yok"}</p>
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

export function TeamProfileRecentMatches({ matches }: { matches: FootballTeamProfileRecentMatch[] }) {
  return (
    <section className="panel">
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
              {match.fulltimeScore ? <span className="recent-match-score">{match.fulltimeScore}</span> : null}
              {match.halftimeScore ? <span className="recent-match-halftime">İY {match.halftimeScore}</span> : null}
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

export function TeamProfileDataCoverage({ coverage }: { coverage: FootballTeamProfileResponse["dataCoverage"] }) {
  const items: Array<{ label: string; available: boolean; count?: number; soonMessage?: string }> = [
    { label: "Maç verisi", available: coverage.matchesAvailable > 0, count: coverage.matchesAvailable },
    { label: "Skor verisi", available: coverage.scoresAvailable > 0, count: coverage.scoresAvailable },
    { label: "Puan durumu", available: coverage.hasStanding },
    { label: "Form kapsamı", available: coverage.formCoverageScore !== null && coverage.formCoverageScore > 0 },
    { label: "Logo", available: coverage.hasLogo },
    { label: "Oyuncu verisi", available: coverage.playersAvailable, soonMessage: "Oyuncu verisi yakında" },
    { label: "Kadro verisi", available: coverage.lineupsAvailable, soonMessage: "Kadro verisi yakında" },
    { label: "Sakatlık verisi", available: coverage.injuriesAvailable, soonMessage: "Sakatlık verisi yakında" }
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
  const { data, loading, error } = useLoad(() => fetchFootballCompetitions({ limit: 50 }), []);

  return (
    <>
      <header className="hero">
        <div>
          <p className="eyebrow">SkorIQ Futbol</p>
          <h1>Ligler</h1>
          <p>Normalize futbol verisinden salt okunur lig kapsamı ve analiz hazırlık özetleri.</p>
        </div>
      </header>
      {loading ? <StatePanel title="Ligler yükleniyor..." /> : null}
      {error ? <StatePanel title="Ligler yüklenemedi" body={error} /> : null}
      {!loading && !error && data?.items.length === 0 ? <StatePanel title="Futbol ligi bulunamadı" /> : null}
      {!loading && !error && data ? <CompetitionList data={data} navigate={navigate} /> : null}
    </>
  );
}

function CompetitionList({ data, navigate }: { data: FootballCompetitionsListResponse; navigate: (path: string) => void }) {
  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Futbol ligleri</h2>
        <span className="muted">
          {data.pagination.total} kayıttan {data.items.length} gösteriliyor
        </span>
      </div>
      <div className="catalog-grid">
        {data.items.map((competition) => (
          <article className="catalog-card" key={competition.competitionId}>
            <div className="competition-mark">{competition.name.slice(0, 2).toUpperCase()}</div>
            <div>
              <h3>{competition.name}</h3>
              <p className="muted">{competition.country ?? "Ülke bilinmiyor"}</p>
            </div>
            <div className="catalog-meta">
              <span>{competition.teamsCount} takım</span>
              <span>{competition.matchesCount} maç</span>
              <span>{competition.readyMatchesCount} hazır</span>
              <span>{formatPercent(competition.averageCoverage)} ort. kapsam</span>
            </div>
            <button type="button" onClick={() => navigate(`/football/competitions/${competition.competitionId}`)}>
              Ligi aç
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}

export function CompetitionDetailPage({ competitionId, navigate }: { competitionId: string; navigate: (path: string) => void }) {
  const { data: profile, loading, error } = useLoad(() => fetchFootballCompetitionProfile(competitionId), [competitionId]);

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
        <>
          <header className="explorer-hero">
            <div className="explorer-hero-main">
              <div className="explorer-hero-logo">
                {profile.competition.logoUrl ? (
                  <img src={profile.competition.logoUrl} alt={profile.competition.name} />
                ) : (
                  <span className="initials-avatar">{profile.competition.name.charAt(0)}</span>
                )}
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

          {profile.standings.length > 0 ? (
            <section className="explorer-panel">
              <div className="explorer-panel-header">
                <h2>Puan Durumu</h2>
              </div>
              <div className="standings-table-wrap">
                <table className="standings-table">
                  <thead>
                    <tr>
                      <th>Sıra</th>
                      <th>Takım</th>
                      <th>O</th>
                      <th>G</th>
                      <th>B</th>
                      <th>M</th>
                      <th>A</th>
                      <th>Y</th>
                      <th>Av</th>
                      <th>P</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profile.standings.map((row) => (
                      <tr key={row.teamId}>
                        <td>{row.position}</td>
                        <td>
                          <button type="button" className="standings-team" onClick={() => navigate(`/football/teams/${row.teamId}`)}>
                            <TeamLogo name={row.teamName} logoUrl={row.logoUrl} size="sm" />
                            <span>{row.teamName}</span>
                          </button>
                        </td>
                        <td>{row.played}</td>
                        <td>{row.wins}</td>
                        <td>{row.draws}</td>
                        <td>{row.losses}</td>
                        <td>{row.goalsFor}</td>
                        <td>{row.goalsAgainst}</td>
                        <td>{row.goalDifference > 0 ? `+${row.goalDifference}` : row.goalDifference}</td>
                        <td><strong>{row.points}</strong></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : (
            <section className="explorer-panel">
              <p className="empty-message">Puan durumu verisi bulunmuyor.</p>
            </section>
          )}

          {profile.teams.length > 0 ? (
            <section className="explorer-panel">
              <div className="explorer-panel-header">
                <h2>Takımlar</h2>
                <span className="muted">{profile.teams.length} kayıt</span>
              </div>
              <div className="explorer-team-grid">
                {profile.teams.map((team) => (
                  <button type="button" className="explorer-team-card" key={team.teamId} onClick={() => navigate(`/football/teams/${team.teamId}`)}>
                    <TeamLogo name={team.name} logoUrl={team.logoUrl} />
                    <span className="explorer-team-name">{team.name}</span>
                    {team.latestFormCoverage != null ? (
                      <span className="coverage-pill">{Math.round(team.latestFormCoverage)}%</span>
                    ) : null}
                  </button>
                ))}
              </div>
            </section>
          ) : (
            <section className="explorer-panel">
              <p className="empty-message">Takım verisi bulunmuyor.</p>
            </section>
          )}

          {profile.upcomingMatches.length > 0 ? (
            <section className="explorer-panel">
              <div className="explorer-panel-header">
                <h2>Yaklaşan Maçlar</h2>
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
          )}

          {profile.recentMatches.length > 0 ? (
            <section className="explorer-panel">
              <div className="explorer-panel-header">
                <h2>Son Maçlar</h2>
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
                        {match.status === "finished" || match.status === "after_extra_time" || match.status === "after_penalties"
                          ? `${match.homeTeam.name} - ${match.awayTeam.name}`
                          : match.status}
                      </span>
                      <span className="explorer-match-team">
                        <TeamLogo name={match.awayTeam.name} logoUrl={match.awayTeam.logoUrl} size="sm" />
                        {match.awayTeam.name}
                      </span>
                    </div>
                    <span className="explorer-match-kickoff">{formatDate(match.kickoffAt)}</span>
                  </div>
                ))}
              </div>
            </section>
          ) : (
            <section className="explorer-panel">
              <p className="empty-message">Son maç verisi bulunmuyor.</p>
            </section>
          )}
        </>
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
          <p className="eyebrow">SkorIQ Futbol</p>
          <h1>Draft Tahminler</h1>
          <p>İç inceleme için taslak adaylar. Yayınlama, settlement veya tahmin kombini işlemi yapılmaz.</p>
        </div>
      </header>
      <section className="notice">
        <strong>Bu ekran salt okunurdur.</strong>
        <span>Taslak adaylar üyelere yayınlanmamıştır; public başarılı tahmin veya tahmin kombini değildir.</span>
      </section>
      <DraftFilterBar filters={filters} setFilters={setFilters} />
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
          <p className="eyebrow">SkorIQ Futbol</p>
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

        <ResultsFilterBar
          filters={filters}
          setFilters={setFilters}
          countries={summary?.byCountry ?? []}
          leagues={summary?.byLeague ?? []}
        />

        {!loading && data ? (
          <div className="results-pagination-bar">
            <p className="results-count">
              {offset + 1}–{Math.min(offset + data.items.length, totalFromApi)} / {totalFromApi.toLocaleString("tr-TR")} sonuç
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
              <span className="league-group-initials" style={{ background: "rgba(148,163,184,0.12)" }} />
              <div className="league-group-names">
                <span className="league-group-name" style={{ width: "8rem", height: "0.9rem", background: "rgba(148,163,184,0.12)", borderRadius: "0.3rem" }} />
                <span className="league-group-country" style={{ width: "5rem", height: "0.7rem", background: "rgba(148,163,184,0.08)", borderRadius: "0.3rem" }} />
              </div>
            </div>
          </div>
          <div className="league-group-body">
            {[1, 2].map((j) => (
              <div key={j} className="match-result-row skeleton-shimmer">
                <div className="match-result-main">
                  <div className="match-result-left">
                    <span style={{ width: "3rem", height: "0.75rem", background: "rgba(148,163,184,0.1)", borderRadius: "0.2rem" }} />
                  </div>
                  <div className="match-result-teams">
                    <div className="match-result-team">
                      <span style={{ width: "1.5rem", height: "1.5rem", borderRadius: "0.3rem", background: "rgba(148,163,184,0.1)" }} />
                      <span style={{ width: "6rem", height: "0.85rem", background: "rgba(148,163,184,0.1)", borderRadius: "0.2rem" }} />
                    </div>
                    <div className="match-result-team">
                      <span style={{ width: "1.5rem", height: "1.5rem", borderRadius: "0.3rem", background: "rgba(148,163,184,0.1)" }} />
                      <span style={{ width: "6rem", height: "0.85rem", background: "rgba(148,163,184,0.1)", borderRadius: "0.2rem" }} />
                    </div>
                  </div>
                  <div className="match-result-score">
                    <span style={{ width: "2rem", height: "1.2rem", background: "rgba(148,163,184,0.1)", borderRadius: "0.2rem" }} />
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
          <p className="eyebrow">SkorIQ Futbol</p>
          <h1>Tahmin Sonuçları</h1>
          <p>Settlement sonuçları yalnızca iç denetim içindir. Public yayın, üye yayını veya tahmin kombini işlemi yapılmaz.</p>
        </div>
      </header>
      <SettlementGuardNotice />
      <SettlementFilterBar filters={filters} setFilters={setFilters} />
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
          <p className="eyebrow">SkorIQ Futbol</p>
          <h1>Public Uygunluk</h1>
          <p>Settled tahminlerin public başarılı tahmin adayı olup olmadığını salt okunur olarak değerlendir.</p>
        </div>
      </header>
      <PublicEligibilityGuardNotice />
      <PublicEligibilityFilterBar filters={filters} setFilters={setFilters} />
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const userInitial = user.email.trim().charAt(0).toUpperCase() || "S";
  const isAdmin = user.role === "admin";
  const navigateFromSidebar = (path: string) => {
    navigate(path);
    setMobileSidebarOpen(false);
  };

  return (
    <div className={`dashboard-frame${sidebarCollapsed ? " sidebar-collapsed" : ""}`}>
      <button className="mobile-menu-button" type="button" onClick={() => setMobileSidebarOpen(true)} aria-label="Menüyü aç">
        <NavIcon name="menu" />
        <span>Menü</span>
      </button>
      {mobileSidebarOpen ? <button className="sidebar-overlay" type="button" aria-label="Menüyü kapat" onClick={() => setMobileSidebarOpen(false)} /> : null}
      <aside className={`sidebar${mobileSidebarOpen ? " mobile-open" : ""}`} aria-label="Dashboard navigation">
        <div className="sidebar-top">
          <div className="brand">
            <img src={skoriqLogo} alt="SkorIQ" />
            <span>Veri Destekli Maç Analizi</span>
          </div>
          <div className="user-card">
            <span className="user-avatar" aria-hidden="true">
              {userInitial}
            </span>
            <div>
              <span>{user.email}</span>
              <small>
                <i aria-hidden="true" />
                {user.role}
              </small>
            </div>
            <button type="button" onClick={() => void onLogout()} aria-label="Çıkış yap">
              <NavIcon name="logout" />
              <span>Çıkış</span>
            </button>
          </div>
        </div>
        <NavGroup title="Genel">
          <NavButton icon="overview" label="Genel Bakış" path="/" currentPath={currentPath} navigate={navigateFromSidebar} />
        </NavGroup>
        <NavGroup title="Futbol">
          <NavButton icon="globe" label="Futbol Keşfi" path="/football" currentPath={currentPath} navigate={navigateFromSidebar} />
          <NavButton icon="analytics" label="Maç Analizi" path="/football/analytics" currentPath={currentPath} navigate={navigateFromSidebar} />
          <NavButton icon="results" label="Sonuçlar" path="/football/prediction-results" currentPath={currentPath} navigate={navigateFromSidebar} />
          {isAdmin ? (
            <>
              <NavButton
                icon="drafts"
                label="Draft Tahminler"
                path="/football/predictions/drafts"
                currentPath={currentPath}
                navigate={navigateFromSidebar}
                activeWhen={(path) => path.startsWith("/football/predictions/drafts") || path.includes("/prediction-drafts")}
              />
              <NavButton
                icon="results"
                label="Tahmin Sonuçları"
                path="/football/predictions/settlements"
                currentPath={currentPath}
                navigate={navigateFromSidebar}
                activeWhen={(path) => path.startsWith("/football/predictions/settlements") || path.includes("/prediction-settlements")}
              />
              <NavButton
                icon="shield"
                label="Public Uygunluk"
                path="/football/public-eligibility"
                currentPath={currentPath}
                navigate={navigateFromSidebar}
                activeWhen={(path) => path.startsWith("/football/public-eligibility") || path.includes("/public-eligibility")}
              />
            </>
          ) : null}
          <NavButton icon="teams" label="Takımlar" path="/football/teams" currentPath={currentPath} navigate={navigateFromSidebar} />
          <NavButton icon="leagues" label="Ligler" path="/football/competitions" currentPath={currentPath} navigate={navigateFromSidebar} />
        </NavGroup>
        <NavGroup title="Basketbol">
          <DisabledNav icon="basketball" label="Maç Analizi" />
          <DisabledNav icon="teams" label="Takımlar" />
          <DisabledNav icon="leagues" label="Ligler" />
        </NavGroup>
        {isAdmin ? (
          <>
            <NavGroup title="Sistem">
              <DisabledNav icon="provider" label="Sağlayıcı Raporları" />
              <DisabledNav icon="users" label="Kullanıcılar" />
              <DisabledNav icon="settings" label="Ayarlar" />
            </NavGroup>
            <div className="internal-review-card">
              <NavIcon name="shield" />
              <div>
                <strong>İç Denetim Modu</strong>
                <p>Bu panel yalnızca iç analiz ve denetim amaçlıdır. Public yayın veya tahmin kombini işlemi yapılmaz.</p>
              </div>
            </div>
          </>
        ) : null}
        <button className="sidebar-toggle" type="button" onClick={() => setSidebarCollapsed((value) => !value)} aria-label={sidebarCollapsed ? "Menüyü genişlet" : "Menüyü daralt"}>
          <NavIcon name={sidebarCollapsed ? "expand" : "collapse"} />
          <span>{sidebarCollapsed ? "Menüyü Genişlet" : "Menüyü Daralt"}</span>
        </button>
      </aside>
      <main className="app-shell">
        {children}
        {routeLoading ? <RouteTransitionLoader /> : null}
      </main>
    </div>
  );
}

function RouteTransitionLoader() {
  return (
    <div className="route-transition-loader" role="status" aria-live="polite" aria-label="Sayfa yükleniyor">
      <div className="route-loader-card">
        <div className="route-loader-logo" aria-hidden="true">
          <img className="route-loader-logo-base" src={skoriqMark} alt="" />
          <img className="route-loader-logo-fill" src={skoriqMark} alt="" />
        </div>
        <strong>Yükleniyor</strong>
      </div>
    </div>
  );
}

function NavGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="nav-group">
      <p>{title}</p>
      {children}
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

function NavButton({
  icon,
  label,
  path,
  currentPath,
  navigate,
  activeWhen
}: {
  icon: NavIconName;
  label: string;
  path: string;
  currentPath: string;
  navigate: (path: string) => void;
  activeWhen?: (path: string) => boolean;
}) {
  const active = activeWhen ? activeWhen(currentPath) : path === "/" ? currentPath === "/" : currentPath.startsWith(path);
  return (
    <button className={`nav-item${active ? " active" : ""}`} type="button" onClick={() => navigate(path)}>
      <span className="nav-label">
        <NavIcon name={icon} />
        <span>{label}</span>
      </span>
    </button>
  );
}

function DisabledNav({ icon, label }: { icon: NavIconName; label: string }) {
  return (
    <span className="nav-item disabled" aria-disabled="true">
      <span className="nav-label">
        <NavIcon name={icon} />
        <span>{label}</span>
      </span>
      <small>yakında</small>
    </span>
  );
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

export function LandingPage({ navigate }: { navigate: (path: string) => void }) {
  const features = [
    { title: "Maç Analizleri", desc: "Takım formu, veri kapsamı ve maç hazırlığını tek ekranda gör.", letter: "M" },
    { title: "Gol Profili", desc: "Gol üretimi, gol yeme eğilimi, ilk yarı ve KG sinyallerini ayrıştır.", letter: "G" },
    { title: "H2H Bağlamı", desc: "Takımlar arası geçmişi destekleyici sinyal olarak kullan.", letter: "H" },
    { title: "Tahmin Yorumu", desc: "Tahminim, Denenir ve Alternatif ayrımıyla daha net yorum al.", letter: "T" },
    { title: "Risk Sinyalleri", desc: "Eksik veri ve tutarsız adaylar sistem tarafından ayrıştırılır.", letter: "R" },
    { title: "Takım / Lig", desc: "Lig, takım, puan durumu ve form detaylarını dinamik verilerle incele.", letter: "L" }
  ];

  const benefits = [
    "Yaklaşan maç analizleri",
    "SkorIQ Tahmin Yorumu",
    "Veri kapsamı ve güven tavanı",
    "Takım formu ve gol profili",
    "H2H ve risk sinyalleri",
    "Lig ve takım detayları"
  ];

  const reasoningFlow = [
    { label: "Veri", desc: "Toplama" },
    { label: "Sinyal", desc: "Ayrıştırma" },
    { label: "Neden-Sonuç", desc: "Yorum" },
    { label: "Tahmin Desteği", desc: "Öneri" },
    { label: "Risk Açıklaması", desc: "Şeffaflık" }
  ];

  const previewCards = [
    {
      title: "Veri Kapsamı",
      desc: "Her maçta veri yeterliliği ayrı değerlendirilir. Yetersiz veri = uyarı.",
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>
        </svg>
      )
    },
    {
      title: "Tutarlılık Kontrolü",
      desc: "Çelişen tahminler öneri olarak gösterilmez. Tutarlılık önceliklidir.",
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        </svg>
      )
    },
    {
      title: "Açıklanabilir Yorum",
      desc: "Tahminler sinyal ve risk açıklamalarıyla desteklenir, gerekçelendirilir.",
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
      )
    }
  ];

  return (
    <div className="landing-page">
      <nav className="landing-nav">
        <div className="landing-nav-inner">
          <span className="landing-logo">SkorIQ</span>
          <div className="landing-nav-actions">
            <button type="button" className="landing-nav-link" onClick={() => navigate("/login")}>Giriş Yap</button>
            <button type="button" className="landing-nav-cta" onClick={() => navigate("/register")}>Kayıt Ol</button>
          </div>
        </div>
      </nav>

      <header className="landing-hero">
        <div className="landing-hero-visual" aria-hidden="true">
          <div className="brain-stage">
            <div className="brain-orbit brain-orbit-one" />
            <div className="brain-orbit brain-orbit-two" />
            <div className="brain-orbit brain-orbit-three" />
            <div className="brain-core">
              <div className="brain-core-inner" />
              <span className="brain-node node-a" />
              <span className="brain-node node-b" />
              <span className="brain-node node-c" />
              <span className="brain-node node-d" />
              <span className="brain-node node-e" />
              <span className="brain-path path-a" />
              <span className="brain-path path-b" />
              <span className="brain-path path-c" />
              <span className="brain-bar bar-a" />
              <span className="brain-bar bar-b" />
              <span className="brain-bar bar-c" />
              <span className="brain-bar bar-d" />
            </div>
            <span className="data-chip chip-a">Form verilerini tarıyorum</span>
            <span className="data-chip chip-b">Gol profilini analiz ediyorum</span>
            <span className="data-chip chip-c">H2H eğilimlerini ölçüyorum</span>
            <span className="data-chip chip-d">Risk sinyallerini kontrol ediyorum</span>
            <span className="data-chip chip-e">Tutarlılık kontrolü yapıyorum</span>
          </div>
        </div>
        <div className="landing-hero-content">
          <h1>Veriyle Okunan Maçlar, Nedenleriyle Açıklanan Tahminler</h1>
          <p className="landing-hero-lead">
            SkorIQ; takım formu, gol profili, H2H, veri kapsamı ve risk sinyallerini birlikte değerlendirerek maçları neden-sonuç ilişkisiyle yorumlar.
          </p>
          <p className="landing-hero-explanation">
            Bot gibi sonuç vermez. Veriyi okur, sinyali ayrıştırır, gerekçeyi açıklar.
          </p>
          <div className="landing-hero-actions">
            <button type="button" className="landing-btn-primary" onClick={() => navigate("/register")}>Ücretsiz Hesap Oluştur</button>
            <button type="button" className="landing-btn-secondary" onClick={() => navigate("/login")}>Giriş Yap</button>
          </div>
          <p className="landing-hero-note">Kesin sonuç vaadi yoktur. SkorIQ, veriye dayalı analiz ve yorum desteği sunar.</p>
        </div>
      </header>

      <section className="landing-reasoning" aria-label="SkorIQ akıl yürütme süreci">
        <div className="landing-reasoning-inner">
          {reasoningFlow.map((item, index) => (
            <div className="reasoning-card" key={item.label}>
              <span className="reasoning-dot" />
              <span className="reasoning-label">{item.label}</span>
              <span className="reasoning-desc">{item.desc}</span>
              {index < reasoningFlow.length - 1 && <span className="reasoning-arrow" aria-hidden="true">→</span>}
            </div>
          ))}
        </div>
      </section>

      <section className="landing-section landing-section-muted">
        <div className="landing-section-inner">
          <p className="landing-section-label">Prensipler</p>
          <h2 className="landing-section-title">SkorIQ farkı nedir?</h2>
          <div className="landing-preview-cards">
            {previewCards.map((card) => (
              <div className="landing-preview-card" key={card.title}>
                <div className="landing-preview-icon">{card.icon}</div>
                <h3>{card.title}</h3>
                <p>{card.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-section">
        <div className="landing-section-inner">
          <p className="landing-section-label">Yetenekler</p>
          <h2 className="landing-section-title">Platform Özellikleri</h2>
          <div className="landing-features">
            {features.map((f) => (
              <div className="landing-feature" key={f.title}>
                <span className="landing-feature-letter">{f.letter}</span>
                <div>
                  <h3>{f.title}</h3>
                  <p>{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-section landing-section-muted">
        <div className="landing-section-inner">
          <p className="landing-section-label">Önizleme</p>
          <h2 className="landing-section-title">Analiz Ekranından Bir Kesit</h2>
          <div className="landing-mockup">
            <div className="landing-mockup-header">
              <span>Süper Lig · 4 May 2026</span>
              <span className="landing-mockup-status">Hazır</span>
            </div>
            <div className="landing-mockup-match">
              <div className="landing-mockup-team">
                <span className="landing-mockup-avatar">E</span>
                <span>Ev Sahibi</span>
              </div>
              <span className="landing-mockup-vs">VS</span>
              <div className="landing-mockup-team">
                <span className="landing-mockup-avatar">D</span>
                <span>Deplasman</span>
              </div>
            </div>
            <div className="landing-mockup-bars">
              <div className="landing-mockup-bar"><span>Veri Kapsamı</span><div className="landing-mockup-track"><div style={{ width: "72%" }} /></div></div>
              <div className="landing-mockup-bar"><span>Form Kapsamı</span><div className="landing-mockup-track"><div style={{ width: "85%" }} /></div></div>
              <div className="landing-mockup-bar"><span>H2H Kapsamı</span><div className="landing-mockup-track"><div style={{ width: "60%" }} /></div></div>
            </div>
            <div className="landing-mockup-tags">
              <span className="landing-tag-primary">Tahminim</span>
              <span className="landing-tag-secondary">Denenir</span>
              <span className="landing-tag-muted">Alternatif</span>
            </div>
          </div>
          <p className="landing-caption">Örnek ekran görüntüsü — gerçek veriler üyelik gerektirir.</p>
        </div>
      </section>

      <section className="landing-section">
        <div className="landing-section-inner">
          <p className="landing-section-label">Üyelik</p>
          <h2 className="landing-section-title">Üye olduğunda ne görürsün?</h2>
          <ul className="landing-benefits">
            {benefits.map((b) => (
              <li key={b}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                {b}
              </li>
            ))}
          </ul>
          <div className="landing-cta-row">
            <button type="button" className="landing-btn-primary" onClick={() => navigate("/register")}>Hesap Oluştur</button>
          </div>
        </div>
      </section>

      <section className="landing-section landing-section-muted">
        <div className="landing-section-inner">
          <p className="landing-section-label">Arşiv</p>
          <h2 className="landing-section-title">Başarılı Tahmin Arşivi</h2>
          <div className="landing-soon">
            <p className="landing-soon-title">Başarılı tahmin arşivi yakında</p>
            <p className="landing-soon-desc">Yalnızca sonuçlanmış ve iç kontrolden geçmiş tahminler public alanda gösterilecektir.</p>
          </div>
        </div>
      </section>

      <section className="landing-disclaimer">
        <div className="landing-section-inner">
          <p>SkorIQ, istatistiksel modelleme ve veri destekli analizlerle hazırlanır. Tahminler kesin sonuç garantisi değildir. Analizler, kullanıcıya maçları daha bilinçli değerlendirme desteği sağlar.</p>
        </div>
      </section>

      <footer className="landing-footer">
        <div className="landing-footer-inner">
          <span className="landing-logo">SkorIQ</span>
          <div className="landing-footer-links">
            <button type="button" onClick={() => navigate("/login")}>Giriş Yap</button>
            <button type="button" onClick={() => navigate("/register")}>Kayıt Ol</button>
            <span>Gizlilik</span>
            <span>Kullanım Şartları</span>
            <span>Sorumluluk Reddi</span>
          </div>
        </div>
        <p className="landing-footer-copy">© {new Date().getFullYear()} SkorIQ</p>
      </footer>
    </div>
  );
}

export function CountryListPage({ navigate }: { navigate: (path: string) => void }) {
  const { data: countries, loading, error } = useLoad(() => fetchFootballCountries(), []);

  const totals = countries
    ? {
        countries: countries.length,
        competitions: countries.reduce((s, c) => s + c.competitionCount, 0),
        teams: countries.reduce((s, c) => s + c.teamCount, 0),
        matches: countries.reduce((s, c) => s + c.matchCount, 0),
        upcoming: countries.reduce((s, c) => s + c.upcomingMatchCount, 0)
      }
    : null;

  return (
    <div className="explorer-shell">
      <header className="explorer-hero-header">
        <span className="explorer-hero-eyebrow">SkorIQ Football</span>
        <h1 className="explorer-hero-title">Futbol Keşfi</h1>
        <p className="explorer-hero-desc">Veriyle taranmış ülkeler ve ligler arasında gezinin.</p>
      </header>

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

      {countries && totals ? (
        <>
          <section className="explorer-global-stats" aria-label="Global istatistikler">
            <div className="explorer-stat-item">
              <span className="explorer-stat-value">{totals.countries}</span>
              <span className="explorer-stat-label">Ülke</span>
            </div>
            <div className="explorer-stat-divider" />
            <div className="explorer-stat-item">
              <span className="explorer-stat-value">{totals.competitions}</span>
              <span className="explorer-stat-label">Lig</span>
            </div>
            <div className="explorer-stat-divider" />
            <div className="explorer-stat-item">
              <span className="explorer-stat-value">{totals.teams.toLocaleString("tr-TR")}</span>
              <span className="explorer-stat-label">Takım</span>
            </div>
            <div className="explorer-stat-divider" />
            <div className="explorer-stat-item">
              <span className="explorer-stat-value">{totals.matches.toLocaleString("tr-TR")}</span>
              <span className="explorer-stat-label">Maç</span>
            </div>
            <div className="explorer-stat-divider" />
            <div className="explorer-stat-item">
              <span className="explorer-stat-value">{totals.upcoming.toLocaleString("tr-TR")}</span>
              <span className="explorer-stat-label">Yaklaşan</span>
            </div>
          </section>

          <div className="country-bento-grid">
            {countries.map((country, index) => {
              const isFeatured = index === 0;
              return (
                <button
                  type="button"
                  className={`country-card${isFeatured ? " country-card-featured" : ""}`}
                  key={country.id}
                  onClick={() => navigate(`/football/countries/${country.id}`)}
                  style={{ animationDelay: `${0.1 + index * 0.06}s` }}
                >
                  <div className="country-card-glow" aria-hidden="true" />
                  <div className="country-card-body">
                    <div className="country-card-identity">
                      {country.logoUrl ? (
                        <img src={country.logoUrl} alt="" className="country-card-logo" loading="lazy" />
                      ) : (
                        <span className="country-card-initials">{country.name.slice(0, 2).toUpperCase()}</span>
                      )}
                      <div className="country-card-title-wrap">
                        <h3 className="country-card-title">{country.name}</h3>
                        {country.averageCoverage != null ? (
                          <span className="country-card-coverage">Veri Kapsamı {Math.round(country.averageCoverage)}%</span>
                        ) : null}
                      </div>
                    </div>
                    <div className="country-card-metrics">
                      <div className="country-metric">
                        <span className="country-metric-value">{country.competitionCount}</span>
                        <span className="country-metric-label">Lig</span>
                      </div>
                      <div className="country-metric">
                        <span className="country-metric-value">{country.teamCount}</span>
                        <span className="country-metric-label">Takım</span>
                      </div>
                      <div className="country-metric">
                        <span className="country-metric-value">{country.matchCount}</span>
                        <span className="country-metric-label">Maç</span>
                      </div>
                      <div className="country-metric">
                        <span className="country-metric-value">{country.upcomingMatchCount}</span>
                        <span className="country-metric-label">Yaklaşan</span>
                      </div>
                    </div>
                  </div>
                  <div className="country-card-footer">
                    <span className="country-card-action">
                      Ligleri Keşfet
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
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
    <>
      <button className="back-button" type="button" onClick={() => navigate("/football")}>
        ← Ülkelere dön
      </button>
      <header className="page-header">
        <h1>{countryName}</h1>
        <p className="page-subtitle">{competitions ? `${competitions.length} lig` : "Ligler yükleniyor..."}</p>
      </header>
      {loading ? <StatePanel title="Ligler yükleniyor..." /> : null}
      {error ? <StatePanel title="Ligler yüklenemedi" body={error} /> : null}
      {competitions ? (
        <div className="league-grid">
          {competitions.map((league) => (
            <button type="button" className="league-card" key={league.id} onClick={() => navigate(`/football/competitions/${league.id}`)}>
              <div className="league-card-header">
                <div className="league-card-logo">
                  {league.logoUrl ? (
                    <img src={league.logoUrl} alt={league.name} />
                  ) : (
                    <span className="initials-avatar">{league.name.charAt(0)}</span>
                  )}
                </div>
                <div className="league-card-title">
                  <h3>{league.name}</h3>
                  <span className={statusClass(league.dataStatus)}>{statusLabel(league.dataStatus)}</span>
                </div>
              </div>
              <div className="league-card-stats">
                <span><strong>{league.teamCount}</strong> Takım</span>
                <span><strong>{league.standingRows}</strong> Sıra</span>
                <span><strong>{league.finishedMatchCount}</strong> Son</span>
                <span><strong>{league.upcomingMatchCount}</strong> Yaklaşan</span>
                {league.averageCoverage != null ? (
                  <span className="coverage-pill">{Math.round(league.averageCoverage)}%</span>
                ) : null}
              </div>
              <span className="league-card-cta">Ligi İncele →</span>
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}
