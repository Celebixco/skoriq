import { Inject, Injectable, Optional, ServiceUnavailableException } from "@nestjs/common";
import { loadConfig } from "@sports-data/config";
import { createDatabase } from "@sports-data/database";
import type { Database } from "@sports-data/database";
import { sql } from "drizzle-orm";

export type RcResultStatus = "won" | "lost" | "pending" | "void";

export interface RcResultsFilters {
  countryId?: string;
  competitionId?: string;
  teamId?: string;
  matchId?: string;
  status?: RcResultStatus;
  search?: string;
  from?: string;
  to?: string;
  limit: number;
  offset: number;
}

export interface RcPredictionResultItem {
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
    marketType: "match_result_1x2";
    selection: "1" | "X" | "2";
    displayLabel: string;
    tier: "primary";
    confidence: number | null;
  };
  settlement: {
    status: RcResultStatus;
    settledAt: string | null;
    explanation: string;
  };
}

export interface RcPredictionResultsResponse {
  items: RcPredictionResultItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface RcPredictionResultsSummary {
  modelLabel: string;
  total: number;
  totalSettled: number;
  won: number;
  lost: number;
  pending: number;
  void: number;
  byCountry: Array<{ id: string | null; name: string | null; count: number }>;
  byLeague: Array<{ id: string; name: string; count: number }>;
}

export interface RcResultRow {
  country_id: string | null;
  country_name: string | null;
  competition_id: string;
  competition_name: string;
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
  pick: "1" | "X" | "2";
  normal_time_status: string | null;
  result_label: "1" | "X" | "2" | null;
  home_score_90: string | number | null;
  away_score_90: string | number | null;
  resolved_at: Date | string | null;
}

const MODEL_LABEL = "Trey";

@Injectable()
export class FootballRcResultsService {
  private readonly database: Database;

  constructor(@Optional() @Inject("API_DATABASE") database?: Database) {
    this.database = database ?? createDatabase(loadConfig().DATABASE_URL);
  }

  async listResults(filters: RcResultsFilters): Promise<RcPredictionResultsResponse> {
    this.assertEnabled();
    const rows = await this.findResultRows(filters);
    const total = await this.countResultRows(filters);
    return {
      items: rows.map(mapResultRow),
      total,
      limit: filters.limit,
      offset: filters.offset
    };
  }

  async getResultsSummary(filters: Omit<RcResultsFilters, "limit" | "offset"> = {}): Promise<RcPredictionResultsSummary> {
    this.assertEnabled();
    const rows = await this.findResultRows({ ...filters, limit: 1_000, offset: 0 });
    const statuses = rows.map(resolveRcSettlementStatus);
    return {
      modelLabel: MODEL_LABEL,
      total: rows.length,
      totalSettled: statuses.filter((status) => status === "won" || status === "lost").length,
      won: statuses.filter((status) => status === "won").length,
      lost: statuses.filter((status) => status === "lost").length,
      pending: statuses.filter((status) => status === "pending").length,
      void: statuses.filter((status) => status === "void").length,
      byCountry: countBy(rows, (row) => row.country_id ?? "none", (row) => ({ id: row.country_id, name: row.country_name })),
      byLeague: countBy(rows, (row) => row.competition_id, (row) => ({ id: row.competition_id, name: row.competition_name }))
    };
  }

  private assertEnabled() {
    if (process.env.RC_PREMATCH_ENABLED === "false") {
      throw new ServiceUnavailableException("R-C beta tahminleri geçici olarak kapalı.");
    }
  }

