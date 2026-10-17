import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { AuthUser } from "../types";

type IconName =
  | "overview"
  | "analytics"
  | "explore"
  | "teams"
  | "leagues"
  | "results"
  | "drafts"
  | "settlements"
  | "eligibility"
  | "basketball"
  | "menu"
  | "search"
  | "chevron"
  | "logout";

const ICONS: Record<IconName, ReactNode> = {
  overview: (
    <>
      <rect x="2.5" y="2.5" width="6" height="6" rx="1.2" />
      <rect x="11.5" y="2.5" width="6" height="6" rx="1.2" />
      <rect x="2.5" y="11.5" width="6" height="6" rx="1.2" />
      <rect x="11.5" y="11.5" width="6" height="6" rx="1.2" />
    </>
  ),
  analytics: <path d="M2.5 10h3l2-5 4 10 2-5h4" />,
  explore: (
    <>
      <circle cx="10" cy="10" r="7" />
      <path d="M3 10h14M10 3c2.4 2 2.4 12 0 14M10 3c-2.4 2-2.4 12 0 14" />
    </>
  ),
  teams: (
    <>
      <circle cx="7.2" cy="7.2" r="2.6" />
      <path d="M2.6 16c.4-3 2.2-4.7 4.6-4.7S11.4 13 11.8 16" />
      <circle cx="14.2" cy="8.2" r="2.1" />
      <path d="M13 11.9c2 .2 3.5 1.6 3.9 4.1" />
    </>
  ),
  leagues: (
    <>
      <path d="M6 3h8v4.5a4 4 0 0 1-8 0V3Z" />
      <path d="M6 4.6H3.6v1.7A3.1 3.1 0 0 0 6.7 9.4M14 4.6h2.4v1.7a3.1 3.1 0 0 1-3.1 3.1M10 11.5V15M7 17h6" />
    </>
  ),
  results: (
    <>
      <path d="M5 3.5h10v13H5z" />
      <path d="M7.6 7.2h4.8M7.6 10h4.8M7.6 12.8h2.8" />
    </>
  ),
  drafts: (
    <>
      <path d="M5 3h7l3 3v11H5z" />
      <path d="M12 3v3h3M7.6 10h4.8M7.6 13h3" />
    </>
  ),
  settlements: (
    <>
      <circle cx="10" cy="10" r="7" />
      <path d="m6.5 10 2.2 2.2 4.8-5" />
    </>
  ),
  eligibility: (
    <>
      <path d="M10 2.6 16 5v5c0 3.4-2.5 5.9-6 7.4-3.5-1.5-6-4-6-7.4V5l6-2.4Z" />
      <path d="m7.5 9.8 1.8 1.8 3.4-3.6" />
    </>
  ),
  basketball: (
    <>
      <circle cx="10" cy="10" r="7" />
      <path d="M3 10h14M10 3v14M4.6 4.6c3 3 7.8 3 10.8 0M4.6 15.4c3-3 7.8-3 10.8 0" />
    </>
  ),
  menu: <path d="M3 6h14M3 10h14M3 14h14" />,
  search: (
    <>
      <circle cx="8.6" cy="8.6" r="4.6" />
      <path d="m12 12 4 4" />
    </>
  ),
  chevron: <path d="m6.5 8.2 3.5 3.5 3.5-3.5" />,
  logout: <path d="M8 3H4v14h4M12.5 6.5 16 10l-3.5 3.5M16 10H8" />,
};

function Glyph({ name }: { name: IconName }) {
  return (
    <svg className="app-nav-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="38" height="38" rx="10" fill="#FFC400" />
      <path d="M10.5 26.6 L16.8 19.4 L22.4 22" stroke="#1D1913" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M22.4 22 L28.4 14" stroke="#1D1913" strokeWidth="3.4" strokeLinecap="round" strokeDasharray="3.2 2.6" />
      <circle cx="29.1" cy="13.2" r="3.3" fill="#1D1913" />
      <circle cx="29.1" cy="13.2" r="6" stroke="#1D1913" strokeOpacity=".3" strokeWidth="1.4" />
    </svg>
  );
}

