import { CompetitionLogo, TeamLogo } from "../components";
import { confidenceValue, kickoffText, riskText, type ArenaMatch, type ArenaPrediction } from "./home-data";

export function ArrowIcon({ className = "" }: { className?: string }) {
  return <svg className={className} width="23" height="23" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12h15m-6-7 7 7-7 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function SignalIcon({ kind }: { kind: "chart" | "check" | "risk" }) {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    {kind === "chart" ? <path d="M3 20h18M6 16v-4m4 4V8m4 8v-6m4 6V4M5 8l5-5 4 3 6-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /> : kind === "check" ? <path d="m3 16 5-6 5 3 7-9m-5 0h5v5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /> : <><path d="m12 3 10 18H2L12 3Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /><path d="M12 9v5m0 3v.1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></>}
  </svg>;
}

const demoMonograms: Record<string, string> = { Galatasaray: "GS", Fenerbahçe: "FB", Beşiktaş: "BJK", Trabzonspor: "TS", Arsenal: "ARS", Chelsea: "CHE", Milan: "MIL", Napoli: "NAP" };

function TeamMark({ team, demo }: { team: ArenaMatch["homeTeam"]; demo?: boolean }) {
  return demo ? <span className="team-logo team-logo-lg team-logo-fallback" aria-label={`${team.name} örnek monogramı`}>{demoMonograms[team.name] ?? team.name.slice(0, 3).toLocaleUpperCase("tr-TR")}</span> : <TeamLogo name={team.name} logoUrl={team.logoUrl} size="lg" />;
}

function MatchTeams({ match, featured = false }: { match: ArenaMatch; featured?: boolean }) {
  return <div className={`arena-teams${featured ? " arena-teams-featured" : ""}`}>
    <div className="arena-team"><TeamMark team={match.homeTeam} demo={match.demo} /><strong>{match.homeTeam.name}</strong></div>
    <span className="arena-versus" aria-label="karşı">VS</span>
    <div className="arena-team"><TeamMark team={match.awayTeam} demo={match.demo} /><strong>{match.awayTeam.name}</strong></div>
  </div>;
}

export function ArenaPredictionCard({ match, prediction, onOpen }: { match: ArenaMatch; prediction?: ArenaPrediction; onOpen: () => void }) {
  const confidence = confidenceValue(prediction?.confidenceScore);
  const coverage = confidenceValue(match.combinedCoverageScore);
  const ready = match.featureStatus === "ready";

  return <article className="arena-prediction-card" aria-label={`${match.homeTeam.name} - ${match.awayTeam.name} ${match.demo ? "örnek analiz" : "maç analizi"}`}>
    <header className="arena-prediction-top">
      <div><span className="arena-card-kicker">{match.demo ? "Örnek analiz" : "Günün karşılaşması"}</span><span>{match.competition.name}</span></div>
      <span className="arena-kickoff">{kickoffText(match)}</span>
    </header>
    <MatchTeams match={match} featured />
    <div className="arena-prediction-body">
      <div className="arena-prediction-labels"><span className="arena-card-kicker">SkorIQ tahmini</span><span className={`arena-readiness${ready ? " is-ready" : ""}`}><i />{prediction ? "Analiz hazır" : ready ? "Rapor hazır" : "Hazırlanıyor"}</span></div>
      <div className="arena-prediction-result"><h2>{prediction?.displayLabel ?? "Maçın hikâyesi hazırlanıyor"}</h2><div className="arena-confidence"><span>Güven skoru</span><strong>{confidence === null ? "—" : Math.round(confidence)}<small>/100</small></strong></div></div>
      <div className="arena-confidence-track" role="meter" aria-label="Güven skoru" aria-valuemin={0} aria-valuemax={100} aria-valuenow={confidence ?? undefined} aria-valuetext={confidence === null ? "Henüz belirlenmedi" : `${Math.round(confidence)} / 100`}><span style={{ width: `${confidence ?? 0}%` }} /></div>
      <ul className="arena-signals">
        <li><SignalIcon kind="chart" /><span>{match.demo ? "Örnek gol profili destekliyor" : coverage === null ? "Veri kapsamı henüz açıklanmadı" : `Veri kapsamı %${Math.round(coverage)}`}</span></li>
        <li><SignalIcon kind="check" /><span>{match.demo ? "Örnek form sinyali güçlü" : ready ? "Maç analiz raporu hazır" : match.featureStatus === "partial" ? "Analiz kısmi veriye dayanıyor" : "Yeterli veri bekleniyor"}</span></li>
        <li className="arena-risk"><SignalIcon kind="risk" /><span>Risk: {prediction ? riskText(prediction.riskLevel) : "Henüz belirlenmedi"}</span></li>
      </ul>
      <details className="arena-reasoning">
        <summary>Neden bu tahmin?<ArrowIcon /></summary>
        <div><p>{match.demo ? "Bu kart ürünün nasıl çalıştığını gösteren örnek bir analizdir. Takımlar, güven skoru ve yorumlar güncel bir karşılaşma için öneri değildir." : prediction ? "Bu önizleme, maçın yayınlanabilir tahmin yorumunu ve güven skorunu gösterir. Form, gol profili ve karşılaşma geçmişinin ayrıntılarını maç raporunda inceleyebilirsin." : "Yayınlanabilir tahmin yorumu hazır olduğunda burada görünür. Mevcut verileri maç raporundan inceleyebilirsin."}</p><button className="arena-text-action" type="button" onClick={onOpen}>{match.demo ? "Kendi analizini keşfet" : "Maç raporunu aç"}<ArrowIcon /></button></div>
      </details>
    </div>
  </article>;
}

export function ArenaMatchCard({ match, hasPrediction, onOpen }: { match: ArenaMatch; hasPrediction: boolean; onOpen: () => void }) {
  return <article className="arena-match-card">
    <header><span className="arena-competition"><CompetitionLogo name={match.competition.name} size="sm" />{match.competition.name}</span><span className="arena-kickoff">{kickoffText(match)}</span></header>
    <MatchTeams match={match} />
    <footer><span className={`arena-readiness${hasPrediction ? " is-ready" : ""}`}><i />{hasPrediction ? "Analiz hazır" : "Yakında"}</span><button className="arena-match-action" type="button" aria-label={`${match.homeTeam.name} - ${match.awayTeam.name} maç analizini aç`} onClick={onOpen}>Analizi aç<ArrowIcon /></button></footer>
  </article>;
}

export function ArenaStateCard({ loading, error, onOpen }: { loading: boolean; error: boolean; onOpen: () => void }) {
  return <div className={`arena-prediction-card arena-state-card${loading ? " is-loading" : ""}`} role={error ? "alert" : "status"} aria-live="polite">
    <span className="arena-card-kicker">Maç gecesi</span>
    <svg width="100" height="100" viewBox="0 0 100 100" fill="none" aria-hidden="true"><rect x="10" y="17" width="80" height="66" rx="2" stroke="currentColor" /><path d="M50 17v66M10 34h14v32H10m80-32H76v32h14" stroke="currentColor" /><circle cx="50" cy="50" r="13" stroke="currentColor" /><circle cx="50" cy="50" r="2" fill="currentColor" /></svg>
    <h2>{loading ? "Maçlar hazırlanıyor." : error ? "Analize kısa bir ara." : "Sıradaki maçı bekliyoruz."}</h2>
    <p>{loading ? "Güncel karşılaşmalar ve analizler yükleniyor." : error ? "Maç verilerine şu anda ulaşılamıyor. Biraz sonra tekrar deneyebilirsin." : "Yeni karşılaşmalar ve yeterli veri oluştuğunda analizler burada görünecek."}</p>
    {!loading ? <button className="arena-outline-action" type="button" onClick={onOpen}>Maçları keşfet<ArrowIcon /></button> : <span className="arena-loading-line" />}
  </div>;
}
