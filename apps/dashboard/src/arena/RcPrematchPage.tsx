import { useEffect, useMemo, useState } from "react";
import type { RcPrematchItem, RcPrematchResponse } from "../types";
import { fetchRcMatchPrediction, fetchRcUpcomingPredictions } from "../api";
import { TeamLogo } from "../components";
import { RcCouponButton } from "./RcCouponButton";
import "./rc-prematch.css";

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

export function RcPredictionCard({ item, navigate }: { item: RcPrematchItem; navigate?: (path: string) => void }) {
  return <article className="rc-simple-card">
    <header className="rc-simple-card__head">
      <span className="rc-simple-card__league">{item.league}</span>
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

    <p className="rc-simple-pick">{item.rc.predictionText}</p>

    <footer className="rc-simple-card__foot">
      <RcCouponButton item={item} />
      {navigate ? <button className="rc-simple-detail" type="button" onClick={() => navigate(`/football/analytics/${item.matchId}`)}>Maç detayı <span aria-hidden="true">→</span></button> : null}
    </footer>
  </article>;
}

export function RcUpcomingPage({ navigate }: { navigate: (path: string) => void }) {
  const [data, setData] = useState<RcPrematchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [leagueFilter, setLeagueFilter] = useState("all");
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    fetchRcUpcomingPredictions().then((value) => { if (!cancelled) setData(value); })
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

  return <div className="rc-page">
    <header className="rc-hero">
      <div>
        <span className="rc-eyebrow">SkorIQ • Trey tahmin motoru</span>
        <h1>Yaklaşan Tahminler</h1>
        <p>Trey'in her maç için tek ön tahmini. Beğendiğin seçimi kuponuna ekle.</p>
        {navigate ? <span className="tork-switch-row">
          <button type="button" className="h1-engine-switch" onClick={() => navigate("/football/h1-predictions/upcoming")}>Volt ilk yarı gol <span aria-hidden="true">→</span></button>
          <button type="button" className="h1-engine-switch" onClick={() => navigate("/football/tork-predictions/upcoming")}>Tork karşılıklı gol <span aria-hidden="true">→</span></button>
        </span> : null}
      </div>
    </header>

    {loading ? <div className="rc-state" role="status">Tahminler yükleniyor…</div> : null}
    {error ? <div className="rc-state rc-state--error" role="alert"><strong>Tahminler yüklenemedi.</strong><span>{error}</span></div> : null}
    {!loading && !error && data && data.items.length === 0 ? <div className="rc-state">Şu anda yayımlanmış yaklaşan tahmin yok.</div> : null}
    {data && data.items.length > 0 ? <>
      <div className="rc-summary"><strong>{filtered.length}</strong> maç</div>
      {leagues.length > 1 ? <div className="rc-league-filter" aria-label="Lig filtresi">
        <span>Lig</span>
        <div role="group" aria-label="Lig seçimi">
          <button type="button" aria-pressed={leagueFilter === "all"} onClick={() => setLeagueFilter("all")}>Tümü <small>{data.items.length}</small></button>
          {leagues.map((league) => <button key={league.competitionId} type="button" aria-pressed={leagueFilter === league.competitionId} onClick={() => setLeagueFilter(league.competitionId)}>{league.league} <small>{league.count}</small></button>)}
        </div>
      </div> : null}
      {groups.map((group) => <section className="rc-league-group" key={group.competitionId} aria-labelledby={`rc-league-${group.competitionId}`}>
        <div className="rc-league-group__head"><h2 id={`rc-league-${group.competitionId}`}>{group.league}</h2><span>{group.items.length} maç</span></div>
        <div className="rc-grid">{group.items.map((item) => <RcPredictionCard key={item.matchId} item={item} navigate={navigate} />)}</div>
      </section>)}
    </> : null}
    <p className="rc-footnote">{DISCLAIMER}</p>
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
  return <section className="rc-detail"><div className="rc-section-title"><span>Maç öncesi</span><h2>Tek tahmin</h2></div><RcPredictionCard item={item} /></section>;
}
