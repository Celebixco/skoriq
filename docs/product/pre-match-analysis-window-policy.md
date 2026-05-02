# Pre-Match Analysis Window Policy

## Purpose

SkorIQ should analyze near-term upcoming matches by default. Pre-match analytics and Tahmin candidates are most useful close to kickoff, when referee assignments, injuries, suspensions, probable lineups, team news, weather, and tactical rotation signals are more reliable.

This policy defines when SkorIQ may generate pre-match analytics and draft prediction candidates. It is planning/documentation only for now: no production scheduler, automatic ingestion, provider call, player/referee feature, settlement change, public publishing, or tahmin kombini behavior is implemented by this document.

Current implementation status: the football prediction candidate generator reports pre-match window status by default. It can also enforce the window only when `--enforce-window` is passed; enforcement is not the default yet.

## Default Window Rule

Default pre-match analysis window:

- Start: `now`
- End: `now + 24 hours`
- Suggested minimum lead time: `30 minutes before kickoff`

A match is eligible for default pre-match analysis only if all conditions are true:

- `kickoff_at > now + minimum_lead_time`
- `kickoff_at <= now + 24 hours`
- Match status is `scheduled` or `not_started`.
- Home and away teams are mapped to canonical SkorIQ teams.
- Enough historical team-form, H2H, and match feature data exists for the current readiness policy.

The 30-minute minimum lead time prevents generating member-facing candidates too close to kickoff, when the output may be stale before it can be reviewed or safely locked.

## Fixture Sync Vs Analysis

Fixture sync and analysis generation are intentionally different workflows:

- Fixture sync may fetch upcoming fixtures beyond 24 hours when needed for schedule visibility, team mapping, dashboard browsing, and operator planning.
- Prediction feature builds and candidate generation should default to matches in the next 24 hours.
- The dashboard may show future fixtures outside the analysis window, but they should be marked as not analyzed yet or too early for pre-match generation.
- Fetching future fixtures does not authorize prediction candidate generation for those fixtures.

This lets SkorIQ know the schedule early without presenting early, stale, or incomplete analysis as actionable.

## Staleness Policy

Pre-match analysis is time-sensitive:

- A pre-match feature snapshot generated more than 24 hours before kickoff should be considered stale by default.
- Candidate outputs generated outside the allowed window should not be member-visible eligible by default.
- If important data changes inside the 24-hour window, related feature snapshots and draft candidates should be rebuilt.
- Future injury, suspension, referee, lineup, player availability, weather, or team-news updates should mark affected analysis as requiring refresh.
- Future systems should preserve the original generation time for audit and public proof checks.

The system should treat early analysis as internal experimentation unless an admin explicitly overrides the window with logged context.

Stale draft handling is defined in [Stale Draft Rebuild Workflow](./stale-draft-rebuild-workflow.md). The MVP policy is to treat drafts generated more than 24 hours before kickoff as rebuild-required audit data, not member/public/tahmin-kombini candidates.

## Admin Overrides

Current reporting-only flags:

- `--window-hours=24`: sets the reporting window size.
- `--minimum-lead-minutes=30`: sets the minimum lead-time cutoff.

These flags affect the command report and stored audit metadata when draft persistence is explicitly requested. They do not block candidate generation or draft persistence unless `--enforce-window` is also passed.

Current opt-in enforcement flag:

- `--enforce-window`: blocks candidate generation and draft persistence unless `analysisWindowStatus=within_window`.

When enforcement is enabled, blocked statuses are:

- `too_early`
- `too_late`
- `stale`
- `unknown`

Default behavior remains reporting-only. Future scheduler behavior should use enforcement by default once the scheduler is implemented.

Future manual/admin override flags may include:

- `--window-hours=48`: expand the upper analysis window for controlled testing.
- `--allow-short-lead-time`: allow generation inside the minimum lead-time cutoff for emergency/manual review.
- `--force-rebuild`: rebuild feature snapshots and drafts even when recent outputs already exist.

Override rules:

- Overrides must be admin-only.
- Overrides must be logged with operator, timestamp, match, selected flags, and reason.
- Overrides must not publish automatically.
- Outputs generated through overrides should carry metadata explaining the override.
- Stale drafts should be rebuilt inside a valid window before any future member-visible or public workflow.

