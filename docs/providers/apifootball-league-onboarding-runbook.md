# APIFootball League Onboarding Runbook

## Purpose

This runbook defines the standard safe onboarding path for a new APIFootball football league. It is documentation and planning only; it does not authorize provider calls, ingestion, scheduler work, prediction generation, public publishing, member visibility, settlement, or tahmin kombini.

The onboarding principle is:

```text
discover -> prove field quality -> execute canonical dependencies -> build analytics -> only then consider draft predictions
```

## Country Data Policy

Country data is mandatory for every league onboarding. Each league must confirm:

- `country_id`
- `country_name`
- selected `league_id`
- selected `league_name`
- whether similar country or league rows exist

Countries/leagues execute must happen before teams, standings, events, scores, or future H2H execute. This keeps the canonical graph stable:

```text
country -> competition -> teams -> matches -> analytics
```

Country and competition mappings are not just ingestion dependencies. They power the future Football Explorer path:

```text
Country -> Leagues -> League detail -> Standings -> Teams -> Team detail
```

Do not create fake country, competition, team, or match provider IDs. If a country or league mapping is missing, fix that dependency through the narrow countries/leagues stage before retrying downstream payloads.

## H2H Data Policy

H2H data must be fetched for upcoming or otherwise analyzable matches, not for every possible team pair in a league. The H2H stage runs after teams and events are mapped, because it needs canonical team and match references to avoid name-only joins.

APIFootball H2H commands:

```bash
npm run provider:apifootball:h2h:evidence -- --match-id=<match-uuid>
npm run provider:apifootball:h2h:ingest -- --match-id=<match-uuid>
```

Both are dry-run-first. The ingest command supports `--execute` only for one target match on approved local or Neon test targets. Strict execute is the default: clean rows are normalized into canonical `matches` and `football_match_scores`, and any unresolved row blocks execute. Reviewed/enabled leagues may use `--allow-partial --minimum-clean-rows=3` when every skipped row is non-critical competition scope only, currently `missing_competition_mapping` or `unsupported_competition_scope`. Partial execute must report total rows, clean rows, skipped rows, skipped reasons, and write counts. It must never normalize skipped rows, create fake competitions, invent provider IDs, or soften blockers such as missing team mappings, unstable match IDs, unparseable dates, or unparseable scores.

For reviewed/enabled leagues with multiple upcoming matches, use the controlled batch wrapper instead of repeating the one-match command manually:

```bash
npm run provider:apifootball:h2h:backfill-upcoming -- --country-id=<country-id> --league-id=<league-id> --limit=20
```

The wrapper is still dry-run-first and one league at a time. It loads only upcoming `not_started` matches, supports `--from/--to` or `--window-hours` filters, and passes `--allow-partial --minimum-clean-rows=3` into the same one-match policy when requested. Execute normalizes only matches that are individually safe and reports unsafe matches without broad cleanup or fabricated mappings.

H2H must remain a supporting causal signal. It must not override:

- current team form
- home/away performance
- goal-profile evidence
- player, referee, injury, suspension, lineup, or weather context when implemented
- prediction consistency checks

Missing H2H should not block MVP readiness when team-form coverage is strong enough. Instead, missing H2H should cap confidence, add a risk warning, and be recorded as missing context. Old or low-sample H2H should be downweighted and treated as weak supporting evidence.

H2H payloads should capture, when the provider supplies them:

- provider match IDs
- past match dates
- home and away team identities
- fulltime score
- halftime score
- mapped canonical match references when possible
- mapped canonical team references when possible
- unresolved rows and missing-field counts

## Standard Onboarding Stages

1. Discovery.
2. Review Candidate Config.
3. Countries/Leagues Dry-Run if applicable.
4. Teams/Logos Dry-Run.
5. Standings Dry-Run.
6. Events/Scores Dry-Run.
7. Evidence Review.
8. Mark Reviewed/Enabled.
9. Countries/Leagues Execute.
10. Teams Execute.
11. Standings Execute.
12. Historical Events/Scores Backfill.
13. Upcoming Events Execute.
14. H2H Dry-Run for upcoming matches.
15. H2H Execute for clean upcoming matches.
16. Feature Build.
17. Pre-Match Candidate Flow.

Review-candidate leagues remain evidence-only: dry-run first, no execute until reviewed and enabled. Reviewed/enabled leagues may use the controlled historical backfill runner, but H2H should still be scoped to upcoming/analyzable matches rather than broad pair expansion.

Live numeric APIFootball statuses are a non-fatal review caveat when finished-score evidence is otherwise clean. APIFootball can return minute-like numeric `match_status` values for live rows during an upcoming/current fixture slice. These values must not be mapped to `finished`, and score rows must not be created from them. The safe path is to report and skip the live row, approve the league only if teams, standings, and recent finished events/scores are clean, then refresh the same match later after the provider returns a supported final or scheduled status.

Non-standard knockout-style statuses such as `After Pen.` are also non-fatal only when normal recent finished FT/HT evidence is clean. They must remain skipped unless an explicit competition/status policy is added, and score rows must not be created from them as normal league results.

## H2H Pass Criteria

An H2H dry-run passes when:

- the provider responds successfully or cleanly reports no H2H data
- stable team IDs are present where the provider supplies team identities
- stable match IDs are present when the provider supplies past match IDs
- fulltime scores are parseable when present
- halftime scores are parseable when present
- canonical teams can be mapped or unresolved rows are clearly reported
- canonical match references can be mapped when possible
- no fake IDs are created
- dry-run writes zero database rows
- reports show safe credential labels only

An H2H dry-run fails or blocks execute when:

- provider errors are ambiguous or unsafe
- team identity is unstable
- scores are unparseable for rows that should carry score evidence
- unresolved rows are present and no explicit acceptance policy exists
- `--allow-partial` is requested but clean rows are below the minimum threshold
- `--allow-partial` is requested for critical skip reasons such as missing team mappings, unstable match IDs, unparseable dates, or unparseable scores
- the operation would require fabricated IDs
- the operation would target production/main
- secrets, raw API keys, DB credentials, or raw payload bodies would be exposed

Execute is allowed only for clean H2H payloads, or explicitly approved partial payloads that meet the non-critical skip policy, on approved local or Neon test targets and only after teams/events/countries/leagues dependencies exist.

## Reasoning Impact

H2H should affect reasoning as supporting context:

- It can support or weaken goal-profile interpretation.
- It can support or weaken BTTS and over/under confidence.
- It can raise confidence only when sample size, recency, and coverage are meaningful.
- Missing H2H lowers the confidence ceiling and adds a warning.
- Low-sample H2H should be mentioned as weak evidence, not decisive evidence.
- H2H that contradicts current form should create risk context, not an automatic prediction.

The future reasoning layer should explain H2H as one causal input among several. It should never use H2H alone to override current form, home/away performance, goal profiles, player/referee/injury context, or consistency rules.

## Non-Goals

- No provider calls from this document.
- No ingestion execute from this document.
- No scheduler.
- No prediction logic change.
- No candidate generation.
- No settlement, public publishing, member-visible mutation, or tahmin kombini.
- No API keys, DB credentials, or raw payload exposure.
