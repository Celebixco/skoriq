import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LandingPage } from "./App";

const renderLanding = () => renderToStaticMarkup(<LandingPage navigate={vi.fn()} />);

describe("Maç Gecesi public landing", () => {
  it("provides a readable hero and usable account entry points", () => {
    const html = renderLanding();
    expect(html).toContain("BU GECE,");
    expect(html).toContain("MAÇI OKU.");
    expect(html).toContain("Günün analizini aç");
    expect(html).toContain("Giriş yap");
    expect(html).toContain("Ücretsiz başla");
  });
  it("clearly labels every public prediction and fixture as an example", () => {
    const html = renderLanding();
    expect(html).toContain("Örnek analiz");
    expect(html).toContain("Örnek karşılaşmalar");
    expect(html).toContain("Örnek karşılaşma");
    expect(html).not.toContain("Canlı veri");
    expect(html).not.toContain("son kontrol az önce");
    expect(html).not.toContain("Konsept");
  });
  it("keeps filters and the explanation available without cluttering the first view", () => {
    const html = renderLanding();
    expect(html).toContain('aria-label="Maç durumu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Filtrele");
    expect(html).toContain("Neden bu tahmin?");
    expect(html).toContain("Takım veya lig ara");
  });
  it("preserves risk and confidence disclaimers", () => {
    const html = renderLanding();
    expect(html).toContain("Güven skoru kazanma olasılığı değildir.");
    expect(html).toContain("Bu bir maç analizi raporudur, nihai tahmin değildir.");
    expect(html).toContain("kesin sonuç garantisi vermez");
  });
  it("does not expose administrative controls or internal data", () => {
    const html = renderLanding();
    for (const forbidden of ["Draft Tahminler","Public Uygunluk","İç Denetim","providerId","draftPredictionCount","settlementCount"]) expect(html).not.toContain(forbidden);
  });
});
