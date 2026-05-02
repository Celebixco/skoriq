# Prediction Readiness Policy

## Purpose

This policy defines how `football_match_prediction_features.feature_status` should be interpreted by future prediction and kupon engines. It is a readiness policy only. It does not implement a prediction model, betting logic, odds, kupon generation, frontend behavior, provider fetching, ingestion, or scheduler automation.

## Status Meanings

| Status | Meaning | Allowed Future Use |
| --- | --- | --- |
| `ready` | Required home and away form inputs are present with enough samples, and combined coverage is strong enough for MVP automated prediction experiments. | Eligible for future automated prediction experiments. |
| `partial` | Some useful feature context exists, but samples or coverage are limited. H2H may be missing or zero-sample. | Analysis/debug display only by default; not high-confidence prediction or kupon input. |
| `insufficient_data` | Critical source context is missing, both form sides are empty, or combined coverage is very low. | Excluded from future prediction and kupon candidate generation. |

## Minimum Source Requirements

- Home team form is required for prediction eligibility.
- Away team form is required for prediction eligibility.
- H2H is useful but optional for MVP readiness when home and away form coverage is strong.
- H2H missing or `sample_size=0` reduces confidence metadata, but it does not automatically block `ready`.
- Standings context is optional. Missing standings fields should remain `null` and should not block feature snapshot creation.
- Missing home or away form is a critical gap and should produce `insufficient_data`.

## MVP Thresholds

The current MVP thresholds are intentionally conservative but still workable for small test-branch data:

- `ready` requires home form `sample_size >= 3`.
- `ready` requires away form `sample_size >= 3`.
- `ready` requires `combined_coverage_score >= 50`.
- `partial` covers home/away form that exists but has sample sizes `1..2`, or combined coverage from `20..49`.
- `insufficient_data` covers missing home or away form, both home and away sample sizes equal to `0`, critical source feature gaps, or `combined_coverage_score < 20`.

Future production thresholds should be stricter, for example home/away form `sample_size >= 5`, stronger coverage requirements, recency checks, league baseline coverage, and explicit model calibration evidence.

## H2H Policy

H2H is not required for MVP `ready` status because many valid league fixtures have little or no recent pair history in a narrow ingestion window. Zero-sample H2H should still be recorded so consumers can see the missing matchup context.

Coverage uses weighted inputs:

- If H2H has `sample_size > 0`, `combined_coverage_score = home_form_coverage * 0.4 + away_form_coverage * 0.4 + h2h_coverage * 0.2`.
- If H2H is missing or has `sample_size=0`, `combined_coverage_score = home_form_coverage * 0.5 + away_form_coverage * 0.5`.
- Missing or zero-sample H2H must be marked in metadata with `h2hMissing=true`, `coverageFormula="team_form_only_h2h_missing"`, and a confidence cap reason such as `missing_h2h`.

This makes H2H truly optional for MVP readiness while preserving an explicit signal for future confidence and kupon policies.

## Kupon Eligibility

Kupon generation is future work and is not implemented.

- Safe kupon mode must use only `ready` rows.
- Ready rows with `h2hMissing=true` should not automatically become safe-kupon candidates; a future kupon engine should apply an explicit confidence cap or require extra non-H2H evidence.
- Balanced kupon mode may later allow high-quality `partial` rows only after an explicit policy and confidence threshold are approved.
- Aggressive kupon mode must still enforce minimum coverage and confidence; it must never use `insufficient_data`.
- No kupon engine should use `insufficient_data` rows for candidate generation.

## Reasoning Layer Policy

The football match reasoning layer is a deterministic explanation layer over `football_match_prediction_features`. It is not a model and does not emit predicted scores, picks, odds, kupons, or betting instructions.

The reasoning layer should:

- Explain why a row is `ready`, `partial`, or `insufficient_data`.
- Surface positive signals such as strong home/away form coverage and high combined coverage.
- Surface risk factors such as missing H2H, low coverage, low sample sizes, and missing source features.
- Set `prediction_eligible=true` only when `feature_status=ready`.
- Set `kupon_eligible=false` for all rows until a separate kupon/confidence engine is approved.
- Treat `metadata.h2hMissing=true` as a confidence cap, not a prediction-readiness blocker by itself.

Current confidence ceilings are policy labels, not probabilities:

- `ready` with H2H available: maximum `80`.
- `ready` with missing or zero-sample H2H: maximum `65`.
- `partial`: maximum `50`.
- `insufficient_data`: maximum `0..30` depending on combined coverage.

## Dortmund vs Freiburg Interpretation

Before additional history, Dortmund vs Freiburg was not prediction-ready because both team-form samples were only `1`, H2H was zero-sample, combined coverage was `14.67`, and status was `insufficient_data`.

After targeted Bundesliga history expansion, the expected MVP interpretation is:

- Home form sample size: `5`, coverage `70`.
- Away form sample size: `4`, coverage `58`.
- H2H sample size: `0`, coverage `0`.
- Combined coverage: `64.00` from team-form-only weighting.
- Status: `ready`.
- Metadata should mark `h2hMissing=true`.

The row is eligible for future prediction experiments according to feature readiness only, but it is not automatically safe-kupon eligible because H2H is missing and no kupon engine exists yet.
