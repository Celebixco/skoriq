import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FilterDisclosure, nextTabIndex, SectionTabs } from "./SectionTabs";

describe("Detail section navigation", () => {
  it("keeps only the selected tab in keyboard order and names its content region", () => {
    const html = renderToStaticMarkup(<SectionTabs idPrefix="report" label="Rapor bölümleri" value="form" onChange={vi.fn()} items={[{ id: "overview", label: "Genel Bakış" }, { id: "form", label: "Form" }]} />);
    expect(html).toContain('id="report-form-tab" aria-controls="report-panel" aria-selected="true" tabindex="0"');
    expect(html).toContain('aria-selected="false" tabindex="-1"');
    expect(html).toContain('aria-label="Rapor bölümleri"');
  });

  it("supports wraparound arrows and direct first/last navigation", () => {
    expect(nextTabIndex("ArrowRight", 4, 5)).toBe(0);
    expect(nextTabIndex("ArrowLeft", 0, 5)).toBe(4);
    expect(nextTabIndex("Home", 3, 5)).toBe(0);
    expect(nextTabIndex("End", 1, 5)).toBe(4);
    expect(nextTabIndex("Tab", 1, 5)).toBeNull();
    expect(nextTabIndex("Home", 0, 0)).toBeNull();
  });

  it("leaves advanced controls available in a native disclosure with active filter feedback", () => {
    const html = renderToStaticMarkup(<FilterDisclosure active><input aria-label="Lig" /></FilterDisclosure>);
    expect(html).toContain("<details");
    expect(html).toContain("<summary>");
    expect(html).toContain("Filtreler etkin");
    expect(html).toContain('aria-label="Lig"');
  });
});
