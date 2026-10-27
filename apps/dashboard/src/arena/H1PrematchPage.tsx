import { useEffect, useMemo, useState } from "react";
import type { H1PrematchItem, H1PrematchResponse } from "../types";
import { fetchH1MatchPrediction, fetchH1UpcomingPredictions } from "../api";
import { TeamLogo } from "../components";
import { H1CouponButton } from "./H1CouponButton";
import "./rc-prematch.css";
import "./h1-prematch.css";

const ISTANBUL = "Europe/Istanbul";
const DISCLAIMER = "Tahminler kesin sonuç garantisi değildir.";

function istanbul(value: string): string {
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: ISTANBUL,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

export function H1PredictionCard({ item, navigate }: { item: H1PrematchItem; navigate?: (path: string) => void }) {
  const isSafe = item.h1.pGoal >= 0.75;
  return <article className={`rc-simple-card h1-card${isSafe ? "" : " h1-card--risky"}`}>
    <header className="rc-simple-card__head">
      <span className="rc-simple-card__league h1-card__league">{item.league}</span>
      <time dateTime={item.kickoffAt}>{istanbul(item.kickoffAt)} <small>TSİ</small></time>
    </header>

    <div className="rc-simple-teams">
      <div className="rc-simple-team">
        <TeamLogo name={item.homeTeam} logoUrl={item.homeTeamLogoUrl} size="sm" />
        <strong>{item.homeTeam}</strong>
      </div>
      <span className="rc-simple-vs" aria-hidden="true">–</span>
      <div className="rc-simple-team rc-simple-team--away">
        <TeamLogo name={item.awayTeam} logoUrl={item.awayTeamLogoUrl} size="sm" />
        <strong>{item.awayTeam}</strong>
      </div>
    </div>

    <p className={`rc-simple-pick h1-card__pick${isSafe ? "" : " h1-card__pick--risky"}`}>{item.h1.predictionText}</p>

    <footer className="rc-simple-card__foot">
      <H1CouponButton item={item} />
      {navigate ? <button className="rc-simple-detail" type="button" onClick={() => navigate(`/football/analytics/${item.matchId}`)}>Maç detayı <span aria-hidden="true">→</span></button> : null}
    </footer>
  </article>;
}

export function H1UpcomingPage({ navigate }: { navigate: (path: string) => void }) {
  const [data, setData] = useState<H1PrematchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [leagueFilter, setLeagueFilter] = useState("all");
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    fetchH1UpcomingPredictions().then((value) => { if (!cancelled) setData(value); })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : "Tahminler yüklenemedi."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);
  const leagues = useMemo(() => {
    const byId = new Map<string, { competitionId: string; league: string; count: number }>();
    for (const item of data?.items ?? []) {
      const current = byId.get(item.competitionId) ?? { competitionId: item.competitionId, league: item.league, count: 0 };
      current.count += 1;
      byId.set(item.competitionId, current);
    }
    return [...byId.values()].sort((a, b) => a.league.localeCompare(b.league, "tr"));
  }, [data]);
  const filtered = useMemo(() => (data?.items ?? []).filter((item) => leagueFilter === "all" || item.competitionId === leagueFilter), [data, leagueFilter]);
  const groups = useMemo(() => leagues
    .map((league) => ({ ...league, items: filtered.filter((item) => item.competitionId === league.competitionId) }))
    .filter((group) => group.items.length > 0), [leagues, filtered]);
  const strongCount = useMemo(() => filtered.filter((item) => item.h1.pGoal >= 0.75).length, [filtered]);

  return <div className="rc-page h1-page">
    <header className="rc-hero h1-hero">
      <div>
        <span className="rc-eyebrow h1-eyebrow">SkorIQ • Volt ilk yarı gol motoru</span>
        <h1>İlk Yarı Gol Tahminleri</h1>
        <p>Volt'un her maç için ilk yarı gol olasılığı. Beğendiğin seçimi kuponuna ekle.</p>
        {navigate ? <button type="button" className="h1-engine-switch" onClick={() => navigate("/football/predictions/upcoming")}>Trey maç sonucu tahminleri <span aria-hidden="true">→</span></button> : null}
      </div>
      {data && data.items.length > 0 ? <div className="h1-hero__stat" aria-label="Güçlü sinyal sayısı">
        <strong>{strongCount}</strong>
        <span>güçlü sinyal</span>
      </div> : null}
    </header>

    {loading ? <div className="rc-state" role="status">Tahminler yükleniyor…</div> : null}
    {error ? <div className="rc-state rc-state--error" role="alert"><strong>Tahminler yüklenemedi.</strong><span>{error}</span></div> : null}
    {!loading && !error && data && data.items.length === 0 ? <div className="rc-state">Şu anda yayımlanmış yaklaşan ilk yarı tahmini yok.</div> : null}
    {data && data.items.length > 0 ? <>
      <div className="rc-summary"><strong>{filtered.length}</strong> maç</div>
      {leagues.length > 1 ? <div className="rc-league-filter" aria-label="Lig filtresi">
        <span>Lig</span>
        <div role="group" aria-label="Lig seçimi">
          <button type="button" aria-pressed={leagueFilter === "all"} onClick={() => setLeagueFilter("all")}>Tümü <small>{data.items.length}</small></button>
          {leagues.map((league) => <button key={league.competitionId} type="button" aria-pressed={leagueFilter === league.competitionId} onClick={() => setLeagueFilter(league.competitionId)}>{league.league} <small>{league.count}</small></button>)}
        </div>
      </div> : null}
      {groups.map((group) => <section className="rc-league-group" key={group.competitionId} aria-labelledby={`h1-league-${group.competitionId}`}>
        <div className="rc-league-group__head"><h2 id={`h1-league-${group.competitionId}`}>{group.league}</h2><span>{group.items.length} maç</span></div>
        <div className="rc-grid">{group.items.map((item) => <H1PredictionCard key={item.matchId} item={item} navigate={navigate} />)}</div>
      </section>)}
      {data.items[0]?.performanceNote ? <p className="h1-perf">{data.items[0].performanceNote}</p> : null}
    </> : null}
    <p className="rc-footnote">{DISCLAIMER}</p>
  </div>;
}

export function H1MatchPrediction({ matchId }: { matchId: string }) {
  const [item, setItem] = useState<H1PrematchItem | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchH1MatchPrediction(matchId).then((value) => { if (!cancelled) setItem(value); }).catch(() => { if (!cancelled) setItem(null); });
    return () => { cancelled = true; };
  }, [matchId]);
  if (!item) return null;
  return <section className="rc-detail"><div className="rc-section-title"><span>Maç öncesi</span><h2>İlk yarı gol tahmini</h2></div><H1PredictionCard item={item} /></section>;
}
