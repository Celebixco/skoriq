import json
import time
import os
import sys
from curl_cffi import requests

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "application/json",
    "Referer": "https://www.sofascore.com/tr/",
    "Origin": "https://www.sofascore.com"
}

tournaments_config = [
    {
        "country": "Turkey",
        "country_code": "TR",
        "country_slug": "turkey",
        "league": "Trendyol Süper Lig",
        "comp_slug": "super-lig",
        "id": 52
    },
    {
        "country": "Turkey",
        "country_code": "TR",
        "country_slug": "turkey",
        "league": "Trendyol 1.Lig",
        "comp_slug": "1-lig",
        "id": 98
    },
    {
        "country": "England",
        "country_code": "GB",
        "country_slug": "england",
        "league": "Premier League",
        "comp_slug": "premier-league",
        "id": 17
    },
    {
        "country": "England",
        "country_code": "GB",
        "country_slug": "england",
        "league": "Championship",
        "comp_slug": "championship",
        "id": 18
    },
    {
        "country": "Spain",
        "country_code": "ES",
        "country_slug": "spain",
        "league": "LaLiga",
        "comp_slug": "la-liga",
        "id": 8
    },
    {
        "country": "Spain",
        "country_code": "ES",
        "country_slug": "spain",
        "league": "LaLiga 2",
        "comp_slug": "laliga-2",
        "id": 54
    },
    {
        "country": "Italy",
        "country_code": "IT",
        "country_slug": "italy",
        "league": "Serie A",
        "comp_slug": "serie-a",
        "id": 23
    },
    {
        "country": "Italy",
        "country_code": "IT",
        "country_slug": "italy",
        "league": "Serie B",
        "comp_slug": "serie-b",
        "id": 53
    },
    {
        "country": "Germany",
        "country_code": "DE",
        "country_slug": "germany",
        "league": "Bundesliga",
        "comp_slug": "bundesliga",
        "id": 35
    },
    {
        "country": "Germany",
        "country_code": "DE",
        "country_slug": "germany",
        "league": "2. Bundesliga",
        "comp_slug": "2-bundesliga",
        "id": 44
    },
    {
        "country": "France",
        "country_code": "FR",
        "country_slug": "france",
        "league": "Ligue 1",
        "comp_slug": "ligue-1",
        "id": 34
    },
    {
        "country": "France",
        "country_code": "FR",
        "country_slug": "france",
        "league": "Ligue 2",
        "comp_slug": "ligue-2",
        "id": 182
    },
    {
        "country": "Netherlands",
        "country_code": "NL",
        "country_slug": "netherlands",
        "league": "Eredivisie",
        "comp_slug": "eredivisie",
        "id": 37
    },
    {
        "country": "Portugal",
        "country_code": "PT",
        "country_slug": "portugal",
        "league": "Liga Portugal",
        "comp_slug": "liga-portugal",
        "id": 238
    },
    {
        "country": "Europe",
        "country_code": "EU",
        "country_slug": "europe",
        "league": "UEFA Champions League",
        "comp_slug": "champions-league",
        "id": 7
    },
    {
        "country": "Europe",
        "country_code": "EU",
        "country_slug": "europe",
        "league": "UEFA Europa League",
        "comp_slug": "europa-league",
        "id": 679
    }
]

def fetch_json(session, url, retries=3):
    for i in range(retries):
        try:
            r = session.get(url, headers=headers, impersonate="chrome124", timeout=15)
            if r.status_code == 200:
                return r.json()
            elif r.status_code == 404:
                return None
            else:
                time.sleep(0.5)
        except Exception:
            time.sleep(0.5)
    return None

def parse_num(val):
    if val is None:
        return None
    if isinstance(val, (int, float)):
        return val
    s = str(val).replace("%", "").split("/")[0].strip()
    try:
        return float(s) if "." in s else int(s)
    except Exception:
        return None

