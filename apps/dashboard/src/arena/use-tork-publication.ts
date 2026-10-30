import { useEffect, useState } from "react";

interface PublicationState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

interface RefreshBrowser {
  window: Pick<Window, "addEventListener" | "removeEventListener">;
  document: Pick<Document, "addEventListener" | "removeEventListener" | "visibilityState">;
}

/** Refresh on return to the page, without polling; newest response always wins. */
export function watchTorkPublication<T>(
  load: () => Promise<T>,
  publish: (state: PublicationState<T>) => void,
  browser: RefreshBrowser = { window, document }
): () => void {
  let disposed = false;
  let requestId = 0;
  publish({ data: null, loading: true, error: null });

  const refresh = async () => {
    const current = ++requestId;
    try {
      const data = await load();
      if (!disposed && current === requestId) publish({ data, loading: false, error: null });
    } catch (error: unknown) {
      if (!disposed && current === requestId) publish({
        data: null, loading: false,
        error: error instanceof Error ? error.message : "Tahminler yüklenemedi."
      });
    }
  };
  const onReturn = () => {
    if (browser.document.visibilityState === "visible") void refresh();
  };
  void refresh();
  browser.document.addEventListener("visibilitychange", onReturn);
  browser.window.addEventListener("focus", onReturn);
  return () => {
    disposed = true;
    browser.document.removeEventListener("visibilitychange", onReturn);
    browser.window.removeEventListener("focus", onReturn);
  };
}

export function useTorkPublication<T>(load: () => Promise<T>): PublicationState<T> {
  const [state, setState] = useState<PublicationState<T>>({ data: null, loading: true, error: null });
  useEffect(() => watchTorkPublication(load, setState), [load]);
  return state;
}
