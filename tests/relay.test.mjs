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
// over the draw cap: 4500 plain vessels in the English Channel + one warship at Hormuz + one tanker
await page.evaluate(() => {
  setSelected(null);
  const m = (mmsi, lat, lon) => ({ MessageType: "PositionReport", MetaData: { MMSI: mmsi, ShipName: "V" + mmsi, latitude: lat, longitude: lon }, Message: { PositionReport: { Latitude: lat, Longitude: lon, Cog: 90, Sog: 10 } } });
  const batch = []; for (let i = 0; i < 4500; i++) batch.push(m(235000000 + i, 49 + (i % 60) / 30, -5 + Math.floor(i / 60) / 10));
  batch.push(m(422000009, 26.6, 56.4));
  state.ais.ws.onmessage({ data: JSON.stringify(batch) });
  state.ais.ws.onmessage({ data: JSON.stringify({ MessageType: "ShipStaticData", MetaData: { MMSI: 422000009 }, Message: { ShipStaticData: { Type: 35 } } }) });
  refreshShips();
});
await page.waitForTimeout(300);
R.capped = await page.evaluate(() => ({ heard: state.shipsHeard, drawn: state.layerData.ships.length, warshipKept: state.layerData.ships.some(v => String(v.mmsi || '') === '422000009' || v.type === 35), markers: document.querySelectorAll('#ov-pts [data-sh]').length }));
R.vesselLabel = await page.$eval('#ship-filter .sf-lab', el => el.textContent);
// zoom into Hormuz: on-screen ships jump the queue (repick after pan/zoom)
await page.evaluate(() => { const el = document.getElementById('map-wrap'); const w = el.clientWidth, h = el.clientHeight; zoomAt(6, (56.4 + 180) / 360 * w, (90 - 26.6) / 180 * h); });
await page.waitForTimeout(700);
R.hormuzFirst = await page.evaluate(() => { const v = state.layerData.ships[0]; return Math.abs(v.lat - 26.6) < 1 && Math.abs(v.lon - 56.4) < 1; });
R.laneBoxesInDirectList = await page.evaluate(() => aisBoxes().length);
console.log(JSON.stringify(R, null, 2)); console.log('PAGE ERRORS:', errs.length ? errs : 'none');
assert.ok(/^https:\/\//.test(base), 'RELAY_BASE should be set to an https URL');
assert.strictEqual(R.wsUrl, base.replace(/\/+$/, '').replace(/^http/, 'ws') + '/ais');
assert.ok(R.firstSend && Array.isArray(R.firstSend.boxes) && !('APIKey' in R.firstSend), 'relay subscribe sends boxes only, never a key');
assert.strictEqual(R.gear, 0, 'no AIS key gear in relay mode');
assert.match(R.ships, /n=2$/);
assert.ok(Array.isArray(R.lastSend.boxes) && R.lastSend.boxes.length > 0, 'selected situation adds boxes');
assert.strictEqual(R.capped.heard, 4503);
assert.strictEqual(R.capped.drawn, 4000);
assert.ok(R.capped.warshipKept, 'military vessel survives the draw cap');
assert.match(R.vesselLabel, /4000 shown of 4503 heard/);
assert.ok(R.hormuzFirst, 'after zooming to Hormuz, on-screen ships are drawn first');
assert.strictEqual(R.laneBoxesInDirectList, 12 + 21);
await b.close();
