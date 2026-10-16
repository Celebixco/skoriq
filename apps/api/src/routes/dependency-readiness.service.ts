import { Inject, Injectable, Optional } from "@nestjs/common";
import type { OnModuleDestroy } from "@nestjs/common";
import { loadConfig } from "@sports-data/config";
import { Redis } from "ioredis";
import pg from "pg";

export interface ReadinessProbes {
  database(): Promise<void>;
  redis(): Promise<void>;
  close(): Promise<void>;
}

type DependencyStatus = "ok" | "unavailable";

export interface DependencyReadiness {
  status: "ready" | "not_ready";
  service: "api";
  dependencies: { database: DependencyStatus; redis: DependencyStatus };
  timestamp: string;
}

const clientTimeoutMs = 1000;
const probeTimeoutMs = 2500;
const cacheTtlMs = 2000;

@Injectable()
export class DependencyReadinessService implements OnModuleDestroy {
  private readonly probes: ReadinessProbes;
  private cached: { result: DependencyReadiness; expiresAt: number } | null = null;
  private inFlight: Promise<DependencyReadiness> | null = null;

  constructor(@Optional() @Inject("READINESS_PROBES") probes?: ReadinessProbes) {
    this.probes = probes ?? createReadinessProbes();
  }

  check(): Promise<DependencyReadiness> {
    if (this.cached && this.cached.expiresAt > Date.now()) {
      return Promise.resolve(this.cached.result);
    }
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.checkDependencies()
      .then((result) => {
        this.cached = { result, expiresAt: Date.now() + cacheTtlMs };
        return result;
      })
      .finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  async onModuleDestroy(): Promise<void> {
    await this.probes.close();
  }

  private async checkDependencies(): Promise<DependencyReadiness> {
    const [database, redis] = await Promise.all([
      checkProbe(() => this.probes.database()),
      checkProbe(() => this.probes.redis())
    ]);
    return {
      status: database === "ok" && redis === "ok" ? "ready" : "not_ready",
      service: "api",
      dependencies: { database, redis },
      timestamp: new Date().toISOString()
    };
  }
}

async function checkProbe(probe: () => Promise<void>): Promise<DependencyStatus> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error("Readiness probe timed out.")), probeTimeoutMs);
  });
  try {
    await Promise.race([probe(), deadline]);
    return "ok";
  } catch {
    return "unavailable";
  } finally {
    clearTimeout(timeout);
  }
}

function createReadinessProbes(): ReadinessProbes {
  const config = loadConfig();
  const pool = new pg.Pool({
    connectionString: config.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: clientTimeoutMs,
    query_timeout: clientTimeoutMs,
    statement_timeout: clientTimeoutMs
  });
  const redis = new Redis(config.REDIS_URL, {
    lazyConnect: true,
    enableReadyCheck: false,
    enableOfflineQueue: false,
    connectTimeout: clientTimeoutMs,
    commandTimeout: clientTimeoutMs,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null
  });
  // Availability is reported as a sanitized status; client errors must not emit connection details.
  pool.on("error", () => {});
  redis.on("error", () => {});
  return {
    database: async () => { await pool.query("select 1"); },
    redis: async () => {
      if (redis.status === "wait" || redis.status === "end") await redis.connect();
      if (await redis.ping() !== "PONG") throw new Error("Redis did not answer PING.");
    },
    close: async () => {
      redis.disconnect();
      await pool.end();
    }
  };
}