def fetch_match_statistics(session, event_id):
    url = f"https://api.sofascore.com/api/v1/event/{event_id}/statistics"
    data = fetch_json(session, url)
    if not data or not data.get("statistics"):
        return None

    stats_list = data.get("statistics", [])
    all_stats = stats_list[0] if stats_list else {}
    items = {}
    for group in all_stats.get("groups", []):
        for it in group.get("statisticsItems", []):
            items[it.get("name")] = {
                "home": it.get("home"),
                "away": it.get("away")
            }

    home_stats = {
        "is_home": True,
        "possession_percent": parse_num(items.get("Ball possession", {}).get("home")),
        "shots_total": parse_num(items.get("Total shots", {}).get("home")),
        "shots_on_target": parse_num(items.get("Shots on target", {}).get("home")),
        "shots_off_target": parse_num(items.get("Shots off target", {}).get("home")),
        "blocked_shots": parse_num(items.get("Blocked shots", {}).get("home")),
        "corners": parse_num(items.get("Corner kicks", {}).get("home")),
        "fouls": parse_num(items.get("Fouls", {}).get("home")),
        "yellow_cards": parse_num(items.get("Yellow cards", {}).get("home")),
        "red_cards": parse_num(items.get("Red cards", {}).get("home")),
        "offsides": parse_num(items.get("Offsides", {}).get("home")),
        "goalkeeper_saves": parse_num(items.get("Goalkeeper saves", {}).get("home")),
        "passes": parse_num(items.get("Passes", {}).get("home")),
        "accurate_passes": parse_num(items.get("Accurate passes", {}).get("home")),
        "big_chances": parse_num(items.get("Big chances", {}).get("home")),
        "big_chances_missed": parse_num(items.get("Big chances missed", {}).get("home")),
        "expected_goals": parse_num(items.get("Expected goals", {}).get("home")),
        "tackles": parse_num(items.get("Tackles", {}).get("home")),
        "interceptions": parse_num(items.get("Interceptions", {}).get("home")),
        "clearances": parse_num(items.get("Clearances", {}).get("home")),
        "hit_woodwork": parse_num(items.get("Hit woodwork", {}).get("home")),
        "average_rating": parse_num(items.get("Average rating", {}).get("home")),
        "distance_covered": items.get("Distance covered", {}).get("home"),
        "number_of_sprints": parse_num(items.get("Number of sprints", {}).get("home"))
    }

    away_stats = {
        "is_home": False,
        "possession_percent": parse_num(items.get("Ball possession", {}).get("away")),
        "shots_total": parse_num(items.get("Total shots", {}).get("away")),
        "shots_on_target": parse_num(items.get("Shots on target", {}).get("away")),
        "shots_off_target": parse_num(items.get("Shots off target", {}).get("away")),
        "blocked_shots": parse_num(items.get("Blocked shots", {}).get("away")),
        "corners": parse_num(items.get("Corner kicks", {}).get("away")),
        "fouls": parse_num(items.get("Fouls", {}).get("away")),
        "yellow_cards": parse_num(items.get("Yellow cards", {}).get("away")),
        "red_cards": parse_num(items.get("Red cards", {}).get("away")),
        "offsides": parse_num(items.get("Offsides", {}).get("away")),
        "goalkeeper_saves": parse_num(items.get("Goalkeeper saves", {}).get("away")),
        "passes": parse_num(items.get("Passes", {}).get("away")),
        "accurate_passes": parse_num(items.get("Accurate passes", {}).get("away")),
        "big_chances": parse_num(items.get("Big chances", {}).get("away")),
        "big_chances_missed": parse_num(items.get("Big chances missed", {}).get("away")),
        "expected_goals": parse_num(items.get("Expected goals", {}).get("away")),
        "tackles": parse_num(items.get("Tackles", {}).get("away")),
        "interceptions": parse_num(items.get("Interceptions", {}).get("away")),
        "clearances": parse_num(items.get("Clearances", {}).get("away")),
        "hit_woodwork": parse_num(items.get("Hit woodwork", {}).get("away")),
        "average_rating": parse_num(items.get("Average rating", {}).get("away")),
        "distance_covered": items.get("Distance covered", {}).get("away"),
        "number_of_sprints": parse_num(items.get("Number of sprints", {}).get("away"))
    }

    return {
        "home": home_stats,
        "away": away_stats,
        "raw_items": items
    }

def fetch_team_season_statistics(session, team_id, tournament_id, season_id):
    url = f"https://api.sofascore.com/api/v1/team/{team_id}/unique-tournament/{tournament_id}/season/{season_id}/statistics/overall"
    data = fetch_json(session, url)
    return data.get("statistics", {}) if data else {}

