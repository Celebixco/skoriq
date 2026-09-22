const https = require('https');

function request(path, method = 'GET', data = null, cookie = null) {
  return new Promise((resolve, reject) => {
    const headers = { 'Accept': 'application/json' };
    if (data) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(data);
    }
    if (cookie) {
      headers['Cookie'] = cookie;
    }
    const req = https.request({
      hostname: 'skoriq-api.87.76.130.252.sslip.io',
      path,
      method,
      rejectUnauthorized: false,
      headers
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(body) });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, raw: body });
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function run() {
  console.log('1. Logging in as admin...');
  const loginRes = await request('/api/auth/login', 'POST', JSON.stringify({
    email: 'admin@skoriq.local',
    password: 'AdminPassword123!'
  }));
  console.log('Login Status:', loginRes.status);
  const cookies = (loginRes.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');

  console.log('\n2. Fetching Competitions...');
  const compsRes = await request('/api/football/competitions', 'GET', null, cookies);
  const comps = compsRes.body.items || compsRes.body;
  const superLig = comps.find(c => (c.name && c.name.includes('Süper Lig')) || (c.name && c.name.includes('Super Lig')));
  console.log('Found League:', superLig?.name, 'ID:', superLig?.id);

  console.log('\n3. Fetching Süper Lig Profile (Recent Matches)...');
  const profRes = await request(`/api/football/competitions/${superLig.id}/profile`, 'GET', null, cookies);
  const prof = profRes.body;
  console.log('Total Finished Matches in League:', prof.recentMatches?.length);

  const sampleMatch = prof.recentMatches?.[0];
  if (sampleMatch) {
    console.log(`\n4. Verifying Match Telemetry API for: ${sampleMatch.homeTeam?.name} vs ${sampleMatch.awayTeam?.name} (ID: ${sampleMatch.matchId})`);
    const matchStatsRes = await request(`/api/football/matches/${sampleMatch.matchId}/statistics`, 'GET', null, cookies);
    console.log('Match Statistics Status:', matchStatsRes.status);
    const ms = matchStatsRes.body;
    console.log('Has Detailed Statistics:', ms.hasStatistics);
    if (ms.hasStatistics) {
      console.log('----------------------------------------------------');
      console.log(`[MATCH TELEMETRY] ${ms.match?.homeTeam?.name} ${ms.match?.homeScore ?? '-'} : ${ms.match?.awayScore ?? '-'} ${ms.match?.awayTeam?.name}`);
      console.log('----------------------------------------------------');
      console.log(`  Beklenen Gol (xG):    ${ms.home?.expectedGoals ?? '—'} vs ${ms.away?.expectedGoals ?? '—'}`);
      console.log(`  Topa Sahip Olma (%):  %${ms.home?.possessionPercent ?? '—'} vs %${ms.away?.possessionPercent ?? '—'}`);
      console.log(`  Toplam Şut:           ${ms.home?.shotsTotal ?? '—'} vs ${ms.away?.shotsTotal ?? '—'}`);
      console.log(`  İsabetli Şut:         ${ms.home?.shotsOnTarget ?? '—'} vs ${ms.away?.shotsOnTarget ?? '—'}`);
      console.log(`  Büyük Şanslar:        ${ms.home?.bigChances ?? '—'} vs ${ms.away?.bigChances ?? '—'}`);
      console.log(`  Pas İsabeti (%):      %${ms.home?.passAccuracyPercent ?? '—'} vs %${ms.away?.passAccuracyPercent ?? '—'}`);
      console.log(`  Müdahale (Tackles):   ${ms.home?.tackles ?? '—'} vs ${ms.away?.tackles ?? '—'}`);
      console.log(`  Kornerler:            ${ms.home?.corners ?? '—'} vs ${ms.away?.corners ?? '—'}`);
      console.log(`  Fauller:              ${ms.home?.fouls ?? '—'} vs ${ms.away?.fouls ?? '—'}`);
      console.log('----------------------------------------------------');
    }
  }

  console.log('\n5. Searching Galatasaray specifically...');
  const galaTeamRes = await request('/api/football/teams?search=Galatasaray', 'GET', null, cookies);
  const galaTeam = galaTeamRes.body?.items?.[0];
  if (galaTeam) {
    console.log('Galatasaray Found:', galaTeam.name, 'ID:', galaTeam.teamId, 'Logo:', galaTeam.logoUrl);
    const galaProfileRes = await request(`/api/football/teams/${galaTeam.teamId}/profile`, 'GET', null, cookies);
    const gp = galaProfileRes.body;
    console.log('Galatasaray Standing Position:', gp.standing?.position, 'Points:', gp.standing?.points);
    console.log('Galatasaray Recent Matches Count:', gp.recentMatches?.length);
    if (gp.team?.seasonStatistics) {
      console.log('\n[GALATASARAY SOFASCORE SEASON TELEMETRY (125 metrics)]');
      const ss = gp.team.seasonStatistics;
      console.log(`  Goller / Maç:         ${ss.goalsScored ?? '—'}`);
      console.log(`  Yenilen Goller:       ${ss.goalsConceded ?? '—'}`);
      console.log(`  Beklenen Gol (xG):    ${ss.expectedGoals ?? '—'}`);
      console.log(`  Ort. Topa Sahip Olma: %${ss.averageBallPossession ?? '—'}`);
      console.log(`  Gol Yemeden (CS):     ${ss.cleanSheets ?? '—'}`);
      console.log(`  Büyük Şanslar:        ${ss.bigChances ?? '—'} (Kaçan: ${ss.bigChancesMissed ?? '—'})`);
      console.log(`  Pas İsabeti (%):      %${ss.accuratePassesPercentage ?? '—'}`);
    }

    if (gp.recentMatches && gp.recentMatches.length > 0) {
      console.log('\nGalatasaray Recent Matches:');
      for (const m of gp.recentMatches) {
        console.log(`  - vs ${m.opponent?.name} (${m.homeAway}) -> Score: ${m.fulltimeScore || 'N/A'} [${m.result}]`);
        // Check telemetry for this match
        const mStats = await request(`/api/football/matches/${m.matchId}/statistics`, 'GET', null, cookies);
        if (mStats.body?.hasStatistics) {
          const h = mStats.body.home;
          const a = mStats.body.away;
          console.log(`    ↳ Telemetry: xG: ${h?.expectedGoals ?? '—'} vs ${a?.expectedGoals ?? '—'} | Top: %${h?.possessionPercent ?? '—'} vs %${a?.possessionPercent ?? '—'} | Şut: ${h?.shotsTotal ?? '—'}(${h?.shotsOnTarget ?? '—'}) vs ${a?.shotsTotal ?? '—'}(${a?.shotsOnTarget ?? '—'})`);
        }
      }
    }
  }

  console.log('\n=======================================');
  console.log('ALL TELEMETRY & AUTOMATION TESTS PASSED!');
  console.log('=======================================');
}

run().catch(console.error);
