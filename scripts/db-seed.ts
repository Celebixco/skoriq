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

interface TeamStatsPayload {
  is_home: boolean;
  possession_percent?: number | null;
  shots_total?: number | null;
  shots_on_target?: number | null;
  shots_off_target?: number | null;
  blocked_shots?: number | null;
  corners?: number | null;
  fouls?: number | null;
  yellow_cards?: number | null;
  red_cards?: number | null;
  offsides?: number | null;
  goalkeeper_saves?: number | null;
  passes?: number | null;
  accurate_passes?: number | null;
  big_chances?: number | null;
  big_chances_missed?: number | null;
  expected_goals?: number | null;
  tackles?: number | null;
  interceptions?: number | null;
  clearances?: number | null;
  hit_woodwork?: number | null;
  average_rating?: number | null;
  distance_covered?: string | null;
  number_of_sprints?: number | null;
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
  statistics?: {
    home: TeamStatsPayload;
    away: TeamStatsPayload;
    raw_items?: Record<string, unknown>;
  };
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
  season_statistics?: Record<string, unknown>;
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
  console.log("STARTING SOFASCORE ADVANCED DATA & TELEMETRY INGESTION");
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
    TRUNCATE TABLE football_match_team_statistics, football_match_scores, football_standings, matches, teams CASCADE;
    DELETE FROM provider_mappings WHERE entity_type IN ('team', 'match', 'competition', 'country', 'standing', 'football_match_team_statistics');
  `);
  console.log("Cleaned teams, matches, standings, and telemetry statistics.");

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

  // Helper to ensure country safely handling both slug and code uniqueness
  async function getOrCreateCountry(name: string, code: string, slug: string): Promise<string> {
    const cleanSlug = slugify(slug || name);
    if (countryIdCache.has(cleanSlug)) {
      return countryIdCache.get(cleanSlug)!;
    }

    const cleanCode = (code || cleanSlug.substring(0, 3)).toUpperCase();

    // Check by slug or code
    const existing = await pool.query(`
      SELECT id FROM countries WHERE slug = $1 OR (code = $2 AND code IS NOT NULL) LIMIT 1;
    `, [cleanSlug, cleanCode]);

    let countryId: string;
    if (existing.rows.length > 0) {
      countryId = existing.rows[0].id;
      await pool.query(`UPDATE countries SET name = $1 WHERE id = $2;`, [name, countryId]);
    } else {
      const res = await pool.query(`
        INSERT INTO countries (code, slug, name)
        VALUES ($1, $2, $3)
        RETURNING id;
      `, [cleanCode, cleanSlug, name]);
      countryId = res.rows[0].id;
    }

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
  let totalStatsIngested = 0;
  let totalPlayersIngested = 0;

  const existingPlayersCountRes = await pool.query('SELECT count(*) FROM players');
  const existingPlayersCount = parseInt(existingPlayersCountRes.rows[0]?.count || '0', 10);
  const forceSeed = process.env.FORCE_SEED === 'true';

  if (existingPlayersCount >= 500 && !forceSeed) {
    console.log(`Initial seed already applied (${existingPlayersCount} players found). Skipping seed. Use FORCE_SEED=true to override.`);
    return;
  }

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

    // 7. Ingest Teams, Standings, and Seasonal Telemetry for this League
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
          teamColors: team.team_colors,
          seasonStatistics: team.season_statistics || {}
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

      // 8. Insert Standing Row using explicit ON CONSTRAINT
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
        ON CONFLICT ON CONSTRAINT "football_standings_competition_season_team_uidx" DO UPDATE SET
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

      // 8a. Ingest Squad Players for Team
      if (team.players && Array.isArray(team.players)) {
        for (const p of team.players) {
          try {
            const playerCountryId = p.country_name ? await getOrCreateCountry(p.country_name, p.country_code, p.country_code?.toLowerCase() || p.slug) : teamCountryId;
            const playerSlug = `${slugify(p.name)}-${p.sofascore_id}`;
            const dob = p.date_of_birth_timestamp ? new Date(p.date_of_birth_timestamp * 1000).toISOString().split("T")[0] : null;

            const playerRes = await pool.query(`
              INSERT INTO players (
                sport_id, country_id, current_team_id, name, short_name, slug,
                position, jersey_number, height_cm, photo_url, date_of_birth, metadata_json
              )
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
              ON CONFLICT (id) DO UPDATE SET
                current_team_id = EXCLUDED.current_team_id,
                position = EXCLUDED.position,
                jersey_number = EXCLUDED.jersey_number,
                photo_url = EXCLUDED.photo_url
              RETURNING id;
            `, [
              sportId,
              playerCountryId,
              teamId,
              p.name,
              p.short_name,
              playerSlug,
              p.position || null,
              p.jersey_number || null,
              p.height || null,
              p.photo_url || null,
              dob,
              JSON.stringify({
                sofascoreId: p.sofascore_id,
                marketValue: p.proposed_market_value,
                preferredFoot: p.preferred_foot
              })
            ]);

            const pid = playerRes.rows[0]?.id;
            if (pid) {
              await pool.query(`
                INSERT INTO football_player_team_memberships (
                  player_id, team_id, competition_id, season_id, position, shirt_number, active
                )
                VALUES ($1, $2, $3, $4, $5, $6, true)
                ON CONFLICT DO NOTHING;
              `, [pid, teamId, compId, seasonId, p.position || null, p.jersey_number || null]);
              totalPlayersIngested++;
            }
          } catch (playerErr) {
            // Ignore duplicate/parse error for single player
          }
        }
      }

      // 8b. Ingest Team Recent Matches
      if (team.recent_matches && Array.isArray(team.recent_matches)) {
        for (const rm of team.recent_matches) {
          try {
            let hTeamId = teamIdCache.get(rm.home_team_id);
            let aTeamId = teamIdCache.get(rm.away_team_id);

            if (!hTeamId) {
              const hRes = await pool.query(`
                INSERT INTO teams (sport_id, name, short_name, slug, type, gender, logo_url, metadata_json)
                VALUES ($1, $2, $2, $3, 'club', 'men', $4, '{}')
                ON CONFLICT (sport_id, slug) DO UPDATE SET name = EXCLUDED.name RETURNING id;
              `, [sportId, rm.home_team_name, `${slugify(rm.home_team_name)}-${rm.home_team_id}`, rm.home_team_logo]);
              hTeamId = hRes.rows[0]?.id;
              if (hTeamId) teamIdCache.set(rm.home_team_id, hTeamId);
            }

            if (!aTeamId) {
              const aRes = await pool.query(`
                INSERT INTO teams (sport_id, name, short_name, slug, type, gender, logo_url, metadata_json)
                VALUES ($1, $2, $2, $3, 'club', 'men', $4, '{}')
                ON CONFLICT (sport_id, slug) DO UPDATE SET name = EXCLUDED.name RETURNING id;
              `, [sportId, rm.away_team_name, `${slugify(rm.away_team_name)}-${rm.away_team_id}`, rm.away_team_logo]);
              aTeamId = aRes.rows[0]?.id;
              if (aTeamId) teamIdCache.set(rm.away_team_id, aTeamId);
            }

            if (hTeamId && aTeamId && rm.start_timestamp) {
              let winId: string | null = null;
              if (typeof rm.home_score === "number" && typeof rm.away_score === "number") {
                if (rm.home_score > rm.away_score) winId = hTeamId;
                else if (rm.away_score > rm.home_score) winId = aTeamId;
              }
              const matchDate = new Date(rm.start_timestamp * 1000);
              const mMeta = { sofascoreId: rm.sofascore_id, statistics: rm.statistics || null };

              const mRes = await pool.query(`
                INSERT INTO matches (
                  sport_id, competition_id, season_id, home_team_id, away_team_id,
                  scheduled_start_at, status, winner_team_id, metadata_json
                )
                VALUES ($1, $2, $3, $4, $5, $6, 'finished', $7, $8)
                ON CONFLICT ON CONSTRAINT "matches_natural_uidx" DO UPDATE SET
                  status = 'finished',
                  winner_team_id = EXCLUDED.winner_team_id,
                  metadata_json = EXCLUDED.metadata_json
                RETURNING id;
              `, [sportId, compId, seasonId, hTeamId, aTeamId, matchDate, winId, JSON.stringify(mMeta)]);

              const mId = mRes.rows[0]?.id;
              if (mId && typeof rm.home_score === "number" && typeof rm.away_score === "number") {
                await pool.query(`
                  INSERT INTO football_match_scores (
                    match_id, home_team_id, away_team_id, winner_team_id,
                    home_score_current, away_score_current, home_score_fulltime, away_score_fulltime,
                    home_score_halftime, away_score_halftime, status
                  )
                  VALUES ($1, $2, $3, $4, $5, $6, $5, $6, $7, $8, 'finished')
                  ON CONFLICT (match_id) DO UPDATE SET
                    home_score_current = EXCLUDED.home_score_current,
                    away_score_current = EXCLUDED.away_score_current,
                    home_score_fulltime = EXCLUDED.home_score_fulltime,
                    away_score_fulltime = EXCLUDED.away_score_fulltime,
                    home_score_halftime = EXCLUDED.home_score_halftime,
                    away_score_halftime = EXCLUDED.away_score_halftime,
                    winner_team_id = EXCLUDED.winner_team_id;
                `, [mId, hTeamId, aTeamId, winId, rm.home_score, rm.away_score, rm.home_score_halftime ?? null, rm.away_score_halftime ?? null]);

                if (rm.statistics) {
                  await insertTeamStats(pool, mId, hTeamId, aTeamId, rm.statistics.home);
                  await insertTeamStats(pool, mId, aTeamId, hTeamId, rm.statistics.away);
                  totalStatsIngested += 2;
                }
                totalMatchesIngested++;
              }
            }
          } catch (rmErr) {
            // Ignore single match error
          }
        }
      }
    }

    // 9. Ingest Recent Finished Matches & Detailed Telemetry Statistics
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
          round: m.round,
          statistics: m.statistics || null
        };

        const scheduledDate = new Date(m.scheduled_start_at * 1000);

        try {
          const matchRes = await pool.query(`
            INSERT INTO matches (
              sport_id, competition_id, season_id, round, home_team_id, away_team_id,
              scheduled_start_at, status, venue, winner_team_id, metadata_json
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'finished', $8, $9, $10)
            ON CONFLICT ON CONSTRAINT "matches_natural_uidx"
            DO UPDATE SET
              status = 'finished',
              winner_team_id = EXCLUDED.winner_team_id,
              metadata_json = EXCLUDED.metadata_json
            RETURNING id;
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