  private async findResultRows(filters: RcResultsFilters): Promise<RcResultRow[]> {
    const statusExpression = sql`(case
      when r.normal_time_status = 'verified_normal_time' and r.result_label is not null then
        (case when p.pick::text = r.result_label::text then 'won' else 'lost' end)
      when r.normal_time_status is null then 'pending'
      else 'void'
    end)`;
    return executeRows<RcResultRow>(
      this.database,
      sql`
        select
          co.id as country_id,
          co.name as country_name,
          c.id as competition_id,
          c.name as competition_name,
          m.id as match_id,
          ht.id as home_team_id,
          ht.name as home_team_name,
          ht.logo_url as home_team_logo_url,
          at.id as away_team_id,
          at.name as away_team_name,
          at.logo_url as away_team_logo_url,
          m.scheduled_start_at as kickoff_at,
          fs.home_score_fulltime,
          fs.away_score_fulltime,
          fs.home_score_halftime,
          fs.away_score_halftime,
          p.pick,
          r.normal_time_status,
          r.result_label,
          r.home_score_90,
          r.away_score_90,
          r.resolved_at
        from football_rc_prematch_predictions p
        inner join matches m on m.id = p.match_id
        inner join competitions c on c.id = m.competition_id
        left join countries co on co.id = c.country_id
        inner join teams ht on ht.id = m.home_team_id
        inner join teams at on at.id = m.away_team_id
        left join football_match_scores fs on fs.match_id = m.id
        left join football_rc_prematch_results r on r.prediction_id = p.id
        where p.status = 'published'
          and p.model_id = 'R-C'
          and m.scheduled_start_at < now()
          and p.prediction_generated_at < m.scheduled_start_at
          ${filters.status ? sql`and ${statusExpression} = ${filters.status}` : sql``}
          ${filters.countryId ? sql`and co.id = ${filters.countryId}` : sql``}
          ${filters.competitionId ? sql`and c.id = ${filters.competitionId}` : sql``}
          ${filters.teamId ? sql`and (ht.id = ${filters.teamId} or at.id = ${filters.teamId})` : sql``}
          ${filters.matchId ? sql`and m.id = ${filters.matchId}` : sql``}
          ${filters.search ? sql`and (
            lower(ht.name) like ${`%${filters.search.toLowerCase()}%`}
            or lower(at.name) like ${`%${filters.search.toLowerCase()}%`}
            or lower(c.name) like ${`%${filters.search.toLowerCase()}%`}
            or lower(coalesce(co.name, '')) like ${`%${filters.search.toLowerCase()}%`}
          )` : sql``}
          ${filters.from ? sql`and m.scheduled_start_at >= ${filters.from}` : sql``}
          ${filters.to ? sql`and m.scheduled_start_at <= ${filters.to}` : sql``}
        order by m.scheduled_start_at desc, m.id asc
        limit ${filters.limit}
        offset ${filters.offset}
      `
    );
  }

