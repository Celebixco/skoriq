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

def fetch_json(session, url, retries=2):
    for i in range(retries):
        try:
            res = session.get(url, headers=headers, timeout=12)
            if res.status_code == 200:
                return res.json()
            elif res.status_code == 404:
                return None
        except Exception as e:
            if i == retries - 1:
                return None
            time.sleep(0.3)
    return None

def fetch_match_statistics(session, event_id):
    data = fetch_json(session, f"https://api.sofascore.com/api/v1/event/{event_id}/statistics")
    if not data or "statistics" not in data:
        return None
    
    all_period = None
    for period in data["statistics"]:
        if period.get("period") == "ALL":
            all_period = period
            break
    if not all_period and data["statistics"]:
        all_period = data["statistics"][0]
        
    if not all_period or "groups" not in all_period:
        return None

    home_stats = {"is_home": True}
    away_stats = {"is_home": False}

    key_map = {
        "Expected goals": "expected_goals",
        "Ball possession": "possession_percent",
        "Total shots": "shots_total",
        "Shots on target": "shots_on_target",
        "Shots off target": "shots_off_target",
        "Blocked shots": "blocked_shots",
        "Corner kicks": "corners",
        "Fouls": "fouls",
        "Yellow cards": "yellow_cards",
        "Red cards": "red_cards",
        "Offsides": "offsides",
        "Goalkeeper saves": "goalkeeper_saves",
        "Passes": "passes",
        "Accurate passes": "accurate_passes",
        "Big chances": "big_chances",
        "Big chances missed": "big_chances_missed",
        "Tackles": "tackles",
        "Interceptions": "interceptions",
        "Clearances": "clearances",
        "Hit woodwork": "hit_woodwork",
    }

    def parse_stat_val(val_str):
        if val_str is None:
            return None
        s = str(val_str).replace("%", "").strip()
        if "/" in s:
            s = s.split("/")[0].strip()
        try:
            if "." in s:
                return float(s)
            return int(s)
        except:
            return None

    for grp in all_period["groups"]:
        for item in grp.get("statisticsItems", []):
            name = item.get("name")
            if name in key_map:
                field = key_map[name]
                home_stats[field] = parse_stat_val(item.get("home"))
                away_stats[field] = parse_stat_val(item.get("away"))

    return {
        "home": home_stats,
        "away": away_stats
    }

