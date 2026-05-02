# Provider Field Availability Plan

## Purpose

Provider integration must be driven by field availability, prediction usefulness, and normalized storage readiness. This document defines what the current platform can normalize, what future provider research must prove, and what must remain raw-only until a schema or normalizer exists.

Sofascore is a candidate source, not the platform contract. Do not assume any candidate provider exposes a field until a provider response has been inspected and mapped.

Discovery and evidence capture live in:

- `docs/providers/provider-discovery-plan.md`
- `docs/providers/sofascore-field-evidence.md`
- `docs/providers/provider-evidence-template.md`
- `docs/providers/provider-operation-coverage-matrix.md`
- `docs/architecture/provider-adapter-implementation-gate.md`

## Current Implemented Coverage

| Domain | Table | Stores | Provider Fields Needed | Priority | Status |
| --- | --- | --- | --- | --- | --- |
| Shared | `sports` | Canonical sport identity. | provider sport ID, name, slug/code when available. | P0 | Implemented |
| Shared | `countries` | Canonical country identity. | provider country ID, name, ISO/code or slug when available. | P0 | Implemented |
| Shared | `competitions` | Canonical competition identity and sport/country context. | provider competition ID, sport provider ID, optional country provider ID, name, type/level/gender. | P0 | Implemented |
| Shared | `seasons` | Canonical season identity under a competition. | provider season ID, competition provider ID, name, year/date range when available. | P0 | Implemented |
| Shared | `teams` | Shared canonical team identity/profile, separated by `sport_id`. | provider team ID, sport provider ID, optional country provider ID, name, slug, short name, logo/profile fields. | P0 | Implemented |
| Shared | `players` | Shared canonical player identity/profile, separated by `sport_id`. | provider player ID, sport provider ID, name, optional current team/country provider IDs, DOB/profile fields. | P1 | Implemented |
| Shared | `matches` | Shared canonical fixture/match identity and common context. | provider match ID, competition provider ID, home/away team provider IDs, scheduled start, status, optional season/winner/context fields. | P0 | Implemented |
| Football | `football_match_scores` | Football score summary. | match provider ID, halftime/fulltime/current scores, optional extra-time/penalty scores, winner provider team ID. | P0 | Implemented |
| Football | `football_match_team_statistics` | Football team-level match statistics. | match provider ID, team provider ID, shots, possession, corners, cards, xG/big chances when available. | P0/P1 | Implemented |
| Football | `football_standings` | Football league table rows. | competition provider ID, optional season provider ID, team provider ID, played, wins/draws/losses, goals, points, position. | P0 | Implemented |
| Basketball | `basketball_match_scores` | Basketball final/summary score. | match provider ID, final/current/halftime/overtime scores, winner provider team ID. | P0 | Implemented |
| Basketball | `basketball_period_scores` | Basketball quarter and overtime score rows. | match provider ID, period number/type, optional overtime number, home/away period score. | P0 | Implemented |
| Basketball | `basketball_team_match_statistics` | Basketball team box-score level statistics. | match provider ID, team provider ID, shooting splits, rebounds, assists, turnovers, fouls, paint/bench points. | P0/P1 | Implemented |
| Basketball | `basketball_standings` | Basketball league table rows. | competition provider ID, optional season provider ID, team provider ID, position, played, wins/losses, win percentage, points for/against. | P0 | Implemented |

## Storage Decision Rules

- Normalize a field only when a provider-agnostic DTO, target table, validation behavior, and tests exist.
- Store unknown or provider-specific response details only in raw payloads unless a generic `metadata` field is explicitly part of the DTO.
- Do not add fields to shared identity tables for sport-specific statistics, events, lineups, box scores, odds, or prediction features.
- Do not create canonical entities from dependent facts. Scores, statistics, and standings must depend on already-normalized canonical mappings.
- Do not expose provider IDs through public APIs by default.

## Field Acceptance Checklist

Before implementing any provider endpoint, confirm:

- The field exists in an inspected provider response.
- The provider-specific evidence document has been updated.
- The adapter implementation gate has been reviewed.
- The field maps to a known provider-agnostic DTO or has a documented raw-only decision.
- The target table exists, or the future table plan is approved before normalization work starts.
- The field priority is defined as P0, P1, or P2.
- Missing-field behavior is defined.
- Validation rules are defined.
- Sync frequency is defined.
- Raw payload retention and cleanup behavior are understood.
- Unit tests and, when practical, local PostgreSQL integration tests are planned.
- Production mock/test-data pollution risk is explicitly avoided.

