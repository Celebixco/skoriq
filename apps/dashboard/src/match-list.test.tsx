import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  SearchBar,
  QuickFilterChips,
  ActiveFilterPills,
  ResultSummaryBar,
  EmptySearchState,
  MatchListPage
} from "./App";
import type { FrontendFilters } from "./App";
import type { FootballAnalyticsMatchFilters } from "./types";

// NOTE: Backend does not support text search or competition/country filtering.
// Search and advanced filters are applied frontend-side over currently loaded data.
// Pagination uses offset/limit parameters supported by the backend.

describe("MatchListPage analytics search and filter area", () => {
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
    expect(html).toContain(">24 saat içinde<span");
    expect(html).toContain(">H2H mevcut<span");
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
        counts={{ ready: 5, predictionEligible: 3, within24h: 2, hasH2h: 4 }}
      />
    );
    expect(html).toContain(">Tümü</button>");
    expect(html).toContain(">Hazır<span");
    expect(html).toContain(">Tahmine uygun<span");
    expect(html).toContain(">24 saat içinde<span");
    expect(html).toContain(">H2H mevcut<span");
    expect(html).toContain(">5</span>");
    expect(html).toContain(">3</span>");
  });

  it("marks active chip with active class", () => {
    const html = renderToStaticMarkup(
      <QuickFilterChips
        activeChip="ready"
        onChipClick={vi.fn()}
        counts={{ ready: 5, predictionEligible: 3, within24h: 2, hasH2h: 4 }}
      />
    );
    expect(html).toContain('analytics-chip-active');
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
      hasH2h: false
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
      hasH2h: false
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
        offset={0}
        hasPrev={false}
        hasNext={true}
        onPrev={vi.fn()}
        onNext={vi.fn()}
      />
    );
    expect(html).toContain("1–20 / 123 maç");
  });

  it("disables prev button on first page", () => {
    const html = renderToStaticMarkup(
      <ResultSummaryBar
        showing={20}
        total={123}
        loaded={20}
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
        offset={20}
        hasPrev={true}
        hasNext={true}
        onPrev={vi.fn()}
        onNext={vi.fn()}
      />
    );
    expect(html).toContain("21–40 / 123 maç");
  });
});

describe("EmptySearchState", () => {
  it("renders empty state with clear button when filters active", () => {
    const html = renderToStaticMarkup(
      <EmptySearchState hasFilters={true} onClear={vi.fn()} />
    );
    expect(html).toContain("Eşleşen maç bulunamadı.");
    expect(html).toContain("Filtreleri temizle");
  });

  it("renders empty state without clear button when no filters", () => {
    const html = renderToStaticMarkup(
      <EmptySearchState hasFilters={false} onClear={vi.fn()} />
    );
    expect(html).toContain("Eşleşen maç bulunamadı.");
    expect(html).not.toContain("Filtreleri temizle");
  });
});
