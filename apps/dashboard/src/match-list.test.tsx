import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  SearchBar,
  QuickFilterChips,
  ActiveFilterPills,
  ResultSummaryBar,
  EmptySearchState,
  MatchListPage,
  analyticsExpandedPageSize,
  expandAnalyticsFiltersForQuickChip,
  filterFootballAnalyticsItems,
  isWithinNextHours
} from "./App";
import type { FrontendFilters } from "./App";
import type { FootballAnalyticsMatchFilters, FootballAnalyticsMatchListResponse } from "./types";

// NOTE: The API now defaults this page to upcoming matches and supports broad
// search/filter pagination. Frontend filtering remains as a safety net for
// cached or defensive client-only cases.

describe("MatchListPage analytics search and filter area", () => {
  it("renders the upcoming-only page title and subtitle", () => {
    const html = renderToStaticMarkup(<MatchListPage navigate={vi.fn()} />);
    expect(html).toContain("Yaklaşan Maç Analizleri");
    expect(html).toContain("Analiz ve tahmin üretimi için yaklaşan maçları incele.");
  });

  it("renders search input with correct placeholder", () => {
    const html = renderToStaticMarkup(<MatchListPage navigate={vi.fn()} />);
    expect(html).toContain('placeholder="Takım, lig veya maç ara…"');
    expect(html).toContain('aria-label="Maç ara"');
  });

  it("renders filter bar with page size options 20, 50, 100, 200", () => {
    const html = renderToStaticMarkup(<MatchListPage navigate={vi.fn()} />);
    expect(html).toContain(">20</option>");
    expect(html).toContain(">50</option>");
    expect(html).toContain(">100</option>");
    expect(html).toContain(">200</option>");
  });

  it("renders quick filter chips", () => {
    const html = renderToStaticMarkup(<MatchListPage navigate={vi.fn()} />);
    expect(html).toContain(">Tümü</button>");
    expect(html).toContain(">Hazır<span");
    expect(html).toContain(">Tahmine uygun<span");
    expect(html).toContain(">36 saat içinde<span");
    expect(html).toContain(">H2H mevcut<span");
    expect(html).toContain(">Tahmin var<span");
  });

  it("does not show '24 saat içinde' text anywhere", () => {
    const html = renderToStaticMarkup(<MatchListPage navigate={vi.fn()} />);
    expect(html).not.toContain("24 saat içinde");
  });

  it("does not render pagination controls while loading", () => {
    const html = renderToStaticMarkup(<MatchListPage navigate={vi.fn()} />);
    // Pagination only renders when data is loaded
    expect(html).not.toContain('aria-label="Önceki sayfa"');
    expect(html).not.toContain('aria-label="Sonraki sayfa"');
  });

  it("shows loading state while data loads", () => {
    const html = renderToStaticMarkup(<MatchListPage navigate={vi.fn()} />);
    expect(html).toContain("Maç analizleri yükleniyor");
  });
});

describe("SearchBar", () => {
  it("renders input with given query", () => {
    const html = renderToStaticMarkup(
      <SearchBar query="Arsenal" onChange={vi.fn()} onClear={vi.fn()} />
    );
    expect(html).toContain('value="Arsenal"');
    expect(html).toContain("Aramayı temizle");
  });

  it("does not show clear button when query is empty", () => {
    const html = renderToStaticMarkup(
      <SearchBar query="" onChange={vi.fn()} onClear={vi.fn()} />
    );
    expect(html).not.toContain("Aramayı temizle");
  });
});

describe("QuickFilterChips", () => {
  it("renders all chips with counts", () => {
    const html = renderToStaticMarkup(
      <QuickFilterChips
        activeChip={null}
        onChipClick={vi.fn()}
        counts={{ ready: 5, predictionEligible: 3, within24h: 2, hasH2h: 4, hasPrediction: 1 }}
      />
    );
    expect(html).toContain(">Tümü</button>");
    expect(html).toContain(">Hazır<span");
    expect(html).toContain(">Tahmine uygun<span");
    expect(html).toContain(">36 saat içinde<span");
    expect(html).toContain(">H2H mevcut<span");
    expect(html).toContain(">Tahmin var<span");
    expect(html).toContain(">5</span>");
    expect(html).toContain(">3</span>");
  });

  it("marks active chip with active class", () => {
    const html = renderToStaticMarkup(
      <QuickFilterChips
        activeChip="ready"
        onChipClick={vi.fn()}
        counts={{ ready: 5, predictionEligible: 3, within24h: 2, hasH2h: 4, hasPrediction: 1 }}
      />
    );
    expect(html).toContain('analytics-chip-active');
  });
});

