import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CouponSelection } from "./coupon-model";
import { CouponRail } from "./CouponRail";

const mock = vi.hoisted(() => ({ selections: [] as CouponSelection[], checking: false, validationError: null as string | null, message: "" }));
vi.mock("./CouponProvider", () => ({ useCoupon: () => ({ ...mock, getSelections: () => mock.selections, add: vi.fn(), remove: vi.fn(), clear: vi.fn(), revalidate: vi.fn(), isSelected: vi.fn() }) }));

function selection(id: string, confidenceScore: number | null = 64): CouponSelection {
  return {
    match: { matchId: id, kickoffAt: "2026-10-18T20:00:00Z", status: "scheduled", competition: { name: "Süper Lig" }, homeTeam: { id: `${id}-home`, name: "Ankara Kuzey" }, awayTeam: { id: `${id}-away`, name: "İzmir Güney" } },
    prediction: { predictionId: `prediction-${id}`, displayLabel: "MS 2,5 Üst", predictionType: "total_goals", predictionValue: "over_2_5", recommendationTier: "primary", confidenceScore, riskLevel: "medium", reasoningSummary: null, generatedAt: "2026-10-18T10:00:00Z", kickoffAt: "2026-10-18T20:00:00Z", isFresh: true, analysisWindowStatus: "within_window" },
    minimumLeadMinutes: 10, addedAt: "2026-10-18T10:00:00Z"
  };
}

describe("member coupon rail", () => {
  beforeEach(() => { mock.selections = []; mock.checking = false; mock.validationError = null; mock.message = ""; });

  it("keeps the zero count visible and explains where a first selection comes from", () => {
    const html = renderToStaticMarkup(<CouponRail navigate={vi.fn()} />);
    expect(html).toContain("Seçim bekleniyor");
    expect(html).toContain("İlk seçimini ekle.");
    expect(html).toContain("Tahmini hazır bir maçta");
    expect(html).toContain("Bu cihazda saklanır");
    expect(html).toMatch(/disabled=""[^>]*>Kuponu kopyala/);
    expect(html).toContain('aria-haspopup="dialog" aria-expanded="false"');
  });

  it("shows the combination count and plain selections without model or confidence data", () => {
    mock.selections = [selection("one"), selection("two", 72)];
    const html = renderToStaticMarkup(<CouponRail navigate={vi.fn()} />);
    expect(html).toContain("2 maçlık kombin");
    expect(html).toContain("MS 2,5 Üst");
    expect(html).not.toContain("64/100");
    expect(html).not.toContain("72/100");
    expect(html).not.toContain("Risk");
    expect(html).not.toContain("Güven");
    expect(html.match(/seçimini kaldır/g)).toHaveLength(2);
    expect(html.match(/maç analizini aç/g)).toHaveLength(2);
    expect(html).toContain("MS 2,5 Üst");
    expect(html).not.toMatch(/toplam güven|kombin güveni|toplam oran|kupon tutarı/i);
  });

  it("shows a validation problem without confidence or risk labels", () => {
    mock.selections = [selection("one", null)];
    mock.validationError = "Bağlantı kurulamadı. Tekrar dene.";
    const html = renderToStaticMarkup(<CouponRail navigate={vi.fn()} />);
    expect(html).not.toContain("Güven");
    expect(html).not.toContain("Risk");
    expect(html).toContain('role="alert">Bağlantı kurulamadı. Tekrar dene.');
  });

  it("keeps the panel status available without rendering a second initial live announcement", () => {
    mock.message = "Seçim kupon taslağına eklendi.";
    const html = renderToStaticMarkup(<CouponRail navigate={vi.fn()} />);
    expect(html).toContain('class="arena-coupon-status" role="status">Seçim kupon taslağına eklendi.');
    expect(html.match(/role="status"/g)).toHaveLength(1);
    expect(html).not.toContain('class="arena-coupon-mobile-feedback"');
  });
});
