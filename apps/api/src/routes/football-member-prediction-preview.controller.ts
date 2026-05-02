import { BadRequestException, Controller, Get, Inject, Param, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard.js";
import { FootballMemberPredictionPreviewService } from "./football-member-prediction-preview.service.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Controller("member/football")
@UseGuards(AuthGuard)
export class FootballMemberPredictionPreviewController {
  constructor(@Inject(FootballMemberPredictionPreviewService) private readonly previewService: FootballMemberPredictionPreviewService) {}

  @Get("matches/:matchId/prediction-preview")
  @UseGuards(AuthGuard)
  async getMatchPredictionPreview(@Param("matchId") matchId: string) {
    validateUuid("matchId", matchId);
    return this.previewService.getMatchPredictionPreview(matchId);
  }
}

function validateUuid(name: string, value: string) {
  if (!uuidPattern.test(value)) {
    throw new BadRequestException(`${name} must be a valid UUID.`);
  }
}
