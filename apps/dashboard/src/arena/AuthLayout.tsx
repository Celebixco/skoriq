import type { MouseEvent, ReactNode } from "react";
import "./auth.css";
import { ArenaAmbient } from "./ArenaAmbient";
import { SkorIQMark } from "./SkorIQMark";

export type AuthNavigate = (path: string) => void;

export function AuthLink({ to, navigate, children, className = "" }: { to: string; navigate: AuthNavigate; children: ReactNode; className?: string }) {
  const follow = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to);
  };
  return <a className={className} href={to} onClick={follow}>{children}</a>;
}

export function AuthArrow({ back = false }: { back?: boolean }) {
  return <svg aria-hidden="true" width="23" height="23" viewBox="0 0 24 24" fill="none" className={back ? "arena-auth__arrow--back" : undefined}><path d="M4 12h15M13 5l7 7-7 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export function AuthLayout({ variant = "login", navigate, kicker, title, subtitle, children, footer }: {
  variant?: "login" | "register";
  navigate: AuthNavigate;
  kicker: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  const registering = variant === "register";
  return (
    <main className={`arena-auth arena-auth--${variant}`}>
      <ArenaAmbient />
      <header className="arena-auth__header">
        <AuthLink to="/" navigate={navigate} className="arena-auth__brand">
          <SkorIQMark size={42} />
          <span>SkorIQ</span>
        </AuthLink>
        <AuthLink to="/" navigate={navigate} className="arena-auth__back"><AuthArrow back /><span>Ana sayfaya dön</span></AuthLink>
      </header>
      <div className="arena-auth__content">
        <section className="arena-auth__story" aria-labelledby="arena-auth-headline">
          <p className="arena-auth__eyebrow">{registering ? "SKORIQ" : "MAÇ GECESİ"}</p>
          <h1 id="arena-auth-headline">{registering ? <><span>MAÇ GECEN</span><span>BURADA</span><span>BAŞLIYOR.</span></> : <><span>MAÇIN</span><span>RİTMİNE DÖN.</span></>}</h1>
          <p className="arena-auth__story-copy">{registering ? "Ücretsiz hesabını oluştur. Maçları verisiyle keşfet." : "Maçları verisiyle oku. Tahminlerin gerekçesini gör."}</p>
          <div className="arena-auth__sideline" aria-hidden="true"><span /> VERİ. GEREKÇE. MAÇIN HİKÂYESİ.</div>
        </section>
        <section className="arena-auth__ticket" aria-labelledby="arena-auth-title">
          <div className="arena-auth__perforation" aria-hidden="true" />
          <div className="arena-auth__ticket-body">
            <p className="arena-auth__kicker">{kicker}</p>
            <h2 id="arena-auth-title">{title}</h2>
            {subtitle ? <p className="arena-auth__subtitle">{subtitle}</p> : null}
            {children}
          </div>
          <div className="arena-auth__ticket-footer">{footer}</div>
          {!registering ? <p className="arena-auth__secure"><svg aria-hidden="true" width="16" height="18" viewBox="0 0 16 18" fill="none"><rect x="2" y="8" width="12" height="9" rx="1" stroke="currentColor" strokeWidth="1.3" /><path d="M5 8V5a3 3 0 0 1 6 0v3M8 11v3" stroke="currentColor" strokeWidth="1.3" /></svg>Güvenli hesap erişimi</p> : null}
        </section>
      </div>
      <p className="arena-auth__footnote">SkorIQ · Maçı veriyle oku.</p>
    </main>
  );
}
