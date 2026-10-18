import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import type { AuthUser } from "../types";
import { ArenaNavigation } from "../arena/ArenaNavigation";
import { appRouteContext } from "../arena/app-navigation";
import "../arena/app-navigation.css";

export function AppShell({ children, currentPath, navigate, user, onLogout, routeLoading }: {
  children: ReactNode;
  currentPath: string;
  navigate: (path: string) => void;
  user: AuthUser;
  onLogout: () => Promise<void>;
  routeLoading: boolean;
}) {
  const home = currentPath === "/" || currentPath === "/overview" || currentPath === "/dashboard";
  const context = appRouteContext(currentPath);
  const previousPath = useRef(currentPath);
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (previousPath.current === currentPath) return;
    previousPath.current = currentPath;
    window.scrollTo(0, 0);
    mainRef.current?.focus({ preventScroll: true });
  }, [currentPath]);

  return <div className={`app-shell arena-shell${home ? " arena-shell--home" : ""}`}>
    <a className="arena-skip" href="#app-content">İçeriğe geç</a>
    <ArenaNavigation currentPath={currentPath} navigate={navigate} user={user} onLogout={onLogout} busy={routeLoading} />
    <div className="app-main"><main ref={mainRef} className="page-container" id="app-content" tabIndex={-1} aria-label={context.label}>
      {!home ? <div className="arena-page-wayfinding"><nav aria-label="Sayfa yolu"><ol><li><button type="button" onClick={() => navigate("/")}>Ana sayfa</button></li>{context.parent && context.parent.path !== "/" ? <li><button type="button" onClick={() => navigate(context.parent!.path)}>{context.parent.label}</button></li> : null}<li><span aria-current="page">{context.label}</span></li></ol></nav><div className="arena-catalog-shortcuts" aria-label="Futbol katalogları"><button type="button" onClick={() => navigate("/football/teams")}>Takımlar</button><button type="button" onClick={() => navigate("/football/competitions")}>Ligler</button><button type="button" onClick={() => navigate("/football")}>Ülkeler</button></div></div> : null}
      {children}
    </main></div>
  </div>;
}
