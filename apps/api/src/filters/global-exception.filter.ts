import { Catch, HttpException, HttpStatus } from "@nestjs/common";
import type { ArgumentsHost, ExceptionFilter } from "@nestjs/common";
import type { AppLogger } from "@sports-data/logger";

interface JsonResponse {
  status(code: number): {
    json(body: unknown): unknown;
  };
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: AppLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<JsonResponse>();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const message = exception instanceof Error ? exception.message : "Unexpected error";

    this.logger.error("Unhandled API exception", {
      status,
      message
    });

    response.status(status).json({
      statusCode: status,
      message: status === HttpStatus.INTERNAL_SERVER_ERROR ? "Internal server error" : message,
      timestamp: new Date().toISOString()
    });
  }
}
