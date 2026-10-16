// Local-only fixture seeder for reproducing ingestion against a disposable database.
// Refuses anything that is not a localhost target.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL ?? "";
if (!/(localhost|127\.0\.0\.1)/.test(databaseUrl)) {
  console.error("Set DATABASE_URL to a local disposable database before seeding fixtures.");
  process.exit(2);
}
const capturePath = process.argv[2];
if (!capturePath) {
  console.error("Usage: node scripts/local-test-fixtures.mjs <capture.json>");
  process.exit(2);
}

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(await readFile(path.join(scriptsDir, "sofascore_catalog.json"), "utf8"));
const capture = JSON.parse(await readFile(capturePath, "utf8"));
const leagues = Array.isArray(catalog) ? catalog : catalog.leagues;

const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
try {
  let sportId = (await pool.query("SELECT id FROM sports WHERE slug = 'football'")).rows[0]?.id;
  if (!sportId) {
    sportId = (await pool.query("INSERT INTO sports (slug, name) VALUES ('football', 'Football') RETURNING id")).rows[0].id;
  }

  const captureSeasonByTournament = new Map();
  for (const tournament of capture.tournaments ?? []) {
    captureSeasonByTournament.set(Number(tournament.sofascore_tournament_id), Number(tournament.season_id));
  }

  let competitions = 0;
  let teams = 0;
  for (const league of leagues) {
    const tournamentId = Number(league.sofascore_tournament_id);
    if (!Number.isSafeInteger(tournamentId) || tournamentId <= 0) continue;
    const name = String(league.league_name ?? `Tournament ${tournamentId}`);
    const slug = String(league.league_slug ?? `league-${tournamentId}`);
    let competitionId = (await pool.query("SELECT id FROM competitions WHERE slug = $1", [slug])).rows[0]?.id;
    if (!competitionId) {
      competitionId = (await pool.query(
        "INSERT INTO competitions (sport_id, name, slug) VALUES ($1, $2, $3) RETURNING id",
        [sportId, name, slug]
      )).rows[0].id;
    }
    competitions++;
    await pool.query(
      `INSERT INTO provider_mappings (provider, entity_type, provider_entity_id, internal_entity_id, internal_entity_type)
       SELECT 'sofascore', 'competition', $1, $2, 'competition'
       WHERE NOT EXISTS (
         SELECT 1 FROM provider_mappings WHERE provider = 'sofascore' AND entity_type = 'competition' AND provider_entity_id = $1
       )`,
      [String(tournamentId), competitionId]
    );
    const seasonId = captureSeasonByTournament.get(tournamentId);
    if (seasonId) {
      const seasonName = `Sofascore ${seasonId}`;
      const hasSeason = (await pool.query(
        "SELECT id FROM seasons WHERE competition_id = $1 AND name = $2",
        [competitionId, seasonName]
      )).rows.length > 0;
      if (!hasSeason) {
        await pool.query(
          "INSERT INTO seasons (competition_id, name, is_current) VALUES ($1, $2, true)",
          [competitionId, seasonName]
        );
      }
    }
    for (const team of league.teams ?? []) {
      const providerTeamId = Number(team.sofascore_id);
      if (!Number.isSafeInteger(providerTeamId) || providerTeamId <= 0) continue;
      const teamSlug = String(team.slug ?? `team-${providerTeamId}`);
      let teamId = (await pool.query("SELECT id FROM teams WHERE slug = $1", [teamSlug])).rows[0]?.id;
      if (!teamId) {
        teamId = (await pool.query(
          "INSERT INTO teams (sport_id, name, slug, metadata_json) VALUES ($1, $2, $3, $4::jsonb) RETURNING id",
          [sportId, String(team.name ?? teamSlug), teamSlug, JSON.stringify({ sofascoreId: providerTeamId })]
        )).rows[0].id;
      }
      teams++;
      await pool.query(
        `INSERT INTO provider_mappings (provider, entity_type, provider_entity_id, internal_entity_id, internal_entity_type)
         SELECT 'sofascore', 'team', $1, $2, 'team'
         WHERE NOT EXISTS (
           SELECT 1 FROM provider_mappings WHERE provider = 'sofascore' AND entity_type = 'team' AND provider_entity_id = $1
         )`,
        [String(providerTeamId), teamId]
      );
    }
  }
  console.log(JSON.stringify({ seeded: true, competitions, teams }));
} finally {
  await pool.end();
}