## Provider Adapter Shell

Provider adapters must implement the provider-agnostic adapter contract before any real endpoint work starts.

Adapter responsibilities:

- Declare provider name, optional version, capabilities, supported sports, supported entity types, and supported endpoint metadata.
- Return health status without requiring live provider calls in shell implementations.
- Accept a `ProviderRequestContext` with operation, sport, entity type, params, request hash input, optional sync job ID, and optional correlation ID.
- Return a `ProviderFetchResult` wrapper that can be handed to the ingestion service.
- Fail clearly for unsupported providers, unsupported operations, and operation/entity mismatches.

Provider registry responsibilities:

- Register adapters by unique provider name.
- Reject duplicate provider names.
- Return registered capabilities for inspection and future scheduler decisions.
- Fail clearly when an unknown provider is requested.

Local-only shell behavior:

- The local no-op adapter returns controlled in-memory results and never calls external URLs.
- The local no-op adapter is forbidden in production.
- The legacy mock sports data provider is also forbidden in production.
- No local/mock adapter is scheduled automatically and no mock provider data may be written into Neon production.

Adapter-to-ingestion handoff:

```text
ProviderAdapter operation
-> ProviderFetchResult
-> ProviderIngestionService.ingestProviderResult()
-> raw_provider_payloads
-> raw-payload-processing-queue
-> RawPayloadProcessor
-> normalizer
```

The adapter layer does not write canonical tables directly.

## MVP Provider Operation Map

| Operation | Entity Type | Target | Priority | Timing | Notes |
| --- | --- | --- | --- | --- | --- |
| `list_sports` | `sport` | `sports` | P0 | static | Static canonical identity. |
| `list_countries` | `country` | `countries` | P0 | static | Static canonical identity. |
| `list_competitions` | `competition` | `competitions` | P0 | static | Requires sport mapping during normalization. |
| `list_seasons` | `season` | `seasons` | P0 | static | Requires competition mapping. |
| `list_teams` | `team` | `teams` | P0 | periodic | Requires sport mapping. |
| `list_players` | `player` | `players` | P1 | periodic | Requires sport mapping. |
| `list_upcoming_matches` | `match` | `matches` | P0 | pre_match | Requires competition and team mappings. |
| `list_finished_matches` | `match` | `matches` | P0 | post_match | Requires competition and team mappings. |
| `get_match_details` | `match` | `matches` | P0 | pre_match | Common match context only. |
| `get_football_match_score` | `football_match_score` | `football_match_scores` | P0 | post_match | Dependent score row; no score-row provider mapping. |
| `get_basketball_match_score` | `basketball_match_score` | `basketball_match_scores` | P0 | post_match | Dependent score row; no score-row provider mapping. |
| `get_basketball_period_scores` | `basketball_period_score` | `basketball_period_scores` | P0 | post_match | Quarter/overtime rows. |
| `get_football_team_statistics` | `football_match_team_statistics` | `football_match_team_statistics` | P0 | post_match | Requires match and team mappings. |
| `get_basketball_team_statistics` | `basketball_team_match_statistics` | `basketball_team_match_statistics` | P0 | post_match | Requires match and team mappings. |
| `get_football_standings` | `football_standing` | `football_standings` | P0 | periodic | Requires competition and team mappings. |
| `get_basketball_standings` | `basketball_standing` | `basketball_standings` | P0 | periodic | Requires competition and team mappings. |

## Provider Risk Analysis

- Candidate providers may not offer official public APIs.
- Endpoint paths, response shapes, and field names can change without notice.
- Rate limits or anti-abuse controls may exist.
- Field availability may differ by sport, league, country, season, or match importance.
- Lower leagues may lack statistics, player details, lineups, or standings splits.
- Some fields may only become available after match finalization.
- Some fields may be visible in a UI but not available as stable structured data.
- Legal and terms-of-service review is required before production use. This document is technical planning only and is not legal advice.

## What Not To Build Yet

- No real provider adapter.
- No scraping code.
- No Sofascore-specific architecture.
- No real HTTP fetching.
- No prediction model.
- No betting or odds module.
- No live-score system.
- No frontend.
- No new schema or normalizers from this planning document alone.
