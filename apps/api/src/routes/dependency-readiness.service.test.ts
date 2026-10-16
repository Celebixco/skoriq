import { afterEach, describe, expect, it, vi } from "vitest";
import { DependencyReadinessService } from "./dependency-readiness.service.js";
import type { ReadinessProbes } from "./dependency-readiness.service.js";

function workingProbes(overrides: Partial<ReadinessProbes> = {}): ReadinessProbes {
  return {
    database: async () => {},
    redis: async () => {},
    close: async () => {},
    ...overrides
  };
}

afterEach(() => vi.useRealTimers());

describe("DependencyReadinessService", () => {
  it("is ready only after both dependencies answer", async () => {
    const service = new DependencyReadinessService(workingProbes());
    await expect(service.check()).resolves.toMatchObject({
      status: "ready",
      dependencies: { database: "ok", redis: "ok" }
    });
  });

  it.each(["database", "redis"] as const)("reports %s failure without exposing its error", async (dependency) => {
    const service = new DependencyReadinessService(workingProbes({
      [dependency]: async () => { throw new Error("internal connection diagnostic"); }
    }));
    const result = await service.check();
    expect(result.status).toBe("not_ready");
    expect(result.dependencies[dependency]).toBe("unavailable");
    expect(JSON.stringify(result)).not.toContain("internal connection diagnostic");
    expect(result).not.toHaveProperty("stack");
  });

  it("bounds a hanging probe to three seconds", async () => {
    vi.useFakeTimers();
    const service = new DependencyReadinessService(workingProbes({
      database: () => new Promise<void>(() => {})
    }));
    const result = service.check();
    await vi.advanceTimersByTimeAsync(3000);
    await expect(result).resolves.toMatchObject({
      status: "not_ready",
      dependencies: { database: "unavailable", redis: "ok" }
    });
  });

  it("deduplicates concurrent probes and reuses a short-lived result", async () => {
    let databaseChecks = 0;
    let redisChecks = 0;
    const service = new DependencyReadinessService(workingProbes({
      database: async () => { databaseChecks += 1; },
      redis: async () => { redisChecks += 1; }
    }));
    const results = await Promise.all([service.check(), service.check(), service.check()]);
    const cached = await service.check();
    expect(results.every((result) => result.status === "ready")).toBe(true);
    expect(cached.status).toBe("ready");
    expect(databaseChecks).toBe(1);
    expect(redisChecks).toBe(1);
  });

  it("rechecks dependencies within five seconds of the last result", async () => {
    vi.useFakeTimers();
    let available = true;
    const service = new DependencyReadinessService(workingProbes({
      redis: async () => { if (!available) throw new Error("unavailable"); }
    }));
    expect((await service.check()).status).toBe("ready");
    available = false;
    await vi.advanceTimersByTimeAsync(5000);
    expect((await service.check()).status).toBe("not_ready");
  });

  it("closes its clients through the Nest module shutdown hook", async () => {
    let closed = false;
    @Module({
      providers: [
        DependencyReadinessService,
        { provide: "READINESS_PROBES", useValue: workingProbes({ close: async () => { closed = true; } }) }
      ]
    })
    class ReadinessTestModule {}
    const app = await NestFactory.createApplicationContext(ReadinessTestModule, { logger: false });
    await app.close();
    expect(closed).toBe(true);
  });
});
import "reflect-metadata";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
