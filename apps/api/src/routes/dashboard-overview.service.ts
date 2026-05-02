import { Injectable } from "@nestjs/common";
import { loadConfig } from "@sports-data/config";
import { createDatabase } from "@sports-data/database";
import type { Database } from "@sports-data/database";
import { sql } from "drizzle-orm";
import type { AuthUser } from "../auth/auth.types.js";

export interface DashboardOverviewResponse {
  user: {
    email: string;
    role: "member" | "admin";
  };
  overview: {
    analyzedMatchesCount: number;
    readyMatchesCount: number;
    partialMatchesCount: number;
    insufficientMatchesCount: number;
    averageCombinedCoverageScore: number | null;
    predictionEligibleCount: number;
    h2hMissingCount: number;
  };
  upcomingMatches: DashboardUpcomingMatch[];
  analysisDistribution: {
    ready: number;
    partial: number;
    insufficient: number;
    unknown: number;
  };
  coverageSummary: {
    averageCombinedCoverageScore: number | null;
    averageHomeFormCoverage: number | null;
    averageAwayFormCoverage: number | null;
    averageH2hCoverage: number | null;
  };
  predictionPreview: {
    status: "available" | "not_available" | "stale" | "not_ready";
    items: DashboardPredictionPreviewItem[];
  };
  dataStatus: {
    analyticsApi: "ok" | "empty" | "error";
    teamsCatalog: "ok" | "empty" | "error";
    competitionsCatalog: "ok" | "empty" | "error";
    predictionPreview: "ok" | "empty" | "error";
  };
  admin?: {
    draftPredictionCount: number;
    settlementCount: number;
    publicEligibilityExcludedCount: number | null;
    publicEligibilityEligibleCount: number | null;
    rebuildRequiredCount: number;
  };
}

export interface DashboardUpcomingMatch {
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
  featureStatus: "ready" | "partial" | "insufficient_data" | null;
  predictionEligible: boolean;
  combinedCoverageScore: number | null;
  analysisWindowStatus: "within_window" | "too_early" | "too_late" | "stale" | "unknown" | null;
  hasPredictionPreview: boolean;
}

export interface DashboardPredictionPreviewItem {
  matchId: string;
  matchLabel: string;
  displayLabel: string;
  recommendationTier: "primary" | "try" | "alternative";
  confidenceScore: number | null;
  riskLevel: string;
}

interface OverviewRow {
  analyzed_matches_count: string | number | null;
  ready_matches_count: string | number | null;
  partial_matches_count: string | number | null;
  insufficient_matches_count: string | number | null;
  unknown_matches_count: string | number | null;
  average_combined_coverage_score: string | number | null;
  average_home_form_coverage: string | number | null;
  average_away_form_coverage: string | number | null;
  average_h2h_coverage: string | number | null;
  prediction_eligible_count: string | number | null;
  h2h_missing_count: string | number | null;
}

interface UpcomingMatchRow {
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
  stale_preview_exists: boolean | string | number | null;
  safe_preview_exists: boolean | string | number | null;
}

interface PreviewRow {
  match_id: string;
  match_label: string;
  prediction_type: string;
  prediction_value: string;
  recommendation_tier: "primary" | "try" | "alternative" | null;
  display_label: string | null;
  confidence_score: string | number | null;
  risk_level: string;
  generated_at: Date | string;
  kickoff_at: Date | string;
  analysis_window_status: string | null;
}

interface CatalogCountsRow {
  teams_count: string | number | null;
  competitions_count: string | number | null;
}

interface AdminSummaryRow {
  draft_prediction_count: string | number | null;
  settlement_count: string | number | null;
  public_eligibility_eligible_count: string | number | null;
  public_eligibility_excluded_count: string | number | null;
  rebuild_required_count: string | number | null;
}

const defaultWindowHours = 24;
const defaultMinimumLeadMinutes = 30;
const unsafeWindowStatuses = new Set(["stale", "too_early", "too_late", "unknown"]);

@Injectable()
export class DashboardOverviewService {
  private readonly database: Database;

  constructor(database?: Database) {
    this.database = database ?? createDatabase(loadConfig().DATABASE_URL);
  }

