import { describe, expect, it, vi } from "vitest";
import { checkDatabaseReadiness } from "./db-readiness.js";
import {
  parseFootballTargetListArgs,
  runFootballTargetListing,
  validateFootballTargetListOptions
} from "./analytics-football-list-targets.js";
import type { FootballTargetListDependencies, FootballTargetListOptions } from "./analytics-football-list-targets.js";

const baseOptions: FootballTargetListOptions = {
  limit: 20,
  json: false
};

const baseEnv = {
  NODE_ENV: "development",
  DATABASE_URL: "postgres://user:secret@localhost:5432/sports_data"
};

describe("football analytics target listing command", () => {
  it("defaults to text output with a safe small limit", () => {
    expect(parseFootballTargetListArgs([])).toEqual({
      limit: 20,
      json: false
    });
  });

  it("parses competition, limit, and JSON flags", () => {
    expect(parseFootballTargetListArgs(["--competition-id=competition-1", "--limit=5", "--json"])).toEqual({
      competitionId: "competition-1",
      limit: 5,
      json: true
    });
  });

  it("rejects overly broad limits", () => {
    expect(() => parseFootballTargetListArgs(["--limit=101"])).toThrow("--limit must be between 1 and 100.");
  });

  it("blocks production usage", () => {
    expect(() => validateFootballTargetListOptions(baseOptions, { ...baseEnv, NODE_ENV: "production" })).toThrow(
      "Football analytics target listing is forbidden in production."
    );
  });

  it("requires DATABASE_URL without printing credentials", () => {
    expect(() => validateFootballTargetListOptions(baseOptions, { ...baseEnv, DATABASE_URL: undefined })).toThrow(
      "DATABASE_URL is required for football analytics target listing."
    );
  });

  it("keeps unsafe remote databases blocked through shared readiness logic", async () => {
    const result = await checkDatabaseReadiness({
      databaseUrl: "postgres://user:secret@db.example.internal/sports_data",
      nodeEnv: "development",
      connect: async () => ({ tableNames: [] })
    });

    expect(result).toMatchObject({
      status: "not_ready",
      reason: "unsafe_target",
      target: {
        classification: "unknown"
      }
    });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("lists competitions in read-only mode", async () => {
    const dependencies = mockDependencies();

    const result = await runFootballTargetListing(baseOptions, dependencies);

    expect(dependencies.listTargets).toHaveBeenCalledWith(baseOptions);
    expect(result.competitions).toHaveLength(1);
    expect(result.teams).toBeUndefined();
    expect(result.matches).toBeUndefined();
  });

  it("lists teams and matches when a competition is selected", async () => {
    const options = { ...baseOptions, competitionId: "competition-1" };
    const result = await runFootballTargetListing(options, mockDependencies());

    expect(result.teams).toHaveLength(1);
    expect(result.matches).toHaveLength(1);
  });

  it("prints JSON only when --json is requested", async () => {
    const log = vi.fn();

    await runFootballTargetListing({ ...baseOptions, json: true }, mockDependencies({ log }));

    const output = log.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(output).toContain('"competitions"');
    expect(output).not.toContain("postgres://");
    expect(output).not.toContain("secret");
    expect(output).not.toContain("DATABASE_URL");
  });

  it("text output remains readable and redacted", async () => {
    const log = vi.fn();

    await runFootballTargetListing(baseOptions, mockDependencies({ log }));

    const output = log.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(output).toContain("Football analytics targets");
    expect(output).toContain("Bundesliga");
    expect(output).not.toContain("postgres://");
    expect(output).not.toContain("secret");
  });
});

function mockDependencies(overrides: Partial<FootballTargetListDependencies> = {}): FootballTargetListDependencies {
  return {
    listTargets: vi.fn().mockImplementation((options: FootballTargetListOptions) =>
      Promise.resolve({
        competitions: [
          {
            id: "competition-1",
            name: "Bundesliga",
            country: "Germany",
            teams_count: 18,
            matches_count: 9
          }
        ],
        teams: options.competitionId
          ? [
              {
                id: "team-1",
                name: "Example FC",
                logo_url: "https://example.test/logo.png",
                matches_count: 1
              }
            ]
          : undefined,
        matches: options.competitionId
          ? [
              {
                id: "match-1",
                scheduled_start_at: "2026-04-24T18:30:00.000Z",
                status: "finished",
                home_team: "Example FC",
                away_team: "Example SV"
              }
            ]
          : undefined,
        warnings: ["Read-only football analytics target listing. No provider calls, ingestion, analytics writes, or scheduler work were run."]
      })
    ),
    log: vi.fn(),
    ...overrides
  };
}
