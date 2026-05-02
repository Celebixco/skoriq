import { describe, expect, it } from "vitest";
import { parseAPIFootballH2HEvidenceArgs, resolveH2HTarget, summarizeH2HPayload } from "./provider-apifootball-h2h-evidence.js";

describe("APIFootball H2H evidence dry-run helpers", () => {
  it("parses required match id", () => {
    expect(parseAPIFootballH2HEvidenceArgs(["--match-id=12acd83e-ca54-4444-9c67-a03cfbc70bcf"])).toEqual({
      matchId: "12acd83e-ca54-4444-9c67-a03cfbc70bcf"
    });
  });

  it("summarizes APIFootball v3 H2H payload without raw body exposure", () => {
    const result = summarizeH2HPayload(
      {
        firstTeam_VS_secondTeam: [
          {
            match_id: "1001",
            match_date: "2026-01-01",
            match_status: "Finished",
            match_hometeam_id: "141",
            match_hometeam_name: "Arsenal FC",
            match_hometeam_score: "2",
            match_awayteam_id: "126",
            match_awayteam_name: "Fulham",
            match_awayteam_score: "1",
            match_hometeam_halftime_score: "1",
            match_awayteam_halftime_score: "0"
          }
        ],
        firstTeam_lastResults: [
          {
            match_id: "ignored-team-form-row"
          }
        ]
      },
      { homeProviderTeamId: "141", awayProviderTeamId: "126" },
      "events"
    );

    expect(result).toMatchObject({
      providerAction: "get_H2H",
      credentialLabel: "events",
      recordsFetchedCount: 1,
      stableH2HMatchIdsCount: 1,
      stableHomeAwayTeamIdsCount: 1,
      fulltimeScoreFieldsPresentCount: 1,
      halftimeScoreFieldsPresentCount: 1,
      mappedCanonicalTeamReferencesPossible: true,
      unresolvedRowsCount: 0,
      cleanEnoughForFutureExecute: true
    });
    expect(JSON.stringify(result)).not.toContain("ignored-team-form-row");
  });

  it("reports unresolved rows instead of fabricating mappings", () => {
    const result = summarizeH2HPayload(
      {
        firstTeam_VS_secondTeam: [
          {
            match_id: "1002",
            match_date: "2026-01-01",
            match_hometeam_id: "999",
            match_hometeam_name: "Other",
            match_hometeam_score: "x",
            match_awayteam_id: "126",
            match_awayteam_name: "Fulham",
            match_awayteam_score: "1"
          }
        ]
      },
      { homeProviderTeamId: "141", awayProviderTeamId: "126" },
      "events"
    );

    expect(result.recordsFetchedCount).toBe(1);
    expect(result.unresolvedRowsCount).toBe(1);
    expect(result.cleanEnoughForFutureExecute).toBe(false);
    expect(result.records[0]?.canonicalTeamsMappable).toBe(false);
    expect(result.records[0]?.fulltimeScoreParseable).toBe(false);
  });

  it("resolves canonical and provider IDs from existing mappings", async () => {
    const queryable = {
      query: async () => ({
        rows: [
          {
            match_id: "match-1",
            competition_id: "competition-1",
            competition_name: "Premier League",
            home_team_id: "home-1",
            away_team_id: "away-1",
            home_team_name: "Arsenal FC",
            away_team_name: "Fulham",
            kickoff_at: new Date("2026-05-02T18:30:00.000Z"),
            home_provider_team_id: "141",
            away_provider_team_id: "126",
            provider_match_id: "617999"
          }
        ]
      })
    };

    await expect(resolveH2HTarget(queryable, "match-1")).resolves.toMatchObject({
      matchId: "match-1",
      homeTeamName: "Arsenal FC",
      awayTeamName: "Fulham",
      homeProviderTeamId: "141",
      awayProviderTeamId: "126",
      providerMatchId: "617999"
    });
  });
});
