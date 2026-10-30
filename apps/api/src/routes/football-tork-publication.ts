import { sql } from "drizzle-orm";

function eligiblePublication(alias: "p" | "newer") {
  const row = sql.identifier(alias);
  return sql`${row}.status = 'published'
    and ${row}.model_id = 'TORK-A'
    and ${row}.published_at is not null
    and ${row}.prediction_generated_at < m.scheduled_start_at
    and ${row}.p_btts >= 0 and ${row}.p_btts <= 1
    and ${row}.pick in ('btts_yes', 'btts_no')`;
}

/** One authoritative, valid publication per match/model, irrespective of model version. */
export function canonicalTorkPublicationSql() {
  return sql`${eligiblePublication("p")}
    and not exists (
      select 1 from football_tork_prematch_predictions newer
      where newer.match_id = p.match_id and newer.model_id = p.model_id
        and ${eligiblePublication("newer")}
        and (newer.published_at, newer.prediction_generated_at, newer.id)
          > (p.published_at, p.prediction_generated_at, p.id)
    )`;
}

/** Legacy publications have no assumed policy version or threshold. */
export function torkPublicationMetadata(metadata: unknown, modelHash: unknown) {
  const object = metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? metadata as Record<string, unknown> : null;
  const value = object?.decisionPolicy;
  const policy = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
  const validPolicy = typeof policy?.version === "string" && policy.version.trim() !== "" &&
    typeof policy.threshold === "number" && Number.isFinite(policy.threshold) && policy.threshold > 0 && policy.threshold < 1;
  return {
    decisionPolicyVersion: validPolicy ? policy.version as string : null,
    decisionThreshold: validPolicy ? policy.threshold as number : null,
    modelHash: typeof modelHash === "string" && modelHash.trim() !== "" ? modelHash : null
  };
}
