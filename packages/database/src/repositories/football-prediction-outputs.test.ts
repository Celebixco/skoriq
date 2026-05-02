import { describe, expect, it, vi } from "vitest";
import { footballPredictionConflicts, footballPredictionOutputs, footballPredictionSettlements } from "../schema.js";
import { buildFootballPredictionOutputDedupeKey, FootballPredictionOutputRepository } from "./static-entities.js";

const basePredictionInput = {
  matchId: "11111111-1111-4111-8111-111111111111",
  featureSnapshotId: "22222222-2222-4222-8222-222222222222",
  predictionType: "match_result_1x2",
  predictionValue: "X",
  predictionFamily: "match_result" as const,
  recommendationTier: "primary",
  displayLabel: "Tahminim",
  reasoningSummary: "Dry-run reasoning summary.",
  confidenceScore: 64,
  confidenceCeiling: 70,
  riskLevel: "medium" as const,
  generatedAt: new Date("2026-04-30T10:00:00.000Z"),
  metadataJson: { source: "unit-test" }
};

describe("FootballPredictionOutputRepository", () => {
  it("builds a stable dedupe key without prediction model logic", () => {
    const left = buildFootballPredictionOutputDedupeKey(basePredictionInput);
    const right = buildFootballPredictionOutputDedupeKey({
      featureSnapshotId: basePredictionInput.featureSnapshotId,
      matchId: basePredictionInput.matchId,
      predictionValue: basePredictionInput.predictionValue,
      predictionType: basePredictionInput.predictionType
    });

    expect(left).toBe(right);
    expect(left).toHaveLength(64);
  });

  it("creates prediction outputs with lifecycle-safe defaults", async () => {
    const { db, values, returning } = createInsertDb({ id: "prediction-1" });
    const repository = new FootballPredictionOutputRepository(db as never);

    await repository.createPredictionOutput(basePredictionInput);

    expect(db.insert).toHaveBeenCalledWith(footballPredictionOutputs);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        dedupeKey: buildFootballPredictionOutputDedupeKey(basePredictionInput),
        status: "draft",
        consistencyStatus: "unchecked",
        recommendationTier: "primary",
        displayLabel: "Tahminim",
        reasoningSummary: "Dry-run reasoning summary.",
        conflictCount: 0,
        blockingConflictCount: 0,
        warningConflictCount: 0,
        rebuildRequired: false
      })
    );
    expect(returning).toHaveBeenCalled();
  });

  it("creates prediction outputs with analysis window metadata", async () => {
    const { db, values } = createInsertDb({ id: "prediction-1" });
    const repository = new FootballPredictionOutputRepository(db as never);

    await repository.createPredictionOutput({
      ...basePredictionInput,
      generationWindowStatus: "within_window",
      generatedLeadTimeMinutes: 180,
      rebuildRequired: false
    });

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        generationWindowStatus: "within_window",
        generatedLeadTimeMinutes: 180,
        rebuildRequired: false
      })
    );
  });

  it("upserts prediction outputs by dedupe key", async () => {
    const { db, onConflictDoUpdate } = createUpsertDb({ id: "prediction-1" });
    const repository = new FootballPredictionOutputRepository(db as never);

    await repository.upsertPredictionOutput(basePredictionInput);

    expect(db.insert).toHaveBeenCalledWith(footballPredictionOutputs);
    expect(onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        target: footballPredictionOutputs.dedupeKey,
        set: expect.objectContaining({
          predictionFamily: "match_result",
          recommendationTier: "primary",
          displayLabel: "Tahminim",
          reasoningSummary: "Dry-run reasoning summary.",
          confidenceScore: 64,
          consistencyStatus: "unchecked",
          rebuildRequired: false
        })
      })
    );
  });

  it("updates window metadata without changing member or public status", async () => {
    const { db, set } = createUpdateDb({ id: "prediction-1" });
    const repository = new FootballPredictionOutputRepository(db as never);

    await repository.updateWindowMetadata("prediction-1", {
      generationWindowStatus: "stale",
      generatedLeadTimeMinutes: 3000,
      rebuildRequired: true,
      rebuildReason: "Generated outside the 24-hour analysis window."
    });

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        generationWindowStatus: "stale",
        generatedLeadTimeMinutes: 3000,
        rebuildRequired: true,
        rebuildReason: "Generated outside the 24-hour analysis window."
      })
    );
    expect(set).not.toHaveBeenCalledWith(expect.objectContaining({ status: "member_visible" }));
    expect(set).not.toHaveBeenCalledWith(expect.objectContaining({ status: "public_eligible" }));
  });

  it("marks and clears rebuild-required metadata", async () => {
    const { db, set } = createUpdateDb({ id: "prediction-1" });
    const repository = new FootballPredictionOutputRepository(db as never);
    const staleAt = new Date("2026-04-30T09:00:00.000Z");
    const rebuiltAt = new Date("2026-05-01T19:00:00.000Z");

    await repository.markRebuildRequired("prediction-1", "Generated before the valid analysis window.", staleAt);
    await repository.clearRebuildRequired("prediction-1", rebuiltAt);

    expect(set).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        rebuildRequired: true,
        generationWindowStatus: "stale",
        staleAt,
        rebuildReason: "Generated before the valid analysis window."
      })
    );
    expect(set).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        rebuildRequired: false,
        rebuildReason: null,
        staleAt: null,
        lastRebuiltAt: rebuiltAt
      })
    );
  });

  it("lists rebuild-required prediction outputs", async () => {
    const { db, where } = createSelectDb([{ id: "prediction-1", rebuildRequired: true }]);
    const repository = new FootballPredictionOutputRepository(db as never);

    await repository.listRebuildRequired({
      matchId: basePredictionInput.matchId,
      generationWindowStatus: "stale",
      limit: 20
    });

    expect(db.select).toHaveBeenCalled();
    expect(where).toHaveBeenCalled();
  });

  it("updates stored consistency results without evaluating rules", async () => {
    const { db, set } = createUpdateDb({ id: "prediction-1" });
    const repository = new FootballPredictionOutputRepository(db as never);
    const checkedAt = new Date("2026-04-30T11:00:00.000Z");

    await repository.updateConsistencyResult("prediction-1", {
      consistencyStatus: "warning",
      consistencyCheckedAt: checkedAt,
      consistencySummary: "One warning conflict.",
      expectationSnapshot: { expected_scoreline: "1-1" },
      conflictCount: 1,
      blockingConflictCount: 0,
      warningConflictCount: 1
    });

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        consistencyStatus: "warning",
        consistencyCheckedAt: checkedAt,
        consistencySummary: "One warning conflict.",
        expectationSnapshot: { expected_scoreline: "1-1" },
        conflictCount: 1,
        warningConflictCount: 1
      })
    );
  });

  it("adds and lists prediction conflicts", async () => {
    const { db: insertDb, values } = createInsertDb({ id: "conflict-1" });
    const repository = new FootballPredictionOutputRepository(insertDb as never);

    await repository.addConflict({
      predictionOutputId: "prediction-1",
      matchId: basePredictionInput.matchId,
      conflictType: "scoreline_goal_conflict",
      severity: "blocking",
      sourcePredictionType: "exact_score",
      conflictingPredictionType: "over_under_goals",
      reason: "0-0 conflicts with over 0.5 goals."
    });

    expect(insertDb.insert).toHaveBeenCalledWith(footballPredictionConflicts);
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ severity: "blocking", metadataJson: {} }));

    const { db: selectDb, where } = createSelectDb([{ id: "conflict-1" }]);
    const selectRepository = new FootballPredictionOutputRepository(selectDb as never);
    await selectRepository.listConflictsForPrediction("prediction-1");

    expect(selectDb.select).toHaveBeenCalled();
    expect(where).toHaveBeenCalled();
  });

  it("replaces conflicts by deleting existing rows before adding new ones", async () => {
    const operations: string[] = [];
    const db = {
      delete: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(async () => {
            operations.push("delete");
            return [];
          })
        }))
      })),
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn(async () => {
            operations.push("insert");
            return [{ id: "conflict-1" }];
          })
        }))
      }))
    } as never;
    const repository = new FootballPredictionOutputRepository(db as never);

    await repository.replaceConflictsForPrediction("prediction-1", [
      {
        predictionOutputId: "prediction-1",
        matchId: basePredictionInput.matchId,
        conflictType: "same_match_correlation_warning",
        severity: "warning",
        reason: "Same-match correlation needs safe-mode exclusion."
      }
    ]);

    expect(operations).toEqual(["delete", "insert"]);
  });

  it("persists status transition helper methods", async () => {
    const { db, set } = createUpdateDb({ id: "prediction-1" });
    const repository = new FootballPredictionOutputRepository(db as never);
    const at = new Date("2026-04-30T12:00:00.000Z");

    await repository.markMemberVisible("prediction-1", at);
    await repository.lockPrediction("prediction-1", at);
    await repository.archivePrediction("prediction-1");

    expect(set).toHaveBeenNthCalledWith(1, expect.objectContaining({ status: "member_visible", visibleToMembersAt: at }));
    expect(set).toHaveBeenNthCalledWith(2, expect.objectContaining({ status: "locked", lockedAt: at }));
    expect(set).toHaveBeenNthCalledWith(3, expect.objectContaining({ status: "archived" }));
  });

  it("upserts settlement rows and updates output status", async () => {
    const { db, insert, onConflictDoUpdate, updateSet } = createSettlementDb({ id: "settlement-1" });
    const repository = new FootballPredictionOutputRepository(db as never);
    const evaluatedAt = new Date("2026-04-30T13:00:00.000Z");

    await repository.settlePredictionOutput({
      predictionOutputId: "prediction-1",
      matchId: basePredictionInput.matchId,
      settlementStatus: "settled_success",
      actualResult: "fulltime=2-1; result=1",
      evaluatedAt,
      settlementReason: "Match result was 1.",
      settlementMetadata: { source: "unit-test" }
    });

    expect(insert).toHaveBeenCalledWith(footballPredictionSettlements);
    expect(onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        target: footballPredictionSettlements.predictionOutputId,
        set: expect.objectContaining({
          settlementStatus: "settled_success",
          actualResult: "fulltime=2-1; result=1"
        })
      })
    );
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ status: "settled_success" }));
  });

  it("lists settlements by match and status", async () => {
    const { db, where } = createSelectDb([{ id: "settlement-1" }]);
    const repository = new FootballPredictionOutputRepository(db as never);

    await repository.listSettlementsByMatchId(basePredictionInput.matchId);
    await repository.listSettlementsByStatus("settled_void");

    expect(db.select).toHaveBeenCalledTimes(2);
    expect(where).toHaveBeenCalledTimes(2);
  });
});

