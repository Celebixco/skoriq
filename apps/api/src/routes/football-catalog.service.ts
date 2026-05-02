import { Injectable, NotFoundException } from "@nestjs/common";
import { loadConfig } from "@sports-data/config";
import { createDatabase } from "@sports-data/database";
import type { Database } from "@sports-data/database";
import { sql } from "drizzle-orm";

export interface FootballCatalogPagination {
  limit: number;
  offset: number;
  total: number;
}

export interface FootballTeamsFilters {
  competitionId?: string;
  search?: string;
  limit: number;
  offset: number;
}

export interface FootballCompetitionsFilters {
  limit: number;
  offset: number;
}

export type FootballCompetitionDataStatus = "ready" | "partial" | "insufficient";

export interface FootballCountrySummary {
  id: string;
  name: string;
  logoUrl: string | null;
  competitionCount: number;
  teamCount: number;
  matchCount: number;
  finishedMatchCount: number;
  upcomingMatchCount: number;
  averageCoverage: number | null;
}

export interface FootballTeamSummary {
  teamId: string;
  name: string;
  shortName: string | null;
  logoUrl: string | null;
  country: string | null;
  competitions: Array<{
    competitionId: string;
    name: string;
    country: string | null;
  }>;
  matchesCount: number;
  hasLogo: boolean;
  latestFormCoverage: number | null;
}

export interface FootballTeamDetail extends FootballTeamSummary {
  recentMatches: FootballCatalogMatchSummary[];
  latestForm: Array<{
    featureId: string;
    competitionId: string | null;
    windowSize: number;
    scope: string;
    sampleSize: number;
    coverageScore: number;
    points: number;
    avgGoalsFor: number | null;
    avgGoalsAgainst: number | null;
  }>;
  analyticsReadiness: AnalyticsReadinessSummary;
}

export interface FootballTeamProfile {
  team: {
    id: string;
    name: string;
    logoUrl: string | null;
    country: string | null;
    primaryCompetition: {
      id: string;
      name: string;
      country: string | null;
    } | null;
  };
  standing: FootballTeamProfileStanding | null;
  formSummary: {
    overall: FootballTeamProfileFormSummary | null;
    home: FootballTeamProfileFormSummary | null;
    away: FootballTeamProfileFormSummary | null;
  };
  goalProfile: FootballTeamProfileGoalProfile;
  recentMatches: FootballTeamProfileRecentMatch[];
  upcomingMatches: FootballTeamProfileUpcomingMatch[];
  dataCoverage: FootballTeamProfileDataCoverage;
}

export interface FootballTeamProfileStanding {
  position: number;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
}

export interface FootballTeamProfileFormSummary {
  featureId: string;
  competitionId: string | null;
  windowSize: number;
  scope: string;
  sampleSize: number;
  coverageScore: number;
  matchesPlayed: number;
  wins: number;
  draws: number;
  losses: number;
  points: number;
  avgGoalsFor: number | null;
  avgGoalsAgainst: number | null;
  bothTeamsToScoreRate: number | null;
  over05Rate: number | null;
  over15Rate: number | null;
  over25Rate: number | null;
  under25Rate: number | null;
  scoredRate: number | null;
  concededRate: number | null;
  teamOver05Rate: number | null;
  teamOver15Rate: number | null;
  firstHalfOver05Rate: number | null;
  firstHalfAvgGoalsFor: number | null;
  firstHalfAvgGoalsAgainst: number | null;
}

export interface FootballTeamProfileGoalProfile {
  scoredRate: number | null;
  concededRate: number | null;
  teamOver05Rate: number | null;
  teamOver15Rate: number | null;
  under25Rate: number | null;
  firstHalfOver05Rate: number | null;
  firstHalfAvgGoalsFor: number | null;
  firstHalfAvgGoalsAgainst: number | null;
}

export interface FootballTeamProfileRecentMatch {
  matchId: string;
  date: string;
  competition: string;
  opponent: {
    id: string;
    name: string;
    logoUrl: string | null;
  };
  homeAway: "home" | "away";
  fulltimeScore: string | null;
  halftimeScore: string | null;
  result: "W" | "D" | "L" | null;
}

export interface FootballTeamProfileUpcomingMatch {
  matchId: string;
  date: string;
  competition: string;
  opponent: {
    id: string;
    name: string;
    logoUrl: string | null;
  };
  homeAway: "home" | "away";
  status: string;
  analysisStatus: string | null;
}

export interface FootballTeamProfileDataCoverage {
  matchesAvailable: number;
  scoresAvailable: number;
  formCoverageScore: number | null;
  hasStanding: boolean;
  hasLogo: boolean;
  playersAvailable: boolean;
  lineupsAvailable: boolean;
  injuriesAvailable: boolean;
}

export interface FootballCompetitionSummary {
  competitionId: string;
  name: string;
  country: string | null;
  teamsCount: number;
  matchesCount: number;
  readyMatchesCount: number;
  averageCoverage: number | null;
}

export interface FootballCompetitionDetail extends FootballCompetitionSummary {
  teams: FootballTeamSummary[];
  matches: FootballCatalogMatchSummary[];
  standings: Array<{
    teamId: string;
    teamName: string;
    logoUrl: string | null;
    position: number;
    played: number;
    wins: number;
    draws: number;
    losses: number;
    goalsFor: number;
    goalsAgainst: number;
    goalDifference: number;
    points: number;
  }>;
  analyticsReadiness: AnalyticsReadinessSummary;
}

export interface FootballCompetitionExplorerSummary {
  id: string;
  name: string;
  country: {
    id: string;
    name: string;
  };
  logoUrl: string | null;
  teamCount: number;
  standingRows: number;
  matchCount: number;
  finishedMatchCount: number;
  upcomingMatchCount: number;
  averageCoverage: number | null;
  dataStatus: FootballCompetitionDataStatus;
}

export interface FootballCompetitionProfile {
  competition: {
    id: string;
    name: string;
    logoUrl: string | null;
    country: {
      id: string;
      name: string;
      logoUrl: string | null;
    };
  };
  summary: {
    teamCount: number;
    standingRows: number;
    matchCount: number;
    finishedMatchCount: number;
    upcomingMatchCount: number;
    averageCoverage: number | null;
    h2hSupportedUpcomingCount: number;
    predictionReadyUpcomingCount: number;
  };
  standings: FootballCompetitionDetail["standings"];
  teams: FootballTeamSummary[];
  upcomingMatches: FootballCatalogMatchSummary[];
  recentMatches: FootballCatalogMatchSummary[];
  dataCoverage: {
    dataStatus: FootballCompetitionDataStatus;
    hasStandings: boolean;
    hasTeams: boolean;
    hasRecentScores: boolean;
    hasUpcomingMatches: boolean;
    averageCoverage: number | null;
  };
}

