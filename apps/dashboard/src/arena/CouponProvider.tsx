import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { fetchFootballMemberPredictionPreview, fetchH1MatchPrediction, fetchRcMatchPrediction, fetchTorkMatchPrediction } from "../api";
import type { FootballMemberPredictionPreviewCandidate } from "../types";
import {
  addCouponSelection, couponSelectionDeadline, couponStorageKey, expireCouponSelections,
  loadCoupon, reconcileCouponStorageChange, reconcileCouponValidation, serializeCoupon, validateCouponSelections,
  type CouponAddOutcome, type CouponMatch, type CouponSelection
} from "./coupon-model";

export interface CouponContextValue {
  selections: CouponSelection[];
  checking: boolean;
  validationError: string | null;
  message: string;
  add(match: CouponMatch, candidate: FootballMemberPredictionPreviewCandidate, minimumLeadMinutes: number): CouponAddOutcome;
  remove(matchId: string): void;
  clear(): void;
  revalidate(): Promise<boolean>;
  isSelected(matchId: string, predictionId?: string): boolean;
  /** The validated snapshot is available immediately, including before React paints. */
  getSelections(): CouponSelection[];
}

const CouponContext = createContext<CouponContextValue | null>(null);

export function useCoupon(): CouponContextValue | null {
  return useContext(CouponContext);
}

function restore(userId: string): CouponSelection[] {
  try {
    return loadCoupon(typeof window === "undefined" ? null : window.localStorage, userId);
  } catch {
    return [];
  }
}

const addMessages: Record<CouponAddOutcome, string> = {
  added: "Seçim kupon taslağına eklendi.",
  replaced: "Bu maçın seçimi kupon taslağında değiştirildi.",
  conflict: "Bu maçta farklı bir seçim var. Değiştirmeden önce onay isteyin.",
  duplicate: "Bu seçim zaten kupon taslağında.",
  expired: "Bu seçim artık güncel analiz penceresinde değil.",
  limit: "Kupon taslağına en fazla 20 maç ekleyebilirsin."
};