function createInsertDb(row: unknown) {
  const returning = vi.fn().mockResolvedValue([row]);
  const values = vi.fn(() => ({ returning }));
  const insert = vi.fn(() => ({ values }));
  return { db: { insert }, insert, values, returning };
}

function createUpsertDb(row: unknown) {
  const returning = vi.fn().mockResolvedValue([row]);
  const onConflictDoUpdate = vi.fn(() => ({ returning }));
  const values = vi.fn(() => ({ onConflictDoUpdate }));
  const insert = vi.fn(() => ({ values }));
  return { db: { insert }, insert, values, onConflictDoUpdate, returning };
}

function createUpdateDb(row: unknown) {
  const returning = vi.fn().mockResolvedValue([row]);
  const where = vi.fn(() => ({ returning }));
  const set = vi.fn(() => ({ where }));
  const update = vi.fn(() => ({ set }));
  return { db: { update }, update, set, where, returning };
}

function createSelectDb(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const orderBy = vi.fn(() => ({ limit }));
  const where = vi.fn(() => ({ orderBy, limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  return { db: { select }, select, from, where, orderBy, limit };
}

function createSettlementDb(row: unknown) {
  const insertReturning = vi.fn().mockResolvedValue([row]);
  const onConflictDoUpdate = vi.fn(() => ({ returning: insertReturning }));
  const values = vi.fn(() => ({ onConflictDoUpdate }));
  const insert = vi.fn(() => ({ values }));

  const updateReturning = vi.fn().mockResolvedValue([{ id: "prediction-1" }]);
  const updateWhere = vi.fn(() => ({ returning: updateReturning }));
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set: updateSet }));

  return {
    db: { insert, update },
    insert,
    onConflictDoUpdate,
    updateSet
  };
}