## Future Scheduler Behavior

A future scheduler should:

- Run periodically, not continuously.
- Fetch or refresh fixtures according to the ingestion roadmap.
- Select only matches in the next 24 hours by default.
- Exclude matches inside the minimum lead-time cutoff unless explicitly allowed.
- Build team form, H2H, and match prediction feature snapshots.
- Run reasoning checks.
- Generate compact draft candidates.
- Run the consistency engine.
- Persist draft audit rows only.
- Enforce the pre-match analysis window by default.
- Detect stale drafts for matches entering the valid window and rebuild them through the documented stale-draft workflow.
- Never publish automatically.
- Leave member visibility and public publishing as separate controlled workflows.

The scheduler should not call settlement, public publishing, or tahmin kombini flows as a side effect of pre-match generation.

## Data Completeness Context

The 24-hour window matters because several important pre-match inputs become more reliable close to kickoff:

- Referee assignments.
- Injuries and late fitness updates.
- Suspensions and disciplinary availability.
- Probable lineups and tactical rotation.
- Recent team news.
- Weather or pitch context if added later.

These inputs are not implemented yet, but the analysis window should be designed now so future data does not require a product-policy rewrite.

## Future Eligibility Metadata

Future feature snapshots or prediction outputs may include:

- `analysis_window_status`: `within_window | too_early | too_late | stale`
- `generated_lead_time_minutes`
- `stale_at`
- `requires_rebuild`
- `data_completeness_notes`
- `analysis_window_policy_version`

Current metadata foundation on `football_prediction_outputs` includes `stale_at`, `rebuild_required`, `generation_window_status`, `generated_lead_time_minutes`, `rebuild_reason`, and `last_rebuilt_at`. These fields are metadata only; no automatic rebuild, scheduler, status mutation, member visibility, public publishing, or tahmin kombini behavior is attached to them yet.

Manual stale rebuild support is available through `analytics:football:prediction-drafts:rebuild-stale`. It uses the same window policy and refuses execute unless the target match is currently `within_window`.

Manual pre-match pipeline support is available through:

```bash
npm run pipeline:football:prematch -- --country-id=<provider-country-id> --league-id=<provider-league-id> --limit=20
npm run pipeline:football:prematch -- --match-id=<match-uuid>
```

Dry-run is the default and writes nothing. Execute mode remains manual and must be run only on a safe local or Neon test target. It selects `scheduled` / `not_started` matches whose kickoff is later than the minimum lead-time cutoff and no more than `--window-hours` away, then rebuilds match-scoped team form, H2H, match prediction features, reasoning, and consistency-checked candidates. Draft persistence is attempted only with `--execute`, only inside the valid window, only for `ready` feature snapshots, and only when at least one non-blocked recommendation candidate exists. It still never publishes, marks member-visible, settles, runs provider ingestion, or creates tahmin kombini output.

The current candidate-generation report includes:

- `kickoffAt`
- `evaluatedAt`
- `generatedAt`
- `leadTimeMinutes`
- `windowHours`
- `minimumLeadMinutes`
- `analysisWindowStatus`
- `requiresRebuild`
- `dataCompletenessNotes`

## Existing Pre-Match Smoke Example

The Bayer Leverkusen vs RB Leipzig pre-match smoke test is a useful lifecycle example:

- Match: Bayer Leverkusen vs RB Leipzig.
- Kickoff: `2026-05-02 18:30 UTC`.
- Draft candidates were generated before kickoff.
- Candidates remained `draft` only.
- `member_visible=0`.
- Public eligibility remained `0` because there was no settlement yet.
- The current draft set is marked `stale` because it was generated more than 24 hours before kickoff.
- `--enforce-window` blocks regeneration until the match is inside the valid analysis window.

Future default automation should still enforce the 24-hour window before generating similar candidates. This existing smoke validates pre-kickoff generation mechanics, not broad early-generation policy.

## Non-Goals

- No scheduler implementation now.
- No automatic ingestion now.
- No injury, referee, lineup, suspension, weather, or player feature implementation now.
- No automatic member publishing.
- No automatic public publishing.
- No tahmin kombini implementation.
- No provider call approval from this policy alone.
