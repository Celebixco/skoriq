import { useSyncExternalStore } from "react";

export type Theme = "dark" | "light";
const storageKey = "skoriq:theme:v1";
const listeners = new Set<() => void>();

function readSavedTheme(fallback: Theme = "dark"): Theme {
  try { return typeof window !== "undefined" && window.localStorage.getItem(storageKey) === "light" ? "light" : "dark"; }
  catch { return fallback; }
}

function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "light" ? "#f6f5ef" : "#070b08");
}

let currentTheme = readSavedTheme();
applyTheme(currentTheme);

function update(theme: Theme) {
  applyTheme(theme);
  if (currentTheme === theme) return;
  currentTheme = theme;
  listeners.forEach((listener) => listener());
}

function receiveStorage(event: StorageEvent) {
  if (event.key !== storageKey && event.key !== null) return;
  try { if (event.storageArea && event.storageArea !== window.localStorage) return; }
  catch { return; }
  update(event.newValue === "light" ? "light" : "dark");
}

export const themePreference = {
  getSnapshot: () => currentTheme,
  getServerSnapshot: (): Theme => "dark",
  subscribe(listener: () => void) {
    listeners.add(listener);
    if (listeners.size === 1 && typeof window !== "undefined") {
      window.addEventListener("storage", receiveStorage);
      // A choice made in another tab during session loading may predate this subscription.
      update(readSavedTheme(currentTheme));
    }
    return () => {
      listeners.delete(listener);
      if (!listeners.size && typeof window !== "undefined") window.removeEventListener("storage", receiveStorage);
    };
  },
  toggle() {
    const theme = currentTheme === "dark" ? "light" : "dark";
    try { if (typeof window !== "undefined") window.localStorage.setItem(storageKey, theme); }
    catch { /* The choice still applies for this visit when storage is unavailable. */ }
    update(theme);
  }
};

export function useTheme() {
  return useSyncExternalStore(themePreference.subscribe, themePreference.getSnapshot, themePreference.getServerSnapshot);
}
