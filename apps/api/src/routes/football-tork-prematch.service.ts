import { Inject, Injectable, Optional, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { loadConfig } from "@sports-data/config";
import { createDatabase } from "@sports-data/database";
import type { Database } from "@sports-data/database";
import { sql } from "drizzle-orm";

export interface TorkPrematchPrediction {
  predictionId: string;
  predictionText: string;
  pBtts: number;
  expectedBttsGoals: number;
  pick: "btts_yes" | "btts_no";
  pickLabel: string;
  modelId: "TORK-A";
  modelVersion: string;
  modelLabel: string;
  generatedAt: string;
  publishedAt: string;
}

export interface TorkPrematchItem {
  matchId: string;
  competitionId: string;
  league: string;
  kickoffAt: string;
  homeTeam: string;
  awayTeam: string;
  homeTeamId: string;
  awayTeamId: string;
  homeTeamLogoUrl: string | null;
  awayTeamLogoUrl: string | null;
  tork: TorkPrematchPrediction;
  historyHomeN: number;
  historyAwayN: number;
  scopeLevel: string;
  historyCompleteness: string;
  evaluationGroup: string;
  performanceNote: string | null;
  disclaimer: string;
}

export interface TorkPrematchResponse {
  modelVersion: string;
  modelLabel: string;
  count: number;
  disclaimer: string;
  items: TorkPrematchItem[];
}

interface TorkRow {
  match_id: string;
  competition_id: string;
  league: string;
  kickoff_at: Date | string;
  home_team: string;
  away_team: string;
  home_team_id: string;
  away_team_id: string;
  home_team_logo_url: string | null;
  away_team_logo_url: string | null;
  prediction_id: string;
  model_version: string;
  prediction_generated_at: Date | string;
  published_at: Date | string;
  p_btts: number | string;
  expected_btts_goals: number | string;
  pick: "btts_yes" | "btts_no";
  history_home_n: number;
  history_away_n: number;
  scope_level: string;
  history_completeness: string;
  evaluation_group: string;
}

const DISCLAIMER = "Deneysel model olasılıklarıdır; sonuç garantisi değildir.";
const MODEL_LABEL = "Tork";
const VERDICT_THRESHOLD = 0.76;
const PERFORMANCE_NOTE = "Geriye dönük testlerde yüksek olasılıklı maçlarda karşılıklı gol görülme sıklığı belirgin şekilde artmıştır.";

function pickLabel(pBtts: number): string {
  return pBtts >= VERDICT_THRESHOLD ? "Her iki takım da gol atar" : "İki takım da gol atmaz";
}

function predictionText(pBtts: number): string {
  const percent = Math.round(pBtts * 100);
  return pBtts >= VERDICT_THRESHOLD
    ? `Her iki takım da gol atar (%${percent} olasılık)`
    : `İki takım da gol atmaz (%${100 - percent} olasılık)`;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

@Injectable()
export class FootballTorkPrematchService {
  private readonly database: Database;
  constructor(@Optional() @Inject("API_DATABASE") database?: Database) {
    this.database = database ?? createDatabase(loadConfig().DATABASE_URL);
  }

  async listUpcoming(): Promise<TorkPrematchResponse> {
    this.assertEnabled();
    const rows = await this.execute<TorkRow>(this.selectSql(sql`
      and m.scheduled_start_at > now()
      order by m.scheduled_start_at, m.id`));
    const items = this.mapRows(rows);
    return { modelVersion: "tork-stage1-logistic-blend", modelLabel: MODEL_LABEL, count: items.length, disclaimer: DISCLAIMER, items };
  }

  async getMatch(matchId: string): Promise<TorkPrematchItem> {
    this.assertEnabled();
    const rows = await this.execute<TorkRow>(this.selectSql(sql`
      and m.id = ${matchId}
      order by p.published_at desc`));
    const items = this.mapRows(rows);
    if (!items[0]) throw new NotFoundException("No published Tork beta prediction for this match.");
    return items[0];
  }

  private assertEnabled() {
    if (process.env.TORK_PREMATCH_ENABLED === "false") {
      throw new ServiceUnavailableException("Karşılıklı gol tahminleri geçici olarak kapalı.");
    }
  }

  private selectSql(extra: ReturnType<typeof sql>) {
    return sql`
      select
        m.id as match_id, c.id::text as competition_id, c.name as league, m.scheduled_start_at as kickoff_at,
        ht.name as home_team, at.name as away_team,
        ht.id::text as home_team_id, at.id::text as away_team_id,
        ht.logo_url as home_team_logo_url, at.logo_url as away_team_logo_url,
        p.id::text as prediction_id,
        p.model_version, p.prediction_generated_at, p.published_at,
        p.p_btts, p.expected_btts_goals, p.pick, p.history_home_n, p.history_away_n,
        p.scope_level, p.history_completeness, p.evaluation_group
      from football_tork_prematch_predictions p
      inner join matches m on m.id = p.match_id
      inner join competitions c on c.id = m.competition_id
      inner join teams ht on ht.id = m.home_team_id
      inner join teams at on at.id = m.away_team_id
      where p.status = 'published'
        and p.model_id = 'TORK-A'
        and m.status in ('scheduled', 'not_started')
        and p.prediction_generated_at < m.scheduled_start_at
        ${extra}`;
  }

  private mapRows(rows: TorkRow[]): TorkPrematchItem[] {
    return rows.map((row) => ({
      matchId: row.match_id, competitionId: row.competition_id, league: row.league, kickoffAt: iso(row.kickoff_at),
      homeTeam: row.home_team, awayTeam: row.away_team,
      homeTeamId: row.home_team_id, awayTeamId: row.away_team_id,
      homeTeamLogoUrl: row.home_team_logo_url, awayTeamLogoUrl: row.away_team_logo_url,
      tork: {
        predictionId: row.prediction_id,
        predictionText: predictionText(Number(row.p_btts)),
        pBtts: Number(row.p_btts),
        expectedBttsGoals: Number(row.expected_btts_goals),
        pick: row.pick,
        pickLabel: pickLabel(Number(row.p_btts)),
        modelId: "TORK-A",
        modelVersion: row.model_version,
        modelLabel: MODEL_LABEL,
        generatedAt: iso(row.prediction_generated_at),
        publishedAt: iso(row.published_at)
      },
      historyHomeN: row.history_home_n, historyAwayN: row.history_away_n,
      scopeLevel: row.scope_level, historyCompleteness: row.history_completeness,
      evaluationGroup: row.evaluation_group,
      performanceNote: PERFORMANCE_NOTE,
      disclaimer: DISCLAIMER
    }));
  }

  private async execute<T>(query: ReturnType<typeof sql>): Promise<T[]> {
    const result = await this.database.execute(query);
    if (Array.isArray(result)) return result as T[];
    if (result && typeof result === "object" && "rows" in result && Array.isArray(result.rows)) return result.rows as T[];
    return [];
  }
}
