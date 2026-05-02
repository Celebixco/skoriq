import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  LeagueGroup,
  MatchResultRow,
  PredictionResultsPage,
  Shell,
  groupResultsByLeague,
  predictionResultStatusLabel
} from "./App";
import type { FootballPredictionResultItem } from "./types";

describe("PredictionResultsPage", () => {
  it("renders the results page title, helper note, filters, and empty loading shell", () => {
    const html = renderToStaticMarkup(<PredictionResultsPage navigate={vi.fn()} />);
    expect(html).toContain("Sonuçlar");
    expect(html).toContain("SkorIQ tahminlerinin maç sonuçlarına göre değerlendirmesini incele.");
    expect(html).toContain("Bu sayfada yalnızca sonuçlanmış veya değerlendirilmeyi bekleyen tahminler gösterilir.");
    expect(html).toContain("Toplam tahmin");
    expect(html).toContain("Değerlendirilemedi");
    expect(html).toContain("Takım, lig veya maç ara…");
    expect(html).toContain("Kademe");
    expect(html).not.toContain("provider_entity_id");
    expect(html).not.toContain("raw_provider_payload");
    expect(html).not.toContain("DATABASE_URL");
    expect(html).not.toContain("Yayınla");
    expect(html).not.toContain("member_visible");
  });

  it("keeps Sonuçlar in the member sidebar without admin internals", () => {
    const html = renderToStaticMarkup(
      <Shell
        currentPath="/football/prediction-results"
        navigate={vi.fn()}
        user={{ id: "user-1", email: "member@example.test", role: "member", status: "active" }}
        onLogout={async () => undefined}
        routeLoading={false}
      >
        <span>content</span>
      </Shell>
    );
    expect(html).toContain("Sonuçlar");
    expect(html).not.toContain("Draft Tahminler");
    expect(html).not.toContain("Public Uygunluk");
  });

  it("groups results by country and league", () => {
    const grouped = groupResultsByLeague([resultItem({ tier: "primary", status: "won" }), resultItem({ tier: "try", status: "lost" })]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.competition.name).toBe("Premier League");
    expect(grouped[0]?.country.name).toBe("England");
    expect(grouped[0]?.matches[0]?.predictions).toHaveLength(2);
  });

  it("renders a league-grouped expandable match row with scores and prediction groups", () => {
    const league = groupResultsByLeague([
      resultItem({ tier: "primary", status: "won", displayLabel: "MS 1" }),
      resultItem({ tier: "try", status: "lost", displayLabel: "KG Var" }),
      resultItem({ tier: "alternative", status: "pending", displayLabel: "3.5 Üst" })
    ])[0]!;
    const expandedMatches = new Set(["match-1"]);
    const html = renderToStaticMarkup(
      <LeagueGroup
        league={league}
        expanded
        onToggle={vi.fn()}
        expandedMatches={expandedMatches}
        onToggleMatch={vi.fn()}
        navigate={vi.fn()}
      />
    );
    expect(html).toContain("Premier League");
    expect(html).toContain("England");
    expect(html).toContain("1 maç");
    expect(html).toContain("Arsenal");
    expect(html).toContain("Chelsea");
    expect(html).toContain("2-1");
    expect(html).toContain("İY 1-0");
    expect(html).toContain("Tahminim");
    expect(html).toContain("Denenir");
    expect(html).toContain("Alternatif");
    expect(html).toContain("MS 1");
    expect(html).toContain("KG Var");
    expect(html).toContain("3.5 Üst");
    expect(html).toContain("Kazandı");
    expect(html).toContain("Kaybetti");
    expect(html).toContain("Bekliyor");
    expect(html).toContain("Güven: 70");
    expect(html).toContain("Açıklama güvenli metin.");
  });

  it("collapses match details when the row is not expanded", () => {
    const match = groupResultsByLeague([resultItem({ tier: "primary", status: "won", displayLabel: "MS 1" })])[0]!.matches[0]!;
    const html = renderToStaticMarkup(<MatchResultRow match={match} expanded={false} onToggle={vi.fn()} navigate={vi.fn()} />);
    expect(html).toContain("Tahminim: Kazandı");
    expect(html).not.toContain("Açıklama güvenli metin.");
  });

  it("maps settlement statuses to Turkish labels", () => {
    expect(predictionResultStatusLabel("won")).toBe("Kazandı");
    expect(predictionResultStatusLabel("lost")).toBe("Kaybetti");
    expect(predictionResultStatusLabel("pending")).toBe("Bekliyor");
    expect(predictionResultStatusLabel("void")).toBe("Geçersiz");
    expect(predictionResultStatusLabel("push")).toBe("İade");
    expect(predictionResultStatusLabel("not_settleable")).toBe("Değerlendirilemedi");
    expect(predictionResultStatusLabel("missing_score")).toBe("Skor bekleniyor");
    expect(predictionResultStatusLabel("unsupported_market")).toBe("Desteklenmeyen tahmin tipi");
  });
});

function resultItem(input: {
  tier: FootballPredictionResultItem["prediction"]["tier"];
  status: FootballPredictionResultItem["settlement"]["status"];
  displayLabel?: string;
}): FootballPredictionResultItem {
  return {
    country: { id: "country-1", name: "England" },
    competition: { id: "competition-1", name: "Premier League", logoUrl: null },
    match: {
      id: "match-1",
      homeTeam: { id: "home-1", name: "Arsenal", logoUrl: null },
      awayTeam: { id: "away-1", name: "Chelsea", logoUrl: null },
      kickoffAt: "2026-05-01T19:00:00.000Z",
      finalScore: "2-1",
      halftimeScore: "1-0"
    },
    prediction: {
      marketType: "match_result_1x2",
      selection: "1",
      displayLabel: input.displayLabel ?? "MS 1",
      tier: input.tier,
      confidence: 70
    },
    settlement: {
      status: input.status,
      settledAt: "2026-05-01T21:00:00.000Z",
      explanation: "Açıklama güvenli metin."
    }
  };
}
