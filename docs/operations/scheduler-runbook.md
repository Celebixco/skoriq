# SkorIQ Scheduler Runbook

This runbook documents controlled soft-launch jobs. Do not enable unattended jobs until the deployment target, database branch, and secrets are explicitly approved.

## Daily 09:00 Pre-Match Scan

Purpose: generate draft-only SkorIQ pre-match analysis for reviewed/enabled football leagues when kickoff is inside the 36-hour window and outside the 30-minute minimum lead cutoff.

Recommended Coolify scheduled task:

```bash
npm run pipeline:football:daily-prematch -- --all-reviewed-enabled --execute --timezone=Europe/Istanbul
```

Use timezone `Europe/Istanbul`. If the scheduler cannot set timezone explicitly, document the server timezone and convert the cron time instead of guessing.

Safety:
- Uses normalized DB data only.
- Does not call providers.
- Does not run ingestion.
- Does not publish predictions.
- Does not mark `member_visible`.
- Does not run settlement or tahmin kombini.

## Every 90 Minutes Finished-Score Sync

Purpose: refresh recent final scores for reviewed/enabled leagues only.

Recommended interval task:

```bash
npm run provider:football:finished-sync -- --all-reviewed-enabled --lookback-hours=72 --execute
```

If only cron is available, configure interval jobs explicitly; do not use invalid cron expressions such as `*/90`.

Safety:
- Fetches controlled recent events/scores windows only.
- Skips live numeric statuses safely.
- Skips unsupported non-standard statuses unless a documented mapping policy exists.
- Does not run settlement unless the settlement command below is run separately.

## Settlement After Score Sync

Run after the finished-score sync:

```bash
npm run analytics:football:settle-predictions -- --all-reviewed-enabled --lookback-hours=96 --execute
```

Settlement is internal result storage only. It must not publish, mark member-visible, or create tahmin kombini output.

## Manual Fallback

Single match draft refresh:

```bash
npm run pipeline:football:prematch -- --match-id=<MATCH_ID> --execute
```

Single match settlement:

```bash
npm run analytics:football:settle-predictions -- --match-id=<MATCH_ID> --execute
```

## Operational Troubleshooting

If provider returns live numeric statuses, keep them out of finished settlement until final status and final score are available.

If settlement reports missing score, do not force-settle. Re-run finished-score sync for the reviewed/enabled league and confirm normalized fulltime/halftime fields.

If member preview says `pending_generation`, run the daily pre-match scan or a single-match pre-match pipeline execute if the match is inside the 36-hour window.

Never run these as scheduler side effects:
- public publish
- member-visible mutation
- settlement/public/member-visible flows outside their explicit commands
- tahmin kombini
