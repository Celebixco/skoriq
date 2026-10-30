import { useCallback, useMemo, useState } from "react";
import { formatTorkSelection } from "@sports-data/shared/dist/football-tork-policy.js";
import type { TorkPrematchItem } from "../types";
import { fetchTorkMatchPrediction, fetchTorkUpcomingPredictions } from "../api";
import { TeamLogo } from "../components";
import { TorkCouponButton } from "./TorkCouponButton";
import { useTorkPublication } from "./use-tork-publication";
import "./rc-prematch.css";
import "./tork-prematch.css";

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

export function TorkPredictionCard({ item, navigate }: { item: TorkPrematchItem; navigate?: (path: string) => void }) {
  let selection: ReturnType<typeof formatTorkSelection>;
  try { selection = formatTorkSelection(item.tork.pBtts, item.tork.pick); }
  catch { return null; }
  const isBttsNo = selection.pick === "btts_no";
  // Legacy CSS tokens select the amber KG Yok accent, not a claim of safety/risk.
  return <article data-tork-selection={selection.pick} className={`rc-simple-card tork-card${isBttsNo ? " tork-card--risky" : ""}`}>
    <header className="rc-simple-card__head">
      <span className="rc-simple-card__league tork-card__league">{item.league}</span>
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

    <p className={`rc-simple-pick tork-card__pick${isBttsNo ? " tork-card__pick--risky" : ""}`}>{selection.predictionText}</p>

    <footer className="rc-simple-card__foot">
      <TorkCouponButton item={item} />
      {navigate ? <button className="rc-simple-detail" type="button" onClick={() => navigate(`/football/analytics/${item.matchId}`)}>Maç detayı <span aria-hidden="true">→</span></button> : null}
    </footer>
  </article>;
}

export function TorkUpcomingPage({ navigate }: { navigate: (path: string) => void }) {
  const { data, error, loading } = useTorkPublication(fetchTorkUpcomingPredictions);
  const [leagueFilter, setLeagueFilter] = useState("all");
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
  const bttsYesCount = useMemo(() => filtered.filter((item) => item.tork.pick === "btts_yes").length, [filtered]);

  return <div className="rc-page tork-page">
    <header className="rc-hero tork-hero">
      <div>
        <span className="rc-eyebrow tork-eyebrow">SkorIQ • Tork karşılıklı gol motoru</span>
        <h1>Karşılıklı Gol Tahminleri</h1>
        <p>Tork'un her maç için karşılıklı gol olasılığı. Beğendiğin seçimi kuponuna ekle.</p>
        {navigate ? <span className="tork-switch-row">
          <button type="button" className="h1-engine-switch" onClick={() => navigate("/football/predictions/upcoming")}>Trey maç sonucu <span aria-hidden="true">→</span></button>
          <button type="button" className="h1-engine-switch" onClick={() => navigate("/football/h1-predictions/upcoming")}>Volt ilk yarı gol <span aria-hidden="true">→</span></button>
        </span> : null}
      </div>
      {data && data.items.length > 0 ? <div className="tork-hero__stat" aria-label="KG Var tahmin sayısı">
        <strong>{bttsYesCount}</strong>
        <span>KG Var tahmini</span>
      </div> : null}
    </header>

    {loading ? <div className="rc-state" role="status">Tahminler yükleniyor…</div> : null}
    {error ? <div className="rc-state rc-state--error" role="alert"><strong>Tahminler yüklenemedi.</strong><span>{error}</span></div> : null}
    {!loading && !error && data && data.items.length === 0 ? <div className="rc-state">Şu anda yayımlanmış yaklaşan karşılıklı gol tahmini yok.</div> : null}
    {data && data.items.length > 0 ? <>
      <div className="rc-summary"><strong>{filtered.length}</strong> maç</div>
      {leagues.length > 1 ? <div className="rc-league-filter" aria-label="Lig filtresi">
        <span>Lig</span>
        <div role="group" aria-label="Lig seçimi">
          <button type="button" aria-pressed={leagueFilter === "all"} onClick={() => setLeagueFilter("all")}>Tümü <small>{data.items.length}</small></button>
          {leagues.map((league) => <button key={league.competitionId} type="button" aria-pressed={leagueFilter === league.competitionId} onClick={() => setLeagueFilter(league.competitionId)}>{league.league} <small>{league.count}</small></button>)}
        </div>
      </div> : null}
      {groups.map((group) => <section className="rc-league-group" key={group.competitionId} aria-labelledby={`tork-league-${group.competitionId}`}>
        <div className="rc-league-group__head"><h2 id={`tork-league-${group.competitionId}`}>{group.league}</h2><span>{group.items.length} maç</span></div>
        <div className="rc-grid">{group.items.map((item) => <TorkPredictionCard key={item.matchId} item={item} navigate={navigate} />)}</div>
      </section>)}
    </> : null}
    <p className="rc-footnote">{DISCLAIMER}</p>
  </div>;
}

export function TorkMatchPrediction({ matchId }: { matchId: string }) {
  const load = useCallback(() => fetchTorkMatchPrediction(matchId), [matchId]);
  const { data: item } = useTorkPublication(load);
  if (!item || item.matchId !== matchId) return null;
  return <section className="rc-detail"><div className="rc-section-title"><span>Maç öncesi</span><h2>Karşılıklı gol tahmini</h2></div><TorkPredictionCard item={item} /></section>;
}
