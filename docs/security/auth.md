# SkorIQ Membership/Auth Foundation

## Purpose

The current SkorIQ (`skoriq.com`) dashboard and read-only analytics APIs are members-only. Non-members must not access active analytics, prediction candidates, catalog data, or dashboard routes.

This foundation does not implement billing, subscription plans, prediction models, public successful-prediction flows, provider calls, ingestion, scheduler jobs, or public prediction pages.

## Strategy

- Email/password authentication for MVP.
- Passwords are hashed with Node `scrypt`; plain passwords are never stored.
- Sessions use an HTTP-only signed token cookie.
- Cookie defaults:
  - `HttpOnly`
  - `SameSite=Lax`
  - `Secure` in production
  - non-secure in local development/test
- API responses return user summaries only and never return `password_hash`, tokens, cookies, or secrets.

## Environment

```bash
AUTH_ENABLED=true
AUTH_JWT_SECRET=<local-random-secret>
AUTH_COOKIE_NAME=betify_auth
AUTH_TOKEN_TTL_SECONDS=86400
```

If `AUTH_ENABLED=true`, `AUTH_JWT_SECRET` is required and startup fails clearly when it is missing.

Do not commit real JWT secrets, passwords, password hashes, cookies, or session tokens.

## Database

The `users` table stores:

- `id`
- `email`
- `first_name`
- `last_name`
- `phone_number`
- `password_hash`
- `role`: `admin` or `member`
- `status`: `active` or `disabled`
- `created_at`
- `updated_at`
- `last_login_at`

Emails are normalized to lowercase for login, registration, and admin bootstrap.

## Auth API

```http
POST /api/auth/login
POST /api/auth/register
POST /api/auth/logout
GET /api/auth/me
```

Login accepts:

```json
{
  "email": "admin@example.com",
  "password": "member-password"
}
```

Login behavior:

- normalizes email lowercase
- uses a generic `401` failure for missing users, wrong passwords, and disabled users
- sets the HTTP-only auth cookie on success
- returns only a user summary

Registration accepts:

```json
{
  "email": "member@example.com",
  "firstName": "Ada",
  "lastName": "Yılmaz",
  "phoneNumber": "+905551112233",
  "password": "StrongPass123",
  "confirmPassword": "StrongPass123",
  "mathLeft": 5,
  "mathOperator": "-",
  "mathRight": 3,
  "mathAnswer": 2
}
```

Registration behavior:

- normalizes email lowercase
- requires first name, last name, and Turkish phone number for member profile creation
- stores phone numbers in `+90` + 10 digit format
- requires a password with at least 12 characters, uppercase, lowercase, and number
- validates `confirmPassword` when supplied
- validates a lightweight math challenge to reduce spam attempts
- uses a safe generic duplicate-email failure message
- creates only `role=member` and `status=active`
- ignores any client attempt to choose `admin`
- hashes the password with the existing auth hashing approach
- auto-logs the new member in by setting the same HTTP-only auth cookie used by login
- returns only a user summary

Rate limiting and email verification are not implemented yet and remain TODO before broad public launch.

Logout clears the cookie.

`GET /api/auth/me` returns the authenticated user summary or `401`.

## Protected Endpoints

When `AUTH_ENABLED=true`, these endpoints require a valid auth cookie:

- `GET /api/analytics/football/matches`
- `GET /api/analytics/football/matches/:matchId`
- `GET /api/football/teams`
- `GET /api/football/teams/:teamId`
- `GET /api/football/competitions`
- `GET /api/football/competitions/:competitionId`

Unauthenticated requests return `401`.

## Role-Based Access

Roles:

- `admin`: full internal access to analytics, catalog, draft Tahmin review, settlement review, public eligibility review, and future provider/admin audit pages.
- `member`: standard member access to match analytics and football catalog pages.
- anonymous: `/login`, `/register`, and future public-only successful-prediction pages after those are implemented.

Member-safe endpoints:

