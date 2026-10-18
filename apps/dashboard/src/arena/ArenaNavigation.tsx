import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { AuthUser } from "../types";
import { AppNavIcon, appDestinations, appRouteContext } from "./app-navigation";
import { SkorIQMark } from "./SkorIQMark";

type Navigate = (path: string) => void;
type Props = { currentPath?: string; navigate: Navigate; user?: AuthUser; onLogout?: () => Promise<void>; busy?: boolean };

export function ArenaBrand({ onClick }: { onClick: () => void }) {
  return <button type="button" className="arena-brand" onClick={onClick} aria-label="SkorIQ ana sayfa"><SkorIQMark size={40} /><span>SkorIQ</span></button>;
}

export function ArenaNavigation({ currentPath = "/", navigate, user, onLogout, busy = false }: Props) {
  const [navOpen, setNavOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [searchRequested, setSearchRequested] = useState(false);
  const [logoutPending, setLogoutPending] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const accountRef = useRef<HTMLDivElement>(null);
  const accountToggleRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const routeContext = appRouteContext(currentPath);
  const homeActive = currentPath === "/" || currentPath === "/overview" || currentPath.startsWith("/football/analytics");
  const resultsActive = currentPath.startsWith("/football/prediction-results");
  const go = (path: string) => { setNavOpen(false); setUserOpen(false); navigate(path); };
  const search = () => {
    setSearchRequested(true);
    if (currentPath !== "/football/analytics") go("/football/analytics");
    else document.querySelector<HTMLInputElement>('input[aria-label="Takım veya lig ara"]')?.focus();
  };
  const logout = async () => {
    if (!onLogout || logoutPending) return;
    setLogoutPending(true);
    setLogoutError(null);
    try { await onLogout(); }
    catch { setLogoutError("Çıkış yapılamadı. Lütfen tekrar dene."); }
    finally { setLogoutPending(false); }
  };

  useEffect(() => { setNavOpen(false); setUserOpen(false); }, [currentPath]);
  useEffect(() => {
    if (searchRequested && currentPath === "/football/analytics") {
      document.querySelector<HTMLInputElement>('input[aria-label="Takım veya lig ara"]')?.focus();
      setSearchRequested(false);
    }
  }, [currentPath, searchRequested]);
  useEffect(() => { if (navOpen) navRef.current?.querySelector<HTMLButtonElement>("button")?.focus(); }, [navOpen]);
  useEffect(() => {
    const onDown = (event: PointerEvent) => { if (accountRef.current && !accountRef.current.contains(event.target as Node)) setUserOpen(false); };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { if (userOpen) { setUserOpen(false); accountToggleRef.current?.focus(); } if (navOpen) { setNavOpen(false); menuRef.current?.focus(); } }
      if (user && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); search(); }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  });

  const initial = (user?.firstName?.charAt(0) || user?.email.charAt(0) || "S").toLocaleUpperCase("tr-TR");
  const name = user ? [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email.split("@")[0] : "";
  const items = user ? appDestinations.map((item) => ({ ...item, active: routeContext.section === item.section })) : [{ label: "Maçlar", path: "/", active: homeActive }, { label: "Sonuçlar", path: "/football/prediction-results", active: resultsActive }, { label: "Keşif", path: "/football", active: !homeActive && !resultsActive }];

  return <><header className={`arena-site-header${user ? " arena-site-header--member" : ""}${user && routeContext.parent ? " arena-site-header--detail" : ""}`}>
    {user && routeContext.parent ? <button className="arena-mobile-back" type="button" aria-label={`${routeContext.parent.label} sayfasına dön`} onClick={() => go(routeContext.parent!.path)}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m14 5-7 7 7 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg></button> : null}
    {busy ? <span className="arena-route-progress" role="status" aria-label="Sayfa açılıyor"><i aria-hidden="true" /></span> : null}
    <ArenaBrand onClick={() => go("/")} />
    {user ? <span className="arena-mobile-context">{routeContext.label}</span> : null}
    <nav id="arena-main-navigation" ref={navRef} className={`arena-primary-nav${navOpen ? " is-open" : ""}`} aria-label="Ana menü">{items.map((item) => <button type="button" key={item.path} aria-current={item.active ? "page" : undefined} onClick={() => go(item.path)}>{item.label}</button>)}</nav>
    <div className="arena-header-actions">
      {user ? <>
        <button type="button" className="arena-icon-button arena-header-search" onClick={search} aria-label="Maç ara"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="1.8" /><path d="m16 16 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg></button>
        <div className="arena-account" ref={accountRef}>
          <button ref={accountToggleRef} type="button" className="arena-account-toggle" aria-label={`${name}, hesap menüsü`} aria-controls="arena-account-options" aria-expanded={userOpen} onClick={() => setUserOpen(!userOpen)}><span aria-hidden="true">{initial}</span><svg width="13" height="13" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m5 8 5 5 5-5" stroke="currentColor" strokeWidth="1.5" /></svg></button>
          {userOpen ? <div className="arena-account-menu" id="arena-account-options" aria-label="Hesap"><strong>{name}</strong><span>{user.email}</span><small>Futbol dünyası</small><button type="button" onClick={() => go("/football/analytics")}>Tüm maçlar</button><button type="button" onClick={() => go("/football/teams")}>Takımlar</button><button type="button" onClick={() => go("/football/competitions")}>Ligler</button><button type="button" onClick={() => go("/football")}>Ülkeler ve keşif</button>{user.role === "admin" ? <><small>Yönetim</small><button type="button" onClick={() => go("/football/predictions/drafts")}>Draft Tahminler</button><button type="button" onClick={() => go("/football/predictions/settlements")}>Tahmin Sonuçları</button><button type="button" onClick={() => go("/football/public-eligibility")}>Public Uygunluk</button></> : null}<button type="button" className="arena-account-logout" disabled={logoutPending} onClick={() => void logout()}>{logoutPending ? "Çıkış yapılıyor…" : "Çıkış yap"}</button>{logoutError ? <p className="arena-account-error" role="alert">{logoutError}</p> : null}</div> : null}
        </div>
      </> : <><button className="arena-header-login" type="button" onClick={() => go("/login")}>Giriş yap</button><button className="arena-header-register" type="button" onClick={() => go("/register")}>Ücretsiz başla<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg></button></>}
      {!user ? <button ref={menuRef} className="arena-icon-button arena-mobile-menu" type="button" aria-label={navOpen ? "Menüyü kapat" : "Menüyü aç"} aria-expanded={navOpen} aria-controls="arena-main-navigation" onClick={() => setNavOpen(!navOpen)}><svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">{navOpen ? <path d="m6 6 12 12M6 18 18 6" stroke="currentColor" strokeWidth="1.8" /> : <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="1.8" />}</svg></button> : null}
    </div>
  </header>{user ? <nav className="arena-app-dock" aria-label="Uygulama gezinmesi">{appDestinations.map((item) => <button type="button" key={item.path} aria-current={routeContext.section === item.section ? "page" : undefined} onClick={() => go(item.path)}><span className="arena-app-dock__icon"><AppNavIcon section={item.section} /></span><span>{item.label}</span></button>)}</nav> : null}</>;
}

export function PublicArenaShell({ children, navigate }: { children: ReactNode; navigate: Navigate }) {
  return <div className="arena-public"><a className="arena-skip" href="#arena-public-content">İçeriğe geç</a><ArenaNavigation navigate={navigate} /><main id="arena-public-content">{children}</main></div>;
}
