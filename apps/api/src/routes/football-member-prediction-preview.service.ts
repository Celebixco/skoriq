import { Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { loadConfig } from "@sports-data/config";
import { createDatabase } from "@sports-data/database";
import type { Database } from "@sports-data/database";
import { resolveFootballPrematchWindowPolicy } from "@sports-data/shared";
import { sql } from "drizzle-orm";

export interface FootballMemberPredictionPreviewResponse {
  matchId: string;
  status: "available" | "not_available" | "stale" | "not_ready" | "closed";
  reasonCode:
    | "available"
    | "stale"
    | "not_ready"
    | "too_early"
    | "pending_generation"
    | "too_late"
    | "closed"
    | "not_available";
  message: string;
  analysisWindow: {
    status: "within_window" | "too_early" | "too_late" | "closed" | "unknown";
    windowHours: number;
    minimumLeadMinutes: number;
  };
  groups: Record<"primary" | "try" | "alternative", FootballMemberPredictionPreviewCandidate[]>;
  summary: string;
  warnings: string[];
}

export interface FootballMemberPredictionPreviewCandidate {
  predictionId: string;
  displayLabel: string;
  predictionType: string;
  predictionValue: string;
  recommendationTier: "primary" | "try" | "alternative";
  confidenceScore: number | null;
  riskLevel: string;
  reasoningSummary: string | null;
  generatedAt: string;
  kickoffAt: string;
  isFresh: boolean;
  analysisWindowStatus: string | null;
}

interface PreviewMatchRow {
  match_id: string;
  kickoff_at: Date | string;
  match_status: string;
  feature_status: string | null;
}

interface PreviewCandidateRow {
  prediction_id: string;
  prediction_type: string;
  prediction_value: string;
  recommendation_tier: "primary" | "try" | "alternative" | "avoid" | null;
  display_label: string | null;
  confidence_score: string | number | null;
  risk_level: string;
  reasoning_summary: string | null;
  status: string;
  consistency_status: string;
  blocking_conflict_count: number;
  audit_only: string | null;
  generated_at: Date | string;
  kickoff_at: Date | string;
  analysis_window_status: string | null;
  generated_lead_time_minutes: number | null;
  rebuild_required: boolean | string | null;
  stale_at: Date | string | null;
}

const staleWindowStatuses = new Set(["stale", "too_late"]);
const unsafeWindowStatuses = new Set(["stale", "too_late", "unknown"]);
const defaultPrematchPolicy = resolveFootballPrematchWindowPolicy();
const defaultWindowHours = defaultPrematchPolicy.windowHours;
const defaultMinimumLeadMinutes = defaultPrematchPolicy.minimumLeadMinutes;

@Injectable()
export class FootballMemberPredictionPreviewService {
  private readonly database: Database;

  constructor(@Optional() @Inject("API_DATABASE") database?: Database) {
    this.database = database ?? createDatabase(loadConfig().DATABASE_URL);
  }

  async getMatchPredictionPreview(matchId: string): Promise<FootballMemberPredictionPreviewResponse> {
    const match = await this.findMatch(matchId);
    if (!match) {
      throw new NotFoundException("Football match not found.");
    }

    const rows = (await this.findSafeCandidateRows(matchId)).filter(isSafePreviewRow);
    const generatedBeforeKickoffRows = rows.filter((row) => parseDate(row.generated_at)! < parseDate(row.kickoff_at)!);
    const currentWindow = evaluateCurrentAnalysisWindow(match);
    if (currentWindow.status === "closed") {
      return {
        matchId,
        status: "closed",
        reasonCode: "closed",
        message: "Maç başladı; aktif tahmin önizlemesi kapandı.",
        analysisWindow: currentWindow,
        groups: emptyGroups(),
        summary: "Aktif maç öncesi tahmin önizlemesi yalnızca kickoff öncesinde gösterilir.",
        warnings: []
      };
    }

    const staleRows = generatedBeforeKickoffRows.filter((row) => !isCandidateGenerationFresh(row));
    const freshCandidates = generatedBeforeKickoffRows.filter(isCandidateGenerationFresh);
    if (freshCandidates.length === 0 && staleRows.length > 0) {
      return {
        matchId,
        status: "stale",
        reasonCode: "stale",
        message: "Tahminler yenilenmeli.",
        analysisWindow: currentWindow,
        groups: emptyGroups(),
        summary: "Ön tahminler güncel analiz penceresinde yenilenmeden gösterilmez.",
        warnings: ["Tahmin önizlemesi stale/too_late pencere durumunda gizlendi."]
      };
    }

    const candidates = freshCandidates;
    if (candidates.length === 0) {
      const emptyState = resolveEmptyPreviewState(match, currentWindow);
      return {
        matchId,
        status: emptyState.status,
        reasonCode: emptyState.reasonCode,
        message: emptyState.message,
        analysisWindow: currentWindow,
        groups: emptyGroups(),
        summary: emptyState.summary,
        warnings: []
      };
    }

    return {
      matchId,
      status: "available",
      reasonCode: "available",
      message: "Bu maç için SkorIQ ön tahmin yorumu hazır.",
      analysisWindow: currentWindow,
      groups: groupCandidates(candidates.map(mapCandidateRow)),
      summary: "Bu ön tahminler mevcut veri kapsamına göre üretilmiştir; nihai sonuç garantisi değildir.",
      warnings: ["Tahminler minimum güvenli süre korunarak maç başlayana kadar gösterilebilir."]
    };
  }

  private async findMatch(matchId: string) {
    const rows = await executeRows<PreviewMatchRow>(
      this.database,
      sql`
        select
          m.id as match_id,
          m.scheduled_start_at as kickoff_at,
          m.status as match_status,
          f.feature_status
        from matches m
        inner join sports s on s.id = m.sport_id and s.slug = 'football'
        left join lateral (
          select feature_status
          from football_match_prediction_features
          where match_id = m.id
          order by updated_at desc nulls last, created_at desc
          limit 1
        ) f on true
        where m.id = ${matchId}
        limit 1
      `
    );
    return rows[0];
  }

  private async findSafeCandidateRows(matchId: string) {
    return executeRows<PreviewCandidateRow>(
      this.database,
      sql`
        select
          p.id as prediction_id,
          p.prediction_type,
          p.prediction_value,
          p.recommendation_tier,
          p.display_label,
          p.confidence_score,
          p.risk_level,
          p.reasoning_summary,
          p.status,
          p.consistency_status,
          p.blocking_conflict_count,
          coalesce(p.metadata_json ->> 'blockedOrAvoidAuditOnly', p.metadata_json ->> 'auditOnly') as audit_only,
          p.generated_at,
          m.scheduled_start_at as kickoff_at,
          coalesce(p.generation_window_status, p.metadata_json #>> '{analysisWindow,analysisWindowStatus}') as analysis_window_status,
          p.generated_lead_time_minutes,
          p.rebuild_required,
          p.stale_at
        from football_prediction_outputs p
        inner join matches m on m.id = p.match_id
        inner join sports s on s.id = m.sport_id and s.slug = 'football'
        where p.match_id = ${matchId}
          and p.status in ('draft', 'member_visible')
          and p.recommendation_tier in ('primary', 'try', 'alternative')
          and p.recommendation_tier <> 'avoid'
          and p.consistency_status in ('passed', 'warning')
          and p.consistency_status <> 'blocked'
          and p.blocking_conflict_count = 0
          and p.generated_at < m.scheduled_start_at
          and lower(coalesce(p.metadata_json ->> 'blockedOrAvoidAuditOnly', p.metadata_json ->> 'auditOnly', 'false')) not in ('true', '1', 'yes')
          and not exists (
            select 1
            from football_prediction_conflicts c
            where c.prediction_output_id = p.id
              and c.severity = 'blocking'
          )
        order by
          case p.recommendation_tier when 'primary' then 1 when 'try' then 2 else 3 end,
          p.confidence_score desc nulls last,
          p.generated_at desc
      `
    );
  }
}

function mapCandidateRow(row: PreviewCandidateRow): FootballMemberPredictionPreviewCandidate {
  const status = resolveWindowStatus(row);
  return {
    predictionId: row.prediction_id,
    displayLabel: displayLabel(row),
    predictionType: row.prediction_type,
    predictionValue: row.prediction_value,
    recommendationTier: row.recommendation_tier as "primary" | "try" | "alternative",
    confidenceScore: numberOrNull(row.confidence_score),
    riskLevel: row.risk_level,
    reasoningSummary: row.reasoning_summary,
    generatedAt: dateString(row.generated_at),
    kickoffAt: dateString(row.kickoff_at),
    isFresh: !unsafeWindowStatuses.has(status ?? ""),
    analysisWindowStatus: status
  };
}

function isCandidateGenerationFresh(row: PreviewCandidateRow) {
  if (booleanValue(row.rebuild_required) || row.stale_at) return false;
  const status = resolveWindowStatus(row);
  if (staleWindowStatuses.has(status ?? "")) return false;
  if (status === "within_window") return true;
  if (status && unsafeWindowStatuses.has(status)) return false;
  return wasGeneratedInsideDefaultWindow(row.generated_at, row.kickoff_at);
}

function isSafePreviewRow(row: PreviewCandidateRow) {
  return (
    (row.status === "draft" || row.status === "member_visible") &&
    (row.recommendation_tier === "primary" || row.recommendation_tier === "try" || row.recommendation_tier === "alternative") &&
    (row.consistency_status === "passed" || row.consistency_status === "warning") &&
    Number(row.blocking_conflict_count) === 0 &&
    !["true", "1", "yes"].includes(String(row.audit_only ?? "false").toLowerCase())
  );
}

function groupCandidates(candidates: FootballMemberPredictionPreviewCandidate[]): FootballMemberPredictionPreviewResponse["groups"] {
  return {
    primary: candidates.filter((candidate) => candidate.recommendationTier === "primary"),
    try: candidates.filter((candidate) => candidate.recommendationTier === "try"),
    alternative: candidates.filter((candidate) => candidate.recommendationTier === "alternative")
  };
}

function emptyGroups(): FootballMemberPredictionPreviewResponse["groups"] {
  return { primary: [], try: [], alternative: [] };
}

function displayLabel(row: PreviewCandidateRow) {
  return predictionMarketLabel(row.prediction_type, row.prediction_value) ?? row.display_label?.trim() ?? `${row.prediction_type} ${row.prediction_value}`;
}

function resolveEmptyPreviewState(
  match: PreviewMatchRow,
  currentWindow: FootballMemberPredictionPreviewResponse["analysisWindow"]
): Pick<FootballMemberPredictionPreviewResponse, "status" | "reasonCode" | "message" | "summary"> {
  if (match.feature_status === "partial" || match.feature_status === "insufficient_data") {
    return {
      status: "not_ready",
      reasonCode: "not_ready",
      message: "Veri kapsamı tahmin üretmek için yeterli değil.",
      summary: "Analiz hazır değil; güvenli tahmin önizlemesi gösterilmez."
    };
  }

  if (match.feature_status === "ready") {
    if (currentWindow.status === "within_window") {
      return {
        status: "not_available",
        reasonCode: "pending_generation",
        message: "Tahmin üretimi bekliyor.",
        summary: "Analiz hazır; güvenli tahmin draftı henüz oluşturulmadı."
      };
    }

    if (currentWindow.status === "too_late") {
      return {
        status: "closed",
        reasonCode: "too_late",
        message: "Maç başladı; aktif tahmin önizlemesi kapandı.",
        summary: "Tahmin üretim penceresi kapandı; aktif maç öncesi önizleme gösterilmez."
      };
    }

    return {
      status: "not_available",
      reasonCode: "pending_generation",
      message: "Tahmin üretimi bekliyor.",
      summary: "Analiz hazır; güvenli tahmin draftı henüz oluşturulmadı."
    };
  }

  return {
    status: "not_ready",
    reasonCode: "not_ready",
    message: "Veri kapsamı tahmin üretmek için yeterli değil.",
    summary: "Tahmin önizlemesi için hazır analiz bulunmuyor."
  };
}

function evaluateCurrentAnalysisWindow(match: PreviewMatchRow): FootballMemberPredictionPreviewResponse["analysisWindow"] {
  const kickoff = parseDate(match.kickoff_at)?.getTime();
  const now = Date.now();
  if (!kickoff || Number.isNaN(kickoff)) {
    return { status: "unknown", windowHours: defaultWindowHours, minimumLeadMinutes: defaultMinimumLeadMinutes };
  }
  if (match.match_status !== "not_started" && match.match_status !== "scheduled") {
    return { status: "closed", windowHours: defaultWindowHours, minimumLeadMinutes: defaultMinimumLeadMinutes };
  }
  const minimumLeadMs = defaultMinimumLeadMinutes * 60 * 1000;
  if (now >= kickoff) return { status: "closed", windowHours: defaultWindowHours, minimumLeadMinutes: defaultMinimumLeadMinutes };
  if (now > kickoff - minimumLeadMs) return { status: "too_late", windowHours: defaultWindowHours, minimumLeadMinutes: defaultMinimumLeadMinutes };
  return { status: "within_window", windowHours: defaultWindowHours, minimumLeadMinutes: defaultMinimumLeadMinutes };
}

function wasGeneratedInsideDefaultWindow(generatedAt: Date | string, kickoffAt: Date | string) {
  const generated = parseDate(generatedAt)?.getTime();
  const kickoff = parseDate(kickoffAt)?.getTime();
  if (!generated || !kickoff) return false;
  const minimumLeadMs = defaultMinimumLeadMinutes * 60 * 1000;
  return generated <= kickoff - minimumLeadMs;
}

function predictionMarketLabel(type: string, value: string) {
  const labels: Record<string, string> = {
    "match_result_1x2=1": "MS 1",
    "match_result_1x2=X": "MS X",
    "match_result_1x2=2": "MS 2",
    "double_chance=1X": "Çifte Şans 1X",
    "double_chance=X2": "Çifte Şans X2",
    "double_chance=12": "Çifte Şans 12",
    "over_under_goals=over_2_5": "MS 2.5 Üst",
    "over_under_goals=under_2_5": "MS 2.5 Alt",
    "first_half_over_0_5=over_0_5": "İY 0.5 Üst",
    "both_teams_to_score=yes": "KG Var",
    "both_teams_to_score=no": "KG Yok"
  };
  return labels[`${type}=${value}`];
}

function resolveWindowStatus(row: Pick<PreviewCandidateRow, "analysis_window_status">) {
  return row.analysis_window_status?.trim() || null;
}

function booleanValue(value: boolean | string | null) {
  if (typeof value === "boolean") return value;
  return ["true", "1", "yes"].includes(String(value ?? "false").toLowerCase());
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

function dateString(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function parseDate(value: Date | string) {
  return value instanceof Date ? value : new Date(value);
}
