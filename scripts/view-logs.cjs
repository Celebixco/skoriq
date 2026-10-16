/* eslint-disable */
const https = require('https');
const depId = process.argv[2] || 'xiprcfznloyo2olqri7sffhg';
const token = process.env.COOLIFY_API_TOKEN;
if (!token) {
  console.error('Set COOLIFY_API_TOKEN to run this script.');
  process.exit(1);
}

const options = {
  hostname: 'coolify.flixify.vip',
  path: `/api/v1/deployments/${depId}`,
  headers: {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/json'
  }
};

https.get(options, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const json = JSON.parse(data);
    const logs = JSON.parse(json.logs);
    logs.slice(-30).forEach(l => console.log(`[${l.timestamp || ''}] ${l.command ? l.command + ' => ' : ''}${l.output || ''}`));
  });
});
