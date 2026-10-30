/** Binary BTTS decisions; probability modelling and selective betting are separate concerns. */
export const TORK_MODEL_VERSION = "tork-stage1-logistic-blend-binary-v2";
export const TORK_DECISION_POLICY_VERSION = "btts-binary-equal-cost-v1";
export const TORK_DECISION_THRESHOLD = 0.5;
export type TorkPick = "btts_yes" | "btts_no";

/** Reject missing/invalid probabilities instead of silently turning them into KG Yok. */
export function parseTorkProbability(value: unknown): number {
  if (typeof value !== "number" && (typeof value !== "string" || value.trim() === "")) {
    throw new Error("invalid_tork_probability");
  }
  const probability = Number(value);
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new Error("invalid_tork_probability");
  }
  return probability;
}

export function parseTorkPick(value: unknown): TorkPick {
  if (value !== "btts_yes" && value !== "btts_no") throw new Error("invalid_tork_pick");
  return value;
}

/** Equal-cost binary policy defaults to the more likely event, not a forced class mix. */
export function classifyTorkProbability(probability: number, threshold = TORK_DECISION_THRESHOLD): TorkPick {
  const pBtts = parseTorkProbability(probability);
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold >= 1) throw new Error("invalid_tork_threshold");
  return pBtts >= threshold ? "btts_yes" : "btts_no";
}

/** Published pick is authoritative, including for historical policies. Never reclassify it here. */
export function formatTorkSelection(probability: unknown, selection: unknown) {
  const pBtts = parseTorkProbability(probability);
  const pick = parseTorkPick(selection);
  const selectionProbability = pick === "btts_yes" ? pBtts : 1 - pBtts;
  const pickLabel = pick === "btts_yes" ? "Karşılıklı gol var" : "Karşılıklı gol yok";
  return {
    pBtts,
    pick,
    pickLabel,
    selectionProbability,
    predictionText: `${pickLabel} (%${Math.round(selectionProbability * 100)} olasılık)`
  };
}
