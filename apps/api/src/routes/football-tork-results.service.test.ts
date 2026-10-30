import "reflect-metadata";
import { Logger, ServiceUnavailableException } from "@nestjs/common";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FootballTorkResultsService, type TorkResultRow } from "./football-tork-results.service.js";
import { canonicalTorkPublicationSql } from "./football-tork-publication.js";

const dialect = new PgDialect();
const normalize = (value: string) => value.replace(/\s+/g, " ").trim();

function row(overrides: Partial<TorkResultRow> = {}): TorkResultRow {
  return {
    country_id: "country-1", country_name: "Test Country", competition_id: "league-1", competition_name: "Test League",
    match_id: "match-1", home_team_id: "home", home_team_name: "Home", home_team_logo_url: null,
    away_team_id: "away", away_team_name: "Away", away_team_logo_url: null,
    kickoff_at: "2026-10-20T12:00:00Z", home_score_fulltime: 1, away_score_fulltime: 0,
    home_score_halftime: 0, away_score_halftime: 0,
    prediction_id: "legacy-prediction", model_version: "tork-stage1-logistic-blend", model_hash: "legacy-hash", metadata_json: {},
    pick: "btts_no", p_btts: "0.61", fulltime_status: "verified_normal_time", result_label: "btts_no",
    resolved_at: "2026-10-20T15:00:00Z", ...overrides
  };
}

function setup(responses: unknown[][]) {
  const queries: ReturnType<PgDialect["sqlToQuery"]>[] = [];
  const execute = vi.fn(async (query: SQL) => {
    queries.push(dialect.sqlToQuery(query));
    return { rows: responses.shift() ?? [] };
  });
  return { service: new FootballTorkResultsService({ execute } as never), queries };
}

