import json
import time
import os
import sys
from curl_cffi import requests

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

def fetch_json(url, retries=3):
    for i in range(retries):
        try:
            r = requests.get(url, headers=headers, impersonate="chrome124", timeout=15)
            if r.status_code == 200:
                return r.json()
            elif r.status_code == 404:
                return None
            else:
                time.sleep(1)
        except Exception as e:
            time.sleep(1)
    return None

def main():
    print(f"Scraping {len(tournaments_config)} leagues from SofaScore...")
    results = []

    for cfg in tournaments_config:
        tid = cfg["id"]
        print(f"\n[{cfg['country']}] {cfg['league']} (ID: {tid})...")
        
        # 1. Fetch seasons
        seasons_data = fetch_json(f"https://api.sofascore.com/api/v1/unique-tournament/{tid}/seasons")
        if not seasons_data or not seasons_data.get("seasons"):
            print(f"  Warning: No seasons for {cfg['league']}")
            continue
        
        seasons = seasons_data["seasons"]
        active_season = seasons[0]
        season_id = active_season["id"]
        season_name = active_season["name"]

        # 2. Fetch total standings
        standings_total = fetch_json(f"https://api.sofascore.com/api/v1/unique-tournament/{tid}/season/{season_id}/standings/total")
        total_rows = []
        if standings_total and standings_total.get("standings"):
            total_rows = standings_total["standings"][0].get("rows", [])
        
        # If no standings in latest season, fallback to prior season
        if not total_rows and len(seasons) > 1:
            active_season = seasons[1]
            season_id = active_season["id"]
            season_name = active_season["name"]
            standings_total = fetch_json(f"https://api.sofascore.com/api/v1/unique-tournament/{tid}/season/{season_id}/standings/total")
            if standings_total and standings_total.get("standings"):
                total_rows = standings_total["standings"][0].get("rows", [])

        # 3. Fetch home and away standings
        home_map = {}
        standings_home = fetch_json(f"https://api.sofascore.com/api/v1/unique-tournament/{tid}/season/{season_id}/standings/home")
        if standings_home and standings_home.get("standings"):
            for hr in standings_home["standings"][0].get("rows", []):
                t_id = hr.get("team", {}).get("id")
                if t_id:
                    home_map[t_id] = hr

        away_map = {}
        standings_away = fetch_json(f"https://api.sofascore.com/api/v1/unique-tournament/{tid}/season/{season_id}/standings/away")
        if standings_away and standings_away.get("standings"):
            for ar in standings_away["standings"][0].get("rows", []):
                t_id = ar.get("team", {}).get("id")
                if t_id:
                    away_map[t_id] = ar

        # 4. Parse teams and standings
        teams = []
        for row in total_rows:
            t = row.get("team", {})
            t_id = t.get("id")
            if not t_id:
                continue
            
            hr = home_map.get(t_id, {})
            ar = away_map.get(t_id, {})

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

        print(f"  Teams loaded: {len(teams)} (Season: {season_name})")

        # 5. Fetch last finished matches
        recent_matches = []
        events_last = fetch_json(f"https://api.sofascore.com/api/v1/unique-tournament/{tid}/season/{season_id}/events/last/0")
        if events_last and events_last.get("events"):
            for ev in events_last["events"][:15]:
                status_type = ev.get("status", {}).get("type")
                if status_type in ["finished", "ended"]:
                    recent_matches.append({
                        "sofascore_id": ev.get("id"),
                        "home_team_id": ev.get("homeTeam", {}).get("id"),
                        "home_team_name": ev.get("homeTeam", {}).get("name"),
                        "away_team_id": ev.get("awayTeam", {}).get("id"),
                        "away_team_name": ev.get("awayTeam", {}).get("name"),
                        "scheduled_start_at": ev.get("startTimestamp"),
                        "status": "finished",
                        "home_score": ev.get("homeScore", {}).get("current"),
                        "away_score": ev.get("awayScore", {}).get("current"),
                        "round": str(ev.get("roundInfo", {}).get("round", "")),
                        "venue": ev.get("venue", {}).get("name", "")
                    })
        print(f"  Recent finished matches loaded: {len(recent_matches)}")

        # 6. Fetch upcoming matches
        upcoming_matches = []
        events_next = fetch_json(f"https://api.sofascore.com/api/v1/unique-tournament/{tid}/season/{season_id}/events/next/0")
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

        time.sleep(0.5)

    output_path = os.path.join(os.path.dirname(__file__), "sofascore_catalog.json")
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    total_teams = sum(len(r["teams"]) for r in results)
    total_finished = sum(len(r["recent_matches"]) for r in results)
    total_upcoming = sum(len(r["upcoming_matches"]) for r in results)

    print("\n==================================================")
    print(f"SCRAPING COMPLETE!")
    print(f"Total Leagues: {len(results)}")
    print(f"Total Authentic Teams: {total_teams}")
    print(f"Total Finished Matches: {total_finished}")
    print(f"Total Upcoming Fixtures: {total_upcoming}")
    print(f"Data saved to: {output_path}")
    print("==================================================")

if __name__ == "__main__":
    main()
