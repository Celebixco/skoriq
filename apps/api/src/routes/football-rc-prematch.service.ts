import { Inject, Injectable, Optional, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { loadConfig } from "@sports-data/config";
import { createDatabase } from "@sports-data/database";
import type { Database } from "@sports-data/database";
import { sql } from "drizzle-orm";

export interface RcPrematchProbability {
  p1: number;
  px: number;
  p2: number;
  pick: "1" | "X" | "2";
  pickLabel: string;
  modelId: "R-A" | "R-C";
  modelVersion: string;
  modelLabel: string;
  generatedAt: string;
  publishedAt: string;
}

export interface RcPrematchItem {
  matchId: string;
  league: string;
  kickoffAt: string;
  homeTeam: string;
  awayTeam: string;
  rc: RcPrematchProbability;
  ra: RcPrematchProbability;
  modelsDisagree: boolean;
  historyHomeN: number;
  historyAwayN: number;
  scopeLevel: string;
  historyCompleteness: string;
  dataWarning: string | null;
  disclaimer: string;
}

export interface RcPrematchResponse {
  modelVersion: string;
  modelLabel: string;
  count: number;
  disclaimer: string;
  items: RcPrematchItem[];
}

interface RcRow {
  match_id: string;
  league: string;
  kickoff_at: Date | string;
  home_team: string;
  away_team: string;
  model_id: "R-A" | "R-C";
  model_version: string;
  prediction_generated_at: Date | string;
  published_at: Date | string;
  p1: number | string;
  px: number | string;
  p2: number | string;
  pick: "1" | "X" | "2";
  history_home_n: number;
  history_away_n: number;
  scope_level: string;
  history_completeness: string;
}

const DISCLAIMER = "Deneysel model olasılıklarıdır; sonuç garantisi değildir.";
const MODEL_LABEL = "R-C • Beta";

function pickLabel(pick: string): string {
  return pick === "1" ? "Ev sahibi" : pick === "X" ? "Beraberlik" : "Deplasman";
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

@Injectable()
export class FootballRcPrematchService {
  private readonly database: Database;
  constructor(@Optional() @Inject("API_DATABASE") database?: Database) {
    this.database = database ?? createDatabase(loadConfig().DATABASE_URL);
  }

  async listUpcoming(): Promise<RcPrematchResponse> {
    this.assertEnabled();
    const rows = await this.execute<RcRow>(sql`
      select
        m.id as match_id, c.name as league, m.scheduled_start_at as kickoff_at,
        ht.name as home_team, at.name as away_team,
        p.model_id, p.model_version, p.prediction_generated_at, p.published_at,
        p.p1, p.px, p.p2, p.pick, p.history_home_n, p.history_away_n,
        p.scope_level, p.history_completeness
      from football_rc_prematch_predictions p
      inner join matches m on m.id = p.match_id
      inner join competitions c on c.id = m.competition_id
      inner join teams ht on ht.id = m.home_team_id
      inner join teams at on at.id = m.away_team_id
      where p.status = 'published'
        and p.model_id in ('R-A', 'R-C')
        and m.status in ('scheduled', 'not_started')
        and m.scheduled_start_at > now()
        and p.prediction_generated_at < m.scheduled_start_at
      order by m.scheduled_start_at, m.id, p.model_id
    `);
    const items = this.groupRows(rows);
    return { modelVersion: "stage11-fixed-R-A-R-C", modelLabel: MODEL_LABEL, count: items.length, disclaimer: DISCLAIMER, items };
  }

  async getMatch(matchId: string): Promise<RcPrematchItem> {
    this.assertEnabled();
    const rows = await this.execute<RcRow>(sql`
      select
        m.id as match_id, c.name as league, m.scheduled_start_at as kickoff_at,
        ht.name as home_team, at.name as away_team,
        p.model_id, p.model_version, p.prediction_generated_at, p.published_at,
        p.p1, p.px, p.p2, p.pick, p.history_home_n, p.history_away_n,
        p.scope_level, p.history_completeness
      from football_rc_prematch_predictions p
      inner join matches m on m.id = p.match_id
      inner join competitions c on c.id = m.competition_id
      inner join teams ht on ht.id = m.home_team_id
      inner join teams at on at.id = m.away_team_id
      where p.match_id = ${matchId}
        and p.status = 'published'
        and p.model_id in ('R-A', 'R-C')
        and m.status in ('scheduled', 'not_started')
        and m.scheduled_start_at > now()
        and p.prediction_generated_at < m.scheduled_start_at
      order by p.published_at desc, p.model_id
    `);
    const items = this.groupRows(rows);
    if (!items[0]) throw new NotFoundException("No published R-C beta prediction for this match.");
    return items[0];
  }

  private assertEnabled() {
    if (process.env.RC_PREMATCH_ENABLED === "false") {
      throw new ServiceUnavailableException("R-C beta tahminleri geçici olarak kapalı.");
    }
  }

  private groupRows(rows: RcRow[]): RcPrematchItem[] {
    const byMatch = new Map<string, RcRow[]>();
    for (const row of rows) {
      const list = byMatch.get(row.match_id) ?? [];
      list.push(row);
      byMatch.set(row.match_id, list);
    }
    const items: RcPrematchItem[] = [];
    for (const list of byMatch.values()) {
      const rc = list.find((row) => row.model_id === "R-C");
      const ra = list.find((row) => row.model_id === "R-A");
      if (!rc || !ra) continue;
      const scopeWarning = rc.scope_level !== "last10_available_unverified" || rc.history_completeness !== "verified"
        ? "Geçmiş pencere tam doğrulanmadı; olasılıklar mevcut kayıtlara dayanır." : null;
      items.push({
        matchId: rc.match_id, league: rc.league, kickoffAt: iso(rc.kickoff_at),
        homeTeam: rc.home_team, awayTeam: rc.away_team,
        rc: { p1: Number(rc.p1), px: Number(rc.px), p2: Number(rc.p2), pick: rc.pick,
          pickLabel: pickLabel(rc.pick), modelId: "R-C", modelVersion: rc.model_version, modelLabel: MODEL_LABEL,
          generatedAt: iso(rc.prediction_generated_at), publishedAt: iso(rc.published_at) },
        ra: { p1: Number(ra.p1), px: Number(ra.px), p2: Number(ra.p2), pick: ra.pick,
          pickLabel: pickLabel(ra.pick), modelId: "R-A", modelVersion: ra.model_version, modelLabel: "R-A",
          generatedAt: iso(ra.prediction_generated_at), publishedAt: iso(ra.published_at) },
        modelsDisagree: rc.pick !== ra.pick,
        historyHomeN: rc.history_home_n, historyAwayN: rc.history_away_n,
        scopeLevel: rc.scope_level, historyCompleteness: rc.history_completeness,
        dataWarning: scopeWarning,
        disclaimer: DISCLAIMER
      });
    }
    return items;
  }

  private async execute<T>(query: ReturnType<typeof sql>): Promise<T[]> {
    const result = await this.database.execute(query);
    if (Array.isArray(result)) return result as T[];
    if (result && typeof result === "object" && "rows" in result && Array.isArray(result.rows)) return result.rows as T[];
    return [];
  }
}
