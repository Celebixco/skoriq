import { manualLeagueConfigs } from "./apifootball-manual-league-config.js";

export interface ApprovedCompetition {
  competitionId: string;
  name: string;
  country: string;
  configCountry: string;
  configLeague: string;
  approval: "reviewed_enabled";
}

export interface CompetitionScopeResult {
  approved: ApprovedCompetition[];
  unmatched: Array<{ country: string; league: string; reason: string }>;
  excluded: Array<{ name: string; country: string; reason: string }>;
  source: string;
}

interface CompetitionRow {
  competition_id: string;
  name: string;
  country: string;
}

const cupPattern = /\b(cup|copa|coupe|pokal|trophy|supercup|super cup|champions|europa|conference)\b/i;

export function normalizeCompetitionText(value: string): string {
  return value
    .replace(/Ã¼/g, "u")
    .replace(/Ã§/g, "c")
    .replace(/ÄŸ/g, "g")
    .replace(/ÅŸ/g, "s")
    .replace(/Ä±/g, "i")
    .replace(/Ã–/g, "o")
    .replace(/Ãœ/g, "u")
    .replace(/Åž/g, "s")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function normalizeCountry(value: string): string {
  const normalized = normalizeCompetitionText(value);
  return normalized === "turkey" ? "turkiye" : normalized;
}

function isNationalLeague(config: (typeof manualLeagueConfigs)[number]): boolean {
  if (normalizeCountry(config.countryName) === "europe") return false;
  return !cupPattern.test(config.leagueName);
}

export async function resolveCompetitionScope(client: { query: (sql: string) => Promise<{ rows: CompetitionRow[] }> }): Promise<CompetitionScopeResult> {
  const result = await client.query(`
    select c.id::text as competition_id, c.name, coalesce(co.name, '') as country
    from competitions c
    left join countries co on co.id = c.country_id
    where c.sport_id = (select id from sports where slug = 'football' limit 1)
  `);
  const rows = result.rows;
  const approved: ApprovedCompetition[] = [];
  const unmatched: CompetitionScopeResult["unmatched"] = [];
  const approvedIds = new Set<string>();
  const configs = manualLeagueConfigs.filter((config) => config.reviewed && config.enabled && isNationalLeague(config));

  for (const config of configs) {
    const country = normalizeCountry(config.countryName);
    const league = normalizeCompetitionText(config.leagueName);
    const candidates = rows.filter((row) => normalizeCountry(row.country) === country && !approvedIds.has(row.competition_id));
    const exact = candidates.find((row) => normalizeCompetitionText(row.name) === league);
    const fuzzy = candidates.find((row) => normalizeCompetitionText(row.name).includes(league));
    const match = exact ?? fuzzy;
    if (!match) {
      unmatched.push({ country: config.countryName, league: config.leagueName, reason: "no_matching_production_competition" });
      continue;
    }
    approvedIds.add(match.competition_id);
    approved.push({
      competitionId: match.competition_id,
      name: match.name,
      country: match.country,
      configCountry: config.countryName,
      configLeague: config.leagueName,
      approval: "reviewed_enabled"
    });
  }

  const excluded = rows
    .filter((row) => !approvedIds.has(row.competition_id))
    .filter((row) => row.country && normalizeCountry(row.country) !== "europe")
    .map((row) => ({ name: row.name, country: row.country, reason: "not_in_reviewed_enabled_scope" }));

  return { approved, unmatched, excluded, source: "manualLeagueConfigs(reviewed+enabled, national leagues only)" };
}
