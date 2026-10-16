const https = require('https');
const depId = process.argv[2] || 'dhh0vl0mwu9xztkqoahwkgg4';
const token = process.env.COOLIFY_API_TOKEN;
if (!token) {
  console.error('Set COOLIFY_API_TOKEN to run this script.');
  process.exit(1);
}

async function check() {
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 8000));
    await new Promise((resolve) => {
      https.get({
        hostname: 'coolify.flixify.vip',
        path: '/api/v1/deployments/' + depId,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json'
        }
      }, (res) => {
        let d = '';
        res.on('data', chunk => d += chunk);
        res.on('end', () => {
          try {
            const j = JSON.parse(d);
            console.log(`[${new Date().toISOString()}] Status: ${j.status}`);
            if (j.status === 'finished') {
              console.log('Deployment successful!');
              process.exit(0);
            } else if (j.status === 'failed' || j.status === 'killed') {
              console.error('Deployment ended with status:', j.status);
              if (j.logs) {
                const logs = typeof j.logs === 'string' ? JSON.parse(j.logs) : j.logs;
                console.error('--- Failure logs ---');
                logs.slice(-15).forEach(l => console.error(`[${l.timestamp}] ${l.output || ''}`));
              }
              process.exit(1);
            }
          } catch(e) {
            console.log('Parse error:', e.message);
          }
          resolve();
        });
      }).on('error', (err) => {
        console.log('Req err:', err.message);
        resolve();
      });
    });
  }
}
check();
