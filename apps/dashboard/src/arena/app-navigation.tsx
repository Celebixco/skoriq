export type AppSection = "home" | "matches" | "results" | "discover";

export const appDestinations: { section: AppSection; label: string; path: string }[] = [
  { section: "home", label: "Ana sayfa", path: "/" },
  { section: "matches", label: "Maçlar", path: "/football/analytics" },
  { section: "results", label: "Sonuçlar", path: "/football/prediction-results" },
  { section: "discover", label: "Keşfet", path: "/football" }
];

export function appRouteContext(path: string): { section: AppSection; label: string; parent?: { label: string; path: string } } {
  const route = path.split(/[?#]/)[0]!.replace(/\/+$/, "") || "/";
  if (["/", "/overview", "/dashboard"].includes(route)) return { section: "home", label: "Maç gecesi" };
  if (route === "/football/analytics") return { section: "matches", label: "Maç merkezi" };
  if (route.startsWith("/football/analytics/")) return { section: "matches", label: "Maç analizi", parent: { label: "Maçlar", path: "/football/analytics" } };
  if (route.startsWith("/football/prediction-results")) return { section: "results", label: "Tahmin sonuçları" };
  if (route.startsWith("/football/players/")) return { section: "discover", label: "Oyuncu profili", parent: { label: "Takımlar", path: "/football/teams" } };
  if (route.startsWith("/football/teams")) return { section: "discover", label: route === "/football/teams" ? "Takımlar" : "Takım profili", parent: { label: route === "/football/teams" ? "Keşfet" : "Takımlar", path: route === "/football/teams" ? "/football" : "/football/teams" } };
  if (route.startsWith("/football/competitions")) return { section: "discover", label: route === "/football/competitions" ? "Ligler" : "Lig merkezi", parent: { label: route === "/football/competitions" ? "Keşfet" : "Ligler", path: route === "/football/competitions" ? "/football" : "/football/competitions" } };
  if (route.startsWith("/football/countries/")) return { section: "discover", label: "Ülke futbolu", parent: { label: "Ülkeler", path: "/football" } };
  const matchAdmin = route.match(/^\/football\/matches\/([^/]+)\//);
  if (matchAdmin) return { section: "matches", label: "Maç yönetimi", parent: { label: "Maç analizi", path: `/football/analytics/${matchAdmin[1]}` } };
  for (const [base, label, detailLabel] of [
    ["/football/predictions/drafts", "Draft tahminler", "Tahmin incelemesi"],
    ["/football/predictions/settlements", "Tahmin sonuçlandırma", "Sonuç incelemesi"],
    ["/football/public-eligibility", "Yayın uygunluğu", "Yayın incelemesi"]
  ] as const) {
    if (route === base) return { section: "discover", label, parent: { label: "Keşfet", path: "/football" } };
    if (route.startsWith(`${base}/`)) return { section: "discover", label: detailLabel, parent: { label, path: base } };
  }
  return { section: "discover", label: "Futbol keşfi" };
}

export function AppNavIcon({ section }: { section: AppSection }) {
  return <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{
    section === "home" ? <><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z" /></> :
    section === "matches" ? <><rect x="3" y="4" width="18" height="17" rx="3" /><path d="M3 9h18M8 2v4m8-4v4m-7 8 5 3-5 3Z" /></> :
    section === "results" ? <><path d="M5 21V11m7 10V4m7 17v-7M3 21h18" /><path d="m16 5 2 2 3-4" /></> :
    <><circle cx="12" cy="12" r="9" /><path d="m16 8-2.5 5.5L8 16l2.5-5.5Z" /></>
  }</svg>;
}
