import { Injectable, NotFoundException } from "@nestjs/common";
import { buildFootballMatchReasoning } from "@sports-data/analysis";
import type { FootballMatchReasoningPredictionFeature } from "@sports-data/analysis";
import { loadConfig } from "@sports-data/config";
import { createDatabase } from "@sports-data/database";
import type { Database } from "@sports-data/database";
import { sql } from "drizzle-orm";

export interface FootballMatchAnalyticsResponse {
  match: {
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
  };
  featureStatus: string;
  predictionEligible: boolean;
  kuponEligible: boolean;
  confidenceCeiling: number;
  combinedCoverageScore: number;
  homeForm: {
    sampleSize: number;
    coverageScore: number | null;
    scope: string | null;
    windowSize: number | null;
  };
  awayForm: {
    sampleSize: number;
    coverageScore: number | null;
    scope: string | null;
    windowSize: number | null;
  };
  h2h: {
    sampleSize: number;
    coverageScore: number | null;
    h2hMissing: boolean;
  };
  positiveSignals: string[];
  riskFactors: string[];
  missingDataWarnings: string[];
  summary: string;
  debug?: {
    sourceFeatureIds: {
      homeFormFeatureId?: string | null;
      awayFormFeatureId?: string | null;
      h2hFeatureId?: string | null;
    };
    metadata: Record<string, unknown>;
  };
}

export interface FootballMatchAnalyticsListFilters {
  featureStatus?: "ready" | "partial" | "insufficient_data";
  predictionEligible?: boolean;
  kuponEligible?: boolean;
  competitionId?: string;
  teamId?: string;
  limit: number;
  offset: number;
  debug: boolean;
}

export interface FootballMatchAnalyticsListResponse {
  items: FootballMatchAnalyticsResponse[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
  };
}

export interface FootballMatchAnalyticsRow {
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
  home_form_feature_id: string | null;
  away_form_feature_id: string | null;
  h2h_feature_id: string | null;
  home_form_coverage_score: string | number | null;
  away_form_coverage_score: string | number | null;
  h2h_coverage_score: string | number | null;
  combined_coverage_score: string | number | null;
  metadata_json: unknown;
  home_form_scope: string | null;
  home_form_window_size: number | null;
  away_form_scope: string | null;
  away_form_window_size: number | null;
}

@Injectable()
export class FootballMatchAnalyticsService {
  private readonly database: Database;

  constructor(database?: Database) {
    this.database = database ?? createDatabase(loadConfig().DATABASE_URL);
  }

  async getMatchAnalytics(matchId: string, debug = false): Promise<FootballMatchAnalyticsResponse> {
    const matchExists = await this.findMatchIdentity(matchId);
    if (!matchExists) {
      throw new NotFoundException("Football match not found.");
    }

    const row = await this.findAnalyticsRow(matchId);
    if (!row?.feature_status) {
      throw new NotFoundException("Football match analytics feature snapshot not found. Build the feature snapshot first.");
    }

    return mapAnalyticsRow(row, debug);
  }

  async listMatchAnalytics(filters: FootballMatchAnalyticsListFilters): Promise<FootballMatchAnalyticsListResponse> {
    const allRows = await this.findAnalyticsRows(filters);
    const mappedItems = allRows.map((row) => mapAnalyticsRow(row, filters.debug));
    const filteredItems = mappedItems.filter((item) => matchesDerivedFilters(item, filters));
    return {
      items: filteredItems.slice(0, filters.limit),
      pagination: {
        limit: filters.limit,
        offset: filters.offset,
        total: filteredItems.length
      }
    };
  }

  private async findMatchIdentity(matchId: string) {
    const rows = await executeRows<{ id: string }>(
      this.database,
      sql`
        select m.id
        from matches m
        inner join sports s on s.id = m.sport_id and s.slug = 'football'
        where m.id = ${matchId}
        limit 1
      `
    );
    return rows[0];
  }

