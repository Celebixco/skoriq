import { Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { loadConfig } from "@sports-data/config";
import { createDatabase } from "@sports-data/database";
import type { Database } from "@sports-data/database";
import { sql } from "drizzle-orm";

export interface FootballPredictionDraftFilters {
  matchId?: string;
  status?: string;
  consistencyStatus?: string;
  recommendationTier?: string;
  predictionType?: string;
  limit: number;
  offset: number;
}

export interface FootballPredictionDraftListResponse {
  items: FootballPredictionDraftListItem[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
  };
}

export interface FootballPredictionDraftListItem {
  predictionId: string;
  matchId: string;
  match: FootballPredictionDraftMatchSummary;
  predictionType: string;
  predictionValue: string;
  predictionFamily: string;
  recommendationTier: string | null;
  displayLabel: string | null;
  confidenceScore: number | null;
  confidenceCeiling: number | null;
  riskLevel: string;
  status: string;
  consistencyStatus: string;
  conflictCount: number;
  blockingConflictCount: number;
  warningConflictCount: number;
  reasoningSummary: string | null;
  generatedAt: string;
  createdAt: string;
}

export interface FootballPredictionDraftDetail extends FootballPredictionDraftListItem {
  expectationSnapshot: Record<string, unknown> | null;
  consistencySummary: string | null;
  conflicts: FootballPredictionDraftConflict[];
  metadata: Record<string, unknown>;
}

export interface FootballPredictionDraftMatchResponse {
  match: FootballPredictionDraftMatchSummary;
  outputsByRecommendationTier: Record<"primary" | "try" | "alternative" | "avoid", { label: string; items: FootballPredictionDraftListItem[] }>;
  conflictsSummary: {
    total: number;
    blocking: number;
    warning: number;
    info: number;
  };
  memberVisible: false;
  note: string;
}

export interface FootballPredictionDraftConflict {
  conflictType: string;
  severity: string;
  sourcePredictionType: string | null;
  conflictingPredictionType: string | null;
  reason: string;
}

interface FootballPredictionDraftRow {
  prediction_id: string;
  match_id: string;
  competition_id: string;
  competition: string;
  country: string | null;
  kickoff_at: Date | string;
  match_status: string;
  home_team_id: string;
  home_team: string;
  home_team_logo_url: string | null;
  away_team_id: string;
  away_team: string;
  away_team_logo_url: string | null;
  prediction_type: string;
  prediction_value: string;
  prediction_family: string;
  recommendation_tier: string | null;
  display_label: string | null;
  confidence_score: string | number | null;
  confidence_ceiling: string | number | null;
  risk_level: string;
  status: string;
  consistency_status: string;
  consistency_summary: string | null;
  expectation_snapshot: unknown;
  conflict_count: number;
  blocking_conflict_count: number;
  warning_conflict_count: number;
  reasoning_summary: string | null;
  metadata_json: unknown;
  generated_at: Date | string;
  created_at: Date | string;
}

interface ConflictRow {
  conflict_type: string;
  severity: string;
  source_prediction_type: string | null;
  conflicting_prediction_type: string | null;
  reason: string;
}

@Injectable()
export class FootballPredictionDraftsService {
  private readonly database: Database;

  constructor(@Optional() @Inject("API_DATABASE") database?: Database) {
    this.database = database ?? createDatabase(loadConfig().DATABASE_URL);
  }

  async listDrafts(filters: FootballPredictionDraftFilters): Promise<FootballPredictionDraftListResponse> {
    const rows = await this.findDraftRows(filters);
    const total = await this.countDraftRows(filters);
    return {
      items: rows.map(mapDraftListRow),
      pagination: {
        limit: filters.limit,
        offset: filters.offset,
        total
      }
    };
  }

  async getDraft(predictionId: string): Promise<FootballPredictionDraftDetail> {
    const rows = await this.findDraftRows({ limit: 1, offset: 0 }, predictionId);
    const row = rows[0];
    if (!row) {
      throw new NotFoundException("Football prediction draft not found.");
    }
    const conflicts = await this.findConflicts(predictionId);
    return mapDraftDetailRow(row, conflicts);
  }

  async listMatchDrafts(matchId: string): Promise<FootballPredictionDraftMatchResponse> {
    const matchRows = await this.findMatchRows(matchId);
    const match = matchRows[0];
    if (!match) {
      throw new NotFoundException("Football match not found.");
    }

    const rows = await this.findDraftRows({ matchId, status: "draft", limit: 100, offset: 0 });
    const items = rows.map(mapDraftListRow);
    const conflictsSummary = summarizeConflicts(rows);
    return {
      match: mapMatchSummary(match),
      outputsByRecommendationTier: groupByRecommendationTier(items),
      conflictsSummary,
      memberVisible: false,
      note: "Draft prediction candidates are internal review/audit rows only; no member visibility, settlement, public publishing, or tahmin kombini promotion is performed."
    };
  }

  private async findDraftRows(filters: FootballPredictionDraftFilters, predictionId?: string): Promise<FootballPredictionDraftRow[]> {
    const clauses = [
      sql`and s.slug = 'football'`,
      predictionId ? sql`and p.id = ${predictionId}` : sql``,
      filters.matchId ? sql`and p.match_id = ${filters.matchId}` : sql``,
      filters.status ? sql`and p.status = ${filters.status}` : sql``,
      filters.consistencyStatus ? sql`and p.consistency_status = ${filters.consistencyStatus}` : sql``,
      filters.recommendationTier ? sql`and p.recommendation_tier = ${filters.recommendationTier}` : sql``,
      filters.predictionType ? sql`and p.prediction_type = ${filters.predictionType}` : sql``
    ];
    return executeRows<FootballPredictionDraftRow>(
      this.database,
      sql`
        select
          p.id as prediction_id,
          p.match_id,
          c.id as competition_id,
          c.name as competition,
          co.name as country,
          m.scheduled_start_at as kickoff_at,
          m.status as match_status,
          home.id as home_team_id,
          home.name as home_team,
          home.logo_url as home_team_logo_url,
          away.id as away_team_id,
          away.name as away_team,
          away.logo_url as away_team_logo_url,
          p.prediction_type,
          p.prediction_value,
          p.prediction_family,
          p.recommendation_tier,
          p.display_label,
          p.confidence_score,
          p.confidence_ceiling,
          p.risk_level,
          p.status,
          p.consistency_status,
          p.consistency_summary,
          p.expectation_snapshot,
          p.conflict_count,
          p.blocking_conflict_count,
          p.warning_conflict_count,
          p.reasoning_summary,
          p.metadata_json,
          p.generated_at,
          p.created_at
        from football_prediction_outputs p
        inner join matches m on m.id = p.match_id
        inner join sports s on s.id = m.sport_id
        inner join competitions c on c.id = m.competition_id
        left join countries co on co.id = c.country_id
        inner join teams home on home.id = m.home_team_id
        inner join teams away on away.id = m.away_team_id
        where true
          ${clauses[0]}
          ${clauses[1]}
          ${clauses[2]}
          ${clauses[3]}
          ${clauses[4]}
          ${clauses[5]}
          ${clauses[6]}
        order by p.generated_at desc, p.created_at desc, p.prediction_type asc
        limit ${filters.limit}
        offset ${filters.offset}
      `
    );
  }

  private async countDraftRows(filters: FootballPredictionDraftFilters): Promise<number> {
    const rows = await executeRows<{ count: string | number }>(
      this.database,
      sql`
        select count(*) as count
        from football_prediction_outputs p
        inner join matches m on m.id = p.match_id
        inner join sports s on s.id = m.sport_id
        where s.slug = 'football'
          ${filters.matchId ? sql`and p.match_id = ${filters.matchId}` : sql``}
          ${filters.status ? sql`and p.status = ${filters.status}` : sql``}
          ${filters.consistencyStatus ? sql`and p.consistency_status = ${filters.consistencyStatus}` : sql``}
          ${filters.recommendationTier ? sql`and p.recommendation_tier = ${filters.recommendationTier}` : sql``}
          ${filters.predictionType ? sql`and p.prediction_type = ${filters.predictionType}` : sql``}
      `
    );
    return integer(rows[0]?.count);
  }

  private async findConflicts(predictionId: string): Promise<ConflictRow[]> {
    return executeRows<ConflictRow>(
      this.database,
      sql`
        select conflict_type, severity, source_prediction_type, conflicting_prediction_type, reason
        from football_prediction_conflicts
        where prediction_output_id = ${predictionId}
        order by
          case severity when 'blocking' then 1 when 'warning' then 2 else 3 end,
          conflict_type asc
      `
    );
  }

  private async findMatchRows(matchId: string): Promise<FootballPredictionDraftRow[]> {
    return executeRows<FootballPredictionDraftRow>(
      this.database,
      sql`
        select
          null::uuid as prediction_id,
          m.id as match_id,
          c.id as competition_id,
          c.name as competition,
          co.name as country,
          m.scheduled_start_at as kickoff_at,
          m.status as match_status,
          home.id as home_team_id,
          home.name as home_team,
          home.logo_url as home_team_logo_url,
          away.id as away_team_id,
          away.name as away_team,
          away.logo_url as away_team_logo_url,
          null::text as prediction_type,
          null::text as prediction_value,
          null::text as prediction_family,
          null::text as recommendation_tier,
          null::text as display_label,
          null::numeric as confidence_score,
          null::numeric as confidence_ceiling,
          null::text as risk_level,
          null::text as status,
          null::text as consistency_status,
          null::text as consistency_summary,
          null::jsonb as expectation_snapshot,
          0 as conflict_count,
          0 as blocking_conflict_count,
          0 as warning_conflict_count,
          null::text as reasoning_summary,
          null::jsonb as metadata_json,
          m.created_at as generated_at,
          m.created_at
        from matches m
        inner join sports s on s.id = m.sport_id and s.slug = 'football'
        inner join competitions c on c.id = m.competition_id
        left join countries co on co.id = c.country_id
        inner join teams home on home.id = m.home_team_id
        inner join teams away on away.id = m.away_team_id
        where m.id = ${matchId}
        limit 1
      `
    );
  }
}

export function mapDraftListRow(row: FootballPredictionDraftRow): FootballPredictionDraftListItem {
  return {
    predictionId: row.prediction_id,
    matchId: row.match_id,
    match: mapMatchSummary(row),
    predictionType: row.prediction_type,
    predictionValue: row.prediction_value,
    predictionFamily: row.prediction_family,
    recommendationTier: row.recommendation_tier,
    displayLabel: row.display_label,
    confidenceScore: numberOrNull(row.confidence_score),
    confidenceCeiling: numberOrNull(row.confidence_ceiling),
    riskLevel: row.risk_level,
    status: row.status,
    consistencyStatus: row.consistency_status,
    conflictCount: row.conflict_count,
    blockingConflictCount: row.blocking_conflict_count,
    warningConflictCount: row.warning_conflict_count,
    reasoningSummary: row.reasoning_summary,
    generatedAt: dateString(row.generated_at),
    createdAt: dateString(row.created_at)
  };
}

export function mapDraftDetailRow(row: FootballPredictionDraftRow, conflicts: ConflictRow[]): FootballPredictionDraftDetail {
  return {
    ...mapDraftListRow(row),
    expectationSnapshot: sanitizeRecord(row.expectation_snapshot),
    consistencySummary: row.consistency_summary,
    conflicts: conflicts.map((conflict) => ({
      conflictType: conflict.conflict_type,
      severity: conflict.severity,
      sourcePredictionType: conflict.source_prediction_type,
      conflictingPredictionType: conflict.conflicting_prediction_type,
      reason: conflict.reason
    })),
    metadata: sanitizeRecord(row.metadata_json) ?? {}
  };
}

function mapMatchSummary(row: FootballPredictionDraftRow): FootballPredictionDraftMatchSummary {
  return {
    matchId: row.match_id,
    competition: {
      id: row.competition_id,
      name: row.competition,
      country: row.country
    },
    kickoffAt: dateString(row.kickoff_at),
    status: row.match_status,
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
  };
}

interface FootballPredictionDraftMatchSummary {
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
}

function groupByRecommendationTier(items: FootballPredictionDraftListItem[]): FootballPredictionDraftMatchResponse["outputsByRecommendationTier"] {
  return {
    primary: { label: "Tahminim", items: items.filter((item) => item.recommendationTier === "primary") },
    try: { label: "Denenir", items: items.filter((item) => item.recommendationTier === "try") },
    alternative: { label: "Alternatif", items: items.filter((item) => item.recommendationTier === "alternative") },
    avoid: { label: "Uzak Dur", items: items.filter((item) => item.recommendationTier === "avoid") }
  };
}

function summarizeConflicts(rows: FootballPredictionDraftRow[]) {
  return {
    total: rows.reduce((sum, row) => sum + row.conflict_count, 0),
    blocking: rows.reduce((sum, row) => sum + row.blocking_conflict_count, 0),
    warning: rows.reduce((sum, row) => sum + row.warning_conflict_count, 0),
    info: 0
  };
}

async function executeRows<T>(database: Database, query: ReturnType<typeof sql>): Promise<T[]> {
  const result = await database.execute(query);
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && "rows" in result && Array.isArray(result.rows)) return result.rows as T[];
  return [];
}

function sanitizeRecord(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  return sanitizeValue(value) as Record<string, unknown>;
}

function sanitizeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (!isRecord(value)) return value;
  const sanitized: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (isSensitiveKey(key)) continue;
    sanitized[key] = sanitizeValue(nestedValue);
  }
  return sanitized;
}

function isSensitiveKey(key: string) {
  const normalized = key.toLowerCase();
  return (
    normalized.includes("password") ||
    normalized.includes("secret") ||
    normalized.includes("token") ||
    normalized.includes("cookie") ||
    normalized.includes("api_key") ||
    normalized.includes("apikey") ||
    normalized.includes("database_url") ||
    normalized.includes("raw_provider_payload") ||
    normalized.includes("provider_payload") ||
    normalized.includes("raw_payload")
  );
}

function dateString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function numberOrNull(value: string | number | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function integer(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
