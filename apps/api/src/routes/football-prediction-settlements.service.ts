import { Injectable, NotFoundException } from "@nestjs/common";
import { loadConfig } from "@sports-data/config";
import { createDatabase } from "@sports-data/database";
import type { Database } from "@sports-data/database";
import { sql } from "drizzle-orm";

export interface FootballPredictionSettlementFilters {
  matchId?: string;
  predictionId?: string;
  settlementStatus?: string;
  recommendationTier?: string;
  consistencyStatus?: string;
  auditOnly?: boolean;
  limit: number;
  offset: number;
}

export interface FootballPredictionSettlementListResponse {
  items: FootballPredictionSettlementListItem[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
  };
}

export interface FootballPredictionSettlementListItem {
  settlementId: string;
  predictionId: string;
  matchId: string;
  match: FootballPredictionSettlementMatchSummary;
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
  settlementStatus: string;
  actualResult: string;
  settlementReason: string;
  auditOnly: boolean;
  memberVisible: boolean;
  publicStatus: {
    publicEligible: boolean;
    publicPublished: boolean;
    status: string;
  };
  conflictCount: number;
  blockingConflictCount: number;
  warningConflictCount: number;
  reasoningSummary: string | null;
  evaluatedAt: string;
  createdAt: string;
}

export interface FootballPredictionSettlementDetail extends FootballPredictionSettlementListItem {
  expectationSnapshot: Record<string, unknown> | null;
  consistencySummary: string | null;
  conflicts: FootballPredictionSettlementConflict[];
  settlementMetadata: Record<string, unknown>;
  predictionMetadata: Record<string, unknown>;
  guardNotes: string[];
}

export interface FootballPredictionSettlementMatchResponse {
  match: FootballPredictionSettlementMatchSummary;
  outputsByRecommendationTier: Record<"primary" | "try" | "alternative" | "avoid", { label: string; items: FootballPredictionSettlementListItem[] }>;
  settlementSummary: {
    success: number;
    failed: number;
    void: number;
    auditOnly: number;
    memberVisible: number;
    publicEligible: number;
    publicPublished: number;
  };
  conflictsSummary: {
    total: number;
    blocking: number;
    warning: number;
    info: number;
  };
  note: string;
}

export interface FootballPredictionSettlementConflict {
  conflictType: string;
  severity: string;
  sourcePredictionType: string | null;
  conflictingPredictionType: string | null;
  reason: string;
}

interface FootballPredictionSettlementRow {
  settlement_id: string;
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
  prediction_metadata_json: unknown;
  settlement_status: string;
  actual_result: string;
  settlement_reason: string;
  settlement_metadata: unknown;
  audit_only: boolean;
  member_visible: boolean;
  public_eligible: boolean;
  public_published: boolean;
  evaluated_at: Date | string;
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
export class FootballPredictionSettlementsService {
  private readonly database: Database;

  constructor(database?: Database) {
    this.database = database ?? createDatabase(loadConfig().DATABASE_URL);
  }

  async listSettlements(filters: FootballPredictionSettlementFilters): Promise<FootballPredictionSettlementListResponse> {
    const rows = await this.findSettlementRows(filters);
    const total = await this.countSettlementRows(filters);
    return {
      items: rows.map(mapSettlementListRow),
      pagination: {
        limit: filters.limit,
        offset: filters.offset,
        total
      }
    };
  }

  async getSettlement(settlementId: string): Promise<FootballPredictionSettlementDetail> {
    const rows = await this.findSettlementRows({ limit: 1, offset: 0 }, settlementId);
    const row = rows[0];
    if (!row) {
      throw new NotFoundException("Football prediction settlement not found.");
    }
    const conflicts = await this.findConflicts(row.prediction_id);
    return mapSettlementDetailRow(row, conflicts);
  }