export interface FootballCatalogListResponse<T> {
  items: T[];
  pagination: FootballCatalogPagination;
}

export interface FootballCatalogMatchSummary {
  matchId: string;
  competition: {
    id: string;
    name: string;
    country: string | null;
  };
  kickoffAt: string;
  status: string;
  homeTeam: {
    id: string;
    name: string;
    logoUrl: string | null;
  };
  awayTeam: {
    id: string;
    name: string;
    logoUrl: string | null;
  };
  featureStatus: string | null;
  combinedCoverageScore: number | null;
}

export interface AnalyticsReadinessSummary {
  analyzedMatchesCount: number;
  readyMatchesCount: number;
  partialMatchesCount: number;
  insufficientDataMatchesCount: number;
  averageCoverage: number | null;
}

interface TeamRow {
  team_id: string;
  name: string;
  short_name: string | null;
  logo_url: string | null;
  country: string | null;
  competitions: unknown;
  matches_count: string | number | null;
  latest_form_coverage: string | number | null;
}

export interface TeamProfileIdentityRow {
  team_id: string;
  name: string;
  logo_url: string | null;
  country: string | null;
  primary_competition_id: string | null;
  primary_competition_name: string | null;
  primary_competition_country: string | null;
}

interface CompetitionRow {
  competition_id: string;
  name: string;
  country: string | null;
  teams_count: string | number | null;
  matches_count: string | number | null;
  ready_matches_count: string | number | null;
  average_coverage: string | number | null;
}

export interface CountryExplorerRow {
  country_id: string;
  name: string;
  competition_count: string | number | null;
  team_count: string | number | null;
  match_count: string | number | null;
  finished_match_count: string | number | null;
  upcoming_match_count: string | number | null;
  average_coverage: string | number | null;
}

export interface CompetitionExplorerRow {
  competition_id: string;
  name: string;
  competition_metadata_json: unknown;
  country_id: string;
  country_name: string;
  team_count: string | number | null;
  standing_rows: string | number | null;
  match_count: string | number | null;
  finished_match_count: string | number | null;
  upcoming_match_count: string | number | null;
  average_coverage: string | number | null;
  h2h_supported_upcoming_count: string | number | null;
  prediction_ready_upcoming_count: string | number | null;
}

interface MatchRow {
  match_id: string;
  competition_id: string;
  competition: string;
  country: string | null;
  kickoff_at: Date | string;
  status: string;
  home_team_id: string;
  home_team: string;
  home_team_logo_url: string | null;
  away_team_id: string;
  away_team: string;
  away_team_logo_url: string | null;
  feature_status: string | null;
  combined_coverage_score: string | number | null;
}

export interface TeamProfileMatchRow {
  match_id: string;
  competition: string;
  kickoff_at: Date | string;
  status: string;
  home_team_id: string;
  home_team: string;
  home_team_logo_url: string | null;
  away_team_id: string;
  away_team: string;
  away_team_logo_url: string | null;
  home_score_fulltime: string | number | null;
  away_score_fulltime: string | number | null;
  home_score_current: string | number | null;
  away_score_current: string | number | null;
  home_score_halftime: string | number | null;
  away_score_halftime: string | number | null;
  feature_status: string | null;
}

export interface FormRow {
  feature_id: string;
  competition_id: string | null;
  window_size: number;
  scope: string;
  sample_size: number;
  coverage_score: string | number;
  points: number;
  avg_goals_for: string | number | null;
  avg_goals_against: string | number | null;
}

export interface TeamProfileFormRow extends FormRow {
  matches_played: string | number | null;
  wins: string | number | null;
  draws: string | number | null;
  losses: string | number | null;
  both_teams_to_score_rate: string | number | null;
  over_0_5_rate: string | number | null;
  over_1_5_rate: string | number | null;
  over_2_5_rate: string | number | null;
  under_2_5_rate: string | number | null;
  scored_rate: string | number | null;
  conceded_rate: string | number | null;
  team_over_0_5_rate: string | number | null;
  team_over_1_5_rate: string | number | null;
  first_half_over_0_5_rate: string | number | null;
  first_half_avg_goals_for: string | number | null;
  first_half_avg_goals_against: string | number | null;
}

interface StandingRow {
  team_id: string;
  team_name: string;
  logo_url: string | null;
  position: number;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goals_for: number;
  goals_against: number;
  goal_difference: number;
  points: number;
}

export interface TeamProfileStandingRow {
  position: string | number | null;
  played: string | number | null;
  wins: string | number | null;
  draws: string | number | null;
  losses: string | number | null;
  goals_for: string | number | null;
  goals_against: string | number | null;
  goal_difference: string | number | null;
  points: string | number | null;
}

export interface TeamProfileCoverageRow {
  matches_available: string | number | null;
  scores_available: string | number | null;
}

interface ReadinessRow {
  analyzed_matches_count: string | number | null;
  ready_matches_count: string | number | null;
  partial_matches_count: string | number | null;
  insufficient_data_matches_count: string | number | null;
  average_coverage: string | number | null;
}

@Injectable()
export class FootballCatalogService {
  private readonly database: Database;

  constructor(database?: Database) {
    this.database = database ?? createDatabase(loadConfig().DATABASE_URL);
  }

  async listCountries(): Promise<FootballCountrySummary[]> {
    const rows = await executeRows<CountryExplorerRow>(
      this.database,
      sql`
        with competition_team_ids as (
          select m.competition_id, m.home_team_id as team_id
          from matches m
          union
          select m.competition_id, m.away_team_id as team_id
          from matches m
          union
          select fs.competition_id, fs.team_id
          from football_standings fs
        ),
        competition_metrics as (
          select
            c.id as competition_id,
            c.country_id,
            count(distinct ct.team_id) as team_count,
            count(distinct m.id) as match_count,
            count(distinct m.id) filter (where m.status in ('finished', 'after_extra_time', 'after_penalties')) as finished_match_count,
            count(distinct m.id) filter (where m.status in ('scheduled', 'not_started')) as upcoming_match_count,
            avg(f.combined_coverage_score) as average_coverage
          from competitions c
          inner join sports s on s.id = c.sport_id and s.slug = 'football'
          left join competition_team_ids ct on ct.competition_id = c.id
          left join matches m on m.competition_id = c.id
          left join football_match_prediction_features f on f.match_id = m.id
            and f.form_window_size = 5
            and f.h2h_window_size = 5
          group by c.id, c.country_id
        )
        select
          co.id as country_id,
          co.name,
          count(distinct cm.competition_id) as competition_count,
          coalesce(sum(cm.team_count), 0) as team_count,
          coalesce(sum(cm.match_count), 0) as match_count,
          coalesce(sum(cm.finished_match_count), 0) as finished_match_count,
          coalesce(sum(cm.upcoming_match_count), 0) as upcoming_match_count,
          avg(cm.average_coverage) filter (where cm.average_coverage is not null) as average_coverage
        from countries co
        inner join competition_metrics cm on cm.country_id = co.id
        group by co.id, co.name
        order by co.name asc
      `
    );
    return rows.map(mapCountryExplorerRow);
  }

