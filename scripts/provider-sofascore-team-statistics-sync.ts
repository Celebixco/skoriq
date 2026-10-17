import { open } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";
import { checkDatabaseReadiness } from "./db-readiness.js";

type JsonRecord = Record<string, unknown>;
interface DatabaseClient { query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>; }
export interface SofaScoreTeamStatisticsOptions { execute: boolean; catalogPath?: string; }
export interface SofaScoreTeamStatisticsDependencies {
  env?: NodeJS.ProcessEnv;
  readCatalog?: (catalogPath: string) => Promise<{ catalog: unknown; catalogUpdatedAt: string }>;
  probe?: () => Promise<{ tableNames: string[] }>;
  database?: DatabaseClient;
}
interface Patch extends JsonRecord {
  seasonStatistics?: Record<string, number>;
  seasonStatisticsSource?: JsonRecord;
  competitionSeasonStatistics: Record<string, { statistics: Record<string, number>; provenance: JsonRecord }>;
}
interface Group { providerTeamId: string; patch?: Patch; reason?: string; }
interface ReportEntry { providerTeamId: string; teamId?: string; status: string; scopes?: string[]; compatibilitySummary?: string; }

const defaultCatalogPath = fileURLToPath(new URL("./sofascore_catalog.json", import.meta.url));

export function parseSofaScoreTeamStatisticsArgs(args: string[]): SofaScoreTeamStatisticsOptions {
  const options = { execute: false, catalogPath: defaultCatalogPath };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--execute") options.execute = true;
    else if (arg === "--no-log-run") { /* accepted for sync-service child runs; this importer never writes sync_jobs */ }
    else if (arg === "--catalog-path" || arg.startsWith("--catalog-path=")) {
      const value = arg === "--catalog-path" ? args[++index] : arg.slice("--catalog-path=".length);
      if (!value || value.startsWith("--")) throw new Error("--catalog-path requires a file path.");
      options.catalogPath = value;
    } else if (arg === "--capture" || arg.startsWith("--capture=")) {
      const value = arg === "--capture" ? args[++index] : arg.slice("--capture=".length);
      if (!value || value.startsWith("--")) throw new Error("--capture requires a file path.");
      options.catalogPath = value;
    } else throw new Error(`Unknown SofaScore team statistics flag "${arg}".`);
  }
  return options;
}

