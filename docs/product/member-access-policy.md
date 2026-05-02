# Member Access Policy

## Purpose

SkorIQ separates public proof/results from member-only analysis. Anonymous visitors may later see limited settled successful predictions, but they must not access active analytics, upcoming predictions, dashboard routes, detailed reasoning, provider/admin tooling, or future prediction-combination features.

This is a product policy plan only. It does not change auth behavior or implement public pages.

Related future workflow docs:

- [Football Prediction Output Workflow](./football-prediction-output-workflow.md)
- [Prediction Settlement Policy](./prediction-settlement-policy.md)
- [Public Prediction Eligibility Policy](./public-prediction-eligibility-policy.md)

## Access Matrix

| Resource | Anonymous visitor | Member | Admin |
| --- | --- | --- | --- |
| Dashboard | No access | Access | Access |
| Football analytics match list | No access | Access | Access |
| Match detail analytics | No access | Access | Access |
| Upcoming prediction outputs | No access | Access when future prediction output exists | Access |
| Settled successful predictions | Limited public cards only, future work | Full member view, future work | Full access |
| Settled failed predictions | No individual public access unless future transparency report is approved | Member/admin policy TBD | Access for audit |
| Full reasoning | No access | Access | Access |
| Public limited reasoning | Future public card summary only | Access | Access |
| Future tahmin kombini feature | No access | Access only if implemented and policy-approved | Access |
| Provider/admin pages | No access | No access unless role-expanded | Access |

## Current Enforcement

Current protected surfaces:

- `/login`
- Dashboard routes under `/football/*`
- `GET /api/member/football/matches/:matchId/prediction-preview`
- `GET /api/analytics/football/matches`
- `GET /api/analytics/football/matches/:matchId`
- `GET /api/football/teams`
- `GET /api/football/teams/:teamId`
- `GET /api/football/competitions`
- `GET /api/football/competitions/:competitionId`

When auth is enabled, unauthenticated requests must return `401` or redirect to `/login` in the dashboard.

## Member Rules

Members may access read-only analysis and member-safe prediction previews. Member access does not imply public visibility.

Members may see:

- Detailed Maç analizi.
- Safe prediction preview groups: `Tahminim`, `Denenir`, and `Alternatif`.
- Güven skoru, risk seviyesi, and short reasoning summaries.

Members must not see:

- Admin draft internals.
- Conflict internals.
- Raw metadata or expectation snapshots.
- Audit-only rows.
- `Uzak Dur`, `avoid`, or `blocked` candidates.
- Generated-after-kickoff candidates.
- Provider IDs or raw provider payloads.

Consistency status controls member visibility. If a candidate is `blocked`, it is an internal `Uzak Dur` audit row only and must not be presented as `Tahminim`, `Denenir`, or `Alternatif` in member-safe previews.

Members may eventually see:

- Future member prediction pages.
- Future prediction-combination tools if explicitly implemented later.

Members must not receive provider secrets, raw provider payloads, DB credentials, password hashes, JWTs, or admin-only tooling.

## Admin Rules

Admins may access operational/provider pages only when those pages exist and are protected. Admin access is for internal operations, audit, settlement review, and quality control.

Future admin-only capabilities may include:

- Reviewing all prediction outputs.
- Viewing all settlements.
- Marking successful predictions as public-eligible.
- Publishing successful predictions.
- Excluding settled-success outputs from public visibility when they are `avoid`, `blocked`, `audit_only`, generated late, missing metadata, or manually rejected.
- Reviewing aggregate performance.

Admin actions must be audited when implemented.

## Future Tahmin Kombini Rule

The future tahmin kombini feature is member-only. Anonymous visitors cannot generate combinations.

Future rules:

- Use only `ready` prediction outputs.
- Exclude `insufficient_data`.
- Safe mode should require a higher Güven skoru threshold.
- Missing H2H or other confidence caps must reduce eligibility.
- The feature must not be implemented until prediction outputs, settlement, and performance tracking exist.

## Future API Plan

Public endpoints:

```http
GET /api/public/football/successful-predictions
GET /api/public/football/successful-predictions/:id
```

Member endpoints:

```http
GET /api/member/football/matches/:matchId/prediction-preview
GET /api/member/football/predictions/upcoming
GET /api/member/football/predictions/:id
```

Admin endpoints:

```http
GET /api/admin/football/predictions
POST /api/admin/football/predictions/:id/settle
POST /api/admin/football/predictions/:id/publish
```

These are plans only and must not be exposed until the required data model, auth guards, settlement workflow, and tests exist.

## Future UI Plan

Public:

- `/successful-predictions`
- Title: `Başarılı Tahminler`
- Shows limited settled successful predictions only.
- Does not show active/upcoming predictions.

Member:

- `/football/predictions`
- `/football/predictions/:id`
- Shows active predictions and detailed reasoning after future implementation.
- Future tahmin kombini tools remain member-only.

Admin:

- Future protected settlement and publication pages.

## Anti-Misleading Policy

SkorIQ must avoid certainty language. Güven skoru is not certainty. Public successful-prediction cards are historical proof/results, not active recommendations.

Internally, SkorIQ must retain successes, failures, and voids for quality tracking. If public performance reporting is approved later, it should show total prediction count and success rate rather than only highlighting successful examples.

## Non-Goals

- No billing or subscription implementation.
- No prediction model implementation.
- No public page implementation.
- No tahmin kombini implementation.
- No auth behavior changes.
- No database migration.
- No provider call, ingestion, scheduler, or frontend implementation.
