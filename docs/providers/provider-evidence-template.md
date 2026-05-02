# Provider Evidence Template

Use this template for every candidate provider before adapter implementation.

## Provider Overview

| Field | Value |
| --- | --- |
| Provider name | TBD |
| Provider website/docs | TBD |
| Provider type | Official API / partner API / public web data / data vendor / manual import / unknown |
| Sports supported | TBD |
| Countries/leagues sampled | TBD |
| Authentication requirements | TBD |
| Rate-limit notes | TBD |
| Legal/terms notes | Requires review before production use. |
| Research owner | TBD |
| Last updated | TBD |

## Operation Coverage

| Operation | Sport | Evidence Status | Sample Source | Required Fields Present? | Target DTO | Target Table | Adapter Readiness | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `list_sports` | all | `unknown` | TBD | TBD | `ProviderSport` | `sports` | research more | TBD |
| `list_countries` | all | `unknown` | TBD | TBD | `ProviderCountry` | `countries` | research more | TBD |
| `list_competitions` | all | `unknown` | TBD | TBD | `ProviderCompetition` | `competitions` | research more | TBD |
| `list_seasons` | all | `unknown` | TBD | TBD | `ProviderSeason` | `seasons` | research more | TBD |
| `list_teams` | football/basketball | `unknown` | TBD | TBD | `ProviderTeam` | `teams` | research more | TBD |
| `list_players` | football/basketball | `unknown` | TBD | TBD | `ProviderPlayer` | `players` | research more | TBD |
| `list_upcoming_matches` | football/basketball | `unknown` | TBD | TBD | `ProviderMatch` | `matches` | research more | TBD |
| `list_finished_matches` | football/basketball | `unknown` | TBD | TBD | `ProviderMatch` | `matches` | research more | TBD |
| `get_match_details` | football/basketball | `unknown` | TBD | TBD | `ProviderMatch` | `matches` | research more | TBD |
| sport-specific scores/statistics/standings | football/basketball | `unknown` | TBD | TBD | Existing sport-specific DTOs | Existing sport-specific tables | research more | TBD |
| future advanced operations | football/basketball | `unknown` | TBD | TBD | future DTOs | future tables | blocked | Schema/normalizers not implemented yet. |

## Sample Response Evidence

| Sample ID | Operation | Sport | League/Competition | Source/Endpoint Placeholder | Captured At | Contains P0 Fields? | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD |

## Field Mapping

| Provider Field | Meaning | Target DTO Field | Target Table/Column | Priority | Required? | Missing-Field Behavior | Validation Notes | Storage Decision |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | normalized/raw-only/future |

## Missing Fields

| Needed Field | Priority | Target DTO/Table | Evidence Status | Impact | Decision |
| --- | --- | --- | --- | --- | --- |
| TBD | TBD | TBD | `unknown` | TBD | research more |

## Adapter Readiness Checklist

- [ ] Provider operation selected.
- [ ] Representative sample response captured.
- [ ] Required fields mapped to provider-agnostic DTOs.
- [ ] Target normalizer exists.
- [ ] Target table exists.
- [ ] Missing-field behavior documented.
- [ ] Validation rules documented.
- [ ] Rate-limit behavior documented.
- [ ] Retry behavior documented.
- [ ] Raw payload retention confirmed.
- [ ] Unit tests planned.
- [ ] Local PostgreSQL integration test need assessed.
- [ ] Production DB pollution risk addressed.
- [ ] Legal/terms risk acknowledged.
- [ ] No live-score behavior introduced.

## Decision

Choose one:

- `reject`
- `research more`
- `build shell`
- `build adapter`

Decision notes:

- TBD

