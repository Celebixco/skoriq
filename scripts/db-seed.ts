import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import pg from "pg";

const scrypt = promisify(scryptCallback);
const keyLength = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("base64url");
  const derived = (await scrypt(password, salt, keyLength)) as Buffer;
  return `scrypt$${salt}$${derived.toString("base64url")}`;
}

export function slugify(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

interface SofaScoreTeam {
  sofascore_id: number;
  name: string;
  short_name: string;
  name_code: string;
  slug: string;
  logo_url: string;
  country_name: string;
  country_code: string;
  country_slug: string;
  team_colors?: {
    primary?: string;
    secondary?: string;
    text?: string;
  };
  position: number;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goals_for: number;
  goals_against: number;
  goal_difference: number;
  points: number;
  home_played?: number;
  home_wins?: number;
  home_draws?: number;
  home_losses?: number;
  home_goals_for?: number;
  home_goals_against?: number;
  away_played?: number;
  away_wins?: number;
  away_draws?: number;
  away_losses?: number;
  away_goals_for?: number;
  away_goals_against?: number;
}

interface SofaScoreMatch {
  sofascore_id: number;
  home_team_id: number;
  home_team_name: string;
  away_team_id: number;
  away_team_name: string;
  scheduled_start_at: number;
  status: string;
  home_score?: number;
  away_score?: number;
  round?: string;
  venue?: string;
}

interface SofaScoreLeague {
  country: string;
  country_code: string;
  country_slug: string;
  league_name: string;
  league_slug: string;
  sofascore_tournament_id: number;
  tournament_logo_url: string;
  season_id: number;
  season_name: string;
  teams_count: number;
  teams: SofaScoreTeam[];
  recent_matches?: SofaScoreMatch[];
  upcoming_matches?: SofaScoreMatch[];
}

export async function seedInitialData(pool: pg.Pool) {
  console.log("=================================================");
  console.log("STARTING SOFASCORE AUTHENTIC DATA INGESTION");
  console.log("=================================================");

  // 1. Load Scraped Catalog Data
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const catalogPath = path.resolve(__dirname, "sofascore_catalog.json");
  
  if (!fs.existsSync(catalogPath)) {
    throw new Error(`Catalog data file not found at: ${catalogPath}. Please run scripts/scrape_sofascore.py first.`);
  }

  const catalog: SofaScoreLeague[] = JSON.parse(fs.readFileSync(catalogPath, "utf-8"));
  console.log(`Loaded catalog with ${catalog.length} leagues.`);

  // 2. Clean stale mock records
  await pool.query(`
    TRUNCATE TABLE teams, matches CASCADE;
    DELETE FROM provider_mappings WHERE entity_type IN ('team', 'match', 'competition', 'country');
  `);
  console.log("Cleaned teams, matches, standings, and temporary provider mappings.");

  // 3. Ensure Sport: Football
  const sportRes = await pool.query(`
    INSERT INTO sports (slug, name)
    VALUES ('football', 'Football')
    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
    RETURNING id;
  `);
  const sportId = sportRes.rows[0].id;
  console.log(`Sport 'football' verified with ID: ${sportId}`);

  // In-memory caches to prevent duplicates across competitions
  const countryIdCache = new Map<string, string>(); // slug -> country_id
  const teamIdCache = new Map<number, string>(); // sofascore_team_id -> team_id
  const slugCountMap = new Map<string, number>(); // slug tracking for uniqueness

  // Helper to ensure country
  async function getOrCreateCountry(name: string, code: string, slug: string): Promise<string> {
    const cleanSlug = slugify(slug || name);
    if (countryIdCache.has(cleanSlug)) {
      return countryIdCache.get(cleanSlug)!;
    }

    const cleanCode = (code || cleanSlug.substring(0, 3)).toUpperCase();
    const res = await pool.query(`
      INSERT INTO countries (code, slug, name)
      VALUES ($1, $2, $3)
      ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
      RETURNING id;
    `, [cleanCode, cleanSlug, name]);

    const countryId = res.rows[0].id;
    countryIdCache.set(cleanSlug, countryId);

    await pool.query(`
      INSERT INTO provider_mappings (provider, entity_type, provider_entity_id, internal_entity_id, internal_entity_type)
      VALUES ('sofascore', 'country', $1, $2, 'country')
      ON CONFLICT (provider, entity_type, provider_entity_id) DO UPDATE SET internal_entity_id = EXCLUDED.internal_entity_id;
    `, [cleanSlug, countryId]);

    return countryId;
  }

  let totalTeamsIngested = 0;
  let totalStandingsIngested = 0;
  let totalMatchesIngested = 0;

  for (const league of catalog) {
    // 4. Ensure League Country
    const leagueCountryId = await getOrCreateCountry(league.country, league.country_code, league.country_slug);

    // 5. Ensure Competition with official SofaScore Tournament Logo
    const compMetadata = {
      logoUrl: league.tournament_logo_url,
      imageUrl: league.tournament_logo_url,
      badgeUrl: league.tournament_logo_url,
      sofascoreTournamentId: league.sofascore_tournament_id,
      seasonName: league.season_name
    };

    const compRes = await pool.query(`
      INSERT INTO competitions (sport_id, country_id, slug, name, gender, level, metadata_json)
      VALUES ($1, $2, $3, $4, 'men', 'tier_1', $5)
      ON CONFLICT (sport_id, slug) DO UPDATE SET
        name = EXCLUDED.name,
        country_id = EXCLUDED.country_id,
        metadata_json = EXCLUDED.metadata_json
      RETURNING id;
    `, [sportId, leagueCountryId, league.league_slug, league.league_name, JSON.stringify(compMetadata)]);
    const compId = compRes.rows[0].id;

    await pool.query(`
      INSERT INTO provider_mappings (provider, entity_type, provider_entity_id, internal_entity_id, internal_entity_type)
      VALUES ('sofascore', 'competition', $1, $2, 'competition')
      ON CONFLICT (provider, entity_type, provider_entity_id) DO UPDATE SET internal_entity_id = EXCLUDED.internal_entity_id;
    `, [String(league.sofascore_tournament_id), compId]);

    // 6. Ensure Season
    const seasonRes = await pool.query(`
      INSERT INTO seasons (competition_id, name, is_current, start_date, end_date)
      VALUES ($1, $2, true, '2026-08-01', '2027-05-31')
      ON CONFLICT (competition_id, name) DO UPDATE SET is_current = true
      RETURNING id;
    `, [compId, league.season_name]);
    const seasonId = seasonRes.rows[0].id;

    // 7. Ingest Teams and Standings for this League
    for (const team of league.teams) {
      let teamId = teamIdCache.get(team.sofascore_id);

      if (!teamId) {
        // Ensure team's home country
        const teamCountryId = await getOrCreateCountry(
          team.country_name || league.country,
          team.country_code || league.country_code,
          team.country_slug || league.country_slug
        );

        // Generate unique slug
        let baseSlug = slugify(team.slug || team.name);
        const currentCount = slugCountMap.get(baseSlug) || 0;
        let uniqueSlug = baseSlug;
        if (currentCount > 0) {
          uniqueSlug = `${baseSlug}-${team.sofascore_id}`;
        }
        slugCountMap.set(baseSlug, currentCount + 1);

        const teamMetadata = {
          sofascoreId: team.sofascore_id,
          nameCode: team.name_code,
          teamColors: team.team_colors
        };

        const teamRes = await pool.query(`
          INSERT INTO teams (sport_id, country_id, name, short_name, slug, type, gender, logo_url, metadata_json)
          VALUES ($1, $2, $3, $4, $5, 'club', 'men', $6, $7)
          ON CONFLICT (sport_id, slug) DO UPDATE SET
            name = EXCLUDED.name,
            short_name = EXCLUDED.short_name,
            logo_url = EXCLUDED.logo_url,
            country_id = EXCLUDED.country_id,
            metadata_json = EXCLUDED.metadata_json
          RETURNING id;
        `, [
          sportId,
          teamCountryId,
          team.name,
          team.short_name,
          uniqueSlug,
          team.logo_url,
          JSON.stringify(teamMetadata)
        ]);

        teamId = teamRes.rows[0].id;
        teamIdCache.set(team.sofascore_id, teamId);
        totalTeamsIngested++;

        // Provider mapping
        await pool.query(`
          INSERT INTO provider_mappings (provider, entity_type, provider_entity_id, internal_entity_id, internal_entity_type)
          VALUES ('sofascore', 'team', $1, $2, 'team')
          ON CONFLICT (provider, entity_type, provider_entity_id) DO UPDATE SET internal_entity_id = EXCLUDED.internal_entity_id;
        `, [String(team.sofascore_id), teamId]);
      }

      // 8. Insert Standing Row
      await pool.query(`
        INSERT INTO football_standings (
          competition_id, season_id, team_id, position, played, wins, draws, losses,
          goals_for, goals_against, goal_difference, points,
          home_played, home_wins, home_draws, home_losses, home_goals_for, home_goals_against,
          away_played, away_wins, away_draws, away_losses, away_goals_for, away_goals_against,
          status
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8,
          $9, $10, $11, $12,
          $13, $14, $15, $16, $17, $18,
          $19, $20, $21, $22, $23, $24,
          'active'
        )
        ON CONFLICT (competition_id, season_id, team_id) DO UPDATE SET
          position = EXCLUDED.position,
          played = EXCLUDED.played,
          wins = EXCLUDED.wins,
          draws = EXCLUDED.draws,
          losses = EXCLUDED.losses,
          goals_for = EXCLUDED.goals_for,
          goals_against = EXCLUDED.goals_against,
          goal_difference = EXCLUDED.goal_difference,
          points = EXCLUDED.points,
          home_played = EXCLUDED.home_played,
          home_wins = EXCLUDED.home_wins,
          home_draws = EXCLUDED.home_draws,
          home_losses = EXCLUDED.home_losses,
          home_goals_for = EXCLUDED.home_goals_for,
          home_goals_against = EXCLUDED.home_goals_against,
          away_played = EXCLUDED.away_played,
          away_wins = EXCLUDED.away_wins,
          away_draws = EXCLUDED.away_draws,
          away_losses = EXCLUDED.away_losses,
          away_goals_for = EXCLUDED.away_goals_for,
          away_goals_against = EXCLUDED.away_goals_against,
          status = 'active';
      `, [
        compId,
        seasonId,
        teamId,
        team.position,
        team.played,
        team.wins,
        team.draws,
        team.losses,
        team.goals_for,
        team.goals_against,
        team.goal_difference,
        team.points,
        team.home_played || 0,
        team.home_wins || 0,
        team.home_draws || 0,
        team.home_losses || 0,
        team.home_goals_for || 0,
        team.home_goals_against || 0,
        team.away_played || 0,
        team.away_wins || 0,
        team.away_draws || 0,
        team.away_losses || 0,
        team.away_goals_for || 0,
        team.away_goals_against || 0
      ]);

      totalStandingsIngested++;
    }

    // 9. Ingest Recent Finished Matches
    if (league.recent_matches && league.recent_matches.length > 0) {
      for (const m of league.recent_matches) {
        const homeTeamId = teamIdCache.get(m.home_team_id);
        const awayTeamId = teamIdCache.get(m.away_team_id);

        if (!homeTeamId || !awayTeamId || !m.scheduled_start_at) continue;

        let winnerTeamId: string | null = null;
        if (typeof m.home_score === "number" && typeof m.away_score === "number") {
          if (m.home_score > m.away_score) winnerTeamId = homeTeamId;
          else if (m.away_score > m.home_score) winnerTeamId = awayTeamId;
        }

        const matchMetadata = {
          sofascoreId: m.sofascore_id,
          homeScore: m.home_score,
          awayScore: m.away_score,
          round: m.round
        };

        const scheduledDate = new Date(m.scheduled_start_at * 1000);

        await pool.query(`
          INSERT INTO matches (
            sport_id, competition_id, season_id, round, home_team_id, away_team_id,
            scheduled_start_at, status, venue, winner_team_id, metadata_json
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, 'finished', $8, $9, $10)
          ON CONFLICT (competition_id, season_id, home_team_id, away_team_id, scheduled_start_at)
          DO UPDATE SET
            status = 'finished',
            winner_team_id = EXCLUDED.winner_team_id,
            metadata_json = EXCLUDED.metadata_json;
        `, [
          sportId,
          compId,
          seasonId,
          m.round || null,
          homeTeamId,
          awayTeamId,
          scheduledDate,
          m.venue || null,
          winnerTeamId,
          JSON.stringify(matchMetadata)
        ]);

        totalMatchesIngested++;
      }
    }

    // 10. Ingest Upcoming Fixtures
    if (league.upcoming_matches && league.upcoming_matches.length > 0) {
      for (const m of league.upcoming_matches) {
        const homeTeamId = teamIdCache.get(m.home_team_id);
        const awayTeamId = teamIdCache.get(m.away_team_id);

        if (!homeTeamId || !awayTeamId || !m.scheduled_start_at) continue;

        const matchMetadata = {
          sofascoreId: m.sofascore_id,
          round: m.round
        };

        const scheduledDate = new Date(m.scheduled_start_at * 1000);

        await pool.query(`
          INSERT INTO matches (
            sport_id, competition_id, season_id, round, home_team_id, away_team_id,
            scheduled_start_at, status, venue, metadata_json
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, 'scheduled', $8, $9)
          ON CONFLICT (competition_id, season_id, home_team_id, away_team_id, scheduled_start_at)
          DO UPDATE SET
            status = 'scheduled',
            metadata_json = EXCLUDED.metadata_json;
        `, [
          sportId,
          compId,
          seasonId,
          m.round || null,
          homeTeamId,
          awayTeamId,
          scheduledDate,
          m.venue || null,
          JSON.stringify(matchMetadata)
        ]);

        totalMatchesIngested++;
      }
    }

    console.log(`[INGESTED] ${league.country}: ${league.league_name} (${league.teams.length} teams, ${league.recent_matches?.length || 0} finished, ${league.upcoming_matches?.length || 0} upcoming)`);
  }

  // 11. Ensure Admin User
  const adminEmail = (process.env.ADMIN_EMAIL || "admin@skoriq.local").trim().toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD || "AdminPassword123!";
  const passwordHash = await hashPassword(adminPassword);

  await pool.query(`
    INSERT INTO users (email, first_name, last_name, phone_number, password_hash, role, status)
    VALUES ($1, 'SkorIQ', 'Admin', '+905550000000', $2, 'admin', 'active')
    ON CONFLICT (email) DO UPDATE
    SET role = 'admin', status = 'active', password_hash = EXCLUDED.password_hash, updated_at = now();
  `, [adminEmail, passwordHash]);
  console.log(`Admin user verified: ${adminEmail}`);

  console.log("=================================================");
  console.log("INGESTION SUMMARY:");
  console.log(`  Total Competitions Ingested: ${catalog.length}`);
  console.log(`  Total Authentic Teams Ingested: ${totalTeamsIngested}`);
  console.log(`  Total Standings Rows Ingested: ${totalStandingsIngested}`);
  console.log(`  Total Matches (Live & Fixtures) Ingested: ${totalMatchesIngested}`);
  console.log("=================================================");
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is required to run seed.");
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
  try {
    await seedInitialData(pool);
  } catch (err) {
    console.error("Seed error:", err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
