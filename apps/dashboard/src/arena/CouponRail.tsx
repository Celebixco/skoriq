import { useEffect, useId, useRef, useState } from "react";
import { useCoupon } from "./CouponProvider";
import { formatCouponText, type CouponSelection } from "./coupon-model";
import { confidenceValue, riskText } from "./home-data";
import "./coupon.css";

function CouponIcon({ close = false }: { close?: boolean }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">{close ? <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /> : <><path d="M7 3h10v3h3v4a2 2 0 0 0 0 4v4h-3v3H7v-3H4v-4a2 2 0 0 0 0-4V6h3V3Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /><path d="m8 12 2.5 2.5L16 9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></>}</svg>;
}

function SelectionRow({ selection, onOpen, onRemove, disabled }: {
  selection: CouponSelection;
  onOpen: () => void;
  onRemove: () => void;
  disabled: boolean;
}) {
  const { match, prediction } = selection;
  const confidence = confidenceValue(prediction.confidenceScore);
  const date = new Date(match.kickoffAt);
  const kickoff = Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" }).format(date) : "Saat bekleniyor";
  return <li className="arena-coupon-pick">
    <div className="arena-coupon-pick__meta"><span>{match.competition.name}</span><time dateTime={match.kickoffAt}>{kickoff}</time></div>
    <div className="arena-coupon-pick__fixture"><button className="arena-coupon-match" type="button" onClick={onOpen} aria-label={`${match.homeTeam.name} - ${match.awayTeam.name} maç analizini aç`}><span>{match.homeTeam.name}</span><span>{match.awayTeam.name}</span></button><button className="arena-coupon-remove" type="button" disabled={disabled} onClick={onRemove} aria-label={`${match.homeTeam.name} - ${match.awayTeam.name} seçimini kaldır`}><CouponIcon close /></button></div>
    <strong className="arena-coupon-pick__selection">{prediction.displayLabel}</strong>
    <dl className="arena-coupon-pick__signals"><div><dt>Risk</dt><dd>{riskText(prediction.riskLevel)}</dd></div><div><dt>Güven</dt><dd>{confidence === null ? "—" : `${confidence}/100`}</dd></div></dl>
  </li>;
}

