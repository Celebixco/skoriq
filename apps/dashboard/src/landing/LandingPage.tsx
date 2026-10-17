import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";
import "./landing.css";

type Navigate = (path: string) => void;

const LEAGUES = [
  { code: "TR", name: "Süper Lig", on: true },
  { code: "ENG", name: "Premier League", on: true },
  { code: "ESP", name: "La Liga", on: true },
  { code: "ITA", name: "Serie A", on: true },
  { code: "GER", name: "Bundesliga", on: true },
  { code: "GER", name: "2. Bundesliga", on: true },
  { code: "FRA", name: "Ligue 1", on: false },
  { code: "NED", name: "Eredivisie", on: false }
] as const;

const FLOW = [
  { no: "01", title: "Veri Toplama", text: "Lig, takım, form ve gol verisi tek yapıya getirilir." },
  { no: "02", title: "Sinyal Ayrıştırma", text: "Form, gol profili ve H2H ayrı katmanlar olarak okunur." },
  { no: "03", title: "Neden-Sonuç", text: "Her sinyal destekleyici ya da çürütücü olarak yorumlanır." },
  { no: "04", title: "Tahmin Desteği", text: "Adaylar dört seviyede derecelendirilir; en güçlüsü öne çıkar." },
  { no: "05", title: "Risk Açıklaması", text: "Eksik veri ve çelişkiler gizlenmeden yazılır." }
] as const;

const FEATURES = [
  { no: "01", title: "Maç Analizleri", text: "Kapsam, form, H2H ve risk tek ekranda." },
  { no: "02", title: "Gol Profili", text: "Atılan, yenilen ve beklenen gol eğilimi." },
  { no: "03", title: "H2H Bağlamı", text: "Geçmiş karşılaşmalar, örneklem uyarısıyla." },
  { no: "04", title: "Tahmin Yorumu", text: "Her aday için destek ve çelişki notu." },
  { no: "05", title: "Risk Sinyalleri", text: "Eksik veri ve çelişki görünür kalır." },
  { no: "06", title: "Takım / Lig", text: "Form, puan durumu ve sezon telemetrisi." }
] as const;

const TABS = [
  { id: "match", label: "Maç Analizi" },
  { id: "team", label: "Takım Profili" },
  { id: "results", label: "Sonuçlar" }
] as const;
type TabId = (typeof TABS)[number]["id"];

const TIERS = [
  {
    id: "primary",
    name: "Tahminim",
    role: "Birincil aday",
    pick: "MS 2,5 Üst",
    confidence: 82,
    tone: "signal",
    summary: "Sinyal desteği en güçlü, çelişki yok.",
    detail: "Analiz hattının ana çıktısı. Kapsam yeterli, form ve gol profili aynı yönü gösteriyor.",
    reasons: [
      { kind: "support", text: "Form ve gol profili aynı yönü gösteriyor." },
      { kind: "support", text: "Son 5 maçta 4 galibiyet, 1 mağlubiyet." },
      { kind: "risk", text: "H2H örneklemi yok; güven tavanı 82'de kalıyor." }
    ]
  },
  {
    id: "secondary",
    name: "Denenir",
    role: "Destekli aday",
    pick: "KG Var",
    confidence: 64,
    tone: "ink",
    summary: "Sinyal güçlü, riskler tanımlı ve sınırlı.",
    detail: "Değerlendirmeye açık seçenek. Birincil adayı destekler; tek başına taşımaz.",
    reasons: [
      { kind: "support", text: "İki takımın da gol üretimi son 5 maçta yüksek." },
      { kind: "support", text: "Ev sahibi iç sahada 4 maçtır gol yiyor." },
      { kind: "risk", text: "Deplasman temposu düşük; örneklem sınırlı." }
    ]
  },
  {
    id: "watch",
    name: "Alternatif",
    role: "İzleme adayı",
    pick: "İY 0,5 Üst",
    confidence: 48,
    tone: "neutral",
    summary: "İkincil senaryo; tek başına öneri değil.",
    detail: "Yalnızca bağlam sağlar. Ana adayla çelişmediği sürece izleme listesinde kalır.",
    reasons: [
      { kind: "support", text: "İlk yarı gol oranı lig ortalamasının üzerinde." },
      { kind: "risk", text: "Sinyal gücü düşük; karar için yeterli değil." },
      { kind: "missing", text: "Canlı tempo verisi yok." }
    ]
  },
  {
    id: "avoid",
    name: "Uzak Dur",
    role: "Öneri değil",
    pick: "İY 1,5 Alt",
    confidence: 0,
    tone: "neg",
    summary: "Çelişki veya yetersiz veri tespit edildi.",
    detail: "Öneri olarak asla gösterilmez. Çelişen adaylar otomatik olarak bu seviyeye indirilir.",
    reasons: [
      { kind: "risk", text: "Gol profili ile form sinyali çelişiyor." },
      { kind: "missing", text: "H2H örneklemi yok; güven tavanı düşük." },
      { kind: "missing", text: "Karar için yeterli veri yok." }
    ]
  }
] as const;
type Tier = (typeof TIERS)[number];

