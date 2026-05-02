import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import {
  logLevels,
  basketballPeriodTypes,
  basketballTeamFormScopes,
  footballPredictionConflictSeverities,
  footballPredictionConsistencyStatuses,
  footballPredictionFamilies,
  footballPredictionRiskLevels,
  footballPredictionSettlementStatuses,
  footballPredictionStatuses,
  footballTeamFormScopes,
  matchStatuses,
  providerEntityTypes,
  publicSuccessfulPredictionStatuses,
  rawPayloadStatuses,
  scorePeriods,
  syncJobStatuses
} from "@sports-data/shared";

export const matchStatusEnum = pgEnum("match_status", matchStatuses);
export const providerEntityTypeEnum = pgEnum("provider_entity_type", providerEntityTypes);
export const rawPayloadStatusEnum = pgEnum("raw_payload_status", rawPayloadStatuses);
export const syncJobStatusEnum = pgEnum("sync_job_status", syncJobStatuses);
export const logLevelEnum = pgEnum("log_level", logLevels);
export const scorePeriodEnum = pgEnum("score_period", scorePeriods);
export const basketballPeriodTypeEnum = pgEnum("basketball_period_type", basketballPeriodTypes);
export const footballTeamFormScopeEnum = pgEnum("football_team_form_scope", footballTeamFormScopes);
export const basketballTeamFormScopeEnum = pgEnum("basketball_team_form_scope", basketballTeamFormScopes);
export const footballPredictionFamilyEnum = pgEnum("football_prediction_family", footballPredictionFamilies);
export const footballPredictionRiskLevelEnum = pgEnum("football_prediction_risk_level", footballPredictionRiskLevels);
export const footballPredictionStatusEnum = pgEnum("football_prediction_status", footballPredictionStatuses);
export const footballPredictionConsistencyStatusEnum = pgEnum("football_prediction_consistency_status", footballPredictionConsistencyStatuses);
export const footballPredictionConflictSeverityEnum = pgEnum("football_prediction_conflict_severity", footballPredictionConflictSeverities);
export const footballPredictionSettlementStatusEnum = pgEnum("football_prediction_settlement_status", footballPredictionSettlementStatuses);
export const publicSuccessfulPredictionStatusEnum = pgEnum("public_successful_prediction_status", publicSuccessfulPredictionStatuses);

const id = uuid("id").primaryKey().defaultRandom();
const createdAt = timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const metadataJson = jsonb("metadata_json").$type<Record<string, unknown>>().notNull().default({});

export const sports = pgTable(
  "sports",
  {
    id,
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    createdAt,
    updatedAt
  },
  (table) => [uniqueIndex("sports_slug_uidx").on(table.slug)]
);

export const countries = pgTable(
  "countries",
  {
    id,
    code: text("code"),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    createdAt,
    updatedAt
  },
  (table) => [uniqueIndex("countries_code_uidx").on(table.code), uniqueIndex("countries_slug_uidx").on(table.slug)]
);

export const competitions = pgTable(
  "competitions",
  {
    id,
    sportId: uuid("sport_id").notNull().references(() => sports.id),
    countryId: uuid("country_id").references(() => countries.id),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    gender: text("gender"),
    level: text("level"),
    metadataJson,
    createdAt,
    updatedAt
  },
  (table) => [
    uniqueIndex("competitions_sport_slug_uidx").on(table.sportId, table.slug),
    index("competitions_country_idx").on(table.countryId)
  ]
);

export const seasons = pgTable(
  "seasons",
  {
    id,
    competitionId: uuid("competition_id").notNull().references(() => competitions.id),
    name: text("name").notNull(),
    startDate: date("start_date"),
    endDate: date("end_date"),
    isCurrent: boolean("is_current").notNull().default(false),
    createdAt,
    updatedAt
  },
  (table) => [uniqueIndex("seasons_competition_name_uidx").on(table.competitionId, table.name)]
);

export const users = pgTable(
  "users",
  {
    id,
    email: text("email").notNull(),
    firstName: text("first_name"),
    lastName: text("last_name"),
    phoneNumber: text("phone_number"),
    passwordHash: text("password_hash").notNull(),
    role: text("role").notNull().default("member"),
    status: text("status").notNull().default("active"),
    createdAt,
    updatedAt,
    lastLoginAt: timestamp("last_login_at", { withTimezone: true })
  },
  (table) => [
    uniqueIndex("users_email_uidx").on(table.email),
    index("users_status_idx").on(table.status),
    index("users_role_idx").on(table.role)
  ]
);

export const teams = pgTable(
  "teams",
  {
    id,
    sportId: uuid("sport_id").notNull().references(() => sports.id),
    countryId: uuid("country_id").references(() => countries.id),
    name: text("name").notNull(),
    shortName: text("short_name"),
    slug: text("slug").notNull(),
    gender: text("gender"),
    type: text("type"),
    logoUrl: text("logo_url"),
    venueName: text("venue_name"),
    foundedYear: integer("founded_year"),
    metadataJson,
    createdAt,
    updatedAt
  },
  (table) => [
    uniqueIndex("teams_sport_slug_uidx").on(table.sportId, table.slug),
    index("teams_country_idx").on(table.countryId)
  ]
);

export const players = pgTable(
  "players",
  {
    id,
    sportId: uuid("sport_id").notNull().references(() => sports.id),
    countryId: uuid("country_id").references(() => countries.id),
    currentTeamId: uuid("current_team_id").references(() => teams.id),
    name: text("name").notNull(),
    shortName: text("short_name"),
    slug: text("slug"),
    dateOfBirth: date("date_of_birth"),
    age: integer("age"),
    heightCm: integer("height_cm"),
    weightKg: integer("weight_kg"),
    preferredFoot: text("preferred_foot"),
    position: text("position"),
    jerseyNumber: integer("jersey_number"),
    marketValue: text("market_value"),
    contractUntil: date("contract_until"),
    photoUrl: text("photo_url"),
    metadataJson,
    createdAt,
    updatedAt
  },
  (table) => [
    index("players_current_team_idx").on(table.currentTeamId),
    index("players_sport_name_idx").on(table.sportId, table.name),
    index("players_sport_slug_dob_idx").on(table.sportId, table.slug, table.dateOfBirth)
  ]
);

