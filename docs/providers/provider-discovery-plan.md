# Provider Discovery Plan

## Purpose

Provider discovery is the research phase before adapter implementation. It proves what a candidate provider can supply, what is stable enough to normalize, what must remain raw-only, and whether the provider is safe enough to use in production.

Discovery is separate from ingestion. Discovery must not write to the database, create scheduled jobs, enqueue provider work, seed mock data, or modify canonical tables.

## Discovery Workflow

1. Identify the provider candidate, provider name, website/docs location, and whether it appears to offer an official API.
2. Record sport coverage for football and basketball separately.
3. Record entity coverage against the current operation map: static entities, teams, players, matches, scores, team statistics, standings, and future advanced data.
4. Capture representative sample responses manually or through an approved research-only process outside application code.
5. Map response fields to provider-agnostic DTOs and target tables.
6. Mark unsupported, ambiguous, provider-specific, unstable, or high-volume fields as raw-only or future work.
7. Record response stability observations, rate-limit observations, authentication requirements, and operational risks.
8. Add a legal/terms risk note for review before production use. This is a technical risk note, not legal advice.
9. Decide whether each operation is rejected, needs more research, can support a shell only, or is ready for adapter implementation.
10. Review the adapter implementation gate before writing real provider code.

## Provider Discovery Record

| Field | Notes |
| --- | --- |
| Provider name | Candidate provider name. |
| Provider type | Official API, partner API, public web data, data vendor, manual import, or unknown. |
| Sports covered | Football, basketball, both, or unknown. |
| Authentication | None observed, API key, session/cookie, OAuth, partner credentials, or unknown. |
| Rate-limit observations | Unknown until observed; do not assume production-safe limits. |
| Legal/terms risk note | Required before production use. |
| Response stability | Unknown, stable, unstable, versioned, undocumented, or blocked. |
| Production readiness | Reject, research more, build shell, build adapter, or blocked. |

## Coverage Areas

| Area | Evidence Needed | Discovery Decision |
| --- | --- | --- |
| Sport coverage | Football and basketball availability. | Determine whether provider can serve one or both analysis domains. |
| Entity coverage | Sports, countries, competitions, seasons, teams, players, matches. | Determine whether static dependencies can be built safely. |
| Operation coverage | Match each provider response to MVP provider operations. | Determine adapter scope and unsupported operations. |
| Field availability | Confirm each P0/P1/P2 field in sample responses. | Decide normalized, raw-only, future, or unavailable. |
| Response stability | Compare response shape across sample leagues/sports if evidence exists. | Decide whether normalization is safe. |
| Rate limits | Capture observed headers, errors, or published limits. | Decide sync frequency and retry behavior. |
| Missing fields | Record fields absent from samples. | Define missing-field behavior before adapter work. |
| Production safety | Confirm no mock data, no test DB pollution, and no live-score behavior. | Required for adapter approval. |

## Raw-Only Vs Normalized Decision

Normalize a field only when:

- It is provider-agnostic.
- It maps to an existing DTO.
- A target table and normalizer already exist.
- Validation and missing-field behavior are documented.
- Tests are planned.

Keep a field raw-only when:

- It is provider-specific, ambiguous, unstable, or high volume.
- It targets a future table that is not approved yet.
- It is useful for later research but not needed for P0/P1 ingestion.
- Legal/terms or operational risk is unresolved.

## Discovery Non-Goals

- No real provider adapter.
- No provider HTTP client in application code.
- No scraping code in application code.
- No scheduled provider sync.
- No ingestion jobs.
- No database writes.
- No prediction model.
- No frontend.
- No live-score system.