const PITCH_NODES = [
  { n: 1, x: 260, y: 62 },
  { n: 2, x: 430, y: 150 },
  { n: 4, x: 330, y: 130 },
  { n: 5, x: 190, y: 130 },
  { n: 3, x: 90, y: 150 },
  { n: 6, x: 260, y: 250 },
  { n: 8, x: 360, y: 310 },
  { n: 10, x: 160, y: 310 },
  { n: 7, x: 430, y: 390 },
  { n: 11, x: 90, y: 390 }
] as const;

function Mark({ size = 26 }: { size?: number }) {
  return (
    <svg className="lp-mark" width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="38" height="38" rx="10" fill="#FFC400" />
      <path d="M10.5 26.6 L16.8 19.4 L22.4 22" stroke="#1D1913" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M22.4 22 L28.4 14" stroke="#1D1913" strokeWidth="3.4" strokeLinecap="round" strokeDasharray="3.2 2.6" />
      <circle cx="29.1" cy="13.2" r="3.3" fill="#1D1913" />
      <circle cx="29.1" cy="13.2" r="6" stroke="#1D1913" strokeOpacity=".3" strokeWidth="1.4" />
    </svg>
  );
}

function Arrow() {
  return (
    <svg className="lp-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function Check() {
  return (
    <svg className="lp-check" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
    </svg>
  );
}

function KindIcon({ kind }: { kind: "support" | "risk" | "missing" }) {
  if (kind === "support") {
    return (
      <svg className="lp-kind-icon" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M2.5 8.2 6 11.6 13.5 4.4" />
      </svg>
    );
  }
  if (kind === "risk") {
    return (
      <svg className="lp-kind-icon" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M8 2.4 14.4 13.6H1.6L8 2.4Z" />
        <path d="M8 6.4v3.2M8 11.7v.1" />
      </svg>
    );
  }
  return (
    <svg className="lp-kind-icon" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="5.8" />
      <path d="M8 5v3.4l2 1.4" />
    </svg>
  );
}

function Pitch() {
  return (
    <svg className="lp-pitch" viewBox="0 0 520 600" role="img" aria-label="Yarım saha taktik tahtası: 9 numara, sinyal hattının sonunda aday olarak işaretli">
      <defs>
        <clipPath id="lp-pitch-clip">
          <rect x="16" y="16" width="488" height="568" />
        </clipPath>
        <radialGradient id="lp-hot-glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="rgba(255,196,0,0.28)" />
          <stop offset="0.55" stopColor="rgba(255,196,0,0.10)" />
          <stop offset="1" stopColor="rgba(255,196,0,0)" />
        </radialGradient>
      </defs>

      <g clipPath="url(#lp-pitch-clip)">
        <rect x="16" y="16" width="488" height="71" fill="rgba(29,25,19,.014)" />
        <rect x="16" y="158" width="488" height="71" fill="rgba(29,25,19,.014)" />
        <rect x="16" y="300" width="488" height="71" fill="rgba(29,25,19,.014)" />
        <rect x="16" y="442" width="488" height="71" fill="rgba(29,25,19,.014)" />
      </g>

      <g className="lp-pitch-lines">
        <rect x="16" y="16" width="488" height="568" className="outer" />
        <rect x="104" y="16" width="312" height="212" />
        <rect x="176" y="16" width="168" height="92" />
        <path d="M190 228 Q260 292 330 228" />
        <circle cx="260" cy="150" r="3" className="spot" />
        <circle cx="260" cy="584" r="64" />
        <path d="M16 584 H504" />
        <rect x="230" y="7" width="60" height="9" className="goal" />
        <path d="M16 34 Q16 16 34 16" className="corner" />
        <path d="M504 34 Q504 16 486 16" className="corner" />
      </g>

      <g className="lp-links">
        <path d="M260 62 L260 250" />
        <path d="M260 250 L160 310" />
        <path d="M260 250 L360 310" />
        <path d="M160 310 L90 390" />
        <path d="M360 310 L430 390" />
        <path d="M160 310 L260 420" />
        <path d="M360 310 L260 420" />
        <path d="M260 250 L260 420" />
      </g>

      <circle cx="260" cy="420" r="46" fill="url(#lp-hot-glow)" />
      <path className="lp-signal-path" d="M260 250 L160 310 L260 420" />
      <path className="lp-signal-path is-second" d="M360 310 L260 420" />

      <g className="lp-nodes">
        {PITCH_NODES.map((node) => (
          <g key={node.n} className={node.n === 6 || node.n === 10 ? "is-chain" : ""}>
            <circle cx={node.x} cy={node.y} r="15" />
            <text x={node.x} y={node.y} textAnchor="middle" dominantBaseline="central">
              {node.n}
            </text>
          </g>
        ))}
      </g>

      <g className="lp-hot-node">
        <circle className="lp-hot-ring" cx="260" cy="420" r="23" />
        <circle cx="260" cy="420" r="15" />
        <text x="260" y="420" textAnchor="middle" dominantBaseline="central">9</text>
      </g>

      <circle className="lp-ball" cx="279" cy="437" r="3.4" />
    </svg>
  );
}

function DossierCard({ cardRef }: { cardRef: RefObject<HTMLDivElement | null> }) {
  return (
    <figure className="lp-dossier" ref={cardRef}>
      <div className="lp-dossier-top">
        <div>
          <span className="lp-mono">Analiz Dosyası · Bundesliga · 26. Hafta</span>
          <p className="lp-dossier-teams">
            <b>BVB</b><span>—</span><b>SCF</b>
          </p>
        </div>
        <span className="lp-status"><i aria-hidden="true" />Hazır</span>
      </div>

      <div className="lp-pitch-wrap">
        <span className="lp-pitch-tag">Sinyal Hattı</span>
        <Pitch />
      </div>

      <div className="lp-dossier-legend">
        <span className="lp-hand">h2h yok — güven tavanı düşük</span>
        <span className="lp-legend"><i aria-hidden="true" />Tahmin adayı</span>
      </div>

      <div className="lp-dossier-stats">
        <div className="lp-stat">
          <span>Veri Kapsamı</span>
          <b>%64</b>
          <i className="lp-mini" aria-hidden="true"><i style={{ width: "64%" }} /></i>
        </div>
        <div className="lp-stat">
          <span>Form</span>
          <b>4G–1M</b>
          <em>Son 5</em>
        </div>
        <div className="lp-stat">
          <span>H2H</span>
          <b className="is-warn">∅</b>
          <em>Örneklem yok</em>
        </div>
        <div className="lp-stat">
          <span>Güven</span>
          <b>82</b>
          <em>Yüksek</em>
        </div>
      </div>

      <figcaption>Örnek analiz dosyası — gerçek maç verisi içermez.</figcaption>
    </figure>
  );
}

function MatchView() {
  return (
    <div className="lp-mv">
      <div className="lp-mv-meta">
        <span>Bundesliga</span><i aria-hidden="true" /><span>26. Hafta</span><i aria-hidden="true" />
        <span>09.11.2026 · 18:30</span>
      </div>

      <div className="lp-mv-head">
        <div className="lp-team">
          <span className="lp-crest">BVB</span>
          <div><b>Borussia Dortmund</b><small>Ev Sahibi</small></div>
        </div>
        <div className="lp-mv-score">
          <b>2<span>–</span>1</b>
          <em><i aria-hidden="true" />Canlı 78'</em>
        </div>
        <div className="lp-team is-away">
          <div><b>SC Freiburg</b><small>Deplasman</small></div>
          <span className="lp-crest">SCF</span>
        </div>
      </div>

      <div className="lp-kpis">
        <div className="lp-kpi">
          <span>Veri Kapsamı</span><b>%64</b><em>H2H eksik</em>
          <i className="lp-kpi-bar" aria-hidden="true"><i style={{ width: "64%" }} /></i>
        </div>
        <div className="lp-kpi"><span>Form</span><b>4G · 1M</b><em>Son 5 maç</em></div>
        <div className="lp-kpi"><span>H2H Örneklem</span><b className="is-neg">0</b><em>Güven tavanı düşük</em></div>
        <div className="lp-kpi"><span>Güven</span><b>82</b><em>Yüksek · 100 üzerinden</em></div>
      </div>

      <div className="lp-mv-grid">
        <div className="lp-chart">
          <div className="lp-chart-head">
            <span>Maç içi üretim — son 5 maç ortalaması</span>
            <span className="lp-legend"><i aria-hidden="true" />Dortmund <i className="is-away" aria-hidden="true" />Freiburg</span>
          </div>
          <div className="lp-bars">
            <div className="lp-bar-row">
              <span>Topla Oynama</span>
              <div className="lp-bars-pair">
                <i><b style={{ width: "58%" }} /></i>
                <i className="is-away"><b style={{ width: "42%" }} /></i>
              </div>
              <em>58 / 42</em>
            </div>
            <div className="lp-bar-row">
              <span>Şut</span>
              <div className="lp-bars-pair">
                <i><b style={{ width: "64%" }} /></i>
                <i className="is-away"><b style={{ width: "36%" }} /></i>
              </div>
              <em>16 / 9</em>
            </div>
            <div className="lp-bar-row">
              <span>xG</span>
              <div className="lp-bars-pair">
                <i><b style={{ width: "74%" }} /></i>
                <i className="is-away"><b style={{ width: "45%" }} /></i>
              </div>
              <em>1.84 / 1.12</em>
            </div>
          </div>
          <p className="lp-chart-foot">xG = beklenen gol · Kaynak: maç içi telemetri · Örnek veri</p>
        </div>

        <div className="lp-picks">
          <div className="lp-pick is-primary">
            <span>TAHMİNİM</span><b>MS 2,5 Üst</b><em>Güven 82 · çelişki yok</em>
          </div>
          <div className="lp-pick is-avoid">
            <span>UZAK DUR</span><b>İY 1,5 Alt</b><em>H2H yok · gerekçe zayıf</em>
          </div>
        </div>
      </div>
    </div>
  );
}

function TeamView() {
  return (
    <div className="lp-tv">
      <div className="lp-tv-head">
        <span className="lp-crest is-lg">BVB</span>
        <div className="lp-tv-title">
          <h3>Borussia Dortmund</h3>
          <p>Bundesliga · 1. sıra · 26 maç · 58 puan</p>
        </div>
        <span className="lp-tag">Form 4G–1M</span>
      </div>

      <div className="lp-tv-grid">
        <div className="lp-tv-form">
          <div className="lp-chart-head"><span>Form trendi — son 10 maç</span><span className="lp-trend">↑ 2.4</span></div>
          <svg className="lp-spark" viewBox="0 0 520 150" role="img" aria-label="Form trendi: son on maçta yükseliş">
            <path className="lp-spark-grid" d="M0 30H520M0 75H520M0 120H520" />
            <path className="lp-spark-area" d="M0 112 L52 104 L104 88 L156 96 L208 70 L260 78 L312 52 L364 58 L416 36 L468 42 L520 24 L520 150 L0 150 Z" />
            <path className="lp-spark-line" d="M0 112 L52 104 L104 88 L156 96 L208 70 L260 78 L312 52 L364 58 L416 36 L468 42 L520 24" />
            <circle cx="520" cy="24" r="5" className="lp-spark-dot" />
          </svg>
          <div className="lp-form-row" aria-label="Son beş sonuç">
            <span className="is-win">G</span><span className="is-win">G</span><span className="is-draw">B</span>
            <span className="is-loss">M</span><span className="is-win">G</span>
          </div>
        </div>

        <div className="lp-tv-stats">
          <div><span>Gol / maç</span><b>2.12</b><em>Lig ort. 1.54</em></div>
          <div><span>Yenilen / maç</span><b>1.08</b><em>Lig ort. 1.31</em></div>
          <div><span>Kapsam</span><b>%86</b><em>Sezon telemetrisi</em></div>
        </div>
      </div>

      <div className="lp-tv-list">
        <div className="lp-tv-list-head"><span>Uygunluk</span><span>Durum</span></div>
        <div><span>S. Guirassy</span><span className="lp-tag is-ok">Formda</span></div>
        <div><span>J. Brandt</span><span className="lp-tag is-warn">Sakatlık riski</span></div>
        <div><span>K. Adeyemi</span><span className="lp-tag">Ceza sınırı</span></div>
      </div>
    </div>
  );
}

function ResultsView() {
  return (
    <div className="lp-res">
      <div className="lp-res-summary">
        <div><span>Sonuçlanan analiz</span><b>12</b></div>
        <div><span>Tutan</span><b>7</b></div>
        <div><span>Oran</span><b>%58</b></div>
        <p>Yalnızca iç kontrolden geçmiş, sonuçlanmış tahminler. Örnek veri.</p>
      </div>
      <div className="lp-res-list">
        <div className="lp-res-row">
          <div><b>MS 2,5 Üst</b><span>BVB — SCF · 09.11</span></div>
          <span className="lp-res-badge is-win">Kazandı</span>
        </div>
        <div className="lp-res-row">
          <div><b>KG Var</b><span>SCF — B04 · 02.11</span></div>
          <span className="lp-res-badge is-win">Kazandı</span>
        </div>
        <div className="lp-res-row">
          <div><b>İY 1,5 Alt</b><span>VFB — BVB · 26.10</span></div>
          <span className="lp-res-badge is-loss">Kaybetti</span>
        </div>
        <div className="lp-res-row">
          <div><b>MS 1</b><span>BVB — RBL · 19.10</span></div>
          <span className="lp-res-badge is-pending">Bekliyor</span>
        </div>
      </div>
    </div>
  );
}

export function LandingPage({ navigate }: { navigate: Navigate }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const tiltRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [productTab, setProductTab] = useState<TabId>("match");
  const [activeTier, setActiveTier] = useState(0);
  const [activeStep, setActiveStep] = useState(0);

  const tier: Tier = TIERS[activeTier] ?? TIERS[0];

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const items = Array.from(root.querySelectorAll<HTMLElement>(".lp-rv"));
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || !("IntersectionObserver" in window)) {
      items.forEach((item) => item.classList.add("lp-in"));
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("lp-in");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1, rootMargin: "0px 0px -5% 0px" }
    );
    items.forEach((item) => observer.observe(item));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const steps = Array.from(rootRef.current?.querySelectorAll<HTMLElement>("[data-step]") ?? []);
    if (!steps.length || !("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const index = Number((entry.target as HTMLElement).dataset.step ?? "0");
          if (!Number.isNaN(index)) setActiveStep(index);
        });
      },
      { rootMargin: "-42% 0px -46% 0px", threshold: 0 }
    );
    steps.forEach((step) => observer.observe(step));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const wrap = tiltRef.current;
    const card = cardRef.current;
    if (!wrap || !card) return;
    if (
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      window.matchMedia("(pointer: coarse)").matches
    ) {
      return;
    }
    let frame = 0;
    const onMove = (event: PointerEvent) => {
      const rect = wrap.getBoundingClientRect();
      const px = (event.clientX - rect.left) / rect.width;
      const py = (event.clientY - rect.top) / rect.height;
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        card.style.setProperty("--ry", `${(px - 0.5) * 5.5}deg`);
        card.style.setProperty("--rx", `${(0.5 - py) * 4.5}deg`);
        card.style.setProperty("--mx", `${px * 100}%`);
        card.style.setProperty("--my", `${py * 100}%`);
      });
    };
    const onLeave = () => {
      window.cancelAnimationFrame(frame);
      card.style.setProperty("--ry", "0deg");
      card.style.setProperty("--rx", "0deg");
      card.style.setProperty("--mx", "50%");
      card.style.setProperty("--my", "30%");
    };
    wrap.addEventListener("pointermove", onMove);
    wrap.addEventListener("pointerleave", onLeave);
    return () => {
      window.cancelAnimationFrame(frame);
      wrap.removeEventListener("pointermove", onMove);
      wrap.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  useEffect(() => {
    const nav = rootRef.current?.querySelector<HTMLElement>(".lp-nav");
    if (!nav) return;
    const onScroll = () => nav.classList.toggle("is-scrolled", window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const previous = document.documentElement.style.scrollBehavior;
    document.documentElement.style.scrollBehavior = "smooth";
    return () => {
      document.documentElement.style.scrollBehavior = previous;
    };
  }, []);

  const onTabKey = (event: ReactKeyboardEvent<HTMLButtonElement>, id: TabId) => {
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const current = TABS.findIndex((tab) => tab.id === id);
    let next = current;
    if (event.key === "ArrowRight") next = (current + 1) % TABS.length;
    if (event.key === "ArrowLeft") next = (current - 1 + TABS.length) % TABS.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = TABS.length - 1;
    const tab = TABS[next];
    if (!tab) return;
    setProductTab(tab.id);
    tabRefs.current[next]?.focus();
  };

  return (
    <div className="lp" ref={rootRef}>
      <a className="lp-skip" href="#akis">İçeriğe geç</a>

      <header className="lp-nav">
        <div className="lp-wrap lp-nav-in">
          <a
            className="lp-brand"
            href="#top"
            onClick={(event) => {
              event.preventDefault();
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          >
            <Mark size={26} />
            <span>Skor<i>IQ</i></span>
          </a>

          <nav className="lp-nav-links" aria-label="Ana menü">
            <a href="#akis">Analiz Akışı</a>
            <a href="#urun">Ürün</a>
            <a href="#skala">Karar Skalası</a>
            <a href="#prensipler">İlkeler</a>
          </nav>

          <div className="lp-nav-actions">
            <button className="lp-nav-login" type="button" onClick={() => navigate("/login")}>Giriş Yap</button>
            <button className="lp-btn lp-btn--sm" type="button" onClick={() => navigate("/register")}>
              Ücretsiz Başla <Arrow />
            </button>
          </div>
        </div>
      </header>

      <main>
        {/* ——— HERO ——— */}
        <section className="lp-hero" id="top">
          <div className="lp-wrap lp-hero-grid">
            <div className="lp-hero-copy">
              <p className="lp-kicker lp-an">Taktik Analiz Tahtası — 26. Hafta</p>
              <p className="lp-motto lp-an">«Veriyle Okunan Maçlar, Nedenleriyle Açıklanan Tahminler»</p>
              <h1 className="lp-display lp-an">
                Her pasın<br />
                bir gerekçesi<br />
                vardır<span className="lp-dot">.</span>
              </h1>
              <p className="lp-lead lp-an">
                SkorIQ; takım formu, gol profili, H2H bağlamı, veri kapsamı ve risk sinyallerini birlikte
                değerlendirir. <b>Bot gibi sonuç vermez.</b> Veriyi okur, sinyali ayrıştırır, gerekçeyi açıklar.
              </p>
              <div className="lp-actions lp-an">
                <button className="lp-btn lp-btn--primary" type="button" onClick={() => navigate("/register")}>
                  Ücretsiz Hesap Oluştur <Arrow />
                </button>
                <button className="lp-btn lp-btn--ghost" type="button" onClick={() => navigate("/login")}>
                  Giriş Yap
                </button>
              </div>
              <p className="lp-trust lp-an">
                <b>Kesin sonuç vaadi yoktur;</b> SkorIQ yalnızca veriye dayalı analiz ve yorum desteği sunar.
                Sahanın üstüne analistin gözüyle bakar.
              </p>
              <div className="lp-hero-meta lp-an" aria-label="Sistem özeti">
                <span><b>5</b> adımlı protokol</span>
                <span><b>8</b> lig</span>
                <span><b>0</b> varsayım</span>
              </div>
            </div>

            <div className="lp-dossier-wrap lp-an" ref={tiltRef}>
              <DossierCard cardRef={cardRef} />
            </div>
          </div>

          <div className="lp-wrap">
            <div className="lp-leagues lp-an" aria-label="İzlenen ligler">
              <span className="lp-leagues-label">İzlenen Ligler — 08</span>
              <ul>
                {LEAGUES.map((league) => (
                  <li key={`${league.code}-${league.name}`}>
                    <span className="lp-league-code">{league.code}</span>
                    {league.name}
                    <i className={league.on ? "is-on" : ""} aria-hidden="true" />
                    <span className="lp-sr">{league.on ? "Aktif takip" : "İzlemede"}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* ——— AKIŞ ——— */}
        <section className="lp-sec" id="akis">
          <div className="lp-wrap lp-flow">
            <div className="lp-flow-head lp-rv">
              <p className="lp-kicker">Analiz Akışı — Maç Önü Protokolü</p>
              <h2 className="lp-h2">Bot gibi sonuç yok.<br />Uçtan uca gerekçe var.</h2>
              <p className="lp-lead">
                Her maç aynı beş adımlı hattan geçer. Hiçbir adım atlanmaz; eksik veri varsayımla kapatılmaz.
              </p>
              <div className="lp-flow-index" aria-hidden="true">
                <span>{String(activeStep + 1).padStart(2, "0")}</span>
                <i />
                <span>05</span>
              </div>
            </div>

            <ol className="lp-steps">
              {FLOW.map((step, index) => (
                <li key={step.no} data-step={index} className={index === activeStep ? "is-active" : ""}>
                  <span className="lp-step-no">{step.no}</span>
                  <div className="lp-step-copy">
                    <h3>{step.title}</h3>
                    <p>{step.text}</p>
                  </div>
                  <span className="lp-step-dot" aria-hidden="true" />
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ——— ÜRÜN ——— */}
        <section className="lp-product" id="urun">
          <div className="lp-wrap">
            <header className="lp-sec-head lp-rv">
              <p className="lp-kicker">Analiz Ekranından Bir Kesit</p>
              <h2 className="lp-h2">Analizi gör. Gerekçeyi oku.</h2>
              <p className="lp-lead">
                Kapsam, form, H2H ve risk sinyalleri tek ekranda. Her sayının arkasında bir açıklama,
                her önerinin arkasında bir gerekçe var.
              </p>
            </header>

            <div className="lp-tabs lp-rv" role="tablist" aria-label="Ürün ekranları">
              {TABS.map((tab, index) => (
                <button
                  key={tab.id}
                  ref={(element) => { tabRefs.current[index] = element; }}
                  type="button"
                  role="tab"
                  id={`lp-tab-${tab.id}`}
                  aria-selected={productTab === tab.id}
                  aria-controls={`lp-panel-${tab.id}`}
                  tabIndex={productTab === tab.id ? 0 : -1}
                  className={productTab === tab.id ? "is-active" : ""}
                  onClick={() => setProductTab(tab.id)}
                  onKeyDown={(event) => onTabKey(event, tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div
              className="lp-app lp-rv"
              role="tabpanel"
              id={`lp-panel-${productTab}`}
              aria-labelledby={`lp-tab-${productTab}`}
            >
              <div className="lp-app-bar">
                <div className="lp-app-brand">
                  <Mark size={18} />
                  <span>Skor<i>IQ</i></span>
                </div>
                <div className="lp-app-nav" aria-hidden="true">
                  <span className={productTab === "match" ? "is-on" : ""}>Maç Analizi</span>
                  <span className={productTab === "team" ? "is-on" : ""}>Takım Profili</span>
                  <span className={productTab === "results" ? "is-on" : ""}>Sonuçlar</span>
                </div>
                <div className="lp-app-user">
                  <span className="lp-app-role">ÜYE</span>
                  <span className="lp-avatar">MK</span>
                </div>
              </div>
              <div className="lp-app-body">
                {productTab === "match" ? <MatchView /> : null}
                {productTab === "team" ? <TeamView /> : null}
                {productTab === "results" ? <ResultsView /> : null}
              </div>
            </div>

            <p className="lp-figcaption lp-rv">
              Örnek ekran görüntüsü — tasarım önizlemesidir, gerçek maç verisi içermez.
            </p>

            <div className="lp-features lp-rv">
              <div className="lp-features-head">
                <span>Platform Özellikleri</span>
                <span>06 modül</span>
              </div>
              <ul>
                {FEATURES.map((feature) => (
                  <li key={feature.no}>
                    <span>{feature.no}</span>
                    <b>{feature.title}</b>
                    <em>{feature.text}</em>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* ——— GECE ——— */}
        <section className="lp-night" id="gece">
          <span className="lp-night-glow" aria-hidden="true" />
          <span className="lp-night-rail" aria-hidden="true" />
          <div className="lp-wrap lp-night-grid">
            <div className="lp-night-copy lp-rv">
              <p className="lp-kicker lp-kicker--night">21:45 — Projektör</p>
              <h2 className="lp-h2">Işık değişir.<br />Gerekçe değişmez.</h2>
              <p className="lp-night-lead">
                Canlı maç, gece, düşük ışık. Aynı analiz, aynı token omurgası; yalnızca pozlama değişir.
                Sarı karanlıkta bir tık açılır, gerekçe aynı kalır.
              </p>
              <div className="lp-night-legend">
                <span><i aria-hidden="true" />Canlı maç</span>
                <span><i aria-hidden="true" />Gece yüzeyi</span>
                <span><i aria-hidden="true" />Tek omurga</span>
              </div>
            </div>

            <div className="lp-score lp-rv">
              <div className="lp-score-top">
                <span className="lp-live"><i aria-hidden="true" />Canlı</span>
                <span>78'</span>
              </div>
              <div className="lp-score-main">
                <div className="lp-score-team"><b>BVB</b><span>Dortmund</span></div>
                <div className="lp-score-num">2<span>—</span>1</div>
                <div className="lp-score-team is-away"><b>SCF</b><span>Freiburg</span></div>
              </div>
              <div className="lp-score-stats">
                <div><span>xG</span><b>1.84</b><em>1.12</em></div>
                <div><span>Topla Oynama</span><b>58</b><em>42</em></div>
                <div><span>Şut</span><b>16</b><em>9</em></div>
              </div>
              <div className="lp-score-pick">
                <span>Tahminim</span>
                <b>MS 2,5 Üst</b>
                <span>Güven 82</span>
              </div>
            </div>
          </div>
        </section>

        {/* ——— SKALA ——— */}
        <section className="lp-sec" id="skala">
          <div className="lp-wrap">
            <header className="lp-sec-head lp-rv">
              <p className="lp-kicker">Karar Skalası — Dört Seviye</p>
              <h2 className="lp-h2">Dört seviye. Tek kural: şeffaflık.</h2>
              <p className="lp-lead">
                Her aday, sinyal desteğine ve risk durumuna göre derecelendirilir. Öneri olmayan seviye,
                öneri gibi gösterilmez.
              </p>
            </header>

            <div className="lp-scale lp-rv" role="group" aria-label="Karar seviyeleri">
              {TIERS.map((item, index) => (
                <button
                  key={item.id}
                  type="button"
                  className={`lp-tier tone-${item.tone}${activeTier === index ? " is-active" : ""}`}
                  aria-pressed={activeTier === index}
                  onClick={() => setActiveTier(index)}
                >
                  <span className="lp-tier-top">
                    <span className="lp-tier-sq" aria-hidden="true" />
                    <span className="lp-tier-name">{item.name}</span>
                  </span>
                  <span className="lp-tier-role">{item.role}</span>
                  <span className="lp-tier-pick">{item.pick}</span>
                  <span className="lp-tier-conf">{item.confidence > 0 ? `Güven ${item.confidence}` : "Öneri değil"}</span>
                </button>
              ))}
            </div>

            <div className="lp-tier-detail" key={tier.id} aria-live="polite">
              <div className="lp-tier-sum">
                <span className={`lp-tier-badge tone-${tier.tone}`}>{tier.name}</span>
                <h3>{tier.summary}</h3>
                <p>{tier.detail}</p>
              </div>
              <ul className="lp-reasons">
                {tier.reasons.map((reason) => (
                  <li key={reason.text} className={`kind-${reason.kind}`}>
                    <KindIcon kind={reason.kind} />
                    <span>{reason.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* ——— İLKELER ——— */}
        <section className="lp-sec lp-sec--principles" id="prensipler">
          <div className="lp-wrap">
            <header className="lp-sec-head lp-rv">
              <p className="lp-kicker">Tahta Kuralları — Tavizsiz Üç İlke</p>
              <h2 className="lp-h2">SkorIQ farkı nedir?</h2>
              <p className="lp-lead">
                SkorIQ bir tahmin botu değil; veri okuryazarlığı aracıdır. Üç kural tahtadan asla kaldırılmaz.
              </p>
            </header>

            <div className="lp-principles">
              <article className="lp-principle lp-rv">
                <span className="lp-principle-no">01</span>
                <h3>Veri Kapsamı</h3>
                <p>
                  Her maçta veri yeterliliği ayrı değerlendirilir. Yetersiz veri varsayımla kapatılmaz;
                  kapsam düştükçe güven tavanı da düşer.
                </p>
                <div className="lp-cov" aria-hidden="true">
                  <div className="lp-cov-head"><span>Kapsam</span><b>%64</b></div>
                  <div className="lp-cov-bar"><i style={{ width: "64%" }} /></div>
                  <div className="lp-cov-foot"><span>H2H eksik</span><span>Tavan 82</span></div>
                </div>
              </article>

              <article className="lp-principle lp-rv">
                <span className="lp-principle-no">02</span>
                <h3>Tutarlılık Kontrolü</h3>
                <p>
                  Çelişen tahminler öneri olarak gösterilmez. Çelişen adaylar otomatik olarak
                  “Uzak Dur” seviyesine indirilir.
                </p>
                <div className="lp-conflict" aria-hidden="true">
                  <span>MS 2,5 Üst</span>
                  <i>≠</i>
                  <span>İY 1,5 Alt</span>
                  <em>Uzak Dur</em>
                </div>
              </article>

              <article className="lp-principle lp-rv">
                <span className="lp-principle-no">03</span>
                <h3>Açıklanabilir Yorum</h3>
                <p>
                  Tahminler sinyal ve risk açıklamalarıyla desteklenir, gerekçelendirilir.
                  Gerekçesiz çıktı yayınlanmaz.
                </p>
                <div className="lp-quote" aria-hidden="true">
                  <span>“Form güçlü, H2H yok.”</span>
                  <em>Güven tavanı: 82</em>
                </div>
              </article>
            </div>
          </div>
        </section>

        {/* ——— ÜYELİK ——— */}
        <section className="lp-sec" id="uyelik">
          <div className="lp-wrap lp-membership">
            <div className="lp-rv">
              <p className="lp-kicker">Üyelik</p>
              <h2 className="lp-h2">Üye olduğunda ne görürsün?</h2>
              <p className="lp-lead">
                Hesap oluşturmak ücretsizdir. Analizler; kapsam, sinyal ve risk notlarıyla birlikte gelir.
              </p>
              <ul className="lp-benefits">
                {[
                  "Yaklaşan maç analizleri",
                  "SkorIQ Tahmin Yorumu",
                  "Veri kapsamı ve güven tavanı",
                  "Takım formu ve gol profili",
                  "H2H ve risk sinyalleri",
                  "Lig ve takım detayları"
                ].map((benefit) => (
                  <li key={benefit}><Check />{benefit}</li>
                ))}
              </ul>
              <button className="lp-btn lp-btn--primary" type="button" onClick={() => navigate("/register")}>
                Ücretsiz Hesap Oluştur <Arrow />
              </button>
            </div>

            <aside className="lp-archive lp-rv">
              <div className="lp-archive-top">
                <span className="lp-tag">Arşiv · Hazırlanıyor</span>
                <span className="lp-archive-mark" aria-hidden="true">∅</span>
              </div>
              <h3>Başarılı tahmin arşivi yakında</h3>
              <p>
                Yalnızca sonuçlanmış ve iç kontrolden geçmiş tahminler, şeffaf bir arşivde
                yayınlanacaktır.
              </p>
              <div className="lp-archive-rows" aria-hidden="true">
                <div><span /><span /><span /></div>
                <div><span /><span /><span /></div>
                <div><span /><span /><span /></div>
              </div>
              <span className="lp-archive-foot">Yayınlandığında burada olacak.</span>
            </aside>
          </div>
        </section>

        {/* ——— CTA ——— */}
        <section className="lp-cta">
          <div className="lp-wrap lp-cta-in lp-rv">
            <p className="lp-kicker lp-kicker--ink">Tahtaya Dön</p>
            <h2 className="lp-h2">Analiz hazır olduğunda <span>ilk sen</span> gör.</h2>
            <p>
              Yaklaşan maçların veri kapsamını, sinyallerini ve risk uyarılarını tek tahtada takip et.
            </p>
            <div className="lp-actions">
              <button className="lp-btn lp-btn--ink" type="button" onClick={() => navigate("/register")}>
                Ücretsiz Hesap Oluştur <Arrow />
              </button>
              <button className="lp-btn lp-btn--outline" type="button" onClick={() => navigate("/login")}>
                Giriş Yap
              </button>
            </div>
            <p className="lp-cta-note">Hesap oluşturmak ücretsizdir · Kesin sonuç vaadi yoktur</p>
          </div>
        </section>
      </main>

      {/* ——— FOOTER ——— */}
      <footer className="lp-footer">
          <div className="lp-wrap">
            <div className="lp-footer-grid">
              <div className="lp-footer-brand">
                <a
                  className="lp-brand lp-brand--footer"
                  href="#top"
                  onClick={(event) => {
                    event.preventDefault();
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                >
                  <Mark size={26} />
                  <span>Skor<i>IQ</i></span>
                </a>
                <p>
                  Maçı form, gol profili, H2H ve risk sinyalleriyle okuyan; gördüğünü gerekçesiyle yazan
                  veri destekli analiz. SkorIQ bir tahmin botu değildir.
                </p>
              </div>
              <div className="lp-footer-col">
                <span>Ürün</span>
                <a href="#akis">Analiz Akışı</a>
                <a href="#urun">Ürün</a>
                <a href="#skala">Karar Skalası</a>
                <a href="#prensipler">İlkeler</a>
              </div>
              <div className="lp-footer-col">
                <span>Hesap</span>
                <button type="button" onClick={() => navigate("/login")}>Giriş Yap</button>
                <button type="button" onClick={() => navigate("/register")}>Kayıt Ol</button>
              </div>
            </div>
            <p className="lp-disclaimer">
              SkorIQ, istatistiksel modelleme ve veri destekli analizlerle hazırlanır. Bu bir kesin sonuç
              garantisi değildir.
            </p>
            <div className="lp-footer-bottom">
              <span>© 2026 SkorIQ</span>
              <span className="lp-footer-legal">
                <button type="button">Gizlilik</button>
                <button type="button">Kullanım Şartları</button>
                <button type="button">Sorumluluk Reddi</button>
              </span>
            </div>
          </div>
        </footer>
    </div>
  );
}
