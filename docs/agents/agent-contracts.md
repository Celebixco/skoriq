# Agent Contracts

All agents must protect provider-agnostic architecture, PostgreSQL portability, idempotency, validation, and raw payload retention. Agents must not make destructive changes outside their assigned scope.

## Global Rules

- Do not hardcode Sofascore into canonical models.
- Do not introduce paid infrastructure requirements.
- Do not add TimescaleDB, ClickHouse, Kafka, live-score queues, or WebSockets in MVP.
- Do not expose provider IDs through public APIs.
- Do not bypass `provider_mappings`.
- Do not remove raw payload retention controls.
- Report changed files, tests run, and known risks.
- If a change touches migrations or schema, describe migration impact, rollback considerations, and PostgreSQL portability.
- If a file is outside your allowed scope, stop and request architectural review before editing it.

## Required Handoff Format

Each agent must finish with:

- Summary: what changed and why.
- Files changed: exact paths.
- Tests/checks: commands run and results.
- Data impact: schema, migration, retention, or cleanup implications.
- Risks: unresolved concerns or follow-up work.
- Next handoff: the safest next agent/task.

## Required Checks

- Database Schema Agent: `npm run typecheck`, `npm run db:generate` or migration verification, and a manual review for nullable unique keys.
- Provider Integration Agent: `npm run typecheck`, provider DTO validation review, and confirmation no canonical schema was changed.
- Normalization Agent: `npm run typecheck`, idempotency tests, provider mapping tests, and malformed payload tests.
- Queue / Worker Agent: `npm run typecheck`, `npm run lint`, dedupe-key tests, and retry/failure-path tests.
- Analysis Feature Agent: `npm run typecheck`, feature idempotency tests, and canonical-data-only review.
- API Agent: `npm run typecheck`, `npm run lint`, endpoint validation tests, and provider-ID leakage review.
- DevOps / Coolify Agent: Docker build verification, env review, and confirmation production Postgres is external.
- QA / Test Agent: full relevant test suite and explicit coverage gaps.
- Security Review Agent: secrets review, public/admin boundary review, and dependency audit review.

## Conflict Resolution

- Do not edit files owned by another active agent without explicit handoff.
- If two tasks require the same file, the system administrator assigns a single owner for that file.
- Schema changes must be reviewed before dependent normalizer, API, or analysis changes proceed.
- Never resolve conflicts by reverting another agent's work without approval.

## Database Schema Agent

Scope: schema, migrations, indexes, constraints.

Allowed files: `packages/database/**`, database docs.

Forbidden actions: provider clients, API routes, queue processors.

Expected output: portable PostgreSQL schema with constraints for idempotency and storage control.

Review checklist: unique constraints, indexes, no provider lock-in, no proprietary DB features, raw cleanup support.

## Provider Integration Agent

Scope: provider interfaces and adapters.

Allowed files: `packages/providers/**`.

Forbidden actions: canonical schema changes without explicit review.

Expected output: provider DTOs, adapter methods, request validation, rate-limit awareness.

Review checklist: provider DTOs separated from canonical entities, no public provider ID leakage, errors categorized.

## Normalization Agent

Scope: provider DTO to canonical transformation.

Allowed files: `packages/normalizers/**`.

Forbidden actions: direct provider HTTP calls.

Expected output: idempotent normalizers with provider mapping resolution and validation.

Review checklist: transaction safety, duplicate prevention, missing-field handling, raw payload error recording.

## Queue / Worker Agent

Scope: BullMQ queues, processors, retries, dead-letter handling.

Allowed files: `apps/worker/**`, `packages/queue/**`.

Forbidden actions: changing canonical schema without review.

Expected output: safe job lifecycle and persisted sync logs.

Review checklist: dedupe keys, retry/backoff, failure isolation, no live-match queue.

## Analysis Feature Agent

Scope: feature builders and feature table usage.

Allowed files: `packages/analysis/**`.

Forbidden actions: provider-specific assumptions.

Expected output: reproducible features from canonical tables only.

Review checklist: recalculation triggers, idempotency, fast reads, no raw provider dependency.

## API Agent

Scope: NestJS controllers, services, DTOs.

Allowed files: `apps/api/**`.

Forbidden actions: exposing provider IDs publicly.

Expected output: canonical-ID read APIs with validated inputs.

Review checklist: input validation, no admin leaks, internal IDs only.

## DevOps / Coolify Agent

Scope: Dockerfiles, compose files, env examples, deployment docs.

Allowed files: `Dockerfile`, `docker/**`, `.env.example`, deployment docs.

Forbidden actions: adding paid managed services.

Expected output: Coolify-compatible API, worker, scheduler, and Redis services.

Review checklist: no production Postgres container requirement, env-only secrets, separate services.

## QA / Test Agent

Scope: integration tests, fixtures, idempotency tests.

Allowed files: test directories and fixtures.

Forbidden actions: implementation rewrites unless explicitly assigned.

Expected output: test report, failing cases, and coverage gaps.

Review checklist: duplicate sync runs, malformed provider payloads, cleanup safety, API provider ID leakage.

## Security Review Agent

Scope: secrets, admin/debug protection, validation, rate limits.

Allowed files: security docs and targeted review comments.

Forbidden actions: broad rewrites.

Expected output: prioritized risk list with concrete fixes.

Review checklist: no hardcoded secrets, env validation, admin protection plan, public API validation.
