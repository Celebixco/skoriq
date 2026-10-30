import "reflect-metadata";
import { Logger, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { TORK_DECISION_POLICY_VERSION, TORK_MODEL_VERSION } from "@sports-data/shared";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FootballTorkPrematchService } from "./football-tork-prematch.service.js";
import { canonicalTorkPublicationSql } from "./football-tork-publication.js";

const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
const dialect = new PgDialect();

function row(overrides: Record<string, unknown> = {}) {
  return {
    match_id: "match-1", competition_id: "league-1", league: "Test League",
    kickoff_at: "2026-11-02T12:00:00Z", home_team: "Home", away_team: "Away",
    home_team_id: "home", away_team_id: "away", home_team_logo_url: null, away_team_logo_url: null,
    prediction_id: "legacy-prediction", model_version: "tork-stage1-logistic-blend",
    prediction_generated_at: "2026-10-30T10:00:00Z", published_at: "2026-10-30T10:01:00Z",
    p_btts: "0.61", expected_btts_goals: "1.7", pick: "btts_no",
    history_home_n: 10, history_away_n: 8, scope_level: "team_history", history_completeness: "unverified",
    evaluation_group: "live_prematch", model_hash: "legacy-hash", metadata_json: {}, ...overrides
  };
}

function setup(rows: unknown[]) {
  const queries: ReturnType<PgDialect["sqlToQuery"]>[] = [];
  const execute = vi.fn(async (query: SQL) => {
    queries.push(dialect.sqlToQuery(query));
    return { rows };
  });
  return { service: new FootballTorkPrematchService({ execute } as never), queries, execute };
}

beforeEach(() => {
  vi.stubEnv("TORK_PREMATCH_ENABLED", "true");
  vi.spyOn(Logger.prototype, "warn").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("FootballTorkPrematchService publication integrity", () => {
  it("keeps a legacy published KG Yok pick above 50%, with its 39% selected-event probability", async () => {
    const legacy = row();
    const original = structuredClone(legacy);
    const { service } = setup([legacy]);

    const response = await service.listUpcoming();

    expect(response.count).toBe(1);
    expect(response.modelVersion).toBe("tork-stage1-logistic-blend");
    expect(response.items[0]?.tork).toMatchObject({
      predictionId: "legacy-prediction", modelVersion: "tork-stage1-logistic-blend",
      pBtts: 0.61, selectionProbability: 0.39, pick: "btts_no",
      pickLabel: "Karşılıklı gol yok", predictionText: "Karşılıklı gol yok (%39 olasılık)",
      decisionPolicyVersion: null, decisionThreshold: null, modelHash: "legacy-hash"
    });
    expect(response.items[0]?.performanceNote).toBeNull();
    expect(legacy).toEqual(original);
  });

  it("marks a response mixed when canonical items carry different explicit model versions", async () => {
    const { service } = setup([row(), row({
      match_id: "match-2", prediction_id: "binary-v2", model_version: TORK_MODEL_VERSION,
      p_btts: 0.52, pick: "btts_yes", metadata_json: { decisionPolicy: { version: TORK_DECISION_POLICY_VERSION, threshold: 0.5 } }
    })]);

    const response = await service.listUpcoming();

    expect(response.modelVersion).toBe("mixed");
    expect(response.items.map((item) => item.tork.modelVersion)).toEqual([
      "tork-stage1-logistic-blend", TORK_MODEL_VERSION
    ]);
  });

  it("uses recorded equal-cost policy metadata and does not reapply the removed 0.55 UI threshold", async () => {
    const { service } = setup([row({
      prediction_id: "binary-v2", model_version: TORK_MODEL_VERSION, p_btts: 0.52, pick: "btts_yes",
      metadata_json: { decisionPolicy: { version: TORK_DECISION_POLICY_VERSION, threshold: 0.5, objective: "binary_equal_cost" } },
      model_hash: "binary-hash"
    })]);

    const item = await service.getMatch("match-1");

    expect(item.tork).toMatchObject({
      predictionId: "binary-v2", modelVersion: TORK_MODEL_VERSION, pick: "btts_yes",
      pBtts: 0.52, selectionProbability: 0.52, predictionText: "Karşılıklı gol var (%52 olasılık)",
      decisionPolicyVersion: TORK_DECISION_POLICY_VERSION, decisionThreshold: 0.5, modelHash: "binary-hash"
    });
  });

  it("uses the identical cross-version canonical SQL in upcoming and getMatch", async () => {
    const { service, queries } = setup([row()]);
    await service.listUpcoming();
    await service.getMatch("match-1");

    const canonical = normalize(dialect.sqlToQuery(canonicalTorkPublicationSql()).sql);
    for (const query of queries) expect(normalize(query.sql)).toContain(canonical);
    expect(queries[0]?.sql).toContain("m.scheduled_start_at > now()");
    expect(queries[1]?.params).toContain("match-1");
    expect(queries[1]?.sql).not.toContain("match-1");
  });

  it.each([
    { p_btts: null }, { p_btts: undefined }, { p_btts: "" }, { p_btts: Number.NaN },
    { p_btts: "NaN" }, { p_btts: Infinity }, { p_btts: -0.01 }, { p_btts: 1.01 },
    { pick: null }, { pick: "" }, { pick: "btts_maybe" }
  ])("fails closed instead of manufacturing a KG Yok prediction from %j", async (invalid) => {
    const { service } = setup([row(invalid), row(invalid)]);

    await expect(service.listUpcoming()).rejects.toBeInstanceOf(ServiceUnavailableException);

    // One bounded message, with no raw payload or secrets, even for many bad rows.
    expect(Logger.prototype.warn).toHaveBeenCalledExactlyOnceWith("Invalid Tork publication rejected while mapping an API response.");
  });

  it("returns not-found for a match with no eligible publication", async () => {
    const { service } = setup([]);
    await expect(service.getMatch("match-1")).rejects.toBeInstanceOf(NotFoundException);
  });
});
