# SkorIQ Football Analytics Dashboard Plan

## Purpose

The first SkorIQ (`skoriq.com`) dashboard is a read-only member/admin skeleton for inspecting existing football Maç analizi reports.

It does not:

- implement a prediction model
- generate final score predictions
- generate final Tahmin output or public successful-prediction flows
- call providers directly
- run ingestion
- write to the database
- start scheduler jobs
- expose secrets

The dashboard is members-only. Unauthenticated users are redirected to `/login` when auth is enabled. `/register` is available for secure MVP member account creation. Admin-only internal review routes are hidden from members and blocked with a clear `403` screen when visited directly.

## App Location

```text
apps/dashboard
```

The dashboard is a lightweight Vite React + TypeScript app.

## Environment

```bash
VITE_API_BASE_URL=http://localhost:3000/api
```

If the variable is omitted, the dashboard defaults to `http://localhost:3000/api`.

## Routes

| Route | Purpose | API Source |
| --- | --- | --- |
| `/login` | Member/admin sign-in. | `POST /api/auth/login`, `GET /api/auth/me` |
| `/register` | Member registration with auto-login. | `POST /api/auth/register`, `GET /api/auth/me` |
| `/` | Dashboard home overview. | `GET /api/dashboard/overview` |
| `/football/analytics` | Football analytics match list with simple filters. | `GET /api/analytics/football/matches?limit=20` |
| `/football/analytics/:matchId` | One match analytics readiness detail. | `GET /api/analytics/football/matches/:matchId` |
| `/football/prediction-results` | Member-safe Tahmin Sonuçları page with Country → League → Match result cards. | `GET /api/football/prediction-results`, `GET /api/football/prediction-results/summary` |
| `/football/predictions/drafts` | Internal draft Tahmin candidate review list. | `GET /api/football/predictions/drafts` |
| `/football/predictions/drafts/:predictionId` | One draft Tahmin candidate with conflicts. | `GET /api/football/predictions/drafts/:predictionId` |
| `/football/matches/:matchId/prediction-drafts` | Match-level grouped draft Tahmin review. | `GET /api/football/matches/:matchId/prediction-drafts` |
| `/football/predictions/settlements` | Internal Tahmin settlement result review list. | `GET /api/football/predictions/settlements` |
| `/football/predictions/settlements/:settlementId` | One settlement result with conflicts and metadata. | `GET /api/football/predictions/settlements/:settlementId` |
| `/football/matches/:matchId/prediction-settlements` | Match-level grouped settlement review. | `GET /api/football/matches/:matchId/prediction-settlements` |
| `/football/public-eligibility` | Internal public eligibility evaluator review. | `GET /api/football/public-eligibility/evaluate` |
| `/football/matches/:matchId/public-eligibility` | Match-level public eligibility evaluator review. | `GET /api/football/matches/:matchId/public-eligibility` |
| `/football/countries` | Football Explorer country index with league/team/match coverage counts. | `GET /api/football/countries` |
| `/football/countries/:countryId` | Country league browser. | `GET /api/football/countries/:countryId/competitions` |
| `/football/competitions/:competitionId/profile` | League detail with summary, standings, teams, upcoming and recent matches. | `GET /api/football/competitions/:competitionId/profile` |
| `/football/teams` | Football team catalog with logos and coverage hints. | `GET /api/football/teams` |
| `/football/teams/:teamId` | One football team with recent matches and form summary. | `GET /api/football/teams/:teamId` |
| `/football/competitions` | Football competition catalog with readiness counts. | `GET /api/football/competitions` |
| `/football/competitions/:competitionId` | One football competition with teams, matches, and standings. | `GET /api/football/competitions/:competitionId` |

## Navigation

The football navigation should now behave as a Football Explorer instead of a flat list:

- Countries
- Country detail: Leagues
- League detail: summary, standings, teams, upcoming matches, recent matches
- Team detail

The Explorer APIs are read-only and must not expose provider IDs by default, raw payloads, API keys, DB URLs, admin draft internals, settlement state, or fake logos.

The dashboard has a simple left navigation:

- Overview
- Football for members: Match Analytics, Tahmin Sonuçları, Teams, Competitions
- Football for admins: Match Analytics, Draft Tahminler, Tahmin Sonuçları, Public Uygunluk, Teams, Competitions
- Basketball: Match Analytics, Teams, Competitions marked coming soon
- System for admins: Provider Runs, Users, Settings marked coming soon

Disabled items are placeholders only. They do not trigger provider calls, ingestion, writes, final Tahmin output, or scheduler behavior.

The member-safe results page uses Turkish product labels: Tahmin Sonuçları, Ülke, Lig, Maç, SkorIQ Tahmini, Maç Sonucu, Durum, Başarılı, Başarısız, Bekliyor, Değerlendirilemedi, Açıklama. It must not show odds, profit/loss language, raw provider/internal fields, or admin-only settlement internals.

Authenticated navigation shows the current user email/role and a logout button. Logout calls `POST /api/auth/logout`, clears local auth state, and returns to `/login`.

## Dashboard Home Overview

