import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MatchDetailReportView, MemberPredictionPreviewErrorNotice, MemberPredictionPreviewSection, PredictionPreviewErrorNotice, PredictionPreviewSection } from "./App";
import type { AuthUser, FootballAnalyticsMatchReport, FootballMatchPredictionDraftsResponse, FootballPredictionDraftListItem, FootballMemberPredictionPreviewResponse } from "./types";

const memberUser: AuthUser = {
  id: "member-1",
  email: "member@example.test",
  role: "member",
  status: "active"
};

const adminUser: AuthUser = {
  ...memberUser,
  id: "admin-1",
  email: "admin@example.test",
  role: "admin"
};

function renderReport(report: FootballAnalyticsMatchReport, user: AuthUser = memberUser) {
  return renderToStaticMarkup(<MatchDetailReportView report={report} matchId={report.match.matchId} user={user} navigate={vi.fn()} availability={[]} />);
}

function mockReport(patch: Partial<FootballAnalyticsMatchReport> = {}): FootballAnalyticsMatchReport {
  return {
    match: {
      matchId: "match-dynamic-1",
      competition: { id: "competition-1", name: "Dynamic League", country: "TR" },
      kickoffAt: "2026-05-02T18:30:00.000Z",
      status: "scheduled",
      homeTeam: { id: "home-1", name: "Ankara Kuzey", logoUrl: "https://img.example.test/ankara.png" },
      awayTeam: { id: "away-1", name: "Izmir Güney", logoUrl: null }
    },
    featureStatus: "ready",
    predictionEligible: true,
    kuponEligible: false,
    hasPredictionPreview: false,
    confidenceCeiling: 63,
    combinedCoverageScore: 72,
    homeForm: {
      sampleSize: 9,
      coverageScore: 71,
      scope: "home",
      windowSize: 10
    },
    awayForm: {
      sampleSize: 8,
      coverageScore: 68,
      scope: "away",
      windowSize: 10
    },
    h2h: {
      sampleSize: 2,
      coverageScore: 33,
      h2hMissing: false
    },
    positiveSignals: ["Ev sahibi son maçlarda üretken"],
    riskFactors: ["Deplasman örneklemi sınırlı"],
    missingDataWarnings: ["H2H pencere verisi düşük"],
    summary: "Dinamik rapor özeti.",
    ...patch
  };
}

function mockDraft(overrides: Partial<FootballPredictionDraftListItem> = {}): FootballPredictionDraftListItem {
  const report = mockReport();
  return {
    predictionId: "draft-1",
    matchId: report.match.matchId,
    match: report.match,
    predictionType: "over_under_goals",
    predictionValue: "over_2_5",
    predictionFamily: "goals",
    recommendationTier: "try",
    displayLabel: "Gol üst adayı",
    confidenceScore: 64,
    confidenceCeiling: 65,
    riskLevel: "medium",
    status: "draft",
    consistencyStatus: "passed",
    conflictCount: 0,
    blockingConflictCount: 0,
    warningConflictCount: 0,
    reasoningSummary: "Dinamik taslak gerekçesi.",
    generatedAt: "2026-04-30T12:00:00.000Z",
    createdAt: "2026-04-30T12:00:00.000Z",
    ...overrides
  };
}

function mockDraftResponse(): FootballMatchPredictionDraftsResponse {
  const report = mockReport();
  return {
    match: report.match,
    outputsByRecommendationTier: {
      primary: { label: "Tahminim", items: [] },
      try: {
        label: "Denenir",
        items: [
          mockDraft({ predictionId: "draft-over", predictionType: "over_under_goals", predictionValue: "over_2_5", confidenceScore: 64 }),
          mockDraft({ predictionId: "draft-first-half", predictionType: "first_half_over_0_5", predictionValue: "over_0_5", confidenceScore: 62.17 })
        ]
      },
      alternative: { label: "Alternatif", items: [] },
      avoid: { label: "Uzak Dur", items: [] }
    },
    conflictsSummary: { total: 0, blocking: 0, warning: 0, info: 0 },
    memberVisible: false,
    note: "Salt okunur taslak yanıtı."
  };
}

