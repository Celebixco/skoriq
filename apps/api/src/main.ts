import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { loadConfig } from "@sports-data/config";
import { createLogger } from "@sports-data/logger";
import { GlobalExceptionFilter } from "./filters/global-exception.filter.js";
import { ApiModule } from "./module.js";

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL);
const app = await NestFactory.create(ApiModule);
const localDevelopmentOrigins = [/^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/];

function resolveCorsOrigins() {
  const configuredOrigins = (config.CORS_ORIGIN ?? config.FRONTEND_ORIGIN)
    ?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return configuredOrigins?.length ? configuredOrigins : localDevelopmentOrigins;
}

app.setGlobalPrefix("api");
app.enableCors({
  origin: resolveCorsOrigins(),
  methods: ["GET", "POST"],
  credentials: true
});
app.useGlobalPipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true
  })
);
app.useGlobalFilters(new GlobalExceptionFilter(logger));

await app.listen(config.API_PORT);
logger.info("API service started", { port: config.API_PORT });
