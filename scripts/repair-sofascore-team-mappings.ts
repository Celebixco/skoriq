import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import pg from "pg";

type JsonRecord = Record<string, unknown>;
interface DatabaseClient { query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>; }

interface CatalogTeam { sofascore_id: number; name: string; short_name?: string; logo_url?: string; country_name?: string; }
interface CatalogLeague { sofascore_tournament_id: number; teams?: CatalogTeam[]; }

export interface TeamMappingRepairOptions { execute: boolean; catalogPath: string; }
export interface TeamMappingRepairReport {
  mode: "dry_run" | "execute";
  teams: number;
  matchedById: number;
  matchedByName: number;
  created: number;
  mappingsUpserted: number;
  ambiguous: number;
  skipped: number;
  entries: Array<{ sofascoreId: number; name: string; action: string; teamId?: string }>;
}

export function parseTeamMappingRepairArgs(args: string[]): TeamMappingRepairOptions {
  let execute = false;
  let catalogPath = new URL("./sofascore_catalog.json", import.meta.url).pathname;
  if (process.platform === "win32") catalogPath = catalogPath.replace(/^\/([A-Za-z]:)/, "$1");
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--execute") execute = true;
    else if (arg === "--catalog" || arg.startsWith("--catalog=")) {
      const value = arg === "--catalog" ? args[++index] : arg.slice("--catalog=".length);
      if (!value || value.startsWith("--")) throw new Error("--catalog requires a file path.");
      catalogPath = value;
    } else throw new Error(`Unknown team mapping repair flag "${arg}".`);
  }
  return { execute, catalogPath };
}

function catalogTeams(catalog: unknown): CatalogTeam[] {
  if (!Array.isArray(catalog)) throw new Error("Catalog must be a league array.");
  const teams: CatalogTeam[] = [];
  const seen = new Set<number>();
  for (const rawLeague of catalog) {
    if (!rawLeague || typeof rawLeague !== "object") continue;
    for (const rawTeam of (rawLeague as CatalogLeague).teams ?? []) {
      if (!rawTeam || typeof rawTeam !== "object") continue;
      const id = Number(rawTeam.sofascore_id);
      const name = typeof rawTeam.name === "string" ? rawTeam.name.trim() : "";
      if (!Number.isSafeInteger(id) || id <= 0 || !name || seen.has(id)) continue;
      seen.add(id);
      teams.push({ ...rawTeam, sofascore_id: id, name });
    }
  }
  return teams;
}

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[ıİ]/g, "i")
    .replace(/[şŞ]/g, "s")
    .replace(/[ğĞ]/g, "g")
    .replace(/[üÜ]/g, "u")
    .replace(/[öÖ]/g, "o")
    .replace(/[çÇ]/g, "c")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "team";
}

