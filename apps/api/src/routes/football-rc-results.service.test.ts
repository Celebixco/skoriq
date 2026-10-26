import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { FootballRcResultsService } from "./football-rc-results.service.js";
import type { RcResultRow } from "./football-rc-results.service.js";

describe("FootballRcResultsService", () => {
  it("maps RC prediction rows to member-safe result items with settlement statuses", async () => {
    const service = serviceWithRows([
      row({ pick: "1", result_label: "1", normal_time_status: "verified_normal_time", home_score_90: 2, away_score_90: 1 }),
      row({ pick: "X", result_label: "2", normal_time_status: "verified_normal_time", home_score_90: 0, away_score_90: 2 }),
      row({ pick: "1", result_label: null, normal_time_status: "after_extra_time" }),
      row({ pick: "2", result_label: null, normal_time_status: null, resolved_at: null, home_score_90: null, away_score_90: null })
    ]);

    const results = await service.listResults({ limit: 50, offset: 0 });
    expect(results.total).toBe(4);
    expect(results.items.map((item) => item.settlement.status)).toEqual(["won", "lost", "void", "pending"]);
    expect(results.items[0]?.prediction.displayLabel).toBe("Trey — Arsenal kazanır");
    expect(results.items[0]?.prediction.tier).toBe("primary");
    expect(results.items[0]?.prediction.confidence).toBeNull();
    expect(results.items[0]?.settlement.explanation).toBe("Normal süre sonucu 2-1: tahmin tuttu.");
    expect(results.items[1]?.settlement.explanation).toBe("Normal süre sonucu 0-2: tahmin tutmadı.");
    expect(results.items[2]?.settlement.explanation).toBe("Maç normal sürede tamamlanmadığı için tahmin değerlendirilemedi.");
    expect(results.items[3]?.settlement.explanation).toBe("Maç sonucu henüz değerlendirilmedi.");
    expect(results.items[3]?.settlement.settledAt).toBeNull();
  });

  it("summarizes statuses, countries, and leagues for the results header", async () => {
    const service = serviceWithRows([
      row({ pick: "1", result_label: "1", normal_time_status: "verified_normal_time" }),
      row({ pick: "X", result_label: "2", normal_time_status: "verified_normal_time", match_id: "match-2" }),
      row({ pick: "2", result_label: null, normal_time_status: null, match_id: "match-3" })
    ]);

    const summary = await service.getResultsSummary();
    expect(summary.modelLabel).toBe("Trey");
    expect(summary.total).toBe(3);
    expect(summary.totalSettled).toBe(2);
    expect(summary.won).toBe(1);
    expect(summary.lost).toBe(1);
    expect(summary.pending).toBe(1);
    expect(summary.void).toBe(0);
    expect(summary.byLeague).toEqual([{ id: "competition-1", name: "Premier League", count: 3 }]);
    expect(summary.byCountry).toEqual([{ id: "country-1", name: "England", count: 3 }]);
  });
});

function serviceWithRows(rows: RcResultRow[], totalCount = rows.length) {
  const responses: unknown[][] = [rows, [{ count: String(totalCount) }]];
  const database = {
    execute: async () => responses.shift() ?? rows
  };
  return new FootballRcResultsService(database as never);
}

function row(overrides: Partial<RcResultRow> = {}): RcResultRow {
  return {
    country_id: "country-1",
    country_name: "England",
    competition_id: "competition-1",
    competition_name: "Premier League",
    match_id: "match-1",
    home_team_id: "home-1",
    home_team_name: "Arsenal",
    home_team_logo_url: null,
    away_team_id: "away-1",
    away_team_name: "Chelsea",
    away_team_logo_url: null,
    kickoff_at: new Date("2026-10-20T19:00:00.000Z"),
    home_score_fulltime: 2,
    away_score_fulltime: 1,
    home_score_halftime: 1,
    away_score_halftime: 0,
    pick: "1",
    normal_time_status: "verified_normal_time",
    result_label: "1",
    home_score_90: 2,
    away_score_90: 1,
    resolved_at: new Date("2026-10-20T21:00:00.000Z"),
    ...overrides
  };
}
