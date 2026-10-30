import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { canonicalTorkPublicationSql, torkPublicationMetadata } from "./football-tork-publication.js";

const normalize = (value: string) => value.replace(/\s+/g, " ").trim();

describe("canonical Tork publication SQL contract", () => {
  it("selects a single newest eligible publication across same-match model versions", () => {
    const query = new PgDialect().sqlToQuery(canonicalTorkPublicationSql());
    expect(query.params).toEqual([]);
    expect(normalize(query.sql)).toBe(normalize(`
      "p".status = 'published'
      and "p".model_id = 'TORK-A'
      and "p".published_at is not null
      and "p".prediction_generated_at < m.scheduled_start_at
      and "p".p_btts >= 0 and "p".p_btts <= 1
      and "p".pick in ('btts_yes', 'btts_no')
      and not exists (
        select 1 from football_tork_prematch_predictions newer
        where newer.match_id = p.match_id and newer.model_id = p.model_id
          and "newer".status = 'published'
          and "newer".model_id = 'TORK-A'
          and "newer".published_at is not null
          and "newer".prediction_generated_at < m.scheduled_start_at
          and "newer".p_btts >= 0 and "newer".p_btts <= 1
          and "newer".pick in ('btts_yes', 'btts_no')
          and (newer.published_at, newer.prediction_generated_at, newer.id)
            > (p.published_at, p.prediction_generated_at, p.id)
      )`));
    // Version must not partition the anti-join: an append-only upgrade is one
    // public selection, not two cards or two historical result counts.
    expect(query.sql).not.toContain("model_version");
    expect(query.sql).not.toContain("supersedes_id");
  });

  it("excludes malformed or post-kickoff newer rows before they can mask a valid legacy publication", () => {
    const query = normalize(new PgDialect().sqlToQuery(canonicalTorkPublicationSql()).sql);
    expect(query).toContain('"newer".prediction_generated_at < m.scheduled_start_at');
    expect(query).toContain('"newer".p_btts >= 0 and "newer".p_btts <= 1');
    expect(query).toContain('"newer".pick in (\'btts_yes\', \'btts_no\')');
    expect(query).not.toMatch(/\b(update|delete|truncate)\b/i);
  });
});

describe("Tork publication policy provenance", () => {
  it("exposes the recorded policy and model hash without inferring them from probabilities", () => {
    expect(torkPublicationMetadata({ decisionPolicy: { version: "binary-policy", threshold: 0.5, objective: "binary_equal_cost" } }, "model-hash")).toEqual({
      decisionPolicyVersion: "binary-policy", decisionThreshold: 0.5, modelHash: "model-hash"
    });
    expect(torkPublicationMetadata({ decisionPolicy: { version: "legacy-selective", threshold: 0.55 } }, "old-hash")).toEqual({
      decisionPolicyVersion: "legacy-selective", decisionThreshold: 0.55, modelHash: "old-hash"
    });
  });

  it.each([null, undefined, {}, [], "not-json", { decisionPolicy: {} },
    { decisionPolicy: { version: "", threshold: 0.5 } },
    { decisionPolicy: { version: "unverified", threshold: null } },
    { decisionPolicy: { version: "unverified", threshold: Number.NaN } },
    { decisionPolicy: { version: "unverified", threshold: "0.5" } },
    { decisionPolicy: { version: "unverified", threshold: 1 } }
  ])("reports unknown legacy or malformed metadata as null: %j", (value) => {
    expect(torkPublicationMetadata(value, null)).toEqual({ decisionPolicyVersion: null, decisionThreshold: null, modelHash: null });
  });
});
