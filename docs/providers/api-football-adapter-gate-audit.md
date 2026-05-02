# API-Football Static Adapter Gate Audit

## Summary

This audit evaluates whether API-Football is ready for the first static adapter slice. It is documentation only and does not implement an adapter, HTTP client, API keys, scheduled jobs, ingestion, database writes, schema changes, normalizers, frontend, prediction logic, or live-score behavior.

Current gate status: `research_more`.

Reason: no sanitized API-Football sample responses have been captured, exact response fields are unverified, pricing/limits/rate-limit behavior still require manual verification, and terms suitability still requires review.

## Audit Inputs

- `docs/providers/api-football-field-evidence.md`
- `docs/providers/api-football-sample-capture-checklist.md`
- `docs/providers/provider-operation-coverage-matrix.md`
- `docs/architecture/provider-adapter-implementation-gate.md`
- `docs/architecture/ingestion-roadmap.md`
- `docs/providers/provider-candidate-comparison.md`
- `packages/providers/src/provider-dtos.ts`
- `packages/shared/src/domain.ts`
- `packages/providers/src/provider-adapter.ts`
- `packages/providers/src/provider-registry.ts`
- `packages/pipeline/src/provider-adapter-ingestion-bridge.ts`

## Current Gate Status

Decision: `research_more`.

| Gate Area | Result | Notes |
| --- | --- | --- |
| Sanitized samples | not satisfied | No API-Football samples are captured. No field should be marked `confirmed`. |
| DTO mapping proof | partial | Candidate mappings exist in documentation, but no response shape proves them. |
| Target normalizers/tables | satisfied | Static normalizers and canonical tables exist for countries, competitions, seasons, and teams. |
| Team logo evidence | not satisfied | Logo availability is documented as required evidence, but no team sample has verified it. |
| Rate-limit/retry policy | not satisfied | Must be verified before adapter implementation. |
| Terms/legal risk | not satisfied | Must be acknowledged and reviewed before production use. This is not legal advice. |
| Production safety docs | mostly satisfied | Docs prohibit secrets, scheduled jobs, DB writes, and app fetching during evidence capture. |

## Required Field Blockers

### Countries

| Item | Audit Result |
| --- | --- |
| Required DTO fields | `providerEntityId`, `name` |
| Current evidence status | `likely` for endpoint family/name; `unknown` for stable provider ID/code. |
| Blocking unknowns | Whether the countries response includes a stable ID/code usable as `providerEntityId`; exact field names and nesting. |
| Minimum sample needed | One sanitized countries response snippet showing country identifier and name. |
| Missing-field policy | Missing `providerEntityId` or `name` blocks country adapter mapping. Optional `code`, `slug`, and metadata may be omitted. |
| Target normalizer | `CountryNormalizer` |
| Target table | `countries` |

### Leagues / Competitions

| Item | Audit Result |
| --- | --- |
| Required DTO fields | `providerEntityId`, `sportProviderId`, `name` |
| Current evidence status | `likely` for leagues endpoint family, league ID/name; `unknown` for explicit sport identity. |
| Blocking unknowns | Exact league ID/name shape, whether country is included, and whether football sport identity is present or must be injected from adapter context. |
| Minimum sample needed | One sanitized leagues response showing league identifier, name, country context, and any season/context fields. |
| Missing-field policy | Missing `providerEntityId`, `sportProviderId`, or `name` blocks competition adapter mapping. Optional country, slug, gender, level, and metadata may be omitted. |
| Target normalizer | `CompetitionNormalizer` |
| Target table | `competitions` |

### Seasons

| Item | Audit Result |
| --- | --- |
| Required DTO fields | `providerEntityId`, `competitionProviderId`, `name` |
| Current evidence status | `likely` for seasons endpoint family or season values from league responses; exact shape unconfirmed. |
| Blocking unknowns | Whether seasons have stable IDs or only year values; how to scope year-only seasons to competition; whether dates/current flag exist. |
| Minimum sample needed | One sanitized seasons response or leagues response section showing season values and the competition context used to construct `competitionProviderId`. |
| Missing-field policy | Missing `providerEntityId`, `competitionProviderId`, or `name` blocks season adapter mapping. Optional dates/current flag may be omitted. |
| Target normalizer | `SeasonNormalizer` |
| Target table | `seasons` |

### Teams

