import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  TeamProfileHero,
  TeamProfileStanding,
  TeamProfileFormSummary,
  TeamProfileGoalProfile,
  TeamProfileRecentMatches,
  TeamProfileUpcomingMatches,
  TeamProfileDataCoverage
} from "./App";
import type { FootballTeamProfileResponse } from "./types";

function fullProfile(patch: Partial<FootballTeamProfileResponse> = {}): FootballTeamProfileResponse {
  return {
    team: {
      id: "team-1",
      name: "Arsenal FC",
      logoUrl: "https://example.com/logo.png",
      country: "England",
      primaryCompetition: { id: "comp-1", name: "Premier League", country: "England" }
    },
    standing: {
      position: 1,
      played: 30,
      wins: 20,
      draws: 5,
      losses: 5,
      goalsFor: 60,
      goalsAgainst: 25,
      goalDifference: 35,
      points: 65
    },
    formSummary: {
      overall: {
        featureId: "f1",
        competitionId: "comp-1",
        windowSize: 5,
        scope: "overall",
        sampleSize: 5,
        coverageScore: 80,
        matchesPlayed: 5,
        wins: 4,
        draws: 0,
        losses: 1,
        points: 12,
        avgGoalsFor: 1.8,
        avgGoalsAgainst: 0.6,
        bothTeamsToScoreRate: 60,
        over05Rate: 100,
        over15Rate: 80,
        over25Rate: 40,
        under25Rate: 60,
        scoredRate: 80,
        concededRate: 40,
        teamOver05Rate: 100,
        teamOver15Rate: 60,
        firstHalfOver05Rate: 70,
        firstHalfAvgGoalsFor: 0.9,
        firstHalfAvgGoalsAgainst: 0.3
      },
      home: {
        featureId: "f2",
        competitionId: "comp-1",
        windowSize: 5,
        scope: "home",
        sampleSize: 3,
        coverageScore: 75,
        matchesPlayed: 3,
        wins: 3,
        draws: 0,
        losses: 0,
        points: 9,
        avgGoalsFor: 2.0,
        avgGoalsAgainst: 0.3,
        bothTeamsToScoreRate: 33,
        over05Rate: 100,
        over15Rate: 67,
        over25Rate: 33,
        under25Rate: 67,
        scoredRate: 100,
        concededRate: 33,
        teamOver05Rate: 100,
        teamOver15Rate: 67,
        firstHalfOver05Rate: 67,
        firstHalfAvgGoalsFor: 1.0,
        firstHalfAvgGoalsAgainst: 0.0
      },
      away: {
        featureId: "f3",
        competitionId: "comp-1",
        windowSize: 5,
        scope: "away",
        sampleSize: 2,
        coverageScore: 70,
        matchesPlayed: 2,
        wins: 1,
        draws: 0,
        losses: 1,
        points: 3,
        avgGoalsFor: 1.5,
        avgGoalsAgainst: 1.0,
        bothTeamsToScoreRate: 100,
        over05Rate: 100,
        over15Rate: 100,
        over25Rate: 50,
        under25Rate: 50,
        scoredRate: 50,
        concededRate: 50,
        teamOver05Rate: 100,
        teamOver15Rate: 50,
        firstHalfOver05Rate: 75,
        firstHalfAvgGoalsFor: 0.75,
        firstHalfAvgGoalsAgainst: 0.5
      }
    },
    goalProfile: {
      scoredRate: 100,
      concededRate: 80,
      teamOver05Rate: 100,
      teamOver15Rate: 60,
      under25Rate: 20,
      firstHalfOver05Rate: 100,
      firstHalfAvgGoalsFor: 1.2,
      firstHalfAvgGoalsAgainst: 0.2
    },
    recentMatches: [
      {
        matchId: "m1",
        date: "2026-04-28T18:30:00.000Z",
        competition: "Premier League",
        opponent: { id: "opp-1", name: "Chelsea FC", logoUrl: null },
        homeAway: "home",
        fulltimeScore: "3-1",
        halftimeScore: "2-0",
        result: "W"
      },
      {
        matchId: "m2",
        date: "2026-04-21T18:30:00.000Z",
        competition: "Premier League",
        opponent: { id: "opp-2", name: "Liverpool FC", logoUrl: null },
        homeAway: "away",
        fulltimeScore: "1-2",
        halftimeScore: "0-1",
        result: "W"
      },
      {
        matchId: "m4",
        date: "2026-04-14T18:30:00.000Z",
        competition: "Premier League",
        opponent: { id: "opp-4", name: "Everton FC", logoUrl: null },
        homeAway: "away",
        fulltimeScore: "2-1",
        halftimeScore: "1-1",
        result: "L"
      },
      {
        matchId: "m5",
        date: "2026-04-07T18:30:00.000Z",
        competition: "Premier League",
        opponent: { id: "opp-5", name: "Brentford FC", logoUrl: null },
        homeAway: "home",
        fulltimeScore: "1-1",
        halftimeScore: "0-0",
        result: "D"
      }
    ],
    upcomingMatches: [
      {
        matchId: "m3",
        date: "2026-05-05T18:30:00.000Z",
        competition: "Premier League",
        opponent: { id: "opp-3", name: "Man City", logoUrl: null },
        homeAway: "home",
        status: "scheduled",
        analysisStatus: "ready"
      }
    ],
    dataCoverage: {
      matchesAvailable: 30,
      scoresAvailable: 28,
      formCoverageScore: 80,
      hasStanding: true,
      hasLogo: true,
      playersAvailable: false,
      lineupsAvailable: false,
      injuriesAvailable: false
    },
    ...patch
  };
}