export const matches = pgTable(
  "matches",
  {
    id,
    sportId: uuid("sport_id").notNull().references(() => sports.id),
    competitionId: uuid("competition_id").notNull().references(() => competitions.id),
    seasonId: uuid("season_id").references(() => seasons.id),
    round: text("round"),
    homeTeamId: uuid("home_team_id").notNull().references(() => teams.id),
    awayTeamId: uuid("away_team_id").notNull().references(() => teams.id),
    scheduledStartAt: timestamp("scheduled_start_at", { withTimezone: true }).notNull(),
    status: matchStatusEnum("status").notNull(),
    venue: text("venue"),
    referee: text("referee"),
    stageName: text("stage_name"),
    neutralGround: boolean("neutral_ground"),
    attendance: integer("attendance"),
    winnerTeamId: uuid("winner_team_id").references(() => teams.id),
    metadataJson,
    contentHash: text("content_hash"),
    createdAt,
    updatedAt
  },
  (table) => [
    unique("matches_natural_uidx").on(table.competitionId, table.seasonId, table.homeTeamId, table.awayTeamId, table.scheduledStartAt).nullsNotDistinct(),
    index("matches_upcoming_idx").on(table.scheduledStartAt).where(sql`${table.status} in ('scheduled', 'not_started', 'postponed')`),
    index("matches_finished_idx").on(table.scheduledStartAt).where(sql`${table.status} in ('finished', 'after_extra_time', 'after_penalties', 'abandoned')`),
    index("matches_competition_date_idx").on(table.competitionId, table.scheduledStartAt),
    index("matches_home_team_date_idx").on(table.homeTeamId, table.scheduledStartAt),
    index("matches_away_team_date_idx").on(table.awayTeamId, table.scheduledStartAt)
  ]
);

export const matchScores = pgTable(
  "match_scores",
  {
    id,
    matchId: uuid("match_id").notNull().references(() => matches.id),
    period: scorePeriodEnum("period").notNull(),
    homeScore: integer("home_score"),
    awayScore: integer("away_score"),
    createdAt,
    updatedAt
  },
  (table) => [uniqueIndex("match_scores_match_period_uidx").on(table.matchId, table.period)]
);

export const footballMatchScores = pgTable(
  "football_match_scores",
  {
    id,
    matchId: uuid("match_id").notNull().references(() => matches.id),
    homeTeamId: uuid("home_team_id").notNull().references(() => teams.id),
    awayTeamId: uuid("away_team_id").notNull().references(() => teams.id),
    winnerTeamId: uuid("winner_team_id").references(() => teams.id),
    homeScoreCurrent: integer("home_score_current"),
    awayScoreCurrent: integer("away_score_current"),
    homeScoreHalftime: integer("home_score_halftime"),
    awayScoreHalftime: integer("away_score_halftime"),
    homeScoreFulltime: integer("home_score_fulltime"),
    awayScoreFulltime: integer("away_score_fulltime"),
    homeScoreExtraTime: integer("home_score_extra_time"),
    awayScoreExtraTime: integer("away_score_extra_time"),
    homeScorePenalties: integer("home_score_penalties"),
    awayScorePenalties: integer("away_score_penalties"),
    status: matchStatusEnum("status"),
    metadataJson,
    createdAt,
    updatedAt
  },
  (table) => [
    uniqueIndex("football_match_scores_match_uidx").on(table.matchId),
    index("football_match_scores_winner_idx").on(table.winnerTeamId)
  ]
);

export const basketballMatchScores = pgTable(
  "basketball_match_scores",
  {
    id,
    matchId: uuid("match_id").notNull().references(() => matches.id),
    homeTeamId: uuid("home_team_id").notNull().references(() => teams.id),
    awayTeamId: uuid("away_team_id").notNull().references(() => teams.id),
    winnerTeamId: uuid("winner_team_id").references(() => teams.id),
    homeScoreCurrent: integer("home_score_current"),
    awayScoreCurrent: integer("away_score_current"),
    homeScoreFinal: integer("home_score_final"),
    awayScoreFinal: integer("away_score_final"),
    homeScoreHalftime: integer("home_score_halftime"),
    awayScoreHalftime: integer("away_score_halftime"),
    homeScoreOvertime: integer("home_score_overtime"),
    awayScoreOvertime: integer("away_score_overtime"),
    status: matchStatusEnum("status"),
    metadataJson,
    createdAt,
    updatedAt
  },
  (table) => [
    uniqueIndex("basketball_match_scores_match_uidx").on(table.matchId),
    index("basketball_match_scores_winner_idx").on(table.winnerTeamId)
  ]
);

export const basketballPeriodScores = pgTable(
  "basketball_period_scores",
  {
    id,
    matchId: uuid("match_id").notNull().references(() => matches.id),
    periodNumber: integer("period_number").notNull(),
    periodType: basketballPeriodTypeEnum("period_type").notNull(),
    overtimeNumber: integer("overtime_number"),
    homeScore: integer("home_score").notNull(),
    awayScore: integer("away_score").notNull(),
    metadataJson,
    createdAt,
    updatedAt
  },
  (table) => [
    unique("basketball_period_scores_match_period_uidx").on(table.matchId, table.periodType, table.periodNumber, table.overtimeNumber).nullsNotDistinct(),
    index("basketball_period_scores_match_idx").on(table.matchId),
    index("basketball_period_scores_match_order_idx").on(table.matchId, table.periodNumber, table.overtimeNumber)
  ]
);

export const footballMatchTeamStatistics = pgTable(
  "football_match_team_statistics",
  {
    id,
    matchId: uuid("match_id").notNull().references(() => matches.id),
    teamId: uuid("team_id").notNull().references(() => teams.id),
    opponentTeamId: uuid("opponent_team_id").notNull().references(() => teams.id),
    isHome: boolean("is_home").notNull(),
    possessionPercent: numeric("possession_percent", { precision: 5, scale: 2, mode: "number" }),
    shotsTotal: integer("shots_total"),
    shotsOnTarget: integer("shots_on_target"),
    shotsOffTarget: integer("shots_off_target"),
    blockedShots: integer("blocked_shots"),
    corners: integer("corners"),
    fouls: integer("fouls"),
    yellowCards: integer("yellow_cards"),
    redCards: integer("red_cards"),
    offsides: integer("offsides"),
    goalkeeperSaves: integer("goalkeeper_saves"),
    passes: integer("passes"),
    accuratePasses: integer("accurate_passes"),
    passAccuracyPercent: numeric("pass_accuracy_percent", { precision: 5, scale: 2, mode: "number" }),
    bigChances: integer("big_chances"),
    bigChancesMissed: integer("big_chances_missed"),
    expectedGoals: numeric("expected_goals", { precision: 6, scale: 3, mode: "number" }),
    expectedAssists: numeric("expected_assists", { precision: 6, scale: 3, mode: "number" }),
    attacks: integer("attacks"),
    dangerousAttacks: integer("dangerous_attacks"),
    hitWoodwork: integer("hit_woodwork"),
    tackles: integer("tackles"),
    interceptions: integer("interceptions"),
    clearances: integer("clearances"),
    duelsWon: integer("duels_won"),
    aerialDuelsWon: integer("aerial_duels_won"),
    metadataJson,
    createdAt,
    updatedAt
  },
  (table) => [
    uniqueIndex("football_match_team_statistics_match_team_uidx").on(table.matchId, table.teamId),
    index("football_match_team_statistics_match_idx").on(table.matchId),
    index("football_match_team_statistics_team_idx").on(table.teamId),
    index("football_match_team_statistics_opponent_idx").on(table.opponentTeamId)
  ]
);

