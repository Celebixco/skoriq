# Sofascore Static + Team Logo Evidence Plan

## Purpose

Sofascore is the preferred no-paid-cost candidate data source for now because paid providers are deferred at this stage. Sofascore is still only a provider candidate, not the domain model, and there is no confirmed official public API contract for this platform's use.

This document prepares strict static-data and team-logo evidence capture before any Sofascore adapter implementation. It does not implement a Sofascore adapter, application HTTP fetching, scraping, scheduled jobs, ingestion, database writes, schema changes, normalizers, frontend, prediction logic, or live-score behavior.

Current gate decision: `research_more`.

## Sofascore Risk Position

- Sofascore is preferred for now only because no-paid-cost data access is the current product constraint.
- Sofascore does not have a confirmed official public API contract for this platform's use.
- Any future adapter must be evidence-gated, cautious, and reversible.
- The canonical domain must remain provider-agnostic; do not hardcode Sofascore field names or IDs into shared schemas or public API contracts.
- No production ingestion is allowed until the adapter gate passes.
- No live-score behavior, live polling, WebSockets, or second-by-second refresh is allowed.
- Legal/terms risk must be acknowledged before any production use. This is not legal advice.

## Evidence Status Labels

| Status | Use When |
| --- | --- |
| `confirmed` | Sanitized reviewed sample response proves the field exists and maps cleanly. |
| `likely` | Public/manual evidence suggests availability, but a DTO-ready sample is missing. |
| `unknown` | No reviewed evidence proves the field. |
| `unavailable` | Reviewed evidence shows the field is not supplied. |
| `blocked` | Evidence capture is blocked by access, terms, rate limits, operational risk, or missing permission. |
| `raw_only` | Field exists, but no approved canonical target exists yet. |

## Static Evidence Scope

| Evidence Area | Required Evidence | Target DTO | Target Normalizer | Target Table | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Sports | Stable sport ID/key, name, optional slug | `ProviderSport` | `SportNormalizer` | `sports` | `likely` for names, IDs unknown | Public page shows football/basketball names; structured IDs remain unconfirmed. |
| Categories / countries | Stable category/country ID, name, optional code/slug | `ProviderCountry` | `CountryNormalizer` | `countries` | `unknown` | Category may not equal country in all cases; verify before mapping. |
| Football competitions/tournaments | Stable tournament ID, sport context, optional category/country, name, slug/type if available | `ProviderCompetition` | `CompetitionNormalizer` | `competitions` | `likely` for public names, IDs unknown | Featured public competition names are not enough for provider mappings. |
| Basketball competitions/tournaments | Stable tournament ID, sport context, optional category/country, name, slug/type if available | `ProviderCompetition` | `CompetitionNormalizer` | `competitions` | `likely` for public names, IDs unknown | Basketball evidence must be captured separately from football. |
| Seasons | Stable season ID, tournament/competition context, name/year, optional dates/current flag | `ProviderSeason` | `SeasonNormalizer` | `seasons` | `likely` for one football sample only | Existing season endpoint evidence is partial and undocumented. |
| Football teams | Stable team ID, sport, name, slug/country/category/logo if available | `ProviderTeam` | `TeamNormalizer` | `teams` | `unknown` | Team logo evidence is required before adapter readiness. |
| Basketball teams | Stable team ID, sport, name, slug/country/category/logo if available | `ProviderTeam` | `TeamNormalizer` | `teams` | `unknown` | Must verify basketball team shape separately. |
| Team logo URLs | Logo/image/crest/badge URL, absolute/stable/CDN characteristics, missing-logo behavior | `ProviderTeam.logoUrl` | `TeamNormalizer` | `teams.logo_url` | `unknown` | Critical gate item; missing individual logos are non-fatal but must be tracked. |

## Candidate Source / Endpoint Evidence Slots