def main():
    catalog_path = os.path.join(os.path.dirname(__file__), "sofascore_catalog.json")
    if not os.path.exists(catalog_path):
        print("Catalog not found at", catalog_path)
        return

    with open(catalog_path, "r", encoding="utf-8") as f:
        catalog = json.load(f)

    session = requests.Session(impersonate="chrome124")
    print(f"Loaded catalog with {len(catalog)} leagues. Starting squad and event enrichment...")

    total_enriched_teams = 0
    total_players_found = 0
    total_new_matches = 0

    priority_tournaments = [52, 98, 17, 8, 23, 35, 34, 7] # TR, GB, ES, IT, DE, FR, UCL

    for league in catalog:
        tid = league.get("sofascore_tournament_id")
        lname = league.get("league_name")
        teams = league.get("teams", [])
        
        is_priority = tid in priority_tournaments or "Süper Lig" in lname or "Premier" in lname

        print(f"\nProcessing {lname} (TID: {tid}, Priority: {is_priority}, Teams: {len(teams)})...")
        
        teams_to_process = teams if is_priority else teams[:4]

        for team in teams_to_process:
            team_id = team.get("sofascore_id")
            team_name = team.get("name")
            if not team_id:
                continue

            # 1. Fetch Squad Players if not already captured
            if "players" not in team or not team["players"]:
                time.sleep(0.04)
                pl_data = fetch_json(session, f"https://api.sofascore.com/api/v1/team/{team_id}/players")
                if pl_data and "players" in pl_data:
                    parsed_players = []
                    for item in pl_data["players"]:
                        p = item.get("player", {})
                        pid = p.get("id")
                        if not pid:
                            continue
                        parsed_players.append({
                            "sofascore_id": pid,
                            "name": p.get("name"),
                            "short_name": p.get("shortName") or p.get("name"),
                            "slug": p.get("slug") or f"player-{pid}",
                            "position": p.get("position"), # G, D, M, F
                            "jersey_number": p.get("jerseyNumber") or p.get("shirtNumber"),
                            "height": p.get("height"),
                            "preferred_foot": p.get("preferredFoot"),
                            "date_of_birth_timestamp": p.get("dateOfBirthTimestamp"),
                            "country_name": p.get("country", {}).get("name"),
                            "country_code": p.get("country", {}).get("alpha2"),
                            "photo_url": f"https://img.sofascore.com/api/v1/player/{pid}/image",
                            "proposed_market_value": p.get("proposedMarketValue")
                        })
                    team["players"] = parsed_players
                    total_players_found += len(parsed_players)
                    print(f"  [Squad] {team_name}: {len(parsed_players)} players")

            # 2. Fetch Last Matches (Events) - authentic current season, sorted newest first
            time.sleep(0.04)
            ev_data = fetch_json(session, f"https://api.sofascore.com/api/v1/team/{team_id}/events/last/0")
            if ev_data and "events" in ev_data:
                parsed_events = []
                # Filter finished official competitive events (ignore friendlies)
                eligible_events = []
                for ev in ev_data["events"]:
                    st = ev.get("status", {}).get("type")
                    if st not in ["finished", "ended"]:
                        continue
                    t_name = ev.get("tournament", {}).get("name", "")
                    t_slug = ev.get("tournament", {}).get("slug", "")
                    if "friendly" in t_name.lower() or "friendly" in t_slug.lower():
                        continue
                    eligible_events.append(ev)

                # Sort by startTimestamp descending (most recent first!)
                eligible_events.sort(key=lambda x: x.get("startTimestamp", 0), reverse=True)

                # Prioritize current season (26/27 or startTimestamp >= July 2026)
                current_season_events = [
                    ev for ev in eligible_events
                    if "26/27" in str(ev.get("season", {}).get("name", ""))
                    or "26/27" in str(ev.get("season", {}).get("year", ""))
                    or ev.get("startTimestamp", 0) >= 1782864000 # July 1, 2026
                ]
                selected_events = current_season_events if current_season_events else eligible_events

                for ev in selected_events[:10]:
                    ev_id = ev.get("id")
                    hs = ev.get("homeScore", {})
                    as_ = ev.get("awayScore", {})
                    home_t = ev.get("homeTeam", {})
                    away_t = ev.get("awayTeam", {})
                    ev_ut = ev.get("tournament", {}).get("uniqueTournament", {})
                    t_id = ev_ut.get("id") or ev.get("tournament", {}).get("id")
                    t_name = ev_ut.get("name") or ev.get("tournament", {}).get("name")

                    match_item = {
                        "sofascore_id": ev_id,
                        "tournament_id": t_id,
                        "tournament_name": t_name,
                        "season_id": ev.get("season", {}).get("id"),
                        "season_name": ev.get("season", {}).get("name"),
                        "round": str(ev.get("roundInfo", {}).get("round", "")),
                        "slug": ev.get("slug"),
                        "start_timestamp": ev.get("startTimestamp"),
                        "status": "finished",
                        "home_team_id": home_t.get("id"),
                        "home_team_name": home_t.get("name"),
                        "home_team_slug": home_t.get("slug"),
                        "home_team_logo": f"https://img.sofascore.com/api/v1/team/{home_t.get('id')}/image",
                        "away_team_id": away_t.get("id"),
                        "away_team_name": away_t.get("name"),
                        "away_team_slug": away_t.get("slug"),
                        "away_team_logo": f"https://img.sofascore.com/api/v1/team/{away_t.get('id')}/image",
                        "home_score": hs.get("current"),
                        "away_score": as_.get("current"),
                        "home_score_halftime": hs.get("period1"),
                        "away_score_halftime": as_.get("period1"),
                        "winner_code": ev.get("winnerCode"),
                        "has_xg": ev.get("hasXg", False),
                        "statistics": None
                    }

                    if ev.get("hasXg") and len(parsed_events) < 3:
                        time.sleep(0.04)
                        m_stats = fetch_match_statistics(session, ev_id)
                        if m_stats:
                            match_item["statistics"] = m_stats

                    parsed_events.append(match_item)
                    total_new_matches += 1

                team["recent_matches"] = parsed_events
                latest_summary = f" (latest: {parsed_events[0]['home_team_name']} {parsed_events[0]['home_score']}-{parsed_events[0]['away_score']} {parsed_events[0]['away_team_name']})" if parsed_events else ""
                print(f"  [Events] {team_name}: {len(parsed_events)} authentic 26/27 matches{latest_summary}")

            total_enriched_teams += 1

        if not league.get("recent_matches"):
            league["recent_matches"] = []

    with open(catalog_path, "w", encoding="utf-8") as f:
        json.dump(catalog, f, ensure_ascii=False, indent=2)

    print(f"\n==========================================")
    print(f"ENRICHMENT COMPLETE!")
    print(f"Teams enriched: {total_enriched_teams}")
    print(f"Total squad players captured: {total_players_found}")
    print(f"Total match events captured: {total_new_matches}")
    print(f"Catalog saved to {catalog_path}")
    print(f"==========================================")

if __name__ == "__main__":
    main()