export const basketballTeamMatchStatistics = pgTable(
  "basketball_team_match_statistics",
  {
    id,
    matchId: uuid("match_id").notNull().references(() => matches.id),
    teamId: uuid("team_id").notNull().references(() => teams.id),
    opponentTeamId: uuid("opponent_team_id").notNull().references(() => teams.id),
    isHome: boolean("is_home").notNull(),
    fieldGoalsMade: integer("field_goals_made"),
    fieldGoalsAttempted: integer("field_goals_attempted"),
    fieldGoalPercent: numeric("field_goal_percent", { precision: 5, scale: 2, mode: "number" }),
    twoPointersMade: integer("two_pointers_made"),
    twoPointersAttempted: integer("two_pointers_attempted"),
    twoPointPercent: numeric("two_point_percent", { precision: 5, scale: 2, mode: "number" }),
    threePointersMade: integer("three_pointers_made"),
    threePointersAttempted: integer("three_pointers_attempted"),
    threePointPercent: numeric("three_point_percent", { precision: 5, scale: 2, mode: "number" }),
    freeThrowsMade: integer("free_throws_made"),
    freeThrowsAttempted: integer("free_throws_attempted"),
    freeThrowPercent: numeric("free_throw_percent", { precision: 5, scale: 2, mode: "number" }),
    reboundsTotal: integer("rebounds_total"),
    reboundsOffensive: integer("rebounds_offensive"),
    reboundsDefensive: integer("rebounds_defensive"),
    assists: integer("assists"),
    steals: integer("steals"),
    blocks: integer("blocks"),
    turnovers: integer("turnovers"),
    personalFouls: integer("personal_fouls"),
    fastBreakPoints: integer("fast_break_points"),
    pointsInPaint: integer("points_in_paint"),
    secondChancePoints: integer("second_chance_points"),
    benchPoints: integer("bench_points"),
    biggestLead: integer("biggest_lead"),
    leadChanges: integer("lead_changes"),
    timeInLeadSeconds: integer("time_in_lead_seconds"),
    metadataJson,
    createdAt,
    updatedAt
  },
  (table) => [
    uniqueIndex("basketball_team_match_statistics_match_team_uidx").on(table.matchId, table.teamId),
    index("basketball_team_match_statistics_match_idx").on(table.matchId),
    index("basketball_team_match_statistics_team_idx").on(table.teamId),
    index("basketball_team_match_statistics_opponent_idx").on(table.opponentTeamId)
  ]
);

export const matchEvents = pgTable(
  "match_events",
  {
    id,
    matchId: uuid("match_id").notNull().references(() => matches.id),
    teamId: uuid("team_id").references(() => teams.id),
    playerId: uuid("player_id").references(() => players.id),
    eventType: text("event_type").notNull(),
    minute: integer("minute"),
    extraMinute: integer("extra_minute"),
    metadataJson,
    providerOrder: integer("provider_order"),
    contentHash: text("content_hash"),
    createdAt,
    updatedAt
  },
  (table) => [
    unique("match_events_content_uidx").on(table.matchId, table.eventType, table.minute, table.extraMinute, table.teamId, table.playerId, table.providerOrder).nullsNotDistinct(),
    index("match_events_match_idx").on(table.matchId)
  ]
);

export const matchStatistics = pgTable(
  "match_statistics",
  {
    id,
    matchId: uuid("match_id").notNull().references(() => matches.id),
    teamId: uuid("team_id").notNull().references(() => teams.id),
    possession: numeric("possession", { precision: 5, scale: 2 }),
    shots: integer("shots"),
    shotsOnTarget: integer("shots_on_target"),
    corners: integer("corners"),
    fouls: integer("fouls"),
    yellowCards: integer("yellow_cards"),
    redCards: integer("red_cards"),
    offsides: integer("offsides"),
    expectedGoals: numeric("expected_goals", { precision: 6, scale: 3 }),
    attacks: integer("attacks"),
    dangerousAttacks: integer("dangerous_attacks"),
    passes: integer("passes"),
    providerStatsJson: jsonb("provider_stats_json").$type<Record<string, unknown>>().notNull().default({}),
    contentHash: text("content_hash"),
    createdAt,
    updatedAt
  },
  (table) => [
    uniqueIndex("match_statistics_match_team_uidx").on(table.matchId, table.teamId),
    index("match_statistics_team_idx").on(table.teamId)
  ]
);

export const standings = pgTable(
  "standings",
  {
    id,
    competitionId: uuid("competition_id").notNull().references(() => competitions.id),
    seasonId: uuid("season_id").notNull().references(() => seasons.id),
    teamId: uuid("team_id").notNull().references(() => teams.id),
    position: integer("position"),
    played: integer("played").notNull().default(0),
    won: integer("won").notNull().default(0),
    drawn: integer("drawn").notNull().default(0),
    lost: integer("lost").notNull().default(0),
    goalsFor: integer("goals_for").notNull().default(0),
    goalsAgainst: integer("goals_against").notNull().default(0),
    points: integer("points").notNull().default(0),
    metadataJson,
    contentHash: text("content_hash"),
    createdAt,
    updatedAt
  },
  (table) => [
    uniqueIndex("standings_competition_season_team_uidx").on(table.competitionId, table.seasonId, table.teamId),
    index("standings_competition_season_idx").on(table.competitionId, table.seasonId, table.position)
  ]
);

export const footballStandings = pgTable(
  "football_standings",
  {
    id,
    competitionId: uuid("competition_id").notNull().references(() => competitions.id),
    seasonId: uuid("season_id").references(() => seasons.id),
    teamId: uuid("team_id").notNull().references(() => teams.id),
    position: integer("position").notNull(),
    played: integer("played").notNull(),
    wins: integer("wins").notNull(),
    draws: integer("draws").notNull(),
    losses: integer("losses").notNull(),
    goalsFor: integer("goals_for").notNull(),
    goalsAgainst: integer("goals_against").notNull(),
    goalDifference: integer("goal_difference").notNull(),
    points: integer("points").notNull(),
    homePlayed: integer("home_played"),
    homeWins: integer("home_wins"),
    homeDraws: integer("home_draws"),
    homeLosses: integer("home_losses"),
    homeGoalsFor: integer("home_goals_for"),
    homeGoalsAgainst: integer("home_goals_against"),
    awayPlayed: integer("away_played"),
    awayWins: integer("away_wins"),
    awayDraws: integer("away_draws"),
    awayLosses: integer("away_losses"),
    awayGoalsFor: integer("away_goals_for"),
    awayGoalsAgainst: integer("away_goals_against"),
    formString: text("form_string"),
    status: text("status"),
    metadataJson,
    createdAt,
    updatedAt
  },
  (table) => [
    unique("football_standings_competition_season_team_uidx").on(table.competitionId, table.seasonId, table.teamId).nullsNotDistinct(),
    index("football_standings_competition_season_position_idx").on(table.competitionId, table.seasonId, table.position),
    index("football_standings_team_idx").on(table.teamId),
    index("football_standings_lookup_idx").on(table.competitionId, table.seasonId, table.teamId)
  ]
);

