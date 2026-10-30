import { Inject, Injectable, Logger, Optional, ServiceUnavailableException } from "@nestjs/common";
import { loadConfig } from "@sports-data/config";
import { createDatabase } from "@sports-data/database";
import type { Database } from "@sports-data/database";
import { sql } from "drizzle-orm";
import { formatTorkSelection, parseTorkPick } from "@sports-data/shared";
import { canonicalTorkPublicationSql, torkPublicationMetadata } from "./football-tork-publication.js";

export type TorkResultStatus = "won" | "lost" | "pending" | "void";

export interface TorkResultsFilters {
  countryId?: string;
  competitionId?: string;
  teamId?: string;
  matchId?: string;
  status?: TorkResultStatus;
  search?: string;
  from?: string;
  to?: string;
  limit: number;
  offset: number;
}

export interface TorkPredictionResultItem {
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
    marketType: "btts";
    selection: "btts_yes" | "btts_no";
    displayLabel: string;
    tier: "primary";
    confidence: null;
    probability: number;
    pBtts: number;
    selectionProbability: number;
    predictionId: string;
    modelVersion: string;
    decisionPolicyVersion: string | null;
    decisionThreshold: number | null;
    modelHash: string | null;
  };
  settlement: {
    status: TorkResultStatus;
    settledAt: string | null;
    explanation: string;
  };
}