describe("TeamProfileHero", () => {
  it("renders team identity, logo, country and primary competition", () => {
    const html = renderToStaticMarkup(<TeamProfileHero profile={fullProfile()} standing={fullProfile().standing} />);
    expect(html).toContain("Arsenal FC");
    expect(html).toContain("England");
    expect(html).toContain("Premier League");
    expect(html).toContain("Sıra");
    expect(html).toContain("Puan");
    expect(html).toContain(">1<");
    expect(html).toContain(">65<");
  });

  it("shows fallback when primary competition is missing", () => {
    const html = renderToStaticMarkup(
      <TeamProfileHero
        profile={fullProfile({
          team: { id: "team-1", name: "Arsenal FC", logoUrl: null, country: null, primaryCompetition: null },
          dataCoverage: { ...fullProfile().dataCoverage, hasLogo: false }
        })}
        standing={null}
      />
    );
    expect(html).toContain("Futbol takımı");
    expect(html).toContain("Ülke bilgisi yok");
    expect(html).not.toContain("Sıra");
    expect(html).not.toContain("Puan");
  });
});

describe("TeamProfileStanding", () => {
  it("renders stats grid without header", () => {
    const html = renderToStaticMarkup(<TeamProfileStanding standing={fullProfile().standing} />);
    expect(html).toContain("Oynanan");
    expect(html).toContain("30");
    expect(html).toContain("Galibiyet");
    expect(html).toContain("20");
    expect(html).toContain("Beraberlik");
    expect(html).toContain("5");
    expect(html).toContain("Mağlubiyet");
    expect(html).toContain("Averaj");
    expect(html).toContain("35");
    expect(html).toContain("Puan");
    expect(html).toContain("65");
  });

  it("returns null when standing is null", () => {
    const html = renderToStaticMarkup(<TeamProfileStanding standing={null} />);
    expect(html).toBe("");
  });
});

describe("TeamProfileFormSummary", () => {
  it("renders overall, home, away form cards with Turkish labels", () => {
    const html = renderToStaticMarkup(<TeamProfileFormSummary formSummary={fullProfile().formSummary} />);
    expect(html).toContain("Form Özeti");
    expect(html).toContain("Genel form");
    expect(html).toContain("İç saha");
    expect(html).toContain("Deplasman");
    expect(html).toContain("Örneklem");
    expect(html).toContain("Kapsam");
    expect(html).toContain("Ortalama gol");
    expect(html).toContain("Yenen gol");
    expect(html).toContain("KG oranı");
    expect(html).toContain("2.5 üst");
    expect(html).toContain("60%");
    expect(html).toContain("40%");
    expect(html).not.toContain("6000%");
    expect(html).not.toContain("4000%");
  });

  it("handles missing form gracefully", () => {
    const html = renderToStaticMarkup(
      <TeamProfileFormSummary formSummary={{ overall: null, home: null, away: null }} />
    );
    expect(html).toContain("Form verisi bulunmuyor.");
  });
});

describe("TeamProfileGoalProfile", () => {
  it("renders goal profile with Turkish labels and percentages", () => {
    const html = renderToStaticMarkup(<TeamProfileGoalProfile goalProfile={fullProfile().goalProfile} />);
    expect(html).toContain("Gol Profili");
    expect(html).toContain("Gol bulma oranı");
    expect(html).toContain("Gol yeme oranı");
    expect(html).toContain("Takım 0.5 üst");
    expect(html).toContain("Takım 1.5 üst");
    expect(html).toContain("2.5 alt eğilimi");
    expect(html).toContain("İlk yarı 0.5 üst");
    expect(html).toContain("İlk yarı atılan gol");
    expect(html).toContain("İlk yarı yenilen gol");
    expect(html).toContain("100%");
    expect(html).toContain("80%");
    expect(html).toContain("60%");
    expect(html).toContain("20%");
    expect(html).toContain("1.20");
    expect(html).toContain("0.20");
    expect(html).not.toContain("10000%");
    expect(html).not.toContain("8000%");
    expect(html).not.toContain("6000%");
    expect(html).not.toContain("2000%");
  });

  it("shows fallback when all values are null", () => {
    const html = renderToStaticMarkup(
      <TeamProfileGoalProfile
        goalProfile={{ scoredRate: null, concededRate: null, teamOver05Rate: null, teamOver15Rate: null, under25Rate: null, firstHalfOver05Rate: null, firstHalfAvgGoalsFor: null, firstHalfAvgGoalsAgainst: null }}
      />
    );
    expect(html).toContain("Gol profili verisi bulunmuyor.");
  });

  it("does not show raw field names", () => {
    const html = renderToStaticMarkup(<TeamProfileGoalProfile goalProfile={fullProfile().goalProfile} />);
    expect(html).not.toContain("scoredRate");
    expect(html).not.toContain("concededRate");
    expect(html).not.toContain("teamOver05Rate");
    expect(html).not.toContain("under25Rate");
    expect(html).not.toContain("firstHalfOver05Rate");
    expect(html).not.toContain("firstHalfAvgGoalsFor");
    expect(html).not.toContain("firstHalfAvgGoalsAgainst");
  });
});