  async getOverview(user: AuthUser): Promise<DashboardOverviewResponse> {
    const overviewResult = await safeLoad(() => this.loadOverview(), null);
    const upcomingResult = await safeLoad(() => this.loadUpcomingMatches(), []);
    const previewResult = await safeLoad(() => this.loadPredictionPreview(), { status: "not_available" as const, items: [] });
    const catalogResult = await safeLoad(() => this.loadCatalogCounts(), null);
    const adminResult = user.role === "admin" ? await safeLoad(() => this.loadAdminSummary(), null) : null;

    const overview = mapOverview(overviewResult.value);
    const response: DashboardOverviewResponse = {
      user: {
        email: user.email,
        role: user.role
      },
      overview,
      upcomingMatches: upcomingResult.value,
      analysisDistribution: {
        ready: overview.readyMatchesCount,
        partial: overview.partialMatchesCount,
        insufficient: overview.insufficientMatchesCount,
        unknown: overviewResult.value ? numberOrZero(overviewResult.value.unknown_matches_count) : 0
      },
      coverageSummary: {
        averageCombinedCoverageScore: overview.averageCombinedCoverageScore,
        averageHomeFormCoverage: numberOrNull(overviewResult.value?.average_home_form_coverage ?? null),
        averageAwayFormCoverage: numberOrNull(overviewResult.value?.average_away_form_coverage ?? null),
        averageH2hCoverage: numberOrNull(overviewResult.value?.average_h2h_coverage ?? null)
      },
      predictionPreview: previewResult.value,
      dataStatus: {
        analyticsApi: statusFromLoad(overviewResult, overview.analyzedMatchesCount > 0),
        teamsCatalog: catalogStatus(catalogResult, "teams_count"),
        competitionsCatalog: catalogStatus(catalogResult, "competitions_count"),
        predictionPreview: statusFromLoad(previewResult, previewResult.value.items.length > 0 || previewResult.value.status === "stale")
      }
    };

    if (user.role === "admin") {
      response.admin = mapAdminSummary(adminResult?.value ?? null);
    }

    return response;
  }

  private async loadOverview(): Promise<OverviewRow | null> {
    const rows = await executeRows<OverviewRow>(
      this.database,
      sql`
        select
          count(*) as analyzed_matches_count,
          count(*) filter (where feature_status = 'ready') as ready_matches_count,
          count(*) filter (where feature_status = 'partial') as partial_matches_count,
          count(*) filter (where feature_status = 'insufficient_data') as insufficient_matches_count,
          count(*) filter (where feature_status not in ('ready', 'partial', 'insufficient_data')) as unknown_matches_count,
          round(avg(combined_coverage_score), 2) as average_combined_coverage_score,
          round(avg(home_form_coverage_score), 2) as average_home_form_coverage,
          round(avg(away_form_coverage_score), 2) as average_away_form_coverage,
          round(avg(h2h_coverage_score), 2) as average_h2h_coverage,
          count(*) filter (where feature_status = 'ready') as prediction_eligible_count,
          count(*) filter (where lower(coalesce(metadata_json ->> 'h2hMissing', 'false')) in ('true', '1', 'yes')) as h2h_missing_count
        from football_match_prediction_features
      `
    );
    return rows[0] ?? null;
  }