| Operation | Possible Sofascore Source / Endpoint Placeholder | Sample Captured | Response Shape Summary | Required DTO Fields | Confirmed Fields | Missing Fields | Target DTO | Target Normalizer | Target Table | Readiness | Notes / Risks |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `list_sports` | Public categories page or future reviewed structured source | partial | Public page shows sport names only. | `providerEntityId`, `name` | Football/Basketball names only. | Stable provider sport IDs, slugs, structured response. | `ProviderSport` | `SportNormalizer` | `sports` | research_more | Names alone are not enough for provider mappings. |
| `list_countries/categories` | TBD category/country list source | no | No DTO-ready source reviewed. | `providerEntityId`, `name` | none | Category/country IDs, names, codes/slugs, sport relationship. | `ProviderCountry` | `CountryNormalizer` | `countries` | research_more | Verify whether Sofascore category means country, region, or competition grouping. |
| `list_football_competitions` | Public categories page or future reviewed tournament source | partial | Public page lists featured competition names. | `providerEntityId`, `sportProviderId`, `name` | Some names only. | Stable tournament IDs, sport/category refs, country refs, slugs. | `ProviderCompetition` | `CompetitionNormalizer` | `competitions` | research_more | Featured names are not complete coverage. |
| `list_basketball_competitions` | Public categories page or future reviewed tournament source | partial | Public page lists featured competition names. | `providerEntityId`, `sportProviderId`, `name` | Some names only. | Stable tournament IDs, sport/category refs, country refs, slugs. | `ProviderCompetition` | `CompetitionNormalizer` | `competitions` | research_more | Basketball must be evidenced independently. |
| `list_seasons` | Existing reviewed sample: `/api/v1/unique-tournament/{id}/seasons`; future sanitized samples required | partial | One football tournament sample returned a `seasons` array with `id`, `name`, `year`, and other fields. | `providerEntityId`, `competitionProviderId`, `name` | Season `id`, `name`, `year` for one football tournament. | Basketball seasons, stability, dates/current flag, approved endpoint policy. | `ProviderSeason` | `SeasonNormalizer` | `seasons` | research_more | Undocumented sample is not adapter approval. |
| `list_football_teams` | TBD team list/source for football tournament or team detail | no | No reviewed team response. | `providerEntityId`, `sportProviderId`, `name`; logo evidence required | none | Team ID/name shape, sport/category refs, slug, logo URL, missing-logo behavior. | `ProviderTeam` | `TeamNormalizer` | `teams` | research_more | Adapter not ready until football logo availability is confirmed or unavailable. |
| `list_basketball_teams` | TBD team list/source for basketball tournament or team detail | no | No reviewed team response. | `providerEntityId`, `sportProviderId`, `name`; logo evidence required | none | Team ID/name shape, sport/category refs, slug, logo URL, missing-logo behavior. | `ProviderTeam` | `TeamNormalizer` | `teams` | research_more | Adapter not ready until basketball logo availability is confirmed or unavailable. |

## Team Logo Evidence Checklist

Team logos are critical. Team adapter readiness is blocked until logo availability is confirmed or explicitly marked unavailable for both football and basketball team samples.

| Evidence Item | Football Status | Basketball Status | Notes |
| --- | --- | --- | --- |
| Provider team ID observed | `unknown` | `unknown` | Required for `ProviderTeam.providerEntityId`. |
| Team name observed | `unknown` | `unknown` | Required for `ProviderTeam.name`. |
| Team slug observed | `unknown` | `unknown` | Optional; use source slug only when confirmed. |
| Sport context observed | `unknown` | `unknown` | Required for `ProviderTeam.sportProviderId` or approved adapter-injected sport context. |
| Country/category observed | `unknown` | `unknown` | Optional mapping to `ProviderTeam.countryProviderId` when category/country mapping is confirmed. |
| Logo/image URL observed | `unknown` | `unknown` | Must map to `ProviderTeam.logoUrl` when usable. |
| Logo URL is absolute | `unknown` | `unknown` | Prefer absolute public URLs. |
| Logo URL appears stable | `unknown` | `unknown` | Must not contain private tokens or temporary signatures. |
| Logo URL is CDN/media path | `unknown` | `unknown` | Record host/path pattern without adding secrets. |
| Missing individual logos are possible | `unknown` | `unknown` | Missing logos should not fail ingestion, but must be logged/marked. |
| Maps to `ProviderTeam.logoUrl` | `unknown` | `unknown` | Do not bury logo in metadata. |
| Persists to `teams.logo_url` | supported by app | supported by app | Existing team DTO/normalizer/schema support first-class logo storage. |

Acceptance rules:

- Team adapter is not ready unless logo availability is confirmed or explicitly marked unavailable.
- Missing individual team logos are non-fatal.
- Missing logos must be logged or marked by future adapter mapping.
- Logo fields must not be discarded into generic metadata when `teams.logo_url` exists.

## DTO Mapping Checklist

### ProviderSport

