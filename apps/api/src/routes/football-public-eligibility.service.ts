import { Injectable, NotFoundException } from "@nestjs/common";
import { FootballPublicEligibilityEvaluator } from "@sports-data/analysis";
import type { FootballPublicEligibilityInput, FootballPublicEligibilityResult } from "@sports-data/analysis";
import { loadConfig } from "@sports-data/config";
import { createDatabase } from "@sports-data/database";
import type { Database } from "@sports-data/database";
import { sql } from "drizzle-orm";

export interface FootballPublicEligibilityFilters {
  matchId?: string;
  predictionId?: string;
  settlementStatus?: string;
  recommendationTier?: string;
  consistencyStatus?: string;
  limit: number;
  offset: number;
}

export interface FootballPublicEligibilityResponse {
  eligible: FootballPublicEligibilityItem[];
  excluded: FootballPublicEligibilityItem[];
  summary: FootballPublicEligibilitySummary;
  pagination?: {
    limit: number;
    offset: number;
    total: number;
  };
  publicSafetyNotes: string[];
}

export interface FootballMatchPublicEligibilityResponse extends FootballPublicEligibilityResponse {
  match: MatchSummary;
}

export interface FootballPublicEligibilityItem {
  predictionOutputId: string;
  matchId: string;
  match: MatchSummary;
  predictionType: string;
  predictionValue: string;
  displayLabel: string | null;
  recommendationTier: string | null;
  confidenceScore: number | null;
  settlementStatus?: string;
  eligible: boolean;
  reasons: string[];
  blockers: string[];
  blockerMessages: string[];
  warnings: string[];
  suggestedPublicTitle?: string;
  suggestedPublicSummary?: string;
  sourceClassification: FootballPublicEligibilityResult["sourceClassification"];
}

export interface FootballPublicEligibilitySummary {
  eligibleCount: number;
  excludedCount: number;
  lateGeneratedCount: number;
  auditOnlyCount: number;
  failedCount: number;
  blockedCount: number;
}

interface EligibilityRow {
  prediction_output_id: string;
  match_id: string;
  output_status: string;
  prediction_type: string;
  prediction_value: string;
  recommendation_tier: string | null;
  display_label: string | null;
  confidence_score: string | number | null;
  consistency_status: string;
  blocking_conflict_count: number | null;
  generated_at: Date | string;
  prediction_metadata: unknown;
  settlement_status: string;
  actual_result: string | null;
  settlement_metadata: unknown;
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
}

interface ConflictRow {
  severity: string;
  conflict_type: string | null;
  reason: string | null;
}

@Injectable()
export class FootballPublicEligibilityService {
  private readonly database: Database;
  private readonly evaluator = new FootballPublicEligibilityEvaluator();

  constructor(database?: Database) {
    this.database = database ?? createDatabase(loadConfig().DATABASE_URL);
  }

  async evaluate(filters: FootballPublicEligibilityFilters): Promise<FootballPublicEligibilityResponse> {
    const rows = await this.findRows(filters);
    const contexts = await this.rowsToContexts(rows);
    const total = await this.countRows(filters);
    const items = contexts.map((context, index) => mapEligibilityItem(this.evaluator.evaluate(context), context, rows[index]!));
    return {
      ...groupEligibilityItems(items),
      pagination: {
        limit: filters.limit,
        offset: filters.offset,
        total
      },
      publicSafetyNotes: publicSafetyNotes()
    };
  }

  async evaluateMatch(matchId: string): Promise<FootballMatchPublicEligibilityResponse> {
    const matchRows = await this.findMatchRows(matchId);
    const match = matchRows[0];
    if (!match) throw new NotFoundException("Football match not found.");

    const rows = await this.findRows({ matchId, limit: 100, offset: 0 });
    const contexts = await this.rowsToContexts(rows);
    const items = contexts.map((context, index) => mapEligibilityItem(this.evaluator.evaluate(context), context, rows[index]!));
    return {
      match: mapMatchSummary(match),
      ...groupEligibilityItems(items),
      publicSafetyNotes: publicSafetyNotes()
    };
  }

