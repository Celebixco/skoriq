import { describe, expect, it, vi } from "vitest";
import { watchTorkPublication } from "./use-tork-publication";

function browser() {
  return {
    window: new EventTarget(),
    document: Object.assign(new EventTarget(), { visibilityState: "visible" as DocumentVisibilityState })
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("Tork publication refresh on return", () => {
  it("loads on mount, refreshes on focus/visible, and ignores hidden-tab events", async () => {
    const env = browser();
    const load = vi.fn().mockResolvedValue({ predictionId: "legacy" });
    const publish = vi.fn();
    const stop = watchTorkPublication(load, publish, env);
    expect(publish).toHaveBeenCalledWith({ data: null, loading: true, error: null });
    await Promise.resolve();
    expect(publish).toHaveBeenLastCalledWith({ data: { predictionId: "legacy" }, loading: false, error: null });

    load.mockResolvedValue({ predictionId: "binary-v2" });
    env.window.dispatchEvent(new Event("focus"));
    await Promise.resolve();
    expect(publish).toHaveBeenLastCalledWith({ data: { predictionId: "binary-v2" }, loading: false, error: null });

    env.document.visibilityState = "hidden";
    env.document.dispatchEvent(new Event("visibilitychange"));
    env.window.dispatchEvent(new Event("focus"));
    expect(load).toHaveBeenCalledTimes(2);

    env.document.visibilityState = "visible";
    env.document.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(3);
    stop();
    env.window.dispatchEvent(new Event("focus"));
    env.document.dispatchEvent(new Event("visibilitychange"));
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("does not let a slower old response overwrite the new policy publication", async () => {
    const env = browser();
    const old = deferred<{ predictionId: string }>();
    const current = deferred<{ predictionId: string }>();
    const load = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const publish = vi.fn();
    const stop = watchTorkPublication(load, publish, env);
    env.window.dispatchEvent(new Event("focus"));

    current.resolve({ predictionId: "binary-v2" });
    await Promise.resolve();
    old.resolve({ predictionId: "legacy" });
    await Promise.resolve();

    expect(publish).toHaveBeenCalledTimes(2); // loading, then only the newest response
    expect(publish).toHaveBeenLastCalledWith({ data: { predictionId: "binary-v2" }, loading: false, error: null });
    stop();
  });

  it("clears stale data on a refresh failure and recovers on the next visible event", async () => {
    const env = browser();
    const load = vi.fn().mockResolvedValueOnce({ predictionId: "legacy" }).mockRejectedValueOnce(new Error("Unavailable")).mockResolvedValueOnce({ predictionId: "binary-v2" });
    const publish = vi.fn();
    const stop = watchTorkPublication(load, publish, env);
    await Promise.resolve();
    env.window.dispatchEvent(new Event("focus"));
    await Promise.resolve();
    expect(publish).toHaveBeenLastCalledWith({ data: null, loading: false, error: "Unavailable" });

    env.document.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();
    expect(publish).toHaveBeenLastCalledWith({ data: { predictionId: "binary-v2" }, loading: false, error: null });
    stop();
  });

  it("ignores an in-flight response after unmount or a match change", async () => {
    const env = browser();
    const pending = deferred<string>();
    const publish = vi.fn();
    const stop = watchTorkPublication(() => pending.promise, publish, env);
    stop();
    pending.resolve("wrong match");
    await Promise.resolve();
    expect(publish).toHaveBeenCalledExactlyOnceWith({ data: null, loading: true, error: null });
  });
});
