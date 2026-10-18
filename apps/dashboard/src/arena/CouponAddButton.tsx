import { useEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { fetchFootballMemberPredictionPreview } from "../api";
import type { FootballMemberPredictionPreviewCandidate, FootballMemberPredictionPreviewResponse } from "../types";
import { useCoupon } from "./CouponProvider";
import type { CouponMatch } from "./coupon-model";
import { selectableCouponPredictions } from "./coupon-candidates";
import "./coupon-actions.css";

type Props = {
  match: CouponMatch;
  candidate?: FootballMemberPredictionPreviewCandidate;
  minimumLeadMinutes?: number;
  preferredLabel?: string;
  className?: string;
};
const tierNames = { primary: "Tahminim", try: "Denenir", alternative: "Alternatif" };

export function CouponAddButton({ match, candidate, preferredLabel, className = "" }: Props) {
  const coupon = useCoupon();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ data: FootballMemberPredictionPreviewResponse; items: FootballMemberPredictionPreviewCandidate[]; style: CSSProperties } | null>(null);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef(0);
  const selection = coupon?.selections.find((item) => item.match.matchId === match.matchId);
  const selected = Boolean(selection && (candidate ? selection.prediction.predictionId === candidate.predictionId : preferredLabel ? selection.prediction.displayLabel === preferredLabel : true));

  useEffect(() => {
    requestRef.current += 1;
    setPicker(null); setError(null); setLoading(false);
    return () => { requestRef.current += 1; };
  }, [match.matchId, candidate?.predictionId, preferredLabel]);

  useEffect(() => {
    if (!picker) return;
    pickerRef.current?.querySelector<HTMLButtonElement>("button[data-choice]")?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node) && !anchorRef.current?.contains(event.target as Node)) setPicker(null);
    };
    const resize = () => setPicker(null);
    const unfocus = (event: FocusEvent) => {
      if (!pickerRef.current?.contains(event.target as Node) && !anchorRef.current?.contains(event.target as Node)) setPicker(null);
    };
    const scroll = (event: Event) => { if (!pickerRef.current?.contains(event.target as Node)) setPicker(null); };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", unfocus);
    document.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", resize);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("focusin", unfocus); document.removeEventListener("scroll", scroll, true); window.removeEventListener("resize", resize); };
  }, [picker]);

  if (!coupon) return null;

  const close = () => { setPicker(null); anchorRef.current?.focus(); };
  const choose = (item: FootballMemberPredictionPreviewCandidate, lead: number) => {
    const outcome = coupon.add(match, item, lead);
    setError(outcome === "expired" ? "Bu tahmin artık eklenemiyor. Güncel tahminleri yeniden aç." : outcome === "limit" ? "Kuponda en fazla 20 maç olabilir." : null);
    close();
  };
  const open = async () => {
    if (loading) return;
    if (selected) { coupon.remove(match.matchId); setPicker(null); setError(null); return; }
    const request = ++requestRef.current;
    setLoading(true); setError(null); setPicker(null);
    try {
      const data = await fetchFootballMemberPredictionPreview(match.matchId);
      if (request !== requestRef.current) return;
      const items = data.matchId === match.matchId ? selectableCouponPredictions(data) : [];
      if (!items.length) { setError("Bu maç için güncel tahmin henüz eklenemiyor."); return; }
      if (candidate) {
        const current = items.find((item) => item.predictionId === candidate.predictionId);
        if (current) choose(current, data.analysisWindow.minimumLeadMinutes);
        else setError("Bu tahmin güncellendi. Maç raporunu yenileyip tekrar seç.");
        return;
      }
      const preferred = preferredLabel ? items.find((item) => item.displayLabel === preferredLabel) : undefined;
      if (preferred || (!preferredLabel && items.length === 1)) { choose(preferred ?? items[0]!, data.analysisWindow.minimumLeadMinutes); return; }
      const rect = anchorRef.current!.getBoundingClientRect();
      const width = Math.min(340, window.innerWidth - 32);
      const below = window.innerHeight - rect.bottom - 16;
      const above = rect.top - 16;
      const down = below >= Math.min(300, above);
      const style: CSSProperties = { width, left: Math.max(16, Math.min(rect.right - width, window.innerWidth - width - 16)), maxHeight: Math.max(120, Math.min(380, down ? below : above)), ...(down ? { top: rect.bottom + 8 } : { bottom: window.innerHeight - rect.top + 8 }) };
      setPicker({ data, items, style });
    } catch {
      if (request === requestRef.current) setError("Tahminler alınamadı. Tekrar deneyebilirsin.");
    } finally { if (request === requestRef.current) setLoading(false); }
  };
  const onPickerKey = (event: KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.key === "Escape") { event.preventDefault(); close(); }
  };

  return <div className={`arena-coupon-action ${className}`} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
    <button ref={anchorRef} type="button" className="arena-coupon-add" aria-label={`${match.homeTeam.name} - ${match.awayTeam.name}${candidate ? `, ${candidate.displayLabel}` : ""}: ${selected ? "Kupondan çıkar" : "Kupona ekle"}`} aria-pressed={selected} aria-expanded={Boolean(picker)} disabled={loading} onClick={() => void open()}>
      <svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d={selected ? "m4 10 4 4 8-8" : "M10 4v12M4 10h12"} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      {loading ? "Kontrol ediliyor…" : selected ? "Kuponda" : "Kupona ekle"}
    </button>
    {error ? <p className="arena-coupon-add-error" role="status">{error}</p> : null}
    {picker ? createPortal(<div ref={pickerRef} className="arena-coupon-picker" style={picker.style} role="group" aria-label={`${match.homeTeam.name} - ${match.awayTeam.name}: kupon tahminini seç`} onKeyDown={onPickerKey} onClick={(event) => event.stopPropagation()}>
      <header><div><small>TAHMİNİNİ SEÇ</small><strong>{match.homeTeam.name} — {match.awayTeam.name}</strong></div><button type="button" aria-label="Tahmin seçimini kapat" onClick={close}>×</button></header>
      {picker.items.map((item) => <button data-choice key={item.predictionId} type="button" className="arena-coupon-choice" onClick={() => choose(item, picker.data.analysisWindow.minimumLeadMinutes)}><span><strong>{item.displayLabel}</strong><small>{tierNames[item.recommendationTier]} · {item.confidenceScore === null ? "Güven skoru yok" : `Güven ${Math.round(item.confidenceScore)}/100`}</small></span><span aria-hidden="true">+</span></button>)}
    </div>, document.body) : null}
  </div>;
}
