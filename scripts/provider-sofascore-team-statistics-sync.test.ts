import { describe, expect, it } from "vitest";
import {
  parseSofaScoreTeamStatisticsArgs,
  runSofaScoreTeamStatisticsSync
} from "./provider-sofascore-team-statistics-sync.js";
import type { SofaScoreTeamStatisticsDependencies } from "./provider-sofascore-team-statistics-sync.js";

const catalogUpdatedAt = "2026-09-26T09:00:00.000Z";
const env = { NODE_ENV: "test", DATABASE_URL: "postgres://postgres:postgres@localhost/sports_data_test", DB_EXECUTION_TARGET: "local" };
const snapshot = (stats: unknown = { matches: 5, goalsScored: 8, shots: 30 }) => [{
  sofascore_tournament_id: 52, season_id: 98080,
  teams: [{ sofascore_id: 207011, season_statistics: stats }]
}];

function fixture(options: { catalog?: unknown; identities?: unknown[]; metadata?: Record<string, unknown>; executionEnv?: NodeJS.ProcessEnv; concurrentMetadata?: Record<string, unknown> } = {}) {
  let metadata = options.metadata ?? { sofascoreId: 207011, customTag: "preserve", teamColors: { primary: "red" }, seasonStatistics: { corners: 12 }, seasonStatisticsSource: { provider: "sofascore", providerTeamId: "207011", tournamentId: "52", seasonId: "98080" } };
  const history = { teamId: "existing-team", matchIds: ["match-1"], predictionIds: ["prediction-1"] };
  const writes: { text: string; params: unknown[] }[] = [];
  const readStatements: string[] = [];
  let reads = 0;
  const dependencies: SofaScoreTeamStatisticsDependencies = {
    env: options.executionEnv ?? env,
    readCatalog: async () => ({ catalog: options.catalog ?? snapshot(), catalogUpdatedAt }),
    probe: async () => ({ tableNames: ["raw_provider_payloads", "provider_mappings", "sports", "countries", "competitions", "teams", "matches", "football_match_scores", "football_standings"] }),
    database: {
      async query(text: string, params: unknown[] = []) {
        if (/^\s*SELECT/i.test(text)) {
          reads++;
          readStatements.push(text);
          return { rows: options.identities ?? [{ kind: "mapping", id: history.teamId, internal_entity_type: "team", team_exists: true, metadata }] };
        }
        writes.push({ text, params });
        if (options.concurrentMetadata) { metadata = { ...metadata, ...options.concurrentMetadata }; return { rows: [] }; }
        const patch = JSON.parse(String(params[2]));
        metadata = {
          ...metadata, ...patch,
          competitionSeasonStatistics: { ...metadata.competitionSeasonStatistics as object, ...patch.competitionSeasonStatistics }
        };
        return { rows: [{ id: history.teamId }] };
      }
    }
  };
  return { dependencies, writes, readStatements, history, get metadata() { return metadata; }, get reads() { return reads; } };
}