export interface TorkPredictionResultsResponse {
  items: TorkPredictionResultItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface TorkPredictionResultsSummary {
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

export interface TorkResultRow {
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
  prediction_id: string;
  model_version: string;
  model_hash: unknown;
  metadata_json: unknown;
  pick: unknown;
  p_btts: unknown;
  fulltime_status: string | null;
  result_label: "btts_yes" | "btts_no" | null;
  resolved_at: Date | string | null;
}

type TorkQueryFilters = Omit<TorkResultsFilters, "limit" | "offset">;
interface TorkSummaryRow {
  country_id: string | null;
  country_name: string | null;
  competition_id: string;
  competition_name: string;
  settlement_status: TorkResultStatus;
  count: string | number;
}

const MODEL_LABEL = "Tork";

function settlementStatusSql() {
  return sql`(case
    when r.fulltime_status = 'verified_normal_time' and r.result_label in ('btts_yes', 'btts_no') then
      (case when p.pick::text = r.result_label::text then 'won' else 'lost' end)
    when r.fulltime_status is null then 'pending'
    else 'void'
  end)`;
}

@Injectable()
export class FootballTorkResultsService {
  private readonly database: Database;
  private readonly logger = new Logger(FootballTorkResultsService.name);

  constructor(@Optional() @Inject("API_DATABASE") database?: Database) {
    this.database = database ?? createDatabase(loadConfig().DATABASE_URL);
  }

  async listResults(filters: TorkResultsFilters): Promise<TorkPredictionResultsResponse> {
    this.assertEnabled();
    const rows = await this.findResultRows(filters);
    const total = await this.countResultRows(filters);
    let items: TorkPredictionResultItem[];
    try {
      items = rows.map(mapResultRow);
    } catch {
      this.logger.warn("Invalid Tork publication rejected while mapping an API response.");
      throw new ServiceUnavailableException("Karşılıklı gol tahmini doğrulanamadı.");
    }
    return { items, total, limit: filters.limit, offset: filters.offset };
  }

  async getResultsSummary(filters: Omit<TorkResultsFilters, "limit" | "offset"> = {}): Promise<TorkPredictionResultsSummary> {
    this.assertEnabled();
    const rows = await executeRows<TorkSummaryRow>(this.database, sql`
      select co.id as country_id, co.name as country_name,
        c.id as competition_id, c.name as competition_name,
        ${settlementStatusSql()} as settlement_status, count(*) as count
      ${this.resultFromSql(filters)}
      group by co.id, co.name, c.id, c.name, ${settlementStatusSql()}
    `);
    const count = (status?: TorkResultStatus) => rows.reduce((sum, row) =>
      sum + (!status || row.settlement_status === status ? Number(row.count) : 0), 0);
    return {
      modelLabel: MODEL_LABEL,
      total: count(),
      totalSettled: count("won") + count("lost"),
      won: count("won"),
      lost: count("lost"),
      pending: count("pending"),
      void: count("void"),
      byCountry: countBy(rows, (row) => row.country_id ?? "none", (row) => ({ id: row.country_id, name: row.country_name })),
      byLeague: countBy(rows, (row) => row.competition_id, (row) => ({ id: row.competition_id, name: row.competition_name }))
    };
  }

  private assertEnabled() {
    if (process.env.TORK_PREMATCH_ENABLED === "false") {
      throw new ServiceUnavailableException("Karşılıklı gol tahminleri geçici olarak kapalı.");
    }
  }

  private async findResultRows(filters: TorkResultsFilters): Promise<TorkResultRow[]> {
    return executeRows<TorkResultRow>(
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
          p.id::text as prediction_id, p.model_version, p.model_hash, p.metadata_json,
          p.pick,
          p.p_btts,
          r.fulltime_status,
          r.result_label,
          r.resolved_at
        ${this.resultFromSql(filters)}
        order by m.scheduled_start_at desc, m.id asc
        limit ${filters.limit}
        offset ${filters.offset}
      `
    );
  }

  private async countResultRows(filters: TorkResultsFilters): Promise<number> {
    const rows = await executeRows<{ count: string | number }>(
      this.database,
      sql`
        select count(*) as count
        ${this.resultFromSql(filters)}
      `
    );
    const parsed = Number(rows[0]?.count);
    return Number.isInteger(parsed) ? parsed : 0;
  }

  // Lists, counts and grouped summaries must filter the same canonical publication.
  private resultFromSql(filters: TorkQueryFilters) {
    return sql`
      from football_tork_prematch_predictions p
      inner join matches m on m.id = p.match_id
      inner join competitions c on c.id = m.competition_id
      left join countries co on co.id = c.country_id
      inner join teams ht on ht.id = m.home_team_id
      inner join teams at on at.id = m.away_team_id
      left join football_match_scores fs on fs.match_id = m.id
      left join football_tork_prematch_results r on r.prediction_id = p.id
      where ${canonicalTorkPublicationSql()}
        and m.scheduled_start_at < now()
        ${filters.status ? sql`and ${settlementStatusSql()} = ${filters.status}` : sql``}
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
    `;
  }
}

export function resolveTorkSettlementStatus(row: Pick<TorkResultRow, "fulltime_status" | "result_label" | "pick">): TorkResultStatus {
  const pick = parseTorkPick(row.pick);
  if (!row.fulltime_status) return "pending";
  if (row.fulltime_status !== "verified_normal_time" || (row.result_label !== "btts_yes" && row.result_label !== "btts_no")) return "void";
  return pick === row.result_label ? "won" : "lost";
}

function mapResultRow(row: TorkResultRow): TorkPredictionResultItem {
  const selection = formatTorkSelection(row.p_btts, row.pick);
  const status = resolveTorkSettlementStatus(row);
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
      marketType: "btts",
      selection: selection.pick,
      displayLabel: `${MODEL_LABEL} — ${selection.pickLabel}`,
      tier: "primary",
      confidence: null,
      probability: selection.selectionProbability,
      pBtts: selection.pBtts,
      selectionProbability: selection.selectionProbability,
      predictionId: row.prediction_id,
      modelVersion: row.model_version,
      ...torkPublicationMetadata(row.metadata_json, row.model_hash)
    },
    settlement: {
      status,
      settledAt: row.resolved_at ? iso(row.resolved_at) : null,
      explanation: settlementExplanation(status, scoreLabel(row.home_score_fulltime, row.away_score_fulltime))
    }
  };
}

function settlementExplanation(status: TorkResultStatus, normalTimeScore: string | null): string {
  if (status === "won") return `Maç sonucu ${normalTimeScore ?? "?"}: tahmin tuttu.`;
  if (status === "lost") return `Maç sonucu ${normalTimeScore ?? "?"}: tahmin tutmadı.`;
  if (status === "void") return "Normal süre skoru doğrulanamadığı için tahmin değerlendirilemedi.";
  return "Maç sonucu henüz değerlendirilmedi.";
}

function countBy<T extends { count: string | number }, U extends Record<string, unknown>>(
  rows: T[],
  key: (row: T) => string,
  base: (row: T) => U
): Array<U & { count: number }> {
  const map = new Map<string, U & { count: number }>();
  for (const row of rows) {
    const entryKey = key(row);
    const current = map.get(entryKey);
    if (current) current.count += Number(row.count);
    else map.set(entryKey, { ...base(row), count: Number(row.count) });
  }
  return [...map.values()];
}

function scoreLabel(home: string | number | null, away: string | number | null): string | null {
  if (home === null || away === null || String(home).trim() === "" || String(away).trim() === "") return null;
  const homeScore = Number(home);
  const awayScore = Number(away);
  if (!Number.isInteger(homeScore) || !Number.isInteger(awayScore) || homeScore < 0 || awayScore < 0) return null;
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
