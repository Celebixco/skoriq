import { describe, expect, it, vi } from "vitest";
import { FootballMatchPredictionFeatureBuilder, calculateFootballMatchPredictionFeature } from "./football-match-prediction-feature-builder.js";
import type {
  FootballMatchPredictionFeatureInput,
  FootballMatchPredictionFeatureRepository,
  FootballMatchPredictionSourceRepository,
  FootballPredictionH2HFeature,
  FootballPredictionMatch,
  FootballPredictionTeamFormFeature
} from "./football-match-prediction-feature-builder.js";

const match: FootballPredictionMatch = {
  id: "match-1",
  competitionId: "competition-1",
  seasonId: null,
  scheduledStartAt: new Date("2026-04-24T18:30:00.000Z"),
  status: "scheduled",
  homeTeamId: "team-home",
  awayTeamId: "team-away"
};

const homeForm: FootballPredictionTeamFormFeature = {
  id: "home-form-1",
  teamId: "team-home",
  competitionId: "competition-1",
  seasonId: null,
  asOfMatchId: "match-1",
  asOfDate: match.scheduledStartAt,
  windowSize: 5,
  scope: "home",
  points: 11,
  avgGoalsFor: 2.2,
  avgGoalsAgainst: 0.8,
  scoredRate: 80,
  concededRate: 60,
  teamOver05Rate: 80,
  teamOver15Rate: 80,
  under25Rate: 40,
  firstHalfOver05Rate: 100,
  firstHalfAvgGoalsFor: 1,
  firstHalfAvgGoalsAgainst: 0.6,
  avgExpectedGoals: 1.9,
  standingsPosition: 2,
  standingsPoints: 62,
  standingsGoalDifference: 28,
  sampleSize: 5,
  coverageScore: 90
};

const awayForm: FootballPredictionTeamFormFeature = {
  id: "away-form-1",
  teamId: "team-away",
  competitionId: "competition-1",
  seasonId: null,
  asOfMatchId: "match-1",
  asOfDate: match.scheduledStartAt,
  windowSize: 5,
  scope: "away",
  points: 7,
  avgGoalsFor: 1.1,
  avgGoalsAgainst: 1.6,
  scoredRate: 50,
  concededRate: 75,
  teamOver05Rate: 50,
  teamOver15Rate: 25,
  under25Rate: 50,
  firstHalfOver05Rate: 25,
  firstHalfAvgGoalsFor: 0,
  firstHalfAvgGoalsAgainst: 0.25,
  standingsPosition: 8,
  standingsPoints: 41,
  standingsGoalDifference: 2,
  sampleSize: 5,
  coverageScore: 80
};

const h2h: FootballPredictionH2HFeature = {
  id: "h2h-1",
  teamAId: "team-away",
  teamBId: "team-home",
  competitionId: "competition-1",
  seasonId: null,
  asOfMatchId: "match-1",
  asOfDate: match.scheduledStartAt,
  windowSize: 5,
  avgTotalGoals: 3.1,
  bothTeamsToScoreRate: 60,
  over25Rate: 70,
  sampleSize: 5,
  coverageScore: 70
};

