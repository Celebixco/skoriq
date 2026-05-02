# Prediction Settlement Policy

## Purpose

This document defines how SkorIQ football Tahmin outputs are settled after match completion. Settlement is internal/manual at this stage and does not implement public pages, member-visible publishing, scheduler jobs, provider calls, ingestion, tahmin kombini, or prediction models.

Consistency validation is separate from settlement. See [Prediction Consistency Engine Plan](./prediction-consistency-engine.md).

Current implementation status: `football_prediction_settlements`, the settlement rule engine, repository methods, and the local/manual settlement runner are implemented as foundation. Settlement updates internal output statuses only when `--execute` is explicitly supplied. It does not publish public successful predictions and does not make drafts member-visible.

Public eligibility now has a dry-run evaluator after settlement. It can report which `settled_success` outputs would be future public candidates, but it does not create public rows, set public eligibility timestamps, or publish anything.

Manual runner:

```bash
npm run analytics:football:predictions:settle -- --match-id=<match-uuid>
npm run analytics:football:predictions:settle -- --prediction-id=<prediction-output-uuid>
```

Dry-run is the default. `--execute` is required to create or update `football_prediction_settlements` and update the related `football_prediction_outputs.status`.

## Settlement Requirements

Settlement requires:

- A canonical match row.
- A final match status.
- Final score data from normalized football score tables.
- Relevant score/stat fields for the prediction type.
- A locked prediction output generated before match start.
- A prediction output that passed consistency validation before member visibility.
- A deterministic rule for the prediction type.

Accepted final match statuses should align with the analytics readiness policy:

- `finished`
- `after_extra_time`
- `after_penalties`

Non-final statuses must not be settled as success or failure unless an explicit void rule applies.

## Settlement Statuses

| Status | Meaning |
| --- | --- |
| `settlement_pending` | Match appears ready for evaluation but rule has not completed. |
| `settled_success` | The rule evaluated successfully. |
| `settled_failed` | The rule evaluated unsuccessfully. |
| `settled_void` | The rule cannot be evaluated fairly. |

## Void Conditions

A prediction should be void when:

- Match is postponed.
- Match is cancelled.
- Match is abandoned.
- Final score is missing.
- Required half/period score is missing for a half-specific prediction.
- Required statistic is missing for a stat-specific prediction.
- The prediction rule cannot be evaluated from normalized data.
- Match identity or team identity is inconsistent.

Void is not a failure. It should be retained internally for audit and performance accounting.

## Example Settlement Rules

### `first_half_over_0_5`

Success if first-half total goals are at least 1.

Required data:

- First-half home goals.
- First-half away goals.

Void if first-half score is missing.

### `over_2_5_goals`

Success if fulltime total goals are at least 3.

Required data:

- Fulltime home goals.
- Fulltime away goals.

Void if final score is missing.

### `both_teams_to_score`

Success if both teams have at least 1 fulltime goal.

Required data:

- Fulltime home goals.
- Fulltime away goals.

Void if final score is missing.

### `double_chance_1X`

Success if home team wins or match is a draw.

Required data:

- Fulltime home goals.
- Fulltime away goals.

Void if final score is missing.

### `match_result_1x2`

Success if the selected outcome matches the fulltime result:

- `1`: home win.
- `X`: draw.
- `2`: away win.

Void if final score is missing.

### Unsupported MVP Types

`team_total_goals`, `score_range`, `exact_score`, and other future types are voided by the MVP settlement engine until explicit rules and tests are added.

## Settlement Metadata

Every settlement should store enough metadata to audit the decision:

- Rule version.
- Normalized match status.
- Actual result.
- Evaluated score fields.
- Missing field list if void.
- Evaluated timestamp.
- Settlement reason.

Do not store provider secrets, raw provider payloads, API keys, DB credentials, JWTs, cookies, or password hashes.

## Public Eligibility After Settlement

Only `settled_success` predictions can become public-eligible. The full gate is defined in [Public Prediction Eligibility Policy](./public-prediction-eligibility-policy.md).

A successful prediction should still pass public checks:

- It was visible to members before kickoff.
- It was locked before kickoff.
- It passed consistency checks before member visibility.
- It has complete settlement metadata.
- It has product-safe public copy.
- It does not expose raw feature IDs, provider internals, or private reasoning.

`settled_failed` and `settled_void` predictions remain internal by default. Aggregate transparency reporting may include them later.

Blocked or `Uzak Dur` outputs remain audit-only even when their settlement result is `settled_success`. Public eligibility depends on whether the output was a valid recommendation at generation time, not only whether the outcome later matched.

## Internal Settlement Review

Implemented read-only review endpoints:

```http
GET /api/football/predictions/settlements
GET /api/football/predictions/settlements/:settlementId
GET /api/football/matches/:matchId/prediction-settlements
```

Implemented dashboard routes:

- `/football/predictions/settlements`
- `/football/predictions/settlements/:settlementId`
- `/football/matches/:matchId/prediction-settlements`

These surfaces are authenticated and internal-only. They show settlement status, actual result, settlement reason, conflicts, audit-only flags, and visibility summaries. They do not include mutation controls and cannot mark predictions `member_visible`, `public_eligible`, or `public_published`.

`settled_success` is not public eligibility. A successful settlement can still be private/internal if it was not member-visible before kickoff, has unresolved consistency warnings, lacks public-safe copy, or is marked audit-only. `Uzak Dur` / blocked outputs can be settled for audit, but they must remain excluded from public recommendation and future tahmin kombini flows.

## Transparency And Copy Policy

Use:

- Tahmin
- Başarılı tahmin
- Analiz sonucu
- Güven skoru
- Risk seviyesi

Avoid:

- bahis
- banko
- garanti
- kazanç vaadi

Required disclaimer language:

- "Güven skoru kesinlik anlamına gelmez."
- "Tahminler veri destekli analiz çıktısıdır."
- "Geçmiş başarı gelecekteki sonuçları garanti etmez."

## Performance Tracking

Internal performance tracking must include:

- Total predictions.
- Success count.
- Failed count.
- Void count.
- Success rate.
- Breakdown by prediction type.
- Breakdown by date.

Public successful-prediction cards should not be the only source of truth. SkorIQ must retain all generated predictions for audit and calibration.

## Non-Goals

- No public endpoint.
- No prediction model.
- No tahmin kombini engine.
- No scheduler.
- No provider call or ingestion.
- No member-visible publishing.
- No public successful-prediction card creation.