function mockMemberPreviewResponse(): FootballMemberPredictionPreviewResponse {
  return {
    matchId: "match-dynamic-1",
    status: "available",
    reasonCode: "available",
    message: "Bu maç için SkorIQ ön tahmin yorumu hazır.",
    analysisWindow: { status: "within_window", windowHours: 36, minimumLeadMinutes: 30 },
    groups: {
      primary: [],
      try: [
        {
          predictionId: "preview-over",
          displayLabel: "Denenir",
          predictionType: "over_under_goals",
          predictionValue: "over_2_5",
          recommendationTier: "try",
          confidenceScore: 64,
          riskLevel: "medium",
          reasoningSummary: "Gol profili güçlü.",
          generatedAt: "2026-05-01T10:00:00.000Z",
          kickoffAt: "2026-05-01T18:30:00.000Z",
          isFresh: true,
          analysisWindowStatus: "within_window"
        }
      ],
      alternative: []
    },
    summary: "SkorIQ ön tahmin özeti.",
    warnings: ["Veri kapsamı sınırlı alanlar içeriyor."]
  };
}

describe("MatchDetailReportView", () => {
  it("renders dynamic team names and logos from the API report", () => {
    const html = renderReport(mockReport());

    expect(html).toContain("Ev sahibi");
    expect(html).toContain("Deplasman");
    expect(html).toContain("VS");
    expect(html).toContain("Ankara Kuzey");
    expect(html).toContain("Izmir Güney");
    expect(html).toContain("Dynamic League");
    expect(html).toContain("https://img.example.test/ankara.png");
    expect(html).toContain("IG");
    expect(html).not.toContain("Bayer Leverkusen");
    expect(html).not.toContain("RB Leipzig");
  });

  it("renders dynamic KPI and coverage values", () => {
    const html = renderReport(mockReport());

    expect(html).toContain("Analiz Durumu");
    expect(html).toContain("Tahmine Uygunluk");
    expect(html).toContain("Güven Tavanı");
    expect(html).toContain("Veri Kapsamı");
    expect(html).toContain("63");
    expect(html).toContain("72%");
    expect(html).toContain("Örneklem: 9");
    expect(html).toContain("Örneklem: 8");
    expect(html).toContain("Örneklem: 2");
    expect(html).toContain("Kapsam: İç saha");
    expect(html).toContain("Kapsam: Dış saha");
    expect(html).toContain("Son 10 maç");
    expect(html).not.toContain("Kapsam home");
    expect(html).not.toContain("Kapsam away");
    expect(html).not.toContain("Sample");
    expect(html).not.toContain("Scope");
    expect(html).not.toContain("Window");
    expect(html).not.toContain("Head-to-head");
  });

  it("hides goal profile when the API report does not include goal fields", () => {
    const html = renderReport(mockReport());

    expect(html).not.toContain("Gol profili");
    expect(html).not.toContain("Toplam gol proxy");
    expect(html).not.toContain("possession");
    expect(html).not.toContain("shots");
  });

  it("renders signals, risks, missing data, and required report copy dynamically", () => {
    const html = renderReport(mockReport());

    expect(html).toContain("Bu bir maç analizi raporudur, nihai tahmin değildir.");
    expect(html).toContain("Güven skoru kazanma olasılığı değildir.");
    expect(html).toContain("Tahmin üretimi ve public yayın ayrı kontrollü süreçlerdir.");
    expect(html).toContain("Ev sahibi son maçlarda üretken");
    expect(html).toContain("Deplasman örneklemi sınırlı");
    expect(html).toContain("H2H pencere verisi düşük");
    expect(html).toContain("Analiz Özeti");
    expect(html).toContain("Dinamik rapor özeti.");
  });

  it("formats raw English summary and system messages into Turkish copy", () => {
    const html = renderReport(
      mockReport({
        h2h: { sampleSize: 0, coverageScore: 0, h2hMissing: true },
        positiveSignals: ["Minimum MVP feature readiness is satisfied."],
        riskFactors: ["Head-to-head history is missing or zero-sample, reducing confidence ceiling."],
        missingDataWarnings: ["Head-to-head sample is unavailable for this match."],
        summary: "Feature readiness is ready; team-form coverage is sufficient but head-to-head history is missing."
      })
    );

    expect(html).toContain("Bu maç analiz için hazır görünüyor.");
    expect(html).toContain("Takımlar arası geçmiş veri eksik olduğu için sistem daha temkinli davranıyor.");
    expect(html).toContain("Minimum analiz veri eşiği sağlandı.");
    expect(html).toContain("Takımlar arası geçmiş veri eksik olduğu için güven sınırı düşürüldü.");
    expect(html).toContain("Bu eşleşme için yeterli H2H örneklemi bulunmuyor.");
    expect(html).toContain("Bu eşleşme için yeterli H2H verisi yok");
    expect(html).not.toContain("Feature readiness");
    expect(html).not.toContain("Minimum MVP");
    expect(html).not.toContain("Head-to-head history");
  });

  it("hides admin review links from members and shows them for admins", () => {
    const report = mockReport();
    const memberHtml = renderReport(report, memberUser);
    const adminHtml = renderReport(report, adminUser);

    expect(memberHtml).not.toContain(`/football/matches/${report.match.matchId}/prediction-drafts`);
    expect(memberHtml).not.toContain("Taslakları gör");
    expect(memberHtml).not.toContain("Bu alan yalnızca iç denetim içindir.");
    expect(adminHtml).toContain("Taslakları gör");
    expect(adminHtml).toContain("Sonuçları gör");
    expect(adminHtml).toContain("Public uygunluğu gör");
    expect(adminHtml).toContain("Bu alan yalnızca iç denetim içindir.");
    expect(adminHtml).toContain("SkorIQ Tahmin Yorumu");
  });

  it("shows member-safe prediction preview shell on the analytics report", () => {
    const html = renderReport(mockReport(), memberUser);

    expect(html).toContain("SkorIQ Tahmin Yorumu");
    expect(html).not.toContain("MS 2.5 Üst");
    expect(html).not.toContain("İY 0.5 Üst");
    expect(html).not.toContain("Taslakları gör");
  });

  it("renders member-safe prediction preview without internal draft details", () => {
    const html = renderToStaticMarkup(<MemberPredictionPreviewSection data={mockMemberPreviewResponse()} />);

    expect(html).toContain("SkorIQ Tahmin Yorumu");
    expect(html).toContain("Bu bölüm mevcut veri kapsamına göre üretilen ön tahminleri gösterir. Nihai sonuç garantisi değildir.");
    expect(html).toContain("Tahminler minimum güvenli süre korunarak maç başlayana kadar gösterilebilir.");
    expect(html).toContain("SkorIQ ön tahmin özeti.");
    expect(html).toContain("Veri kapsamı sınırlı alanlar içeriyor.");
    expect(html).not.toContain("Mevcut veri kapsamına göre üretilen adaylar. Nihai sonuç garantisi değildir.");
    expect(html).toContain("Tahminim");
    expect(html).toContain("Denenir");
    expect(html).toContain("Alternatif");
    expect(html).toContain("Bu grupta aday yok.");
    expect(html).toContain("MS 2.5 Üst");
    expect(html).toContain("Ön tahmin");
    expect(html).toContain("Güven skoru: 64");
    expect(html).toContain("Risk seviyesi: Orta");
    expect(html).not.toContain("Uzak Dur");
    expect(html).not.toContain("Çakışma");
    expect(html).not.toContain("Taslak");
    expect(html).not.toContain("Public değil");
    expect(html).not.toContain("Üyelere görünür değil");
    expect(html).not.toContain("Yayınla");
    expect(html).not.toContain("Settlement yap");
  });

  it("renders policy-specific member preview states without active candidates", () => {
    const staleHtml = renderToStaticMarkup(
      <MemberPredictionPreviewSection
        data={{
          ...mockMemberPreviewResponse(),
          status: "stale",
          reasonCode: "stale",
          message: "Tahminler yenilenmeli.",
          groups: { primary: [], try: [], alternative: [] },
          summary: "Yenileme gerekli.",
          warnings: []
        }}
      />
    );
    const unavailableHtml = renderToStaticMarkup(
      <MemberPredictionPreviewSection
        data={{
          ...mockMemberPreviewResponse(),
          status: "not_available",
          reasonCode: "pending_generation",
          message: "Tahmin üretimi bekliyor.",
          groups: { primary: [], try: [], alternative: [] },
          summary: "",
          warnings: []
        }}
      />
    );
    const notReadyHtml = renderToStaticMarkup(
      <MemberPredictionPreviewSection
        data={{
          ...mockMemberPreviewResponse(),
          status: "not_ready",
          reasonCode: "not_ready",
          message: "Veri kapsamı tahmin üretmek için yeterli değil.",
          groups: { primary: [], try: [], alternative: [] },
          summary: "",
          warnings: []
        }}
      />
    );
    const tooEarlyHtml = renderToStaticMarkup(
      <MemberPredictionPreviewSection
        data={{
          ...mockMemberPreviewResponse(),
          status: "not_available",
          reasonCode: "too_early",
          message: "Tahmin üretimi bekliyor.",
          groups: { primary: [], try: [], alternative: [] },
          summary: "",
          warnings: []
        }}
      />
    );
    const closedHtml = renderToStaticMarkup(
      <MemberPredictionPreviewSection
        data={{
          ...mockMemberPreviewResponse(),
          status: "closed",
          reasonCode: "closed",
          message: "Maç başladı; aktif tahmin önizlemesi kapandı.",
          groups: { primary: [], try: [], alternative: [] },
          summary: "",
          warnings: []
        }}
      />
    );

    expect(staleHtml).toContain("Tahminler yenilenmeli.");
    expect(staleHtml).not.toContain("MS 2.5 Üst");
    expect(unavailableHtml).toContain("Tahmin üretimi bekliyor.");
    expect(tooEarlyHtml).toContain("Tahmin üretimi bekliyor.");
    expect(notReadyHtml).toContain("Veri kapsamı tahmin üretmek için yeterli değil.");
    expect(closedHtml).toContain("Maç başladı; aktif tahmin önizlemesi kapandı.");
  });

  it("renders admin prediction preview groups with Turkish mapped labels", () => {
    const html = renderToStaticMarkup(<PredictionPreviewSection data={mockDraftResponse()} matchId="match-dynamic-1" navigate={vi.fn()} />);

    expect(html).toContain("Tahmin Önizleme");
    expect(html).toContain("Bu alan iç denetim amaçlıdır.");
    expect(html).toContain("Tahminim");
    expect(html).toContain("Bu grupta aday yok.");
    expect(html).toContain("Denenir");
    expect(html).toContain("MS 2.5 Üst");
    expect(html).toContain("İY 0.5 Üst");
    expect(html).toContain("Güven: 64");
    expect(html).toContain("Güven: 62.17");
    expect(html).toContain("Çakışma: 0");
    expect(html).toContain("Taslak");
    expect(html).toContain("Üyelere görünür değil");
    expect(html).toContain("Public değil");
    expect(html).not.toContain("Yayınla");
    expect(html).not.toContain("Settlement yap");
    expect(html).not.toContain("Üyelere görünür yap");
    expect(html).not.toContain("Public yayınla");
  });

  it("shows a non-blocking prediction preview warning when draft loading fails", () => {
    const html = renderToStaticMarkup(<PredictionPreviewErrorNotice />);

    expect(html).toContain("Tahmin önizlemesi alınamadı.");
    expect(html).toContain("Ana maç analizi etkilenmedi.");
  });

  it("shows a non-blocking member prediction preview warning when endpoint loading fails", () => {
    const html = renderToStaticMarkup(<MemberPredictionPreviewErrorNotice />);

    expect(html).toContain("Tahmin yorumu yüklenemedi.");
    expect(html).toContain("Ana maç analizi etkilenmedi.");
  });

  it("renders clean fallbacks without inventing missing match metadata", () => {
    const html = renderReport(
      mockReport({
        match: {
          ...mockReport().match,
          competition: { id: "competition-2", name: "", country: null },
          kickoffAt: "",
          status: ""
        },
        summary: ""
      })
    );

    expect(html).toContain("Lig bilgisi yok");
    expect(html).toContain("Tarih bilgisi yok");
    expect(html).toContain("Durum bilgisi yok");
    expect(html).toContain("Analiz Özeti");
    expect(html).toContain("Bu maç analiz için hazır görünüyor.");
  });
});
