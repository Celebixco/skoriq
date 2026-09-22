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
  console.log("Starting initial database seed...");

  // 1. Ensure Sport: Football
  const sportRes = await pool.query(`
    INSERT INTO sports (slug, name)
    VALUES ('football', 'Football')
    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
    RETURNING id;
  `);
  const sportId = sportRes.rows[0].id;
  console.log(`Sport 'football' ready: ${sportId}`);

  // 2. Ensure Countries
  const countryDefs = [
    { code: "TR", slug: "turkey", name: "Turkey", providerId: "111" },
    { code: "GB", slug: "england", name: "England", providerId: "44" },
    { code: "ES", slug: "spain", name: "Spain", providerId: "6" },
    { code: "IT", slug: "italy", name: "Italy", providerId: "5" },
    { code: "DE", slug: "germany", name: "Germany", providerId: "4" }
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
  console.log("Countries & provider mappings ready.");

  // 3. Ensure Competitions
  const compDefs = [
    { countryCode: "TR", slug: "super-lig", name: "Süper Lig", providerId: "322" },
    { countryCode: "GB", slug: "premier-league", name: "Premier League", providerId: "152" },
    { countryCode: "ES", slug: "la-liga", name: "La Liga", providerId: "302" },
    { countryCode: "IT", slug: "serie-a", name: "Serie A", providerId: "207" },
    { countryCode: "DE", slug: "bundesliga", name: "Bundesliga", providerId: "175" }
  ];

  const compMap = new Map<string, string>();
  const seasonMap = new Map<string, string>();

  for (const comp of compDefs) {
    const countryId = countryMap.get(comp.countryCode);
    const res = await pool.query(`
      INSERT INTO competitions (sport_id, country_id, slug, name, gender, level)
      VALUES ($1, $2, $3, $4, 'men', 'tier_1')
      ON CONFLICT (sport_id, slug) DO UPDATE SET name = EXCLUDED.name
      RETURNING id;
    `, [sportId, countryId, comp.slug, comp.name]);
    const compId = res.rows[0].id;
    compMap.set(comp.slug, compId);

    await pool.query(`
      INSERT INTO provider_mappings (provider, entity_type, provider_entity_id, internal_entity_id, internal_entity_type)
      VALUES ('apifootball-com', 'competition', $1, $2, 'competition')
      ON CONFLICT (provider, entity_type, provider_entity_id) DO UPDATE SET internal_entity_id = EXCLUDED.internal_entity_id;
    `, [comp.providerId, compId]);

    // Ensure Season 2025/2026
    const sRes = await pool.query(`
      INSERT INTO seasons (competition_id, name, is_current, start_date, end_date)
      VALUES ($1, '2025/2026', true, '2025-08-01', '2026-05-31')
      ON CONFLICT (competition_id, name) DO UPDATE SET is_current = true
      RETURNING id;
    `, [compId]);
    seasonMap.set(comp.slug, sRes.rows[0].id);
  }
  console.log("Competitions & seasons ready.");

  // 4. Ensure Teams
  interface TeamDef {
    compSlug: string;
    countryCode: string;
    name: string;
    slug: string;
    shortName: string;
    venueName: string;
    logoUrl: string;
    providerTeamId: string;
  }

  const teamDefs: TeamDef[] = [
    // Süper Lig
    { compSlug: "super-lig", countryCode: "TR", name: "Galatasaray", slug: "galatasaray", shortName: "GS", venueName: "RAMS Park", logoUrl: "https://media.api-sports.io/football/teams/998.png", providerTeamId: "998" },
    { compSlug: "super-lig", countryCode: "TR", name: "Fenerbahçe", slug: "fenerbahce", shortName: "FB", venueName: "Şükrü Saracoğlu", logoUrl: "https://media.api-sports.io/football/teams/611.png", providerTeamId: "611" },
    { compSlug: "super-lig", countryCode: "TR", name: "Beşiktaş", slug: "besiktas", shortName: "BJK", venueName: "Tüpraş Stadyumu", logoUrl: "https://media.api-sports.io/football/teams/549.png", providerTeamId: "549" },
    { compSlug: "super-lig", countryCode: "TR", name: "Trabzonspor", slug: "trabzonspor", shortName: "TS", venueName: "Papara Park", logoUrl: "https://media.api-sports.io/football/teams/607.png", providerTeamId: "607" },
    { compSlug: "super-lig", countryCode: "TR", name: "Başakşehir", slug: "basaksehir", shortName: "IBFK", venueName: "Başakşehir Fatih Terim", logoUrl: "https://media.api-sports.io/football/teams/564.png", providerTeamId: "564" },
    { compSlug: "super-lig", countryCode: "TR", name: "Samsunspor", slug: "samsunspor", shortName: "SAM", venueName: "Samsun 19 Mayıs", logoUrl: "https://media.api-sports.io/football/teams/3573.png", providerTeamId: "3573" },

    // Premier League
    { compSlug: "premier-league", countryCode: "GB", name: "Arsenal", slug: "arsenal", shortName: "ARS", venueName: "Emirates Stadium", logoUrl: "https://media.api-sports.io/football/teams/42.png", providerTeamId: "42" },
    { compSlug: "premier-league", countryCode: "GB", name: "Manchester City", slug: "manchester-city", shortName: "MCI", venueName: "Etihad Stadium", logoUrl: "https://media.api-sports.io/football/teams/50.png", providerTeamId: "50" },
    { compSlug: "premier-league", countryCode: "GB", name: "Liverpool", slug: "liverpool", shortName: "LIV", venueName: "Anfield", logoUrl: "https://media.api-sports.io/football/teams/40.png", providerTeamId: "40" },
    { compSlug: "premier-league", countryCode: "GB", name: "Chelsea", slug: "chelsea", shortName: "CHE", venueName: "Stamford Bridge", logoUrl: "https://media.api-sports.io/football/teams/49.png", providerTeamId: "49" },
    { compSlug: "premier-league", countryCode: "GB", name: "Aston Villa", slug: "aston-villa", shortName: "AVL", venueName: "Villa Park", logoUrl: "https://media.api-sports.io/football/teams/66.png", providerTeamId: "66" },
    { compSlug: "premier-league", countryCode: "GB", name: "Tottenham Hotspur", slug: "tottenham", shortName: "TOT", venueName: "Tottenham Hotspur Stadium", logoUrl: "https://media.api-sports.io/football/teams/47.png", providerTeamId: "47" },

    // La Liga
    { compSlug: "la-liga", countryCode: "ES", name: "Real Madrid", slug: "real-madrid", shortName: "RMA", venueName: "Santiago Bernabéu", logoUrl: "https://media.api-sports.io/football/teams/541.png", providerTeamId: "541" },
    { compSlug: "la-liga", countryCode: "ES", name: "Barcelona", slug: "barcelona", shortName: "BAR", venueName: "Camp Nou", logoUrl: "https://media.api-sports.io/football/teams/529.png", providerTeamId: "529" },
    { compSlug: "la-liga", countryCode: "ES", name: "Atletico Madrid", slug: "atletico-madrid", shortName: "ATM", venueName: "Civitas Metropolitano", logoUrl: "https://media.api-sports.io/football/teams/530.png", providerTeamId: "530" },
    { compSlug: "la-liga", countryCode: "ES", name: "Athletic Club", slug: "athletic-bilbao", shortName: "ATH", venueName: "San Mamés", logoUrl: "https://media.api-sports.io/football/teams/531.png", providerTeamId: "531" },

    // Serie A
    { compSlug: "serie-a", countryCode: "IT", name: "Inter", slug: "inter-milan", shortName: "INT", venueName: "San Siro", logoUrl: "https://media.api-sports.io/football/teams/505.png", providerTeamId: "505" },
    { compSlug: "serie-a", countryCode: "IT", name: "Juventus", slug: "juventus", shortName: "JUV", venueName: "Allianz Stadium", logoUrl: "https://media.api-sports.io/football/teams/496.png", providerTeamId: "496" },
    { compSlug: "serie-a", countryCode: "IT", name: "AC Milan", slug: "ac-milan", shortName: "MIL", venueName: "San Siro", logoUrl: "https://media.api-sports.io/football/teams/489.png", providerTeamId: "489" },
    { compSlug: "serie-a", countryCode: "IT", name: "Napoli", slug: "napoli", shortName: "NAP", venueName: "Diego Armando Maradona", logoUrl: "https://media.api-sports.io/football/teams/492.png", providerTeamId: "492" },

    // Bundesliga
    { compSlug: "bundesliga", countryCode: "DE", name: "Bayern München", slug: "bayern-munich", shortName: "BAY", venueName: "Allianz Arena", logoUrl: "https://media.api-sports.io/football/teams/157.png", providerTeamId: "157" },
    { compSlug: "bundesliga", countryCode: "DE", name: "Bayer Leverkusen", slug: "bayer-leverkusen", shortName: "B04", venueName: "BayArena", logoUrl: "https://media.api-sports.io/football/teams/168.png", providerTeamId: "168" },
    { compSlug: "bundesliga", countryCode: "DE", name: "Borussia Dortmund", slug: "borussia-dortmund", shortName: "BVB", venueName: "Signal Iduna Park", logoUrl: "https://media.api-sports.io/football/teams/165.png", providerTeamId: "165" },
    { compSlug: "bundesliga", countryCode: "DE", name: "RB Leipzig", slug: "rb-leipzig", shortName: "RBL", venueName: "Red Bull Arena", logoUrl: "https://media.api-sports.io/football/teams/173.png", providerTeamId: "173" }
  ];

  const teamMap = new Map<string, string>();
  for (const t of teamDefs) {
    const countryId = countryMap.get(t.countryCode);
    const res = await pool.query(`
      INSERT INTO teams (sport_id, country_id, name, slug, short_name, venue_name, logo_url)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (sport_id, slug) DO UPDATE
      SET name = EXCLUDED.name, short_name = EXCLUDED.short_name, venue_name = EXCLUDED.venue_name, logo_url = EXCLUDED.logo_url
      RETURNING id;
    `, [sportId, countryId, t.name, t.slug, t.shortName, t.venueName, t.logoUrl]);
    const tid = res.rows[0].id;
    teamMap.set(t.slug, tid);

    await pool.query(`
      INSERT INTO provider_mappings (provider, entity_type, provider_entity_id, internal_entity_id, internal_entity_type)
      VALUES ('apifootball-com', 'team', $1, $2, 'team')
      ON CONFLICT (provider, entity_type, provider_entity_id) DO UPDATE SET internal_entity_id = EXCLUDED.internal_entity_id;
    `, [t.providerTeamId, tid]);
  }
  console.log("Teams & provider mappings ready.");

  // 5. Ensure Standings for each competition
  const standingsRows = [
    // Süper Lig
    { compSlug: "super-lig", teamSlug: "galatasaray", pos: 1, p: 26, w: 22, d: 3, l: 1, gf: 68, ga: 22, pts: 69, form: "WWWDW" },
    { compSlug: "super-lig", teamSlug: "fenerbahce", pos: 2, p: 26, w: 20, d: 4, l: 2, gf: 64, ga: 24, pts: 64, form: "WWWWD" },
    { compSlug: "super-lig", teamSlug: "samsunspor", pos: 3, p: 26, w: 15, d: 5, l: 6, gf: 44, ga: 28, pts: 50, form: "DWWLW" },
    { compSlug: "super-lig", teamSlug: "besiktas", pos: 4, p: 26, w: 13, d: 8, l: 5, gf: 43, ga: 27, pts: 47, form: "LDWWD" },
    { compSlug: "super-lig", teamSlug: "basaksehir", pos: 5, p: 26, w: 12, d: 6, l: 8, gf: 46, ga: 35, pts: 42, form: "WLDWW" },
    { compSlug: "super-lig", teamSlug: "trabzonspor", pos: 6, p: 26, w: 10, d: 9, l: 7, gf: 40, ga: 32, pts: 39, form: "DWLDD" },

    // Premier League
    { compSlug: "premier-league", teamSlug: "liverpool", pos: 1, p: 28, w: 20, d: 6, l: 2, gf: 66, ga: 26, pts: 66, form: "WWWDW" },
    { compSlug: "premier-league", teamSlug: "arsenal", pos: 2, p: 28, w: 18, d: 7, l: 3, gf: 58, ga: 22, pts: 61, form: "WDWWW" },
    { compSlug: "premier-league", teamSlug: "manchester-city", pos: 3, p: 28, w: 17, d: 5, l: 6, gf: 60, ga: 34, pts: 56, form: "LWWWD" },
    { compSlug: "premier-league", teamSlug: "chelsea", pos: 4, p: 28, w: 15, d: 7, l: 6, gf: 52, ga: 36, pts: 52, form: "DWWLD" },
    { compSlug: "premier-league", teamSlug: "aston-villa", pos: 5, p: 28, w: 14, d: 6, l: 8, gf: 48, ga: 40, pts: 48, form: "WLDWW" },
    { compSlug: "premier-league", teamSlug: "tottenham", pos: 6, p: 28, w: 11, d: 4, l: 13, gf: 53, ga: 45, pts: 37, form: "LLWLD" }
  ];

  for (const s of standingsRows) {
    const compId = compMap.get(s.compSlug);
    const seasonId = seasonMap.get(s.compSlug);
    const teamId = teamMap.get(s.teamSlug);
    if (!compId || !seasonId || !teamId) continue;

    await pool.query(`
      INSERT INTO football_standings (
        competition_id, season_id, team_id, position, played, wins, draws, losses,
        goals_for, goals_against, goal_difference, points, form_string, status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'active')
      ON CONFLICT ON CONSTRAINT "football_standings_competition_season_team_uidx" DO UPDATE
      SET position = EXCLUDED.position, played = EXCLUDED.played, wins = EXCLUDED.wins,
          draws = EXCLUDED.draws, losses = EXCLUDED.losses, goals_for = EXCLUDED.goals_for,
          goals_against = EXCLUDED.goals_against, goal_difference = EXCLUDED.goal_difference,
          points = EXCLUDED.points, form_string = EXCLUDED.form_string;
    `, [compId, seasonId, teamId, s.pos, s.p, s.w, s.d, s.l, s.gf, s.ga, s.gf - s.ga, s.pts, s.form]);
  }
  console.log("Standings ready.");

  // 6. Historical Finished Matches (Past 4-6 weeks) for form & H2H computation
  interface MatchSeedDef {
    compSlug: string;
    homeTeamSlug: string;
    awayTeamSlug: string;
    round: string;
    dateOffsetDays: number;
    homeScore?: number;
    awayScore?: number;
    homeHt?: number;
    awayHt?: number;
    venue: string;
  }

  const matchSeeds: MatchSeedDef[] = [
    // Historical Süper Lig
    { compSlug: "super-lig", homeTeamSlug: "galatasaray", awayTeamSlug: "trabzonspor", round: "21", dateOffsetDays: -35, homeScore: 3, awayScore: 1, homeHt: 1, awayHt: 0, venue: "RAMS Park" },
    { compSlug: "super-lig", homeTeamSlug: "fenerbahce", awayTeamSlug: "basaksehir", round: "21", dateOffsetDays: -34, homeScore: 2, awayScore: 0, homeHt: 1, awayHt: 0, venue: "Şükrü Saracoğlu" },
    { compSlug: "super-lig", homeTeamSlug: "besiktas", awayTeamSlug: "samsunspor", round: "21", dateOffsetDays: -33, homeScore: 1, awayScore: 1, homeHt: 1, awayHt: 0, venue: "Tüpraş Stadyumu" },
    { compSlug: "super-lig", homeTeamSlug: "samsunspor", awayTeamSlug: "galatasaray", round: "22", dateOffsetDays: -28, homeScore: 0, awayScore: 2, homeHt: 0, awayHt: 1, venue: "Samsun 19 Mayıs" },
    { compSlug: "super-lig", homeTeamSlug: "trabzonspor", awayTeamSlug: "fenerbahce", round: "22", dateOffsetDays: -27, homeScore: 2, awayScore: 3, homeHt: 1, awayHt: 1, venue: "Papara Park" },
    { compSlug: "super-lig", homeTeamSlug: "basaksehir", awayTeamSlug: "besiktas", round: "22", dateOffsetDays: -26, homeScore: 1, awayScore: 2, homeHt: 0, awayHt: 1, venue: "Başakşehir Fatih Terim" },
    { compSlug: "super-lig", homeTeamSlug: "galatasaray", awayTeamSlug: "basaksehir", round: "23", dateOffsetDays: -21, homeScore: 2, awayScore: 1, homeHt: 0, awayHt: 0, venue: "RAMS Park" },
    { compSlug: "super-lig", homeTeamSlug: "fenerbahce", awayTeamSlug: "samsunspor", round: "23", dateOffsetDays: -20, homeScore: 3, awayScore: 1, homeHt: 2, awayHt: 1, venue: "Şükrü Saracoğlu" },
    { compSlug: "super-lig", homeTeamSlug: "besiktas", awayTeamSlug: "trabzonspor", round: "23", dateOffsetDays: -19, homeScore: 2, awayScore: 0, homeHt: 1, awayHt: 0, venue: "Tüpraş Stadyumu" },
    { compSlug: "super-lig", homeTeamSlug: "galatasaray", awayTeamSlug: "besiktas", round: "24", dateOffsetDays: -14, homeScore: 2, awayScore: 1, homeHt: 1, awayHt: 0, venue: "RAMS Park" },
    { compSlug: "super-lig", homeTeamSlug: "basaksehir", awayTeamSlug: "fenerbahce", round: "24", dateOffsetDays: -13, homeScore: 0, awayScore: 1, homeHt: 0, awayHt: 1, venue: "Başakşehir Fatih Terim" },
    { compSlug: "super-lig", homeTeamSlug: "trabzonspor", awayTeamSlug: "samsunspor", round: "24", dateOffsetDays: -12, homeScore: 1, awayScore: 1, homeHt: 0, awayHt: 1, venue: "Papara Park" },
    { compSlug: "super-lig", homeTeamSlug: "fenerbahce", awayTeamSlug: "galatasaray", round: "25", dateOffsetDays: -7, homeScore: 1, awayScore: 1, homeHt: 0, awayHt: 1, venue: "Şükrü Saracoğlu" },
    { compSlug: "super-lig", homeTeamSlug: "besiktas", awayTeamSlug: "basaksehir", round: "25", dateOffsetDays: -6, homeScore: 2, awayScore: 2, homeHt: 1, awayHt: 1, venue: "Tüpraş Stadyumu" },

    // Historical Premier League
    { compSlug: "premier-league", homeTeamSlug: "arsenal", awayTeamSlug: "chelsea", round: "24", dateOffsetDays: -28, homeScore: 2, awayScore: 1, homeHt: 1, awayHt: 0, venue: "Emirates Stadium" },
    { compSlug: "premier-league", homeTeamSlug: "liverpool", awayTeamSlug: "manchester-city", round: "24", dateOffsetDays: -27, homeScore: 2, awayScore: 0, homeHt: 1, awayHt: 0, venue: "Anfield" },
    { compSlug: "premier-league", homeTeamSlug: "aston-villa", awayTeamSlug: "tottenham", round: "24", dateOffsetDays: -26, homeScore: 2, awayScore: 1, homeHt: 1, awayHt: 1, venue: "Villa Park" },
    { compSlug: "premier-league", homeTeamSlug: "manchester-city", awayTeamSlug: "chelsea", round: "25", dateOffsetDays: -21, homeScore: 3, awayScore: 1, homeHt: 2, awayHt: 0, venue: "Etihad Stadium" },
    { compSlug: "premier-league", homeTeamSlug: "arsenal", awayTeamSlug: "aston-villa", round: "25", dateOffsetDays: -20, homeScore: 2, awayScore: 2, homeHt: 1, awayHt: 1, venue: "Emirates Stadium" },
    { compSlug: "premier-league", homeTeamSlug: "liverpool", awayTeamSlug: "tottenham", round: "25", dateOffsetDays: -19, homeScore: 4, awayScore: 2, homeHt: 2, awayHt: 1, venue: "Anfield" },
    { compSlug: "premier-league", homeTeamSlug: "chelsea", awayTeamSlug: "liverpool", round: "26", dateOffsetDays: -14, homeScore: 1, awayScore: 2, homeHt: 0, awayHt: 1, venue: "Stamford Bridge" },
    { compSlug: "premier-league", homeTeamSlug: "manchester-city", awayTeamSlug: "arsenal", round: "26", dateOffsetDays: -13, homeScore: 1, awayScore: 1, homeHt: 1, awayHt: 1, venue: "Etihad Stadium" },
    { compSlug: "premier-league", homeTeamSlug: "tottenham", awayTeamSlug: "chelsea", round: "27", dateOffsetDays: -7, homeScore: 1, awayScore: 2, homeHt: 1, awayHt: 0, venue: "Tottenham Hotspur Stadium" },
    { compSlug: "premier-league", homeTeamSlug: "liverpool", awayTeamSlug: "aston-villa", round: "27", dateOffsetDays: -6, homeScore: 2, awayScore: 0, homeHt: 1, awayHt: 0, venue: "Anfield" },

    // Upcoming Matches (Tomorrow, Day After, Weekend)
    { compSlug: "super-lig", homeTeamSlug: "galatasaray", awayTeamSlug: "fenerbahce", round: "26", dateOffsetDays: 1, venue: "RAMS Park" },
    { compSlug: "super-lig", homeTeamSlug: "besiktas", awayTeamSlug: "samsunspor", round: "26", dateOffsetDays: 2, venue: "Tüpraş Stadyumu" },
    { compSlug: "super-lig", homeTeamSlug: "trabzonspor", awayTeamSlug: "basaksehir", round: "26", dateOffsetDays: 3, venue: "Papara Park" },

    { compSlug: "premier-league", homeTeamSlug: "arsenal", awayTeamSlug: "manchester-city", round: "28", dateOffsetDays: 1, venue: "Emirates Stadium" },
    { compSlug: "premier-league", homeTeamSlug: "liverpool", awayTeamSlug: "chelsea", round: "28", dateOffsetDays: 2, venue: "Anfield" },
    { compSlug: "premier-league", homeTeamSlug: "aston-villa", awayTeamSlug: "tottenham", round: "28", dateOffsetDays: 3, venue: "Villa Park" },

    { compSlug: "la-liga", homeTeamSlug: "real-madrid", awayTeamSlug: "barcelona", round: "27", dateOffsetDays: 2, venue: "Santiago Bernabéu" },
    { compSlug: "la-liga", homeTeamSlug: "atletico-madrid", awayTeamSlug: "athletic-bilbao", round: "27", dateOffsetDays: 3, venue: "Civitas Metropolitano" },

    { compSlug: "serie-a", homeTeamSlug: "inter-milan", awayTeamSlug: "juventus", round: "27", dateOffsetDays: 2, venue: "San Siro" },
    { compSlug: "serie-a", homeTeamSlug: "ac-milan", awayTeamSlug: "napoli", round: "27", dateOffsetDays: 3, venue: "San Siro" },

    { compSlug: "bundesliga", homeTeamSlug: "bayern-munich", awayTeamSlug: "borussia-dortmund", round: "26", dateOffsetDays: 2, venue: "Allianz Arena" },
    { compSlug: "bundesliga", homeTeamSlug: "bayer-leverkusen", awayTeamSlug: "rb-leipzig", round: "26", dateOffsetDays: 3, venue: "BayArena" }
  ];

  const now = new Date();
  let matchesCreated = 0;

  for (const m of matchSeeds) {
    const compId = compMap.get(m.compSlug);
    const seasonId = seasonMap.get(m.compSlug);
    const homeTeamId = teamMap.get(m.homeTeamSlug);
    const awayTeamId = teamMap.get(m.awayTeamSlug);
    if (!compId || !seasonId || !homeTeamId || !awayTeamId) continue;

    const matchDate = new Date(now.getTime() + m.dateOffsetDays * 24 * 60 * 60 * 1000);
    matchDate.setMinutes(0, 0, 0);
    const isFinished = m.dateOffsetDays < 0;
    const status = isFinished ? "finished" : "scheduled";

    let winnerTeamId: string | null = null;
    if (isFinished && m.homeScore !== undefined && m.awayScore !== undefined) {
      if (m.homeScore > m.awayScore) winnerTeamId = homeTeamId;
      else if (m.awayScore > m.homeScore) winnerTeamId = awayTeamId;
    }

    const mRes = await pool.query(`
      INSERT INTO matches (
        sport_id, competition_id, season_id, round, home_team_id, away_team_id,
        scheduled_start_at, status, venue, winner_team_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT ON CONSTRAINT "matches_natural_uidx" DO UPDATE
      SET status = EXCLUDED.status, venue = EXCLUDED.venue, winner_team_id = EXCLUDED.winner_team_id
      RETURNING id;
    `, [sportId, compId, seasonId, m.round, homeTeamId, awayTeamId, matchDate, status, m.venue, winnerTeamId]);

    const matchId = mRes.rows[0].id;
    matchesCreated++;

    if (isFinished && m.homeScore !== undefined && m.awayScore !== undefined) {
      await pool.query(`
        INSERT INTO football_match_scores (
          match_id, home_team_id, away_team_id, winner_team_id,
          home_score_current, away_score_current, home_score_halftime, away_score_halftime,
          home_score_fulltime, away_score_fulltime, status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $5, $6, 'finished')
        ON CONFLICT (match_id) DO UPDATE
        SET home_score_fulltime = EXCLUDED.home_score_fulltime,
            away_score_fulltime = EXCLUDED.away_score_fulltime,
            winner_team_id = EXCLUDED.winner_team_id,
            status = 'finished';
      `, [matchId, homeTeamId, awayTeamId, winnerTeamId, m.homeScore, m.awayScore, m.homeHt ?? 0, m.awayHt ?? 0]);

      await pool.query(`
        INSERT INTO match_scores (match_id, period, home_score, away_score)
        VALUES ($1, 'fulltime', $2, $3)
        ON CONFLICT (match_id, period) DO UPDATE SET home_score = EXCLUDED.home_score, away_score = EXCLUDED.away_score;
      `, [matchId, m.homeScore, m.awayScore]);
    }
  }
  console.log(`Matches ready: ${matchesCreated} matches created/updated.`);

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
  console.log(`Admin user ensured: ${adminEmail} (role: admin)`);

  console.log("Initial database seed completed successfully!");
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