describe("football match prediction feature builder", () => {
  it("builds a ready feature from home form, away form, and H2H", () => {
    const feature = calculateFootballMatchPredictionFeature({
      match,
      homeForm,
      awayForm,
      h2h,
      formWindowSize: 5,
      h2hWindowSize: 5
    });

    expect(feature).toMatchObject({
      matchId: "match-1",
      homeFormFeatureId: "home-form-1",
      awayFormFeatureId: "away-form-1",
      h2hFeatureId: "h2h-1",
      combinedCoverageScore: 82,
      featureStatus: "ready",
      homeRecentPoints: 11,
      awayRecentPoints: 7,
      homeAttackStrengthProxy: 1.9,
      awayAttackStrengthProxy: 1.1,
      standingsPositionDiff: -6,
      standingsPointsDiff: 21,
      standingsGoalDifferenceDiff: 26,
      h2hAvgTotalGoals: 3.1,
      h2hBttsRate: 60,
      h2hOver25Rate: 70,
      expectedHomeGoalsProxy: 2.215,
      expectedAwayGoalsProxy: 1.39,
      expectedTotalGoalsProxy: 3.605,
      homeGoalSignalScore: 78,
      awayGoalSignalScore: 47.75,
      firstHalfGoalSignalScore: 62.5,
      bttsSignalScore: 57.88,
      goalProfile: "high_goal",
      firstHalfGoalProfile: "unknown",
      bttsProfile: "balanced",
      homeTeamGoalProfile: "strong",
      awayTeamGoalProfile: "moderate"
    });
    expect(feature.metadataJson).toMatchObject({
      goalProfileFormulaVersion: 1,
      goalProfileInputs: {
        home: {
          scoredRate: 80,
          concededRate: 60,
          teamOver05Rate: 80,
          teamOver15Rate: 80,
          firstHalfOver05Rate: 100
        },
        away: {
          scoredRate: 50,
          concededRate: 75,
          teamOver05Rate: 50,
          teamOver15Rate: 25,
          firstHalfOver05Rate: 25
        }
      }
    });
  });

  it("keeps match-level goal profiles unknown when goal inputs are missing", () => {
    const feature = calculateFootballMatchPredictionFeature({
      match,
      homeForm: {
        ...homeForm,
        scoredRate: undefined,
        concededRate: undefined,
        teamOver05Rate: undefined,
        teamOver15Rate: undefined,
        firstHalfOver05Rate: undefined
      },
      awayForm: {
        ...awayForm,
        scoredRate: undefined,
        concededRate: undefined,
        teamOver05Rate: undefined,
        teamOver15Rate: undefined,
        firstHalfOver05Rate: undefined
      },
      h2h,
      formWindowSize: 5,
      h2hWindowSize: 5
    });

    expect(feature.expectedHomeGoalsProxy).toBeUndefined();
    expect(feature.expectedAwayGoalsProxy).toBeUndefined();
    expect(feature.expectedTotalGoalsProxy).toBeUndefined();
    expect(feature.homeGoalSignalScore).toBeUndefined();
    expect(feature.awayGoalSignalScore).toBeUndefined();
    expect(feature.firstHalfGoalSignalScore).toBeUndefined();
    expect(feature.bttsSignalScore).toBeUndefined();
    expect(feature.goalProfile).toBe("unknown");
    expect(feature.firstHalfGoalProfile).toBe("unknown");
    expect(feature.bttsProfile).toBe("unknown");
    expect(feature.homeTeamGoalProfile).toBe("unknown");
    expect(feature.awayTeamGoalProfile).toBe("unknown");
  });

  it("assigns low goal profiles when both team goal signals are weak", () => {
    const feature = calculateFootballMatchPredictionFeature({
      match,
      homeForm: { ...homeForm, scoredRate: 25, concededRate: 20, teamOver05Rate: 25, teamOver15Rate: 5, firstHalfOver05Rate: 20 },
      awayForm: { ...awayForm, scoredRate: 20, concededRate: 25, teamOver05Rate: 20, teamOver15Rate: 5, firstHalfOver05Rate: 20 },
      h2h,
      formWindowSize: 5,
      h2hWindowSize: 5
    });

    expect(feature.goalProfile).toBe("low_goal");
    expect(feature.homeTeamGoalProfile).toBe("weak");
    expect(feature.awayTeamGoalProfile).toBe("weak");
    expect(feature.firstHalfGoalProfile).toBe("low_goal");
    expect(feature.bttsProfile).toBe("no_lean");
  });

  it("assigns medium goal profiles for moderate expected total goals", () => {
    const feature = calculateFootballMatchPredictionFeature({
      match,
      homeForm: { ...homeForm, scoredRate: 55, concededRate: 50, teamOver05Rate: 55, teamOver15Rate: 25, firstHalfOver05Rate: 50, firstHalfAvgGoalsAgainst: 0 },
      awayForm: { ...awayForm, scoredRate: 55, concededRate: 50, teamOver05Rate: 55, teamOver15Rate: 25, firstHalfOver05Rate: 50, firstHalfAvgGoalsAgainst: 0 },
      h2h,
      formWindowSize: 5,
      h2hWindowSize: 5
    });

    expect(feature.goalProfile).toBe("medium_goal");
    expect(feature.homeTeamGoalProfile).toBe("moderate");
    expect(feature.awayTeamGoalProfile).toBe("moderate");
    expect(feature.firstHalfGoalProfile).toBe("unknown");
    expect(feature.bttsProfile).toBe("balanced");
  });

  it("keeps first-half and BTTS profiles cautious for Dortmund/Freiburg-like mixed evidence", () => {
    const feature = calculateFootballMatchPredictionFeature({
      match,
      homeForm,
      awayForm,
      h2h,
      formWindowSize: 5,
      h2hWindowSize: 5
    });

    expect(feature.homeGoalSignalScore).toBeGreaterThan(feature.awayGoalSignalScore ?? 0);
    expect(feature.homeTeamGoalProfile).toBe("strong");
    expect(feature.awayTeamGoalProfile).toBe("moderate");
    expect(feature.goalProfile).toBe("high_goal");
    expect(feature.firstHalfGoalProfile).toBe("unknown");
    expect(feature.bttsProfile).toBe("balanced");
  });

  it("marks missing H2H as ready when team form samples and coverage are strong", () => {
    const feature = calculateFootballMatchPredictionFeature({
      match,
      homeForm,
      awayForm,
      formWindowSize: 5,
      h2hWindowSize: 5
    });

    expect(feature.featureStatus).toBe("ready");
    expect(feature.combinedCoverageScore).toBe(85);
    expect(feature.h2hFeatureId).toBeUndefined();
    expect(feature.metadataJson).toMatchObject({
      coverageFormula: "team_form_only_h2h_missing",
      h2hMissing: true,
      confidenceCapReason: "missing_h2h"
    });
  });

  it("marks zero-sample H2H as ready when team form samples and coverage are strong", () => {
    const feature = calculateFootballMatchPredictionFeature({
      match,
      homeForm,
      awayForm,
      h2h: { ...h2h, sampleSize: 0, coverageScore: 0 },
      formWindowSize: 5,
      h2hWindowSize: 5
    });

    expect(feature.featureStatus).toBe("ready");
    expect(feature.combinedCoverageScore).toBe(85);
    expect(feature.metadataJson).toMatchObject({
      coverageFormula: "team_form_only_h2h_missing",
      h2hMissing: true,
      confidenceCapReason: "missing_h2h"
    });
  });

  it("marks low-sample form with moderate coverage as partial", () => {
    const feature = calculateFootballMatchPredictionFeature({
      match,
      homeForm: { ...homeForm, sampleSize: 2, coverageScore: 40 },
      awayForm: { ...awayForm, sampleSize: 2, coverageScore: 40 },
      h2h: { ...h2h, sampleSize: 0, coverageScore: 0 },
      formWindowSize: 5,
      h2hWindowSize: 5
    });

    expect(feature.featureStatus).toBe("partial");
    expect(feature.combinedCoverageScore).toBe(40);
  });

  it("marks low-sample form with low-but-usable coverage as partial", () => {
    const feature = calculateFootballMatchPredictionFeature({
      match,
      homeForm: { ...homeForm, sampleSize: 1, coverageScore: 22 },
      awayForm: { ...awayForm, sampleSize: 1, coverageScore: 22 },
      h2h: { ...h2h, sampleSize: 0, coverageScore: 0 },
      formWindowSize: 5,
      h2hWindowSize: 5
    });

    expect(feature.featureStatus).toBe("partial");
    expect(feature.combinedCoverageScore).toBe(22);
  });

  it("marks very low team-form-only coverage as insufficient data", () => {
    const feature = calculateFootballMatchPredictionFeature({
      match,
      homeForm: { ...homeForm, sampleSize: 1, coverageScore: 18 },
      awayForm: { ...awayForm, sampleSize: 1, coverageScore: 18 },
      h2h: { ...h2h, sampleSize: 0, coverageScore: 0 },
      formWindowSize: 5,
      h2hWindowSize: 5
    });

    expect(feature.featureStatus).toBe("insufficient_data");
    expect(feature.combinedCoverageScore).toBe(18);
  });

  it("marks mostly missing source features as insufficient data", () => {
    const feature = calculateFootballMatchPredictionFeature({
      match,
      formWindowSize: 5,
      h2hWindowSize: 5
    });

    expect(feature.featureStatus).toBe("insufficient_data");
    expect(feature.combinedCoverageScore).toBe(0);
  });

  it("buildForMatch resolves sources and upserts idempotent key payload", async () => {
    const upsertFeature = vi.fn();
    const sources: FootballMatchPredictionSourceRepository = {
      findMatchById: vi.fn().mockResolvedValue(match),
      findBestTeamFormFeature: vi.fn().mockResolvedValueOnce(homeForm).mockResolvedValueOnce(awayForm),
      findBestHeadToHeadFeature: vi.fn().mockResolvedValue(h2h)
    };
    const features: FootballMatchPredictionFeatureRepository = { upsertFeature };
    const builder = new FootballMatchPredictionFeatureBuilder({ sources, features });

    const result = await builder.buildForMatch("match-1", { formWindowSize: 5, h2hWindowSize: 5 });

    expect(result.changedFeatureRows).toBe(1);
    expect(sources.findBestTeamFormFeature).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ teamId: "team-home", scope: "home", seasonId: null, windowSize: 5 })
    );
    expect(sources.findBestTeamFormFeature).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ teamId: "team-away", scope: "away", seasonId: null, windowSize: 5 })
    );
    expect(sources.findBestHeadToHeadFeature).toHaveBeenCalledWith(expect.objectContaining({ teamAId: "team-away", teamBId: "team-home" }));
    expect(upsertFeature).toHaveBeenCalledWith(expect.objectContaining<Partial<FootballMatchPredictionFeatureInput>>({ matchId: "match-1", featureStatus: "ready" }));
  });

  it("returns a skipped result when the match is missing", async () => {
    const builder = new FootballMatchPredictionFeatureBuilder({
      sources: {
        findMatchById: vi.fn().mockResolvedValue(undefined),
        findBestTeamFormFeature: vi.fn(),
        findBestHeadToHeadFeature: vi.fn()
      },
      features: { upsertFeature: vi.fn() }
    });

    await expect(builder.buildForMatch("missing-match")).resolves.toMatchObject({
      changedFeatureRows: 0,
      skippedReason: 'match "missing-match" not found'
    });
  });
});
