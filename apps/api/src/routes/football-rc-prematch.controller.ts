import { BadRequestException, Controller, Get, Inject, Param, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard.js";
import { FootballRcPrematchService } from "./football-rc-prematch.service.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Controller("member/football")
@UseGuards(AuthGuard)
export class FootballRcPrematchController {
  constructor(@Inject(FootballRcPrematchService) private readonly service: FootballRcPrematchService) {}

  @Get("predictions/upcoming")
  async upcoming() {
    return this.service.listUpcoming();
  }

  @Get("matches/:matchId/rc-prediction")
  async match(@Param("matchId") matchId: string) {
    if (!uuidPattern.test(matchId)) throw new BadRequestException("matchId must be a valid UUID.");
    return this.service.getMatch(matchId);
  }
}
