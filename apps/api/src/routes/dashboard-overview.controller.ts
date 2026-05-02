import { Controller, Get, Inject, Req, UnauthorizedException, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard.js";
import type { AuthenticatedRequest } from "../auth/auth.types.js";
import { DashboardOverviewService } from "./dashboard-overview.service.js";

@Controller("dashboard")
@UseGuards(AuthGuard)
export class DashboardOverviewController {
  constructor(@Inject(DashboardOverviewService) private readonly dashboardOverviewService: DashboardOverviewService) {}

  @Get("overview")
  @UseGuards(AuthGuard)
  async getOverview(@Req() request: AuthenticatedRequest) {
    if (!request.user) {
      throw new UnauthorizedException("Authentication required.");
    }
    return this.dashboardOverviewService.getOverview(request.user);
  }
}
