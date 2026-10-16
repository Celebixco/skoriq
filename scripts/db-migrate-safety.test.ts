import { afterEach, describe, expect, it, vi } from "vitest";

const databaseBoundary = vi.hoisted(() => ({ query: vi.fn(), end: vi.fn(), migrate: vi.fn() }));

vi.mock("pg", () => ({
  default: {
    Pool: class {
      options;
      query = databaseBoundary.query;
      end = databaseBoundary.end;
      constructor(options: { connectionString: string }) { this.options = options; }
    }
  }
}));
vi.mock("drizzle-orm/node-postgres", () => ({ drizzle: () => ({}) }));
vi.mock("drizzle-orm/node-postgres/migrator", () => ({ migrate: databaseBoundary.migrate }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("migration data preservation", () => {
  it.each(["./db-migrate.ts", "./db-migrate.js"])("%s applies migrations without running catalog/admin seed queries", async (entrypoint) => {
    vi.resetModules();
    databaseBoundary.query.mockReset().mockRejectedValue(new Error("Catalog query attempted during migration"));
    databaseBoundary.end.mockReset().mockResolvedValue(undefined);
    databaseBoundary.migrate.mockReset().mockResolvedValue(undefined);
    vi.stubEnv("DATABASE_URL", "postgres://postgres:postgres@localhost/sports_data_test");
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("DB_EXECUTION_TARGET", "local");
    vi.stubEnv("ALLOW_DESTRUCTIVE_SEED", "true");
    vi.stubEnv("FORCE_SEED", "true");
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await import(entrypoint);
    await vi.waitFor(() => expect(databaseBoundary.end).toHaveBeenCalledOnce());

    expect(databaseBoundary.migrate).toHaveBeenCalledOnce();
    expect(databaseBoundary.query).not.toHaveBeenCalled();
  });
});