  async listMatchSettlements(matchId: string): Promise<FootballPredictionSettlementMatchResponse> {
    const matchRows = await this.findMatchRows(matchId);
    const match = matchRows[0];
    if (!match) {
      throw new NotFoundException("Football match not found.");
    }

    const rows = await this.findSettlementRows({ matchId, limit: 100, offset: 0 });
    const items = rows.map(mapSettlementListRow);
    return {
      match: mapMatchSummary(match),
      outputsByRecommendationTier: groupByRecommendationTier(items),
      settlementSummary: summarizeSettlements(rows),
      conflictsSummary: summarizeConflicts(rows),
      note: "Bu sonuç iç denetim amaçlıdır. Public başarılı tahmin olarak yayınlanmamıştır, üyelere görünür tahmin değildir ve tahmin kombini için kullanılmaz."
    };
  }

  private async findSettlementRows(filters: FootballPredictionSettlementFilters, settlementId?: string): Promise<FootballPredictionSettlementRow[]> {
    const auditOnlyExpression = sql`
      (
        coalesce((st.settlement_metadata->>'blockedOrAvoidAuditOnly')::boolean, false)
        or p.recommendation_tier = 'avoid'
        or p.consistency_status = 'blocked'
      )
    `;
    return executeRows<FootballPredictionSettlementRow>(
      this.database,
      sql`
        select
          st.id as settlement_id,
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
          p.metadata_json as prediction_metadata_json,
          st.settlement_status,
          st.actual_result,
          st.settlement_reason,
          st.settlement_metadata,
          ${auditOnlyExpression} as audit_only,
          p.status = 'member_visible' as member_visible,
          p.status = 'public_eligible' as public_eligible,
          p.status = 'public_published' as public_published,
          st.evaluated_at,
          st.created_at
        from football_prediction_settlements st
        inner join football_prediction_outputs p on p.id = st.prediction_output_id
        inner join matches m on m.id = p.match_id
        inner join sports s on s.id = m.sport_id
        inner join competitions c on c.id = m.competition_id
        left join countries co on co.id = c.country_id
        inner join teams home on home.id = m.home_team_id
        inner join teams away on away.id = m.away_team_id
        where s.slug = 'football'
          ${settlementId ? sql`and st.id = ${settlementId}` : sql``}
          ${filters.matchId ? sql`and p.match_id = ${filters.matchId}` : sql``}
          ${filters.predictionId ? sql`and p.id = ${filters.predictionId}` : sql``}
          ${filters.settlementStatus ? sql`and st.settlement_status = ${filters.settlementStatus}` : sql``}
          ${filters.recommendationTier ? sql`and p.recommendation_tier = ${filters.recommendationTier}` : sql``}
          ${filters.consistencyStatus ? sql`and p.consistency_status = ${filters.consistencyStatus}` : sql``}
          ${filters.auditOnly === undefined ? sql`` : sql`and ${auditOnlyExpression} = ${filters.auditOnly}`}
        order by st.evaluated_at desc, st.created_at desc, p.prediction_type asc
        limit ${filters.limit}
        offset ${filters.offset}
      `
    );
  }