type NavItem = {
  label: string;
  icon: IconName;
  path: string;
  active: (path: string) => boolean;
  hint?: string;
};

const ANALIZ: NavItem[] = [
  { label: "Genel Bakış", icon: "overview", path: "/", active: (path) => path === "/" },
  { label: "Maç Analizi", icon: "analytics", path: "/football/analytics", active: (path) => path.startsWith("/football/analytics") },
  { label: "Sonuçlar", icon: "results", path: "/football/prediction-results", active: (path) => path.startsWith("/football/prediction-results") }
];

const KESIF: NavItem[] = [
  { label: "Futbol Keşfi", icon: "explore", path: "/football", active: (path) => path === "/football" || path.startsWith("/football/countries") },
  { label: "Takımlar", icon: "teams", path: "/football/teams", active: (path) => path.startsWith("/football/teams") },
  { label: "Ligler", icon: "leagues", path: "/football/competitions", active: (path) => path.startsWith("/football/competitions") }
];

const DENETIM: NavItem[] = [
  { label: "Draft Tahminler", icon: "drafts", path: "/football/predictions/drafts", active: (path) => path.startsWith("/football/predictions/drafts") || path.includes("/prediction-drafts") },
  { label: "Tahmin Sonuçları", icon: "settlements", path: "/football/predictions/settlements", active: (path) => path.startsWith("/football/predictions/settlements") || path.includes("/prediction-settlements") },
  { label: "Public Uygunluk", icon: "eligibility", path: "/football/public-eligibility", active: (path) => path.startsWith("/football/public-eligibility") || path.includes("/public-eligibility") }
];

function pageTitle(path: string) {
  if (path === "/") return "Genel Bakış";
  if (path.startsWith("/football/analytics/")) return "Maç Raporu";
  if (path === "/football/analytics") return "Maç Analizi";
  if (path === "/football/prediction-results") return "Sonuçlar";
  if (path.startsWith("/football/teams/")) return "Takım Profili";
  if (path === "/football/teams") return "Takımlar";
  if (path.startsWith("/football/competitions/")) return "Lig Detayı";
  if (path === "/football/competitions") return "Ligler";
  if (path.startsWith("/football/countries")) return "Futbol Keşfi";
  if (path === "/football") return "Futbol Keşfi";
  if (path.startsWith("/football/predictions/drafts") || path.includes("/prediction-drafts")) return "Draft Tahminler";
  if (path.startsWith("/football/predictions/settlements") || path.includes("/prediction-settlements")) return "Tahmin Sonuçları";
  if (path.startsWith("/football/public-eligibility") || path.includes("/public-eligibility")) return "Public Uygunluk";
  return "SkorIQ";
}

function roleLabel(role: AuthUser["role"]) {
  return role === "admin" ? "Admin" : "Üye";
}