The home page should use `GET /api/dashboard/overview` as its primary data source instead of stitching together many football analytics, catalog, prediction preview, and admin endpoints client-side.

The overview payload is read-only and role-aware:

- Members receive analytics counts, upcoming match summaries, coverage averages, member-safe prediction preview items, and section health under `dataStatus`.
- Admins receive the same member-safe payload plus an `admin` summary with draft, settlement, public eligibility, and rebuild-required counts.
- Members do not receive admin/internal review counts, conflict details, raw metadata, provider IDs, audit-only rows, or blocked/avoid prediction candidates.

The frontend should treat `dataStatus.* = "error"` as a non-blocking warning for the relevant home card and should not trigger provider calls, ingestion, prediction generation, settlement, public publishing, or tahmin kombini behavior from the home page.

Auth route behavior:

- `/login` links to `/register`.
- `/register` links back to `/login`.
- Registration collects ad, soyad, Turkish `+90` phone, e-posta, password confirmation, and a simple math security question.
- Registration creates `role=member`, `status=active`, sets the HTTP-only auth cookie, and redirects to `/football/analytics`.
- Authenticated users visiting `/login` or `/register` are redirected to `/football/analytics`.
- Members who directly visit Draft Tahminler, Tahmin Sonuçları, Public Uygunluk, or future system/admin pages see: "Bu alan yalnızca admin kullanıcılar içindir."

## Match List Screen

The list screen shows:

- match and competition
- home/away team logos when available
- kickoff date/time
- feature status badge
- prediction eligibility badge
- Başarılı tahminler status badge
- Güven skoru
- combined coverage progress bar
- H2H missing indicator
- risk count
- positive signal count
- link to detail

Filters:

- `featureStatus`
- `predictionEligible`
- `kuponEligible` (displayed as Başarılı tahminler status)
- `limit`

## Match Detail Screen

The detail screen shows:

- match header
- home/away team logos when available
- readiness status
- prediction eligibility
- Başarılı tahminler status
- Güven skoru
- combined coverage
- home form card
- away form card
- H2H card
- positive signals
- risk factors
- missing data warnings
- summary

Required copy is visible:

- "Bu bir maç analizi raporudur, nihai tahmin değildir."
- "Başarılı tahminler alanı henüz etkin değil."
- "Güven skoru kazanma olasılığı değildir."

## Draft Tahmin Review Screens

These screens are authenticated internal review pages only. They are read-only and do not publish, settle, make predictions member-visible, or generate tahmin kombini output.

Access: admin-only. Member users must not see these routes in navigation and must receive a forbidden screen on direct navigation. The API also enforces admin-only access.

The draft list shows:

- match
- prediction type/value
- display label
- recommendation tier
- Güven skoru
- risk level
- consistency status
- conflict counts
- `status=draft`
- `memberVisible=false`
- links to detail and match grouped view

The draft detail screen shows:

- prediction summary
- match summary
- confidence/risk
- recommendation tier
- consistency status
- conflicts
- reasoning summary
- sanitized metadata
- explicit guard copy that the row is draft-only, not settled, and not public.

The match grouped view shows:

- `Tahminim`
- `Denenir`
- `Alternatif`
- `Uzak Dur`
- conflicts summary
- `memberVisible=false`
- guard copy: "Bu ekran iç inceleme amaçlıdır. Kullanıcıya açık tahmin yayını değildir."

## Tahmin Sonuçları Review Screens

These authenticated screens review internal settlement results only. They are read-only and do not publish predictions, make them member-visible, settle from the UI, or generate tahmin kombini output.

Access: admin-only. Member users must not see these routes in navigation and must receive a forbidden screen on direct navigation. The API also enforces admin-only access.

The settlement list shows:

- match
- prediction type/value
- display label and recommendation tier
- consistency status
- settlement status
- actual result and settlement reason
- audit-only badge
- member/public visibility badges
- links to detail and match grouped settlement view

The settlement detail screen shows:

- prediction summary
- match summary
- settlement result and actual result
- settlement reason
- consistency conflicts
- sanitized settlement and prediction metadata
- guard copy: "Bu sonuç iç denetim amaçlıdır.", "Public başarılı tahmin olarak yayınlanmamıştır.", and "Üyelere görünür tahmin değildir."

The match settlement grouped view shows:

- `Tahminim`
- `Denenir`
- `Alternatif`
- `Uzak Dur`
- success/failed/void counts
- audit-only, member-visible, public-eligible, and public-published counts
- reminder that `Uzak Dur` / blocked candidates remain audit-only even if the settlement outcome is successful

## Public Uygunluk Review Screens

These authenticated screens run the public eligibility evaluator in read-only mode. They do not publish predictions, mark outputs `public_eligible`, create `public_successful_predictions`, or expose public pages.

Access: admin-only. Member users must not see these routes in navigation and must receive a forbidden screen on direct navigation. The API also enforces admin-only access.

The global page shows:

- eligible and excluded settled outputs
- summary counts for eligible, excluded, late-generated, audit-only, failed, and blocked rows
- blocker labels such as "Maçtan sonra üretildi"
- suggested public title/summary only when an output is eligible
- links to match public eligibility and settlement review