describe("analytics frontend filtering", () => {
  const baseFrontendFilters: FrontendFilters = {
    searchQuery: "",
    competitionName: "",
    countryName: "",
    within24h: false,
    hasH2h: false,
    hasPrediction: false
  };

  it("expands the API request when the 36h quick filter is enabled", () => {
    expect(expandAnalyticsFiltersForQuickChip({ limit: 50, offset: 50 }, "within24h")).toMatchObject({
      analysisWindowStatus: "within_window",
      limit: analyticsExpandedPageSize,
      offset: 0
    });
  });

  it("uses UTC-safe kickoff comparison for the next 36 hours", () => {
    const now = new Date("2026-05-02T15:00:00.000Z");

    expect(isWithinNextHours("2026-05-04T02:59:59.000Z", now)).toBe(true);
    expect(isWithinNextHours("2026-05-04T03:00:01.000Z", now)).toBe(false);
    expect(isWithinNextHours("2026-05-02T14:59:59.000Z", now)).toBe(false);
  });

  it("includes 36h matches beyond the first 50 when expanded data is fetched", () => {
    const now = new Date("2026-05-02T15:00:00.000Z");
    const items = Array.from({ length: 60 }, (_, index) =>
      matchItem({
        id: `match-${index + 1}`,
        home: index === 55 ? "Lille" : `Home ${index + 1}`,
        away: index === 55 ? "Le Havre" : `Away ${index + 1}`,
        kickoffAt: index === 55 ? "2026-05-03T14:00:00.000Z" : "2026-05-05T14:00:00.000Z"
      })
    );

    const filtered = filterFootballAnalyticsItems(items, { ...baseFrontendFilters, within24h: true }, "", now);

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.match.homeTeam.name).toBe("Lille");
  });

  it("combines search with the 36h filter", () => {
    const now = new Date("2026-05-02T15:00:00.000Z");
    const items = [
      matchItem({ id: "match-1", home: "Lille", away: "Le Havre", kickoffAt: "2026-05-03T14:00:00.000Z" }),
      matchItem({ id: "match-2", home: "Arsenal FC", away: "Fulham", kickoffAt: "2026-05-03T14:00:00.000Z" }),
      matchItem({ id: "match-3", home: "Como", away: "Napoli", kickoffAt: "2026-05-05T14:00:00.000Z" })
    ];

    const filtered = filterFootballAnalyticsItems(items, { ...baseFrontendFilters, within24h: true }, "arsenal", now);

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.match.homeTeam.name).toBe("Arsenal FC");
  });

  it("clearing frontend filters restores the loaded list", () => {
    const now = new Date("2026-05-02T15:00:00.000Z");
    const items = [
      matchItem({ id: "match-1", home: "Lille", away: "Le Havre", kickoffAt: "2026-05-03T14:00:00.000Z" }),
      matchItem({ id: "match-2", home: "Como", away: "Napoli", kickoffAt: "2026-05-05T14:00:00.000Z" })
    ];

    expect(filterFootballAnalyticsItems(items, { ...baseFrontendFilters, within24h: true }, "", now)).toHaveLength(1);
    expect(filterFootballAnalyticsItems(items, baseFrontendFilters, "", now)).toHaveLength(2);
  });

  it("filters out finished matches regardless of other filters", () => {
    const items = [
      matchItem({ id: "match-1", home: "Lille", away: "Le Havre", status: "not_started" }),
      matchItem({ id: "match-2", home: "Arsenal", away: "Fulham", status: "finished" }),
      matchItem({ id: "match-3", home: "Como", away: "Napoli", status: "after_extra_time" }),
      matchItem({ id: "match-4", home: "Milan", away: "Juventus", status: "cancelled" }),
      matchItem({ id: "match-5", home: "Bayern", away: "Dortmund", status: "scheduled" }),
    ];

    const filtered = filterFootballAnalyticsItems(items, baseFrontendFilters, "");

    expect(filtered).toHaveLength(2);
    expect(filtered.map(i => i.match.homeTeam.name)).toEqual(["Lille", "Bayern"]);
  });

  it("filters out abandoned and after_penalties matches", () => {
    const items = [
      matchItem({ id: "match-1", home: "Team A", away: "Team B", status: "abandoned" }),
      matchItem({ id: "match-2", home: "Team C", away: "Team D", status: "after_penalties" }),
      matchItem({ id: "match-3", home: "Team E", away: "Team F", status: "not_started" }),
    ];

    const filtered = filterFootballAnalyticsItems(items, baseFrontendFilters, "");

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.match.homeTeam.name).toBe("Team E");
  });

  it("filters by hasPrediction using kuponEligible proxy", () => {
    const items = [
      matchItem({ id: "match-1", home: "A", away: "B", kuponEligible: true }),
      matchItem({ id: "match-2", home: "C", away: "D", kuponEligible: false }),
      matchItem({ id: "match-3", home: "E", away: "F", kuponEligible: true }),
    ];

    const filtered = filterFootballAnalyticsItems(items, { ...baseFrontendFilters, hasPrediction: true }, "");

    expect(filtered).toHaveLength(2);
    expect(filtered.map(i => i.match.homeTeam.name)).toEqual(["A", "E"]);
  });

  it("keeps postponed matches since they may be rescheduled", () => {
    const items = [
      matchItem({ id: "match-1", home: "Team A", away: "Team B", status: "postponed" }),
      matchItem({ id: "match-2", home: "Team C", away: "Team D", status: "not_started" }),
    ];

    const filtered = filterFootballAnalyticsItems(items, baseFrontendFilters, "");

    expect(filtered).toHaveLength(2);
  });
});

