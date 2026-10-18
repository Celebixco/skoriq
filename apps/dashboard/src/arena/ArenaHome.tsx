import { useEffect, useId, useRef, useState } from "react";
import type { DashboardOverviewResponse } from "../types";
import { ArenaMatchCard, ArenaPredictionCard, ArenaStateCard, ArrowIcon } from "./ArenaMatchCards";
import { availablePredictions, sampleFeaturedMatch, sampleMatches, samplePrediction, type ArenaMatch, type LoadState } from "./home-data";
import "./home.css";
import { ArenaAmbient } from "./ArenaAmbient";

export type { LoadState } from "./home-data";

export interface ArenaHomeProps {
  overview: LoadState<DashboardOverviewResponse>;
  navigate: (path: string) => void;
  authenticated: boolean;
}

type MatchFilter = "all" | "ready" | "upcoming";

export function ArenaHome({ overview, navigate, authenticated }: ArenaHomeProps) {
  const [filter, setFilter] = useState<MatchFilter>("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const demo = !authenticated && !overview.data && !overview.loading && !overview.error;
  const data = !overview.loading && !overview.error ? overview.data : null;
  const predictions = availablePredictions(data);
  const matches: ArenaMatch[] = demo ? sampleMatches : data?.upcomingMatches ?? [];
  const featured = demo ? sampleFeaturedMatch : matches.find((match) => predictions.has(match.matchId)) ?? matches[0];
  const prediction = demo ? samplePrediction : featured ? predictions.get(featured.matchId) : undefined;
  const openMatch = (match?: ArenaMatch) => navigate(authenticated ? match ? `/football/analytics/${encodeURIComponent(match.matchId)}` : "/football/analytics" : "/register");
  const normalizedQuery = query.trim().toLocaleLowerCase("tr-TR");
  const hasPrediction = (match: ArenaMatch) => demo ? match.hasPredictionPreview : predictions.has(match.matchId);
  const filtered = matches.filter((match) => {
    const readinessMatches = filter === "all" || (filter === "ready" ? hasPrediction(match) : !hasPrediction(match));
    const searchMatches = `${match.homeTeam.name} ${match.awayTeam.name} ${match.competition.name}`.toLocaleLowerCase("tr-TR").includes(normalizedQuery);
    return readinessMatches && searchMatches;
  });

  useEffect(() => { if (filtersOpen) searchRef.current?.focus(); }, [filtersOpen]);

  return <div className={`arena-home${demo ? " arena-home-demo" : ""}`}>
    <section className="arena-hero" aria-labelledby="arena-heading">
      <ArenaAmbient />
      <div className="arena-hero-content">
        <div className="arena-hero-copy">
          <p className="arena-eyebrow">Maç gecesi</p>
          <h1 id="arena-heading">BU GECE,<br />MAÇI OKU.</h1>
          <p className="arena-hero-description">Tahminin arkasındaki hikâyeyi keşfet.</p>
          <button className="arena-primary-action" type="button" onClick={() => openMatch(featured)}>Günün analizini aç<ArrowIcon /></button>
          {demo ? <span className="arena-hero-note">Ücretsiz hesap oluştur, maçın ötesini gör.</span> : null}
        </div>
        <div className="arena-featured-wrap">
          {featured ? <ArenaPredictionCard match={featured} prediction={prediction} onOpen={() => openMatch(featured)} /> : <ArenaStateCard loading={overview.loading} error={Boolean(overview.error)} onOpen={() => openMatch()} />}
        </div>
      </div>
      <svg className="arena-tactics" viewBox="0 0 420 180" fill="none" aria-hidden="true"><path d="M40 112c-17-28 56-57 108-34m-5-6 10 9-15 2M46 120c35 25 91 8 109-10m-6-4 12 2-5 10M234 125l65-67m-12 4 15-9-2 16M190 143c0 14-35 21-44 11s21-24 35-18M284 42c13-29 79-37 99-17m-7-10 12 12-16 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /><path d="m201 79 11 11m0-11-11 11m119 49 13 13m0-13-13 13" stroke="currentColor" strokeWidth="2" /><ellipse cx="215" cy="41" rx="9" ry="5" stroke="currentColor" strokeWidth="1.8" /></svg>
    </section>

    <section className="arena-fixtures" aria-labelledby="arena-fixtures-title">
      <div className="arena-fixtures-toolbar">
        <div className="arena-fixtures-heading"><h2 id="arena-fixtures-title">Günün maçları</h2>{demo ? <span className="arena-sample-label">Örnek karşılaşmalar</span> : null}</div>
        <div className="arena-filter-group" role="group" aria-label="Maç durumu">
          {([{ value: "all", label: "Hepsi" }, { value: "ready", label: "Tahmin hazır" }, { value: "upcoming", label: "Yakında" }] as const).map((item) => <button type="button" key={item.value} aria-pressed={filter === item.value} className={filter === item.value ? "is-active" : ""} onClick={() => setFilter(item.value)}>{item.label}</button>)}
        </div>
        <button className={`arena-filter-toggle${filtersOpen ? " is-active" : ""}`} type="button" aria-expanded={filtersOpen} aria-controls={`${searchId}-panel`} onClick={() => setFiltersOpen((value) => !value)}><svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 6h18M6 12h12m-8 6h4M8 3v6m8 0v6m-4 0v6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>Filtrele<svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m5 8 5 5 5-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
      </div>
      <div className="arena-search-panel" id={`${searchId}-panel`} hidden={!filtersOpen}>
        <label htmlFor={searchId}>Takım veya lig ara</label>
        <div><input ref={searchRef} id={searchId} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Takım, karşılaşma veya lig" autoComplete="off" />{query ? <button type="button" onClick={() => setQuery("")}>Temizle</button> : null}</div>
      </div>
      {overview.loading ? <div className="arena-fixture-state" role="status"><span className="arena-loading-line" /><p>Günün maçları yükleniyor…</p></div> : overview.error ? <div className="arena-fixture-state" role="alert"><strong>Maçlar şu anda yüklenemedi.</strong><p>Veri bağlantısı yeniden kurulduğunda karşılaşmalar burada görünecek.</p></div> : filtered.length ? <div className="arena-match-grid">{filtered.slice(0, 3).map((match) => <ArenaMatchCard key={match.matchId} match={match} hasPrediction={hasPrediction(match)} onOpen={() => openMatch(match)} />)}</div> : <div className="arena-fixture-state" role="status"><strong>{matches.length ? "Bu filtreye uygun maç bulunamadı." : "Henüz gösterilecek karşılaşma yok."}</strong><p>{matches.length ? "Başka bir takım veya lig arayabilir, Hepsi filtresini seçebilirsin." : "Yeni maçlar ve analizler hazır olduğunda burada yer alacak."}</p></div>}
      <footer className="arena-fixtures-footer"><p><svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.3" /><path d="M10 9v5m0-8v.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>Güven skoru kazanma olasılığı değildir.</p>{filtered.length > 3 ? <button type="button" className="arena-text-action" onClick={() => openMatch()}>Tüm maçlar<ArrowIcon /></button> : demo ? <span>Örnek veriler</span> : null}</footer>
    </section>
    <p className="arena-safety-note">Bu bir maç analizi raporudur, nihai tahmin değildir. Analizler kesin sonuç garantisi vermez.</p>
  </div>;
}