def main():
    print(f"Scraping {len(tournaments_config)} leagues with match & team telemetry statistics from SofaScore...")
    session = requests.Session()
    results = []

    total_stats_matches = 0
    total_stats_teams = 0

    for cfg in tournaments_config:
        tid = cfg["id"]
        print(f"\n[{cfg['country']}] {cfg['league']} (Tournament ID: {tid})...")
        
        # 1. Fetch seasons
        seasons_data = fetch_json(session, f"https://api.sofascore.com/api/v1/unique-tournament/{tid}/seasons")
        if not seasons_data or not seasons_data.get("seasons"):
            print(f"  Warning: No seasons for {cfg['league']}")
            continue
        
        seasons = seasons_data["seasons"]
        active_season = None
        season_id = None
        season_name = None
        total_rows = []

        # Find current active season with played matches
        for s in seasons[:4]:
            cand_id = s["id"]
            standings_cand = fetch_json(session, f"https://api.sofascore.com/api/v1/unique-tournament/{tid}/season/{cand_id}/standings/total")
            if standings_cand and standings_cand.get("standings"):
                rows = standings_cand["standings"][0].get("rows", [])
                if rows and len(rows) > 0:
                    matches_played = sum(r.get("matches", 0) for r in rows)
                    if matches_played > 0:
                        active_season = s
                        season_id = cand_id
                        season_name = s["name"]
                        total_rows = rows
                        break

        if not active_season:
            active_season = seasons[0]
            season_id = active_season["id"]
            season_name = active_season["name"]
            standings_total = fetch_json(session, f"https://api.sofascore.com/api/v1/unique-tournament/{tid}/season/{season_id}/standings/total")
            if standings_total and standings_total.get("standings"):
                total_rows = standings_total["standings"][0].get("rows", [])

        # 3. Fetch home and away standings
        home_map = {}
        standings_home = fetch_json(session, f"https://api.sofascore.com/api/v1/unique-tournament/{tid}/season/{season_id}/standings/home")
        if standings_home and standings_home.get("standings"):
            for hr in standings_home["standings"][0].get("rows", []):
                t_id = hr.get("team", {}).get("id")
                if t_id:
                    home_map[t_id] = hr

        away_map = {}
        standings_away = fetch_json(session, f"https://api.sofascore.com/api/v1/unique-tournament/{tid}/season/{season_id}/standings/away")
        if standings_away and standings_away.get("standings"):
            for ar in standings_away["standings"][0].get("rows", []):
                t_id = ar.get("team", {}).get("id")
                if t_id:
                    away_map[t_id] = ar

        # 4. Parse teams, standings, and seasonal team telemetry statistics
        teams = []
        for row in total_rows:
            t = row.get("team", {})
            t_id = t.get("id")
            if not t_id:
                continue
            
            hr = home_map.get(t_id, {})
            ar = away_map.get(t_id, {})

            # Fetch team season overall statistics (125 metrics)
            team_season_stats = fetch_team_season_statistics(session, t_id, tid, season_id)
            if team_season_stats:
                total_stats_teams += 1

            team_country = t.get("country", {})
            teams.append({
                "sofascore_id": t_id,
                "name": t.get("name"),
                "short_name": t.get("shortName") or t.get("name"),
                "name_code": t.get("nameCode") or "",
                "slug": t.get("slug") or f"team-{t_id}",
                "logo_url": f"https://img.sofascore.com/api/v1/team/{t_id}/image",
                "country_name": team_country.get("name") or cfg["country"],
                "country_code": team_country.get("alpha2") or cfg["country_code"],
                "country_slug": team_country.get("slug") or cfg["country_slug"],
                "team_colors": t.get("teamColors", {}),
                "season_statistics": team_season_stats,
                "position": row.get("position"),
                "played": row.get("matches", 0),
                "wins": row.get("wins", 0),
                "draws": row.get("draws", 0),
                "losses": row.get("losses", 0),
                "goals_for": row.get("scoresFor", 0),
                "goals_against": row.get("scoresAgainst", 0),
                "goal_difference": row.get("scoresFor", 0) - row.get("scoresAgainst", 0),
                "points": row.get("points", 0),
                "home_played": hr.get("matches", 0),
                "home_wins": hr.get("wins", 0),
                "home_draws": hr.get("draws", 0),
                "home_losses": hr.get("losses", 0),
                "home_goals_for": hr.get("scoresFor", 0),
                "home_goals_against": hr.get("scoresAgainst", 0),
                "away_played": ar.get("matches", 0),
                "away_wins": ar.get("wins", 0),
                "away_draws": ar.get("draws", 0),
                "away_losses": ar.get("losses", 0),
                "away_goals_for": ar.get("scoresFor", 0),
                "away_goals_against": ar.get("scoresAgainst", 0),
            })

        print(f"  Teams loaded: {len(teams)} (Season stats captured for {sum(1 for tm in teams if tm.get('season_statistics'))} teams)")

        # 5. Fetch last finished matches AND their match telemetry statistics
        recent_matches = []
        events_last = fetch_json(session, f"https://api.sofascore.com/api/v1/unique-tournament/{tid}/season/{season_id}/events/last/0")
        if events_last and events_last.get("events"):
            finished_events = [ev for ev in events_last["events"] if ev.get("status", {}).get("type") in ["finished", "ended"]]
            finished_events.sort(key=lambda x: x.get("startTimestamp", 0), reverse=True)
            for ev in finished_events[:15]:
                ev_id = ev.get("id")
                match_stats = fetch_match_statistics(session, ev_id)
                if match_stats:
                    total_stats_matches += 1

                recent_matches.append({
                    "sofascore_id": ev_id,
                    "tournament_id": tid,
                    "home_team_id": ev.get("homeTeam", {}).get("id"),
                    "home_team_name": ev.get("homeTeam", {}).get("name"),
                    "away_team_id": ev.get("awayTeam", {}).get("id"),
                    "away_team_name": ev.get("awayTeam", {}).get("name"),
                    "scheduled_start_at": ev.get("startTimestamp"),
                    "status": "finished",
                    "home_score": ev.get("homeScore", {}).get("current"),
                    "away_score": ev.get("awayScore", {}).get("current"),
                    "round": str(ev.get("roundInfo", {}).get("round", "")),
                    "venue": ev.get("venue", {}).get("name", ""),
                    "statistics": match_stats
                })
        print(f"  Finished matches loaded: {len(recent_matches)} (Telemetry stats captured for {sum(1 for rm in recent_matches if rm.get('statistics'))} matches)")

        # 6. Fetch upcoming matches
        upcoming_matches = []
        events_next = fetch_json(session, f"https://api.sofascore.com/api/v1/unique-tournament/{tid}/season/{season_id}/events/next/0")
        if events_next and events_next.get("events"):
            for ev in events_next["events"][:10]:
                upcoming_matches.append({
                    "sofascore_id": ev.get("id"),
                    "home_team_id": ev.get("homeTeam", {}).get("id"),
                    "home_team_name": ev.get("homeTeam", {}).get("name"),
                    "away_team_id": ev.get("awayTeam", {}).get("id"),
                    "away_team_name": ev.get("awayTeam", {}).get("name"),
                    "scheduled_start_at": ev.get("startTimestamp"),
                    "status": "scheduled",
                    "round": str(ev.get("roundInfo", {}).get("round", "")),
                    "venue": ev.get("venue", {}).get("name", "")
                })
        print(f"  Upcoming fixtures loaded: {len(upcoming_matches)}")

        results.append({
            "country": cfg["country"],
            "country_code": cfg["country_code"],
            "country_slug": cfg["country_slug"],
            "league_name": cfg["league"],
            "league_slug": cfg["comp_slug"],
            "sofascore_tournament_id": tid,
            "tournament_logo_url": f"https://img.sofascore.com/api/v1/unique-tournament/{tid}/image",
            "season_id": season_id,
            "season_name": season_name,
            "teams_count": len(teams),
            "teams": teams,
            "recent_matches": recent_matches,
            "upcoming_matches": upcoming_matches
        })

        time.sleep(0.3)

    output_path = os.path.join(os.path.dirname(__file__), "sofascore_catalog.json")
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    total_teams = sum(len(r["teams"]) for r in results)
    total_finished = sum(len(r["recent_matches"]) for r in results)
    total_upcoming = sum(len(r["upcoming_matches"]) for r in results)

    print("\n==================================================")
    print(f"SCRAPING COMPLETE WITH ADVANCED TELEMETRY STATS!")
    print(f"Total Leagues: {len(results)}")
    print(f"Total Authentic Teams: {total_teams} (with seasonal stats: {total_stats_teams})")
    print(f"Total Finished Matches: {total_finished} (with match telemetry: {total_stats_matches})")
    print(f"Total Upcoming Fixtures: {total_upcoming}")
    print(f"Data saved to: {output_path}")
    print("==================================================")

if __name__ == "__main__":
    main()
