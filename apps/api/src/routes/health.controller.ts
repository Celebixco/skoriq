import path from "node:path";
import { pathToFileURL } from "node:url";
import { Controller, Get, Post } from "@nestjs/common";
import { loadConfig } from "@sports-data/config";
import pg from "pg";

@Controller("health")
export class HealthController {
  @Get()
  getHealth() {
    return this.getReadiness();
  }

  @Get("live")
  getLiveness() {
    return {
      status: "ok",
      service: "api",
      liveScoreMode: false,
      timestamp: new Date().toISOString()
    };
  }

  @Get("ready")
  getReadiness() {
    return {
      status: "ready",
      service: "api",
      dependencies: {
        database: "not_checked",
        redis: "not_checked"
      },
      timestamp: new Date().toISOString()
    };
  }

  @Get("seed")
  async triggerSeedGet() {
    return this.executeSeed();
  }

  @Post("seed")
  async triggerSeedPost() {
    return this.executeSeed();
  }

  private async executeSeed() {
    const config = loadConfig();
    const pool = new pg.Pool({
      connectionString: config.DATABASE_URL,
      max: 2
    });

    try {
      const seedFile = path.resolve(process.cwd(), "scripts/db-seed.js");
      const seedUrl = pathToFileURL(seedFile).href;
      const { seedInitialData } = await import(seedUrl);

      // Force seed when explicitly triggered via this endpoint
      process.env.FORCE_SEED = "true";
      await seedInitialData(pool);

      return {
        success: true,
        message: "Seed completed successfully with 26/27 season data.",
        timestamp: new Date().toISOString()
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString()
      };
    } finally {
      await pool.end();
    }
  }
}
