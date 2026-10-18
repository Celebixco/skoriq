import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { AuthUser } from "../types";

type Navigate = (path: string) => void;
type Props = { currentPath?: string; navigate: Navigate; user?: AuthUser; onLogout?: () => Promise<void> };

export function ArenaBrand({ onClick }: { onClick: () => void }) {
  return <button type="button" className="arena-brand" onClick={onClick} aria-label="SkorIQ ana sayfa"><svg width="38" height="38" viewBox="0 0 40 40" fill="none" aria-hidden="true"><rect width="40" height="40" rx="9" fill="#FFC400" /><path d="m9 28 8-10 6 5 8-13m-8 0h8v8" stroke="#11190E" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" /></svg><span>SkorIQ</span></button>;
}

export function ArenaNavigation({ currentPath = "/", navigate, user, onLogout }: Props) {
  const [navOpen, setNavOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [searchRequested, setSearchRequested] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);
  const accountToggleRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const homeActive = currentPath === "/" || currentPath === "/overview" || currentPath.startsWith("/football/analytics");
  const resultsActive = currentPath.startsWith("/football/prediction-results");
  const go = (path: string) => { setNavOpen(false); setUserOpen(false); navigate(path); };
  const search = () => {
    setSearchRequested(true);
    if (currentPath !== "/football/analytics") go("/football/analytics");
    else document.querySelector<HTMLInputElement>('input[aria-label="Takım veya lig ara"]')?.focus();
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
  const items = [{ label: "Maçlar", path: "/", active: homeActive }, { label: "Sonuçlar", path: "/football/prediction-results", active: resultsActive }, { label: "Keşif", path: "/football", active: !homeActive && !resultsActive }];

  return <header className="arena-site-header">
    <ArenaBrand onClick={() => go("/")} />
    <nav id="arena-main-navigation" ref={navRef} className={`arena-primary-nav${navOpen ? " is-open" : ""}`} aria-label="Ana menü">{items.map((item) => <button type="button" key={item.path} aria-current={item.active ? "page" : undefined} onClick={() => go(item.path)}>{item.label}</button>)}</nav>
    <div className="arena-header-actions">
      {user ? <>
        <button type="button" className="arena-icon-button arena-header-search" onClick={search} aria-label="Maç ara"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="1.8" /><path d="m16 16 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg></button>
        <div className="arena-account" ref={accountRef}>
          <button ref={accountToggleRef} type="button" className="arena-account-toggle" aria-label={`${name}, hesap menüsü`} aria-controls="arena-account-options" aria-expanded={userOpen} onClick={() => setUserOpen(!userOpen)}><span aria-hidden="true">{initial}</span><svg width="13" height="13" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m5 8 5 5 5-5" stroke="currentColor" strokeWidth="1.5" /></svg></button>
          {userOpen ? <div className="arena-account-menu" id="arena-account-options" aria-label="Hesap"><strong>{name}</strong><span>{user.email}</span><button type="button" onClick={() => go("/football/analytics")}>Tüm maçlar</button><button type="button" onClick={() => go("/football/teams")}>Takımlar</button><button type="button" onClick={() => go("/football/competitions")}>Ligler</button>{user.role === "admin" ? <><small>Yönetim</small><button type="button" onClick={() => go("/football/predictions/drafts")}>Draft Tahminler</button><button type="button" onClick={() => go("/football/predictions/settlements")}>Tahmin Sonuçları</button><button type="button" onClick={() => go("/football/public-eligibility")}>Public Uygunluk</button></> : null}<button type="button" className="arena-account-logout" onClick={() => { setUserOpen(false); void onLogout?.(); }}>Çıkış yap</button></div> : null}
        </div>
      </> : <><button className="arena-header-login" type="button" onClick={() => go("/login")}>Giriş yap</button><button className="arena-header-register" type="button" onClick={() => go("/register")}>Ücretsiz başla<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg></button></>}
      <button ref={menuRef} className="arena-icon-button arena-mobile-menu" type="button" aria-label={navOpen ? "Menüyü kapat" : "Menüyü aç"} aria-expanded={navOpen} aria-controls="arena-main-navigation" onClick={() => setNavOpen(!navOpen)}><svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">{navOpen ? <path d="m6 6 12 12M6 18 18 6" stroke="currentColor" strokeWidth="1.8" /> : <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="1.8" />}</svg></button>
    </div>
  </header>;
}

export function PublicArenaShell({ children, navigate }: { children: ReactNode; navigate: Navigate }) {
  return <div className="arena-public"><a className="arena-skip" href="#arena-public-content">İçeriğe geç</a><ArenaNavigation navigate={navigate} /><main id="arena-public-content">{children}</main></div>;
}