- `GET /api/dashboard/overview`
- `GET /api/analytics/football/matches`
- `GET /api/analytics/football/matches/:matchId`
- `GET /api/football/teams`
- `GET /api/football/teams/:teamId`
- `GET /api/football/competitions`
- `GET /api/football/competitions/:competitionId`
- `GET /api/auth/me`
- `POST /api/auth/logout`

`GET /api/dashboard/overview` is role-aware: members receive only member-safe overview fields, while admins additionally receive an `admin` summary. The member response must not include admin/internal review counts, conflict details, raw metadata, provider IDs, audit-only rows, blocked/avoid candidates, secrets, password hashes, JWTs, or cookies.

Admin-only endpoints:

- `GET /api/football/predictions/drafts`
- `GET /api/football/predictions/drafts/:predictionId`
- `GET /api/football/matches/:matchId/prediction-drafts`
- `GET /api/football/predictions/settlements`
- `GET /api/football/predictions/settlements/:settlementId`
- `GET /api/football/matches/:matchId/prediction-settlements`
- `GET /api/football/public-eligibility/evaluate`
- `GET /api/football/matches/:matchId/public-eligibility`
- future provider, system, user, audit, and publication workflow endpoints

Admin-only APIs require authentication first. Anonymous requests return `401`; authenticated non-admin users return `403`.

## Dashboard Flow

The dashboard has `/login` and `/register` routes.

- Unauthenticated users are redirected to `/login`.
- Unauthenticated users can access `/login` and `/register`.
- `/register` collects ad, soyad, `+90` telefon numarası, e-posta, şifre, şifre tekrar, and a simple math security question.
- `/login` stays intentionally minimal and accepts only e-posta and şifre.
- Authenticated users visiting `/login` or `/register` are redirected back to the dashboard.
- Authenticated users can access dashboard routes.
- Members see only member-safe navigation: overview, Maç Analizi, Takımlar, and Ligler.
- Admins additionally see Draft Tahminler, Tahmin Sonuçları, Public Uygunluk, and future system/admin areas.
- Members who navigate directly to an admin-only route see a `403` page.
- The dashboard API client sends cookies with `credentials: "include"`.
- Logout clears the session and returns to `/login`.

Local troubleshooting: keep the dashboard and API hostnames consistent. Use `localhost` with `localhost`, or `127.0.0.1` with `127.0.0.1`. Mixing them can prevent the HTTP-only auth cookie from being shared in local development.

## Local Admin Bootstrap

Create or update a local admin:

```bash
ADMIN_EMAIL=admin@example.com \
ADMIN_PASSWORD=<long-local-password> \
npm run auth:create-admin
```

Rules:

- refuses `NODE_ENV=production`
- requires `ADMIN_EMAIL`
- requires `ADMIN_PASSWORD` with at least 12 characters
- lowercases email
- hashes password
- does not print the password or hash

Admin users must be created only with this bootstrap command. The public registration endpoint always creates `member` users.

## Public Access Policy

Current dashboard and analytics APIs require login.

Future public users may see only settled successful predictions after a separate public-read policy is implemented. Public users must not see active/upcoming analytics, prediction candidates, internal reasoning, feature coverage, or dashboard pages.

Use SkorIQ product terms such as “Tahmin”, “Analiz”, “Güven skoru”, “Başarılı tahminler”, and “Maç analizi” in public/member access documentation.

Detailed future access rules are documented in:

- [Member Access Policy](../product/member-access-policy.md)
- [Public Successful Predictions Plan](../product/public-successful-predictions.md)

Policy summary:

- Anonymous visitors: no dashboard, no active/upcoming predictions, no full analytics, no future tahmin kombini.
- Members: protected access to dashboard, active analysis, and future member prediction pages after those features exist.
- Admins: protected operational access for audit, settlement, and publication workflows after those features exist.
- Public successful predictions: future limited proof/results only, restricted to settled successful predictions.

## Non-Goals

- No billing or subscription plans.
- No payment integration.
- No email verification yet.
- No password reset yet.
- No social login.
- No prediction model.
- No public successful-prediction engine.
- No provider calls.
- No ingestion.
- No scheduler automation.
