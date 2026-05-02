import { describe, expect, it } from "vitest";
import { buildUnresolvedDiagnostics, classifyUnresolvedEvent, parseFinishedSyncArgs } from "./provider-football-finished-sync.js";

describe("football finished-score sync diagnostics", () => {
  it("parses verbose dry-run options without enabling execute", () => {
    expect(parseFinishedSyncArgs(["--all-reviewed-enabled", "--lookback-hours=72", "--verbose"])).toMatchObject({
      execute: false,
      allReviewedEnabled: true,
      lookbackHours: 72,
      verbose: true
    });
  });

  it("classifies live numeric statuses as safe unresolved rows", () => {
    expect(
      classifyUnresolvedEvent("5", "207", "events", {
        match_id: "615673",
        league_id: "207",
        match_status: "18",
        match_live: "1",
        match_hometeam_id: "1",
        match_awayteam_id: "2",
        match_hometeam_name: "Home",
        match_awayteam_name: "Away",
        match_hometeam_score: "1",
        match_awayteam_score: "0"
      })
    ).toMatchObject({
      providerEventId: "615673",
      rawStatus: "18",
      canonicalStatusDecision: "unsupported",
      reason: "live_numeric_status",
      scoreFieldPresence: {
        fulltimePresent: false,
        halftimePresent: false
      }
    });
  });

  it("keeps After Pen. as an unsupported non-standard status", () => {
    expect(
      classifyUnresolvedEvent("82", "244", "scores", {
        match_id: "after-pen",
        league_id: "244",
        match_status: "After Pen.",
        match_hometeam_id: "1",
        match_awayteam_id: "2",
        match_hometeam_name: "Waalwijk",
        match_awayteam_name: "Roda",
        match_hometeam_score: "1",
        match_awayteam_score: "1",
        match_hometeam_halftime_score: "0",
        match_awayteam_halftime_score: "0"
      })
    ).toMatchObject({
      providerEventId: "after-pen",
      matchLabel: "Waalwijk vs Roda",
      rawStatus: "After Pen.",
      canonicalStatusDecision: "unsupported",
      reason: "after_pen",
      scoreFieldPresence: {
        fulltimePresent: false,
        halftimePresent: true
      }
    });
  });

  it("classifies live label statuses as not final", () => {
    expect(
      classifyUnresolvedEvent("5", "207", "events", {
        match_id: "half-time",
        league_id: "207",
        match_status: "Half Time",
        match_hometeam_id: "1",
        match_awayteam_id: "2",
        match_hometeam_score: "1",
        match_awayteam_score: "0",
        match_hometeam_halftime_score: "1",
        match_awayteam_halftime_score: "0"
      })
    ).toMatchObject({
      canonicalStatusDecision: "unsupported",
      reason: "match_not_finished",
      scoreFieldPresence: {
        fulltimePresent: false,
        halftimePresent: true
      }
    });
  });

  it("classifies final rows with missing score as missing_score", () => {
    expect(
      classifyUnresolvedEvent("44", "152", "scores", {
        match_id: "missing-score",
        league_id: "152",
        match_status: "Finished",
        match_hometeam_id: "1",
        match_awayteam_id: "2"
      })
    ).toMatchObject({
      canonicalStatusDecision: "finished",
      reason: "missing_score",
      scoreFieldPresence: {
        fulltimePresent: false,
        halftimePresent: false
      }
    });
  });

  it("builds diagnostics only for raw rows that did not map", () => {
    const diagnostics = buildUnresolvedDiagnostics("44", "152", [
      {
        operation: "events",
        result: {
          data: [{ providerEntityId: "mapped-match" }],
          rawPayload: [
            { match_id: "mapped-match", match_status: "Finished", match_hometeam_id: "1", match_awayteam_id: "2" },
            { match_id: "unmapped-match", league_id: "152", match_status: "18", match_live: "1", match_hometeam_id: "1", match_awayteam_id: "2" }
          ],
          metadata: {}
        }
      }
    ]);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      operation: "events",
      providerEventId: "unmapped-match",
      reason: "live_numeric_status"
    });
  });
});
