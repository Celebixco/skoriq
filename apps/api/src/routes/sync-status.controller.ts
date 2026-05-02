import { Controller, Get } from "@nestjs/common";
import { allQueueNames } from "@sports-data/queue";

@Controller("sync")
export class SyncStatusController {
  @Get("status")
  getSyncStatus() {
    return {
      status: "not_configured",
      queues: allQueueNames,
      note: "Database-backed sync status will be enabled after worker persistence is implemented."
    };
  }
}