export const basketballStandings = pgTable(
  "basketball_standings",
  {
    id,
    competitionId: uuid("competition_id").notNull().references(() => competitions.id),
    seasonId: uuid("season_id").references(() => seasons.id),
    teamId: uuid("team_id").notNull().references(() => teams.id),
    position: integer("position").notNull(),
    played: integer("played").notNull(),
    wins: integer("wins").notNull(),
    losses: integer("losses").notNull(),
    winPercentage: numeric("win_percentage", { precision: 5, scale: 2, mode: "number" }),
    pointsFor: integer("points_for"),
    pointsAgainst: integer("points_against"),
    pointDifference: integer("point_difference"),
    homeWins: integer("home_wins"),
    homeLosses: integer("home_losses"),
    awayWins: integer("away_wins"),
    awayLosses: integer("away_losses"),
    streak: text("streak"),
    formString: text("form_string"),
    conference: text("conference"),
    division: text("division"),
    status: text("status"),
    metadataJson,
    createdAt,
    updatedAt
  },
  (table) => [
    unique("basketball_standings_competition_season_team_uidx").on(table.competitionId, table.seasonId, table.teamId).nullsNotDistinct(),
    index("basketball_standings_competition_season_position_idx").on(table.competitionId, table.seasonId, table.position),
    index("basketball_standings_team_idx").on(table.teamId),
    index("basketball_standings_lookup_idx").on(table.competitionId, table.seasonId, table.teamId)
  ]
);

export const footballTeamFormFeatures = pgTable(
  "football_team_form_features",
  {
    id,
    teamId: uuid("team_id").notNull().references(() => teams.id),
    competitionId: uuid("competition_id").references(() => competitions.id),
    seasonId: uuid("season_id").references(() => seasons.id),
    asOfMatchId: uuid("as_of_match_id").references(() => matches.id),
    asOfDate: timestamp("as_of_date", { withTimezone: true }).notNull(),
    windowSize: integer("window_size").notNull(),
    scope: footballTeamFormScopeEnum("scope").notNull(),
    matchesPlayed: integer("matches_played").notNull().default(0),
    wins: integer("wins").notNull().default(0),
    draws: integer("draws").notNull().default(0),
    losses: integer("losses").notNull().default(0),
    points: integer("points").notNull().default(0),
    goalsFor: integer("goals_for").notNull().default(0),
    goalsAgainst: integer("goals_against").notNull().default(0),
    goalDifference: integer("goal_difference").notNull().default(0),
    avgGoalsFor: numeric("avg_goals_for", { precision: 8, scale: 3, mode: "number" }),
    avgGoalsAgainst: numeric("avg_goals_against", { precision: 8, scale: 3, mode: "number" }),
    cleanSheetRate: numeric("clean_sheet_rate", { precision: 5, scale: 2, mode: "number" }),
    failedToScoreRate: numeric("failed_to_score_rate", { precision: 5, scale: 2, mode: "number" }),
    bothTeamsToScoreRate: numeric("both_teams_to_score_rate", { precision: 5, scale: 2, mode: "number" }),
    over05Rate: numeric("over_0_5_rate", { precision: 5, scale: 2, mode: "number" }),
    over15Rate: numeric("over_1_5_rate", { precision: 5, scale: 2, mode: "number" }),
    over25Rate: numeric("over_2_5_rate", { precision: 5, scale: 2, mode: "number" }),
    over35Rate: numeric("over_3_5_rate", { precision: 5, scale: 2, mode: "number" }),
    under25Rate: numeric("under_2_5_rate", { precision: 5, scale: 2, mode: "number" }),
    scoredRate: numeric("scored_rate", { precision: 5, scale: 2, mode: "number" }),
    concededRate: numeric("conceded_rate", { precision: 5, scale: 2, mode: "number" }),
    teamOver05Rate: numeric("team_over_0_5_rate", { precision: 5, scale: 2, mode: "number" }),
    teamOver15Rate: numeric("team_over_1_5_rate", { precision: 5, scale: 2, mode: "number" }),
    firstHalfOver05Rate: numeric("first_half_over_0_5_rate", { precision: 5, scale: 2, mode: "number" }),
    firstHalfAvgGoalsFor: numeric("first_half_avg_goals_for", { precision: 8, scale: 3, mode: "number" }),
    firstHalfAvgGoalsAgainst: numeric("first_half_avg_goals_against", { precision: 8, scale: 3, mode: "number" }),
    avgShots: numeric("avg_shots", { precision: 8, scale: 3, mode: "number" }),
    avgShotsOnTarget: numeric("avg_shots_on_target", { precision: 8, scale: 3, mode: "number" }),
    avgPossessionPercent: numeric("avg_possession_percent", { precision: 5, scale: 2, mode: "number" }),
    avgCorners: numeric("avg_corners", { precision: 8, scale: 3, mode: "number" }),
    avgYellowCards: numeric("avg_yellow_cards", { precision: 8, scale: 3, mode: "number" }),
    avgRedCards: numeric("avg_red_cards", { precision: 8, scale: 3, mode: "number" }),
    avgFouls: numeric("avg_fouls", { precision: 8, scale: 3, mode: "number" }),
    avgExpectedGoals: numeric("avg_expected_goals", { precision: 8, scale: 3, mode: "number" }),
    avgDangerousAttacks: numeric("avg_dangerous_attacks", { precision: 8, scale: 3, mode: "number" }),
    standingsPosition: integer("standings_position"),
    standingsPoints: integer("standings_points"),
    standingsGoalDifference: integer("standings_goal_difference"),
    sampleSize: integer("sample_size").notNull().default(0),
    coverageScore: numeric("coverage_score", { precision: 5, scale: 2, mode: "number" }).notNull().default(0),
    metadataJson,
    createdAt,
    updatedAt
  },
  (table) => [
    unique("football_team_form_features_uidx")
      .on(table.teamId, table.competitionId, table.seasonId, table.asOfMatchId, table.windowSize, table.scope)
      .nullsNotDistinct(),
    index("football_team_form_features_team_idx").on(table.teamId),
    index("football_team_form_features_competition_season_idx").on(table.competitionId, table.seasonId),
    index("football_team_form_features_as_of_match_idx").on(table.asOfMatchId),
    index("football_team_form_features_team_competition_season_idx").on(table.teamId, table.competitionId, table.seasonId),
    index("football_team_form_features_updated_idx").on(table.updatedAt)
  ]
);