  private async rowsToContexts(rows: EligibilityRow[]): Promise<FootballPublicEligibilityInput[]> {
    const contexts: FootballPublicEligibilityInput[] = [];
    for (const row of rows) {
      contexts.push({
        prediction: {
          id: row.prediction_output_id,
          matchId: row.match_id,
          status: row.output_status,
          predictionType: row.prediction_type,
          predictionValue: row.prediction_value,
          recommendationTier: row.recommendation_tier,
          displayLabel: row.display_label,
          confidenceScore: numberOrNull(row.confidence_score),
          consistencyStatus: row.consistency_status,
          blockingConflictCount: row.blocking_conflict_count,
          generatedAt: row.generated_at,
          metadataJson: recordOrEmpty(row.prediction_metadata)
        },
        settlement: {
          settlementStatus: row.settlement_status,
          actualResult: row.actual_result,
          settlementMetadata: recordOrEmpty(row.settlement_metadata)
        },
        match: {
          id: row.match_id,
          kickoffAt: row.kickoff_at,
          homeTeamName: row.home_team,
          awayTeamName: row.away_team,
          competitionName: row.competition
        },
        conflicts: await this.findConflicts(row.prediction_output_id)
      });
    }
    return contexts;
  }

  private async findRows(filters: FootballPublicEligibilityFilters): Promise<EligibilityRow[]> {
    return executeRows<EligibilityRow>(
      this.database,
      sql`
        select
          p.id as prediction_output_id,
          p.match_id,
          p.status as output_status,
          p.prediction_type,
          p.prediction_value,
          p.recommendation_tier,
          p.display_label,
          p.confidence_score,
          p.consistency_status,
          p.blocking_conflict_count,
          p.generated_at,
          p.metadata_json as prediction_metadata,
          st.settlement_status,
          st.actual_result,
          st.settlement_metadata,
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
          away.logo_url as away_team_logo_url
        from football_prediction_outputs p
        inner join football_prediction_settlements st on st.prediction_output_id = p.id
        inner join matches m on m.id = p.match_id
        inner join sports s on s.id = m.sport_id
        inner join competitions c on c.id = m.competition_id
        left join countries co on co.id = c.country_id
        inner join teams home on home.id = m.home_team_id
        inner join teams away on away.id = m.away_team_id
        where s.slug = 'football'
          ${filters.matchId ? sql`and p.match_id = ${filters.matchId}` : sql``}
          ${filters.predictionId ? sql`and p.id = ${filters.predictionId}` : sql``}
          ${filters.settlementStatus ? sql`and st.settlement_status = ${filters.settlementStatus}` : sql``}
          ${filters.recommendationTier ? sql`and p.recommendation_tier = ${filters.recommendationTier}` : sql``}
          ${filters.consistencyStatus ? sql`and p.consistency_status = ${filters.consistencyStatus}` : sql``}
        order by st.evaluated_at desc, p.created_at asc
        limit ${filters.limit}
        offset ${filters.offset}
      `
    );
  }

  private async countRows(filters: FootballPublicEligibilityFilters): Promise<number> {
    const rows = await executeRows<{ count: string | number }>(
      this.database,
      sql`
        select count(*) as count
        from football_prediction_outputs p
        inner join football_prediction_settlements st on st.prediction_output_id = p.id
        inner join matches m on m.id = p.match_id
        inner join sports s on s.id = m.sport_id
        where s.slug = 'football'
          ${filters.matchId ? sql`and p.match_id = ${filters.matchId}` : sql``}
          ${filters.predictionId ? sql`and p.id = ${filters.predictionId}` : sql``}
          ${filters.settlementStatus ? sql`and st.settlement_status = ${filters.settlementStatus}` : sql``}
          ${filters.recommendationTier ? sql`and p.recommendation_tier = ${filters.recommendationTier}` : sql``}
          ${filters.consistencyStatus ? sql`and p.consistency_status = ${filters.consistencyStatus}` : sql``}
      `
    );
    return integer(rows[0]?.count);
  }

  private async findConflicts(predictionOutputId: string) {
    const rows = await executeRows<ConflictRow>(
      this.database,
      sql`
        select severity, conflict_type, reason
        from football_prediction_conflicts
        where prediction_output_id = ${predictionOutputId}
        order by case severity when 'blocking' then 1 when 'warning' then 2 else 3 end, conflict_type asc
      `
    );
    return rows.map((row) => ({
      severity: row.severity,
      conflictType: row.conflict_type,
      reason: row.reason
    }));
  }