export async function runSofaScoreTeamStatisticsSync(options: SofaScoreTeamStatisticsOptions, dependencies: SofaScoreTeamStatisticsDependencies = {}) {
  const env = dependencies.env ?? process.env;
  if (env.NODE_ENV === "production" && env.ALLOW_PRODUCTION_TEAM_STATISTICS !== "true") {
    throw new Error("SofaScore team statistics refresh is forbidden in production unless ALLOW_PRODUCTION_TEAM_STATISTICS=true.");
  }
  if (options.execute && !env.DATABASE_URL) throw new Error("Database readiness requires DATABASE_URL before execute.");
  if (env.DATABASE_URL) {
    let parsed: URL;
    try { parsed = new URL(env.DATABASE_URL); } catch { throw new Error("Database readiness requires a valid PostgreSQL URL."); }
    if (!["postgres:", "postgresql:"].includes(parsed.protocol)) throw new Error("Database readiness requires a PostgreSQL URL.");
    if (["host", "hostaddr", "service", "servicefile"].some((key) => parsed.searchParams.has(key))) {
      throw new Error("SofaScore team statistics refresh refuses connection target overrides.");
    }
    const readiness = await checkDatabaseReadiness({ databaseUrl: env.DATABASE_URL, nodeEnv: env.NODE_ENV ?? "development",
      dbExecutionTarget: env.DB_EXECUTION_TARGET ?? "local", allowRemoteTestDb: env.ALLOW_REMOTE_TEST_DB ?? "false",
      neonBranchName: env.NEON_BRANCH_NAME ?? "", connect: dependencies.probe });
    if (readiness.status !== "ready") throw new Error(`Database readiness failed: ${readiness.message}`);
  }
  const snapshot = await (dependencies.readCatalog ?? readCatalog)(options.catalogPath ?? defaultCatalogPath);
  const groups = collectGroups(snapshot.catalog, snapshot.catalogUpdatedAt);
  const entries: ReportEntry[] = [];
  const pool = env.DATABASE_URL && !dependencies.database ? new pg.Pool({ connectionString: env.DATABASE_URL, max: 1 }) : undefined;
  const database = env.DATABASE_URL ? dependencies.database ?? pool : undefined;
  try {
    for (const group of groups) {
      const entry: ReportEntry = { providerTeamId: group.providerTeamId, status: group.reason ?? "catalog_validated", scopes: Object.keys(group.patch?.competitionSeasonStatistics ?? {}) };
      entries.push(entry);
      if (!group.patch || group.reason || !database) continue;
      const identity = resolveIdentity((await database.query(identitySql, [group.providerTeamId])).rows, group.providerTeamId);
      if (identity.reason) { entry.status = identity.reason; continue; }
      entry.teamId = identity.id;
      const metadata = record(identity.metadata);
      if ((identity.metadata != null && !isRecord(identity.metadata)) || !["seasonStatistics", "season_statistics", "competitionSeasonStatistics"].every((key) => metadata[key] == null || isRecord(metadata[key]))) {
        entry.status = "invalid_metadata_shape"; continue;
      }
      if (staleSnapshot(metadata, group.patch)) { entry.status = "stale_snapshot"; continue; }
      const { patch, compatibilitySummary } = scopedPatch(metadata, group.patch, group.providerTeamId);
      entry.compatibilitySummary = compatibilitySummary;
      if (containsSnapshot(metadata, patch)) { entry.status = "unchanged"; continue; }
      if (!options.execute) { entry.status = "planned"; continue; }
      const currentScopes = record(metadata.competitionSeasonStatistics);
      const observed = { scopes: Object.fromEntries(Object.keys(patch.competitionSeasonStatistics).map((key) => [key, currentScopes[key] ?? null])),
        flatSource: metadata.seasonStatisticsSource ?? null, flatStatistics: metadata.seasonStatistics ?? null };
      const result = await database.query(updateSql, [identity.id, group.providerTeamId, JSON.stringify(patch), JSON.stringify(observed)]);
      entry.status = result.rows.length === 1 ? "updated" : "snapshot_changed";
    }
  } finally { await pool?.end(); }
  return { mode: options.execute ? "execute" : "dry_run", source: "saved_sofascore_catalog", catalogUpdatedAt: snapshot.catalogUpdatedAt,
    databaseConfigured: Boolean(database), entries, counts: entries.reduce<Record<string, number>>((counts, entry) => { counts[entry.status] = (counts[entry.status] ?? 0) + 1; return counts; }, {}) };
}

async function readCatalog(catalogPath: string) {
  const file = await open(catalogPath, "r");
  try {
    const catalog = JSON.parse(await file.readFile("utf8")) as unknown;
    return { catalog, catalogUpdatedAt: (await file.stat()).mtime.toISOString() };
  } finally { await file.close(); }
}

