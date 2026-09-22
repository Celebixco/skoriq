const https = require('https');

function postLogin() {
  const data = JSON.stringify({ email: 'admin@skoriq.local', password: 'AdminPassword123!' });
  const req = https.request({
    hostname: 'skoriq-api.87.76.130.252.sslip.io',
    path: '/api/auth/login',
    method: 'POST',
    rejectUnauthorized: false,
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': data.length
    }
  }, (res) => {
    let body = '';
    res.on('data', c => body += c);
    res.on('end', () => {
      console.log('Login Status:', res.statusCode);
      const cookies = res.headers['set-cookie'] || [];
      const cookieHeader = cookies.map(c => c.split(';')[0]).join('; ');
      console.log('Auth cookie received:', cookieHeader.length > 0);
      
      fetchCountries(cookieHeader);
    });
  });
  req.on('error', e => console.error('Login error:', e));
  req.write(data);
  req.end();
}

function fetchCountries(cookie) {
  https.get({
    hostname: 'skoriq-api.87.76.130.252.sslip.io',
    path: '/api/football/countries',
    rejectUnauthorized: false,
    headers: {
      'Cookie': cookie,
      'Accept': 'application/json'
    }
  }, (res) => {
    let body = '';
    res.on('data', c => body += c);
    res.on('end', () => {
      console.log('\n=======================================');
      console.log('COUNTRIES SUMMARY:');
      console.log('=======================================');
      try {
        const countries = JSON.parse(body);
        console.log('Total countries:', countries.length);
        countries.forEach(c => {
          console.log(`  - ${c.name}: ${c.competitionCount} competitions, ${c.teamCount} teams, ${c.matchCount} matches (finished: ${c.finishedMatchCount}, upcoming: ${c.upcomingMatchCount})`);
        });
      } catch(e) {
        console.log('Body:', body);
      }
      fetchCompetitions(cookie);
    });
  });
}

function fetchCompetitions(cookie) {
  https.get({
    hostname: 'skoriq-api.87.76.130.252.sslip.io',
    path: '/api/football/competitions',
    rejectUnauthorized: false,
    headers: {
      'Cookie': cookie,
      'Accept': 'application/json'
    }
  }, (res) => {
    let body = '';
    res.on('data', c => body += c);
    res.on('end', () => {
      console.log('\n=======================================');
      console.log('COMPETITIONS SUMMARY:');
      console.log('=======================================');
      try {
        const comps = JSON.parse(body);
        const items = comps.items || comps;
        console.log('Total competitions returned:', items.length);
        items.forEach(c => {
          console.log(`  - ${c.name} (${c.country?.name || c.country}): Teams: ${c.teamCount || c.teamsCount}, Logo: ${c.logoUrl}`);
        });

        const superLig = items.find(c => (c.name && c.name.includes('Süper Lig')) || (c.name && c.name.includes('Super Lig'))) || items[0];
        if (superLig) {
          fetchCompetitionProfile(cookie, superLig.id || superLig.competitionId);
        }
      } catch(e) {
        console.log('Body:', body);
      }
    });
  });
}

function fetchCompetitionProfile(cookie, compId) {
  https.get({
    hostname: 'skoriq-api.87.76.130.252.sslip.io',
    path: '/api/football/competitions/' + compId + '/profile',
    rejectUnauthorized: false,
    headers: {
      'Cookie': cookie,
      'Accept': 'application/json'
    }
  }, (res) => {
    let body = '';
    res.on('data', c => body += c);
    res.on('end', () => {
      console.log('\n=======================================');
      console.log('COMPETITION PROFILE DETAILS:');
      console.log('=======================================');
      try {
        const prof = JSON.parse(body);
        console.log('League:', prof.competition?.name);
        console.log('Country:', prof.competition?.country?.name);
        console.log('League Logo URL:', prof.competition?.logoUrl);
        console.log('Data Status:', prof.dataCoverage?.dataStatus);
        console.log('Total Teams:', prof.teams?.length);
        console.log('Total Standings Rows:', prof.standings?.length);
        console.log('\nTop 8 Standings:');
        (prof.standings || []).slice(0, 8).forEach(s => {
          console.log(`  P${s.position} ${s.teamName.padEnd(26)} | Played: ${s.played} | W:${s.wins} D:${s.draws} L:${s.losses} | GF:${s.goalsFor} GA:${s.goalsAgainst} GD:${s.goalDifference > 0 ? '+' + s.goalDifference : s.goalDifference} | Pts: ${s.points} | Logo: ${s.logoUrl}`);
        });
        console.log('\nRecent Finished Matches:');
        (prof.recentMatches || []).slice(0, 5).forEach(m => {
          console.log(`  ${m.homeTeam?.name} vs ${m.awayTeam?.name} (Status: ${m.status}, Kickoff: ${m.kickoffAt})`);
        });
        console.log('\nUpcoming Scheduled Fixtures:');
        (prof.upcomingMatches || []).slice(0, 5).forEach(m => {
          console.log(`  ${m.homeTeam?.name} vs ${m.awayTeam?.name} (Kickoff: ${m.kickoffAt})`);
        });

        fetchTeams(cookie);
      } catch(e) {
        console.log('Profile parse error:', e.message, body.slice(0, 300));
      }
    });
  });
}

function fetchTeams(cookie) {
  https.get({
    hostname: 'skoriq-api.87.76.130.252.sslip.io',
    path: '/api/football/teams?limit=15',
    rejectUnauthorized: false,
    headers: {
      'Cookie': cookie,
      'Accept': 'application/json'
    }
  }, (res) => {
    let body = '';
    res.on('data', c => body += c);
    res.on('end', () => {
      console.log('\n=======================================');
      console.log('TEAMS SAMPLE WITH OFFICIAL LOGOS:');
      console.log('=======================================');
      const data = JSON.parse(body);
      console.log('Total teams count in database:', data.pagination?.total);
      (data.items || []).forEach(t => {
        console.log(`  - ${t.name.padEnd(25)} | Country: ${t.country} | Logo: ${t.logoUrl} | hasLogo: ${t.hasLogo}`);
      });
      console.log('=======================================');
    });
  });
}

postLogin();
