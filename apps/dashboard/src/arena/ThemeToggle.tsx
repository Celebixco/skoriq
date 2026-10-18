import { themePreference, useTheme } from "./theme-preference";
import "./theme-toggle.css";

export function ThemeToggle() {
  const light = useTheme() === "light";
  const label = light ? "Gece temasına geç" : "Gündüz temasına geç";
  return <button type="button" className="arena-theme-toggle" aria-label={label} aria-pressed={light} title={label} onClick={themePreference.toggle}>
    <span className="arena-theme-toggle__icons" aria-hidden="true">
      <svg className="arena-theme-toggle__sun" width="21" height="21" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.6" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
      <svg className="arena-theme-toggle__moon" width="21" height="21" viewBox="0 0 24 24" fill="none"><path d="M20.5 14.1A8.8 8.8 0 0 1 9.9 3.5 8.8 8.8 0 1 0 20.5 14.1Z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </span>
  </button>;
}