The match page shows the same evaluator result for one match and includes guard copy:

- "Settled success otomatik public yayın anlamına gelmez."
- "Maçtan sonra üretilen tahminler public kanıt olarak kullanılamaz."
- "Uzak Dur / blocked / audit-only adaylar public başarılı tahmin olamaz."

## Teams Screens

The teams list shows:

- team logo or neutral initials fallback
- team name
- country
- match count
- logo status
- latest form coverage hint
- link to team detail

The team detail screen shows:

- team logo header
- country and identity
- rich normalized team profile data from `GET /api/football/teams/:teamId/profile`
- current standing when available
- analytics readiness summary
- latest form and goal-profile coverage cards
- recent finished matches with fulltime/halftime scores and result
- upcoming matches with analysis status when available

The team detail page must not expose raw provider payloads, provider IDs by default, admin-only prediction draft internals, secrets, or fake/static analytics values.

## Competitions Screens

The preferred member/admin browse path is `Countries -> Leagues -> League Detail -> Teams -> Team Detail`.

The competitions list shows:

- competition name
- country
- teams count
- matches count
- ready matches count
- average coverage
- link to competition detail

The competition detail screen shows:

- competition header
- nullable league logo from canonical metadata when available
- analytics readiness summary
- teams grid with logos
- known matches table
- standings table when normalized standings rows exist
- upcoming and recent match sections when using `GET /api/football/competitions/:competitionId/profile`

## API Client

The typed client lives in:

```text
apps/dashboard/src/api.ts
```

Functions:

- `login(email, password)`
- `register({ email, firstName, lastName, phoneNumber, password, confirmPassword, mathLeft, mathOperator, mathRight, mathAnswer })`
- `logout()`
- `fetchCurrentUser()`
- `fetchFootballAnalyticsMatches(filters)`
- `fetchFootballAnalyticsMatch(matchId)`
- `fetchFootballPredictionDrafts(filters)`
- `fetchFootballPredictionDraft(predictionId)`
- `fetchFootballMatchPredictionDrafts(matchId)`
- `fetchFootballTeams(filters)`
- `fetchFootballTeam(teamId)`
- `fetchFootballCompetitions(filters)`
- `fetchFootballCompetition(competitionId)`

Types live in:

```text
apps/dashboard/src/types.ts
```

The client sends `credentials: "include"` for all API requests so the HTTP-only auth cookie is included. A `401` response is treated as an unauthenticated state by the dashboard shell.

## Running Locally

Start the API:

```bash
npm run dev:api
```

Start the dashboard:

```bash
VITE_API_BASE_URL=http://localhost:3000/api npm run dev:dashboard
```

Then open:

```text
http://localhost:5173/football/analytics
```

Local auth troubleshooting: use `localhost` with `localhost`, or `127.0.0.1` with `127.0.0.1`, consistently for both API and dashboard. Mixing the two hostnames can prevent the HTTP-only auth cookie from being shared in local development.

## Current Limits

- This is a skeleton for inspection, not a polished user-facing product.
- Authentication is MVP email/password membership auth only.
- Registration is MVP member-only registration. It does not create admins.
- RBAC is enforced on both API and dashboard. Frontend hiding is convenience only; backend admin guards protect internal review APIs.
- There is no billing or subscription plan layer yet.
- There is no email verification, password reset, social login, or rate limiting yet.
- There is no frontend write path.
- There is no prediction model, public successful-prediction module, or live-score module.
- Draft Tahmin review pages are internal/read-only and do not expose publish, settlement, member-visible, or tahmin kombini actions.
- Tahmin Sonuçları review pages are internal/read-only and do not expose publish, settle, member-visible, public-publishing, or tahmin kombini actions.
- Basketball and system navigation items are intentionally disabled until their read-only APIs are implemented.

## Public Access Policy

Current dashboard and analytics APIs require login. Future public users may see only settled Başarılı tahminler after a separate public-read policy exists. Public users cannot see active/upcoming analytics, prediction candidates, feature coverage, reasoning, or the dashboard.

## Smoke-Test QA Note

First football analytics dashboard milestone smoke test:

- API server used: local API on `http://localhost:3000/api` connected to the approved Neon test branch.
- Dashboard server used: local Vite dashboard on `http://127.0.0.1:5173`.
- Tested route: `/football/analytics`.
- Tested detail route: `/football/analytics/89759e35-758d-416e-b0d3-ad07436c8a9b`.
- Verified data: Borussia Dortmund vs Freiburg.
- Verified list fields: `Ready`, Tahmin uygunluğu `Yes`, Başarılı tahminler `No`, coverage `64%`, and `H2H missing`.
- Verified detail fields: home/away form cards, H2H card, reasoning signals, risk factors, missing data warnings, and summary.
- Verified safety copy: "not a final prediction", "Başarılı tahminler disabled", and "Güven skoru is not win probability."
- CORS issue found and fixed: API now allows local GET-only dashboard origins for `localhost` and `127.0.0.1` development.
- No secrets, database URLs, API keys, raw provider payloads, or provider request data were visible in the dashboard.
- Verification commands passed after the fix: `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build`.
