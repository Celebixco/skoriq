import urllib.request
import json
import ssl
import http.cookiejar

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE
cj = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj), urllib.request.HTTPSHandler(context=ctx))

# Login
login_data = json.dumps({'email': 'admin@skoriq.local', 'password': 'AdminPassword123!'}).encode()
req = urllib.request.Request('https://skoriq-api.87.76.130.252.sslip.io/api/auth/login', data=login_data, headers={'Content-Type': 'application/json'})
try:
    with opener.open(req) as resp:
        print('Login status:', resp.status)
except Exception as ex:
    print('Login failed:', ex)
    exit(1)

# List Teams
req_teams = urllib.request.Request('https://skoriq-api.87.76.130.252.sslip.io/api/football/teams?search=Galatasaray')
with opener.open(req_teams) as resp:
    teams_data = json.loads(resp.read().decode())
    items = teams_data.get('items', [])
    print(f'Teams found: {len(items)}')
    if items:
        t = items[0]
        t_id = t.get('teamId') or t.get('id')
        print(f"Team: {t.get('name')} (ID: {t_id})")

        # Get Profile
        req_prof = urllib.request.Request(f'https://skoriq-api.87.76.130.252.sslip.io/api/football/teams/{t_id}/profile')
        with opener.open(req_prof) as p_resp:
            prof = json.loads(p_resp.read().decode())
            print('\nForm summary:', prof.get('formSummary', {}).get('summaryText'))
            print('Form streak:', prof.get('formSummary', {}).get('streak'))
            recent = prof.get('recentMatches', [])
            print(f'\nRecent matches count: {len(recent)}')
            for idx, m in enumerate(recent):
                opp = m.get('opponent', {}).get('name')
                print(f"  {idx+1}. [{m.get('date')}] {m.get('competition')} - vs {opp} ({m.get('homeAway')}) - Score: {m.get('fulltimeScore')} - Result: {m.get('result')}")

            upcoming = prof.get('upcomingMatches', [])
            print(f'\nUpcoming matches count: {len(upcoming)}')
            for idx, m in enumerate(upcoming[:5]):
                opp = m.get('opponent', {}).get('name')
                print(f"  {idx+1}. [{m.get('date')}] {m.get('competition')} - vs {opp} ({m.get('homeAway')})")
