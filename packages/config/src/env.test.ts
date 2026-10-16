import { describe, expect, it } from "vitest";
import { loadConfig } from "./env.js";

const productionAuth = {
  AUTH_ENABLED: "true",
  AUTH_JWT_SECRET: "production-signing-key-validation-fixture"
};

describe("loadConfig", () => {
  it("fails fast when mock provider is enabled in production", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "production",
        DATABASE_URL: "postgres://postgres:postgres@localhost:5432/sports_data",
        REDIS_URL: "redis://localhost:6379",
        MOCK_PROVIDER_ENABLED: "true"
      })
    ).toThrow("MOCK_PROVIDER_ENABLED cannot be true in production.");
  });

  it("defaults APIFootball.com provider integration to disabled", () => {
    const config = loadConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgres://postgres:postgres@localhost:5432/sports_data",
      REDIS_URL: "redis://localhost:6379"
    });

    expect(config.APIFOOTBALL_COM_ENABLED).toBe(false);
    expect(config.APIFOOTBALL_COM_BASE_URL).toBe("https://apiv3.apifootball.com/");
    expect(config.APIFOOTBALL_COM_TIMEOUT_MS).toBe(15000);
    expect(config.DB_EXECUTION_TARGET).toBe("local");
    expect(config.ALLOW_REMOTE_TEST_DB).toBe(false);
    expect(config.AUTH_ENABLED).toBe(false);
    expect(config.AUTH_COOKIE_NAME).toBe("betify_auth");
    expect(config.AUTH_TOKEN_TTL_SECONDS).toBe(86400);
  });

  it("fails when auth is enabled without a JWT secret", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "test",
        DATABASE_URL: "postgres://postgres:postgres@localhost:5432/sports_data",
        REDIS_URL: "redis://localhost:6379",
        AUTH_ENABLED: "true"
      })
    ).toThrow("AUTH_JWT_SECRET is required when AUTH_ENABLED=true.");
  });

  it("fails when APIFootball.com is enabled without an API key", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "test",
        DATABASE_URL: "postgres://postgres:postgres@localhost:5432/sports_data",
        REDIS_URL: "redis://localhost:6379",
        APIFOOTBALL_COM_ENABLED: "true"
      })
    ).toThrow("At least one APIFOOTBALL_COM_API_KEY* value is required when APIFOOTBALL_COM_ENABLED=true.");
  });

  it("allows APIFootball.com endpoint-specific API keys without the legacy key", () => {
    const config = loadConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgres://postgres:postgres@localhost:5432/sports_data",
      REDIS_URL: "redis://localhost:6379",
      APIFOOTBALL_COM_ENABLED: "true",
      APIFOOTBALL_COM_API_KEY_EVENTS: "test-events-key"
    });

    expect(config.APIFOOTBALL_COM_API_KEY).toBeUndefined();
    expect(config.APIFOOTBALL_COM_API_KEY_EVENTS).toBe("test-events-key");
  });

  it("blocks APIFootball.com provider usage in production", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "production",
        DATABASE_URL: "postgres://postgres:postgres@localhost:5432/sports_data",
        REDIS_URL: "redis://localhost:6379",
        FRONTEND_ORIGIN: "https://skoriq.com",
        APIFOOTBALL_COM_ENABLED: "true",
        APIFOOTBALL_COM_API_KEY: "placeholder"
      })
    ).toThrow("APIFOOTBALL_COM_ENABLED cannot be true in production unless APIFOOTBALL_COM_ALLOW_PRODUCTION=true.");
  });

  it("allows APIFootball.com provider usage in production when explicitly approved", () => {
    const config = loadConfig({
      ...productionAuth,
      NODE_ENV: "production",
      DATABASE_URL: "postgres://postgres:postgres@localhost:5432/sports_data",
      REDIS_URL: "redis://localhost:6379",
      FRONTEND_ORIGIN: "https://skoriq.com",
      APIFOOTBALL_COM_ENABLED: "true",
      APIFOOTBALL_COM_ALLOW_PRODUCTION: "true",
      APIFOOTBALL_COM_API_KEY: "placeholder"
    });

    expect(config.APIFOOTBALL_COM_ENABLED).toBe(true);
    expect(config.APIFOOTBALL_COM_ALLOW_PRODUCTION).toBe(true);
  });

  it("requires an explicit frontend or CORS origin in production", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "production",
        DATABASE_URL: "postgres://postgres:postgres@localhost:5432/sports_data",
        REDIS_URL: "redis://localhost:6379"
      })
    ).toThrow("FRONTEND_ORIGIN or CORS_ORIGIN is required in production.");
  });

  it("allows production config with an explicit frontend origin", () => {
    const config = loadConfig({
      ...productionAuth,
      NODE_ENV: "production",
      DATABASE_URL: "postgres://postgres:postgres@localhost:5432/sports_data",
      REDIS_URL: "redis://localhost:6379",
      FRONTEND_ORIGIN: "https://skoriq.com"
    });

    expect(config.FRONTEND_ORIGIN).toBe("https://skoriq.com");
  });

  it.each([undefined, "false"])("rejects production with AUTH_ENABLED=%s", (authEnabled) => {
    expect(() =>
      loadConfig({
        NODE_ENV: "production",
        DATABASE_URL: "postgres://postgres:postgres@localhost:5432/sports_data",
        REDIS_URL: "redis://localhost:6379",
        FRONTEND_ORIGIN: "https://skoriq.com",
        AUTH_ENABLED: authEnabled,
        AUTH_JWT_SECRET: productionAuth.AUTH_JWT_SECRET
      })
    ).toThrow("AUTH_ENABLED must be true in production.");
  });

  it("rejects production auth without a JWT secret", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "production",
        DATABASE_URL: "postgres://postgres:postgres@localhost:5432/sports_data",
        REDIS_URL: "redis://localhost:6379",
        FRONTEND_ORIGIN: "https://skoriq.com",
        AUTH_ENABLED: "true"
      })
    ).toThrow("AUTH_JWT_SECRET is required when AUTH_ENABLED=true.");
  });

  it.each(["x".repeat(31), " ".repeat(32), ` ${"x".repeat(30)} `])("rejects short or blank production JWT secrets", (secret) => {
    expect(() =>
      loadConfig({
        ...productionAuth,
        NODE_ENV: "production",
        DATABASE_URL: "postgres://postgres:postgres@localhost:5432/sports_data",
        REDIS_URL: "redis://localhost:6379",
        FRONTEND_ORIGIN: "https://skoriq.com",
        AUTH_JWT_SECRET: secret
      })
    ).toThrow("AUTH_JWT_SECRET must contain at least 32 non-padding characters in production.");
  });

  it.each([
    "change_this_jwt_secret_in_coolify",
    "change-me-production-signing-key-fixture",
    "changeme-production-signing-key-fixture",
    "replace-me-production-signing-key-fixture",
    "placeholder-production-signing-key-fixture",
    "example-production-signing-key-fixture",
    "test-secret-production-signing-key-fixture"
  ])("rejects placeholder production JWT secrets", (secret) => {
    expect(() =>
      loadConfig({
        ...productionAuth,
        NODE_ENV: "production",
        DATABASE_URL: "postgres://postgres:postgres@localhost:5432/sports_data",
        REDIS_URL: "redis://localhost:6379",
        FRONTEND_ORIGIN: "https://skoriq.com",
        AUTH_JWT_SECRET: secret
      })
    ).toThrow("AUTH_JWT_SECRET cannot be a placeholder in production.");
  });

  it("accepts production auth with a 32-character secret and an explicit CORS origin", () => {
    const config = loadConfig({
      NODE_ENV: "production",
      DATABASE_URL: "postgres://postgres:postgres@localhost:5432/sports_data",
      REDIS_URL: "redis://localhost:6379",
      CORS_ORIGIN: "https://skoriq.com",
      AUTH_ENABLED: "true",
      AUTH_JWT_SECRET: "0123456789abcdef0123456789abcdef"
    });

    expect(config.AUTH_ENABLED).toBe(true);
    expect(config.CORS_ORIGIN).toBe("https://skoriq.com");
  });

  it.each(["development", "test"])("preserves short JWT secrets in %s", (nodeEnv) => {
    const config = loadConfig({
      NODE_ENV: nodeEnv,
      DATABASE_URL: "postgres://postgres:postgres@localhost:5432/sports_data",
      REDIS_URL: "redis://localhost:6379",
      AUTH_ENABLED: "true",
      AUTH_JWT_SECRET: "test-secret"
    });

    expect(config.AUTH_ENABLED).toBe(true);
  });
});
