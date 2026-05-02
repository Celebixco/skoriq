import { Queue } from "bullmq";
import { createRedisConnection } from "@sports-data/cache";
import { loadConfig } from "@sports-data/config";
import { createLogger } from "@sports-data/logger";
import { queueNames } from "@sports-data/queue";

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL);
const connection = createRedisConnection(config.REDIS_URL);

const cleanupQueue = new Queue(queueNames.cleanup, { connection });

logger.info("Scheduler service started", {
  cron: config.SCHEDULER_TICK_CRON,
  cleanupCron: config.CLEANUP_CRON,
  liveScoreMode: false
});

await cleanupQueue.upsertJobScheduler(
  "raw-payload-and-sync-log-cleanup",
  { pattern: config.CLEANUP_CRON },
  {
    name: "cleanup-expired-data",
    data: { requestedBy: "scheduler" }
  }
);

process.on("SIGTERM", async () => {
  logger.info("Scheduler service shutting down");
  await cleanupQueue.close();
  await connection.quit();
  process.exit(0);
});
