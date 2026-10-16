# SofaScore public-page capture

SofaScore is the selected data source. On 2026-09-26 UTC, a normal browser loaded the public Statistics panels for Manchester City and Amed Sportif Faaliyetler. Visible General values were respectively 5 matches / 13 goals scored / 5 conceded and 6 matches / 15 scored / 7 conceded. Direct endpoint and ordinary HTTP access returned 403; those requests stopped. Public-page capture currently requires a supervised browser session. Scheduled collection, full league coverage and production persistence are not yet verified.

## Saved visible-page input

Open the public team page, select **Statistics**, and verify the selected competition and season before reading its visible groups. Capture only the rendered panel and its displayed identity. Save JSON under ignored `.provider-samples/sofascore/`, with these fields:

| Field | Required evidence |
| --- | --- |
| `pageUrl` | HTTPS SofaScore public `/football/team/<slug>/<team-id>#tab:statistics` URL |
| `capturedAt` | Actual capture time as an ISO UTC timestamp |
| `selectedTab` | `Statistics`, verified as the selected tab |
| `teamName` | Visible team heading |
| `tournamentLabel` / `seasonLabel` | Visible competition and season selectors |
| `groups` | Object of group titles to their visible text, with labels and values on consecutive lines |
| `rating` | Optional visible numeric rating; omit or leave blank when unreadable |
| `scopeProofUrl` | Optional observed public tournament URL with tournament ID and `#id:<season-id>` |

Recognized groups include `General`, `Attacking`, `Passes`, `Defending`, `Other` and `Running performance (per match)`. General requires positive played matches and observed integer goals scored, goals conceded and assists. Unknown labels are omitted; malformed known values fail the conversion. A required value must never be guessed.

The converter resolves exactly one existing catalog team and competition/season. The selected season must match the catalog season name, or its exact competition-name prefix plus season label. If the catalog uses a different prefix (Amed's `Super Lig 26/27` versus `Trendyol Süper Lig`), an observed tournament/season proof URL and matching year label are required. A supplied proof must always match. Duplicate scopes, identity conflicts and a different season fail.

## Convert, then validate

```bash
npm run provider:sofascore:public-page:convert -- --input=.provider-samples/sofascore/<raw-page.json> --output=.provider-samples/sofascore/<new-snapshot.json>
npm run provider:sofascore:team-statistics:sync -- --catalog-path=.provider-samples/sofascore/<new-snapshot.json>
```

Conversion uses saved files only; it makes no network or database calls. Output cannot overwrite the input, catalog or any existing file. The new snapshot records source `sofascore_public_page`, `captureMethod: visible_dom`, `statisticsCoverage: visible_partial`, the actual capture time and public URL.

Importer dry-run without `DATABASE_URL` validates the snapshot only. With an approved test database it additionally resolves canonical identity and plans a refresh. Execution is limited to test targets; production is refused. This flow creates no entities and invokes no seed. Database integration must be verified separately before deployment.

## Metric meaning and display

- Explicit averages stay in fields such as `shotsPerGame`, `yellowCardsPerGame` and `kilometersCoveredPerGame`. Rounded averages are never multiplied into invented season totals.
- Visible season counts, including goals and clean sheets, remain counts. An observed zero is valid; an unavailable value is absent.
- Percentage rows retain their percentage. Amounts whose displayed unit is ambiguous, such as `Accurate passes` or `Ground duels won`, are omitted.
- Unavailable xG, xA and goals prevented remain absent. A visible-page snapshot is partial and does not imply complete analytics coverage.
- Team profiles select a single snapshot with matching team, primary tournament and exact catalog season name. Ambiguous or unverifiable scoped data returns null. Per-game display must carry its unit and cannot be compared with season totals.

Run `npm run test:sofascore` for converter and bounded endpoint tests. TypeScript importer and API selection checks are included in `npm test`.