function collectGroups(catalog: unknown, catalogUpdatedAt: string): Group[] {
  if (!Array.isArray(catalog)) throw new Error("SofaScore catalog must be an array of league snapshots.");
  const groups = new Map<string, Group>();
  for (const rawLeague of catalog) {
    const league = record(rawLeague);
    if (!Array.isArray(league.teams)) continue;
    for (const rawTeam of league.teams) {
      const team = record(rawTeam);
      const providerTeamId = positiveId(team.sofascore_id);
      if (!providerTeamId) continue;
      const group = groups.get(providerTeamId) ?? { providerTeamId };
      groups.set(providerTeamId, group);
      if (group.reason === "catalog_conflict") continue;
      const tournamentId = positiveId(league.sofascore_tournament_id);
      const seasonId = positiveId(league.season_id);
      const statistics = validStatistics(team.season_statistics);
      if (!tournamentId || !seasonId || !statistics) {
        if (!group.patch) group.reason = statistics ? "invalid_scope" : "invalid_statistics";
        continue;
      }
      const provenance: JsonRecord = { source: "catalog_snapshot", provider: "sofascore", providerTeamId, tournamentId, seasonId, catalogUpdatedAt };
      if (typeof league.season_name === "string" && league.season_name.trim()) provenance.seasonName = league.season_name.trim();
      if ((Object.hasOwn(team, "captureMethod") && team.captureMethod !== "visible_dom") ||
        (Object.hasOwn(team, "statisticsCoverage") && team.statisticsCoverage !== "visible_partial") ||
        (Object.hasOwn(team, "scopeProofUrl") && !validPublicScopeProof(team.scopeProofUrl, tournamentId, seasonId))) {
        if (!group.patch) group.reason = "invalid_provenance";
        continue;
      }
      for (const key of ["captureMethod", "statisticsCoverage", "scopeProofUrl"]) {
        if (Object.hasOwn(team, key)) provenance[key] = team[key];
      }
      if (team.providerFetchedAt != null) {
        if (typeof team.providerFetchedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(team.providerFetchedAt) || !Number.isFinite(Date.parse(team.providerFetchedAt))) {
          if (!group.patch) group.reason = "invalid_provenance";
          continue;
        }
        provenance.providerFetchedAt = new Date(team.providerFetchedAt).toISOString();
        provenance.source = typeof team.source === "string" && team.source.trim() ? team.source : "provider_snapshot";
        if (typeof team.endpoint === "string" && /^https:\/\/(?:api\.|www\.)?sofascore\.com\//.test(team.endpoint)) provenance.endpoint = team.endpoint;
      }
      const scope = `${tournamentId}:${seasonId}`;
      const previous = group.patch?.competitionSeasonStatistics[scope];
      if (previous && !equalJson(previous.statistics, statistics)) { group.reason = "catalog_conflict"; continue; }
      group.patch ??= { competitionSeasonStatistics: {} };
      group.patch.competitionSeasonStatistics[scope] = { statistics, provenance };
      group.reason = undefined;
    }
  }
  return [...groups.values()];
}

function resolveIdentity(rawRows: unknown[], providerTeamId: string): { id?: string; metadata?: unknown; reason?: string } {
  const rows = rawRows.map(record);
  const mappings = rows.filter((row) => row.kind === "mapping");
  if (mappings.length > 1 || mappings.some((row) => row.team_exists !== true || row.internal_entity_type !== "team")) return { reason: "identity_conflict" };
  const ids = new Set(rows.filter((row) => row.team_exists === true).map((row) => row.id));
  if (ids.size > 1) return { reason: "identity_conflict" };
  const selected = mappings[0] ?? rows[0];
  if (!selected || selected.team_exists !== true || typeof selected.id !== "string") return { reason: "unknown_team" };
  const metadata = record(selected.metadata);
  if (metadata.sofascoreId != null && String(metadata.sofascoreId) !== providerTeamId) return { reason: "identity_conflict" };
  return { id: selected.id, metadata: selected.metadata };
}

function validStatistics(value: unknown): Record<string, number> | undefined {
  if (!isRecord(value) || typeof value.matches !== "number" || !Number.isInteger(value.matches) || value.matches <= 0) return undefined;
  const statistics: Record<string, number> = {};
  for (const [key, metric] of Object.entries(value)) {
    if (key === "statisticsType" || metric === null) continue; // Provider type metadata and missing metrics are not measurements.
    if (typeof metric !== "number" || !Number.isFinite(metric) || (metric < 0 && key !== "goalsPrevented")) return undefined;
    statistics[key] = metric;
  }
  return statistics;
}

function containsSnapshot(metadata: JsonRecord, patch: Patch) {
  if (patch.seasonStatistics && (!equalJson(metadata.seasonStatistics, patch.seasonStatistics) || !equalJson(metadata.seasonStatisticsSource, patch.seasonStatisticsSource))) return false;
  const scopes = record(metadata.competitionSeasonStatistics);
  return Object.entries(patch.competitionSeasonStatistics).every(([key, value]) => {
    const current = record(scopes[key]);
    return equalJson(current.statistics, value.statistics) && equalJson(current.provenance, value.provenance);
  });
}
function scopedPatch(metadata: JsonRecord, incoming: Patch, providerTeamId: string) {
  const source = record(metadata.seasonStatisticsSource);
  const verified = source.provider === "sofascore" && String(source.providerTeamId) === providerTeamId && positiveId(source.tournamentId) && positiveId(source.seasonId);
  const scope = verified ? incoming.competitionSeasonStatistics[`${source.tournamentId}:${source.seasonId}`] : undefined;
  const patch: Patch = { competitionSeasonStatistics: incoming.competitionSeasonStatistics };
  if (scope) { patch.seasonStatistics = scope.statistics; patch.seasonStatisticsSource = scope.provenance; }
  return { patch, compatibilitySummary: scope ? "refreshed_verified_scope" : verified ? "preserved_different_scope" : "preserved_unverified_scope" };
}
function staleSnapshot(metadata: JsonRecord, incoming: Patch) {
  const flat = record(metadata.seasonStatisticsSource);
  const scopes = record(metadata.competitionSeasonStatistics);
  return Object.entries(incoming.competitionSeasonStatistics).some(([key, value]) => {
    const scopedSource = record(record(scopes[key]).provenance);
    const sources = [scopedSource, `${flat.tournamentId}:${flat.seasonId}` === key ? flat : {}];
    const previous = sources.map((source) => typeof source.providerFetchedAt === "string" ? Date.parse(source.providerFetchedAt) : NaN).filter(Number.isFinite);
    const next = typeof value.provenance.providerFetchedAt === "string" ? Date.parse(value.provenance.providerFetchedAt) : NaN;
    return previous.length > 0 && (!Number.isFinite(next) || Math.max(...previous) > next);
  });
}
function equalJson(left: unknown, right: unknown): boolean {
  if (isRecord(left) && isRecord(right)) {
    const keys = Object.keys(left);
    return keys.length === Object.keys(right).length && keys.every((key) => Object.hasOwn(right, key) && equalJson(left[key], right[key]));
  }
  return left === right;
}
function positiveId(value: unknown) { return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? String(value) : typeof value === "string" && /^[1-9]\d*$/.test(value) ? value : undefined; }
function validPublicScopeProof(value: unknown, tournamentId: string, seasonId: string) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    const route = /^\/football\/tournament\/[^/]+\/[^/]+\/([1-9]\d*)\/?$/.exec(url.pathname);
    return url.protocol === "https:" && ["www.sofascore.com", "sofascore.com"].includes(url.hostname) &&
      !url.username && !url.password && !url.port && !url.search && route?.[1] === tournamentId && url.hash === `#id:${seasonId}`;
  } catch { return false; }
}
function isRecord(value: unknown): value is JsonRecord { return typeof value === "object" && value !== null && !Array.isArray(value); }
function record(value: unknown): JsonRecord { return isRecord(value) ? value : {}; }

