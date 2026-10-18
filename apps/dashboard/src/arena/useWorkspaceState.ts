import { useEffect, useState } from "react";

// Keep browsing choices for the current session without storing account data.
const browsingChoices = new Map<string, unknown>();

export function clearWorkspaceChoices() {
  browsingChoices.clear();
}

export function useWorkspaceState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => typeof window !== "undefined" && browsingChoices.has(key) ? browsingChoices.get(key) as T : initial);
  useEffect(() => { browsingChoices.set(key, value); }, [key, value]);
  return [value, setValue] as const;
}
