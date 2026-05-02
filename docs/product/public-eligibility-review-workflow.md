# Public Eligibility Review Workflow Plan

## Purpose

This plan defines the future internal workflow for moving a settled successful football Tahmin from `eligible=true` in the evaluator to a public `Başarılı Tahmin` card.

This is planning only. There is no mutation endpoint, no public page, no public publishing, no status mutation, no `public_successful_predictions` insert flow, and no tahmin kombini implementation in this step.

## Workflow States

These are future review workflow states. They are product workflow states and are not necessarily current database statuses.

| State | Meaning |
| --- | --- |
| `evaluator_eligible` | The read-only evaluator says the settled output satisfies the public eligibility policy. |
| `review_pending` | An admin has queued the candidate for manual review. |
| `public_draft_created` | A draft `public_successful_predictions` row has been created, but is not visible publicly. |
| `approved_for_public` | Admin review approved the public wording and eligibility evidence. |
| `public_published` | The successful prediction is visible on the future public page. |
| `public_hidden` | A previously published card is hidden. |
| `public_rejected` | Admin review rejected the candidate. |

## Preconditions

A prediction can enter public review only when all conditions are true:

- Settlement status is `settled_success`.
- The public eligibility evaluator returns `eligible=true`.
- Prediction was generated before kickoff.
- Recommendation tier is `primary` or `try`.
- Consistency status is `passed` or `warning`.
- `audit_only=false`.
- There are no blocking conflicts.
- Metadata is safe for public use.
- Internal admin review is required before any public draft or publish action.

## Admin Review Checklist

Before creating or approving a public draft, an admin must review:

- Prediction type and value.
- Match identity, competition, home team, and away team.
- `generated_at` compared with kickoff time.
- Güven skoru and confidence ceiling.
- Consistency warnings and risk notes.
- Settlement success and actual result.
- Suggested public title and summary wording.
- No misleading, certainty, or guarantee language.
- No raw provider data, provider IDs, DB URLs, API keys, JWTs, password hashes, or internal payload references.
- Candidate is not `avoid`, `blocked`, or audit-only.

## Public Draft Creation

Future public draft creation should create a `public_successful_predictions` row with:

- `prediction_output_id`.
- `public_title`.
- `public_summary`.
- `public_visible_at`.
- `display_order`.
- `is_featured`.
- `status=draft`.

Creating a public draft must not automatically publish it. It should remain internal until a separate publish action is explicitly approved.

## Publishing Rules

A public draft can be published only if:

- It is still linked to a `settled_success` prediction output.
- The linked output is not manually excluded.
- No new blocker appears after review.
- Public copy is safe and product-compliant.
- Admin explicitly confirms publication.

`public_published` should be a deliberate action, not a side effect of settlement or evaluator eligibility.

## Hide / Unpublish Rules

A public successful prediction can be hidden if:

- A data correction occurs.
- A settlement error is discovered.
- Public copy is misleading or too strong.
- Provider correction changes final score or match status.
- Admin manually hides it for product, legal, or quality reasons.

Hidden cards should remain internally auditable.

## Audit Trail

Future implementation should add audit fields or an action log for:

- `reviewed_by`.
- `reviewed_at`.
- `published_by`.
- `published_at`.
- `hidden_by`.
- `hidden_at`.
- `review_notes`.
- `action_log`.

The audit trail should record who performed each transition and why. It must not expose secrets or raw provider payloads.

## Future API Plan

Admin endpoints, not implemented:

```http
POST /api/admin/football/predictions/:id/mark-public-eligible
POST /api/admin/football/predictions/:id/create-public-draft
PATCH /api/admin/football/public-successful-predictions/:id
POST /api/admin/football/public-successful-predictions/:id/publish
POST /api/admin/football/public-successful-predictions/:id/hide
```

Public endpoints, not implemented:

```http
GET /api/public/football/successful-predictions
GET /api/public/football/successful-predictions/:id
```

All future admin mutation endpoints must be authenticated, audited, and guarded by the evaluator result.

## Future Dashboard Plan

Future internal dashboard pages:

- Public Eligibility Candidates.
- Public Drafts.
- Published Successful Predictions.
- Hidden / Rejected Predictions.

Dashboard mutation controls should be absent until API mutation endpoints, audit logging, permission checks, tests, and copy review rules are implemented.

## Public Copy Rules

Use:

- Başarılı Tahmin.
- Analiz Sonucu.
- Güven skoru.
- Tahmin maçtan önce üretildi.
- Sonuçlandı.

Avoid:

- bahis.
- banko.
- garanti.
- kazanç vaadi.
- kesin.

Required disclaimer direction:

- Güven skoru kesinlik anlamına gelmez.
- Geçmiş başarı gelecekteki sonuçları garanti etmez.
- Public cards are historical analysis results, not active recommendations.

## Transparency

The public page may show successful predictions, but the internal system must track every prediction outcome: success, failure, and void.

Future aggregate performance summaries should disclose total counts and success rate if enabled. Showing only successful cards without internal accounting would be misleading.

## Dortmund vs Freiburg Example

Current Dortmund vs Freiburg is not review eligible.

Observed evaluator result:

- `eligible=0`.
- `excluded=5`.
- All outputs include `generated_after_kickoff`.
- `BTTS yes` is also `settled_failed`.
- `first_half_over_0_5` is also `avoid`, `blocked`, and audit-only.

No public review workflow should start for this match because public proof requires predictions generated before kickoff.

## Implementation Roadmap

Recommended future order:

1. Add audit fields or action log for public review.
2. Add mark-public-eligible mutation guarded by evaluator.
3. Add public draft creation.
4. Add publish/hide mutations.
5. Add public successful predictions API.
6. Add public page.
7. Add aggregate performance summary.

Tahmin kombini remains later and must not consume public eligibility review state directly.