  async listTeams(filters: FootballTeamsFilters): Promise<FootballCatalogListResponse<FootballTeamSummary>> {
    const rows = await this.findTeamRows(filters);
    const total = await this.countTeams(filters);
    return {
      items: rows.map(mapTeamRow),
      pagination: {
        limit: filters.limit,
        offset: filters.offset,
        total
      }
    };
  }

  async getTeam(teamId: string): Promise<FootballTeamDetail> {
    const rows = await this.findTeamRows({ limit: 1, offset: 0 }, teamId);
    const team = rows[0] ? mapTeamRow(rows[0]) : undefined;
    if (!team) {
      throw new NotFoundException("Football team not found.");
    }

    const [recentMatches, latestForm, analyticsReadiness] = await Promise.all([
      this.findRecentMatches({ teamId, limit: 10 }),
      this.findLatestFormRows(teamId),
      this.findReadinessSummary({ teamId })
    ]);

    return {
      ...team,
      recentMatches: recentMatches.map(mapMatchRow),
      latestForm: latestForm.map(mapFormRow),
      analyticsReadiness: mapReadinessRow(analyticsReadiness)
    };
  }

  async getTeamProfile(teamId: string): Promise<FootballTeamProfile> {
    const identity = await this.findTeamProfileIdentity(teamId);
    if (!identity) {
      throw new NotFoundException("Football team not found.");
    }

    const primaryCompetitionId = identity.primary_competition_id;
    const [standing, formRows, recentMatches, upcomingMatches, coverage] = await Promise.all([
      this.findTeamProfileStanding(teamId, primaryCompetitionId),
      this.findTeamProfileFormRows(teamId, primaryCompetitionId),
      this.findTeamProfileRecentMatches(teamId, 10),
      this.findTeamProfileUpcomingMatches(teamId, 5),
      this.findTeamProfileCoverage(teamId)
    ]);
    const formSummary = mapTeamProfileFormSummary(formRows);

    return {
      team: mapTeamProfileIdentityRow(identity),
      standing: standing ? mapTeamProfileStandingRow(standing) : null,
      formSummary,
      goalProfile: mapTeamProfileGoalProfile(formSummary.overall),
      recentMatches: recentMatches.map((row) => mapTeamProfileRecentMatchRow(row, teamId)),
      upcomingMatches: upcomingMatches.map((row) => mapTeamProfileUpcomingMatchRow(row, teamId)),
      dataCoverage: mapTeamProfileCoverageRow({
        row: coverage,
        formSummary,
        standing,
        logoUrl: identity.logo_url
      })
    };
  }

  async listCompetitions(filters: FootballCompetitionsFilters): Promise<FootballCatalogListResponse<FootballCompetitionSummary>> {
    const rows = await executeRows<CompetitionRow>(
      this.database,
      sql`
        select
          c.id as competition_id,
          c.name,
          co.name as country,
          count(distinct case when m.id is not null then t.team_id end) as teams_count,
          count(distinct m.id) as matches_count,
          count(distinct case when f.feature_status = 'ready' then f.match_id end) as ready_matches_count,
          avg(f.combined_coverage_score) as average_coverage
        from competitions c
        inner join sports s on s.id = c.sport_id and s.slug = 'football'
        left join countries co on co.id = c.country_id
        left join matches m on m.competition_id = c.id
        left join lateral (
          values (m.home_team_id), (m.away_team_id)
        ) as t(team_id) on true
        left join football_match_prediction_features f on f.match_id = m.id
          and f.form_window_size = 5
          and f.h2h_window_size = 5
        group by c.id, c.name, co.name
        order by c.name asc
        limit ${filters.limit}
        offset ${filters.offset}
      `
    );
    const totalRows = await executeRows<{ count: string | number }>(
      this.database,
      sql`
        select count(*) as count
        from competitions c
        inner join sports s on s.id = c.sport_id and s.slug = 'football'
      `
    );
    return {
      items: rows.map(mapCompetitionRow),
      pagination: {
        limit: filters.limit,
        offset: filters.offset,
        total: integer(totalRows[0]?.count)
      }
    };
  }

  async listCompetitionsForCountry(countryId: string): Promise<FootballCompetitionExplorerSummary[]> {
    const country = await this.findCountryById(countryId);
    if (!country) {
      throw new NotFoundException("Football country not found.");
    }

    const rows = await this.findCompetitionExplorerRows(countryId);
    return rows.map(mapCompetitionExplorerRow);
  }

  async getCompetition(competitionId: string): Promise<FootballCompetitionDetail> {
    const rows = await executeRows<CompetitionRow>(
      this.database,
      sql`
        select
          c.id as competition_id,
          c.name,
          co.name as country,
          count(distinct case when m.id is not null then t.team_id end) as teams_count,
          count(distinct m.id) as matches_count,
          count(distinct case when f.feature_status = 'ready' then f.match_id end) as ready_matches_count,
          avg(f.combined_coverage_score) as average_coverage
        from competitions c
        inner join sports s on s.id = c.sport_id and s.slug = 'football'
        left join countries co on co.id = c.country_id
        left join matches m on m.competition_id = c.id
        left join lateral (
          values (m.home_team_id), (m.away_team_id)
        ) as t(team_id) on true
        left join football_match_prediction_features f on f.match_id = m.id
          and f.form_window_size = 5
          and f.h2h_window_size = 5
        where c.id = ${competitionId}
        group by c.id, c.name, co.name
        limit 1
      `
    );
    const competition = rows[0] ? mapCompetitionRow(rows[0]) : undefined;
    if (!competition) {
      throw new NotFoundException("Football competition not found.");
    }

    const [teams, matches, standings, readiness] = await Promise.all([
      this.findTeamRows({ competitionId, limit: 100, offset: 0 }),
      this.findRecentMatches({ competitionId, limit: 20 }),
      this.findStandings(competitionId),
      this.findReadinessSummary({ competitionId })
    ]);

    return {
      ...competition,
      teams: teams.map(mapTeamRow),
      matches: matches.map(mapMatchRow),
      standings: standings.map(mapStandingRow),
      analyticsReadiness: mapReadinessRow(readiness)
    };
  }