export const footballHeadToHeadFeatures = pgTable(
  "football_head_to_head_features",
  {
    id,
    teamAId: uuid("team_a_id").notNull().references(() => teams.id),
    teamBId: uuid("team_b_id").notNull().references(() => teams.id),
    competitionId: uuid("competition_id").references(() => competitions.id),
    seasonId: uuid("season_id").references(() => seasons.id),
    asOfMatchId: uuid("as_of_match_id").references(() => matches.id),
    asOfDate: timestamp("as_of_date", { withTimezone: true }).notNull(),
    windowSize: integer("window_size").notNull(),
    matchesPlayed: integer("matches_played").notNull().default(0),
    teamAWins: integer("team_a_wins").notNull().default(0),
    teamBWins: integer("team_b_wins").notNull().default(0),
    draws: integer("draws").notNull().default(0),
    teamAGoalsFor: integer("team_a_goals_for").notNull().default(0),
    teamBGoalsFor: integer("team_b_goals_for").notNull().default(0),
    avgTotalGoals: numeric("avg_total_goals", { precision: 8, scale: 3, mode: "number" }),
    avgTeamAGoals: numeric("avg_team_a_goals", { precision: 8, scale: 3, mode: "number" }),
    avgTeamBGoals: numeric("avg_team_b_goals", { precision: 8, scale: 3, mode: "number" }),
    bothTeamsToScoreRate: numeric("both_teams_to_score_rate", { precision: 5, scale: 2, mode: "number" }),
    over15Rate: numeric("over_1_5_rate", { precision: 5, scale: 2, mode: "number" }),
    over25Rate: numeric("over_2_5_rate", { precision: 5, scale: 2, mode: "number" }),
    over35Rate: numeric("over_3_5_rate", { precision: 5, scale: 2, mode: "number" }),
    teamAHomeMatches: integer("team_a_home_matches").notNull().default(0),
    teamBHomeMatches: integer("team_b_home_matches").notNull().default(0),
    teamAHomeWins: integer("team_a_home_wins").notNull().default(0),
    teamBHomeWins: integer("team_b_home_wins").notNull().default(0),
    lastMatchId: uuid("last_match_id").references(() => matches.id),
    lastMatchDate: timestamp("last_match_date", { withTimezone: true }),
    lastMatchTeamAGoals: integer("last_match_team_a_goals"),
    lastMatchTeamBGoals: integer("last_match_team_b_goals"),
    sampleSize: integer("sample_size").notNull().default(0),
    coverageScore: numeric("coverage_score", { precision: 5, scale: 2, mode: "number" }).notNull().default(0),
    metadataJson,
    createdAt,
    updatedAt
  },
  (table) => [
    unique("football_head_to_head_features_uidx")
      .on(table.teamAId, table.teamBId, table.competitionId, table.seasonId, table.asOfMatchId, table.windowSize)
      .nullsNotDistinct(),
    index("football_head_to_head_features_team_a_idx").on(table.teamAId),
    index("football_head_to_head_features_team_b_idx").on(table.teamBId),
    index("football_head_to_head_features_competition_season_idx").on(table.competitionId, table.seasonId),
    index("football_head_to_head_features_as_of_match_idx").on(table.asOfMatchId),
    index("football_head_to_head_features_pair_idx").on(table.teamAId, table.teamBId),
    index("football_head_to_head_features_updated_idx").on(table.updatedAt)
  ]
);

export const footballMatchPredictionFeatures = pgTable(
  "football_match_prediction_features",
  {
    id,
    matchId: uuid("match_id").notNull().references(() => matches.id),
    competitionId: uuid("competition_id").notNull().references(() => competitions.id),
    seasonId: uuid("season_id").references(() => seasons.id),
    homeTeamId: uuid("home_team_id").notNull().references(() => teams.id),
    awayTeamId: uuid("away_team_id").notNull().references(() => teams.id),
    asOfDate: timestamp("as_of_date", { withTimezone: true }).notNull(),
    formWindowSize: integer("form_window_size").notNull(),
    h2hWindowSize: integer("h2h_window_size").notNull(),
    homeFormFeatureId: uuid("home_form_feature_id").references(() => footballTeamFormFeatures.id),
    awayFormFeatureId: uuid("away_form_feature_id").references(() => footballTeamFormFeatures.id),
    h2hFeatureId: uuid("h2h_feature_id").references(() => footballHeadToHeadFeatures.id),
    homeFormCoverageScore: numeric("home_form_coverage_score", { precision: 5, scale: 2, mode: "number" }),
    awayFormCoverageScore: numeric("away_form_coverage_score", { precision: 5, scale: 2, mode: "number" }),
    h2hCoverageScore: numeric("h2h_coverage_score", { precision: 5, scale: 2, mode: "number" }),
    combinedCoverageScore: numeric("combined_coverage_score", { precision: 5, scale: 2, mode: "number" }).notNull().default(0),
    homeRecentPoints: integer("home_recent_points"),
    awayRecentPoints: integer("away_recent_points"),
    homeAvgGoalsFor: numeric("home_avg_goals_for", { precision: 8, scale: 3, mode: "number" }),
    homeAvgGoalsAgainst: numeric("home_avg_goals_against", { precision: 8, scale: 3, mode: "number" }),
    awayAvgGoalsFor: numeric("away_avg_goals_for", { precision: 8, scale: 3, mode: "number" }),
    awayAvgGoalsAgainst: numeric("away_avg_goals_against", { precision: 8, scale: 3, mode: "number" }),
    homeAttackStrengthProxy: numeric("home_attack_strength_proxy", { precision: 8, scale: 3, mode: "number" }),
    awayAttackStrengthProxy: numeric("away_attack_strength_proxy", { precision: 8, scale: 3, mode: "number" }),
    homeDefenseStrengthProxy: numeric("home_defense_strength_proxy", { precision: 8, scale: 3, mode: "number" }),
    awayDefenseStrengthProxy: numeric("away_defense_strength_proxy", { precision: 8, scale: 3, mode: "number" }),
    h2hAvgTotalGoals: numeric("h2h_avg_total_goals", { precision: 8, scale: 3, mode: "number" }),
    h2hBttsRate: numeric("h2h_btts_rate", { precision: 5, scale: 2, mode: "number" }),
    h2hOver25Rate: numeric("h2h_over_2_5_rate", { precision: 5, scale: 2, mode: "number" }),
    expectedTotalGoalsProxy: numeric("expected_total_goals_proxy", { precision: 8, scale: 3, mode: "number" }),
    expectedHomeGoalsProxy: numeric("expected_home_goals_proxy", { precision: 8, scale: 3, mode: "number" }),
    expectedAwayGoalsProxy: numeric("expected_away_goals_proxy", { precision: 8, scale: 3, mode: "number" }),
    homeGoalSignalScore: numeric("home_goal_signal_score", { precision: 5, scale: 2, mode: "number" }),
    awayGoalSignalScore: numeric("away_goal_signal_score", { precision: 5, scale: 2, mode: "number" }),
    firstHalfGoalSignalScore: numeric("first_half_goal_signal_score", { precision: 5, scale: 2, mode: "number" }),
    bttsSignalScore: numeric("btts_signal_score", { precision: 5, scale: 2, mode: "number" }),
    goalProfile: text("goal_profile"),
    firstHalfGoalProfile: text("first_half_goal_profile"),
    bttsProfile: text("btts_profile"),
    homeTeamGoalProfile: text("home_team_goal_profile"),
    awayTeamGoalProfile: text("away_team_goal_profile"),
    standingsPositionDiff: integer("standings_position_diff"),
    standingsPointsDiff: integer("standings_points_diff"),
    standingsGoalDifferenceDiff: integer("standings_goal_difference_diff"),
    featureStatus: text("feature_status").notNull(),
    metadataJson,
    createdAt,
    updatedAt
  },
  (table) => [
    uniqueIndex("football_match_prediction_features_match_windows_uidx").on(table.matchId, table.formWindowSize, table.h2hWindowSize),
    index("football_match_prediction_features_match_idx").on(table.matchId),
    index("football_match_prediction_features_competition_idx").on(table.competitionId),
    index("football_match_prediction_features_home_team_idx").on(table.homeTeamId),
    index("football_match_prediction_features_away_team_idx").on(table.awayTeamId),
    index("football_match_prediction_features_status_idx").on(table.featureStatus),
    index("football_match_prediction_features_updated_idx").on(table.updatedAt)
  ]
);

