# Stale Draft Rebuild Workflow

## Purpose

SkorIQ pre-match draft predictions should be refreshed when they were generated too early or when important upstream data changes before kickoff. This document defines the future rebuild workflow for stale football draft predictions.

Current implementation status: a manual one-match command exists for stale draft rebuilds. It does not implement a scheduler, automatic rebuild, draft archiving, provider call, ingestion run, settlement, public publishing, member visibility, public row creation, or tahmin kombini behavior.

## Stale Definition

A pre-match draft prediction set is stale when any of these conditions apply:

- It was generated too early according to the pre-match analysis window policy.
- `generated_at` is more than the configured `windowHours` before kickoff.
- Important upstream feature data changed after generation.
- Future injury, referee, lineup, suspension, weather, or team-news data changes after generation.

Current MVP rule:

- A draft is stale if it was generated more than 24 hours before kickoff.

Stale does not mean the candidate was wrong. It means the output should not be used for future member visibility, public proof, or tahmin kombini without a fresh rebuild inside the valid analysis window.

## Rebuild Trigger

A stale draft can be rebuilt only when all conditions are true:

- Match status is `scheduled` or `not_started`.
- Kickoff is inside the valid pre-match analysis window.
- Kickoff is more than the configured minimum lead time away.
- Home and away teams are mapped.
- Required historical team-form, H2H, and match feature data exists.
- The manual workflow targets only local or approved `neon-test` databases.

If `--enforce-window` blocks the candidate command, the rebuild workflow must stop and report the blocker. Operators should not work around the block unless a future logged admin override exists.

## Manual Rebuild Workflow

The manual stale-draft rebuild command is:

```bash
npm run analytics:football:prediction-drafts:rebuild-stale -- --match-id=<match-uuid>
npm run analytics:football:prediction-drafts:rebuild-stale -- --match-id=<match-uuid> --execute
```

Dry-run is the default. Execute mode requires `--execute`, local/approved `neon-test` database readiness, `scheduled` / `not_started` match status, a known kickoff time, and `analysisWindowStatus=within_window`.

The internal rebuild sequence is:

```bash
npm run analytics:football:team-form:build -- --match-id=<match-uuid> --execute
npm run analytics:football:h2h:build -- --match-id=<match-uuid> --execute
npm run analytics:football:match-prediction-features:build -- --match-id=<match-uuid> --execute
npm run analytics:football:reasoning:build -- --match-id=<match-uuid>
npm run analytics:football:prediction-candidates:generate -- --match-id=<match-uuid> --check-consistency --enforce-window
npm run analytics:football:prediction-candidates:generate -- --match-id=<match-uuid> --persist-draft --enforce-window
```

Rules:

- Do not settle predictions during rebuild.
- Do not mark predictions `member_visible`.
- Do not publish public successful predictions.
- Do not create `public_successful_predictions` rows.
- Do not generate tahmin kombini output.
- Do not call providers or run ingestion as part of this workflow.
- Keep the result as draft-only audit data.
- Update only the persisted target-match draft outputs returned by candidate persistence.

Provider fixture sync remains a separate workflow. A stale draft rebuild consumes normalized data already available in the database.

## Existing Draft Handling

Future handling options:

- Option A: replace by dedupe key or upsert the same prediction type/value.
- Option B: archive old stale drafts before creating a new candidate set.
- Option C: keep old drafts as audit history and mark them stale.

Recommended MVP policy:

- Use existing dedupe-key upsert for the same `match_id`, `feature_snapshot_id`, `prediction_type`, and `prediction_value`.
- Avoid destructive deletes.
- Keep stale drafts as internal audit evidence until explicit stale/rebuild fields exist.
- Do not archive old drafts until the schema supports that status and audit trail clearly.
- Store rebuild/window metadata later so reviewers can distinguish fresh and stale outputs.

This preserves traceability without creating duplicate operational recommendations.

## Future Metadata Fields

Future prediction-output or rebuild-audit fields may include:

- `stale_at`
- `rebuild_required`
- `rebuilt_from_prediction_output_id`
- `generation_window_status`
- `generated_lead_time_minutes`
- `rebuild_reason`
- `last_rebuilt_at`

Current implementation status: these fields exist on `football_prediction_outputs` as metadata-only fields. They do not trigger automatic rebuilds, do not mutate existing drafts by themselves, and do not publish or expose predictions. Future manual rebuild and scheduler work should use them for stale detection, dashboard filters, and audit logs.

The manual rebuild command sets these fields only for newly persisted/upserted target-match draft outputs:

- `generation_window_status=within_window`
- `generated_lead_time_minutes=<minutes until kickoff>`
- `rebuild_required=false`
- `stale_at=null`
- `rebuild_reason=manual_stale_rebuild`
- `last_rebuilt_at=<command time>`

## Safety Rules

- Never rebuild after kickoff.
- Never rebuild if kickoff is inside the minimum lead-time cutoff unless a future admin override is explicitly logged.
- Never publish automatically after rebuild.
- Never make rebuilt drafts member-visible automatically.
- Never use stale drafts for public proof, member predictions, or tahmin kombini.
- Never treat a stale draft as public eligibility evidence.
- If enforcement reports `too_early`, `too_late`, `stale`, or `unknown`, stop and report.

## Scheduler Impact

A future scheduler should:

- Identify matches entering the next 24-hour analysis window.
- Detect existing stale draft predictions for those matches.
- Rebuild team form, H2H, match prediction features, reasoning, candidates, and consistency checks.
- Persist fresh draft rows only.
- Log rebuild runs with match, old generation timing, new generation timing, window status, and reason.
- Keep member visibility and public publishing as separate controlled workflows.
- Never settle before the match is final.

The scheduler should enforce the pre-match analysis window by default.

## UI Impact

Future internal dashboard views should show:

- Stale draft badge.
- `requiresRebuild` indicator.
- Generated lead time.
- Rebuild suggested note.
- Fresh/stale status for draft groups.

The UI should remain read-only until explicit admin rebuild controls are designed and protected.

## Leverkusen Vs RB Leipzig Example

The Bayer Leverkusen vs RB Leipzig pre-match draft set is the current smoke example:

- Match: Bayer Leverkusen vs RB Leipzig.
- Match ID: `269856cc-f8af-436a-8b68-f7e635b890c5`.
- Kickoff: `2026-05-02 18:30 UTC`.
- Draft candidates were generated before kickoff.
- The current window report marks the draft state as `stale` because the draft was generated more than 24 hours before kickoff.
- Running with `--enforce-window` blocks regeneration unless the match is inside the valid window.

When the match enters the valid 24-hour window and remains more than 30 minutes from kickoff, the workflow should rebuild the feature snapshot and regenerate draft candidates with `--enforce-window`.

## Implementation Roadmap

Recommended future order:

1. Implemented: add metadata fields for stale/rebuild tracking.
2. Implemented: add a manual stale-draft rebuild command that wraps the safe rebuild sequence.
3. Add dashboard stale indicators and rebuild-needed filters.
4. Add scheduler support later.
5. Make the scheduler enforce the analysis window by default.

## Non-Goals

- No scheduler implementation now.
- No automatic rebuild now.
- No draft status mutation now.
- No draft archiving now.
- No provider calls or ingestion from this workflow.
- No settlement.
- No member-visible publishing.
- No public publishing.
- No public successful prediction rows.
- No tahmin kombini.
