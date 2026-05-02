import { describe, expect, it, vi } from "vitest";
import { createOrUpdateAdmin } from "./auth-create-admin.js";
import type { Database } from "@sports-data/database";

describe("auth:create-admin", () => {
  it("creates an admin user with a password hash", async () => {
    const database = mockDatabase([[], []]);

    const result = await createOrUpdateAdmin(database, {
      NODE_ENV: "development",
      ADMIN_EMAIL: " ADMIN@Example.TEST ",
      ADMIN_PASSWORD: "very-safe-password"
    });

    expect(result).toEqual({ email: "admin@example.test", action: "created" });
    const serializedCalls = JSON.stringify(database.execute.mock.calls);
    expect(serializedCalls).not.toContain("very-safe-password");
    expect(serializedCalls).not.toContain("password_hash\":\"very-safe-password");
  });

  it("updates an existing admin user", async () => {
    const database = mockDatabase([[{ id: "user-1" }], []]);

    const result = await createOrUpdateAdmin(database, {
      NODE_ENV: "development",
      ADMIN_EMAIL: "admin@example.test",
      ADMIN_PASSWORD: "very-safe-password"
    });

    expect(result.action).toBe("updated");
  });

  it("refuses production and weak inputs", async () => {
    await expect(
      createOrUpdateAdmin(mockDatabase([]), {
        NODE_ENV: "production",
        ADMIN_EMAIL: "admin@example.test",
        ADMIN_PASSWORD: "very-safe-password"
      })
    ).rejects.toThrow("auth:create-admin refuses NODE_ENV=production.");

    await expect(createOrUpdateAdmin(mockDatabase([]), { NODE_ENV: "development", ADMIN_PASSWORD: "very-safe-password" })).rejects.toThrow(
      "ADMIN_EMAIL is required."
    );
    await expect(createOrUpdateAdmin(mockDatabase([]), { NODE_ENV: "development", ADMIN_EMAIL: "admin@example.test", ADMIN_PASSWORD: "short" })).rejects.toThrow(
      "ADMIN_PASSWORD is required and must be at least 12 characters."
    );
  });
});

function mockDatabase(results: unknown[][]): Database & { execute: ReturnType<typeof vi.fn> } {
  return {
    execute: vi.fn().mockImplementation(() => Promise.resolve(results.shift() ?? []))
  } as unknown as Database & { execute: ReturnType<typeof vi.fn> };
}