export async function runTeamMappingRepair(options: TeamMappingRepairOptions, dependencies: { env?: NodeJS.ProcessEnv; database?: DatabaseClient } = {}) {
  const env = dependencies.env ?? process.env;
  if (options.execute && !env.DATABASE_URL) throw new Error("Executing team mapping repair requires DATABASE_URL.");
  if (env.DATABASE_URL) validateDatabaseUrl(env.DATABASE_URL);
  const catalog = JSON.parse(await readFile(options.catalogPath, "utf8")) as unknown;
  const teams = catalogTeams(catalog);
  const pool = env.DATABASE_URL && !dependencies.database
    ? new pg.Pool({ connectionString: env.DATABASE_URL, max: 2, connectionTimeoutMillis: 5_000, query_timeout: 15_000, statement_timeout: 15_000 })
    : undefined;
  pool?.on("error", () => {});
  const database = env.DATABASE_URL ? dependencies.database ?? pool : undefined;
  const entries: TeamMappingRepairReport["entries"] = [];
  const report: TeamMappingRepairReport = {
    mode: options.execute ? "execute" : "dry_run",
    teams: teams.length,
    matchedById: 0,
    matchedByName: 0,
    created: 0,
    mappingsUpserted: 0,
    ambiguous: 0,
    skipped: 0,
    entries
  };
  try {
    if (!database) return report;
    const sport = (await database.query(`SELECT id::text AS id FROM sports WHERE slug = 'football' LIMIT 1`)).rows[0] as { id: string } | undefined;
    if (!sport) throw new Error("Football sport is missing.");
    for (const team of teams) {
      const providerId = String(team.sofascore_id);
      const byId = (await database.query(
        `SELECT DISTINCT t.id::text AS id, t.name
         FROM teams t
         INNER JOIN sports s ON s.id = t.sport_id AND s.slug = 'football'
         LEFT JOIN provider_mappings pm
           ON pm.provider = 'sofascore' AND pm.entity_type = 'team' AND pm.internal_entity_id = t.id
         WHERE pm.provider_entity_id = $1 OR t.metadata_json->>'sofascoreId' = $1
         LIMIT 2`,
        [providerId]
      )).rows as Array<{ id: string; name: string }>;
      let teamId: string | undefined;
      let action: string;
      if (byId.length > 1) {
        report.ambiguous += 1;
        entries.push({ sofascoreId: team.sofascore_id, name: team.name, action: "ambiguous_id" });
        continue;
      }
      if (byId.length === 1) {
        teamId = byId[0]!.id;
        action = "matched_by_id";
        report.matchedById += 1;
      } else {
        const byName = (await database.query(
          `SELECT t.id::text AS id FROM teams t
           INNER JOIN sports s ON s.id = t.sport_id AND s.slug = 'football'
           WHERE lower(t.name) = lower($1)
           LIMIT 2`,
          [team.name]
        )).rows as Array<{ id: string }>;
        if (byName.length > 1) {
          report.ambiguous += 1;
          entries.push({ sofascoreId: team.sofascore_id, name: team.name, action: "ambiguous_name" });
          continue;
        }
        if (byName.length === 1) {
          teamId = byName[0]!.id;
          action = "matched_by_name";
          report.matchedByName += 1;
        } else if (!options.execute) {
          action = "planned_create";
          report.created += 1;
          entries.push({ sofascoreId: team.sofascore_id, name: team.name, action });
          continue;
        } else {
          const country = team.country_name
            ? (await database.query(`SELECT id::text AS id FROM countries WHERE lower(name) = lower($1) LIMIT 1`, [team.country_name])).rows[0] as { id: string } | undefined
            : undefined;
          const inserted = (await database.query(
            `INSERT INTO teams (sport_id, country_id, name, short_name, slug, type, gender, logo_url, metadata_json)
             VALUES ($1::uuid, $2::uuid, $3, $4, $5, 'club', 'men', $6, $7::jsonb)
             ON CONFLICT (sport_id, slug) DO UPDATE SET
               name = EXCLUDED.name,
               short_name = EXCLUDED.short_name,
               logo_url = COALESCE(EXCLUDED.logo_url, teams.logo_url),
               metadata_json = COALESCE(teams.metadata_json, '{}'::jsonb) || EXCLUDED.metadata_json,
               updated_at = now()
             RETURNING id::text AS id`,
            [
              sport.id,
              country?.id ?? null,
              team.name,
              team.short_name ?? null,
              `${slugify(team.name)}-${providerId}`,
              team.logo_url ?? null,
              JSON.stringify({ sofascoreId: team.sofascore_id, nameCode: (team as JsonRecord).name_code ?? null })
            ]
          )).rows[0] as { id: string } | undefined;
          if (!inserted) throw new Error(`Team insert returned no id for ${team.name}.`);
          teamId = inserted.id;
          action = "created";
          report.created += 1;
          entries.push({ sofascoreId: team.sofascore_id, name: team.name, action, teamId });
          // Continue below to add the mapping.
        }
      }
      if (!teamId) { report.skipped += 1; continue; }
      if (options.execute) {
        await database.query(
          `UPDATE teams
           SET metadata_json = COALESCE(NULLIF(metadata_json, 'null'::jsonb), '{}'::jsonb)
             || jsonb_build_object('sofascoreId', $1::bigint)
             , updated_at = now()
           WHERE id = $2::uuid`,
          [team.sofascore_id, teamId]
        );
        await database.query(
          `INSERT INTO provider_mappings (provider, entity_type, provider_entity_id, internal_entity_id, internal_entity_type)
           VALUES ('sofascore', 'team', $1, $2::uuid, 'team')
           ON CONFLICT (provider, entity_type, provider_entity_id)
           DO UPDATE SET internal_entity_id = EXCLUDED.internal_entity_id`,
          [providerId, teamId]
        );
        report.mappingsUpserted += 1;
      }
      if (!entries.some((entry) => entry.sofascoreId === team.sofascore_id)) {
        entries.push({ sofascoreId: team.sofascore_id, name: team.name, action, teamId });
      }
    }
  } finally {
    await pool?.end();
  }
  return report;
}

function validateDatabaseUrl(databaseUrl: string) {
  const parsed = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) throw new Error("DATABASE_URL must be a PostgreSQL URL.");
  if (["host", "hostaddr", "service", "servicefile"].some((key) => parsed.searchParams.has(key))) {
    throw new Error("Team mapping repair refuses connection target overrides.");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runTeamMappingRepair(parseTeamMappingRepairArgs(process.argv.slice(2)))
    .then((report) => console.log(JSON.stringify(report, null, 2)))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "DATABASE_URL=<redacted>") : "Team mapping repair failed.");
      process.exitCode = 1;
    });
}
