import { useState } from "react";
import type { H1PrematchItem } from "../types";
import { useCoupon } from "./CouponProvider";
import { h1CouponCandidate, type CouponMatch } from "./coupon-model";
import "./rc-coupon.css";

function couponMatch(item: H1PrematchItem): CouponMatch {
  return {
    matchId: item.matchId,
    kickoffAt: item.kickoffAt,
    status: "scheduled",
    competition: { name: item.league },
    homeTeam: { id: item.homeTeamId, name: item.homeTeam, logoUrl: item.homeTeamLogoUrl },
    awayTeam: { id: item.awayTeamId, name: item.awayTeam, logoUrl: item.awayTeamLogoUrl }
  };
}

export function H1CouponButton({ item }: { item: H1PrematchItem }) {
  const coupon = useCoupon();
  const [message, setMessage] = useState("");
  if (!coupon) return null;
  const selection = coupon.selections.find((entry) => entry.match.matchId === item.matchId);
  const selected = selection?.prediction.predictionId === item.h1.predictionId;
  const candidate = h1CouponCandidate(item);
  const add = () => {
    setMessage("");
    if (selected) {
      coupon.remove(item.matchId);
      return;
    }
    const outcome = coupon.add(couponMatch(item), candidate, 0);
    if (outcome === "conflict") {
      if (window.confirm("Bu maçta farklı bir seçim var. Seçim değiştirilsin mi?")) {
        coupon.remove(item.matchId);
        coupon.add(couponMatch(item), candidate, 0);
      }
      return;
    }
    if (outcome === "expired") setMessage("Maç başladığı için bu seçim eklenemiyor.");
    if (outcome === "limit") setMessage("Kuponda en fazla 20 maç olabilir.");
  };
  return <div className="rc-coupon-action">
    <button type="button" className={`rc-coupon-button${selected ? " is-selected" : ""}`} aria-pressed={Boolean(selected)} onClick={add}>
      <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d={selection ? "m4 10 4 4 8-8" : "M10 4v12M4 10h12"} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
      {selected ? "Kupondan çıkar" : "Kupona ekle"}
    </button>
    {message ? <span className="rc-coupon-message" role="status">{message}</span> : null}
  </div>;
}