describe("ActiveFilterPills", () => {
  it("renders pills for active filters", () => {
    const filters: FootballAnalyticsMatchFilters = { featureStatus: "ready", limit: 20, offset: 0 };
    const frontendFilters: FrontendFilters = {
      searchQuery: "Arsenal",
      competitionName: "Premier League",
      countryName: "",
      within24h: false,
      hasH2h: false,
      hasPrediction: false
    };
    const html = renderToStaticMarkup(
      <ActiveFilterPills
        filters={filters}
        frontendFilters={frontendFilters}
        quickChip={null}
        onClearFilter={vi.fn()}
        onClearAll={vi.fn()}
      />
    );
    expect(html).toContain("Durum: Hazır");
    expect(html).toContain("Arama: Arsenal");
    expect(html).toContain("Lig: Premier League");
    expect(html).toContain("Tümünü temizle");
  });

  it("renders nothing when no filters are active", () => {
    const filters: FootballAnalyticsMatchFilters = { limit: 20, offset: 0 };
    const frontendFilters: FrontendFilters = {
      searchQuery: "",
      competitionName: "",
      countryName: "",
      within24h: false,
      hasH2h: false,
      hasPrediction: false
    };
    const html = renderToStaticMarkup(
      <ActiveFilterPills
        filters={filters}
        frontendFilters={frontendFilters}
        quickChip={null}
        onClearFilter={vi.fn()}
        onClearAll={vi.fn()}
      />
    );
    expect(html).toBe("");
  });
});

