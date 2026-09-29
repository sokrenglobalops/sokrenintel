// Relay mode: index.html exactly as deployed (RELAY_BASE set). Fake WebSocket, no network.
import { chromium } from 'playwright';
import fs from 'fs';
import assert from 'assert';
const HTML = fs.readFileSync(new URL('../classic.html', import.meta.url), 'utf8');
const base = (HTML.match(/const RELAY_BASE = "([^"]*)";/) || [])[1];
const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.route('**/*', r => { const u = r.request().url();
  if (u.startsWith('http://localhost')) return r.fulfill({ status: 200, contentType: 'text/html', body: HTML });
  if (u.includes('/air/mil')) return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ source: 'opensky', age: 42, ac: [{ hex: 'ae1234', flight: 'RCH123', lat: 50.1, lon: 30.5, alt_baro: 31000, gs: 440, track: 95, dbFlags: 1 }] }) });
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
R.capped = await page.evaluate(() => ({ tracked: state.layerData.ships.length, drawn: state.shipsDrawn.length, warshipKept: state.shipsDrawn.some(v => v.type === 35), markers: document.querySelectorAll('#ov-pts [data-sh]').length, trailsAtWorldZoom: document.querySelectorAll('#ov path[stroke="#7FB3D5"]').length }));
R.vesselLabel = await page.$eval('#ship-filter .sf-lab', el => el.textContent);
// zoom into Hormuz: on-screen ships jump the queue (repick after pan/zoom)
await page.evaluate(() => { const el = document.getElementById('map-wrap'); const w = el.clientWidth, h = el.clientHeight; zoomAt(6, (56.4 + 180) / 360 * w, (90 - 26.6) / 180 * h); });
await page.waitForTimeout(700);
R.zoomedHormuz = await page.evaluate(() => ({ drawn: state.shipsDrawn.length, allNearHormuz: state.shipsDrawn.every(v => Math.abs(v.lat - 26.6) < 8 && Math.abs(v.lon - 56.4) < 15), tracked: state.layerData.ships.length }));
R.militaryFilter = await page.evaluate(() => { state.shipFilter = 'military'; repickShips(); const n = state.shipsDrawn.length; state.shipFilter = 'all'; repickShips(); return n; });
R.laneBoxesInDirectList = await page.evaluate(() => aisBoxes().length);
// aircraft from the relay's OpenSky snapshot
await page.evaluate(() => { if (!state.layers.aircraft) toggleLayer('aircraft'); else loadFlights(); }); await page.waitForTimeout(1500);
R.air = await page.evaluate(() => ({ n: state.layerData.flights.length, src: state.airSource, diag: state.airDiag, chip: [...document.querySelectorAll('#layer-chips .lchip')].map(e => e.textContent.trim()).find(t => t.startsWith('Air')) }));
console.log(JSON.stringify(R, null, 2)); console.log('PAGE ERRORS:', errs.length ? errs : 'none');
assert.ok(/^https:\/\//.test(base), 'RELAY_BASE should be set to an https URL');
assert.strictEqual(R.wsUrl, base.replace(/\/+$/, '').replace(/^http/, 'ws') + '/ais');
assert.ok(R.firstSend && Array.isArray(R.firstSend.boxes) && !('APIKey' in R.firstSend), 'relay subscribe sends boxes only, never a key');
assert.strictEqual(R.gear, 0, 'no AIS key gear in relay mode');
assert.match(R.ships, /n=2$/);
assert.ok(Array.isArray(R.lastSend.boxes) && R.lastSend.boxes.length > 0, 'selected situation adds boxes');
assert.strictEqual(R.capped.tracked, 4503, 'every vessel stays tracked');
assert.strictEqual(R.capped.drawn, 1500, 'desktop draw cap');
assert.strictEqual(R.capped.markers, 1500);
assert.strictEqual(R.capped.trailsAtWorldZoom, 0, 'no trails at world zoom');
assert.ok(R.capped.warshipKept, 'military vessel survives the draw cap');
assert.match(R.vesselLabel, /4503 tracked · 1500 on map/);
assert.ok(R.zoomedHormuz.allNearHormuz && R.zoomedHormuz.drawn >= 1 && R.zoomedHormuz.tracked === 4503, 'zoomed in: only on-screen ships drawn, all still tracked');
assert.strictEqual(R.militaryFilter, 1, 'type filter picks from all tracked vessels');
assert.strictEqual(R.laneBoxesInDirectList, 12 + 22);
assert.strictEqual(R.air.n, 1);
assert.strictEqual(R.air.src, 'opensky');
assert.match(R.air.diag, /OpenSky via relay · snapshot 42 s old/);
assert.match(R.air.chip, /OpenSky/);
await b.close();
