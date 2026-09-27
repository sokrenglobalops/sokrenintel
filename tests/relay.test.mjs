// Relay mode: index.html exactly as deployed (RELAY_BASE set). Fake WebSocket, no network.
import { chromium } from 'playwright';
import fs from 'fs';
import assert from 'assert';
const HTML = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const base = (HTML.match(/const RELAY_BASE = "([^"]*)";/) || [])[1];
const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.route('**/*', r => { const u = r.request().url();
  if (u.startsWith('http://localhost')) return r.fulfill({ status: 200, contentType: 'text/html', body: HTML });
  return r.abort(); });
await page.addInitScript(() => {
  window.__sent = []; window.__urls = [];
  window.WebSocket = class { constructor(u) { window.__urls.push(u); this.url = u; this.readyState = 0; setTimeout(() => { this.readyState = 1; this.onopen && this.onopen(); }, 20); } send(m) { window.__sent.push(m); } close() { this.readyState = 3; } };
});
await page.goto('http://localhost/'); await page.waitForTimeout(1200);
const R = { relayBase: base };
await page.evaluate(() => toggleLayer('ships')); await page.waitForTimeout(300);
R.wsUrl = await page.evaluate(() => window.__urls[window.__urls.length - 1]);
R.firstSend = await page.evaluate(() => JSON.parse(window.__sent[0] || 'null'));
R.gear = await page.$$eval('#layer-chips [data-akey]', els => els.length);
// relay snapshot chunk = JSON array of AISStream messages
await page.evaluate(() => {
  const m = (mmsi, name, lat, lon) => ({ MessageType: "PositionReport", MetaData: { MMSI: mmsi, ShipName: name, latitude: lat, longitude: lon }, Message: { PositionReport: { Latitude: lat, Longitude: lon, Cog: 90, Sog: 10, TrueHeading: 90, NavigationalStatus: 0 } } });
  state.ais.ws.onmessage({ data: JSON.stringify([m(477000001, "EVER GIVEN", 26.5, 56.3), m(477000002, "FRONT ALTAIR", 26.7, 56.6)]) });
  refreshShips();
});
await page.waitForTimeout(200);
R.ships = await page.evaluate(() => state.layerStatus.ships + ' n=' + state.layerData.ships.length);
await page.evaluate(() => setSelected('iran')); await page.waitForTimeout(300);
R.lastSend = await page.evaluate(() => JSON.parse(window.__sent[window.__sent.length - 1]));
console.log(JSON.stringify(R, null, 2)); console.log('PAGE ERRORS:', errs.length ? errs : 'none');
assert.ok(/^https:\/\//.test(base), 'RELAY_BASE should be set to an https URL');
assert.strictEqual(R.wsUrl, base.replace(/\/+$/, '').replace(/^http/, 'ws') + '/ais');
assert.ok(R.firstSend && Array.isArray(R.firstSend.boxes) && !('APIKey' in R.firstSend), 'relay subscribe sends boxes only, never a key');
assert.strictEqual(R.gear, 0, 'no AIS key gear in relay mode');
assert.match(R.ships, /n=2$/);
assert.ok(Array.isArray(R.lastSend.boxes) && R.lastSend.boxes.length > 0, 'selected situation adds boxes');
await b.close();
