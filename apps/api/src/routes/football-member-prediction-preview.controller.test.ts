import "reflect-metadata";
import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { AuthGuard } from "../auth/auth.guard.js";
import type { AuthService } from "../auth/auth.service.js";
import { FootballMemberPredictionPreviewController } from "./football-member-prediction-preview.controller.js";
import { FootballMemberPredictionPreviewService } from "./football-member-prediction-preview.service.js";

const matchId = "11111111-1111-4111-8111-111111111111";

describe("FootballMemberPredictionPreviewController", () => {
  it("is protected by auth guard for members and admins", async () => {
    expect(Reflect.getMetadata("__guards__", FootballMemberPredictionPreviewController)).toContain(AuthGuard);
    expect(Reflect.getMetadata("__guards__", FootballMemberPredictionPreviewController.prototype.getMatchPredictionPreview)).toEqual([AuthGuard]);

    await expect(runAuthGuard(null)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(runAuthGuard({ id: "member-1", email: "member@example.test", role: "member", status: "active" })).resolves.toBe(true);
    await expect(runAuthGuard({ id: "admin-1", email: "admin@example.test", role: "admin", status: "active" })).resolves.toBe(true);
  });

  it("validates match id", async () => {
    const controller = new FootballMemberPredictionPreviewController(mockService());
    await expect(controller.getMatchPredictionPreview("not-a-uuid")).rejects.toBeInstanceOf(BadRequestException);
  });

  it("returns sanitized member-safe preview", async () => {
    const controller = new FootballMemberPredictionPreviewController(
      mockService({
        getMatchPredictionPreview: vi.fn().mockResolvedValue({
          matchId,
          status: "available",
          reasonCode: "available",
          message: "Bu maç için SkorIQ ön tahmin yorumu hazır.",
          analysisWindow: { status: "within_window", windowHours: 36, minimumLeadMinutes: 30 },
          groups: {
            primary: [],
            try: [
              {
                predictionId: "prediction-1",
                displayLabel: "MS 2.5 Üst",
                predictionType: "over_under_goals",
                predictionValue: "over_2_5",
                recommendationTier: "try",
                confidenceScore: 64,
                riskLevel: "medium",
                reasoningSummary: "Gol profili güçlü.",
                generatedAt: "2026-05-01T10:00:00.000Z",
                kickoffAt: "2026-05-01T18:30:00.000Z",
                isFresh: true,
                analysisWindowStatus: "within_window"
              }
            ],
            alternative: []
          },
          summary: "Bu ön tahminler mevcut veri kapsamına göre üretilmiştir; nihai sonuç garantisi değildir.",
          warnings: []
        })
      })
    );

    const response = await controller.getMatchPredictionPreview(matchId);
    expect(response.status).toBe("available");
    expect(response.groups.try).toHaveLength(1);
    expect(JSON.stringify(response)).not.toContain("metadata");
    expect(JSON.stringify(response)).not.toContain("conflict");
    expect(JSON.stringify(response)).not.toContain("raw_payload");
  });
});

describe("FootballMemberPredictionPreviewService", () => {
  it("excludes avoid/blocked/audit-only/generated-after-kickoff rows from the safe preview", async () => {
    const kickoff = "2026-05-01T18:30:00.000Z";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-01T10:00:00.000Z"));
    const database = createDatabaseMock([
      [matchRow({ kickoff_at: kickoff })],
      [
        candidateRow({ prediction_id: "safe-1", recommendation_tier: "try", prediction_type: "over_under_goals", prediction_value: "over_2_5", kickoff_at: kickoff }),
        candidateRow({ prediction_id: "avoid-1", recommendation_tier: "avoid", kickoff_at: kickoff }),
        candidateRow({ prediction_id: "blocked-1", consistency_status: "blocked", kickoff_at: kickoff }),
        candidateRow({ prediction_id: "blocking-conflict-1", blocking_conflict_count: 1, kickoff_at: kickoff }),
        candidateRow({ prediction_id: "audit-1", audit_only: "true", kickoff_at: kickoff }),
        candidateRow({ prediction_id: "late-1", generated_at: "2026-05-01T19:00:00.000Z", kickoff_at: kickoff })
      ]
    ]);
    const service = new FootballMemberPredictionPreviewService(database as never);

    const response = await service.getMatchPredictionPreview(matchId);

    expect(response.status).toBe("available");
    expect(response.groups.try).toHaveLength(1);
    expect(response.groups.try[0]?.predictionId).toBe("safe-1");
    expect(response.groups.try[0]?.displayLabel).toBe("MS 2.5 Üst");
    expect(JSON.stringify(response)).not.toContain("avoid-1");
    expect(JSON.stringify(response)).not.toContain("blocked-1");
    expect(JSON.stringify(response)).not.toContain("blocking-conflict-1");
    expect(JSON.stringify(response)).not.toContain("audit-1");
    expect(JSON.stringify(response)).not.toContain("late-1");
    expect(JSON.stringify(response)).not.toContain("metadata");
    expect(JSON.stringify(response)).not.toContain("conflict");
    expect(JSON.stringify(response)).not.toContain("raw_payload");
    vi.useRealTimers();
  });

  it("returns stale without normal candidates when safe candidates are stale", async () => {
    const service = new FootballMemberPredictionPreviewService(
      createDatabaseMock([
        [matchRow()],
        [candidateRow({ analysis_window_status: "stale" })]
      ]) as never
    );

    const response = await service.getMatchPredictionPreview(matchId);

    expect(response.status).toBe("stale");
    expect(response.reasonCode).toBe("stale");
    expect(response.groups.try).toHaveLength(0);
    expect(response.message).toBe("Tahminler yenilenmeli.");
  });

  it("returns safe candidate generated ahead of kickoff once minimum lead is still satisfied", async () => {
    const kickoff = "2026-05-03T18:30:00.000Z";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-01T10:00:00.000Z"));
    const service = new FootballMemberPredictionPreviewService(
      createDatabaseMock([
        [matchRow({ kickoff_at: kickoff, feature_status: "ready" })],
        [candidateRow({ generated_at: "2026-05-02T19:00:00.000Z", kickoff_at: kickoff, analysis_window_status: null })]
      ]) as never
    );

    const response = await service.getMatchPredictionPreview(matchId);

    expect(response.status).toBe("available");
    expect(response.reasonCode).toBe("available");
    expect(response.analysisWindow.status).toBe("within_window");
    expect(response.groups.try).toHaveLength(1);
    vi.useRealTimers();
  });

  it("keeps safe-looking candidates visible even when they were generated well ahead of kickoff", async () => {
    const kickoff = "2026-05-03T18:30:00.000Z";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-02T12:00:00.000Z"));
    const service = new FootballMemberPredictionPreviewService(
      createDatabaseMock([
        [matchRow({ kickoff_at: kickoff, feature_status: "ready" })],
        [candidateRow({ generated_at: "2026-05-01T10:00:00.000Z", kickoff_at: kickoff, analysis_window_status: null })]
      ]) as never
    );

    const response = await service.getMatchPredictionPreview(matchId);

    expect(response.status).toBe("available");
    expect(response.groups.try).toHaveLength(1);
    vi.useRealTimers();
  });

  it("maps member-safe labels without exposing draft tier labels", async () => {
    const service = new FootballMemberPredictionPreviewService(
      createDatabaseMock([
        [matchRow()],
        [
          candidateRow({ prediction_id: "x2-1", prediction_type: "double_chance", prediction_value: "X2", recommendation_tier: "primary", display_label: "Tahminim" }),
          candidateRow({ prediction_id: "dc-12", prediction_type: "double_chance", prediction_value: "12", recommendation_tier: "try", display_label: "Denenir" }),
          candidateRow({ prediction_id: "under-1", prediction_type: "over_under_goals", prediction_value: "under_2_5", recommendation_tier: "alternative", display_label: "Alternatif" }),
          candidateRow({ prediction_id: "btts-no", prediction_type: "both_teams_to_score", prediction_value: "no", recommendation_tier: "try", display_label: "Denenir" })
        ]
      ]) as never
    );

    const response = await service.getMatchPredictionPreview(matchId);

    expect(response.groups.primary[0]?.displayLabel).toBe("Çifte Şans X2");
    expect(response.groups.try.map((candidate) => candidate.displayLabel)).toEqual(["Çifte Şans 12", "KG Yok"]);
    expect(response.groups.alternative[0]?.displayLabel).toBe("MS 2.5 Alt");
    expect(JSON.stringify(response)).not.toContain("Tahminim");
    expect(JSON.stringify(response)).not.toContain("Denenir");
  });

  it("returns pending_generation when there is no safe candidate inside the window", async () => {
    const service = new FootballMemberPredictionPreviewService(createDatabaseMock([[matchRow()], []]) as never);

    const response = await service.getMatchPredictionPreview(matchId);

    expect(response.status).toBe("not_available");
    expect(response.reasonCode).toBe("pending_generation");
    expect(response.groups.primary).toHaveLength(0);
    expect(response.message).toBe("Tahmin üretimi bekliyor.");
  });

  it("keeps analysis-ready matches pending generation even when kickoff is far in the future", async () => {
    const service = new FootballMemberPredictionPreviewService(
      createDatabaseMock([[matchRow({ kickoff_at: farFutureKickoff(), feature_status: "ready" })], []]) as never
    );

    const response = await service.getMatchPredictionPreview(matchId);

    expect(response.status).toBe("not_available");
    expect(response.reasonCode).toBe("pending_generation");
    expect(response.message).toBe("Tahmin üretimi bekliyor.");
  });

  it("tells members prediction generation is pending when analysis is ready inside the active lead-time window", async () => {
    const service = new FootballMemberPredictionPreviewService(
      createDatabaseMock([[matchRow({ kickoff_at: withinWindowKickoff(), feature_status: "ready" })], []]) as never
    );

    const response = await service.getMatchPredictionPreview(matchId);

    expect(response.status).toBe("not_available");
    expect(response.reasonCode).toBe("pending_generation");
    expect(response.message).toBe("Tahmin üretimi bekliyor.");
  });

  it("returns not_ready when analysis is partial", async () => {
    const service = new FootballMemberPredictionPreviewService(createDatabaseMock([[matchRow({ feature_status: "partial" })], []]) as never);

    const response = await service.getMatchPredictionPreview(matchId);

    expect(response.status).toBe("not_ready");
    expect(response.reasonCode).toBe("not_ready");
    expect(response.message).toBe("Veri kapsamı tahmin üretmek için yeterli değil.");
  });

  it("returns closed when match has started or kickoff passed", async () => {
    const service = new FootballMemberPredictionPreviewService(
      createDatabaseMock([[matchRow({ kickoff_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(), match_status: "in_progress" })], []]) as never
    );

    const response = await service.getMatchPredictionPreview(matchId);

    expect(response.status).toBe("closed");
    expect(response.reasonCode).toBe("closed");
    expect(response.message).toBe("Maç başladı; aktif tahmin önizlemesi kapandı.");
  });
});

function mockService(overrides: Partial<FootballMemberPredictionPreviewService> = {}): FootballMemberPredictionPreviewService {
  return {
    getMatchPredictionPreview: vi.fn(),
    ...overrides
  } as unknown as FootballMemberPredictionPreviewService;
}

async function runAuthGuard(user: { id: string; email: string; role: "admin" | "member"; status: "active" } | null) {
  const authService = {
    enabled: true,
    currentUserFromRequest: vi.fn().mockResolvedValue(user)
  } as unknown as AuthService;
  const context = { switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }) };
  return new AuthGuard(authService).canActivate(context as never);
}

function createDatabaseMock(results: unknown[][]) {
  return {
    execute: vi.fn(async () => {
      const rows = results.shift() ?? [];
      return { rows };
    })
  };
}

function matchRow(overrides: Record<string, unknown> = {}) {
  return {
    match_id: matchId,
    kickoff_at: withinWindowKickoff(),
    match_status: "not_started",
    feature_status: "ready",
    ...overrides
  };
}

function withinWindowKickoff() {
  return new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
}

function farFutureKickoff() {
  return new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
}

function candidateRow(overrides: Record<string, unknown> = {}) {
  return {
    prediction_id: "prediction-1",
    prediction_type: "over_under_goals",
    prediction_value: "over_2_5",
    recommendation_tier: "try",
    display_label: "Denenir",
    confidence_score: "64",
    risk_level: "medium",
    reasoning_summary: "Gol profili güçlü.",
    status: "draft",
    consistency_status: "warning",
    blocking_conflict_count: 0,
    audit_only: "false",
    generated_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    kickoff_at: withinWindowKickoff(),
    analysis_window_status: "within_window",
    generated_lead_time_minutes: 180,
    rebuild_required: false,
    stale_at: null,
    ...overrides
  };
}
