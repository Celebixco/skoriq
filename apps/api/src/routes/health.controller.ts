import { Controller, Get } from "@nestjs/common";

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
}