  private async countSettlementRows(filters: FootballPredictionSettlementFilters): Promise<number> {
    const auditOnlyExpression = sql`
      (
        coalesce((st.settlement_metadata->>'blockedOrAvoidAuditOnly')::boolean, false)
        or p.recommendation_tier = 'avoid'
        or p.consistency_status = 'blocked'
      )
    `;
    const rows = await executeRows<{ count: string | number }>(
      this.database,
      sql`
        select count(*) as count
        from football_prediction_settlements st
        inner join football_prediction_outputs p on p.id = st.prediction_output_id
        inner join matches m on m.id = p.match_id
        inner join sports s on s.id = m.sport_id
        where s.slug = 'football'
          ${filters.matchId ? sql`and p.match_id = ${filters.matchId}` : sql``}
          ${filters.predictionId ? sql`and p.id = ${filters.predictionId}` : sql``}
          ${filters.settlementStatus ? sql`and st.settlement_status = ${filters.settlementStatus}` : sql``}
          ${filters.recommendationTier ? sql`and p.recommendation_tier = ${filters.recommendationTier}` : sql``}
          ${filters.consistencyStatus ? sql`and p.consistency_status = ${filters.consistencyStatus}` : sql``}
          ${filters.auditOnly === undefined ? sql`` : sql`and ${auditOnlyExpression} = ${filters.auditOnly}`}
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

  private async findMatchRows(matchId: string): Promise<FootballPredictionSettlementRow[]> {
    return executeRows<FootballPredictionSettlementRow>(
      this.database,
      sql`
        select
          null::uuid as settlement_id,
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
          null::jsonb as prediction_metadata_json,
          null::text as settlement_status,
          null::text as actual_result,
          null::text as settlement_reason,
          null::jsonb as settlement_metadata,
          false as audit_only,
          false as member_visible,
          false as public_eligible,
          false as public_published,
          m.created_at as evaluated_at,
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

export function mapSettlementListRow(row: FootballPredictionSettlementRow): FootballPredictionSettlementListItem {
  return {
    settlementId: row.settlement_id,
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
    settlementStatus: row.settlement_status,
    actualResult: row.actual_result,
    settlementReason: row.settlement_reason,
    auditOnly: Boolean(row.audit_only),
    memberVisible: Boolean(row.member_visible),
    publicStatus: {
      publicEligible: Boolean(row.public_eligible),
      publicPublished: Boolean(row.public_published),
      status: row.status
    },
    conflictCount: row.conflict_count,
    blockingConflictCount: row.blocking_conflict_count,
    warningConflictCount: row.warning_conflict_count,
    reasoningSummary: row.reasoning_summary,
    evaluatedAt: dateString(row.evaluated_at),
    createdAt: dateString(row.created_at)
  };
}

export function mapSettlementDetailRow(row: FootballPredictionSettlementRow, conflicts: ConflictRow[]): FootballPredictionSettlementDetail {
  return {
    ...mapSettlementListRow(row),
    expectationSnapshot: sanitizeRecord(row.expectation_snapshot),
    consistencySummary: row.consistency_summary,
    conflicts: conflicts.map((conflict) => ({
      conflictType: conflict.conflict_type,
      severity: conflict.severity,
      sourcePredictionType: conflict.source_prediction_type,
      conflictingPredictionType: conflict.conflicting_prediction_type,
      reason: conflict.reason
    })),
    settlementMetadata: sanitizeRecord(row.settlement_metadata) ?? {},
    predictionMetadata: sanitizeRecord(row.prediction_metadata_json) ?? {},
    guardNotes: [
      "Bu sonuç iç denetim amaçlıdır.",
      "Public başarılı tahmin olarak yayınlanmamıştır.",
      "Üyelere görünür tahmin değildir.",
      "Uzak Dur / blocked adaylar gerçekleşse bile öneri sayılmaz."
    ]
  };
}

function mapMatchSummary(row: FootballPredictionSettlementRow): FootballPredictionSettlementMatchSummary {
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

interface FootballPredictionSettlementMatchSummary {
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

function groupByRecommendationTier(items: FootballPredictionSettlementListItem[]): FootballPredictionSettlementMatchResponse["outputsByRecommendationTier"] {
  return {
    primary: { label: "Tahminim", items: items.filter((item) => item.recommendationTier === "primary") },
    try: { label: "Denenir", items: items.filter((item) => item.recommendationTier === "try") },
    alternative: { label: "Alternatif", items: items.filter((item) => item.recommendationTier === "alternative") },
    avoid: { label: "Uzak Dur", items: items.filter((item) => item.recommendationTier === "avoid") }
  };
}

function summarizeSettlements(rows: FootballPredictionSettlementRow[]) {
  return {
    success: rows.filter((row) => row.settlement_status === "settled_success").length,
    failed: rows.filter((row) => row.settlement_status === "settled_failed").length,
    void: rows.filter((row) => row.settlement_status === "settled_void").length,
    auditOnly: rows.filter((row) => row.audit_only).length,
    memberVisible: rows.filter((row) => row.member_visible).length,
    publicEligible: rows.filter((row) => row.public_eligible).length,
    publicPublished: rows.filter((row) => row.public_published).length
  };
}

function summarizeConflicts(rows: FootballPredictionSettlementRow[]) {
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
