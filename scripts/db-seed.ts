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

export interface LeagueCountryDef {
  country: string;
  code: string;
  slug: string;
  providerCountryId: string;
  compSlug: string;
  compName: string;
  providerLeagueId: string;
  teams: string[];
}

export const realLeaguesAndTeams: LeagueCountryDef[] = [
  {
    country: "Turkey",
    code: "TR",
    slug: "turkey",
    providerCountryId: "111",
    compSlug: "super-lig",
    compName: "Süper Lig",
    providerLeagueId: "322",
    teams: [
      "Adana Demirspor",
      "Alanyaspor",
      "Antalyaspor",
      "Beşiktaş",
      "Bodrum FK",
      "Eyüpspor",
      "Fenerbahçe",
      "Galatasaray",
      "Gaziantep FK",
      "Göztepe",
      "Hatayspor",
      "Kasımpaşa SK",
      "Kayserispor",
      "Konyaspor",
      "Samsunspor",
      "Sivasspor",
      "Trabzonspor",
      "Çaykur Rizespor",
      "İstanbul Başakşehir"
    ]
  },
  {
    country: "England",
    code: "GB",
    slug: "england",
    providerCountryId: "44",
    compSlug: "premier-league",
    compName: "Premier League",
    providerLeagueId: "152",
    teams: [
      "AFC Bournemouth",
      "Arsenal FC",
      "Aston Villa FC",
      "Brentford FC",
      "Brighton & Hove Albion FC",
      "Chelsea FC",
      "Crystal Palace FC",
      "Everton FC",
      "Fulham FC",
      "Ipswich Town FC",
      "Leicester City FC",
      "Liverpool FC",
      "Manchester City FC",
      "Manchester United FC",
      "Newcastle United FC",
      "Nottingham Forest FC",
      "Southampton FC",
      "Tottenham Hotspur FC",
      "West Ham United FC",
      "Wolverhampton Wanderers FC"
    ]
  },
  {
    country: "Spain",
    code: "ES",
    slug: "spain",
    providerCountryId: "6",
    compSlug: "la-liga",
    compName: "La Liga",
    providerLeagueId: "302",
    teams: [
      "Athletic Club",
      "CA Osasuna",
      "CD Leganés",
      "Club Atlético de Madrid",
      "Deportivo Alavés",
      "FC Barcelona",
      "Getafe CF",
      "Girona FC",
      "RC Celta de Vigo",
      "RCD Espanyol de Barcelona",
      "RCD Mallorca",
      "Rayo Vallecano de Madrid",
      "Real Betis Balompié",
      "Real Madrid CF",
      "Real Sociedad de Fútbol",
      "Real Valladolid CF",
      "Sevilla FC",
      "UD Las Palmas",
      "Valencia CF",
      "Villarreal CF"
    ]
  },
  {
    country: "Italy",
    code: "IT",
    slug: "italy",
    providerCountryId: "5",
    compSlug: "serie-a",
    compName: "Serie A",
    providerLeagueId: "207",
    teams: [
      "AC Milan",
      "AC Monza",
      "ACF Fiorentina",
      "AS Roma",
      "Atalanta BC",
      "Bologna FC 1909",
      "Cagliari Calcio",
      "Como 1907",
      "Empoli FC",
      "FC Internazionale Milano",
      "Genoa CFC",
      "Hellas Verona FC",
      "Juventus FC",
      "Parma Calcio 1913",
      "SS Lazio",
      "SSC Napoli",
      "Torino FC",
      "US Lecce",
      "Udinese Calcio",
      "Venezia FC"
    ]
  },
  {
    country: "Germany",
    code: "DE",
    slug: "germany",
    providerCountryId: "4",
    compSlug: "bundesliga",
    compName: "Bundesliga",
    providerLeagueId: "175",
    teams: [
      "1. FC Heidenheim 1846",
      "1. FC Union Berlin",
      "1. FSV Mainz 05",
      "Bayer 04 Leverkusen",
      "Borussia Dortmund",
      "Borussia Mönchengladbach",
      "Eintracht Frankfurt",
      "FC Augsburg",
      "FC Bayern München",
      "FC St. Pauli 1910",
      "Holstein Kiel",
      "RB Leipzig",
      "SC Freiburg",
      "SV Werder Bremen",
      "TSG 1899 Hoffenheim",
      "VfB Stuttgart",
      "VfL Bochum 1848",
      "VfL Wolfsburg"
    ]
  },
  {
    country: "France",
    code: "FR",
    slug: "france",
    providerCountryId: "3",
    compSlug: "ligue-1",
    compName: "Ligue 1",
    providerLeagueId: "168",
    teams: [
      "AJ Auxerre",
      "AS Monaco FC",
      "AS Saint-Étienne",
      "Angers SCO",
      "FC Nantes",
      "Le Havre AC",
      "Lille OSC",
      "Montpellier HSC",
      "OGC Nice",
      "Olympique Lyonnais",
      "Olympique de Marseille",
      "Paris Saint-Germain FC",
      "RC Strasbourg Alsace",
      "Racing Club de Lens",
      "Stade Brestois 29",
      "Stade Rennais FC 1901",
      "Stade de Reims",
      "Toulouse FC"
    ]
  },
  {
    country: "Netherlands",
    code: "NL",
    slug: "netherlands",
    providerCountryId: "82",
    compSlug: "eredivisie",
    compName: "Eredivisie",
    providerLeagueId: "244",
    teams: [
      "AFC Ajax",
      "AZ",
      "Almere City FC",
      "FC Groningen",
      "FC Twente '65",
      "FC Utrecht",
      "Feyenoord Rotterdam",
      "Fortuna Sittard",
      "Go Ahead Eagles",
      "Heracles Almelo",
      "NAC Breda",
      "NEC",
      "PEC Zwolle",
      "PSV",
      "RKC Waalwijk",
      "SC Heerenveen",
      "Sparta Rotterdam",
      "Willem II Tilburg"
    ]
  }
];

