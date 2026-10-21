import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AppShell } from "../app/AppShell";
import type { AuthUser } from "../types";
import { ArenaNavigation } from "./ArenaNavigation";
import { appDestinations, appRouteContext } from "./app-navigation";

const member: AuthUser = { id: "member", email: "member@example.test", firstName: "Deniz", role: "member", status: "active" };

describe("Authenticated arena navigation", () => {
  it.each([
    ["/", "home"], ["/overview", "home"], ["/dashboard", "home"],
    ["/football/analytics", "matches"], ["/football/analytics/match-12", "matches"],
    ["/football/prediction-results", "results"], ["/football/predictions/upcoming", "predictions"], ["/football", "discover"],
    ["/football/teams/team-1", "discover"], ["/football/competitions/league-1", "discover"],
    ["/football/countries/tr", "discover"], ["/football/predictions/drafts/draft-1", "discover"],
    ["/football/matches/match-1/prediction-settlements", "matches"]
  ])("keeps %s in its correct primary destination", (path, section) => {
    expect(appRouteContext(path).section).toBe(section);
  });

  it("provides five distinct destinations, including upcoming predictions and discovery", () => {
    expect(appDestinations.map(({ path }) => path)).toEqual(["/", "/football/analytics", "/football/predictions/upcoming", "/football/prediction-results", "/football"]);
    const html = renderToStaticMarkup(<ArenaNavigation currentPath="/football/analytics/fixture" user={member} navigate={vi.fn()} onLogout={vi.fn()} />);
    expect(html).toContain('aria-label="Uygulama gezinmesi"');
    const dock = html.split('aria-label="Uygulama gezinmesi"')[1]!;
    expect(dock).toContain('aria-current="page"');
    expect(dock.match(/aria-current="page"/g)).toHaveLength(1);
    expect(dock).toContain("Ana sayfa");
    expect(dock).toContain("Maçlar");
    expect(dock).toContain("Sonuçlar");
    expect(dock).toContain("Keşfet");
    expect(html).toContain('aria-label="Maçlar sayfasına dön"');
    expect(html).not.toContain('aria-label="Menüyü aç"');
  });

  it.each([
    ["/football/analytics/a", "/football/analytics", "Maçlar"],
    ["/football/teams/a", "/football/teams", "Takımlar"],
    ["/football/players/a", "/football/teams", "Takımlar"],
    ["/football/competitions/a", "/football/competitions", "Ligler"],
    ["/football/countries/a", "/football", "Ülkeler"],
    ["/football/predictions/drafts/a", "/football/predictions/drafts", "Draft tahminler"],
    ["/football/matches/a/public-eligibility", "/football/analytics/a", "Maç analizi"]
  ])("returns %s to its own parent, including deep links", (path, parent, label) => {
    expect(appRouteContext(path).parent).toEqual({ path: parent, label });
  });

  it("makes page context focusable and gives deep routes a compact parent trail", () => {
    const html = renderToStaticMarkup(<AppShell currentPath="/football/teams/a" navigate={vi.fn()} user={member} onLogout={vi.fn()} routeLoading={false}><h1>Takım A</h1></AppShell>);
    expect(html).toContain('id="app-content" tabindex="-1" aria-label="Takım profili"');
    expect(html).toContain('aria-label="Sayfa yolu"');
    expect(html).toContain('aria-current="page">Takım profili');
    expect(html).toContain('aria-label="Futbol katalogları"');
    const home = renderToStaticMarkup(<AppShell currentPath="/" navigate={vi.fn()} user={member} onLogout={vi.fn()} routeLoading={false}><h1>Maç gecesi</h1></AppShell>);
    expect(home).not.toContain('aria-label="Sayfa yolu"');
  });

  it("keeps the public header without the authenticated app dock", () => {
    const html = renderToStaticMarkup(<ArenaNavigation navigate={vi.fn()} />);
    expect(html).toContain('aria-label="Menüyü aç"');
    expect(html).toContain("Ücretsiz başla");
    expect(html).not.toContain('aria-label="Uygulama gezinmesi"');
    expect(html).not.toContain("arena-mobile-context");
    expect(html).not.toContain("Draft Tahminler");
  });
});
