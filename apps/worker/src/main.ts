import { Worker } from "bullmq";
import { createRedisConnection } from "@sports-data/cache";
import { loadConfig } from "@sports-data/config";
import {
  CleanupRepository,
  RawProviderPayloadRepository,
  SyncJobRepository,
  createDatabase
} from "@sports-data/database";
import { createLogger } from "@sports-data/logger";
import { NormalizerRegistry, RawPayloadProcessor, createPipelineNormalizers, createStaticNormalizerRepositories } from "@sports-data/pipeline";
import { allQueueNames, queueNames } from "@sports-data/queue";

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL);
const connection = createRedisConnection(config.REDIS_URL);
const database = createDatabase(config.DATABASE_URL);
const cleanupRepository = new CleanupRepository(database, {
  successRetentionDays: config.RAW_PAYLOAD_SUCCESS_RETENTION_DAYS,
  failedRetentionDays: config.RAW_PAYLOAD_FAILED_RETENTION_DAYS,
  syncLogRetentionDays: config.SYNC_LOG_RETENTION_DAYS
});
const rawPayloadRepository = new RawProviderPayloadRepository(database, {
  successRetentionDays: config.RAW_PAYLOAD_SUCCESS_RETENTION_DAYS,
  failedRetentionDays: config.RAW_PAYLOAD_FAILED_RETENTION_DAYS
});
const syncJobRepository = new SyncJobRepository(database);
const normalizerRegistry = new NormalizerRegistry(
  createPipelineNormalizers(
    createStaticNormalizerRepositories(database, (work) =>
      database.transaction((transaction) => work(createStaticNormalizerRepositories(transaction)))
    )
  )
);
const rawPayloadProcessor = new RawPayloadProcessor(rawPayloadRepository, syncJobRepository, normalizerRegistry);

const workers = allQueueNames.map(
  (queueName) =>
    new Worker(
      queueName,
      async (job) => {
        if (queueName === queueNames.cleanup && job.name === "cleanup-expired-data") {
          const result = await cleanupRepository.runExpiredDataCleanup();
          logger.info("Cleanup job completed", {
            queueName,
            jobId: job.id,
            jobName: job.name,
            result
          });
          return result;
        }

        if (queueName === queueNames.rawPayloadProcessing && job.name === "process-raw-payload") {
          const result = await rawPayloadProcessor.process(job.data);
          logger.info("Raw payload processing job completed", {
            queueName,
            jobId: job.id,
            jobName: job.name,
            result
          });
          return result;
        }

        logger.error("Rejected unimplemented worker job", {
          queueName,
          jobId: job.id,
          jobName: job.name,
          jobData: job.data
        });

        throw new Error(`No processor is implemented for queue "${queueName}" job "${job.name}".`);
      },
      {
        connection,
        concurrency: config.WORKER_CONCURRENCY
      }
    )
);

logger.info("Worker service started", {
  queues: allQueueNames,
  workerCount: workers.length,
  concurrency: config.WORKER_CONCURRENCY
});

process.on("SIGTERM", async () => {
  logger.info("Worker service shutting down");
  await Promise.all(workers.map((worker) => worker.close()));
  await connection.quit();
  process.exit(0);
});