export function AppShell({
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
  const [navOpen, setNavOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const userRef = useRef<HTMLDivElement | null>(null);
  const isAdmin = user.role === "admin";
  const initial = (user.firstName?.trim().charAt(0) || user.email.trim().charAt(0) || "S").toUpperCase();
  const displayName = [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || user.email.split("@")[0];
  const title = pageTitle(currentPath);
  const date = new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "long", year: "numeric" }).format(new Date());

  useEffect(() => {
    setNavOpen(false);
    setUserOpen(false);
  }, [currentPath]);

  useEffect(() => {
    if (!userOpen) return;
    const onDown = (event: globalThis.MouseEvent) => {
      if (userRef.current && !userRef.current.contains(event.target as Node)) setUserOpen(false);
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setUserOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [userOpen]);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        navigate("/football/analytics");
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [navigate]);

  const go = (path: string) => {
    setNavOpen(false);
    setUserOpen(false);
    navigate(path);
  };

  const renderGroup = (label: string, items: NavItem[], admin = false) => (
    <div className="app-nav-group">
      <p className="app-nav-label">
        {label}
        {admin ? <span className="app-nav-admin">ADMIN</span> : null}
      </p>
      {items.map((item) => {
        const active = item.active(currentPath);
        return (
          <button
            key={item.path}
            type="button"
            className={`app-nav-item${active ? " is-active" : ""}`}
            onClick={() => go(item.path)}
            aria-current={active ? "page" : undefined}
          >
            <Glyph name={item.icon} />
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="app-shell">
      <a className="app-skip" href="#app-content">İçeriğe geç</a>

      <aside className={`app-rail${navOpen ? " is-open" : ""}`} aria-label="Uygulama menüsü">
        <div className="app-rail-head">
          <button className="app-brand" type="button" onClick={() => go("/")} aria-label="SkorIQ ana sayfa">
            <Mark size={28} />
            <span>Skor<i>IQ</i></span>
          </button>
          <span className="app-workspace">Futbol Analizi</span>
        </div>

        <nav className="app-nav">
          {renderGroup("Analiz", ANALIZ)}
          {renderGroup("Keşif", KESIF)}
          {isAdmin ? renderGroup("İç Denetim", DENETIM, true) : null}
          <span className="app-nav-soon" aria-disabled="true">
            <Glyph name="basketball" />
            <span>Basketbol</span>
            <em>yakında</em>
          </span>
        </nav>

        <div className="app-rail-foot">
          <div className="app-health">
            <i aria-hidden="true" />
            <div>
              <b>Veri hattı</b>
              <span>Bağlı · son kontrol az önce</span>
            </div>
          </div>
          <div className="app-version">
            <span>SkorIQ v3</span>
            <span>Analiz masası</span>
          </div>
        </div>
      </aside>

      {navOpen ? <button className="app-backdrop" type="button" aria-label="Menüyü kapat" onClick={() => setNavOpen(false)} /> : null}

      <div className="app-main">
        <header className="app-topbar">
          <button className="app-menu" type="button" aria-label="Menüyü aç" onClick={() => setNavOpen(true)}>
            <Glyph name="menu" />
          </button>
          <div className="app-crumb">
            <span>SkorIQ</span>
            <i aria-hidden="true">/</i>
            <strong>{title}</strong>
          </div>
          <div className="app-top-actions">
            <span className="app-date">{date}</span>
            <button className="app-search" type="button" onClick={() => go("/football/analytics")} aria-label="Maç ara">
              <Glyph name="search" />
              <span>Maç ara</span>
              <kbd>⌘K</kbd>
            </button>
            <span className="app-live"><i aria-hidden="true" />Canlı veri</span>
            <div className="app-user-wrap" ref={userRef}>
              <button
                className={`app-user-btn${userOpen ? " is-open" : ""}`}
                type="button"
                aria-expanded={userOpen}
                aria-haspopup="true"
                onClick={() => setUserOpen((value) => !value)}
              >
                <span className="app-avatar" aria-hidden="true">{initial}</span>
                <span className="app-user-role">{roleLabel(user.role)}</span>
                <Glyph name="chevron" />
              </button>
              {userOpen ? (
                <div className="app-user-pop" role="menu">
                  <div className="app-user-info">
                    <strong>{displayName}</strong>
                    <span>{user.email}</span>
                    <em>{isAdmin ? "İç denetim yetkisi" : "Üye hesabı"}</em>
                  </div>
                  <button type="button" className="app-logout" role="menuitem" onClick={() => void onLogout()}>
                    <Glyph name="logout" />
                    Çıkış yap
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <main className="page-container" id="app-content">
          {children}
          {routeLoading ? <div className="app-route-loading" role="status">Yükleniyor…</div> : null}
        </main>
      </div>
    </div>
  );
}