  async getCompetitionProfile(competitionId: string): Promise<FootballCompetitionProfile> {
    const rows = await this.findCompetitionExplorerRows(undefined, competitionId);
    const summaryRow = rows[0];
    if (!summaryRow) {
      throw new NotFoundException("Football competition not found.");
    }

    const [standings, teams, upcomingMatches, recentMatches] = await Promise.all([
      this.findStandings(competitionId),
      this.findTeamRows({ competitionId, limit: 100, offset: 0 }),
      this.findCompetitionMatches({ competitionId, kind: "upcoming", limit: 10 }),
      this.findCompetitionMatches({ competitionId, kind: "recent", limit: 10 })
    ]);

    return mapCompetitionProfile({
      summaryRow,
      standings: standings.map(mapStandingRow),
      teams: teams.map(mapTeamRow),
      upcomingMatches: upcomingMatches.map(mapMatchRow),
      recentMatches: recentMatches.map(mapMatchRow)
    });
  }

  private async findCountryById(countryId: string): Promise<{ id: string } | undefined> {
    const rows = await executeRows<{ id: string }>(
      this.database,
      sql`
        select co.id
        from countries co
        where co.id = ${countryId}
        limit 1
      `
    );
    return rows[0];
  }

  private async findCompetitionExplorerRows(countryId?: string, competitionId?: string): Promise<CompetitionExplorerRow[]> {
    const countryFilter = countryId ? sql`and c.country_id = ${countryId}` : sql``;
    const competitionFilter = competitionId ? sql`and c.id = ${competitionId}` : sql``;
    return executeRows<CompetitionExplorerRow>(
      this.database,
      sql`
        with competition_team_ids as (
          select m.competition_id, m.home_team_id as team_id
          from matches m
          union
          select m.competition_id, m.away_team_id as team_id
          from matches m
          union
          select fs.competition_id, fs.team_id
          from football_standings fs
        )
        select
          c.id as competition_id,
          c.name,
          c.metadata_json as competition_metadata_json,
          co.id as country_id,
          co.name as country_name,
          count(distinct ct.team_id) as team_count,
          count(distinct fs.team_id) as standing_rows,
          count(distinct m.id) as match_count,
          count(distinct m.id) filter (where m.status in ('finished', 'after_extra_time', 'after_penalties')) as finished_match_count,
          count(distinct m.id) filter (where m.status in ('scheduled', 'not_started')) as upcoming_match_count,
          avg(f.combined_coverage_score) as average_coverage,
          count(distinct m.id) filter (
            where m.status in ('scheduled', 'not_started') and f.h2h_feature_id is not null
          ) as h2h_supported_upcoming_count,
          count(distinct m.id) filter (
            where m.status in ('scheduled', 'not_started') and f.feature_status = 'ready'
          ) as prediction_ready_upcoming_count
        from competitions c
        inner join sports sp on sp.id = c.sport_id and sp.slug = 'football'
        inner join countries co on co.id = c.country_id
        left join competition_team_ids ct on ct.competition_id = c.id
        left join football_standings fs on fs.competition_id = c.id
        left join matches m on m.competition_id = c.id
        left join football_match_prediction_features f on f.match_id = m.id
          and f.form_window_size = 5
          and f.h2h_window_size = 5
        where true
          ${countryFilter}
          ${competitionFilter}
        group by c.id, c.name, c.metadata_json, co.id, co.name
        order by c.name asc
      `
    );
  }

  private async findTeamProfileIdentity(teamId: string): Promise<TeamProfileIdentityRow | undefined> {
    const rows = await executeRows<TeamProfileIdentityRow>(
      this.database,
      sql`
        select
          t.id as team_id,
          t.name,
          t.logo_url,
          co.name as country,
          pc.competition_id as primary_competition_id,
          pc.competition_name as primary_competition_name,
          pc.competition_country as primary_competition_country
        from teams t
        inner join sports s on s.id = t.sport_id and s.slug = 'football'
        left join countries co on co.id = t.country_id
        left join lateral (
          select
            c.id as competition_id,
            c.name as competition_name,
            cco.name as competition_country
          from (
            select fs.competition_id, 2 as priority, fs.updated_at as sort_date
            from football_standings fs
            where fs.team_id = t.id
            union all
            select m.competition_id, 1 as priority, max(m.scheduled_start_at) as sort_date
            from matches m
            where m.home_team_id = t.id or m.away_team_id = t.id
            group by m.competition_id
          ) ranked
          inner join competitions c on c.id = ranked.competition_id
          left join countries cco on cco.id = c.country_id
          order by ranked.priority desc, ranked.sort_date desc nulls last, c.name asc
          limit 1
        ) pc on true
        where t.id = ${teamId}
        limit 1
      `
    );
    return rows[0];
  }

  private async findTeamProfileStanding(teamId: string, competitionId: string | null): Promise<TeamProfileStandingRow | undefined> {
    const competitionFilter = competitionId ? sql`and fs.competition_id = ${competitionId}` : sql``;
    const rows = await executeRows<TeamProfileStandingRow>(
      this.database,
      sql`
        select
          fs.position,
          fs.played,
          fs.wins,
          fs.draws,
          fs.losses,
          fs.goals_for,
          fs.goals_against,
          fs.goal_difference,
          fs.points
        from football_standings fs
        where fs.team_id = ${teamId}
          ${competitionFilter}
        order by fs.updated_at desc, fs.created_at desc
        limit 1
      `
    );
    return rows[0];
  }

  private async findTeamProfileFormRows(teamId: string, competitionId: string | null): Promise<TeamProfileFormRow[]> {
    const competitionPreference = competitionId ? sql`case when f.competition_id = ${competitionId} then 0 else 1 end` : sql`0`;
    return executeRows<TeamProfileFormRow>(
      this.database,
      sql`
        select distinct on (f.scope)
          f.id as feature_id,
          f.competition_id,
          f.window_size,
          f.scope,
          f.sample_size,
          f.coverage_score,
          f.matches_played,
          f.wins,
          f.draws,
          f.losses,
          f.points,
          f.avg_goals_for,
          f.avg_goals_against,
          f.both_teams_to_score_rate,
          f.over_0_5_rate,
          f.over_1_5_rate,
          f.over_2_5_rate,
          f.under_2_5_rate,
          f.scored_rate,
          f.conceded_rate,
          f.team_over_0_5_rate,
          f.team_over_1_5_rate,
          f.first_half_over_0_5_rate,
          f.first_half_avg_goals_for,
          f.first_half_avg_goals_against
        from football_team_form_features f
        where f.team_id = ${teamId}
          and f.window_size = 5
          and f.as_of_match_id is null
        order by f.scope, ${competitionPreference}, f.as_of_date desc, f.updated_at desc
      `
    );
  }