export async function seedInitialData(pool: pg.Pool) {
  console.log("Starting real countries, leagues, and teams ingestion...");

  // 1. Ensure clean slate for matches, predictions, and features
  await pool.query(`
    TRUNCATE TABLE teams, matches CASCADE;
    DELETE FROM provider_mappings WHERE entity_type IN ('team', 'match');
  `);
  console.log("Cleaned matches, predictions, and temporary team rows.");

  // 2. Ensure Sport: Football
  const sportRes = await pool.query(`
    INSERT INTO sports (slug, name)
    VALUES ('football', 'Football')
    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
    RETURNING id;
  `);
  const sportId = sportRes.rows[0].id;
  console.log(`Sport 'football' verified: ${sportId}`);

  let totalTeamsIngested = 0;

  for (const item of realLeaguesAndTeams) {
    // 3. Ensure Country
    const countryRes = await pool.query(`
      INSERT INTO countries (code, slug, name)
      VALUES ($1, $2, $3)
      ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, slug = EXCLUDED.slug
      RETURNING id;
    `, [item.code, item.slug, item.country]);
    const countryId = countryRes.rows[0].id;

    await pool.query(`
      INSERT INTO provider_mappings (provider, entity_type, provider_entity_id, internal_entity_id, internal_entity_type)
      VALUES ('apifootball-com', 'country', $1, $2, 'country')
      ON CONFLICT (provider, entity_type, provider_entity_id) DO UPDATE SET internal_entity_id = EXCLUDED.internal_entity_id;
    `, [item.providerCountryId, countryId]);

    // 4. Ensure Competition (League)
    const compRes = await pool.query(`
      INSERT INTO competitions (sport_id, country_id, slug, name, gender, level)
      VALUES ($1, $2, $3, $4, 'men', 'tier_1')
      ON CONFLICT (sport_id, slug) DO UPDATE SET name = EXCLUDED.name, country_id = EXCLUDED.country_id
      RETURNING id;
    `, [sportId, countryId, item.compSlug, item.compName]);
    const compId = compRes.rows[0].id;

    await pool.query(`
      INSERT INTO provider_mappings (provider, entity_type, provider_entity_id, internal_entity_id, internal_entity_type)
      VALUES ('apifootball-com', 'competition', $1, $2, 'competition')
      ON CONFLICT (provider, entity_type, provider_entity_id) DO UPDATE SET internal_entity_id = EXCLUDED.internal_entity_id;
    `, [item.providerLeagueId, compId]);

    // 5. Ensure Season 2024/2025
    const seasonRes = await pool.query(`
      INSERT INTO seasons (competition_id, name, is_current, start_date, end_date)
      VALUES ($1, '2024/2025', true, '2024-08-01', '2025-05-31')
      ON CONFLICT (competition_id, name) DO UPDATE SET is_current = true
      RETURNING id;
    `, [compId]);
    const seasonId = seasonRes.rows[0].id;

    // 6. Ingest Real Teams for this League & Country
    let pos = 1;
    for (const teamName of item.teams) {
      const teamSlug = slugify(teamName);

      const teamRes = await pool.query(`
        INSERT INTO teams (sport_id, country_id, name, slug, type, gender)
        VALUES ($1, $2, $3, $4, 'club', 'men')
        ON CONFLICT (sport_id, slug) DO UPDATE
        SET name = EXCLUDED.name, country_id = EXCLUDED.country_id
        RETURNING id;
      `, [sportId, countryId, teamName, teamSlug]);
      const teamId = teamRes.rows[0].id;

      // Map team provider
      await pool.query(`
        INSERT INTO provider_mappings (provider, entity_type, provider_entity_id, internal_entity_id, internal_entity_type)
        VALUES ('openfootball', 'team', $1, $2, 'team')
        ON CONFLICT (provider, entity_type, provider_entity_id) DO UPDATE SET internal_entity_id = EXCLUDED.internal_entity_id;
      `, [`openfootball:${teamSlug}`, teamId]);

      // Connect team to competition via standings
      await pool.query(`
        INSERT INTO football_standings (
          competition_id, season_id, team_id, position, played, wins, draws, losses,
          goals_for, goals_against, goal_difference, points, status
        )
        VALUES ($1, $2, $3, $4, 0, 0, 0, 0, 0, 0, 0, 0, 'active')
        ON CONFLICT (competition_id, season_id, team_id) DO UPDATE
        SET position = EXCLUDED.position;
      `, [compId, seasonId, teamId, pos]);

      pos++;
      totalTeamsIngested++;
    }

    console.log(`Ingested ${item.teams.length} teams for ${item.country} (${item.compName}).`);
  }

  console.log(`Total authentic teams ingested: ${totalTeamsIngested} across 7 countries and 7 leagues.`);

  // 7. Ensure Admin User
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

  console.log("Countries, leagues, and teams ingestion completed successfully!");
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