          const matchId = matchRes.rows[0]?.id;
          totalMatchesIngested++;

          // 9a. Insert into football_match_scores
          if (matchId && typeof m.home_score === "number" && typeof m.away_score === "number") {
            await pool.query(`
              INSERT INTO football_match_scores (
                match_id, home_team_id, away_team_id, winner_team_id,
                home_score_current, away_score_current,
                home_score_fulltime, away_score_fulltime,
                status
              )
              VALUES ($1, $2, $3, $4, $5, $6, $5, $6, 'finished')
              ON CONFLICT (match_id) DO UPDATE SET
                home_score_current = EXCLUDED.home_score_current,
                away_score_current = EXCLUDED.away_score_current,
                home_score_fulltime = EXCLUDED.home_score_fulltime,
                away_score_fulltime = EXCLUDED.away_score_fulltime,
                winner_team_id = EXCLUDED.winner_team_id,
                status = EXCLUDED.status;
            `, [matchId, homeTeamId, awayTeamId, winnerTeamId, m.home_score, m.away_score]);
          }

          // 9b. Insert Home and Away Team Match Statistics into football_match_team_statistics
          if (matchId && m.statistics) {
            const stats = m.statistics;

            // Helper to insert one team's stats
            const insertTeamStats = async (tId: string, oppId: string, s: TeamStatsPayload) => {
              const passAccuracy = (s.passes && s.accurate_passes)
                ? Number(((s.accurate_passes / s.passes) * 100).toFixed(2))
                : null;

              const extraMeta = {
                averageRating: s.average_rating,
                distanceCovered: s.distance_covered,
                numberOfSprints: s.number_of_sprints,
                raw: stats.raw_items
              };

              await pool.query(`
                INSERT INTO football_match_team_statistics (
                  match_id, team_id, opponent_team_id, is_home,
                  possession_percent, shots_total, shots_on_target, shots_off_target, blocked_shots,
                  corners, fouls, yellow_cards, red_cards, offsides, goalkeeper_saves,
                  passes, accurate_passes, pass_accuracy_percent,
                  big_chances, big_chances_missed, expected_goals,
                  tackles, interceptions, clearances, hit_woodwork,
                  metadata_json
                )
                VALUES (
                  $1, $2, $3, $4,
                  $5, $6, $7, $8, $9,
                  $10, $11, $12, $13, $14, $15,
                  $16, $17, $18,
                  $19, $20, $21,
                  $22, $23, $24, $25,
                  $26
                )
                ON CONFLICT (match_id, team_id) DO UPDATE SET
                  possession_percent = EXCLUDED.possession_percent,
                  shots_total = EXCLUDED.shots_total,
                  shots_on_target = EXCLUDED.shots_on_target,
                  shots_off_target = EXCLUDED.shots_off_target,
                  blocked_shots = EXCLUDED.blocked_shots,
                  corners = EXCLUDED.corners,
                  fouls = EXCLUDED.fouls,
                  yellow_cards = EXCLUDED.yellow_cards,
                  red_cards = EXCLUDED.red_cards,
                  offsides = EXCLUDED.offsides,
                  goalkeeper_saves = EXCLUDED.goalkeeper_saves,
                  passes = EXCLUDED.passes,
                  accurate_passes = EXCLUDED.accurate_passes,
                  pass_accuracy_percent = EXCLUDED.pass_accuracy_percent,
                  big_chances = EXCLUDED.big_chances,
                  big_chances_missed = EXCLUDED.big_chances_missed,
                  expected_goals = EXCLUDED.expected_goals,
                  tackles = EXCLUDED.tackles,
                  interceptions = EXCLUDED.interceptions,
                  clearances = EXCLUDED.clearances,
                  hit_woodwork = EXCLUDED.hit_woodwork,
                  metadata_json = EXCLUDED.metadata_json;
              `, [
                matchId,
                tId,
                oppId,
                s.is_home,
                s.possession_percent ?? null,
                s.shots_total ?? null,
                s.shots_on_target ?? null,
                s.shots_off_target ?? null,
                s.blocked_shots ?? null,
                s.corners ?? null,
                s.fouls ?? null,
                s.yellow_cards ?? null,
                s.red_cards ?? null,
                s.offsides ?? null,
                s.goalkeeper_saves ?? null,
                s.passes ?? null,
                s.accurate_passes ?? null,
                passAccuracy,
                s.big_chances ?? null,
                s.big_chances_missed ?? null,
                s.expected_goals ?? null,
                s.tackles ?? null,
                s.interceptions ?? null,
                s.clearances ?? null,
                s.hit_woodwork ?? null,
                JSON.stringify(extraMeta)
              ]);
            };

            if (stats.home) {
              await insertTeamStats(homeTeamId, awayTeamId, stats.home);
              totalStatsIngested++;
            }
            if (stats.away) {
              await insertTeamStats(awayTeamId, homeTeamId, stats.away);
              totalStatsIngested++;
            }
          }
        } catch (matchErr) {
          console.warn(`  Warning inserting finished match ${m.home_team_name} vs ${m.away_team_name}:`, matchErr);
        }
      }
    }

    // 10. Ingest Upcoming Fixtures using explicit ON CONSTRAINT
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

        try {
          await pool.query(`
            INSERT INTO matches (
              sport_id, competition_id, season_id, round, home_team_id, away_team_id,
              scheduled_start_at, status, venue, metadata_json
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'scheduled', $8, $9)
            ON CONFLICT ON CONSTRAINT "matches_natural_uidx"
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
        } catch (matchErr) {
          console.warn(`  Warning inserting scheduled match ${m.home_team_name} vs ${m.away_team_name}:`, matchErr);
        }
      }
    }

    console.log(`[INGESTED] ${league.country}: ${league.league_name} (${league.teams.length} teams, ${league.recent_matches?.length || 0} finished, ${league.upcoming_matches?.length || 0} upcoming)`);
  }

  // 10. Generate and Populate Football Team Form Features
  await generateTeamFormFeatures(pool);

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
  console.log(`  Total Matches Ingested: ${totalMatchesIngested}`);
  console.log(`  Total Team Match Telemetry Statistics Rows Ingested: ${totalStatsIngested}`);
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
