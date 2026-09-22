/* eslint-disable */
const https = require('https');
const depId = process.argv[2] || 'xiprcfznloyo2olqri7sffhg';

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
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const json = JSON.parse(data);
    const logs = JSON.parse(json.logs);
    logs.slice(-30).forEach(l => console.log(`[${l.timestamp || ''}] ${l.command ? l.command + ' => ' : ''}${l.output || ''}`));
  });
});