  private async countResultRows(filters: RcResultsFilters): Promise<number> {
    const rows = await executeRows<{ count: string | number }>(
      this.database,
      sql`
        select count(*) as count
        from football_rc_prematch_predictions p
        inner join matches m on m.id = p.match_id
        inner join competitions c on c.id = m.competition_id
        left join countries co on co.id = c.country_id
        inner join teams ht on ht.id = m.home_team_id
        inner join teams at on at.id = m.away_team_id
        left join football_rc_prematch_results r on r.prediction_id = p.id
        where p.status = 'published'
          and p.model_id = 'R-C'
          and m.scheduled_start_at < now()
          and p.prediction_generated_at < m.scheduled_start_at
          ${filters.status ? sql`and (case
            when r.normal_time_status = 'verified_normal_time' and r.result_label is not null then
              (case when p.pick::text = r.result_label::text then 'won' else 'lost' end)
            when r.normal_time_status is null then 'pending'
            else 'void'
          end) = ${filters.status}` : sql``}
          ${filters.countryId ? sql`and co.id = ${filters.countryId}` : sql``}
          ${filters.competitionId ? sql`and c.id = ${filters.competitionId}` : sql``}
          ${filters.teamId ? sql`and (ht.id = ${filters.teamId} or at.id = ${filters.teamId})` : sql``}
          ${filters.matchId ? sql`and m.id = ${filters.matchId}` : sql``}
          ${filters.search ? sql`and (
            lower(ht.name) like ${`%${filters.search.toLowerCase()}%`}
            or lower(at.name) like ${`%${filters.search.toLowerCase()}%`}
            or lower(c.name) like ${`%${filters.search.toLowerCase()}%`}
            or lower(coalesce(co.name, '')) like ${`%${filters.search.toLowerCase()}%`}
          )` : sql``}
          ${filters.from ? sql`and m.scheduled_start_at >= ${filters.from}` : sql``}
          ${filters.to ? sql`and m.scheduled_start_at <= ${filters.to}` : sql``}
      `
    );
    const parsed = Number(rows[0]?.count);
    return Number.isInteger(parsed) ? parsed : 0;
  }
}

export function resolveRcSettlementStatus(row: Pick<RcResultRow, "normal_time_status" | "result_label" | "pick">): RcResultStatus {
  if (!row.normal_time_status) return "pending";
  if (row.normal_time_status !== "verified_normal_time" || !row.result_label) return "void";
  return row.pick === row.result_label ? "won" : "lost";
}

function mapResultRow(row: RcResultRow): RcPredictionResultItem {
  const status = resolveRcSettlementStatus(row);
  const normalTimeScore = scoreLabel(row.home_score_90, row.away_score_90);
  return {
    country: { id: row.country_id, name: row.country_name },
    competition: { id: row.competition_id, name: row.competition_name, logoUrl: null },
    match: {
      id: row.match_id,
      homeTeam: { id: row.home_team_id, name: row.home_team_name, logoUrl: row.home_team_logo_url },
      awayTeam: { id: row.away_team_id, name: row.away_team_name, logoUrl: row.away_team_logo_url },
      kickoffAt: iso(row.kickoff_at),
      finalScore: scoreLabel(row.home_score_fulltime, row.away_score_fulltime),
      halftimeScore: scoreLabel(row.home_score_halftime, row.away_score_halftime)
    },
    prediction: {
      marketType: "match_result_1x2",
      selection: row.pick,
      displayLabel: `${MODEL_LABEL} — ${pickText(row.pick, row.home_team_name, row.away_team_name)}`,
      tier: "primary",
      confidence: null
    },
    settlement: {
      status,
      settledAt: row.resolved_at ? iso(row.resolved_at) : null,
      explanation: settlementExplanation(status, normalTimeScore)
    }
  };
}

function settlementExplanation(status: RcResultStatus, normalTimeScore: string | null): string {
  if (status === "won") return `Normal süre sonucu ${normalTimeScore ?? "?"}: tahmin tuttu.`;
  if (status === "lost") return `Normal süre sonucu ${normalTimeScore ?? "?"}: tahmin tutmadı.`;
  if (status === "void") return "Maç normal sürede tamamlanmadığı için tahmin değerlendirilemedi.";
  return "Maç sonucu henüz değerlendirilmedi.";
}

function pickText(pick: "1" | "X" | "2", home: string, away: string): string {
  return pick === "1" ? `${home} kazanır` : pick === "X" ? "Beraberlik" : `${away} kazanır`;
}

function countBy<T extends RcResultRow, U extends Record<string, unknown>>(
  rows: T[],
  key: (row: T) => string,
  base: (row: T) => U
): Array<U & { count: number }> {
  const map = new Map<string, U & { count: number }>();
  for (const row of rows) {
    const entryKey = key(row);
    const current = map.get(entryKey);
    if (current) current.count += 1;
    else map.set(entryKey, { ...base(row), count: 1 });
  }
  return [...map.values()];
}

function scoreLabel(home: string | number | null, away: string | number | null): string | null {
  const homeScore = Number(home);
  const awayScore = Number(away);
  if (!Number.isInteger(homeScore) || !Number.isInteger(awayScore)) return null;
  return `${homeScore}-${awayScore}`;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

async function executeRows<T>(database: Database, query: ReturnType<typeof sql>): Promise<T[]> {
  const result = await database.execute(query);
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && "rows" in result && Array.isArray(result.rows)) return result.rows as T[];
  return [];
}
