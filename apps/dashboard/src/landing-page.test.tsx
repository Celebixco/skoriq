import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LandingPage } from "./App";

function renderLanding() {
  return renderToStaticMarkup(<LandingPage navigate={vi.fn()} />);
}

describe("LandingPage", () => {
  it("renders hero headline and explanation", () => {
    const html = renderLanding();
    expect(html).toContain("Veriyle Okunan Maçlar");
    expect(html).toContain("Nedenleriyle Açıklanan Tahminler");
    expect(html).toContain("SkorIQ; takım formu, gol profili, H2H");
    expect(html).toContain("Bot gibi sonuç vermez");
    expect(html).toContain("Veriyi okur, sinyali ayrıştırır, gerekçeyi açıklar");
  });

  it("has Login and Register CTAs", () => {
    const html = renderLanding();
    expect(html).toContain("Giriş Yap");
    expect(html).toContain("Ücretsiz Hesap Oluştur");
    expect(html).toContain("Hesap Oluştur");
  });

  it("shows all feature cards", () => {
    const html = renderLanding();
    expect(html).toContain("Platform Özellikleri");
    expect(html).toContain("Maç Analizleri");
    expect(html).toContain("Gol Profili");
    expect(html).toContain("H2H Bağlamı");
    expect(html).toContain("Tahmin Yorumu");
    expect(html).toContain("Risk Sinyalleri");
    expect(html).toContain("Takım / Lig");
  });

  it("shows product preview with generic labels", () => {
    const html = renderLanding();
    expect(html).toContain("Analiz Ekranından Bir Kesit");
    expect(html).toContain("Ev Sahibi");
    expect(html).toContain("Deplasman");
    expect(html).toContain("Örnek ekran görüntüsü");
  });

  it("shows member benefits", () => {
    const html = renderLanding();
    expect(html).toContain("Üye olduğunda ne görürsün?");
    expect(html).toContain("Yaklaşan maç analizleri");
    expect(html).toContain("SkorIQ Tahmin Yorumu");
    expect(html).toContain("Veri kapsamı ve güven tavanı");
  });

  it("shows coming-soon proof section instead of fake predictions", () => {
    const html = renderLanding();
    expect(html).toContain("Başarılı tahmin arşivi yakında");
    expect(html).toContain("Yalnızca sonuçlanmış ve iç kontrolden geçmiş tahminler");
    expect(html).not.toContain("%98 başarı");
    expect(html).not.toContain("kesin kazanç");
  });

  it("shows disclaimer", () => {
    const html = renderLanding();
    expect(html).toContain("SkorIQ, istatistiksel modelleme ve veri destekli analizlerle hazırlanır");
    expect(html).toContain("kesin sonuç garantisi değildir");
  });

  it("shows footer links", () => {
    const html = renderLanding();
    expect(html).toContain("Giriş Yap");
    expect(html).toContain("Kayıt Ol");
    expect(html).toContain("Gizlilik");
    expect(html).toContain("Kullanım Şartları");
    expect(html).toContain("Sorumluluk Reddi");
    expect(html).toContain("© 2026 SkorIQ");
  });

  it("does not show admin or internal links", () => {
    const html = renderLanding();
    expect(html).not.toContain("Draft Tahminler");
    expect(html).not.toContain("Tahmin Sonuçları");
    expect(html).not.toContain("Public Uygunluk");
    expect(html).not.toContain("İç Denetim");
  });

  it("does not show raw provider or internal metadata", () => {
    const html = renderLanding();
    expect(html).not.toContain("providerId");
    expect(html).not.toContain("apifootball");
    expect(html).not.toContain("draftPredictionCount");
    expect(html).not.toContain("settlementCount");
  });

  it("does not render betting guarantee language", () => {
    const html = renderLanding();
    const lowered = html.toLocaleLowerCase("tr-TR");
    expect(lowered).not.toContain("banko");
    expect(lowered).not.toContain("kesin kazanır");
    expect(lowered).not.toContain("bahis kazancı");
    expect(lowered).not.toContain("kupon garantisi");
    expect(lowered).not.toContain("garanti kazanç");
    expect(lowered).not.toContain("garanti sonuç");
  });

  it("shows trust note", () => {
    const html = renderLanding();
    expect(html).toContain("Kesin sonuç vaadi yoktur");
  });

  it("shows reasoning flow strip", () => {
    const html = renderLanding();
    expect(html).toContain("Veri");
    expect(html).toContain("Sinyal");
    expect(html).toContain("Neden-Sonuç");
    expect(html).toContain("Tahmin Desteği");
    expect(html).toContain("Risk Açıklaması");
  });

  it("shows preview feature cards", () => {
    const html = renderLanding();
    expect(html).toContain("Veri Kapsamı");
    expect(html).toContain("Her maçta veri yeterliliği ayrı değerlendirilir");
    expect(html).toContain("Tutarlılık Kontrolü");
    expect(html).toContain("Çelişen tahminler öneri olarak gösterilmez");
    expect(html).toContain("Açıklanabilir Yorum");
    expect(html).toContain("Tahminler sinyal ve risk açıklamalarıyla desteklenir");
  });
});