  private async findAnalyticsRow(matchId: string): Promise<FootballMatchAnalyticsRow | undefined> {
    const rows = await executeRows<FootballMatchAnalyticsRow>(
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
          f.home_form_feature_id,
          f.away_form_feature_id,
          f.h2h_feature_id,
          f.home_form_coverage_score,
          f.away_form_coverage_score,
          f.h2h_coverage_score,
          f.combined_coverage_score,
          f.metadata_json,
          home_form.scope as home_form_scope,
          home_form.window_size as home_form_window_size,
          away_form.scope as away_form_scope,
          away_form.window_size as away_form_window_size
        from matches m
        inner join sports s on s.id = m.sport_id and s.slug = 'football'
        inner join competitions c on c.id = m.competition_id
        left join countries co on co.id = c.country_id
        inner join teams home on home.id = m.home_team_id
        inner join teams away on away.id = m.away_team_id
        left join football_match_prediction_features f on f.match_id = m.id
          and f.form_window_size = 5
          and f.h2h_window_size = 5
        left join football_team_form_features home_form on home_form.id = f.home_form_feature_id
        left join football_team_form_features away_form on away_form.id = f.away_form_feature_id
        where m.id = ${matchId}
        limit 1
      `
    );
    return rows[0];
  }

  private async findAnalyticsRows(filters: FootballMatchAnalyticsListFilters): Promise<FootballMatchAnalyticsRow[]> {
    const featureStatusFilter = filters.featureStatus ? sql`and f.feature_status = ${filters.featureStatus}` : sql``;
    const competitionFilter = filters.competitionId ? sql`and m.competition_id = ${filters.competitionId}` : sql``;
    const teamFilter = filters.teamId ? sql`and (m.home_team_id = ${filters.teamId} or m.away_team_id = ${filters.teamId})` : sql``;
    const fetchLimit = filters.limit + filters.offset;
    const rows = await executeRows<FootballMatchAnalyticsRow>(
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
          f.home_form_feature_id,
          f.away_form_feature_id,
          f.h2h_feature_id,
          f.home_form_coverage_score,
          f.away_form_coverage_score,
          f.h2h_coverage_score,
          f.combined_coverage_score,
          f.metadata_json,
          home_form.scope as home_form_scope,
          home_form.window_size as home_form_window_size,
          away_form.scope as away_form_scope,
          away_form.window_size as away_form_window_size
        from football_match_prediction_features f
        inner join matches m on m.id = f.match_id
        inner join sports s on s.id = m.sport_id and s.slug = 'football'
        inner join competitions c on c.id = m.competition_id
        left join countries co on co.id = c.country_id
        inner join teams home on home.id = m.home_team_id
        inner join teams away on away.id = m.away_team_id
        left join football_team_form_features home_form on home_form.id = f.home_form_feature_id
        left join football_team_form_features away_form on away_form.id = f.away_form_feature_id
        where f.form_window_size = 5
          and f.h2h_window_size = 5
          ${featureStatusFilter}
          ${competitionFilter}
          ${teamFilter}
        order by m.scheduled_start_at desc, m.id asc
        limit ${fetchLimit}
      `
    );
    return rows.slice(filters.offset);
  }
}

export function mapAnalyticsRow(row: FootballMatchAnalyticsRow, debug: boolean): FootballMatchAnalyticsResponse {
  const metadataJson = isRecord(row.metadata_json) ? row.metadata_json : {};
  const feature: FootballMatchReasoningPredictionFeature = {
    matchId: row.match_id,
    featureStatus: row.feature_status as FootballMatchReasoningPredictionFeature["featureStatus"],
    homeFormFeatureId: row.home_form_feature_id,
    awayFormFeatureId: row.away_form_feature_id,
    h2hFeatureId: row.h2h_feature_id,
    homeFormCoverageScore: numberOrNull(row.home_form_coverage_score),
    awayFormCoverageScore: numberOrNull(row.away_form_coverage_score),
    h2hCoverageScore: numberOrNull(row.h2h_coverage_score),
    combinedCoverageScore: Number(row.combined_coverage_score ?? 0),
    metadataJson
  };
  const reasoning = buildFootballMatchReasoning(feature);

  return {
    match: {
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
      }
    },
    featureStatus: reasoning.feature_status,
    predictionEligible: reasoning.prediction_eligible,
    kuponEligible: reasoning.kupon_eligible,
    confidenceCeiling: reasoning.confidence_ceiling,
    combinedCoverageScore: reasoning.metadata.coverage.combined,
    homeForm: {
      sampleSize: reasoning.metadata.sampleSizes.homeForm,
      coverageScore: reasoning.metadata.coverage.homeForm,
      scope: row.home_form_scope,
      windowSize: row.home_form_window_size
    },
    awayForm: {
      sampleSize: reasoning.metadata.sampleSizes.awayForm,
      coverageScore: reasoning.metadata.coverage.awayForm,
      scope: row.away_form_scope,
      windowSize: row.away_form_window_size
    },
    h2h: {
      sampleSize: reasoning.metadata.sampleSizes.h2h,
      coverageScore: reasoning.metadata.coverage.h2h,
      h2hMissing: reasoning.metadata.h2hMissing
    },
    positiveSignals: reasoning.positive_signals,
    riskFactors: reasoning.risk_factors,
    missingDataWarnings: reasoning.missing_data_warnings,
    summary: reasoning.summary,
    ...(debug
      ? {
          debug: {
            sourceFeatureIds: {
              homeFormFeatureId: row.home_form_feature_id,
              awayFormFeatureId: row.away_form_feature_id,
              h2hFeatureId: row.h2h_feature_id
            },
            metadata: metadataJson
          }
        }
      : {})
  };
}

function matchesDerivedFilters(item: FootballMatchAnalyticsResponse, filters: FootballMatchAnalyticsListFilters): boolean {
  if (filters.predictionEligible !== undefined && item.predictionEligible !== filters.predictionEligible) return false;
  if (filters.kuponEligible !== undefined && item.kuponEligible !== filters.kuponEligible) return false;
  return true;
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

function numberOrNull(value: string | number | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
