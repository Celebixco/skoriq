import { Module } from "@nestjs/common";
import { AuthController } from "./auth/auth.controller.js";
import { AdminGuard } from "./auth/admin.guard.js";
import { AuthGuard } from "./auth/auth.guard.js";
import { AuthService } from "./auth/auth.service.js";
import { ResendPasswordResetEmailService } from "./auth/password-reset-email.service.js";
import { DashboardOverviewController } from "./routes/dashboard-overview.controller.js";
import { DashboardOverviewService } from "./routes/dashboard-overview.service.js";
import { DependencyReadinessService } from "./routes/dependency-readiness.service.js";
import { FootballCatalogController } from "./routes/football-catalog.controller.js";
import { FootballCatalogService } from "./routes/football-catalog.service.js";
import { FootballMatchAnalyticsController } from "./routes/football-match-analytics.controller.js";
import { FootballMatchAnalyticsService } from "./routes/football-match-analytics.service.js";
import { FootballMemberPredictionPreviewController } from "./routes/football-member-prediction-preview.controller.js";
import { FootballMemberPredictionPreviewService } from "./routes/football-member-prediction-preview.service.js";
import { FootballRcPrematchController } from "./routes/football-rc-prematch.controller.js";
import { FootballRcPrematchService } from "./routes/football-rc-prematch.service.js";
import { FootballRcResultsController } from "./routes/football-rc-results.controller.js";
import { FootballRcResultsService } from "./routes/football-rc-results.service.js";
import { FootballH1PrematchController } from "./routes/football-h1-prematch.controller.js";
import { FootballTorkPrematchController } from "./routes/football-tork-prematch.controller.js";
import { FootballTorkPrematchService } from "./routes/football-tork-prematch.service.js";
import { FootballTorkResultsController } from "./routes/football-tork-results.controller.js";
import { FootballTorkResultsService } from "./routes/football-tork-results.service.js";
import { FootballH1PrematchService } from "./routes/football-h1-prematch.service.js";
import { FootballH1ResultsController } from "./routes/football-h1-results.controller.js";
import { FootballH1ResultsService } from "./routes/football-h1-results.service.js";
import { FootballPredictionDraftsController } from "./routes/football-prediction-drafts.controller.js";
import { FootballPredictionDraftsService } from "./routes/football-prediction-drafts.service.js";
import { FootballPublicEligibilityController } from "./routes/football-public-eligibility.controller.js";
import { FootballPublicEligibilityService } from "./routes/football-public-eligibility.service.js";
import { FootballPredictionSettlementsController } from "./routes/football-prediction-settlements.controller.js";
import { FootballPredictionSettlementsService } from "./routes/football-prediction-settlements.service.js";
import { FootballPredictionResultsController } from "./routes/football-prediction-results.controller.js";
import { HealthController } from "./routes/health.controller.js";
import { SyncStatusController } from "./routes/sync-status.controller.js";

@Module({
  controllers: [
    HealthController,
    SyncStatusController,
    AuthController,
    DashboardOverviewController,
    FootballMatchAnalyticsController,
    FootballMemberPredictionPreviewController,
    FootballRcPrematchController,
    FootballRcResultsController,
    FootballH1PrematchController,
    FootballH1ResultsController,
    FootballTorkPrematchController,
    FootballTorkResultsController,
    FootballCatalogController,
    FootballPredictionDraftsController,
    FootballPublicEligibilityController,
    FootballPredictionResultsController,
    FootballPredictionSettlementsController
  ],
  providers: [
    DependencyReadinessService,
    AuthService,
    {
      provide: "AUTH_PASSWORD_RESET_EMAIL_SENDER",
      useClass: ResendPasswordResetEmailService
    },
    AuthGuard,
    AdminGuard,
    DashboardOverviewService,
    FootballMatchAnalyticsService,
    FootballMemberPredictionPreviewService,
    FootballRcPrematchService,
    FootballRcResultsService,
    FootballH1PrematchService,
    FootballH1ResultsService,
    FootballTorkPrematchService,
    FootballTorkResultsService,
    FootballCatalogService,
    FootballPredictionDraftsService,
    FootballPublicEligibilityService,
    FootballPredictionSettlementsService
  ]
})
export class ApiModule {}

