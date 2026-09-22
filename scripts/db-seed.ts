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

export async function seedInitialData(pool: pg.Pool) {
  console.log("Starting database initialization and static data cleanup...");

  // 1. Purge any static / synthetic data from previous seeds
  console.log("Purging all static matches, predictions, form features, standings, and teams...");
  await pool.query(`
    DELETE FROM football_prediction_outputs;
    DELETE FROM football_match_prediction_features;
    DELETE FROM football_team_form_features;
    DELETE FROM football_standings;
    DELETE FROM matches;
    DELETE FROM teams;
    DELETE FROM provider_mappings WHERE entity_type IN ('team', 'match');
  `);
  console.log("All static match, team, and prediction rows successfully purged.");

  // 2. Ensure Canonical Sport: Football
  const sportRes = await pool.query(`
    INSERT INTO sports (slug, name)
    VALUES ('football', 'Football')
    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
    RETURNING id;
  `);
  const sportId = sportRes.rows[0].id;
  console.log(`Sport 'football' ready: ${sportId}`);

  // 3. Ensure Canonical Countries
  const countryDefs = [
    { code: "TR", slug: "turkey", name: "Turkey", providerId: "111" },
    { code: "GB", slug: "england", name: "England", providerId: "44" },
    { code: "ES", slug: "spain", name: "Spain", providerId: "6" },
    { code: "IT", slug: "italy", name: "Italy", providerId: "5" },
    { code: "DE", slug: "germany", name: "Germany", providerId: "4" },
    { code: "FR", slug: "france", name: "France", providerId: "3" },
    { code: "NL", slug: "netherlands", name: "Netherlands", providerId: "82" }
  ];

  const countryMap = new Map<string, string>();
  for (const c of countryDefs) {
    const res = await pool.query(`
      INSERT INTO countries (code, slug, name)
      VALUES ($1, $2, $3)
      ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, slug = EXCLUDED.slug
      RETURNING id;
    `, [c.code, c.slug, c.name]);
    const cid = res.rows[0].id;
    countryMap.set(c.code, cid);

    await pool.query(`
      INSERT INTO provider_mappings (provider, entity_type, provider_entity_id, internal_entity_id, internal_entity_type)
      VALUES ('apifootball-com', 'country', $1, $2, 'country')
      ON CONFLICT (provider, entity_type, provider_entity_id) DO UPDATE SET internal_entity_id = EXCLUDED.internal_entity_id;
    `, [c.providerId, cid]);
  }
  console.log("Canonical countries & provider mappings ready.");

  // 4. Ensure Canonical Competitions (Target leagues for live ingestion)
  const compDefs = [
    { countryCode: "TR", slug: "super-lig", name: "Süper Lig", providerId: "322" },
    { countryCode: "GB", slug: "premier-league", name: "Premier League", providerId: "152" },
    { countryCode: "ES", slug: "la-liga", name: "La Liga", providerId: "302" },
    { countryCode: "IT", slug: "serie-a", name: "Serie A", providerId: "207" },
    { countryCode: "DE", slug: "bundesliga", name: "Bundesliga", providerId: "175" },
    { countryCode: "FR", slug: "ligue-1", name: "Ligue 1", providerId: "168" },
    { countryCode: "NL", slug: "eredivisie", name: "Eredivisie", providerId: "244" }
  ];

  for (const comp of compDefs) {
    const countryId = countryMap.get(comp.countryCode);
    const res = await pool.query(`
      INSERT INTO competitions (sport_id, country_id, slug, name, gender, level)
      VALUES ($1, $2, $3, $4, 'men', 'tier_1')
      ON CONFLICT (sport_id, slug) DO UPDATE SET name = EXCLUDED.name
      RETURNING id;
    `, [sportId, countryId, comp.slug, comp.name]);
    const compId = res.rows[0].id;

    await pool.query(`
      INSERT INTO provider_mappings (provider, entity_type, provider_entity_id, internal_entity_id, internal_entity_type)
      VALUES ('apifootball-com', 'competition', $1, $2, 'competition')
      ON CONFLICT (provider, entity_type, provider_entity_id) DO UPDATE SET internal_entity_id = EXCLUDED.internal_entity_id;
    `, [comp.providerId, compId]);

    // Ensure Season 2025/2026 container
    await pool.query(`
      INSERT INTO seasons (competition_id, name, is_current, start_date, end_date)
      VALUES ($1, '2025/2026', true, '2025-08-01', '2026-05-31')
      ON CONFLICT (competition_id, name) DO UPDATE SET is_current = true;
    `, [compId]);
  }
  console.log("Canonical competitions & seasons ready (zero dummy matches/teams).");

  // 5. Ensure Admin User
  const adminEmail = (process.env.ADMIN_EMAIL || "admin@skoriq.local").trim().toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD || "AdminPassword123!";
  const passwordHash = await hashPassword(adminPassword);

  await pool.query(`
    INSERT INTO users (email, first_name, last_name, phone_number, password_hash, role, status)
    VALUES ($1, 'SkorIQ', 'Admin', '+905550000000', $2, 'admin', 'active')
    ON CONFLICT (email) DO UPDATE
    SET role = 'admin', status = 'active', password_hash = EXCLUDED.password_hash, updated_at = now();
  `, [adminEmail, passwordHash]);
  console.log(`Admin user ensured: ${adminEmail} (role: admin)`);

  console.log("Database successfully cleaned of all static/synthetic data.");
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
