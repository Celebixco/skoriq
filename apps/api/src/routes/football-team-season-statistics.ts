type JsonRecord = Record<string, unknown>;

// Scoped snapshots must prove which team, competition and season they describe.
// Legacy summaries remain readable only before scoped storage is introduced.
export function selectFootballTeamSeasonStatistics(teamMetadata: unknown, primaryCompetitionMetadata: unknown): JsonRecord | null {
  if (!isRecord(teamMetadata)) return null;
  if (!Object.hasOwn(teamMetadata, "competitionSeasonStatistics")) {
    const legacy = teamMetadata.seasonStatistics ?? teamMetadata.season_statistics;
    return isRecord(legacy) && Object.keys(legacy).length ? legacy : null;
  }
  if (!isRecord(teamMetadata.competitionSeasonStatistics) || !isRecord(primaryCompetitionMetadata)) return null;
  const teamId = positiveId(teamMetadata.sofascoreId);
  const tournamentId = positiveId(primaryCompetitionMetadata.sofascoreTournamentId);
  const seasonName = normalizedName(primaryCompetitionMetadata.seasonName);
  if (!teamId || !tournamentId) return null;

  const matches: JsonRecord[] = [];
  for (const [key, value] of Object.entries(teamMetadata.competitionSeasonStatistics)) {
    if (!isRecord(value) || !isRecord(value.provenance)) continue;
    const source = value.provenance;
    const seasonId = positiveId(source.seasonId);
    if (source.provider !== "sofascore" || positiveId(source.providerTeamId) !== teamId ||
      positiveId(source.tournamentId) !== tournamentId || !seasonId || key !== `${tournamentId}:${seasonId}`) continue;
    // Competition metadata does not always carry a season name. When it does,
    // it must match exactly; when it does not, the scope key and provenance
    // still prove the season and a single matching scope is safe to use.
    if (seasonName && normalizedName(source.seasonName) !== seasonName) continue;
    const statistics = validStatistics(value.statistics);
    if (statistics) matches.push(statistics);
  }
  return matches.length === 1 ? matches[0]! : null;
}

function validStatistics(value: unknown): JsonRecord | null {
  if (!isRecord(value) || typeof value.matches !== "number" || !Number.isInteger(value.matches) || value.matches <= 0) return null;
  const statistics: JsonRecord = {};
  for (const [key, metric] of Object.entries(value)) {
    if (key === "statisticsType") continue;
    if (typeof metric !== "number" || !Number.isFinite(metric) || (metric < 0 && key !== "goalsPrevented")) return null;
    statistics[key] = metric;
  }
  return statistics;
}

function positiveId(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
  return typeof value === "string" && /^[1-9]\d*$/.test(value) ? value : undefined;
}
function normalizedName(value: unknown): string | undefined {
  return typeof value === "string" ? value.normalize("NFC").trim().replace(/\s+/gu, " ") || undefined : undefined;
}
function isRecord(value: unknown): value is JsonRecord { return typeof value === "object" && value !== null && !Array.isArray(value); }
