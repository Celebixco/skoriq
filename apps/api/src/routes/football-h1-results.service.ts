import { Inject, Injectable, Optional, ServiceUnavailableException } from "@nestjs/common";
import { loadConfig } from "@sports-data/config";
import { createDatabase } from "@sports-data/database";
import type { Database } from "@sports-data/database";
import { sql } from "drizzle-orm";

export type H1ResultStatus = "won" | "lost" | "pending" | "void";

export interface H1ResultsFilters {
  countryId?: string;
  competitionId?: string;
  teamId?: string;
  matchId?: string;
  status?: H1ResultStatus;
  search?: string;
  from?: string;
  to?: string;
  limit: number;
  offset: number;
}

export interface H1PredictionResultItem {
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
    marketType: "first_half_over_0_5";
    selection: "over_0_5" | "under_0_5";
    displayLabel: string;
    tier: "primary";
    probability: number | null;
  };
  settlement: {
    status: H1ResultStatus;
    settledAt: string | null;
    explanation: string;
  };
}

export interface H1PredictionResultsResponse {
  items: H1PredictionResultItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface H1PredictionResultsSummary {
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

export interface H1ResultRow {
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
  pick: "over_0_5" | "under_0_5";
  p_goal: string | number;
  halftime_status: string | null;
  result_label: "over_0_5" | "under_0_5" | null;
  resolved_at: Date | string | null;
}

const MODEL_LABEL = "Volt";

@Injectable()
export class FootballH1ResultsService {
  private readonly database: Database;

  constructor(@Optional() @Inject("API_DATABASE") database?: Database) {
    this.database = database ?? createDatabase(loadConfig().DATABASE_URL);
  }

  async listResults(filters: H1ResultsFilters): Promise<H1PredictionResultsResponse> {
    this.assertEnabled();
    const rows = await this.findResultRows(filters);
    const total = await this.countResultRows(filters);
    return { items: rows.map(mapResultRow), total, limit: filters.limit, offset: filters.offset };
  }

  async getResultsSummary(filters: Omit<H1ResultsFilters, "limit" | "offset"> = {}): Promise<H1PredictionResultsSummary> {
    this.assertEnabled();
    const rows = await this.findResultRows({ ...filters, limit: 1_000, offset: 0 });
    const statuses = rows.map(resolveH1SettlementStatus);
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
    if (process.env.H1_PREMATCH_ENABLED === "false") {
      throw new ServiceUnavailableException("İlk yarı gol tahminleri geçici olarak kapalı.");
    }
  }

  private async findResultRows(filters: H1ResultsFilters): Promise<H1ResultRow[]> {
    const statusExpression = sql`(case
      when r.halftime_status = 'verified_halftime' and r.result_label is not null then
        (case when p.pick::text = r.result_label::text then 'won' else 'lost' end)
      when r.halftime_status is null then 'pending'
      else 'void'
    end)`;
    return executeRows<H1ResultRow>(
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
          coalesce(fs.home_score_fulltime, fs.home_score_current) as home_score_fulltime,
          coalesce(fs.away_score_fulltime, fs.away_score_current) as away_score_fulltime,
          fs.home_score_halftime,
          fs.away_score_halftime,
          p.pick,
          p.p_goal,
          r.halftime_status,
          r.result_label,
          r.resolved_at
        from football_h1_prematch_predictions p
        inner join matches m on m.id = p.match_id
        inner join competitions c on c.id = m.competition_id
        left join countries co on co.id = c.country_id
        inner join teams ht on ht.id = m.home_team_id
        inner join teams at on at.id = m.away_team_id
        left join football_match_scores fs on fs.match_id = m.id
        left join football_h1_prematch_results r on r.prediction_id = p.id
        where p.status = 'published'
          and p.model_id = 'H1-A'
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

  private async countResultRows(filters: H1ResultsFilters): Promise<number> {
    const rows = await executeRows<{ count: string | number }>(
      this.database,
      sql`
        select count(*) as count
        from football_h1_prematch_predictions p
        inner join matches m on m.id = p.match_id
        inner join competitions c on c.id = m.competition_id
        left join countries co on co.id = c.country_id
        inner join teams ht on ht.id = m.home_team_id
        inner join teams at on at.id = m.away_team_id
        left join football_h1_prematch_results r on r.prediction_id = p.id
        where p.status = 'published'
          and p.model_id = 'H1-A'
          and m.scheduled_start_at < now()
          and p.prediction_generated_at < m.scheduled_start_at
          ${filters.status ? sql`and (case
            when r.halftime_status = 'verified_halftime' and r.result_label is not null then
              (case when p.pick::text = r.result_label::text then 'won' else 'lost' end)
            when r.halftime_status is null then 'pending'
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

export function resolveH1SettlementStatus(row: Pick<H1ResultRow, "halftime_status" | "result_label" | "pick">): H1ResultStatus {
  if (!row.halftime_status) return "pending";
  if (row.halftime_status !== "verified_halftime" || !row.result_label) return "void";
  return row.pick === row.result_label ? "won" : "lost";
}

function mapResultRow(row: H1ResultRow): H1PredictionResultItem {
  const status = resolveH1SettlementStatus(row);
  const halftimeScore = scoreLabel(row.home_score_halftime, row.away_score_halftime);
  return {
    country: { id: row.country_id, name: row.country_name },
    competition: { id: row.competition_id, name: row.competition_name, logoUrl: null },
    match: {
      id: row.match_id,
      homeTeam: { id: row.home_team_id, name: row.home_team_name, logoUrl: row.home_team_logo_url },
      awayTeam: { id: row.away_team_id, name: row.away_team_name, logoUrl: row.away_team_logo_url },
      kickoffAt: iso(row.kickoff_at),
      finalScore: scoreLabel(row.home_score_fulltime, row.away_score_fulltime),
      halftimeScore
    },
    prediction: {
      marketType: "first_half_over_0_5",
      selection: row.pick,
      displayLabel: `${MODEL_LABEL} — ${row.pick === "over_0_5" ? "İlk yarıda gol var" : "İlk yarıda gol yok"}`,
      tier: "primary",
      probability: Number(row.p_goal)
    },
    settlement: {
      status,
      settledAt: row.resolved_at ? iso(row.resolved_at) : null,
      explanation: settlementExplanation(status, halftimeScore)
    }
  };
}

function settlementExplanation(status: H1ResultStatus, halftimeScore: string | null): string {
  if (status === "won") return `İlk yarı skoru ${halftimeScore ?? "?"}: tahmin tuttu.`;
  if (status === "lost") return `İlk yarı skoru ${halftimeScore ?? "?"}: tahmin tutmadı.`;
  if (status === "void") return "İlk yarı skoru doğrulanamadığı için tahmin değerlendirilemedi.";
  return "Maç sonucu henüz değerlendirilmedi.";
}

function countBy<T extends H1ResultRow, U extends Record<string, unknown>>(
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
