/* eslint-disable */
const https = require('https');

const depId = process.argv[2] || '5renj1ommow5icft1bnqiigl';

const options = {
  hostname: 'coolify.flixify.vip',
  path: `/api/v1/deployments/${depId}`,
  headers: {
    'Authorization': 'Bearer 7|93JYnrLwU6hDp9fbzXBVXzFvcmfLuodnN94I7RVc02282450',
    'Accept': 'application/json'
  }
};

https.get(options, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    try {
      const json = JSON.parse(data);
      console.log('Deployment ID:', json.id);
      console.log('Status:', json.status);
      console.log('Updated at:', json.updated_at);
      if (json.logs) {
        let logs;
        try {
          logs = typeof json.logs === 'string' ? JSON.parse(json.logs) : json.logs;
        } catch {
          logs = [];
        }
        console.log(`Total log entries: ${logs.length}`);
        const lastFew = logs.slice(-8);
        console.log('--- Recent logs ---');
        lastFew.forEach((l) => {
          console.log(`[${l.timestamp || ''}] ${l.command ? l.command + ' => ' : ''}${l.output || ''}`);
        });
      }
    } catch (e) {
      console.error(e.message, data.slice(0, 300));
    }
  });
}).on('error', (err) => {
  console.error('Request error:', err.message);
});
