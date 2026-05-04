import { describe, expect, it } from "vitest";
import { loadConfig } from "./env.js";

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
      NODE_ENV: "production",
      DATABASE_URL: "postgres://postgres:postgres@localhost:5432/sports_data",
      REDIS_URL: "redis://localhost:6379",
      FRONTEND_ORIGIN: "https://skoriq.com"
    });

    expect(config.FRONTEND_ORIGIN).toBe("https://skoriq.com");
  });
});