export const footballPredictionOutputs = pgTable(
  "football_prediction_outputs",
  {
    id,
    matchId: uuid("match_id").notNull().references(() => matches.id),
    featureSnapshotId: uuid("feature_snapshot_id").notNull().references(() => footballMatchPredictionFeatures.id),
    predictionType: text("prediction_type").notNull(),
    predictionValue: text("prediction_value").notNull(),
    predictionFamily: footballPredictionFamilyEnum("prediction_family").notNull(),
    recommendationTier: text("recommendation_tier"),
    displayLabel: text("display_label"),
    reasoningSummary: text("reasoning_summary"),
    confidenceScore: numeric("confidence_score", { precision: 5, scale: 2, mode: "number" }),
    confidenceCeiling: numeric("confidence_ceiling", { precision: 5, scale: 2, mode: "number" }),
    riskLevel: footballPredictionRiskLevelEnum("risk_level").notNull().default("unknown"),
    status: footballPredictionStatusEnum("status").notNull().default("draft"),
    consistencyStatus: footballPredictionConsistencyStatusEnum("consistency_status").notNull().default("unchecked"),
    consistencyCheckedAt: timestamp("consistency_checked_at", { withTimezone: true }),
    consistencySummary: text("consistency_summary"),
    expectationSnapshot: jsonb("expectation_snapshot").$type<Record<string, unknown>>(),
    conflictCount: integer("conflict_count").notNull().default(0),
    blockingConflictCount: integer("blocking_conflict_count").notNull().default(0),
    warningConflictCount: integer("warning_conflict_count").notNull().default(0),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull(),
    visibleToMembersAt: timestamp("visible_to_members_at", { withTimezone: true }),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    publicEligibleAt: timestamp("public_eligible_at", { withTimezone: true }),
    publicPublishedAt: timestamp("public_published_at", { withTimezone: true }),
    publicExcludedAt: timestamp("public_excluded_at", { withTimezone: true }),
    publicExclusionReason: text("public_exclusion_reason"),
    staleAt: timestamp("stale_at", { withTimezone: true }),
    rebuildRequired: boolean("rebuild_required").notNull().default(false),
    generationWindowStatus: text("generation_window_status"),
    generatedLeadTimeMinutes: integer("generated_lead_time_minutes"),
    rebuildReason: text("rebuild_reason"),
    lastRebuiltAt: timestamp("last_rebuilt_at", { withTimezone: true }),
    dedupeKey: text("dedupe_key").notNull(),
    metadataJson,
    createdAt,
    updatedAt
  },
  (table) => [
    uniqueIndex("football_prediction_outputs_dedupe_key_uidx").on(table.dedupeKey),
    index("football_prediction_outputs_match_idx").on(table.matchId),
    index("football_prediction_outputs_feature_snapshot_idx").on(table.featureSnapshotId),
    index("football_prediction_outputs_status_idx").on(table.status),
    index("football_prediction_outputs_consistency_status_idx").on(table.consistencyStatus),
    index("football_prediction_outputs_family_idx").on(table.predictionFamily),
    index("football_prediction_outputs_type_idx").on(table.predictionType),
    index("football_prediction_outputs_generated_at_idx").on(table.generatedAt),
    index("football_prediction_outputs_visible_to_members_at_idx").on(table.visibleToMembersAt),
    index("football_prediction_outputs_public_eligible_at_idx").on(table.publicEligibleAt),
    index("football_prediction_outputs_public_published_at_idx").on(table.publicPublishedAt)
  ]
);

export const footballPredictionConflicts = pgTable(
  "football_prediction_conflicts",
  {
    id,
    predictionOutputId: uuid("prediction_output_id").notNull().references(() => footballPredictionOutputs.id),
    matchId: uuid("match_id").notNull().references(() => matches.id),
    conflictType: text("conflict_type").notNull(),
    severity: footballPredictionConflictSeverityEnum("severity").notNull(),
    sourcePredictionType: text("source_prediction_type"),
    conflictingPredictionType: text("conflicting_prediction_type"),
    reason: text("reason").notNull(),
    metadataJson,
    createdAt
  },
  (table) => [
    index("football_prediction_conflicts_prediction_output_idx").on(table.predictionOutputId),
    index("football_prediction_conflicts_match_idx").on(table.matchId),
    index("football_prediction_conflicts_severity_idx").on(table.severity),
    index("football_prediction_conflicts_type_idx").on(table.conflictType)
  ]
);