  private async findMatchRows(matchId: string): Promise<EligibilityRow[]> {
    return executeRows<EligibilityRow>(
      this.database,
      sql`
        select
          null::uuid as prediction_output_id,
          m.id as match_id,
          null::text as output_status,
          null::text as prediction_type,
          null::text as prediction_value,
          null::text as recommendation_tier,
          null::text as display_label,
          null::numeric as confidence_score,
          null::text as consistency_status,
          0 as blocking_conflict_count,
          m.created_at as generated_at,
          '{}'::jsonb as prediction_metadata,
          null::text as settlement_status,
          null::text as actual_result,
          '{}'::jsonb as settlement_metadata,
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
          away.logo_url as away_team_logo_url
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

export function mapEligibilityItem(result: FootballPublicEligibilityResult, context: FootballPublicEligibilityInput, row?: Partial<EligibilityRow>): FootballPublicEligibilityItem {
  return {
    predictionOutputId: result.predictionOutputId,
    matchId: result.matchId,
    match: {
      matchId: context.match.id,
      competition: {
        id: row?.competition_id ?? "",
        name: context.match.competitionName ?? "Competition",
        country: row?.country ?? null
      },
      kickoffAt: dateString(context.match.kickoffAt),
      status: row?.match_status ?? "",
      homeTeam: { id: row?.home_team_id ?? "", name: context.match.homeTeamName ?? "Home", logoUrl: row?.home_team_logo_url ?? null },
      awayTeam: { id: row?.away_team_id ?? "", name: context.match.awayTeamName ?? "Away", logoUrl: row?.away_team_logo_url ?? null }
    },
    predictionType: context.prediction.predictionType,
    predictionValue: context.prediction.predictionValue,
    displayLabel: context.prediction.displayLabel ?? null,
    recommendationTier: context.prediction.recommendationTier ?? null,
    confidenceScore: context.prediction.confidenceScore ?? null,
    settlementStatus: context.settlement?.settlementStatus,
    eligible: result.eligible,
    reasons: result.reasons,
    blockers: result.blockers.map(blockerCode),
    blockerMessages: result.blockers,
    warnings: result.warnings,
    suggestedPublicTitle: result.suggestedPublicTitle,
    suggestedPublicSummary: result.suggestedPublicSummary,
    sourceClassification: result.sourceClassification
  };
}

function groupEligibilityItems(items: FootballPublicEligibilityItem[]) {
  const eligible = items.filter((item) => item.eligible);
  const excluded = items.filter((item) => !item.eligible);
  return {
    eligible,
    excluded,
    summary: {
      eligibleCount: eligible.length,
      excludedCount: excluded.length,
      lateGeneratedCount: items.filter((item) => item.blockers.includes("generated_after_kickoff")).length,
      auditOnlyCount: items.filter((item) => item.sourceClassification.auditOnly).length,
      failedCount: items.filter((item) => item.settlementStatus === "settled_failed").length,
      blockedCount: items.filter((item) => item.sourceClassification.consistencyStatus === "blocked" || item.sourceClassification.blockingConflictCount > 0).length
    }
  };
}

function blockerCode(message: string) {
  if (message.includes("after match kickoff")) return "generated_after_kickoff";
  if (message.includes("not settled_success")) return "not_settled_success";
  if (message.includes("Recommendation tier")) return "recommendation_tier_not_public";
  if (message.includes("Consistency status")) return "consistency_not_allowed";
  if (message.includes("audit-only")) return "audit_only";
  if (message.includes("blocking conflicts")) return "blocking_conflict";
  if (message.includes("Metadata")) return "unsafe_metadata";
  if (message.includes("Prediction type")) return "unsupported_prediction_type";
  if (message.includes("team names")) return "missing_public_metadata";
  return "public_policy_blocker";
}

function publicSafetyNotes() {
  return [
    "Settled success otomatik public yayın anlamına gelmez.",
    "Maçtan sonra üretilen tahminler public kanıt olarak kullanılamaz.",
    "Uzak Dur / blocked / audit-only adaylar public başarılı tahmin olamaz.",
    "Bu endpoint salt okunurdur; public_successful_predictions satırı oluşturmaz ve status değiştirmez."
  ];
}

function mapMatchSummary(row: EligibilityRow): MatchSummary {
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

interface MatchSummary {
  matchId: string;
  competition: { id: string; name: string; country: string | null };
  kickoffAt: string;
  status: string;
  homeTeam: { id: string; name: string; logoUrl: string | null };
  awayTeam: { id: string; name: string; logoUrl: string | null };
}

async function executeRows<T>(database: Database, query: ReturnType<typeof sql>): Promise<T[]> {
  const result = await database.execute(query);
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && "rows" in result && Array.isArray(result.rows)) return result.rows as T[];
  return [];
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function numberOrNull(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function integer(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number.parseInt(value, 10);
  return 0;
}

function dateString(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
