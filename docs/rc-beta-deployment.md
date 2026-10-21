# R-C • Beta — production rollout

## Live

- URL: https://skoriq.87.76.130.252.sslip.io/football/predictions/upcoming
- Navigation: **Tahminler**.
- Match detail: `/football/analytics/:matchId`.
- Model: **R-C • Beta** (`stage11-fixed-R-A-R-C`).
- Published matches: **9**; prediction rows: **18**.
- API: `GET /api/member/football/predictions/upcoming`.
- Access: existing `AuthGuard`; anonymous requests return **401**.

## Data

- Initial probabilities and generation time are from the Stage 12.1 immutable package.
- `prediction_generated_at`: `2026-10-21T15:26:46.480Z`.
- `published_at`: `2026-10-21T16:07:35.324Z` (actual first publication).
- API values match the package: 54/54 probability values, max absolute difference `0`.
- Source snapshot hash: `e7987d5570aa6637d5c510291cfe83e5d1b5deeeaf5204403be3a0db4612098e`.
- History is marked `unverified`; cards show the data-coverage warning.

## Database

New additive tables:

- `football_rc_prematch_predictions`
- `football_rc_prematch_results`

Unique key `(match_id, model_id, model_version)` prevents duplicates. Inserts use `ON CONFLICT DO NOTHING`; the first publication is not overwritten.

## Production workflow

Existing analytics service, no second scheduler:

- `09:00` Europe/Istanbul — existing prematch
- `09:20` — `scripts/football-rc-prematch.ts --execute`
- `09:30` — existing settlement
- `09:35` — `scripts/football-rc-settle.ts`
- `09:45` — existing model shadow

Window: next 7 days, minimum 24h to kickoff, Süper Lig only, at least 3 prior results per team.

## Kill switch

Set `RC_PREMATCH_ENABLED=false` for `api` and `analytics`, then restart those services. API returns 503 and the generator exits without writing. Default is `true`.

## Rollback

Previous application image: `t2aekaofrcrelkuhxxf8iigv_api:5f34389fd94efaadbd976a828bd7c06194faf2da` (and matching dashboard/analytics images). Use the Coolify rollback UI or the application compose path with the previous image tags.

## Verification

- Production build: pass.
- Typecheck: pass.
- Targeted tests: 28 passing (API guard/kill switch, prediction card, navigation).
- Browser: 9 cards desktop, 9 cards mobile, 2 model disagreements, no console errors.
- Unauthenticated API: 401.
- Manual generator rerun: 0 duplicate inserts.
- Settlement run: 0 finished matches, no writes.

Screenshots and API evidence are in `.research/stage12_deploy/`.
