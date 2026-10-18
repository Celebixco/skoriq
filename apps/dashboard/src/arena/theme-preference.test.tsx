import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const key = "skoriq:theme:v1";

function browser(saved: string | null = null, blocked = false) {
  const values = new Map<string, string>(saved === null ? [] : [[key, saved]]);
  const localStorage = {
    getItem: (name: string) => { if (blocked) throw new Error("Storage blocked"); return values.get(name) ?? null; },
    setItem: (name: string, value: string) => { if (blocked) throw new Error("Storage blocked"); values.set(name, value); }
  };
  const root = { dataset: {} as Record<string, string>, style: { colorScheme: "" } };
  const meta = { content: "", setAttribute(_name: string, value: string) { this.content = value; } };
  const document = { documentElement: root, querySelector: () => meta };
  const window = Object.assign(new EventTarget(), { localStorage });
  return { localStorage, root, meta, document, window, values };
}

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe("Theme before the first paint", () => {
  const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? "";

  it.each([["light", "light", "#f6f5ef"], ["dark", "dark", "#070b08"], [null, "dark", "#070b08"], ["unexpected", "dark", "#070b08"]])("starts saved %s without flashing the opposite theme", (saved, expected, color) => {
    const env = browser(saved);
    runInNewContext(script, { document: env.document, localStorage: env.localStorage });
    expect(env.root.dataset.theme).toBe(expected);
    expect(env.root.style.colorScheme).toBe(expected);
    expect(env.meta.content).toBe(color);
  });

  it("renders the default dark theme when browser storage is blocked", () => {
    const env = browser(null, true);
    expect(() => runInNewContext(script, { document: env.document, localStorage: env.localStorage })).not.toThrow();
    expect(env.root.dataset.theme).toBe("dark");
  });
});

describe("Shared theme preference", () => {
  async function setup(saved: string | null = null, blocked = false) {
    const env = browser(saved, blocked);
    vi.stubGlobal("window", env.window);
    vi.stubGlobal("document", env.document);
    const { themePreference } = await import("./theme-preference");
    return { ...env, themePreference };
  }

  it("persists an explicit choice and updates the document and browser chrome", async () => {
    const { themePreference, values, root, meta } = await setup();
    expect(themePreference.getSnapshot()).toBe("dark");
    themePreference.toggle();
    expect(values.get(key)).toBe("light");
    expect(root.dataset.theme).toBe("light");
    expect(root.style.colorScheme).toBe("light");
    expect(meta.content).toBe("#f6f5ef");
    themePreference.toggle();
    expect(values.get(key)).toBe("dark");
    expect(meta.content).toBe("#070b08");
  });

  it.each([["light", "light"], ["dark", "dark"], ["invalid", "dark"]])("restores %s as %s on a later visit", async (saved, expected) => {
    const { themePreference, root } = await setup(saved);
    expect(themePreference.getSnapshot()).toBe(expected);
    expect(root.dataset.theme).toBe(expected);
  });

  it("keeps toggling for this visit when storage access fails", async () => {
    const { themePreference, root } = await setup(null, true);
    expect(() => themePreference.toggle()).not.toThrow();
    expect(themePreference.getSnapshot()).toBe("light");
    expect(root.dataset.theme).toBe("light");
  });

  it("reconciles another tab's saved choice made before the header mounts", async () => {
    const { themePreference, root, localStorage } = await setup("light");
    localStorage.setItem(key, "dark");
    const stop = themePreference.subscribe(() => undefined);
    expect(themePreference.getSnapshot()).toBe("dark");
    expect(root.dataset.theme).toBe("dark");
    stop();
  });

  it("keeps the in-memory choice when remounting with storage blocked", async () => {
    const { themePreference, root } = await setup(null, true);
    themePreference.toggle();
    const firstStop = themePreference.subscribe(() => undefined);
    firstStop();
    const secondStop = themePreference.subscribe(() => undefined);
    expect(themePreference.getSnapshot()).toBe("light");
    expect(root.dataset.theme).toBe("light");
    secondStop();
  });

  it("keeps all subscribers in sync and receives choices from other tabs", async () => {
    const { themePreference, window, root, localStorage } = await setup();
    const seen: string[][] = [[], []];
    const unsubscribe = seen.map((snapshots) => themePreference.subscribe(() => snapshots.push(themePreference.getSnapshot())));
    themePreference.toggle();
    const dispatch = (eventKey: string | null, newValue: string | null) => window.dispatchEvent(Object.assign(new Event("storage"), { key: eventKey, newValue, storageArea: localStorage }));
    dispatch("unrelated", "dark");
    expect(themePreference.getSnapshot()).toBe("light");
    dispatch(key, "dark");
    expect(root.dataset.theme).toBe("dark");
    expect(seen).toEqual([["light", "dark"], ["light", "dark"]]);
    dispatch(key, "invalid");
    expect(themePreference.getSnapshot()).toBe("dark");
    unsubscribe.forEach((stop) => stop());
  });

  it("returns to the default after another tab clears the saved preference", async () => {
    const { themePreference, window, root, localStorage } = await setup("light");
    const stop = themePreference.subscribe(() => undefined);
    window.dispatchEvent(Object.assign(new Event("storage"), { key: null, newValue: null, storageArea: localStorage }));
    expect(root.dataset.theme).toBe("dark");
    stop();
  });

  it("renders an accessible, provider-free toggle on the server", async () => {
    const { ThemeToggle } = await import("./ThemeToggle");
    const html = renderToStaticMarkup(<ThemeToggle />);
    expect(html).toContain('type="button"');
    expect(html).toContain('aria-label="Gündüz temasına geç"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('aria-hidden="true"');
  });
});
