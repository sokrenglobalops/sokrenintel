import WebSocket from 'ws';
const open = (name, origin) => new Promise((res, rej) => {
  const ws = new WebSocket('ws://127.0.0.1:8787/ais', { headers: { Origin: origin } });
  const R = { name, msgs: 0, snapshotItems: 0, statuses: [], first: null, errors: [] };
  ws.on('open', () => res({ ws, R }));
  ws.on('unexpected-response', (req, resp) => rej(new Error(name + ' HTTP ' + resp.statusCode)));
  ws.on('error', e => { R.errors.push(e.message); rej(e); });
  ws.on('message', d => { const t = d.toString(); let m; try { m = JSON.parse(t); } catch { return; }
    if (Array.isArray(m)) { R.snapshotItems += m.length; return; }
    if (m.MessageType === 'RelayStatus') { R.statuses.push(m.upstream + ':' + m.diag); return; }
    if (m.MetaData) { R.msgs++; if (!R.first) R.first = m.MetaData.ShipName; } });
});
// forbidden origin
try { await open('bad', 'https://evil.example'); console.log('bad origin: CONNECTED (wrong)'); } catch (e) { console.log('bad origin ->', e.message); }
const a = await open('A', 'https://www.sokren.com');
await new Promise(r => setTimeout(r, 4500));
console.log('A after 4.5s: live msgs=' + a.R.msgs + ' snapshot=' + a.R.snapshotItems + ' statuses=' + JSON.stringify(a.R.statuses));
// second client should get a snapshot immediately
const b = await open('B', 'http://localhost:8080');
await new Promise(r => setTimeout(r, 1500));
console.log('B after 1.5s: snapshot=' + b.R.snapshotItems + ' live=' + b.R.msgs + ' statuses=' + JSON.stringify(b.R.statuses.slice(0,1)));
// A asks for an extra box (selected situation)
a.ws.send(JSON.stringify({ boxes: [[[47.3, 26.5], [55.3, 34.5]]] }));
await new Promise(r => setTimeout(r, 2500));
const st = await (await fetch('http://127.0.0.1:8787/ais/status')).json();
console.log('status:', JSON.stringify(st));
// throttle check: 30 vessels × 1 msg/s upstream; forwarded should be ~30 per 6 s per client
const before = a.R.msgs; await new Promise(r => setTimeout(r, 6000));
console.log('A forwarded in 6s: ' + (a.R.msgs - before) + ' (upstream sent ~180)');
a.ws.close(); b.ws.close();
await new Promise(r => setTimeout(r, 500));
const st2 = await (await fetch('http://127.0.0.1:8787/ais/status')).json();
console.log('after close: clients=' + st2.clients + ' upstream=' + st2.upstream);
// CORS + air relay (external fetch is blocked in this sandbox, so expect a 502 with an error string, but with CORS headers)
const r = await fetch('http://127.0.0.1:8787/air/mil', { headers: { Origin: 'https://www.sokren.com' } });
console.log('air/mil:', r.status, r.headers.get('access-control-allow-origin'), (await r.text()).slice(0, 120));
const r2 = await fetch('http://127.0.0.1:8787/news?q=Armenia', { headers: { Origin: 'https://nope.example' } });
console.log('news bad origin:', r2.status);
process.exit(0);