function CouponScope({ userId, children }: { userId: string; children: ReactNode }) {
  const [selections, setSelections] = useState<CouponSelection[]>(() => restore(userId));
  const [checking, setChecking] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const current = useRef(selections);
  const revision = useRef(0);
  const requestId = useRef(0);
  const mounted = useRef(true);

  // Reconcile against the latest edit synchronously so awaiting callers cannot read
  // the previous render's snapshot, and a finished request never restores removals.
  const updateSelections = useCallback((update: (previous: CouponSelection[]) => CouponSelection[]) => {
    if (!mounted.current) return;
    const next = update(current.current);
    if (next === current.current) return;
    current.current = next;
    revision.current++;
    setSelections(next);
  }, []);

  const expire = useCallback(() => {
    const previousCount = current.current.length;
    updateSelections((previous) => expireCouponSelections(previous));
    const removed = previousCount - current.current.length;
    if (removed > 0 && mounted.current) setMessage(`${removed} seçim için analiz süresi doldu; kupon taslağından çıkarıldı.`);
    return current.current;
  }, [updateSelections]);

  const revalidate = useCallback(async (): Promise<boolean> => {
    if (!mounted.current) return false;
    const id = ++requestId.current;
    const snapshot = expire();
    if (snapshot.length === 0) {
      setChecking(false);
      setValidationError(null);
      return false;
    }
    const startedAtRevision = revision.current;
    setChecking(true);
    setValidationError(null);
    const results = await validateCouponSelections(snapshot, fetchFootballMemberPredictionPreview, fetchRcMatchPrediction, fetchH1MatchPrediction, fetchTorkMatchPrediction);
    if (!mounted.current || id !== requestId.current) return false;
    const editedDuringRequest = revision.current !== startedAtRevision;
    const reconciled = reconcileCouponValidation(current.current, results);
    updateSelections(() => reconciled.selections);
    setChecking(false);
    if (reconciled.failedCount > 0) {
      setValidationError("Güncel analizler doğrulanamadı. Bağlantını kontrol edip yeniden dene.");
    }
    if (reconciled.removedCount > 0) {
      setMessage(`${reconciled.removedCount} seçim artık kullanılamıyor ve kupon taslağından çıkarıldı.`);
    } else if (editedDuringRequest) {
      setMessage("Kupon taslağı kontrol sırasında değişti. Kopyalamak için yeniden kontrol et.");
    } else if (reconciled.failedCount === 0) {
      setMessage("Kupon taslağındaki analizler güncellendi.");
    }
    return !editedDuringRequest && reconciled.failedCount === 0 && reconciled.removedCount === 0 && current.current.length > 0;
  }, [expire, updateSelections]);

  useEffect(() => {
    mounted.current = true;
    // Only restored selections need an initial request; an empty draft stays local.
    if (current.current.length > 0) void revalidate();
    return () => {
      mounted.current = false;
      requestId.current++;
    };
  }, [revalidate]);

  useEffect(() => {
    try {
      const key = couponStorageKey(userId);
      const saved = serializeCoupon(userId, current.current);
      if (window.localStorage.getItem(key) !== saved) window.localStorage.setItem(key, saved);
    } catch {
      // The draft remains usable for this visit when browser storage is blocked.
    }
  }, [selections, userId]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      try {
        const incoming = reconcileCouponStorageChange(current.current, event, window.localStorage, userId);
        if (incoming === null) return;
        // Imported changes are edits too: invalidate any copy already in flight.
        requestId.current++;
        updateSelections(() => incoming);
        setValidationError(null);
        setMessage("Kupon taslağı diğer sekmedeki seçimlerinle eşitlendi.");
        if (incoming.length > 0) void revalidate();
        else setChecking(false);
      } catch {
        // Browsers can deny storage access after the initial render.
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [revalidate, updateSelections, userId]);

  useEffect(() => {
    if (selections.length === 0) return;
    let timer: number;
    const schedule = () => {
      if (current.current.length === 0) return;
      const deadline = Math.min(...current.current.map(couponSelectionDeadline));
      const delay = Math.max(0, Math.min(2_147_483_647, Math.ceil(deadline - Date.now())));
      timer = window.setTimeout(() => { expire(); schedule(); }, delay);
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, [expire, selections]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") expire(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", expire);
    window.addEventListener("pageshow", expire);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", expire);
      window.removeEventListener("pageshow", expire);
    };
  }, [expire]);

  const add = useCallback((match: CouponMatch, candidate: FootballMemberPredictionPreviewCandidate, minimumLeadMinutes: number): CouponAddOutcome => {
    const result = addCouponSelection(current.current, match, candidate, minimumLeadMinutes);
    updateSelections(() => result.selections);
    if (mounted.current) {
      setValidationError(null);
      setMessage(addMessages[result.outcome]);
    }
    return result.outcome;
  }, [updateSelections]);

  const remove = useCallback((matchId: string) => {
    updateSelections((previous) => previous.filter((selection) => selection.match.matchId !== matchId));
    if (mounted.current) {
      setValidationError(null);
      setMessage("Seçim kupon taslağından çıkarıldı.");
    }
  }, [updateSelections]);

  const clear = useCallback(() => {
    updateSelections((previous) => previous.length === 0 ? previous : []);
    if (mounted.current) {
      setValidationError(null);
      setMessage("Kupon taslağı temizlendi.");
    }
  }, [updateSelections]);

  const isSelected = useCallback((matchId: string, predictionId?: string) => current.current.some((selection) => selection.match.matchId === matchId && (predictionId === undefined || selection.prediction.predictionId === predictionId)), []);
  const value = useMemo<CouponContextValue>(() => ({ selections, checking, validationError, message, add, remove, clear, revalidate, isSelected, getSelections: expire }), [selections, checking, validationError, message, add, remove, clear, revalidate, isSelected, expire]);

  return <CouponContext.Provider value={value}>{children}</CouponContext.Provider>;
}

export function CouponProvider({ userId, children }: { userId: string; children: ReactNode }) {
  // Own the account boundary even if a caller changes the prop without a key.
  return <CouponScope key={userId} userId={userId}>{children}</CouponScope>;
}
