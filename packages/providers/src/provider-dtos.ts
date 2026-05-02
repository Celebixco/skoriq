import type { BasketballPeriodType, MatchStatus } from "@sports-data/shared";

export interface ProviderEntityBase {
  providerEntityId: string;
  raw?: unknown;
}

export interface ProviderSport extends ProviderEntityBase {
  name: string;
  slug?: string;
  metadata?: Record<string, unknown>;
}

export interface ProviderCountry extends ProviderEntityBase {
  name: string;
  code?: string;
  slug?: string;
  metadata?: Record<string, unknown>;
}

export interface ProviderCompetition extends ProviderEntityBase {
  sportProviderId: string;
  countryProviderId?: string;
  name: string;
  slug?: string;
  gender?: string;
  level?: string;
  metadata?: Record<string, unknown>;
}

export interface ProviderSeason extends ProviderEntityBase {
  competitionProviderId: string;
  name: string;
  startDate?: string;
  endDate?: string;
  isCurrent?: boolean;
  metadata?: Record<string, unknown>;
}

export interface ProviderTeam extends ProviderEntityBase {
  sportProviderId: string;
  countryProviderId?: string;
  name: string;
  shortName?: string;
  slug?: string;
  gender?: string;
  type?: string;
  logoUrl?: string;
  venueName?: string;
  foundedYear?: number;
  metadata?: Record<string, unknown>;
}