  private async findTeamProfileRecentMatches(teamId: string, limit: number): Promise<TeamProfileMatchRow[]> {
    return executeRows<TeamProfileMatchRow>(
      this.database,
      sql`
        select
          m.id as match_id,
          c.name as competition,
          m.scheduled_start_at as kickoff_at,
          m.status,
          home.id as home_team_id,
          home.name as home_team,
          home.logo_url as home_team_logo_url,
          away.id as away_team_id,
          away.name as away_team,
          away.logo_url as away_team_logo_url,
          s.home_score_fulltime,
          s.away_score_fulltime,
          s.home_score_current,
          s.away_score_current,
          s.home_score_halftime,
          s.away_score_halftime,
          null::text as feature_status
        from matches m
        inner join sports sp on sp.id = m.sport_id and sp.slug = 'football'
        inner join competitions c on c.id = m.competition_id
        inner join teams home on home.id = m.home_team_id
        inner join teams away on away.id = m.away_team_id
        left join football_match_scores s on s.match_id = m.id
        where (m.home_team_id = ${teamId} or m.away_team_id = ${teamId})
          and m.status in ('finished', 'after_extra_time', 'after_penalties')
        order by m.scheduled_start_at desc, m.id asc
        limit ${limit}
      `
    );
  }

  private async findTeamProfileUpcomingMatches(teamId: string, limit: number): Promise<TeamProfileMatchRow[]> {
    return executeRows<TeamProfileMatchRow>(
      this.database,
      sql`
        select
          m.id as match_id,
          c.name as competition,
          m.scheduled_start_at as kickoff_at,
          m.status,
          home.id as home_team_id,
          home.name as home_team,
          home.logo_url as home_team_logo_url,
          away.id as away_team_id,
          away.name as away_team,
          away.logo_url as away_team_logo_url,
          null::integer as home_score_fulltime,
          null::integer as away_score_fulltime,
          null::integer as home_score_current,
          null::integer as away_score_current,
          null::integer as home_score_halftime,
          null::integer as away_score_halftime,
          f.feature_status
        from matches m
        inner join sports sp on sp.id = m.sport_id and sp.slug = 'football'
        inner join competitions c on c.id = m.competition_id
        inner join teams home on home.id = m.home_team_id
        inner join teams away on away.id = m.away_team_id
        left join football_match_prediction_features f on f.match_id = m.id
          and f.form_window_size = 5
          and f.h2h_window_size = 5
        where (m.home_team_id = ${teamId} or m.away_team_id = ${teamId})
          and m.status in ('scheduled', 'not_started')
        order by m.scheduled_start_at asc, m.id asc
        limit ${limit}
      `
    );
  }

  private async findTeamProfileCoverage(teamId: string): Promise<TeamProfileCoverageRow | undefined> {
    const rows = await executeRows<TeamProfileCoverageRow>(
      this.database,
      sql`
        select
          count(distinct m.id) as matches_available,
          count(distinct s.id) as scores_available
        from matches m
        left join football_match_scores s on s.match_id = m.id
        where m.home_team_id = ${teamId} or m.away_team_id = ${teamId}
      `
    );
    return rows[0];
  }

  private async findTeamRows(filters: FootballTeamsFilters, teamId?: string): Promise<TeamRow[]> {
    const competitionFilter = filters.competitionId ? sql`and m.competition_id = ${filters.competitionId}` : sql``;
    const competitionExists = filters.competitionId
      ? sql`
          and exists (
            select 1
            from matches competition_match
            where (competition_match.home_team_id = t.id or competition_match.away_team_id = t.id)
              and competition_match.competition_id = ${filters.competitionId}
            union all
            select 1
            from football_standings competition_standing
            where competition_standing.team_id = t.id
              and competition_standing.competition_id = ${filters.competitionId}
          )
        `
      : sql``;
    const searchFilter = filters.search ? sql`and t.name ilike ${`%${filters.search}%`}` : sql``;
    const teamFilter = teamId ? sql`and t.id = ${teamId}` : sql``;

    return executeRows<TeamRow>(
      this.database,
      sql`
        select
          t.id as team_id,
          t.name,
          t.short_name,
          t.logo_url,
          co.name as country,
          coalesce(
            jsonb_agg(distinct jsonb_build_object(
              'competitionId', c.id,
              'name', c.name,
              'country', cco.name
            )) filter (where c.id is not null),
            '[]'::jsonb
          ) as competitions,
          count(distinct m.id) as matches_count,
          (
            select f.coverage_score
            from football_team_form_features f
            where f.team_id = t.id
              ${filters.competitionId ? sql`and f.competition_id = ${filters.competitionId}` : sql``}
            order by f.as_of_date desc, f.updated_at desc
            limit 1
          ) as latest_form_coverage
        from teams t
        inner join sports s on s.id = t.sport_id and s.slug = 'football'
        left join countries co on co.id = t.country_id
        left join matches m on (m.home_team_id = t.id or m.away_team_id = t.id)
          ${competitionFilter}
        left join competitions c on c.id = m.competition_id
        left join countries cco on cco.id = c.country_id
        where true
          ${teamFilter}
          ${competitionExists}
          ${searchFilter}
        group by t.id, t.name, t.short_name, t.logo_url, co.name
        order by t.name asc
        limit ${filters.limit}
        offset ${filters.offset}
      `
    );
  }

  private async countTeams(filters: FootballTeamsFilters): Promise<number> {
    const competitionExists = filters.competitionId
      ? sql`
          and exists (
            select 1
            from matches m
            where (m.home_team_id = t.id or m.away_team_id = t.id)
              and m.competition_id = ${filters.competitionId}
            union all
            select 1
            from football_standings fs
            where fs.team_id = t.id
              and fs.competition_id = ${filters.competitionId}
          )
        `
      : sql``;
    const searchFilter = filters.search ? sql`and t.name ilike ${`%${filters.search}%`}` : sql``;
    const rows = await executeRows<{ count: string | number }>(
      this.database,
      sql`
        select count(*) as count
        from teams t
        inner join sports s on s.id = t.sport_id and s.slug = 'football'
        where true
          ${competitionExists}
          ${searchFilter}
      `
    );
    return integer(rows[0]?.count);
  }

