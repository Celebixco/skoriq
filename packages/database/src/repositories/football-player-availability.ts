import { and, eq, isNull } from "drizzle-orm";
import { footballMatchLineupPlayers, footballMatchLineups, footballMatchPlayerContextFeatures, footballPlayerAvailability, footballPlayerTeamMemberships } from "../schema.js";
import type { RepositoryExecutor } from "./types.js";
import type { FootballMatchLineupRole, FootballPlayerAvailabilityStatus, FootballPlayerContextRiskLevel } from "@sports-data/shared";

export interface UpsertFootballPlayerTeamMembershipInput {
  playerId: string;
  teamId: string;
  competitionId?: string;
  shirtNumber?: number;
  position?: string;
  active?: boolean;
  validFrom?: string;
  validTo?: string;
  metadataJson?: Record<string, unknown>;
}

export interface UpsertFootballPlayerAvailabilityInput {
  playerId: string;
  teamId: string;
  competitionId?: string;
  matchId?: string;
  status: FootballPlayerAvailabilityStatus;
  reason?: string;
  injuryType?: string;
  expectedReturnDate?: string;
  providerReportedAt?: Date;
  sourceLabel: string;
  sourceQuality?: string;
  metadataJson?: Record<string, unknown>;
}

export interface UpsertFootballMatchLineupInput {
  matchId: string;
  teamId: string;
  formation?: string;
  confirmed?: boolean;
  providerReportedAt?: Date;
  metadataJson?: Record<string, unknown>;
}

export interface UpsertFootballMatchLineupPlayerInput {
  matchLineupId: string;
  matchId: string;
  teamId: string;
  playerId: string;
  role: FootballMatchLineupRole;
  position?: string;
  shirtNumber?: number;
  orderIndex?: number;
  metadataJson?: Record<string, unknown>;
}

export interface UpsertFootballMatchPlayerContextFeatureInput {
  matchId: string;
  homeMissingPlayersCount: number;
  awayMissingPlayersCount: number;
  homeSuspendedCount: number;
  awaySuspendedCount: number;
  homeInjuredCount: number;
  awayInjuredCount: number;
  homeDoubtfulCount: number;
  awayDoubtfulCount: number;
  homeLineupConfirmed: boolean;
  awayLineupConfirmed: boolean;
  homeStartingXiKnown: boolean;
  awayStartingXiKnown: boolean;
  homeAvailabilityCoverageScore: number;
  awayAvailabilityCoverageScore: number;
  playerContextCoverageScore: number;
  playerContextRiskLevel: FootballPlayerContextRiskLevel;
  metadataJson?: Record<string, unknown>;
}

export class FootballPlayerTeamMembershipRepository {
  constructor(private readonly db: RepositoryExecutor) {}

  async findMembership(playerId: string, teamId: string, competitionId?: string) {
    const rows = await this.db
      .select()
      .from(footballPlayerTeamMemberships)
      .where(
        and(
          eq(footballPlayerTeamMemberships.playerId, playerId),
          eq(footballPlayerTeamMemberships.teamId, teamId),
          competitionId ? eq(footballPlayerTeamMemberships.competitionId, competitionId) : isNull(footballPlayerTeamMemberships.competitionId)
        )
      )
      .limit(1);
    return rows[0];
  }

  async upsertMembership(input: UpsertFootballPlayerTeamMembershipInput) {
    const values = {
      playerId: input.playerId,
      teamId: input.teamId,
      competitionId: input.competitionId,
      shirtNumber: input.shirtNumber,
      position: input.position,
      active: input.active ?? true,
      validFrom: input.validFrom,
      validTo: input.validTo,
      metadataJson: input.metadataJson ?? {}
    };

    const rows = await this.db
      .insert(footballPlayerTeamMemberships)
      .values(values)
      .onConflictDoUpdate({
        target: [footballPlayerTeamMemberships.playerId, footballPlayerTeamMemberships.teamId, footballPlayerTeamMemberships.competitionId],
        set: {
          shirtNumber: values.shirtNumber,
          position: values.position,
          active: values.active,
          validFrom: values.validFrom,
          validTo: values.validTo,
          metadataJson: values.metadataJson,
          updatedAt: new Date()
        }
      })
      .returning();

    return rows[0];
  }
}

export class FootballPlayerAvailabilityRepository {
  constructor(private readonly db: RepositoryExecutor) {}

  async findAvailability(input: Pick<UpsertFootballPlayerAvailabilityInput, "playerId" | "teamId" | "competitionId" | "matchId" | "status" | "reason" | "injuryType" | "expectedReturnDate" | "sourceLabel">) {
    const rows = await this.db
      .select()
      .from(footballPlayerAvailability)
      .where(
        and(
          eq(footballPlayerAvailability.playerId, input.playerId),
          eq(footballPlayerAvailability.teamId, input.teamId),
          input.competitionId ? eq(footballPlayerAvailability.competitionId, input.competitionId) : isNull(footballPlayerAvailability.competitionId),
          input.matchId ? eq(footballPlayerAvailability.matchId, input.matchId) : isNull(footballPlayerAvailability.matchId),
          eq(footballPlayerAvailability.status, input.status),
          input.reason ? eq(footballPlayerAvailability.reason, input.reason) : isNull(footballPlayerAvailability.reason),
          input.injuryType ? eq(footballPlayerAvailability.injuryType, input.injuryType) : isNull(footballPlayerAvailability.injuryType),
          input.expectedReturnDate
            ? eq(footballPlayerAvailability.expectedReturnDate, input.expectedReturnDate)
            : isNull(footballPlayerAvailability.expectedReturnDate),
          eq(footballPlayerAvailability.sourceLabel, input.sourceLabel)
        )
      )
      .limit(1);
    return rows[0];
  }

