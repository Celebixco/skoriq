import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  API_PORT: z.coerce.number().int().positive().default(3000),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(3),
  SCHEDULER_TICK_CRON: z.string().default("*/15 * * * *"),
  CLEANUP_CRON: z.string().default("0 3 * * *"),
  MOCK_PROVIDER_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === "true")
    .default(false),
  APIFOOTBALL_COM_API_KEY: z.string().optional(),
  APIFOOTBALL_COM_API_KEY_DEFAULT: z.string().optional(),
  APIFOOTBALL_COM_API_KEY_COUNTRIES: z.string().optional(),
  APIFOOTBALL_COM_API_KEY_LEAGUES: z.string().optional(),
  APIFOOTBALL_COM_API_KEY_TEAMS: z.string().optional(),
  APIFOOTBALL_COM_API_KEY_STANDINGS: z.string().optional(),
  APIFOOTBALL_COM_API_KEY_EVENTS: z.string().optional(),
  APIFOOTBALL_COM_API_KEY_RESULTS: z.string().optional(),
  APIFOOTBALL_COM_API_KEY_FIXTURES: z.string().optional(),
  APIFOOTBALL_COM_API_KEY_PLAYERS: z.string().optional(),
  APIFOOTBALL_COM_API_KEY_STATISTICS: z.string().optional(),
  APIFOOTBALL_COM_API_KEY_LINEUPS: z.string().optional(),
  APIFOOTBALL_COM_API_KEY_INJURIES: z.string().optional(),
  APIFOOTBALL_COM_BASE_URL: z.string().url().default("https://apiv3.apifootball.com/"),
  APIFOOTBALL_COM_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === "true")
    .default(false),
  APIFOOTBALL_COM_ALLOW_PRODUCTION: z
    .string()
    .optional()
    .transform((value) => value === "true")
    .default(false),
  APIFOOTBALL_COM_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  DATABASE_URL: z.string().url(),
  DB_EXECUTION_TARGET: z.enum(["local", "neon-test"]).default("local"),
  ALLOW_REMOTE_TEST_DB: z
    .string()
    .optional()
    .transform((value) => value === "true")
    .default(false),
  NEON_BRANCH_NAME: z.string().optional(),
  REDIS_URL: z.string().url(),
  FRONTEND_ORIGIN: z.string().url().optional(),
  CORS_ORIGIN: z.string().optional(),
  AUTH_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === "true")
    .default(false),
  AUTH_JWT_SECRET: z.string().optional(),
  AUTH_COOKIE_NAME: z.string().min(1).default("betify_auth"),
  AUTH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(86400),
  RESEND_API_KEY: z.string().optional(),
  AUTH_PASSWORD_RESET_FROM_EMAIL: z.string().email().optional(),
  AUTH_PASSWORD_RESET_URL_BASE: z.string().url().optional(),
  AUTH_PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().positive().default(60),
  RAW_PAYLOAD_SUCCESS_RETENTION_DAYS: z.coerce.number().int().positive().default(7),
  RAW_PAYLOAD_FAILED_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  SYNC_LOG_RETENTION_DAYS: z.coerce.number().int().positive().default(14),
  PROVIDER_DEFAULT_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(60)
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const config = envSchema.parse(env);

  if (config.NODE_ENV === "production" && config.MOCK_PROVIDER_ENABLED) {
    throw new Error("MOCK_PROVIDER_ENABLED cannot be true in production.");
  }

  if (config.APIFOOTBALL_COM_ENABLED && !hasAnyAPIFootballCredential(config)) {
    throw new Error("At least one APIFOOTBALL_COM_API_KEY* value is required when APIFOOTBALL_COM_ENABLED=true.");
  }

  if (config.NODE_ENV === "production" && config.APIFOOTBALL_COM_ENABLED && !config.APIFOOTBALL_COM_ALLOW_PRODUCTION) {
    throw new Error("APIFOOTBALL_COM_ENABLED cannot be true in production unless APIFOOTBALL_COM_ALLOW_PRODUCTION=true.");
  }

  if (config.NODE_ENV === "production" && !config.FRONTEND_ORIGIN && !config.CORS_ORIGIN) {
    throw new Error("FRONTEND_ORIGIN or CORS_ORIGIN is required in production.");
  }

  if (config.AUTH_ENABLED && !config.AUTH_JWT_SECRET) {
    throw new Error("AUTH_JWT_SECRET is required when AUTH_ENABLED=true.");
  }

  return config;
}

function hasAnyAPIFootballCredential(config: AppConfig) {
  return Boolean(
    config.APIFOOTBALL_COM_API_KEY ||
      config.APIFOOTBALL_COM_API_KEY_DEFAULT ||
      config.APIFOOTBALL_COM_API_KEY_COUNTRIES ||
      config.APIFOOTBALL_COM_API_KEY_LEAGUES ||
      config.APIFOOTBALL_COM_API_KEY_TEAMS ||
      config.APIFOOTBALL_COM_API_KEY_STANDINGS ||
      config.APIFOOTBALL_COM_API_KEY_EVENTS ||
      config.APIFOOTBALL_COM_API_KEY_RESULTS ||
      config.APIFOOTBALL_COM_API_KEY_FIXTURES ||
      config.APIFOOTBALL_COM_API_KEY_PLAYERS ||
      config.APIFOOTBALL_COM_API_KEY_STATISTICS ||
      config.APIFOOTBALL_COM_API_KEY_LINEUPS ||
      config.APIFOOTBALL_COM_API_KEY_INJURIES
  );
}
