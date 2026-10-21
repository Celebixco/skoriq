import { useEffect, useState } from "react";
import type { RcPrematchItem, RcPrematchResponse } from "../types";
import { fetchRcMatchPrediction, fetchRcUpcomingPredictions } from "../api";
import "./rc-prematch.css";

const ISTANBUL = "Europe/Istanbul";
const DISCLAIMER = "Deneysel model olasılıklarıdır; sonuç garantisi değildir.";

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function istanbul(value: string): string {
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: ISTANBUL,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function utc(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(value));
}

function Bar({ label, value, tone }: { label: string; value: number; tone: "home" | "draw" | "away" }) {
  return <div className={`rc-prob rc-prob--${tone}`}>
    <div className="rc-prob__line"><span>{label}</span><strong>{pct(value)}</strong></div>
    <div className="rc-prob__track" aria-hidden="true"><span style={{ width: `${Math.max(1, value * 100)}%` }} /></div>
  </div>;
}

function ProbabilityBlock({ item, comparison = false }: { item: RcPrematchItem; comparison?: boolean }) {
  const p = comparison ? item.ra : item.rc;
  return <div className="rc-probabilities">
    <Bar label="Ev" value={p.p1} tone="home" />
    <Bar label="Beraberlik" value={p.px} tone="draw" />
    <Bar label="Deplasman" value={p.p2} tone="away" />
  </div>;
}

export function RcPredictionCard({ item, navigate }: { item: RcPrematchItem; navigate?: (path: string) => void }) {
  return <article className="rc-card">
    <header className="rc-card__head">
      <div>
        <span className="rc-eyebrow">{item.league}</span>
        <h3>{item.homeTeam} <span>vs</span> {item.awayTeam}</h3>
      </div>
      <span className="rc-beta">R-C • Beta</span>
    </header>

    <div className="rc-card__time">
      <span>{istanbul(item.kickoffAt)} <small>İstanbul</small></span>
      <span>{utc(item.kickoffAt)} <small>UTC</small></span>
    </div>

    <div className="rc-pick">
      <span>R-C seçimi</span>
      <strong>{item.rc.pickLabel}</strong>
    </div>
    <ProbabilityBlock item={item} />

    <div className="rc-meta">
      <span>Model: {item.rc.modelVersion}</span>
      <span>Üretim: {istanbul(item.rc.generatedAt)}</span>
      <span>Yayın: {istanbul(item.rc.publishedAt)}</span>
      <span>Geçmiş: {item.historyHomeN} / {item.historyAwayN}</span>
    </div>

    {item.modelsDisagree ? <p className="rc-disagree">Modeller farklı değerlendiriyor: R-A seçimi {item.ra.pickLabel}.</p> : null}
    {item.dataWarning ? <p className="rc-warning">{item.dataWarning}</p> : null}

    <details className="rc-compare">
      <summary>Model karşılaştırması <span>R-A</span></summary>
      <ProbabilityBlock item={item} comparison />
      <p>R-A seçimi: <strong>{item.ra.pickLabel}</strong></p>
    </details>

    <footer className="rc-card__foot">
      <span>{DISCLAIMER}</span>
      {navigate ? <button type="button" onClick={() => navigate(`/football/analytics/${item.matchId}`)}>Maç detayı →</button> : null}
    </footer>
  </article>;
}

export function RcUpcomingPage({ navigate }: { navigate: (path: string) => void }) {
  const [data, setData] = useState<RcPrematchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    fetchRcUpcomingPredictions().then((value) => { if (!cancelled) setData(value); })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : "Tahminler yüklenemedi."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);
  return <div className="rc-page">
    <header className="rc-hero">
      <div>
        <span className="rc-eyebrow">Süper Lig • iç değerlendirme</span>
        <h1>Yaklaşan Tahminler</h1>
        <p>R-C beta modelinin maç öncesi olasılıkları. Karşılaştırma için R-A aynı kartta açılır.</p>
      </div>
      <div className="rc-hero__badge"><span>Yayın modeli</span><strong>R-C • Beta</strong><small>34 sonuç-temelli özellik</small></div>
    </header>

    {loading ? <div className="rc-state" role="status">Tahminler yükleniyor…</div> : null}
    {error ? <div className="rc-state rc-state--error" role="alert"><strong>Tahminler yüklenemedi.</strong><span>{error}</span></div> : null}
    {!loading && !error && data && data.items.length === 0 ? <div className="rc-state">Şu anda yayımlanmış yaklaşan tahmin yok.</div> : null}
    {data && data.items.length > 0 ? <>
      <div className="rc-summary"><strong>{data.count}</strong> maç • <span>{data.disclaimer}</span></div>
      <div className="rc-grid">{data.items.map((item) => <RcPredictionCard key={item.matchId} item={item} navigate={navigate} />)}</div>
    </> : null}
    <p className="rc-footnote">Tahminler maçtan önce üretilir; canlı sonuç veya bağımsız başarı iddiası değildir. Dış zaman kanıtı yoktur.</p>
  </div>;
}

export function RcMatchPrediction({ matchId }: { matchId: string }) {
  const [item, setItem] = useState<RcPrematchItem | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchRcMatchPrediction(matchId).then((value) => { if (!cancelled) setItem(value); }).catch(() => { if (!cancelled) setItem(null); });
    return () => { cancelled = true; };
  }, [matchId]);
  if (!item) return null;
  return <section className="rc-detail"><div className="rc-section-title"><span>R-C • Beta</span><h2>Maç öncesi model olasılığı</h2></div><RcPredictionCard item={item} /></section>;
}