  private async findRecentMatches(filters: { teamId?: string; competitionId?: string; limit: number }): Promise<MatchRow[]> {
    const teamFilter = filters.teamId ? sql`and (m.home_team_id = ${filters.teamId} or m.away_team_id = ${filters.teamId})` : sql``;
    const competitionFilter = filters.competitionId ? sql`and m.competition_id = ${filters.competitionId}` : sql``;
    return executeRows<MatchRow>(
      this.database,
      sql`
        select
          m.id as match_id,
          c.id as competition_id,
          c.name as competition,
          co.name as country,
          m.scheduled_start_at as kickoff_at,
          m.status,
          home.id as home_team_id,
          home.name as home_team,
          home.logo_url as home_team_logo_url,
          away.id as away_team_id,
          away.name as away_team,
          away.logo_url as away_team_logo_url,
          f.feature_status,
          f.combined_coverage_score
        from matches m
        inner join sports s on s.id = m.sport_id and s.slug = 'football'
        inner join competitions c on c.id = m.competition_id
        left join countries co on co.id = c.country_id
        inner join teams home on home.id = m.home_team_id
        inner join teams away on away.id = m.away_team_id
        left join football_match_prediction_features f on f.match_id = m.id
          and f.form_window_size = 5
          and f.h2h_window_size = 5
        where true
          ${teamFilter}
          ${competitionFilter}
        order by m.scheduled_start_at desc, m.id asc
        limit ${filters.limit}
      `
    );
  }

  private async findCompetitionMatches(filters: { competitionId: string; kind: "upcoming" | "recent"; limit: number }): Promise<MatchRow[]> {
    const statusFilter =
      filters.kind === "upcoming"
        ? sql`and m.status in ('scheduled', 'not_started')`
        : sql`and m.status in ('finished', 'after_extra_time', 'after_penalties')`;
    const orderBy =
      filters.kind === "upcoming" ? sql`m.scheduled_start_at asc, m.id asc` : sql`m.scheduled_start_at desc, m.id asc`;
    return executeRows<MatchRow>(
      this.database,
      sql`
        select
          m.id as match_id,
          c.id as competition_id,
          c.name as competition,
          co.name as country,
          m.scheduled_start_at as kickoff_at,
          m.status,
          home.id as home_team_id,
          home.name as home_team,
          home.logo_url as home_team_logo_url,
          away.id as away_team_id,
          away.name as away_team,
          away.logo_url as away_team_logo_url,
          f.feature_status,
          f.combined_coverage_score
        from matches m
        inner join sports s on s.id = m.sport_id and s.slug = 'football'
        inner join competitions c on c.id = m.competition_id
        left join countries co on co.id = c.country_id
        inner join teams home on home.id = m.home_team_id
        inner join teams away on away.id = m.away_team_id
        left join football_match_prediction_features f on f.match_id = m.id
          and f.form_window_size = 5
          and f.h2h_window_size = 5
        where m.competition_id = ${filters.competitionId}
          ${statusFilter}
        order by ${orderBy}
        limit ${filters.limit}
      `
    );
  }

  private async findLatestFormRows(teamId: string): Promise<FormRow[]> {
    return executeRows<FormRow>(
      this.database,
      sql`
        select
          id as feature_id,
          competition_id,
          window_size,
          scope,
          sample_size,
          coverage_score,
          points,
          avg_goals_for,
          avg_goals_against
        from football_team_form_features
        where team_id = ${teamId}
        order by as_of_date desc, window_size asc, scope asc
        limit 12
      `
    );
  }

  private async findStandings(competitionId: string): Promise<StandingRow[]> {
    return executeRows<StandingRow>(
      this.database,
      sql`
        select
          fs.team_id,
          t.name as team_name,
          t.logo_url,
          fs.position,
          fs.played,
          fs.wins,
          fs.draws,
          fs.losses,
          fs.goals_for,
          fs.goals_against,
          fs.goal_difference,
          fs.points
        from football_standings fs
        inner join teams t on t.id = fs.team_id
        where fs.competition_id = ${competitionId}
        order by fs.position asc, t.name asc
        limit 100
      `
    );
  }

  private async findReadinessSummary(filters: { teamId?: string; competitionId?: string }): Promise<ReadinessRow | undefined> {
    const teamFilter = filters.teamId ? sql`and (m.home_team_id = ${filters.teamId} or m.away_team_id = ${filters.teamId})` : sql``;
    const competitionFilter = filters.competitionId ? sql`and m.competition_id = ${filters.competitionId}` : sql``;
    const rows = await executeRows<ReadinessRow>(
      this.database,
      sql`
        select
          count(*) as analyzed_matches_count,
          count(*) filter (where f.feature_status = 'ready') as ready_matches_count,
          count(*) filter (where f.feature_status = 'partial') as partial_matches_count,
          count(*) filter (where f.feature_status = 'insufficient_data') as insufficient_data_matches_count,
          avg(f.combined_coverage_score) as average_coverage
        from football_match_prediction_features f
        inner join matches m on m.id = f.match_id
        where f.form_window_size = 5
          and f.h2h_window_size = 5
          ${teamFilter}
          ${competitionFilter}
      `
    );
    return rows[0];
  }
}

export function mapTeamRow(row: TeamRow): FootballTeamSummary {
  return {
    teamId: row.team_id,
    name: row.name,
    shortName: row.short_name,
    logoUrl: row.logo_url,
    country: row.country,
    competitions: parseCompetitions(row.competitions),
    matchesCount: integer(row.matches_count),
    hasLogo: Boolean(row.logo_url),
    latestFormCoverage: numberOrNull(row.latest_form_coverage)
  };
}

export function mapCountryExplorerRow(row: CountryExplorerRow): FootballCountrySummary {
  return {
    id: row.country_id,
    name: row.name,
    logoUrl: null,
    competitionCount: integer(row.competition_count),
    teamCount: integer(row.team_count),
    matchCount: integer(row.match_count),
    finishedMatchCount: integer(row.finished_match_count),
    upcomingMatchCount: integer(row.upcoming_match_count),
    averageCoverage: numberOrNull(row.average_coverage)
  };
}

export function mapCompetitionRow(row: CompetitionRow): FootballCompetitionSummary {
  return {
    competitionId: row.competition_id,
    name: row.name,
    country: row.country,
    teamsCount: integer(row.teams_count),
    matchesCount: integer(row.matches_count),
    readyMatchesCount: integer(row.ready_matches_count),
    averageCoverage: numberOrNull(row.average_coverage)
  };
}