| Item | Audit Result |
| --- | --- |
| Required DTO fields | `providerEntityId`, `sportProviderId`, `name`; logo availability evidence is required for adapter readiness. |
| Current evidence status | `likely` for teams endpoint family, team ID/name/profile fields; `unknown` for sport identity and confirmed logo availability. |
| Blocking unknowns | Exact team ID/name shape, whether country can map to `countryProviderId`, whether logo URL exists, whether the logo URL is absolute/stable/public, and how missing logos appear. |
| Minimum sample needed | One sanitized teams response showing team ID, name, sport/context source, logo/image/crest/badge field if available, venue/founded fields if available, and at least one example documenting missing-logo behavior if observed. |
| Missing-field policy | Missing `providerEntityId`, `sportProviderId`, or `name` blocks team adapter mapping. Missing individual logos should not block ingestion, but must be tracked. Unknown overall logo availability blocks team adapter readiness. |
| Target normalizer | `TeamNormalizer` |
| Target table | `teams` |

## Team Logo Gate Result

Result: not satisfied.

| Check | Result | Notes |
| --- | --- | --- |
| `ProviderTeam.logoUrl` present | satisfied | `ProviderTeam` includes optional `logoUrl`. |
| `TeamNormalizer` persists `logoUrl` | satisfied | Team normalization passes `dto.logoUrl` into team repository input. |
| `teams.logo_url` exists | satisfied | The canonical `teams` table has `logo_url`. |
| Documentation requires logo evidence | satisfied | The sample checklist and field evidence docs require logo availability evidence before team adapter readiness. |
| Adapter readiness blocked while logo availability is unknown | satisfied | Current gate remains `research_more` and team adapter is not field-complete. |
| Missing individual logos non-fatal | satisfied in docs | Docs state missing individual logos should not fail ingestion. |
| Missing logos logged or marked | weak / future work | This is documented as required, but no API-Football adapter diagnostics/logging implementation exists yet because no adapter exists. Future adapter work must add this explicitly. |
| Logo not lost into metadata | satisfied in docs and target model | Docs require mapping to `ProviderTeam.logoUrl`; canonical `teams.logo_url` exists. |

## Adapter Shell vs Adapter Implementation

| Option | Recommendation | Reason |
| --- | --- | --- |
| No-op shell only | Not recommended as the next task | Technically safe, but low value because the generic provider adapter shell and local no-op adapter already exist. |
| Mapping-only adapter with fixture samples | Not ready | No sanitized samples exist. Mapper behavior would be guesswork. |
| Real API-Football HTTP adapter | Not ready | Requires sample evidence, exact DTO mapping, rate-limit/retry policy, terms review, and secret handling decisions. |

Smallest safe next coding task after samples: create sample-based mapper fixtures/tests for countries first, then leagues, seasons, and teams with logo evidence. Until samples are captured, the next action is manual evidence capture, not coding.

## Production Safety Findings

| Safety Area | Result | Notes |
| --- | --- | --- |
| API key leakage prevention | satisfied in docs | Checklist forbids committing API keys, secret headers, cookies, sessions, or account-specific data. |
| Production database pollution prevention | satisfied in docs/contracts | Evidence capture must not write to DB. Adapter bridge writes only when explicitly executed with an adapter and ingestion service. |
| Scheduled sync too early | satisfied in docs | Roadmap and checklist prohibit scheduled jobs in this phase. |
| Mock/no-op provider in production | satisfied in existing architecture | Existing no-op provider is local/test-only and blocked from production usage by prior adapter shell policy. |
| Team logos lost into metadata | mostly satisfied | First-class DTO and DB column exist, and docs require `logoUrl`; future adapter tests must enforce it. |
| Missing-logo observability | weak / future work | Docs require missing-logo tracking, but the concrete adapter logging/status mechanism must be implemented with the future adapter. |
| Live-score behavior | satisfied in docs | API-Football evidence scope excludes live polling, live-score queues, WebSockets, and prediction behavior. |

## Gate Decision

API-Football is not ready for adapter implementation.

Current decision: `research_more`.

Do not implement a real API-Football HTTP adapter until:

- Countries sample is captured and mapped.
- Leagues/competitions sample is captured and mapped.
- Seasons sample is captured and mapped.
- Teams sample is captured with logo availability evidence.
- Required DTO fields have no unresolved blockers.
- Missing optional fields have explicit omit, raw-only, safe metadata, or diagnostic policy.
- Rate-limit and retry behavior are documented.
- Terms/legal risk has been acknowledged for review.
- Sample-based mapper tests are planned.

## Recommended Next Step

Manually capture sanitized API-Football samples using `docs/providers/api-football-sample-capture-checklist.md` in this order:

1. Countries.
2. Leagues / competitions.
3. Seasons.
4. Teams, including logo URL evidence.

After those samples exist, the smallest safe coding task is sample-based mapper tests for the countries mapper, followed by leagues, seasons, and teams with logo assertions.
