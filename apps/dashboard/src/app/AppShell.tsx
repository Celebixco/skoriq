import type { ReactNode } from "react";
import type { AuthUser } from "../types";
import { ArenaNavigation } from "../arena/ArenaNavigation";

export function AppShell({ children, currentPath, navigate, user, onLogout, routeLoading }: {
  children: ReactNode;
  currentPath: string;
  navigate: (path: string) => void;
  user: AuthUser;
  onLogout: () => Promise<void>;
  routeLoading: boolean;
}) {
  const home = currentPath === "/" || currentPath === "/overview" || currentPath === "/dashboard";
  return <div className={`app-shell arena-shell${home ? " arena-shell--home" : ""}`}>
    <a className="arena-skip" href="#app-content">İçeriğe geç</a>
    <ArenaNavigation currentPath={currentPath} navigate={navigate} user={user} onLogout={onLogout} />
    <div className="app-main"><main className="page-container" id="app-content">{children}{routeLoading ? <div className="app-route-loading" role="status">Yükleniyor…</div> : null}</main></div>
  </div>;
}
