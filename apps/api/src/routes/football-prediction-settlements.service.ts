import { Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
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

export interface FootballPredictionResultsFilters {
  countryId?: string;
  competitionId?: string;
  teamId?: string;
  matchId?: string;
  status?: string;
  tier?: string;
  marketType?: string;
  from?: string;
  to?: string;
  limit: number;
  offset: number;
}

export interface FootballPredictionResultsResponse {
  items: FootballPredictionResultItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface FootballPredictionResultItem {
  country: { id: string | null; name: string | null };
  competition: { id: string; name: string; logoUrl: string | null };
  match: {
    id: string;
    homeTeam: { id: string; name: string; logoUrl: string | null };
    awayTeam: { id: string; name: string; logoUrl: string | null };
    kickoffAt: string;
    finalScore: string | null;
    halftimeScore: string | null;
  };
  prediction: {
    marketType: string;
    selection: string;
    displayLabel: string;
    tier: string;
    confidence: number | null;
  };
  settlement: {
    status: "won" | "lost" | "void" | "pending" | "missing_score" | "unsupported_market" | "not_settleable";
    settledAt: string | null;
    explanation: string;
  };
}

export interface FootballPredictionResultsSummary {
  totalSettled: number;
  won: number;
  lost: number;
  pending: number;
  byCountry: Array<{ id: string | null; name: string | null; count: number }>;
  byLeague: Array<{ id: string; name: string; count: number }>;
  byTier: Array<{ tier: string; count: number }>;
  byMarketType: Array<{ marketType: string; count: number }>;
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

interface FootballPredictionResultRow {
  country_id: string | null;
  country_name: string | null;
  competition_id: string;
  competition_name: string;
  competition_logo_url: string | null;
  match_id: string;
  home_team_id: string;
  home_team_name: string;
  home_team_logo_url: string | null;
  away_team_id: string;
  away_team_name: string;
  away_team_logo_url: string | null;
  kickoff_at: Date | string;
  home_score_fulltime: string | number | null;
  away_score_fulltime: string | number | null;
  home_score_halftime: string | number | null;
  away_score_halftime: string | number | null;
  prediction_type: string;
  prediction_value: string;
  display_label: string | null;
  recommendation_tier: string;
  confidence_score: string | number | null;
  settlement_status: string | null;
  actual_result: string | null;
  settlement_reason: string | null;
  settlement_metadata: unknown;
  evaluated_at: Date | string | null;
}

@Injectable()
export class FootballPredictionSettlementsService {
  private readonly database: Database;

  constructor(@Optional() @Inject("API_DATABASE") database?: Database) {
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

  async listPredictionResults(filters: FootballPredictionResultsFilters): Promise<FootballPredictionResultsResponse> {
    const rows = await this.findPredictionResultRows(filters);
    const total = await this.countPredictionResultRows(filters);
    return {
      items: rows.map(mapPredictionResultRow),
      total,
      limit: filters.limit,
      offset: filters.offset
    };
  }

  async getPredictionResultsSummary(filters: Omit<FootballPredictionResultsFilters, "limit" | "offset"> = {}): Promise<FootballPredictionResultsSummary> {
    const rows = await this.findPredictionResultRows({ ...filters, limit: 500, offset: 0 });
    return {
      totalSettled: rows.filter((row) => row.settlement_status).length,
      won: rows.filter((row) => publicSettlementStatus(row) === "won").length,
      lost: rows.filter((row) => publicSettlementStatus(row) === "lost").length,
      pending: rows.filter((row) => publicSettlementStatus(row) === "pending").length,
      byCountry: countObjects(rows, (row) => row.country_id ?? "none", (row) => ({ id: row.country_id, name: row.country_name })),
      byLeague: countObjects(rows, (row) => row.competition_id, (row) => ({ id: row.competition_id, name: row.competition_name })),
      byTier: countObjects(rows, (row) => row.recommendation_tier, (row) => ({ tier: row.recommendation_tier })),
      byMarketType: countObjects(rows, (row) => row.prediction_type, (row) => ({ marketType: row.prediction_type }))
    };
  }

  private async findPredictionResultRows(filters: FootballPredictionResultsFilters): Promise<FootballPredictionResultRow[]> {
    return executeRows<FootballPredictionResultRow>(
      this.database,
      sql`
        select
          co.id as country_id,
          co.name as country_name,
          c.id as competition_id,
          c.name as competition_name,
          null::text as competition_logo_url,
          m.id as match_id,
          home.id as home_team_id,
          home.name as home_team_name,
          home.logo_url as home_team_logo_url,
          away.id as away_team_id,
          away.name as away_team_name,
          away.logo_url as away_team_logo_url,
          m.scheduled_start_at as kickoff_at,
          fs.home_score_fulltime,
          fs.away_score_fulltime,
          fs.home_score_halftime,
          fs.away_score_halftime,
          p.prediction_type,
          p.prediction_value,
          p.display_label,
          p.recommendation_tier,
          p.confidence_score,
          st.settlement_status,
          st.actual_result,
          st.settlement_reason,
          st.settlement_metadata,
          st.evaluated_at
        from football_prediction_outputs p
        inner join matches m on m.id = p.match_id
        inner join sports s on s.id = m.sport_id and s.slug = 'football'
        inner join competitions c on c.id = m.competition_id
        left join countries co on co.id = c.country_id
        inner join teams home on home.id = m.home_team_id
        inner join teams away on away.id = m.away_team_id
        left join football_match_scores fs on fs.match_id = m.id
        left join football_prediction_settlements st on st.prediction_output_id = p.id
        where p.status in ('draft', 'member_visible', 'locked', 'settlement_pending', 'settled_success', 'settled_failed', 'settled_void')
          and p.recommendation_tier in ('primary', 'try', 'alternative')
          and p.consistency_status in ('passed', 'warning')
          and p.blocking_conflict_count = 0
          and p.generated_at < m.scheduled_start_at
          ${filters.countryId ? sql`and co.id = ${filters.countryId}` : sql``}
          ${filters.competitionId ? sql`and c.id = ${filters.competitionId}` : sql``}
          ${filters.teamId ? sql`and (home.id = ${filters.teamId} or away.id = ${filters.teamId})` : sql``}
          ${filters.matchId ? sql`and m.id = ${filters.matchId}` : sql``}
          ${filters.tier ? sql`and p.recommendation_tier = ${filters.tier}` : sql``}
          ${filters.marketType ? sql`and p.prediction_type = ${filters.marketType}` : sql``}
          ${filters.from ? sql`and m.scheduled_start_at >= ${filters.from}` : sql``}
          ${filters.to ? sql`and m.scheduled_start_at <= ${filters.to}` : sql``}
        order by m.scheduled_start_at desc, p.generated_at desc
        limit ${filters.limit}
        offset ${filters.offset}
      `
    ).then((rows) => (filters.status ? rows.filter((row) => publicSettlementStatus(row) === filters.status) : rows));
  }

  private async countPredictionResultRows(filters: FootballPredictionResultsFilters): Promise<number> {
    return (await this.findPredictionResultRows({ ...filters, limit: 500, offset: 0 })).length;
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

function mapPredictionResultRow(row: FootballPredictionResultRow): FootballPredictionResultItem {
  return {
    country: { id: row.country_id, name: row.country_name },
    competition: { id: row.competition_id, name: row.competition_name, logoUrl: row.competition_logo_url },
    match: {
      id: row.match_id,
      homeTeam: { id: row.home_team_id, name: row.home_team_name, logoUrl: row.home_team_logo_url },
      awayTeam: { id: row.away_team_id, name: row.away_team_name, logoUrl: row.away_team_logo_url },
      kickoffAt: dateString(row.kickoff_at),
      finalScore: scoreLabel(row.home_score_fulltime, row.away_score_fulltime),
      halftimeScore: scoreLabel(row.home_score_halftime, row.away_score_halftime)
    },
    prediction: {
      marketType: row.prediction_type,
      selection: row.prediction_value,
      displayLabel: predictionDisplayLabel(row),
      tier: row.recommendation_tier,
      confidence: numberOrNull(row.confidence_score)
    },
    settlement: {
      status: publicSettlementStatus(row),
      settledAt: row.evaluated_at ? dateString(row.evaluated_at) : null,
      explanation: row.settlement_reason ?? "Bu tahmin için sonuç değerlendirmesi henüz tamamlanmadı."
    }
  };
}

function publicSettlementStatus(row: Pick<FootballPredictionResultRow, "settlement_status" | "actual_result" | "settlement_metadata">): FootballPredictionResultItem["settlement"]["status"] {
  if (!row.settlement_status) return "pending";
  if (row.settlement_status === "settled_success") return "won";
  if (row.settlement_status === "settled_failed") return "lost";
  const reasonCode = isRecord(row.settlement_metadata) && typeof row.settlement_metadata.reasonCode === "string" ? row.settlement_metadata.reasonCode : row.actual_result;
  if (reasonCode === "missing_score" || reasonCode === "missing_final_score" || reasonCode === "missing_halftime_score") return "missing_score";
  if (reasonCode === "unsupported_prediction_type" || reasonCode === "unsupported_prediction_value") return "unsupported_market";
  if (reasonCode === "match_not_final") return "pending";
  if (reasonCode === "blocked_or_audit_only" || reasonCode === "generated_after_kickoff" || reasonCode === "stale_or_rebuild_required") return "not_settleable";
  return "void";
}

function predictionDisplayLabel(row: Pick<FootballPredictionResultRow, "display_label" | "prediction_type" | "prediction_value">) {
  return row.display_label?.trim() || `${row.prediction_type}=${row.prediction_value}`;
}

function scoreLabel(home: string | number | null, away: string | number | null) {
  const homeScore = numberOrNull(home);
  const awayScore = numberOrNull(away);
  return homeScore === null || awayScore === null ? null : `${homeScore}-${awayScore}`;
}

function countObjects<T extends Record<string, unknown>>(
  rows: FootballPredictionResultRow[],
  key: (row: FootballPredictionResultRow) => string,
  base: (row: FootballPredictionResultRow) => T
): Array<T & { count: number }> {
  const map = new Map<string, T & { count: number }>();
  for (const row of rows) {
    const entryKey = key(row);
    const current = map.get(entryKey);
    if (current) current.count += 1;
    else map.set(entryKey, { ...base(row), count: 1 });
  }
  return [...map.values()];
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
