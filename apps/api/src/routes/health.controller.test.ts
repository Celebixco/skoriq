import "reflect-metadata";
import { PATH_METADATA } from "@nestjs/common/constants.js";
import { ServiceUnavailableException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { DependencyReadinessService } from "./dependency-readiness.service.js";
import { HealthController } from "./health.controller.js";

function registeredHealthPaths(): string[] {
  return Object.getOwnPropertyNames(HealthController.prototype).flatMap((name) => {
    const method: unknown = Object.getOwnPropertyDescriptor(HealthController.prototype, name)?.value;
    if (typeof method !== "function" || name === "constructor") return [];
    const route: unknown = Reflect.getMetadata(PATH_METADATA, method);
    if (typeof route === "string") return [route];
    return Array.isArray(route) ? route.filter((path): path is string => typeof path === "string") : [];
  });
}

describe("HealthController", () => {
  it("does not expose database seeding over HTTP", () => {
    expect(registeredHealthPaths()).not.toContain("seed");
    expect(HealthController.prototype).not.toHaveProperty("triggerSeedGet");
    expect(HealthController.prototype).not.toHaveProperty("triggerSeedPost");
    expect(HealthController.prototype).not.toHaveProperty("executeSeed");
  });

  it("keeps the health, liveness, and readiness routes registered", () => {
    expect(Reflect.getMetadata(PATH_METADATA, HealthController)).toBe("health");
    expect(registeredHealthPaths()).toEqual(expect.arrayContaining(["/", "live", "ready"]));
  });

  it("returns checked readiness when both probes succeed", async () => {
    const controller = new HealthController(new DependencyReadinessService({
      database: async () => {},
      redis: async () => {},
      close: async () => {}
    }));
    expect(await controller.getReadiness()).toMatchObject({
      status: "ready",
      dependencies: { database: "ok", redis: "ok" }
    });
  });

  it.each(["database", "redis"] as const)("responds with HTTP 503 when %s is unavailable", async (dependency) => {
    const controller = new HealthController(new DependencyReadinessService({
      database: async () => {},
      redis: async () => {},
      close: async () => {},
      [dependency]: async () => { throw new Error("private connection details"); }
    }));
    await expect(Promise.resolve().then(() => controller.getReadiness())).rejects.toMatchObject({ status: 503 });
    try {
      await controller.getReadiness();
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      const response = (error as ServiceUnavailableException).getResponse();
      expect(response).toMatchObject({ status: "not_ready" });
      expect(JSON.stringify(response)).not.toContain("private connection details");
    }
    expect(controller.getLiveness().status).toBe("ok");
  });
});