  async upsertAvailability(input: UpsertFootballPlayerAvailabilityInput) {
    const values = {
      playerId: input.playerId,
      teamId: input.teamId,
      competitionId: input.competitionId,
      matchId: input.matchId,
      status: input.status,
      reason: input.reason,
      injuryType: input.injuryType,
      expectedReturnDate: input.expectedReturnDate,
      providerReportedAt: input.providerReportedAt,
      sourceLabel: input.sourceLabel,
      sourceQuality: input.sourceQuality,
      metadataJson: input.metadataJson ?? {}
    };

    const rows = await this.db
      .insert(footballPlayerAvailability)
      .values(values)
      .onConflictDoUpdate({
        target: [
          footballPlayerAvailability.playerId,
          footballPlayerAvailability.teamId,
          footballPlayerAvailability.competitionId,
          footballPlayerAvailability.matchId,
          footballPlayerAvailability.status,
          footballPlayerAvailability.reason,
          footballPlayerAvailability.injuryType,
          footballPlayerAvailability.expectedReturnDate,
          footballPlayerAvailability.sourceLabel
        ],
        set: {
          providerReportedAt: values.providerReportedAt,
          sourceQuality: values.sourceQuality,
          metadataJson: values.metadataJson,
          updatedAt: new Date()
        }
      })
      .returning();

    return rows[0];
  }
}

export class FootballMatchLineupRepository {
  constructor(private readonly db: RepositoryExecutor) {}

  async findMatchLineup(matchId: string, teamId: string) {
    const rows = await this.db
      .select()
      .from(footballMatchLineups)
      .where(and(eq(footballMatchLineups.matchId, matchId), eq(footballMatchLineups.teamId, teamId)))
      .limit(1);
    return rows[0];
  }

  async upsertMatchLineup(input: UpsertFootballMatchLineupInput) {
    const values = {
      matchId: input.matchId,
      teamId: input.teamId,
      formation: input.formation,
      confirmed: input.confirmed ?? false,
      providerReportedAt: input.providerReportedAt,
      metadataJson: input.metadataJson ?? {}
    };

    const rows = await this.db
      .insert(footballMatchLineups)
      .values(values)
      .onConflictDoUpdate({
        target: [footballMatchLineups.matchId, footballMatchLineups.teamId],
        set: {
          formation: values.formation,
          confirmed: values.confirmed,
          providerReportedAt: values.providerReportedAt,
          metadataJson: values.metadataJson,
          updatedAt: new Date()
        }
      })
      .returning();

    return rows[0];
  }

  async upsertMatchLineupPlayer(input: UpsertFootballMatchLineupPlayerInput) {
    const values = {
      matchLineupId: input.matchLineupId,
      matchId: input.matchId,
      teamId: input.teamId,
      playerId: input.playerId,
      role: input.role,
      position: input.position,
      shirtNumber: input.shirtNumber,
      orderIndex: input.orderIndex,
      metadataJson: input.metadataJson ?? {}
    };

    const rows = await this.db
      .insert(footballMatchLineupPlayers)
      .values(values)
      .onConflictDoUpdate({
        target: [footballMatchLineupPlayers.matchLineupId, footballMatchLineupPlayers.playerId, footballMatchLineupPlayers.role, footballMatchLineupPlayers.orderIndex],
        set: {
          position: values.position,
          shirtNumber: values.shirtNumber,
          metadataJson: values.metadataJson,
          updatedAt: new Date()
        }
      })
      .returning();

    return rows[0];
  }
}

export class FootballMatchPlayerContextFeatureRepository {
  constructor(private readonly db: RepositoryExecutor) {}

  async findByMatchId(matchId: string) {
    const rows = await this.db.select().from(footballMatchPlayerContextFeatures).where(eq(footballMatchPlayerContextFeatures.matchId, matchId)).limit(1);
    return rows[0];
  }

  async upsertFeature(input: UpsertFootballMatchPlayerContextFeatureInput) {
    const values = {
      ...input,
      metadataJson: input.metadataJson ?? {}
    };

    const rows = await this.db
      .insert(footballMatchPlayerContextFeatures)
      .values(values)
      .onConflictDoUpdate({
        target: [footballMatchPlayerContextFeatures.matchId],
        set: {
          homeMissingPlayersCount: values.homeMissingPlayersCount,
          awayMissingPlayersCount: values.awayMissingPlayersCount,
          homeSuspendedCount: values.homeSuspendedCount,
          awaySuspendedCount: values.awaySuspendedCount,
          homeInjuredCount: values.homeInjuredCount,
          awayInjuredCount: values.awayInjuredCount,
          homeDoubtfulCount: values.homeDoubtfulCount,
          awayDoubtfulCount: values.awayDoubtfulCount,
          homeLineupConfirmed: values.homeLineupConfirmed,
          awayLineupConfirmed: values.awayLineupConfirmed,
          homeStartingXiKnown: values.homeStartingXiKnown,
          awayStartingXiKnown: values.awayStartingXiKnown,
          homeAvailabilityCoverageScore: values.homeAvailabilityCoverageScore,
          awayAvailabilityCoverageScore: values.awayAvailabilityCoverageScore,
          playerContextCoverageScore: values.playerContextCoverageScore,
          playerContextRiskLevel: values.playerContextRiskLevel,
          metadataJson: values.metadataJson,
          updatedAt: new Date()
        }
      })
      .returning();

    return rows[0];
  }
}
