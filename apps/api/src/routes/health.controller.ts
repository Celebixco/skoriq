import { Controller, Get, Inject, ServiceUnavailableException } from "@nestjs/common";
import { DependencyReadinessService } from "./dependency-readiness.service.js";

@Controller("health")
export class HealthController {
  constructor(@Inject(DependencyReadinessService) private readonly readiness: DependencyReadinessService) {}

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
  async getReadiness() {
    const result = await this.readiness.check();
    if (result.status !== "ready") throw new ServiceUnavailableException(result);
    return result;
  }
}
