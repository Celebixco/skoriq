import { describe, expect, it, vi } from "vitest";
import { CountryListPage, CountryDetailPage, CompetitionDetailPage } from "./App";
import { renderToStaticMarkup } from "react-dom/server";

describe("Football Explorer Pages", () => {
  it("CountryListPage renders premium hero and skeleton loading", () => {
    const html = renderToStaticMarkup(<CountryListPage navigate={vi.fn()} />);
    expect(html).toContain("Futbol Keşfi");
    expect(html).toContain("SkorIQ Football");
    expect(html).toContain("explorer-skeleton-grid");
    expect(html).toContain("explorer-skeleton-card");
  });

  it("CountryDetailPage renders back button and loading state", () => {
    const html = renderToStaticMarkup(<CountryDetailPage countryId="test-country-id" navigate={vi.fn()} />);
    expect(html).toContain("Ülkelere dön");
    expect(html).toContain("Ligler yükleniyor");
  });

  it("CompetitionDetailPage renders back button and loading state", () => {
    const html = renderToStaticMarkup(<CompetitionDetailPage competitionId="test-competition-id" navigate={vi.fn()} />);
    expect(html).toContain("Geri");
    expect(html).toContain("Lig yükleniyor");
  });

  it("does not render betting or guarantee language", () => {
    const html = renderToStaticMarkup(<CountryListPage navigate={vi.fn()} />);
    const lowered = html.toLocaleLowerCase("tr-TR");
    expect(lowered).not.toContain("banko");
    expect(lowered).not.toContain("kesin kazanır");
    expect(lowered).not.toContain("garanti");
    expect(lowered).not.toContain("kupon");
  });

  it("does not expose raw provider or internal metadata", () => {
    const html = renderToStaticMarkup(<CountryListPage navigate={vi.fn()} />);
    expect(html).not.toContain("providerId");
    expect(html).not.toContain("apifootball");
    expect(html).not.toContain("draftPredictionCount");
  });
});