| DTO Field | Required | Evidence Status | Required Decision |
| --- | --- | --- | --- |
| `providerEntityId` | yes | `unknown` | Need stable sport key or ID from reviewed evidence. |
| `name` | yes | `likely` | Public names exist; structured sample still required. |
| `slug` | no | `unknown` | Use source slug only if confirmed. |
| `metadata` | no | `unknown` | Keep provider-agnostic only. |

### ProviderCountry

| DTO Field | Required | Evidence Status | Required Decision |
| --- | --- | --- | --- |
| `providerEntityId` | yes | `unknown` | Need stable category/country ID. |
| `name` | yes | `unknown` | Need reviewed category/country response. |
| `code` | no | `unknown` | Use only if supplied; do not invent ISO codes. |
| `slug` | no | `unknown` | Use source slug or normalized name only after policy approval. |
| `metadata` | no | `unknown` | Keep provider-agnostic only. |

### ProviderCompetition

| DTO Field | Required | Evidence Status | Required Decision |
| --- | --- | --- | --- |
| `providerEntityId` | yes | `unknown` | Need stable tournament/competition ID. |
| `sportProviderId` | yes | `unknown` | Need sport context from source or approved adapter context. |
| `countryProviderId` | no | `unknown` | Use only after category/country mapping is confirmed. |
| `name` | yes | `likely` | Public featured names exist; complete source still required. |
| `slug`, `gender`, `level` | no | `unknown` | Omit unless confirmed and provider-agnostic. |
| `metadata` | no | `unknown` | Keep provider-agnostic only. |

### ProviderSeason

| DTO Field | Required | Evidence Status | Required Decision |
| --- | --- | --- | --- |
| `providerEntityId` | yes | `likely` for one football sample | Convert reviewed season ID to string only after endpoint approval. |
| `competitionProviderId` | yes | `likely` for endpoint path injection | Decide whether request-context competition ID is acceptable. |
| `name` | yes | `likely` for one football sample | Preserve reviewed source name. |
| `startDate`, `endDate`, `isCurrent` | no | `unknown` | Omit unless confirmed. |
| `metadata` | no | `likely` | Store only provider-agnostic fields; keep provider-specific details raw-only. |

### ProviderTeam

| DTO Field | Required | Evidence Status | Required Decision |
| --- | --- | --- | --- |
| `providerEntityId` | yes | `unknown` | Need stable team ID. |
| `sportProviderId` | yes | `unknown` | Need sport context from source or approved adapter context. |
| `countryProviderId` | no | `unknown` | Use only after category/country mapping is confirmed. |
| `name` | yes | `unknown` | Need reviewed team response. |
| `shortName`, `slug`, `venueName`, `foundedYear` | no | `unknown` | Omit unless confirmed. |
| `logoUrl` | no, but evidence-required | `unknown` | Confirm or mark unavailable before team adapter readiness. |
| `metadata` | no | `unknown` | Do not store logo only in metadata. |

## Adapter Gate For Sofascore Static Slice

Decision: `research_more`.

Gate values:

- `not_ready`: evidence or architecture blocks the operation entirely.
- `research_more`: samples or mapping evidence are incomplete.
- `ready_for_shell_only`: operation can be represented without real fetching.
- `ready_for_adapter_implementation`: all evidence, mapping, safety, and test gates are satisfied.

Gate requirements before `ready_for_adapter_implementation`:

- Sanitized sample responses captured for static operations.
- Football and basketball team logo evidence captured.
- DTO mappings complete with no unresolved required fields.
- Missing-field policy defined.
- Retry/rate-limit behavior documented.
- Raw payload retention confirmed.
- Tests planned.
- Production safety documented.
- Terms/legal risk acknowledged.
- No live-score behavior added.

## Future Mapper Test Plan

- Maps sport evidence to `ProviderSport`.
- Maps category/country evidence to `ProviderCountry`.
- Maps tournament/competition evidence to `ProviderCompetition`.
- Maps season evidence to `ProviderSeason`.
- Maps football team evidence to `ProviderTeam` with `logoUrl`.
- Maps basketball team evidence to `ProviderTeam` with `logoUrl`.
- Missing logo does not fail mapping.
- Missing logo is logged or marked.
- Logo URL is not lost into metadata.
- Mapper tests perform no database writes.

## Non-Goals

- No Sofascore adapter code yet.
- No application HTTP fetching code.
- No scraping code.
- No scheduled jobs.
- No production ingestion.
- No database writes.
- No schema changes.
- No normalizer changes.
- No frontend.
- No prediction model.
- No live-score system.