const identitySql = `SELECT 'mapping' AS kind, m.internal_entity_id::text AS id,
  m.internal_entity_type, t.id IS NOT NULL AND s.slug = 'football' AS team_exists, t.metadata_json AS metadata
  FROM provider_mappings m LEFT JOIN teams t ON t.id = m.internal_entity_id
  LEFT JOIN sports s ON s.id = t.sport_id
  WHERE m.provider = 'sofascore' AND m.entity_type = 'team' AND m.provider_entity_id = $1
  UNION ALL SELECT 'metadata', t.id::text, 'team', true, t.metadata_json
  FROM teams t JOIN sports s ON s.id = t.sport_id WHERE s.slug = 'football' AND t.metadata_json->>'sofascoreId' = $1`;

// Merge against metadata on the server, never a previously read copy. Entire
// statistics objects are replaced so missing metrics cannot survive as fresh data.
// Other team keys, other competition scopes and unrelated scope keys are retained.
// Identity and observed incoming slots are rechecked atomically: a concurrent
// refresh becomes a no-op, while unrelated metadata changes still merge safely.
const updateSql = `UPDATE teams t SET metadata_json = COALESCE(NULLIF(t.metadata_json, 'null'::jsonb), '{}'::jsonb) ||
  CASE WHEN t.metadata_json->'seasonStatisticsSource'->>'provider' = 'sofascore'
    AND t.metadata_json->'seasonStatisticsSource'->>'providerTeamId' = $2
    AND t.metadata_json->'seasonStatisticsSource'->>'tournamentId' = $3::jsonb->'seasonStatisticsSource'->>'tournamentId'
    AND t.metadata_json->'seasonStatisticsSource'->>'seasonId' = $3::jsonb->'seasonStatisticsSource'->>'seasonId'
    THEN $3::jsonb ELSE $3::jsonb - 'seasonStatistics' - 'seasonStatisticsSource' END ||
  jsonb_build_object('competitionSeasonStatistics', COALESCE(NULLIF(t.metadata_json->'competitionSeasonStatistics', 'null'::jsonb), '{}'::jsonb) ||
    (SELECT jsonb_object_agg(e.key, CASE WHEN jsonb_typeof(t.metadata_json->'competitionSeasonStatistics'->e.key) = 'object'
      THEN t.metadata_json->'competitionSeasonStatistics'->e.key ELSE '{}'::jsonb END || e.value)
     FROM jsonb_each($3::jsonb->'competitionSeasonStatistics') e)), updated_at = now()
  WHERE t.id = $1::uuid AND COALESCE(t.metadata_json->>'sofascoreId', $2) = $2
  AND COALESCE(jsonb_typeof(t.metadata_json), 'null') IN ('object', 'null')
  AND COALESCE(jsonb_typeof(t.metadata_json->'competitionSeasonStatistics'), 'null') IN ('object', 'null')
  AND NOT EXISTS (SELECT 1 FROM jsonb_each($4::jsonb->'scopes') observed
    WHERE COALESCE(t.metadata_json->'competitionSeasonStatistics'->observed.key, 'null'::jsonb) IS DISTINCT FROM observed.value)
  AND COALESCE(t.metadata_json->'seasonStatisticsSource', 'null'::jsonb) IS NOT DISTINCT FROM $4::jsonb->'flatSource'
  AND (NOT ($3::jsonb ? 'seasonStatistics') OR
    COALESCE(t.metadata_json->'seasonStatistics', 'null'::jsonb) IS NOT DISTINCT FROM $4::jsonb->'flatStatistics')
  AND EXISTS (SELECT 1 FROM sports s WHERE s.id = t.sport_id AND s.slug = 'football')
  AND NOT EXISTS (SELECT 1 FROM teams duplicate JOIN sports s ON s.id = duplicate.sport_id WHERE s.slug = 'football' AND duplicate.id <> t.id AND duplicate.metadata_json->>'sofascoreId' = $2)
  AND NOT EXISTS (SELECT 1 FROM provider_mappings m WHERE m.provider = 'sofascore' AND m.entity_type = 'team' AND m.provider_entity_id = $2
    AND (m.internal_entity_id <> t.id OR m.internal_entity_type <> 'team'))
  AND (EXISTS (SELECT 1 FROM provider_mappings m WHERE m.provider = 'sofascore' AND m.entity_type = 'team' AND m.provider_entity_id = $2 AND m.internal_entity_id = t.id AND m.internal_entity_type = 'team')
    OR (t.metadata_json->>'sofascoreId' = $2 AND NOT EXISTS (SELECT 1 FROM provider_mappings m WHERE m.provider = 'sofascore' AND m.entity_type = 'team' AND m.provider_entity_id = $2)))
  RETURNING t.id`;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSofaScoreTeamStatisticsSync(parseSofaScoreTeamStatisticsArgs(process.argv.slice(2))).then((report) => console.log(JSON.stringify(report, null, 2))).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "DATABASE_URL=<redacted>") : "SofaScore team statistics refresh failed.");
    process.exitCode = 1;
  });
}
