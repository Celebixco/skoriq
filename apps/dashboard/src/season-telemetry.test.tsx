import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MatchCenterSeasonTelemetryComparison, TeamSeasonTelemetrySection } from "./App";
import type { FootballTeamProfileResponse } from "./types";

function profile(seasonStatistics: Record<string, unknown>): FootballTeamProfileResponse {
  return { team: { id: "team", name: "Team", logoUrl: null, country: null, primaryCompetition: null, seasonStatistics } } as FootballTeamProfileResponse;
}

function comparison(home: Record<string, unknown>, away: Record<string, unknown>) {
  return renderToStaticMarkup(<MatchCenterSeasonTelemetryComparison homeTeam={{ id: "home", name: "Home" }} awayTeam={{ id: "away", name: "Away" }} homeProfile={profile(home)} awayProfile={profile(away)} />);
}

function card(html: string, label: string) {
  const labelIndex = html.indexOf(`<span>${label}</span>`);
  expect(labelIndex).toBeGreaterThanOrEqual(0);
  return html.slice(labelIndex, html.indexOf("</div>", labelIndex));
}

function bar(html: string, label: string) {
  const labelIndex = html.indexOf(`<span class="telemetry-bar-label">${label}</span>`);
  expect(labelIndex).toBeGreaterThanOrEqual(0);
  const start = html.lastIndexOf('<div class="telemetry-bar-item', labelIndex);
  const next = html.indexOf('<div class="telemetry-bar-item', labelIndex);
  return html.slice(start, next < 0 ? html.indexOf('<div class="telemetry-details-grid">', labelIndex) : next);
}

describe("season telemetry units and missing measurements", () => {
  it("shows public-page averages with units and keeps absent totals distinct from true zero", () => {
    const html = renderToStaticMarkup(<TeamSeasonTelemetrySection seasonStatistics={{ goalsScored: 0, shotsPerGame: 14.7, shotsOnTargetPerGame: 5.2, yellowCardsPerGame: 3.2, redCards: 0 }} />);
    expect(card(html, "Şut / maç")).toContain("<strong>14.7</strong>");
    expect(card(html, "Şut / maç")).toContain("İsabetli / maç: 5.2");
    expect(card(html, "Gol / xG")).toContain("<strong>0 / —</strong>");
    expect(card(html, "Büyük Şanslar")).toContain("<strong>—</strong>");
    expect(card(html, "Sarı Kart / maç")).toContain("<strong>3.2</strong>");
    expect(card(html, "Kırmızı Kart (toplam)")).toContain("<strong>0</strong>");
    expect(card(html, "Faul")).toContain("<strong>—</strong>");
    expect(html).not.toContain("125 Veri Noktası");
  });

  it("compares averages instead of mixing one team's totals with the other team's averages", () => {
    const html = comparison({ shots: 88, shotsPerGame: 14.7 }, { shotsPerGame: 13.6 });
    const shots = bar(html, "Şut / maç");
    expect(shots).toContain('class="telemetry-val-home">14.7</strong>');
    expect(shots).toContain('class="telemetry-val-away">13.6</strong>');
    expect(shots).not.toContain(">88<");
  });

  it("prefers season totals when both teams have them", () => {
    const shots = bar(comparison({ shots: 88, shotsPerGame: 14.7 }, { shotsTotal: 68, shotsPerGame: 13.6 }), "Toplam Şut");
    expect(shots).toContain('class="telemetry-val-home">88</strong>');
    expect(shots).toContain('class="telemetry-val-away">68</strong>');
  });

  it("shows unavailable sides as missing without drawing a fabricated comparison", () => {
    const html = comparison({ shotsPerGame: 0, goalsScored: 0 }, {});
    const shots = bar(html, "Şut / maç");
    expect(shots).toContain('class="telemetry-val-home">0</strong>');
    expect(shots).toContain('class="telemetry-val-away">—</strong>');
    expect(shots).not.toContain("telemetry-dual-track");
    expect(html).not.toContain("Doğrulanmış");
    expect(html).not.toContain("2026/27");
    expect(html).not.toContain('telemetry-side-val lead');
  });

  it("does not render an away advantage when both measurements are truly zero", () => {
    const goals = bar(comparison({ goalsScored: 0 }, { goalsScored: 0 }), "Toplam Atılan Gol");
    expect(goals).toContain('class="telemetry-val-home">0</strong>');
    expect(goals).toContain('class="telemetry-val-away">0</strong>');
    expect(goals).not.toContain("telemetry-dual-track");
  });
});