  private async loadUpcomingMatches(): Promise<DashboardUpcomingMatch[]> {
    const rows = await executeRows<UpcomingMatchRow>(
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
          f.combined_coverage_score,
          exists (
            select 1
            from football_prediction_outputs p
            where p.match_id = m.id
              and p.status in ('draft', 'member_visible')
              and p.recommendation_tier in ('primary', 'try', 'alternative')
              and p.consistency_status in ('passed', 'warning')
              and p.blocking_conflict_count = 0
              and p.generated_at < m.scheduled_start_at
              and (
                p.rebuild_required = true
                or p.generation_window_status in ('stale', 'too_early', 'too_late', 'unknown')
                or p.generated_at <= m.scheduled_start_at - interval '24 hours'
              )
          ) as stale_preview_exists,
          exists (
            select 1
            from football_prediction_outputs p
            where p.match_id = m.id
              and p.status in ('draft', 'member_visible')
              and p.recommendation_tier in ('primary', 'try', 'alternative')
              and p.consistency_status in ('passed', 'warning')
              and p.blocking_conflict_count = 0
              and p.generated_at < m.scheduled_start_at
              and lower(coalesce(p.metadata_json ->> 'blockedOrAvoidAuditOnly', p.metadata_json ->> 'auditOnly', 'false')) not in ('true', '1', 'yes')
              and not exists (
                select 1
                from football_prediction_conflicts pc
                where pc.prediction_output_id = p.id
                  and pc.severity = 'blocking'
              )
              and coalesce(p.generation_window_status, 'within_window') not in ('stale', 'too_early', 'too_late', 'unknown')
              and p.generated_at > m.scheduled_start_at - interval '24 hours'
          ) as safe_preview_exists
        from matches m
        inner join sports s on s.id = m.sport_id and s.slug = 'football'
        inner join competitions c on c.id = m.competition_id
        left join countries co on co.id = c.country_id
        inner join teams home on home.id = m.home_team_id
        inner join teams away on away.id = m.away_team_id
        left join lateral (
          select f.*
          from football_match_prediction_features f
          where f.match_id = m.id
          order by
            case when f.form_window_size = 5 and f.h2h_window_size = 5 then 0 else 1 end,
            f.updated_at desc
          limit 1
        ) f on true
        where m.status in ('scheduled', 'not_started')
          and m.scheduled_start_at >= now()
        order by m.scheduled_start_at asc, m.id asc
        limit 5
      `
    );
    return rows.map(mapUpcomingMatchRow);
  }

  private async loadPredictionPreview(): Promise<DashboardOverviewResponse["predictionPreview"]> {
    const rows = await executeRows<PreviewRow>(
      this.database,
      sql`
        select
          p.match_id,
          concat(home.name, ' vs ', away.name) as match_label,
          p.prediction_type,
          p.prediction_value,
          p.recommendation_tier,
          p.display_label,
          p.confidence_score,
          p.risk_level,
          p.generated_at,
          m.scheduled_start_at as kickoff_at,
          coalesce(p.generation_window_status, p.metadata_json #>> '{analysisWindow,analysisWindowStatus}') as analysis_window_status
        from football_prediction_outputs p
        inner join matches m on m.id = p.match_id
        inner join sports s on s.id = m.sport_id and s.slug = 'football'
        inner join teams home on home.id = m.home_team_id
        inner join teams away on away.id = m.away_team_id
        where p.status in ('draft', 'member_visible')
          and p.recommendation_tier in ('primary', 'try', 'alternative')
          and p.consistency_status in ('passed', 'warning')
          and p.blocking_conflict_count = 0
          and p.generated_at < m.scheduled_start_at
          and lower(coalesce(p.metadata_json ->> 'blockedOrAvoidAuditOnly', p.metadata_json ->> 'auditOnly', 'false')) not in ('true', '1', 'yes')
          and not exists (
            select 1
            from football_prediction_conflicts pc
            where pc.prediction_output_id = p.id
              and pc.severity = 'blocking'
          )
        order by
          m.scheduled_start_at asc,
          case p.recommendation_tier when 'primary' then 1 when 'try' then 2 else 3 end,
          p.confidence_score desc nulls last
        limit 25
      `
    );

    const safeRows = rows.filter(isSafePreviewRow);
    const freshRows = safeRows.filter((row) => !unsafeWindowStatuses.has(resolvePredictionWindowStatus(row) ?? "unknown"));
    if (freshRows.length > 0) {
      return {
        status: "available",
        items: freshRows.slice(0, 5).map(mapPreviewRow)
      };
    }
    if (safeRows.some((row) => unsafeWindowStatuses.has(resolvePredictionWindowStatus(row) ?? "unknown"))) {
      return { status: "stale", items: [] };
    }
    return { status: "not_available", items: [] };
  }

  private async loadCatalogCounts(): Promise<CatalogCountsRow | null> {
    const rows = await executeRows<CatalogCountsRow>(
      this.database,
      sql`
        select
          (select count(*) from teams t inner join sports s on s.id = t.sport_id and s.slug = 'football') as teams_count,
          (select count(*) from competitions c inner join sports s on s.id = c.sport_id and s.slug = 'football') as competitions_count
      `
    );
    return rows[0] ?? null;
  }

  private async loadAdminSummary(): Promise<AdminSummaryRow | null> {
    const rows = await executeRows<AdminSummaryRow>(
      this.database,
      sql`
        with settled_outputs as (
          select
            p.id,
            p.status,
            p.recommendation_tier,
            p.consistency_status,
            p.blocking_conflict_count,
            p.generated_at,
            p.rebuild_required,
            m.scheduled_start_at,
            s.settlement_status,
            lower(coalesce(p.metadata_json ->> 'blockedOrAvoidAuditOnly', p.metadata_json ->> 'auditOnly', 'false')) as audit_only,
            exists (
              select 1
              from football_prediction_conflicts pc
              where pc.prediction_output_id = p.id
                and pc.severity = 'blocking'
            ) as has_blocking_conflict
          from football_prediction_outputs p
          inner join football_prediction_settlements s on s.prediction_output_id = p.id
          inner join matches m on m.id = p.match_id
        ),
        eligible_outputs as (
          select id
          from settled_outputs
          where status = 'settled_success'
            and settlement_status = 'settled_success'
            and recommendation_tier in ('primary', 'try')
            and consistency_status in ('passed', 'warning')
            and blocking_conflict_count = 0
            and has_blocking_conflict = false
            and audit_only not in ('true', '1', 'yes')
            and generated_at < scheduled_start_at
        )
        select
          (select count(*) from football_prediction_outputs where status = 'draft') as draft_prediction_count,
          (select count(*) from football_prediction_settlements) as settlement_count,
          (select count(*) from eligible_outputs) as public_eligibility_eligible_count,
          (select count(*) from settled_outputs) - (select count(*) from eligible_outputs) as public_eligibility_excluded_count,
          (select count(*) from football_prediction_outputs where rebuild_required = true) as rebuild_required_count
      `
    );
    return rows[0] ?? null;
  }
}

function mapOverview(row: OverviewRow | null): DashboardOverviewResponse["overview"] {
  return {
    analyzedMatchesCount: numberOrZero(row?.analyzed_matches_count ?? null),
    readyMatchesCount: numberOrZero(row?.ready_matches_count ?? null),
    partialMatchesCount: numberOrZero(row?.partial_matches_count ?? null),
    insufficientMatchesCount: numberOrZero(row?.insufficient_matches_count ?? null),
    averageCombinedCoverageScore: numberOrNull(row?.average_combined_coverage_score ?? null),
    predictionEligibleCount: numberOrZero(row?.prediction_eligible_count ?? null),
    h2hMissingCount: numberOrZero(row?.h2h_missing_count ?? null)
  };
}

function mapUpcomingMatchRow(row: UpcomingMatchRow): DashboardUpcomingMatch {
  const stalePreviewExists = booleanFromDb(row.stale_preview_exists);
  const kickoffAt = dateString(row.kickoff_at);
  return {
    matchId: row.match_id,
    competition: {
      id: row.competition_id,
      name: row.competition,
      country: row.country
    },
    kickoffAt,
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
    featureStatus: normalizeFeatureStatus(row.feature_status),
    predictionEligible: row.feature_status === "ready",
    combinedCoverageScore: numberOrNull(row.combined_coverage_score),
    analysisWindowStatus: stalePreviewExists ? "stale" : evaluateAnalysisWindow(new Date(kickoffAt)),
    hasPredictionPreview: booleanFromDb(row.safe_preview_exists)
  };
}

function mapPreviewRow(row: PreviewRow): DashboardPredictionPreviewItem {
  return {
    matchId: row.match_id,
    matchLabel: row.match_label,
    displayLabel: row.display_label?.trim() || predictionMarketLabel(row.prediction_type, row.prediction_value),
    recommendationTier: row.recommendation_tier as "primary" | "try" | "alternative",
    confidenceScore: numberOrNull(row.confidence_score),
    riskLevel: row.risk_level
  };
}

function mapAdminSummary(row: AdminSummaryRow | null): NonNullable<DashboardOverviewResponse["admin"]> {
  return {
    draftPredictionCount: numberOrZero(row?.draft_prediction_count ?? null),
    settlementCount: numberOrZero(row?.settlement_count ?? null),
    publicEligibilityExcludedCount: row ? numberOrZero(row.public_eligibility_excluded_count) : null,
    publicEligibilityEligibleCount: row ? numberOrZero(row.public_eligibility_eligible_count) : null,
    rebuildRequiredCount: numberOrZero(row?.rebuild_required_count ?? null)
  };
}

function isSafePreviewRow(row: PreviewRow) {
  return (
    (row.recommendation_tier === "primary" || row.recommendation_tier === "try" || row.recommendation_tier === "alternative") &&
    parseDate(row.generated_at).getTime() < parseDate(row.kickoff_at).getTime()
  );
}

function resolvePredictionWindowStatus(row: PreviewRow) {
  const explicit = row.analysis_window_status?.trim();
  if (explicit) return explicit;
  const generatedAt = parseDate(row.generated_at);
  const kickoffAt = parseDate(row.kickoff_at);
  if (generatedAt.getTime() <= kickoffAt.getTime() - defaultWindowHours * 60 * 60 * 1000) {
    return "stale";
  }
  return evaluateAnalysisWindow(kickoffAt);
}

function evaluateAnalysisWindow(kickoffAt: Date): DashboardUpcomingMatch["analysisWindowStatus"] {
  if (Number.isNaN(kickoffAt.getTime())) return "unknown";
  const now = Date.now();
  const kickoff = kickoffAt.getTime();
  const minimumLead = defaultMinimumLeadMinutes * 60 * 1000;
  const window = defaultWindowHours * 60 * 60 * 1000;
  if (kickoff <= now + minimumLead) return "too_late";
  if (kickoff > now + window) return "too_early";
  return "within_window";
}

function normalizeFeatureStatus(value: string | null): DashboardUpcomingMatch["featureStatus"] {
  if (value === "ready" || value === "partial" || value === "insufficient_data") return value;
  return null;
}

function predictionMarketLabel(type: string, value: string) {
  const labels: Record<string, string> = {
    "match_result_1x2=1": "MS 1",
    "match_result_1x2=X": "MS X",
    "match_result_1x2=2": "MS 2",
    "double_chance=1X": "Çifte Şans 1X",
    "over_under_goals=over_2_5": "MS 2.5 Üst",
    "first_half_over_0_5=over_0_5": "İY 0.5 Üst",
    "both_teams_to_score=yes": "KG Var"
  };
  return labels[`${type}=${value}`] ?? `${type} ${value}`;
}

async function safeLoad<T>(loader: () => Promise<T>, fallback: T): Promise<{ ok: boolean; value: T }> {
  try {
    return { ok: true, value: await loader() };
  } catch {
    return { ok: false, value: fallback };
  }
}

function statusFromLoad(load: { ok: boolean }, hasRows: boolean): "ok" | "empty" | "error" {
  if (!load.ok) return "error";
  return hasRows ? "ok" : "empty";
}

function catalogStatus(load: { ok: boolean; value: CatalogCountsRow | null }, field: keyof CatalogCountsRow): "ok" | "empty" | "error" {
  if (!load.ok) return "error";
  return numberOrZero(load.value?.[field] ?? null) > 0 ? "ok" : "empty";
}

async function executeRows<T>(database: Database, query: ReturnType<typeof sql>): Promise<T[]> {
  const result = await database.execute(query);
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && "rows" in result && Array.isArray(result.rows)) return result.rows as T[];
  return [];
}

function numberOrNull(value: string | number | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function numberOrZero(value: string | number | null): number {
  return numberOrNull(value) ?? 0;
}

function booleanFromDb(value: boolean | string | number | null): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  return ["true", "1", "yes"].includes(String(value ?? "false").toLowerCase());
}

function dateString(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function parseDate(value: Date | string) {
  return value instanceof Date ? value : new Date(value);
}