describe("ResultSummaryBar", () => {
  it("shows range and total count", () => {
    const html = renderToStaticMarkup(
      <ResultSummaryBar
        showing={20}
        total={123}
        loaded={20}
        limit={20}
        offset={0}
        hasPrev={false}
        hasNext={true}
        onPrev={vi.fn()}
        onNext={vi.fn()}
      />
    );
    expect(html).toContain("Sayfa 1");
    expect(html).toContain("Gösterilen: 1–20");
    expect(html).toContain("Toplam: 123");
  });

  it("disables prev button on first page", () => {
    const html = renderToStaticMarkup(
      <ResultSummaryBar
        showing={20}
        total={123}
        loaded={20}
        limit={20}
        offset={0}
        hasPrev={false}
        hasNext={true}
        onPrev={vi.fn()}
        onNext={vi.fn()}
      />
    );
    expect(html).toContain('disabled=""');
  });

  it("shows correct range on second page", () => {
    const html = renderToStaticMarkup(
      <ResultSummaryBar
        showing={20}
        total={123}
        loaded={20}
        limit={20}
        offset={20}
        hasPrev={true}
        hasNext={true}
        onPrev={vi.fn()}
        onNext={vi.fn()}
      />
    );
    expect(html).toContain("Sayfa 2");
    expect(html).toContain("Gösterilen: 21–40");
    expect(html).toContain("Toplam: 123");
  });

  it("shows the frontend-filtered count clearly", () => {
    const html = renderToStaticMarkup(
      <ResultSummaryBar
        showing={24}
        total={123}
        loaded={200}
        limit={200}
        offset={0}
        frontendFiltered
        hasPrev={false}
        hasNext={false}
        onPrev={vi.fn()}
        onNext={vi.fn()}
      />
    );
    expect(html).toContain("Gösterilen: 24 maç");
    expect(html).not.toContain("Gösterilen: 1–200");
  });
});

describe("EmptySearchState", () => {
  it("renders search-no-result state with clear button when filters active", () => {
    const html = renderToStaticMarkup(
      <EmptySearchState hasFilters={true} apiHasData={true} onClear={vi.fn()} navigate={vi.fn()} />
    );
    expect(html).toContain("Eşleşen maç bulunamadı.");
    expect(html).toContain("Filtreleri temizle");
  });

  it("renders search-no-result state without clear button when no filters", () => {
    const html = renderToStaticMarkup(
      <EmptySearchState hasFilters={false} apiHasData={true} onClear={vi.fn()} navigate={vi.fn()} />
    );
    expect(html).toContain("Eşleşen maç bulunamadı.");
    expect(html).not.toContain("Filtreleri temizle");
  });

  it("renders no-upcoming-matches state when API has no data", () => {
    const html = renderToStaticMarkup(
      <EmptySearchState hasFilters={false} apiHasData={false} onClear={vi.fn()} navigate={vi.fn()} />
    );
    expect(html).toContain("Yaklaşan analiz maçı bulunmuyor.");
    expect(html).toContain("Sonuçlar sayfasına git");
  });

  it("renders link to prediction results page when no upcoming matches", () => {
    const html = renderToStaticMarkup(
      <EmptySearchState hasFilters={false} apiHasData={false} onClear={vi.fn()} navigate={vi.fn()} />
    );
    expect(html).toContain("Sonuçlar sayfasına git");
  });

  it("renders the finished results navigation hint on the analytics page", () => {
    const html = renderToStaticMarkup(<MatchListPage navigate={vi.fn()} />);
    expect(html).toContain("Biten maçlar ve tahmin sonuçları için Sonuçlar sayfasına git.");
    expect(html).toContain("Sonuçlar sayfası");
  });
});

function matchItem(input: {
  id: string;
  home: string;
  away: string;
  kickoffAt?: string;
  status?: string;
  kuponEligible?: boolean;
}): FootballAnalyticsMatchListResponse["items"][number] {
  return {
    match: {
      matchId: input.id,
      competition: {
        id: "competition-1",
        name: "Premier League",
        country: "England"
      },
      kickoffAt: input.kickoffAt ?? "2026-05-05T14:00:00.000Z",
      status: input.status ?? "not_started",
      homeTeam: {
        id: `${input.id}-home`,
        name: input.home,
        logoUrl: null
      },
      awayTeam: {
        id: `${input.id}-away`,
        name: input.away,
        logoUrl: null
      }
    },
    featureStatus: "ready",
    predictionEligible: true,
    kuponEligible: input.kuponEligible ?? false,
    confidenceCeiling: 80,
    combinedCoverageScore: 76,
    homeForm: { sampleSize: 5, coverageScore: 70, scope: "home", windowSize: 5 },
    awayForm: { sampleSize: 5, coverageScore: 70, scope: "away", windowSize: 5 },
    h2h: { sampleSize: 5, coverageScore: 100, h2hMissing: false },
    positiveSignals: [],
    riskFactors: [],
    missingDataWarnings: [],
    summary: "Ready match."
  };
}