export function CouponRail({ navigate }: { navigate: (path: string) => void }) {
  const coupon = useCoupon();
  const couponRef = useRef(coupon);
  couponRef.current = coupon;
  const id = useId();
  const [open, setOpen] = useState(false);
  const [copying, setCopying] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [toast, setToast] = useState("");
  const toastMessage = feedback || coupon?.validationError || coupon?.message || "";
  const selectionCount = coupon?.selections.length ?? 0;
  const selectionKey = coupon?.selections.map(({ match, prediction }) => `${match.matchId}:${prediction.predictionId}`).join("|") ?? "";
  const dialogRef = useRef<HTMLDialogElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const restoreFocusRef = useRef(true);
  const mountedRef = useRef(false);

  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
  useEffect(() => { setFeedback(""); }, [selectionKey]);
  useEffect(() => {
    setToast(toastMessage);
    if (!toastMessage) return;
    const timeout = window.setTimeout(() => setToast(""), 4_000);
    return () => window.clearTimeout(timeout);
  }, [toastMessage, selectionCount]);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1280px)");
    const resize = () => { if (media.matches) setOpen(false); };
    media.addEventListener("change", resize);
    return () => media.removeEventListener("change", resize);
  }, []);
  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    try { dialog.showModal(); }
    catch { setFeedback("Kupon paneli açılamadı. Sayfayı yenileyip tekrar dene."); setOpen(false); return; }
    const bodyOverflow = document.body.style.overflow;
    const rootOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = bodyOverflow;
      document.documentElement.style.overflow = rootOverflow;
      const target = returnFocusRef.current;
      if (restoreFocusRef.current && target?.isConnected && target.getClientRects().length) target.focus({ preventScroll: true });
    };
  }, [open]);

  if (!coupon) return null;
  const { selections, checking, validationError, message } = coupon;
  const busy = checking || copying;
  const count = selections.length;
  const status = feedback || message;
  const openDrawer = () => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : launcherRef.current;
    restoreFocusRef.current = true;
    setOpen(true);
  };
  const openMatch = (matchId: string) => {
    restoreFocusRef.current = false;
    setOpen(false);
    navigate(`/football/analytics/${encodeURIComponent(matchId)}`);
  };
  const copy = async () => {
    const current = couponRef.current;
    if (!current || copying || current.checking || !current.selections.length) return;
    setCopying(true);
    setFeedback("");
    try {
      const valid = await current.revalidate();
      if (!mountedRef.current) return;
      if (!valid) { setFeedback("Kupon doğrulanamadı. Güncel seçimlerini kontrol edip tekrar dene."); return; }
      const fresh = couponRef.current?.getSelections() ?? [];
      if (!fresh.length) { setFeedback("Kopyalanacak seçim kalmadı. Hazır bir tahmin ekleyebilirsin."); return; }
      if (!navigator.clipboard?.writeText) { setFeedback("Bu tarayıcıda panoya erişilemiyor. Güvenli bağlantıda tekrar dene."); return; }
      await navigator.clipboard.writeText(formatCouponText(fresh));
      if (mountedRef.current) setFeedback("Kupon panoya kopyalandı.");
    } catch { if (mountedRef.current) setFeedback("Kupon kopyalanamadı. Bağlantını ve pano iznini kontrol edip tekrar dene."); }
    finally { if (mountedRef.current) setCopying(false); }
  };
  const panel = (suffix: string, drawer = false) => <div className="arena-coupon-panel">
    <header className="arena-coupon-header"><div><span className="arena-coupon-eyebrow">Seçimlerin</span><h2 id={`${id}-${suffix}-title`}>Kuponum <span>{count}</span></h2></div>{drawer ? <button className="arena-coupon-close" type="button" onClick={() => setOpen(false)} aria-label="Kuponu kapat" autoFocus><CouponIcon close /></button> : <CouponIcon />}</header>
    <div className="arena-coupon-summary"><strong>{count === 0 ? "Seçim bekleniyor" : count === 1 ? "Tekli seçim" : `${count} maçlık kombin`}</strong><span>Bu cihazda saklanır</span></div>
    <div className="arena-coupon-scroll">
      {count ? <ol className="arena-coupon-picks" aria-label="Kupondaki seçimler">{selections.map((selection) => <SelectionRow key={selection.match.matchId} selection={selection} disabled={busy} onOpen={() => openMatch(selection.match.matchId)} onRemove={() => { setFeedback(""); coupon.remove(selection.match.matchId); }} />)}</ol> : <div className="arena-coupon-empty"><span className="arena-coupon-empty__mark"><CouponIcon /></span><h3>İlk seçimini ekle.</h3><p>Tahmini hazır bir maçta <strong>Kupona ekle</strong> seçeneğini kullan. Seçimlerin burada bir araya gelsin.</p><span>Her maç için bir seçim.</span></div>}
    </div>
    <footer className="arena-coupon-footer">
      {validationError ? <p className="arena-coupon-error" role="alert">{validationError}</p> : null}
      {status ? <p className="arena-coupon-status" role="status">{status}</p> : null}
      <div className="arena-coupon-actions"><button className="arena-coupon-clear" type="button" disabled={!count || busy} onClick={() => { setFeedback(""); coupon.clear(); }}>Temizle</button><button className="arena-coupon-copy" type="button" disabled={!count || busy} onClick={() => void copy()}>{copying || checking ? "Kontrol ediliyor…" : "Kuponu kopyala"}<svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="7" y="7" width="9" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.4" /><path d="M12 7V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h3" stroke="currentColor" strokeWidth="1.4" /></svg></button></div>
      <p className="arena-coupon-safety">Güven skoru kazanma olasılığı değildir. Analizler kesin sonuç garantisi vermez.</p>
    </footer>
  </div>;
  return <>
    <aside className="arena-coupon-rail" aria-labelledby={`${id}-rail-title`}>{panel("rail")}</aside>
    <button className="arena-coupon-launcher" ref={launcherRef} type="button" onClick={openDrawer} aria-label={`Kuponum, ${count} seçim`} aria-haspopup="dialog" aria-expanded={open} aria-controls={`${id}-drawer`}><CouponIcon /><span>Kuponum</span><strong>{count}</strong></button>
    {toast && !open ? <span className="arena-coupon-mobile-feedback" role="status">{toast}</span> : null}
    <dialog id={`${id}-drawer`} ref={dialogRef} className="arena-coupon-dialog" aria-labelledby={`${id}-drawer-title`} onCancel={(event) => { event.preventDefault(); setOpen(false); }} onClose={() => setOpen(false)} onClick={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>{open ? panel("drawer", true) : null}</dialog>
  </>;
}
