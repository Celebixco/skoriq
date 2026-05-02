export type APIFootballComAction =
  | "get_countries"
  | "get_leagues"
  | "get_events"
  | "get_standings"
  | "get_teams"
  | "get_H2H"
  | "get_players"
  | "get_statistics"
  | "get_lineups"
  | "get_injuries";

export interface APIFootballComCountry {
  country_id?: string;
  country_name?: string;
  [key: string]: unknown;
}

export interface APIFootballComLeague {
  country_id?: string;
  country_name?: string;
  league_id?: string;
  league_name?: string;
  [key: string]: unknown;
}

export interface APIFootballComEvent {
  match_id?: string;
  country_id?: string;
  country_name?: string;
  league_id?: string;
  league_name?: string;
  match_date?: string;
  match_time?: string;
  match_status?: string;
  match_hometeam_id?: string;
  match_hometeam_name?: string;
  match_awayteam_id?: string;
  match_awayteam_name?: string;
  match_hometeam_score?: string;
  match_awayteam_score?: string;
  match_hometeam_halftime_score?: string;
  match_awayteam_halftime_score?: string;
  match_hometeam_extra_score?: string;
  match_awayteam_extra_score?: string;
  match_hometeam_penalty_score?: string;
  match_awayteam_penalty_score?: string;
  match_hometeam_ft_score?: string;
  match_awayteam_ft_score?: string;
  match_hometeam_system?: string;
  match_awayteam_system?: string;
  match_live?: string;
  match_round?: string;
  match_stadium?: string;
  match_referee?: string;
  team_home_badge?: string;
  team_away_badge?: string;
  [key: string]: unknown;
}

export interface APIFootballComStanding {
  country_name?: string;
  league_id?: string;
  league_name?: string;
  team_id?: string;
  team_name?: string;
  overall_league_position?: string;
  overall_league_payed?: string;
  overall_league_W?: string;
  overall_league_D?: string;
  overall_league_L?: string;
  overall_league_GF?: string;
  overall_league_GA?: string;
  overall_league_PTS?: string;
  home_league_payed?: string;
  home_league_W?: string;
  home_league_D?: string;
  home_league_L?: string;
  home_league_GF?: string;
  home_league_GA?: string;
  away_league_payed?: string;
  away_league_W?: string;
  away_league_D?: string;
  away_league_L?: string;
  away_league_GF?: string;
  away_league_GA?: string;
  [key: string]: unknown;
}

export interface APIFootballComTeam {
  team_key?: string | number;
  team_id?: string | number;
  team_name?: string;
  team_badge?: string;
  team_logo?: string;
  logo?: string;
  badge?: string;
  image?: string;
  country_id?: string;
  country_name?: string;
  venue_name?: string;
  team_venue?: string;
  founded?: string | number;
  founded_year?: string | number;
  [key: string]: unknown;
}

export type APIFootballComMappingStatus = "mapped" | "unresolved";

export type APIFootballComMappingResult<T> =
  | {
      status: "mapped";
      data: T;
    }
  | {
      status: "unresolved";
      reason: string;
      metadata?: Record<string, unknown>;
    };