export const footballPredictionSettlements = pgTable(
  "football_prediction_settlements",
  {
    id,
    predictionOutputId: uuid("prediction_output_id").notNull().references(() => footballPredictionOutputs.id),
    matchId: uuid("match_id").notNull().references(() => matches.id),
    settlementStatus: footballPredictionSettlementStatusEnum("settlement_status").notNull(),
    actualResult: text("actual_result").notNull(),
    evaluatedAt: timestamp("evaluated_at", { withTimezone: true }).notNull(),
    settlementReason: text("settlement_reason").notNull(),
    settlementMetadata: jsonb("settlement_metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt,
    updatedAt
  },
  (table) => [
    uniqueIndex("football_prediction_settlements_prediction_output_uidx").on(table.predictionOutputId),
    index("football_prediction_settlements_prediction_output_idx").on(table.predictionOutputId),
    index("football_prediction_settlements_match_idx").on(table.matchId),
    index("football_prediction_settlements_status_idx").on(table.settlementStatus),
    index("football_prediction_settlements_evaluated_at_idx").on(table.evaluatedAt)
  ]
);

export const publicSuccessfulPredictions = pgTable(
  "public_successful_predictions",
  {
    id,
    predictionOutputId: uuid("prediction_output_id").notNull().references(() => footballPredictionOutputs.id),
    publicTitle: text("public_title").notNull(),
    publicSummary: text("public_summary").notNull(),
    publicVisibleAt: timestamp("public_visible_at", { withTimezone: true }),
    displayOrder: integer("display_order"),
    isFeatured: boolean("is_featured").notNull().default(false),
    status: publicSuccessfulPredictionStatusEnum("status").notNull().default("draft"),
    metadataJson,
    createdAt,
    updatedAt
  },
  (table) => [
    uniqueIndex("public_successful_predictions_prediction_output_uidx").on(table.predictionOutputId),
    index("public_successful_predictions_prediction_output_idx").on(table.predictionOutputId),
    index("public_successful_predictions_status_idx").on(table.status),
    index("public_successful_predictions_visible_at_idx").on(table.publicVisibleAt),
    index("public_successful_predictions_featured_idx").on(table.isFeatured),
    index("public_successful_predictions_display_order_idx").on(table.displayOrder)
  ]
);

export const basketballTeamFormFeatures = pgTable(
  "basketball_team_form_features",
  {
    id,
    teamId: uuid("team_id").notNull().references(() => teams.id),
    competitionId: uuid("competition_id").references(() => competitions.id),
    seasonId: uuid("season_id").references(() => seasons.id),
    asOfMatchId: uuid("as_of_match_id").references(() => matches.id),
    asOfDate: timestamp("as_of_date", { withTimezone: true }).notNull(),
    windowSize: integer("window_size").notNull(),
    scope: basketballTeamFormScopeEnum("scope").notNull(),
    matchesPlayed: integer("matches_played").notNull().default(0),
    wins: integer("wins").notNull().default(0),
    losses: integer("losses").notNull().default(0),
    pointsFor: integer("points_for").notNull().default(0),
    pointsAgainst: integer("points_against").notNull().default(0),
    pointDifference: integer("point_difference").notNull().default(0),
    avgPointsFor: numeric("avg_points_for", { precision: 8, scale: 3, mode: "number" }),
    avgPointsAgainst: numeric("avg_points_against", { precision: 8, scale: 3, mode: "number" }),
    avgTotalPoints: numeric("avg_total_points", { precision: 8, scale: 3, mode: "number" }),
    avgMargin: numeric("avg_margin", { precision: 8, scale: 3, mode: "number" }),
    over1505Rate: numeric("over_150_5_rate", { precision: 5, scale: 2, mode: "number" }),
    over1605Rate: numeric("over_160_5_rate", { precision: 5, scale: 2, mode: "number" }),
    over1705Rate: numeric("over_170_5_rate", { precision: 5, scale: 2, mode: "number" }),
    over1805Rate: numeric("over_180_5_rate", { precision: 5, scale: 2, mode: "number" }),
    avgQ1PointsFor: numeric("avg_q1_points_for", { precision: 8, scale: 3, mode: "number" }),
    avgQ1PointsAgainst: numeric("avg_q1_points_against", { precision: 8, scale: 3, mode: "number" }),
    avgFirstHalfPointsFor: numeric("avg_first_half_points_for", { precision: 8, scale: 3, mode: "number" }),
    avgFirstHalfPointsAgainst: numeric("avg_first_half_points_against", { precision: 8, scale: 3, mode: "number" }),
    avgSecondHalfPointsFor: numeric("avg_second_half_points_for", { precision: 8, scale: 3, mode: "number" }),
    avgSecondHalfPointsAgainst: numeric("avg_second_half_points_against", { precision: 8, scale: 3, mode: "number" }),
    avgQ4PointsFor: numeric("avg_q4_points_for", { precision: 8, scale: 3, mode: "number" }),
    avgQ4PointsAgainst: numeric("avg_q4_points_against", { precision: 8, scale: 3, mode: "number" }),
    avgFieldGoalPercent: numeric("avg_field_goal_percent", { precision: 5, scale: 2, mode: "number" }),
    avgThreePointPercent: numeric("avg_three_point_percent", { precision: 5, scale: 2, mode: "number" }),
    avgFreeThrowPercent: numeric("avg_free_throw_percent", { precision: 5, scale: 2, mode: "number" }),
    avgReboundsTotal: numeric("avg_rebounds_total", { precision: 8, scale: 3, mode: "number" }),
    avgReboundsOffensive: numeric("avg_rebounds_offensive", { precision: 8, scale: 3, mode: "number" }),
    avgReboundsDefensive: numeric("avg_rebounds_defensive", { precision: 8, scale: 3, mode: "number" }),
    avgAssists: numeric("avg_assists", { precision: 8, scale: 3, mode: "number" }),
    avgSteals: numeric("avg_steals", { precision: 8, scale: 3, mode: "number" }),
    avgBlocks: numeric("avg_blocks", { precision: 8, scale: 3, mode: "number" }),
    avgTurnovers: numeric("avg_turnovers", { precision: 8, scale: 3, mode: "number" }),
    avgPersonalFouls: numeric("avg_personal_fouls", { precision: 8, scale: 3, mode: "number" }),
    avgFastBreakPoints: numeric("avg_fast_break_points", { precision: 8, scale: 3, mode: "number" }),
    avgPointsInPaint: numeric("avg_points_in_paint", { precision: 8, scale: 3, mode: "number" }),
    avgSecondChancePoints: numeric("avg_second_chance_points", { precision: 8, scale: 3, mode: "number" }),
    avgBenchPoints: numeric("avg_bench_points", { precision: 8, scale: 3, mode: "number" }),
    standingsPosition: integer("standings_position"),
    standingsWinPercentage: numeric("standings_win_percentage", { precision: 5, scale: 2, mode: "number" }),
    standingsPointDifference: integer("standings_point_difference"),
    standingsStreak: text("standings_streak"),
    sampleSize: integer("sample_size").notNull().default(0),
    coverageScore: numeric("coverage_score", { precision: 5, scale: 2, mode: "number" }).notNull().default(0),
    metadataJson,
    createdAt,
    updatedAt
  },
  (table) => [
    unique("basketball_team_form_features_uidx")
      .on(table.teamId, table.competitionId, table.seasonId, table.asOfMatchId, table.windowSize, table.scope)
      .nullsNotDistinct(),
    index("basketball_team_form_features_team_idx").on(table.teamId),
    index("basketball_team_form_features_competition_season_idx").on(table.competitionId, table.seasonId),
    index("basketball_team_form_features_as_of_match_idx").on(table.asOfMatchId),
    index("basketball_team_form_features_team_competition_season_idx").on(table.teamId, table.competitionId, table.seasonId),
    index("basketball_team_form_features_updated_idx").on(table.updatedAt)
  ]
);

export const providerMappings = pgTable(
  "provider_mappings",
  {
    id,
    provider: text("provider").notNull(),
    entityType: providerEntityTypeEnum("entity_type").notNull(),
    providerEntityId: text("provider_entity_id").notNull(),
    internalEntityId: uuid("internal_entity_id").notNull(),
    internalEntityType: providerEntityTypeEnum("internal_entity_type").notNull(),
    metadataJson,
    createdAt,
    updatedAt
  },
  (table) => [
    uniqueIndex("provider_mappings_provider_entity_uidx").on(table.provider, table.entityType, table.providerEntityId),
    index("provider_mappings_internal_idx").on(table.internalEntityType, table.internalEntityId)
  ]
);

export const rawProviderPayloads = pgTable(
  "raw_provider_payloads",
  {
    id,
    provider: text("provider").notNull(),
    entityType: providerEntityTypeEnum("entity_type").notNull(),
    providerEntityId: text("provider_entity_id"),
    endpoint: text("endpoint").notNull(),
    requestParamsHash: text("request_params_hash").notNull(),
    payloadHash: text("payload_hash").notNull(),
    payloadJson: jsonb("payload_json").$type<unknown>().notNull(),
    status: rawPayloadStatusEnum("status").notNull().default("received"),
    normalizationError: text("normalization_error"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    deleteAfter: timestamp("delete_after", { withTimezone: true }).notNull()
  },
  (table) => [
    uniqueIndex("raw_provider_payloads_dedupe_uidx").on(table.provider, table.endpoint, table.requestParamsHash, table.payloadHash),
    index("raw_provider_payloads_cleanup_idx").on(table.status, table.deleteAfter),
    index("raw_provider_payloads_delete_after_idx").on(table.deleteAfter),
    index("raw_provider_payloads_entity_idx").on(table.provider, table.entityType, table.providerEntityId)
  ]
);

export const syncJobs = pgTable(
  "sync_jobs",
  {
    id,
    queueName: text("queue_name").notNull(),
    jobName: text("job_name").notNull(),
    jobKey: text("job_key").notNull(),
    provider: text("provider").notNull(),
    entityType: providerEntityTypeEnum("entity_type").notNull(),
    entityId: text("entity_id"),
    providerEntityId: text("provider_entity_id"),
    status: syncJobStatusEnum("status").notNull().default("queued"),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastError: text("last_error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
    createdAt,
    updatedAt
  },
  (table) => [
    uniqueIndex("sync_jobs_job_key_uidx").on(table.jobKey),
    index("sync_jobs_status_idx").on(table.status, table.updatedAt)
  ]
);

export const syncJobLogs = pgTable(
  "sync_job_logs",
  {
    id,
    syncJobId: uuid("sync_job_id").notNull().references(() => syncJobs.id),
    level: logLevelEnum("level").notNull(),
    message: text("message").notNull(),
    metadataJson,
    createdAt
  },
  (table) => [
    index("sync_job_logs_job_created_idx").on(table.syncJobId, table.createdAt),
    index("sync_job_logs_created_idx").on(table.createdAt)
  ]
);

export const teamAnalysisSnapshots = pgTable(
  "team_analysis_snapshots",
  {
    id,
    teamId: uuid("team_id").notNull().references(() => teams.id),
    snapshotDate: date("snapshot_date").notNull(),
    featuresJson: jsonb("features_json").$type<Record<string, unknown>>().notNull().default({}),
    contentHash: text("content_hash"),
    createdAt,
    updatedAt
  },
  (table) => [
    uniqueIndex("team_analysis_snapshots_team_date_uidx").on(table.teamId, table.snapshotDate),
    index("team_analysis_snapshots_team_lookup_idx").on(table.teamId, table.snapshotDate)
  ]
);

export const teamFormFeatures = pgTable(
  "team_form_features",
  {
    id,
    teamId: uuid("team_id").notNull().references(() => teams.id),
    competitionId: uuid("competition_id").references(() => competitions.id),
    seasonId: uuid("season_id").references(() => seasons.id),
    asOfMatchId: uuid("as_of_match_id").references(() => matches.id),
    windowSize: integer("window_size").notNull(),
    scope: text("scope").notNull(),
    featuresJson: jsonb("features_json").$type<Record<string, unknown>>().notNull().default({}),
    contentHash: text("content_hash"),
    createdAt,
    updatedAt
  },
  (table) => [
    unique("team_form_features_uidx").on(table.teamId, table.competitionId, table.seasonId, table.asOfMatchId, table.windowSize, table.scope).nullsNotDistinct(),
    index("team_form_features_team_lookup_idx").on(table.teamId, table.scope, table.windowSize)
  ]
);

export const headToHeadFeatures = pgTable(
  "head_to_head_features",
  {
    id,
    teamAId: uuid("team_a_id").notNull().references(() => teams.id),
    teamBId: uuid("team_b_id").notNull().references(() => teams.id),
    asOfMatchId: uuid("as_of_match_id").references(() => matches.id),
    featuresJson: jsonb("features_json").$type<Record<string, unknown>>().notNull().default({}),
    contentHash: text("content_hash"),
    createdAt,
    updatedAt
  },
  (table) => [
    unique("head_to_head_features_uidx").on(table.teamAId, table.teamBId, table.asOfMatchId).nullsNotDistinct(),
    index("head_to_head_features_team_pair_idx").on(table.teamAId, table.teamBId)
  ]
);

export const matchAnalysisFeatures = pgTable(
  "match_analysis_features",
  {
    id,
    matchId: uuid("match_id").notNull().references(() => matches.id),
    featuresJson: jsonb("features_json").$type<Record<string, unknown>>().notNull().default({}),
    contentHash: text("content_hash"),
    createdAt,
    updatedAt
  },
  (table) => [uniqueIndex("match_analysis_features_match_uidx").on(table.matchId)]
);

export const competitionTeamFeatures = pgTable(
  "competition_team_features",
  {
    id,
    competitionId: uuid("competition_id").notNull().references(() => competitions.id),
    seasonId: uuid("season_id").references(() => seasons.id),
    teamId: uuid("team_id").notNull().references(() => teams.id),
    featuresJson: jsonb("features_json").$type<Record<string, unknown>>().notNull().default({}),
    contentHash: text("content_hash"),
    createdAt,
    updatedAt
  },
  (table) => [
    unique("competition_team_features_uidx").on(table.competitionId, table.seasonId, table.teamId).nullsNotDistinct(),
    index("competition_team_features_lookup_idx").on(table.competitionId, table.seasonId, table.teamId)
  ]
);