export function mapCompetitionExplorerRow(row: CompetitionExplorerRow): FootballCompetitionExplorerSummary {
  const mapped = {
    id: row.competition_id,
    name: row.name,
    country: {
      id: row.country_id,
      name: row.country_name
    },
    logoUrl: publicLogoUrlFromMetadata(row.competition_metadata_json),
    teamCount: integer(row.team_count),
    standingRows: integer(row.standing_rows),
    matchCount: integer(row.match_count),
    finishedMatchCount: integer(row.finished_match_count),
    upcomingMatchCount: integer(row.upcoming_match_count),
    averageCoverage: numberOrNull(row.average_coverage),
    dataStatus: "insufficient" as FootballCompetitionDataStatus
  };
  return {
    ...mapped,
    dataStatus: resolveCompetitionDataStatus(mapped)
  };
}

export function mapCompetitionProfile(input: {
  summaryRow: CompetitionExplorerRow;
  standings: FootballCompetitionDetail["standings"];
  teams: FootballTeamSummary[];
  upcomingMatches: FootballCatalogMatchSummary[];
  recentMatches: FootballCatalogMatchSummary[];
}): FootballCompetitionProfile {
  const summary = mapCompetitionExplorerRow(input.summaryRow);
  const h2hSupportedUpcomingCount = integer(input.summaryRow.h2h_supported_upcoming_count);
  const predictionReadyUpcomingCount = integer(input.summaryRow.prediction_ready_upcoming_count);
  return {
    competition: {
      id: summary.id,
      name: summary.name,
      logoUrl: summary.logoUrl,
      country: {
        id: summary.country.id,
        name: summary.country.name,
        logoUrl: null
      }
    },
    summary: {
      teamCount: summary.teamCount,
      standingRows: summary.standingRows,
      matchCount: summary.matchCount,
      finishedMatchCount: summary.finishedMatchCount,
      upcomingMatchCount: summary.upcomingMatchCount,
      averageCoverage: summary.averageCoverage,
      h2hSupportedUpcomingCount,
      predictionReadyUpcomingCount
    },
    standings: input.standings,
    teams: input.teams,
    upcomingMatches: input.upcomingMatches,
    recentMatches: input.recentMatches,
    dataCoverage: {
      dataStatus: summary.dataStatus,
      hasStandings: summary.standingRows > 0,
      hasTeams: summary.teamCount > 0,
      hasRecentScores: summary.finishedMatchCount > 0,
      hasUpcomingMatches: summary.upcomingMatchCount > 0,
      averageCoverage: summary.averageCoverage
    }
  };
}

export function mapMatchRow(row: MatchRow): FootballCatalogMatchSummary {
  return {
    matchId: row.match_id,
    competition: {
      id: row.competition_id,
      name: row.competition,
      country: row.country
    },
    kickoffAt: row.kickoff_at instanceof Date ? row.kickoff_at.toISOString() : new Date(row.kickoff_at).toISOString(),
    status: row.status,
    homeTeam: {
      id: row.home_team_id,
      name: row.home_team,
      logoUrl: row.home_team_logo_url
    },
    awayTeam: {
      id: row.away_team_id,
      name: row.away_team,
      logoUrl: row.away_team_logo_url
    },
    featureStatus: row.feature_status,
    combinedCoverageScore: numberOrNull(row.combined_coverage_score)
  };
}

export function mapReadinessRow(row: ReadinessRow | undefined): AnalyticsReadinessSummary {
  return {
    analyzedMatchesCount: integer(row?.analyzed_matches_count),
    readyMatchesCount: integer(row?.ready_matches_count),
    partialMatchesCount: integer(row?.partial_matches_count),
    insufficientDataMatchesCount: integer(row?.insufficient_data_matches_count),
    averageCoverage: numberOrNull(row?.average_coverage ?? null)
  };
}

function mapFormRow(row: FormRow): FootballTeamDetail["latestForm"][number] {
  return {
    featureId: row.feature_id,
    competitionId: row.competition_id,
    windowSize: row.window_size,
    scope: row.scope,
    sampleSize: row.sample_size,
    coverageScore: Number(row.coverage_score),
    points: row.points,
    avgGoalsFor: numberOrNull(row.avg_goals_for),
    avgGoalsAgainst: numberOrNull(row.avg_goals_against)
  };
}

function mapStandingRow(row: StandingRow): FootballCompetitionDetail["standings"][number] {
  return {
    teamId: row.team_id,
    teamName: row.team_name,
    logoUrl: row.logo_url,
    position: row.position,
    played: row.played,
    wins: row.wins,
    draws: row.draws,
    losses: row.losses,
    goalsFor: row.goals_for,
    goalsAgainst: row.goals_against,
    goalDifference: row.goal_difference,
    points: row.points
  };
}

export function mapTeamProfileIdentityRow(row: TeamProfileIdentityRow): FootballTeamProfile["team"] {
  return {
    id: row.team_id,
    name: row.name,
    logoUrl: row.logo_url,
    country: row.country,
    primaryCompetition:
      row.primary_competition_id && row.primary_competition_name
        ? {
            id: row.primary_competition_id,
            name: row.primary_competition_name,
            country: row.primary_competition_country
          }
        : null
  };
}

export function mapTeamProfileStandingRow(row: TeamProfileStandingRow): FootballTeamProfileStanding {
  return {
    position: integer(row.position),
    played: integer(row.played),
    wins: integer(row.wins),
    draws: integer(row.draws),
    losses: integer(row.losses),
    goalsFor: integer(row.goals_for),
    goalsAgainst: integer(row.goals_against),
    goalDifference: integer(row.goal_difference),
    points: integer(row.points)
  };
}

export function mapTeamProfileFormSummary(rows: TeamProfileFormRow[]): FootballTeamProfile["formSummary"] {
  const mapped = rows.map(mapTeamProfileFormRow);
  return {
    overall: mapped.find((row) => row.scope === "overall") ?? null,
    home: mapped.find((row) => row.scope === "home") ?? null,
    away: mapped.find((row) => row.scope === "away") ?? null
  };
}

export function mapTeamProfileGoalProfile(overall: FootballTeamProfileFormSummary | null): FootballTeamProfileGoalProfile {
  return {
    scoredRate: overall?.scoredRate ?? null,
    concededRate: overall?.concededRate ?? null,
    teamOver05Rate: overall?.teamOver05Rate ?? null,
    teamOver15Rate: overall?.teamOver15Rate ?? null,
    under25Rate: overall?.under25Rate ?? null,
    firstHalfOver05Rate: overall?.firstHalfOver05Rate ?? null,
    firstHalfAvgGoalsFor: overall?.firstHalfAvgGoalsFor ?? null,
    firstHalfAvgGoalsAgainst: overall?.firstHalfAvgGoalsAgainst ?? null
  };
}