describe("TeamProfileRecentMatches", () => {
  it("renders recent matches with opponent, score, result labels in Turkish", () => {
    const html = renderToStaticMarkup(<TeamProfileRecentMatches matches={fullProfile().recentMatches} />);
    expect(html).toContain("Son Maçlar");
    expect(html).toContain("Chelsea FC");
    expect(html).toContain("Liverpool FC");
    expect(html).toContain("Everton FC");
    expect(html).toContain("Brentford FC");
    expect(html).toContain("Galibiyet");
    expect(html).toContain("Mağlubiyet");
    expect(html).toContain("Beraberlik");
    expect(html).toContain("3-1");
    expect(html).toContain("1-2");
    expect(html).toContain("2-1");
    expect(html).toContain("1-1");
    expect(html).toContain("İç saha");
    expect(html).toContain("Deplasman");
    expect(html).toContain("İY 2-0");
    expect(html).toContain("İY 0-1");
  });

  it("shows fallback when no recent matches", () => {
    const html = renderToStaticMarkup(<TeamProfileRecentMatches matches={[]} />);
    expect(html).toContain("Son maç kaydı bulunmuyor.");
  });
});

describe("TeamProfileUpcomingMatches", () => {
  it("renders upcoming matches with status and analysis status", () => {
    const html = renderToStaticMarkup(<TeamProfileUpcomingMatches matches={fullProfile().upcomingMatches} navigate={vi.fn()} />);
    expect(html).toContain("Yaklaşan Maçlar");
    expect(html).toContain("Man City");
    expect(html).toContain("İç saha");
    expect(html).toContain("scheduled");
    expect(html).toContain("Hazır");
    expect(html).toContain("Analiz");
  });

  it("shows fallback when no upcoming matches", () => {
    const html = renderToStaticMarkup(<TeamProfileUpcomingMatches matches={[]} navigate={vi.fn()} />);
    expect(html).toContain("Yaklaşan maç bulunmuyor.");
  });
});

describe("TeamProfileDataCoverage", () => {
  it("renders data coverage with available/unavailable badges", () => {
    const html = renderToStaticMarkup(<TeamProfileDataCoverage coverage={fullProfile().dataCoverage} />);
    expect(html).toContain("Veri Durumu");
    expect(html).toContain("Maç verisi");
    expect(html).toContain("Mevcut (30)");
    expect(html).toContain("Skor verisi");
    expect(html).toContain("Mevcut (28)");
    expect(html).toContain("Puan durumu");
    expect(html).toContain("Mevcut");
    expect(html).toContain("Form kapsamı");
    expect(html).toContain("Logo");
    expect(html).toContain("Oyuncu verisi yakında");
    expect(html).toContain("Kadro verisi yakında");
    expect(html).toContain("Sakatlık verisi yakında");
  });
});

describe("TeamProfile no betting language", () => {
  it("does not render betting language anywhere", () => {
    const profile = fullProfile();
    const html = renderToStaticMarkup(
      <>
        <TeamProfileHero profile={profile} standing={profile.standing} />
        <TeamProfileStanding standing={profile.standing} />
        <TeamProfileFormSummary formSummary={profile.formSummary} />
        <TeamProfileGoalProfile goalProfile={profile.goalProfile} />
        <TeamProfileRecentMatches matches={profile.recentMatches} />
        <TeamProfileUpcomingMatches matches={profile.upcomingMatches} navigate={vi.fn()} />
        <TeamProfileDataCoverage coverage={profile.dataCoverage} />
      </>
    );
    expect(html.toLocaleLowerCase("tr-TR")).not.toContain("bahis");
    expect(html.toLocaleLowerCase("tr-TR")).not.toContain("banko");
    expect(html.toLocaleLowerCase("tr-TR")).not.toContain("kesin kazanır");
  });
});
