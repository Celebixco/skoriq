# R-C • Beta — production rollout

## Live

- URL: https://skoriq.87.76.130.252.sslip.io/football/predictions/upcoming
- Navigation: **Tahminler**.
- Match detail: `/football/analytics/:matchId`.
- Model: **R-C • Beta** (`stage11-fixed-R-A-R-C`).
- Runtime commit: `7668c35`; image `t2aekaofrcrelkuhxxf8iigv_api:7668c35cdd820ac4613ecdbada8cbec5ffa208cc`.
- Kill-switch environment: `RC_PREMATCH_ENABLED=true`.
- Published matches: **83**; prediction rows: **166** (includes the original 9/18).
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

## Multi-league scope (2026-10-21)

The production scope is resolved from the existing reviewed+enabled national-league
configuration (`scripts/apifootball-manual-league-config.ts`) and matched to real
`competitions.id` values. Cup and international competitions are not enabled by
that configuration.

| League | Candidates | Eligible | Newly published | Previously published | Blocked |
|---|---:|---:|---:|---:|---:|
| 2. Bundesliga | 9 | 9 | 9 | 0 | 0 |
| Bundesliga | 9 | 9 | 9 | 0 | 0 |
| Eredivisie | 9 | 9 | 9 | 0 | 0 |
| LaLiga | 10 | 10 | 10 | 0 | 0 |
| Ligue 1 | 9 | 9 | 9 | 0 | 0 |
| Premier League | 10 | 10 | 10 | 0 | 0 |
| Serie A | 18 | 18 | 18 | 0 | 0 |
| Trendyol Süper Lig | 9 | 9 | 0 | 9 | 0 |
| **Total** | **83** | **83** | **74** | **9** | **0** |

- Runtime commit: `7668c35` (image tag `7668c35cdd820ac4613ecdbada8cbec5ffa208cc`).
- Migration `0025` adds `competition_id` and `evaluation_group`; existing nine
  records are backfilled as `stage12_1` and their probabilities/generation times
  remain unchanged.
- Feature history is partitioned by `competition_id`; home/away 5/10 windows and
  the three-prior-result minimum are applied inside each league.
- New rows are `multi_league_unassessed`; the UI shows the per-league note.
- API returned 83 matches / 166 prediction rows after generation.
- Scope check: 83 candidates, 83 eligible, 0 blocked.
- Duplicate rerun: 0 inserted.
- Not opened: Serie B, Championship, LaLiga 2, Ligue 2, Trendyol 1.Lig and Liga Portugal are outside the reviewed/enabled configuration; cup and UEFA competitions are excluded by scope.

## Member card and coupon (2026-10-21)

- The member predictions screen now shows one main prediction per match. Model ids,
  probabilities, comparison data, training/feature metadata and confidence bars are
  not rendered. Backend fields remain available to API consumers.
- Cards use real team logos from `teams.logo_url`; broken images fall back to the
  existing neutral initials mark.
- The existing `CouponProvider`/`CouponRail` store is reused. R-C selections persist
  in the account-scoped browser store, survive filter/reload/navigation, and are
  revalidated through the published R-C match endpoint.
- Same match/same selection is a duplicate. A different pick for the same match
  returns a conflict and the card asks for confirmation before replacing it.
- Clear-all asks for confirmation. Copy uses simple fixture/selection text; when
  clipboard access fails, a selectable textarea is shown instead of a success toast.
- No bets, stakes, odds or winnings are modeled.

Validation: 42 targeted tests pass; build and typecheck pass. Browser evidence is in
`.research/stage12_deploy/design-verification.json` and the `design-*.png` files.
Runtime: dashboard `284b166`, API/analytics `9acee9a`.

## Kill switch

Set `RC_PREMATCH_ENABLED=false` for `api` and `analytics`, then restart those services. API returns 503 and the generator exits without writing. The deployed containers currently carry `RC_PREMATCH_ENABLED=true`; default is `true`.

## Rollback

Previous application image before this rollout: `t2aekaofrcrelkuhxxf8iigv_api:33558f1cc1d6bd7c1735e73df64ec345c453be67` (and matching dashboard/analytics images). The older pre-kill-switch image is `5f34389fd94efaadbd976a828bd7c06194faf2da`. Use the Coolify rollback UI or the application compose path with the previous image tags. Migration `0025` is additive; rolling the application back does not require dropping the new columns.

## Verification

- Production build: pass.
- Typecheck: pass.
- Targeted tests: 31 passing (API guard/kill switch, prediction card, navigation, multi-league scope/history).
- Browser: 9 cards desktop, 9 cards mobile, 2 model disagreements, no console errors.
- Unauthenticated API: 401.
- Manual generator rerun: 0 duplicate inserts.
- Settlement run: 0 finished matches, no writes.

Screenshots and API evidence are in `.research/stage12_deploy/`.