export function mapTeamProfileRecentMatchRow(row: TeamProfileMatchRow, teamId: string): FootballTeamProfileRecentMatch {
  const isHome = row.home_team_id === teamId;
  const homeScore = firstNumber(row.home_score_fulltime, row.home_score_current);
  const awayScore = firstNumber(row.away_score_fulltime, row.away_score_current);
  const ownScore = isHome ? homeScore : awayScore;
  const opponentScore = isHome ? awayScore : homeScore;
  const fulltimeScore = formatScore(row.home_score_fulltime, row.away_score_fulltime) ?? formatScore(row.home_score_current, row.away_score_current);
  const halftimeScore = formatScore(row.home_score_halftime, row.away_score_halftime);

  return {
    matchId: row.match_id,
    date: toIso(row.kickoff_at),
    competition: row.competition,
    opponent: {
      id: isHome ? row.away_team_id : row.home_team_id,
      name: isHome ? row.away_team : row.home_team,
      logoUrl: isHome ? row.away_team_logo_url : row.home_team_logo_url
    },
    homeAway: isHome ? "home" : "away",
    fulltimeScore,
    halftimeScore,
    result: mapResult(ownScore, opponentScore)
  };
}

export function mapTeamProfileUpcomingMatchRow(row: TeamProfileMatchRow, teamId: string): FootballTeamProfileUpcomingMatch {
  const isHome = row.home_team_id === teamId;
  return {
    matchId: row.match_id,
    date: toIso(row.kickoff_at),
    competition: row.competition,
    opponent: {
      id: isHome ? row.away_team_id : row.home_team_id,
      name: isHome ? row.away_team : row.home_team,
      logoUrl: isHome ? row.away_team_logo_url : row.home_team_logo_url
    },
    homeAway: isHome ? "home" : "away",
    status: row.status,
    analysisStatus: row.feature_status
  };
}

export function mapTeamProfileCoverageRow(input: {
  row: TeamProfileCoverageRow | undefined;
  formSummary: FootballTeamProfile["formSummary"];
  standing: TeamProfileStandingRow | undefined;
  logoUrl: string | null;
}): FootballTeamProfileDataCoverage {
  return {
    matchesAvailable: integer(input.row?.matches_available),
    scoresAvailable: integer(input.row?.scores_available),
    formCoverageScore: input.formSummary.overall?.coverageScore ?? input.formSummary.home?.coverageScore ?? input.formSummary.away?.coverageScore ?? null,
    hasStanding: Boolean(input.standing),
    hasLogo: Boolean(input.logoUrl),
    playersAvailable: false,
    lineupsAvailable: false,
    injuriesAvailable: false
  };
}

function mapTeamProfileFormRow(row: TeamProfileFormRow): FootballTeamProfileFormSummary {
  return {
    featureId: row.feature_id,
    competitionId: row.competition_id,
    windowSize: row.window_size,
    scope: row.scope,
    sampleSize: integer(row.sample_size),
    coverageScore: numberOrNull(row.coverage_score) ?? 0,
    matchesPlayed: integer(row.matches_played),
    wins: integer(row.wins),
    draws: integer(row.draws),
    losses: integer(row.losses),
    points: integer(row.points),
    avgGoalsFor: numberOrNull(row.avg_goals_for),
    avgGoalsAgainst: numberOrNull(row.avg_goals_against),
    bothTeamsToScoreRate: numberOrNull(row.both_teams_to_score_rate),
    over05Rate: numberOrNull(row.over_0_5_rate),
    over15Rate: numberOrNull(row.over_1_5_rate),
    over25Rate: numberOrNull(row.over_2_5_rate),
    under25Rate: numberOrNull(row.under_2_5_rate),
    scoredRate: numberOrNull(row.scored_rate),
    concededRate: numberOrNull(row.conceded_rate),
    teamOver05Rate: numberOrNull(row.team_over_0_5_rate),
    teamOver15Rate: numberOrNull(row.team_over_1_5_rate),
    firstHalfOver05Rate: numberOrNull(row.first_half_over_0_5_rate),
    firstHalfAvgGoalsFor: numberOrNull(row.first_half_avg_goals_for),
    firstHalfAvgGoalsAgainst: numberOrNull(row.first_half_avg_goals_against)
  };
}

async function executeRows<T>(database: Database, query: ReturnType<typeof sql>): Promise<T[]> {
  const result = await database.execute(query);
  if (Array.isArray(result)) {
    return result as T[];
  }
  if (result && typeof result === "object" && "rows" in result && Array.isArray(result.rows)) {
    return result.rows as T[];
  }
  return [];
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function formatScore(home: string | number | null, away: string | number | null): string | null {
  if (home === null || away === null) return null;
  const homeScore = integer(home);
  const awayScore = integer(away);
  return `${homeScore}-${awayScore}`;
}

function firstNumber(primary: string | number | null, fallback: string | number | null): number | null {
  return numberOrNull(primary) ?? numberOrNull(fallback);
}

function mapResult(ownScore: number | null, opponentScore: number | null): FootballTeamProfileRecentMatch["result"] {
  if (ownScore === null || opponentScore === null) return null;
  if (ownScore > opponentScore) return "W";
  if (ownScore < opponentScore) return "L";
  return "D";
}

function parseCompetitions(value: unknown): FootballTeamSummary["competitions"] {
  if (Array.isArray(value)) {
    return value.filter(isCompetitionSummary);
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed.filter(isCompetitionSummary) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function isCompetitionSummary(value: unknown): value is FootballTeamSummary["competitions"][number] {
  return (
    typeof value === "object" &&
    value !== null &&
    "competitionId" in value &&
    "name" in value &&
    typeof value.competitionId === "string" &&
    typeof value.name === "string"
  );
}

function resolveCompetitionDataStatus(input: {
  teamCount: number;
  standingRows: number;
  matchCount: number;
  upcomingMatchCount: number;
  averageCoverage: number | null;
}): FootballCompetitionDataStatus {
  if (input.teamCount > 0 && input.upcomingMatchCount > 0 && (input.averageCoverage ?? 0) >= 60) {
    return "ready";
  }
  if (input.teamCount > 0 || input.standingRows > 0 || input.matchCount > 0) {
    return "partial";
  }
  return "insufficient";
}

function publicLogoUrlFromMetadata(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const candidates = ["logoUrl", "logo_url", "imageUrl", "image_url", "badgeUrl", "badge_url", "leagueLogo", "league_logo"];
  for (const key of candidates) {
    const url = safePublicUrl(value[key]);
    if (url) return url;
  }
  return null;
}

function safePublicUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  return trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function integer(value: string | number | null | undefined): number {
  if (value === undefined || value === null) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

function numberOrNull(value: string | number | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