export interface ProviderPlayer extends ProviderEntityBase {
  sportProviderId: string;
  countryProviderId?: string;
  nationalityProviderId?: string;
  currentTeamProviderId?: string;
  name: string;
  shortName?: string;
  slug?: string;
  dateOfBirth?: string;
  age?: number;
  heightCm?: number;
  weightKg?: number;
  preferredFoot?: string;
  position?: string;
  jerseyNumber?: number;
  marketValue?: string;
  contractUntil?: string;
  photoUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface ProviderMatch extends ProviderEntityBase {
  sportProviderId?: string;
  competitionProviderId: string;
  seasonProviderId?: string;
  homeTeamProviderId: string;
  awayTeamProviderId: string;
  scheduledStartAt: string;
  status: MatchStatus;
  round?: string;
  roundName?: string;
  stageName?: string;
  venue?: string;
  venueName?: string;
  referee?: string;
  refereeName?: string;
  neutralGround?: boolean;
  attendance?: number;
  winnerProviderTeamId?: string;
  homeScoreCurrent?: number;
  awayScoreCurrent?: number;
  homeScoreFinal?: number;
  awayScoreFinal?: number;
  homeScoreHalfTime?: number;
  awayScoreHalfTime?: number;
  scores?: ProviderMatchScore[];
  metadata?: Record<string, unknown>;
}

export type ProviderMatchDetail = ProviderMatch;

export interface ProviderMatchScore {
  period: "final" | "halftime" | "fulltime" | "extra_time" | "penalties";
  homeScore?: number;
  awayScore?: number;
}

export interface ProviderFootballMatchScore extends ProviderEntityBase {
  matchProviderId: string;
  homeScoreCurrent?: number;
  awayScoreCurrent?: number;
  homeScoreHalfTime?: number;
  awayScoreHalfTime?: number;
  homeScoreFullTime?: number;
  awayScoreFullTime?: number;
  homeScoreExtraTime?: number;
  awayScoreExtraTime?: number;
  homeScorePenalties?: number;
  awayScorePenalties?: number;
  winnerProviderTeamId?: string;
  status?: MatchStatus;
  metadata?: Record<string, unknown>;
}

export interface ProviderBasketballMatchScore extends ProviderEntityBase {
  matchProviderId: string;
  homeScoreCurrent?: number;
  awayScoreCurrent?: number;
  homeScoreFinal?: number;
  awayScoreFinal?: number;
  homeScoreHalfTime?: number;
  awayScoreHalfTime?: number;
  homeScoreOvertime?: number;
  awayScoreOvertime?: number;
  winnerProviderTeamId?: string;
  status?: MatchStatus;
  metadata?: Record<string, unknown>;
}

export interface ProviderBasketballPeriodScore extends ProviderEntityBase {
  matchProviderId: string;
  periodNumber: number;
  periodType: BasketballPeriodType;
  overtimeNumber?: number;
  homeScore: number;
  awayScore: number;
  metadata?: Record<string, unknown>;
}

export interface ProviderFootballMatchTeamStatistics {
  providerEntityId?: string;
  matchProviderId: string;
  teamProviderId: string;
  possessionPercent?: number;
  shotsTotal?: number;
  shotsOnTarget?: number;
  shotsOffTarget?: number;
  blockedShots?: number;
  corners?: number;
  fouls?: number;
  yellowCards?: number;
  redCards?: number;
  offsides?: number;
  goalkeeperSaves?: number;
  passes?: number;
  accuratePasses?: number;
  passAccuracyPercent?: number;
  bigChances?: number;
  bigChancesMissed?: number;
  expectedGoals?: number;
  expectedAssists?: number;
  attacks?: number;
  dangerousAttacks?: number;
  hitWoodwork?: number;
  tackles?: number;
  interceptions?: number;
  clearances?: number;
  duelsWon?: number;
  aerialDuelsWon?: number;
  metadata?: Record<string, unknown>;
}

export interface ProviderBasketballTeamMatchStatistics {
  providerEntityId?: string;
  matchProviderId: string;
  teamProviderId: string;
  fieldGoalsMade?: number;
  fieldGoalsAttempted?: number;
  fieldGoalPercent?: number;
  twoPointersMade?: number;
  twoPointersAttempted?: number;
  twoPointPercent?: number;
  threePointersMade?: number;
  threePointersAttempted?: number;
  threePointPercent?: number;
  freeThrowsMade?: number;
  freeThrowsAttempted?: number;
  freeThrowPercent?: number;
  reboundsTotal?: number;
  reboundsOffensive?: number;
  reboundsDefensive?: number;
  assists?: number;
  steals?: number;
  blocks?: number;
  turnovers?: number;
  personalFouls?: number;
  fastBreakPoints?: number;
  pointsInPaint?: number;
  secondChancePoints?: number;
  benchPoints?: number;
  biggestLead?: number;
  leadChanges?: number;
  timeInLeadSeconds?: number;
  metadata?: Record<string, unknown>;
}

export interface ProviderMatchEvent extends ProviderEntityBase {
  matchProviderId: string;
  teamProviderId?: string;
  playerProviderId?: string;
  eventType: string;
  minute?: number;
  extraMinute?: number;
  providerOrder?: number;
}

export interface ProviderMatchStatistics {
  matchProviderId: string;
  teamProviderId: string;
  possession?: number;
  shots?: number;
  shotsOnTarget?: number;
  corners?: number;
  fouls?: number;
  yellowCards?: number;
  redCards?: number;
  offsides?: number;
  expectedGoals?: number;
  attacks?: number;
  dangerousAttacks?: number;
  passes?: number;
  providerStats?: Record<string, unknown>;
}

export interface ProviderStanding extends ProviderEntityBase {
  competitionProviderId: string;
  seasonProviderId: string;
  teamProviderId: string;
  position?: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
}

export interface ProviderFootballStanding {
  providerEntityId?: string;
  competitionProviderId: string;
  seasonProviderId?: string;
  teamProviderId: string;
  position: number;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  homePlayed?: number;
  homeWins?: number;
  homeDraws?: number;
  homeLosses?: number;
  homeGoalsFor?: number;
  homeGoalsAgainst?: number;
  awayPlayed?: number;
  awayWins?: number;
  awayDraws?: number;
  awayLosses?: number;
  awayGoalsFor?: number;
  awayGoalsAgainst?: number;
  formString?: string;
  status?: string;
  metadata?: Record<string, unknown>;
}

export interface ProviderBasketballStanding {
  providerEntityId?: string;
  competitionProviderId: string;
  seasonProviderId?: string;
  teamProviderId: string;
  position: number;
  played: number;
  wins: number;
  losses: number;
  winPercentage?: number;
  pointsFor?: number;
  pointsAgainst?: number;
  pointDifference?: number;
  homeWins?: number;
  homeLosses?: number;
  awayWins?: number;
  awayLosses?: number;
  streak?: string;
  formString?: string;
  conference?: string;
  division?: string;
  status?: string;
  metadata?: Record<string, unknown>;
}

export interface ProviderCompetitionParams {
  sportProviderId?: string;
  countryProviderId?: string;
}

export interface ProviderTeamParams {
  sportProviderId?: string;
  competitionProviderId?: string;
  seasonProviderId?: string;
}

export interface ProviderMatchQuery {
  sportProviderId?: string;
  competitionProviderId?: string;
  seasonProviderId?: string;
  from?: string;
  to?: string;
}

export interface ProviderStandingParams {
  competitionProviderId: string;
  seasonProviderId: string;
}
