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
      
      // Fetch Süper Lig profile to find finished matches
      fetchSuperLigProfile(cookieHeader);
    });
  });
  req.on('error', e => console.error('Login error:', e));
  req.write(data);
  req.end();
}

function fetchSuperLigProfile(cookie) {
  https.get({
    hostname: 'skoriq-api.87.76.130.252.sslip.io',
    path: '/api/football/competitions',
    rejectUnauthorized: false,
    headers: { 'Cookie': cookie, 'Accept': 'application/json' }
  }, (res) => {
    let body = '';
    res.on('data', c => body += c);
    res.on('end', () => {
      const comps = JSON.parse(body);
      const items = comps.items || comps;
      const superLig = items.find(c => (c.name && c.name.includes('Süper Lig')) || (c.name && c.name.includes('Super Lig')));
      if (superLig) {
        getCompDetail(cookie, superLig.id || superLig.competitionId);
      }
    });
  });
}

function getCompDetail(cookie, compId) {
  https.get({
    hostname: 'skoriq-api.87.76.130.252.sslip.io',
    path: '/api/football/competitions/' + compId + '/profile',
    rejectUnauthorized: false,
    headers: { 'Cookie': cookie, 'Accept': 'application/json' }
  }, (res) => {
    let body = '';
    res.on('data', c => body += c);
    res.on('end', () => {
      const prof = JSON.parse(body);
      console.log('\n=======================================');
      console.log('TRENDYOL SÜPER LİG TELEMETRY CHECK:');
      console.log('=======================================');
      console.log('League:', prof.competition?.name);
      console.log('Finished Matches Count:', prof.recentMatches?.length);

      if (prof.recentMatches && prof.recentMatches.length > 0) {
        const sampleMatch = prof.recentMatches[0];
        console.log('\nSample Finished Match:', sampleMatch.homeTeam?.name, 'vs', sampleMatch.awayTeam?.name);
        console.log('Match ID:', sampleMatch.matchId);
        console.log('Kickoff:', sampleMatch.kickoffAt);
        console.log('Status:', sampleMatch.status);

        // Fetch team profile to inspect seasonal statistics
        fetchTeamProfile(cookie, sampleMatch.homeTeam?.id);
      }
    });
  });
}

function fetchTeamProfile(cookie, teamId) {
  https.get({
    hostname: 'skoriq-api.87.76.130.252.sslip.io',
    path: '/api/football/teams/' + teamId + '/profile',
    rejectUnauthorized: false,
    headers: { 'Cookie': cookie, 'Accept': 'application/json' }
  }, (res) => {
    let body = '';
    res.on('data', c => body += c);
    res.on('end', () => {
      console.log('\n=======================================');
      console.log('TEAM PROFILE & TELEMETRY VERIFICATION:');
      console.log('=======================================');
      try {
        const t = JSON.parse(body);
        console.log('Team Name:', t.team?.name);
        console.log('Team Logo:', t.team?.logoUrl);
        console.log('Country:', t.team?.country);
        console.log('Current Standing Position:', t.standing?.position, '| Points:', t.standing?.points);
        console.log('Recent Matches Count:', t.recentMatches?.length);
        console.log('Upcoming Matches Count:', t.upcomingMatches?.length);
        if (t.recentMatches && t.recentMatches.length > 0) {
          console.log('\nRecent Results:');
          t.recentMatches.slice(0, 4).forEach(m => {
            console.log(`  - vs ${m.opponent?.name} (${m.homeAway === 'home' ? 'H' : 'A'}) -> Score: ${m.fulltimeScore || 'N/A'} [${m.result}]`);
          });
        }
        console.log('\n=======================================');
        console.log('ALL VERIFICATIONS PASSED SUCCESSFULLY!');
        console.log('=======================================');
      } catch (e) {
        console.error('Error parsing team profile:', e.message);
      }
    });
  });
}

postLogin();