beforeEach(() => {
  vi.stubEnv("TORK_PREMATCH_ENABLED", "true");
  vi.spyOn(Logger.prototype, "warn").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("FootballTorkResultsService", () => {
  it("settles a normal 1-0 as KG Yok and reports the published selection's 39% probability", async () => {
    const legacy = row();
    const before = structuredClone(legacy);
    const { service } = setup([[legacy], [{ count: "1" }]]);

    const response = await service.listResults({ limit: 50, offset: 0 });

    expect(response.total).toBe(1);
    expect(response.items[0]?.prediction).toMatchObject({
      predictionId: "legacy-prediction", modelVersion: "tork-stage1-logistic-blend",
      selection: "btts_no", displayLabel: "Tork — Karşılıklı gol yok", pBtts: 0.61,
      probability: 0.39, selectionProbability: 0.39, confidence: null,
      decisionPolicyVersion: null, decisionThreshold: null, modelHash: "legacy-hash"
    });
    expect(response.items[0]?.match.finalScore).toBe("1-0");
    expect(response.items[0]?.settlement).toMatchObject({ status: "won", explanation: "Maç sonucu 1-0: tahmin tuttu." });
    expect(legacy).toEqual(before);
  });

  it("compares the actual fulltime result to the stored pick rather than reclassifying its probability", async () => {
    const rows = [
      row({ pick: "btts_no", p_btts: 0.61 }),
      row({ pick: "btts_yes", p_btts: 0.52, match_id: "match-2" }),
      row({ fulltime_status: "after_extra_time", result_label: null, match_id: "match-3" }),
      row({ fulltime_status: null, result_label: null, resolved_at: null, match_id: "match-4", home_score_fulltime: null, away_score_fulltime: null })
    ];
    const { service } = setup([rows, [{ count: "4" }]]);

    const response = await service.listResults({ limit: 50, offset: 0 });

    expect(response.items.map((item) => item.settlement.status)).toEqual(["won", "lost", "void", "pending"]);
    expect(response.items[1]?.prediction.probability).toBe(0.52);
    expect(response.items[3]?.match.finalScore).toBeNull();
    expect(response.items[3]?.settlement.settledAt).toBeNull();
  });

  it.each([
    { home_score_fulltime: null, away_score_fulltime: null },
    { home_score_fulltime: null, away_score_fulltime: 0 },
    { home_score_fulltime: 0, away_score_fulltime: null },
    { home_score_fulltime: "", away_score_fulltime: 0 },
    { home_score_fulltime: Number.NaN, away_score_fulltime: 0 },
    { home_score_fulltime: -1, away_score_fulltime: 0 }
  ])("does not fabricate a 0-0 score when normal-time scores are missing/invalid: %j", async (scores) => {
    const { service } = setup([[row({ ...scores, home_score_halftime: null, away_score_halftime: null })], [{ count: "1" }]]);
    const response = await service.listResults({ limit: 50, offset: 0 });
    expect(response.items[0]?.match.finalScore).toBeNull();
    expect(response.items[0]?.match.halftimeScore).toBeNull();
  });

  it("keeps an actual zero-zero score", async () => {
    const { service } = setup([[row({ home_score_fulltime: "0", away_score_fulltime: 0 })], [{ count: "1" }]]);
    const response = await service.listResults({ limit: 50, offset: 0 });
    expect(response.items[0]?.match.finalScore).toBe("0-0");
  });

  it("shares canonical cross-version eligibility and all filters between list, count and summary", async () => {
    const { service, queries } = setup([[], [{ count: "0" }], []]);
    const filters = {
      status: "won" as const, countryId: "country-1", competitionId: "league-1", teamId: "team-1", matchId: "match-1",
      search: "HOME' OR TRUE --", from: "2026-01-01", to: "2026-12-31"
    };
    await service.listResults({ ...filters, limit: 25, offset: 50 });
    await service.getResultsSummary(filters);

    const canonical = normalize(dialect.sqlToQuery(canonicalTorkPublicationSql()).sql);
    for (const query of queries) {
      expect(normalize(query.sql)).toContain(canonical);
      expect(query.sql).toContain("m.scheduled_start_at < now()");
      expect(query.params).toEqual(expect.arrayContaining(["won", "country-1", "league-1", "team-1", "match-1", "%home' or true --%", "2026-01-01", "2026-12-31"]));
      expect(query.sql).not.toContain("HOME' OR TRUE");
    }
    const fromClause = (query: string) => normalize(query).split("from football_tork_prematch_predictions p")[1]?.split(/ order by| group by/)[0];
    expect(fromClause(queries[0]!.sql)).toBe(fromClause(queries[1]!.sql));
    expect(fromClause(queries[1]!.sql)).toBe(fromClause(queries[2]!.sql));
  });

  it("summarizes all canonical matches in grouped SQL rather than truncating history to 1000 rows", async () => {
    const base = { country_id: "country-1", country_name: "Test Country", competition_id: "league-1", competition_name: "Test League" };
    const { service, queries } = setup([[
      { ...base, settlement_status: "won", count: "1200" },
      { ...base, settlement_status: "lost", count: "80" },
      { ...base, settlement_status: "pending", count: "4" },
      { ...base, settlement_status: "void", count: "2" }
    ]]);

    const summary = await service.getResultsSummary();

    expect(summary).toMatchObject({ total: 1286, totalSettled: 1280, won: 1200, lost: 80, pending: 4, void: 2 });
    expect(summary.byCountry).toEqual([{ id: "country-1", name: "Test Country", count: 1286 }]);
    expect(summary.byLeague).toEqual([{ id: "league-1", name: "Test League", count: 1286 }]);
    expect(queries[0]?.sql).not.toMatch(/\blimit\b/i);
    expect(queries[0]?.sql).toContain("group by");
  });

  it.each([{ p_btts: null }, { p_btts: Number.NaN }, { p_btts: "" }, { p_btts: 1.01 }, { pick: null }, { pick: "invalid" }])
  ("rejects an unexpected invalid driver value without a manufactured KGYok result: %j", async (invalid) => {
    const { service } = setup([[row(invalid), row(invalid)], [{ count: "2" }]]);

    await expect(service.listResults({ limit: 50, offset: 0 })).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(Logger.prototype.warn).toHaveBeenCalledExactlyOnceWith("Invalid Tork publication rejected while mapping an API response.");
  });
});