describe("controlled SofaScore existing-team season statistics refresh", () => {
  it("defaults to preview and accepts an explicit catalog path", () => {
    expect(parseSofaScoreTeamStatisticsArgs([])).toMatchObject({ execute: false });
    expect(parseSofaScoreTeamStatisticsArgs(["--catalog-path=reviewed.json", "--execute"])).toEqual({ execute: true, catalogPath: "reviewed.json" });
  });

  it("plans an existing mapped team without writing in dry-run", async () => {
    const data = fixture();
    const report = await runSofaScoreTeamStatisticsSync({ execute: false }, data.dependencies);
    expect(report.entries).toEqual([expect.objectContaining({ providerTeamId: "207011", teamId: "existing-team", status: "planned" })]);
    expect(data.writes).toHaveLength(0);
  });

  it("preserves identifiers, other metadata and history when applying the same snapshot twice", async () => {
    const data = fixture();
    const before = structuredClone(data.history);
    const first = await runSofaScoreTeamStatisticsSync({ execute: true }, data.dependencies);
    const second = await runSofaScoreTeamStatisticsSync({ execute: true }, data.dependencies);
    expect(first.entries[0].status).toBe("updated");
    expect(second.entries[0].status).toBe("unchanged");
    expect(data.writes).toHaveLength(1);
    expect(data.history).toEqual(before);
    expect(data.metadata).toMatchObject({ customTag: "preserve", teamColors: { primary: "red" }, seasonStatistics: { matches: 5, goalsScored: 8 } });
    expect(data.metadata.seasonStatistics).not.toHaveProperty("corners");
    expect(data.metadata.seasonStatisticsSource).toEqual({ source: "catalog_snapshot", provider: "sofascore", providerTeamId: "207011", tournamentId: "52", seasonId: "98080", catalogUpdatedAt });
    expect(JSON.stringify(data.metadata)).not.toMatch(/providerFetchedAt|coverageScore/);
    expect(data.writes[0].text).toMatch(/^\s*UPDATE teams/i);
    expect(data.writes[0].text).toContain("t.metadata_json");
    expect(data.readStatements[0]).toMatch(/sports.*football/s);
    expect(data.writes[0].text).toMatch(/sports.*football/s);
    expect(data.writes[0].params[0]).toBe("existing-team");
  });

  it("keeps multiple competition scopes and refreshes only the verified summary scope", async () => {
    const data = fixture({ catalog: [...snapshot(), { sofascore_tournament_id: 99, season_id: 100, teams: [{ sofascore_id: 207011, season_statistics: { matches: 2, goalsScored: 3 } }] }] });
    await runSofaScoreTeamStatisticsSync({ execute: true }, data.dependencies);
    expect(data.writes).toHaveLength(1);
    expect(data.metadata).toMatchObject({ seasonStatistics: { goalsScored: 8 }, competitionSeasonStatistics: { "52:98080": { statistics: { goalsScored: 8 } }, "99:100": { statistics: { goalsScored: 3 } } } });
  });

  it.each([
    ["unknown team", [], "unknown_team"],
    ["two metadata matches", [{ kind: "metadata", id: "a", team_exists: true, metadata: { sofascoreId: 207011 } }, { kind: "metadata", id: "b", team_exists: true, metadata: { sofascoreId: 207011 } }], "identity_conflict"],
    ["mapping conflicts with metadata match", [{ kind: "mapping", id: "a", internal_entity_type: "team", team_exists: true, metadata: {} }, { kind: "metadata", id: "b", team_exists: true, metadata: { sofascoreId: 207011 } }], "identity_conflict"],
    ["mapped team has another provider ID", [{ kind: "mapping", id: "a", internal_entity_type: "team", team_exists: true, metadata: { sofascoreId: 999 } }], "identity_conflict"],
    ["dangling authoritative mapping", [{ kind: "mapping", id: "a", internal_entity_type: "team", team_exists: false, metadata: null }, { kind: "metadata", id: "b", team_exists: true, metadata: { sofascoreId: 207011 } }], "identity_conflict"]
  ])("skips %s without writes", async (_label, identities, status) => {
    const data = fixture({ identities });
    const result = await runSofaScoreTeamStatisticsSync({ execute: true }, data.dependencies);
    expect(result.entries[0].status).toBe(status);
    expect(data.writes).toHaveLength(0);
  });

  it("accepts a unique metadata identity when no mapping exists", async () => {
    const data = fixture({ identities: [{ kind: "metadata", id: "existing-team", team_exists: true, metadata: { sofascoreId: 207011 } }] });
    expect((await runSofaScoreTeamStatisticsSync({ execute: false }, data.dependencies)).entries[0]).toMatchObject({ status: "planned", teamId: "existing-team" });
  });

  it.each([undefined, {}, { matches: 0, shots: 10 }, { matches: 2, shots: "10" }, { matches: 2, shots: -1 }, { matches: 2, shots: Infinity }])("does not overwrite missing/invalid statistics %#", async (statistics) => {
    const catalog = snapshot(statistics);
    if (statistics === undefined) delete (catalog[0].teams[0] as { season_statistics?: unknown }).season_statistics;
    const data = fixture({ catalog });
    const result = await runSofaScoreTeamStatisticsSync({ execute: true }, data.dependencies);
    expect(result.entries[0].status).toBe("invalid_statistics");
    expect(data.writes).toHaveLength(0);
  });

  it.each([
    { ...env, NODE_ENV: "production" },
    { ...env, DATABASE_URL: "https://localhost/sports_data_test" },
    { ...env, DATABASE_URL: "postgres://user:pass@remote.example.com/sports_data_test" },
    { ...env, DATABASE_URL: "postgres://user:pass@branch.neon.tech/main", DB_EXECUTION_TARGET: "neon-test", ALLOW_REMOTE_TEST_DB: "true" }
  ])("blocks unsafe targets before catalog/database work", async (executionEnv) => {
    const data = fixture({ executionEnv });
    await expect(runSofaScoreTeamStatisticsSync({ execute: true }, data.dependencies)).rejects.toThrow(/production|readiness/i);
    expect(data.reads).toBe(0);
    expect(data.writes).toHaveLength(0);
  });

  it("allows an explicitly approved Neon test branch", async () => {
    const data = fixture({ executionEnv: { ...env, DATABASE_URL: "postgres://user:pass@branch.neon.tech/sports_data_test", DB_EXECUTION_TARGET: "neon-test", ALLOW_REMOTE_TEST_DB: "true", NEON_BRANCH_NAME: "test-telemetry" } });
    expect((await runSofaScoreTeamStatisticsSync({ execute: false }, data.dependencies)).entries[0].status).toBe("planned");
  });

  it("validates catalog scopes without connecting when preview has no database configured", async () => {
    const data = fixture({ executionEnv: { NODE_ENV: "test" } });
    const report = await runSofaScoreTeamStatisticsSync({ execute: false }, data.dependencies);
    expect(report.entries[0]).toMatchObject({ providerTeamId: "207011", status: "catalog_validated" });
    expect(report.entries[0].teamId).toBeUndefined();
    expect(data.reads).toBe(0);
    expect(data.writes).toHaveLength(0);
  });

  it("rejects URL host overrides before a readiness probe", async () => {
    const data = fixture({ executionEnv: { ...env, DATABASE_URL: `${env.DATABASE_URL}?host=remote.example.com` } });
    data.dependencies.probe = async () => { throw new Error("Unexpected database connection"); };
    await expect(runSofaScoreTeamStatisticsSync({ execute: true }, data.dependencies)).rejects.toThrow(/override/i);
    expect(data.reads).toBe(0);
  });

  it("skips conflicting snapshots for the same team/competition/season", async () => {
    const data = fixture({ catalog: [...snapshot(), ...snapshot({ matches: 5, goalsScored: 99 })] });
    expect((await runSofaScoreTeamStatisticsSync({ execute: true }, data.dependencies)).entries[0].status).toBe("catalog_conflict");
    expect(data.writes).toHaveLength(0);
  });

  it("preserves a known provider fetch time separately from the catalog file time", async () => {
    const catalog = snapshot();
    Object.assign(catalog[0].teams[0], { providerFetchedAt: "2026-09-25T12:00:00Z", source: "sofascore_api", endpoint: "https://www.sofascore.com/api/v1/team/207011/unique-tournament/52/season/98080/statistics/overall" });
    const data = fixture({ catalog });
    await runSofaScoreTeamStatisticsSync({ execute: true }, data.dependencies);
    expect(data.metadata.seasonStatisticsSource).toMatchObject({ source: "sofascore_api", providerFetchedAt: "2026-09-25T12:00:00.000Z", catalogUpdatedAt });
  });

  it("stores an optional captured season name for verified API scope selection", async () => {
    const catalog = snapshot();
    Object.assign(catalog[0], { season_name: "Premier League 26/27" });
    const data = fixture({ catalog });
    await runSofaScoreTeamStatisticsSync({ execute: true }, data.dependencies);
    expect(data.metadata.seasonStatisticsSource).toHaveProperty("seasonName", "Premier League 26/27");
    expect(data.metadata.competitionSeasonStatistics).toMatchObject({ "52:98080": { provenance: { seasonName: "Premier League 26/27" } } });
  });

  it("retains validated visible-page method, partial coverage and exact public scope proof", async () => {
    const catalog = snapshot();
    const visible = { captureMethod: "visible_dom", statisticsCoverage: "visible_partial", scopeProofUrl: "https://www.sofascore.com/football/tournament/turkey/trendyol-super-lig/52#id:98080" };
    Object.assign(catalog[0].teams[0], visible);
    const data = fixture({ catalog });
    await runSofaScoreTeamStatisticsSync({ execute: true }, data.dependencies);
    expect(data.metadata.seasonStatisticsSource).toMatchObject(visible);
    expect(data.metadata.competitionSeasonStatistics).toMatchObject({ "52:98080": { provenance: visible } });
  });

  it.each([
    { captureMethod: "network" }, { statisticsCoverage: "complete" }, { statisticsCoverage: null },
    { scopeProofUrl: "https://www.sofascore.com/football/tournament/turkey/trendyol-super-lig/53#id:98080" },
    { scopeProofUrl: "https://www.sofascore.com/football/tournament/turkey/trendyol-super-lig/52#id:98081" },
    { scopeProofUrl: "https://example.com/football/tournament/turkey/trendyol-super-lig/52#id:98080" },
    { scopeProofUrl: "https://www.sofascore.com/football/tournament/turkey/trendyol-super-lig/52?other=1#id:98080" }
  ])("rejects invalid optional public-capture provenance without writes %#", async (provenance) => {
    const catalog = snapshot();
    Object.assign(catalog[0].teams[0], provenance);
    const data = fixture({ catalog });
    expect((await runSofaScoreTeamStatisticsSync({ execute: true }, data.dependencies)).entries[0].status).toBe("invalid_provenance");
    expect(data.writes).toHaveLength(0);
  });

  it.each([
    ["unverified legacy summary", { sofascoreId: 207011, seasonStatistics: { corners: 12 } }, "preserved_unverified_scope"],
    ["another verified competition", { sofascoreId: 207011, seasonStatistics: { corners: 12 }, seasonStatisticsSource: { provider: "sofascore", providerTeamId: "207011", tournamentId: "99", seasonId: "100" } }, "preserved_different_scope"],
    ["missing flat summary", { sofascoreId: 207011 }, "preserved_unverified_scope"]
  ])("updates only scoped statistics for %s", async (_label, metadata, compatibilitySummary) => {
    const data = fixture({ metadata });
    const beforeFlat = data.metadata.seasonStatistics;
    const report = await runSofaScoreTeamStatisticsSync({ execute: true }, data.dependencies);
    expect(report.entries[0]).toMatchObject({ status: "updated", compatibilitySummary });
    expect(data.metadata.seasonStatistics).toEqual(beforeFlat);
    expect(data.metadata).toMatchObject({ competitionSeasonStatistics: { "52:98080": { statistics: { matches: 5, goalsScored: 8 } } } });
  });

  it("rejects invalid provider fetch timestamps instead of recording assumed freshness", async () => {
    const catalog = snapshot();
    Object.assign(catalog[0].teams[0], { providerFetchedAt: "2026-09-25T12:00:00" });
    const data = fixture({ catalog });
    expect((await runSofaScoreTeamStatisticsSync({ execute: true }, data.dependencies)).entries[0].status).toBe("invalid_provenance");
    expect(data.writes).toHaveLength(0);
  });

  it("does not replace a known fresh provider snapshot with an older or undated snapshot", async () => {
    const data = fixture({ metadata: { sofascoreId: 207011, competitionSeasonStatistics: { "52:98080": { statistics: { matches: 6 }, provenance: { providerFetchedAt: "2026-09-27T12:00:00.000Z" } } } } });
    expect((await runSofaScoreTeamStatisticsSync({ execute: true }, data.dependencies)).entries[0].status).toBe("stale_snapshot");
    expect(data.writes).toHaveLength(0);
  });

  it("accepts the real SofaScore statistics metadata and signed goalsPrevented metric", async () => {
    const data = fixture({ catalog: snapshot({ matches: 5, shots: 30, goalsPrevented: -2.75, statisticsType: { sportSlug: "football", statisticsType: "team" } }) });
    expect((await runSofaScoreTeamStatisticsSync({ execute: true }, data.dependencies)).entries[0].status).toBe("updated");
    expect(data.metadata.seasonStatistics).toMatchObject({ goalsPrevented: -2.75 });
    expect(data.metadata.seasonStatistics).not.toHaveProperty("statisticsType");
  });

  it("passes observed scope state to the conditional update and reports a concurrent refresh as a no-op", async () => {
    const newer = { "52:98080": { statistics: { matches: 6, goalsScored: 11 }, provenance: { providerFetchedAt: "2026-09-27T12:00:00.000Z" } } };
    const data = fixture({ concurrentMetadata: { competitionSeasonStatistics: newer } });
    const report = await runSofaScoreTeamStatisticsSync({ execute: true }, data.dependencies);
    expect(report.entries[0].status).toBe("snapshot_changed");
    expect(JSON.parse(String(data.writes[0].params[3]))).toMatchObject({ scopes: { "52:98080": null } });
    expect(data.writes[0].text).toMatch(/IS DISTINCT FROM/);
    expect(data.metadata.competitionSeasonStatistics).toEqual(newer);
  });

  it("guards flat provenance even when a concurrent fresh summary appears during a scoped-only refresh", async () => {
    const freshSource = { provider: "sofascore", providerTeamId: "207011", tournamentId: "52", seasonId: "98080", providerFetchedAt: "2026-09-27T12:00:00.000Z" };
    const data = fixture({ metadata: { sofascoreId: 207011 }, concurrentMetadata: { seasonStatisticsSource: freshSource } });
    const report = await runSofaScoreTeamStatisticsSync({ execute: true }, data.dependencies);
    expect(report.entries[0]).toMatchObject({ status: "snapshot_changed", compatibilitySummary: "preserved_unverified_scope" });
    expect(JSON.parse(String(data.writes[0].params[2]))).not.toHaveProperty("seasonStatistics");
    expect(JSON.parse(String(data.writes[0].params[3]))).toMatchObject({ scopes: { "52:98080": null }, flatSource: null });
    expect(data.writes[0].text).toMatch(/AND COALESCE\(t\.metadata_json->'seasonStatisticsSource', 'null'::jsonb\) IS NOT DISTINCT FROM \$4::jsonb->'flatSource'\s+AND \(NOT \(\$3::jsonb \? 'seasonStatistics'\)/);
    expect(data.metadata.seasonStatisticsSource).toEqual(freshSource);
    expect(data.metadata.competitionSeasonStatistics).toBeUndefined();
  });

  it.each([null, { "52:98080": null }])("normalizes JSON-null scope containers in the emitted database update %#", async (competitionSeasonStatistics) => {
    const data = fixture({ metadata: { sofascoreId: 207011, competitionSeasonStatistics } });
    expect((await runSofaScoreTeamStatisticsSync({ execute: true }, data.dependencies)).entries[0].status).toBe("updated");
    expect(data.writes[0].text).toContain("NULLIF(t.metadata_json->'competitionSeasonStatistics', 'null'::jsonb)");
    expect(data.writes[0].text).toContain("jsonb_typeof");
    expect(data.metadata.competitionSeasonStatistics).toMatchObject({ "52:98080": { statistics: { matches: 5 } } });
  });

  it("refuses an array as the stored team metadata instead of converting it into a patch target", async () => {
    const data = fixture({ identities: [{ kind: "mapping", id: "existing-team", internal_entity_type: "team", team_exists: true, metadata: [] }] });
    expect((await runSofaScoreTeamStatisticsSync({ execute: true }, data.dependencies)).entries[0].status).toBe("invalid_metadata_shape");
    expect(data.writes).toHaveLength(0);
  });
});
