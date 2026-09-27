import { chromium } from 'playwright';
import fs from 'fs';
// Direct (per-browser key) mode: blank RELAY_BASE so tests stay offline and deterministic.
const HTML = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/const RELAY_BASE = "[^"]*";/, 'const RELAY_BASE = "";');
const cables = { type: "FeatureCollection", features: [
  { type: "Feature", properties: { id: "c1", name: "EXA Meridian" }, geometry: { type: "MultiLineString", coordinates: [[[-74.06, 40.15], [-71.06, 39.96], [-30, 45], [-5, 50.3]]] } },
  { type: "Feature", properties: { id: "c2", name: "Southern Cross NEXT" }, geometry: { type: "MultiLineString", coordinates: [[[151.2, -33.9], [175, -30], [179.9, -20], [-179.9, -19], [-160, -10], [-118.5, 33.9]]] } },
  { type: "Feature", properties: { id: "c3", name: "C-Lion1" }, geometry: { type: "LineString", coordinates: [[24.9, 60.2], [12.1, 54.1]] } },
]};
const mil = { ac: [ { hex: "ae1234", flight: "RCH123", r: "07-7180", t: "C17", dbFlags: 1, alt_baro: 31000, gs: 440, track: 95, squawk: "4521", lat: 50.1, lon: 30.5 } ] };
const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.route('**/*', r => { const u = r.request().url();
  const json = o => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
  if (u.startsWith('http://localhost')) return r.fulfill({ status: 200, contentType: 'text/html', body: HTML });
  if (u.includes('cable-geo.json')) return json(cables);
  if (u.includes('adsb.lol/v2/mil')) return json(mil);
  return r.abort(); });
await page.goto('http://localhost/'); await page.waitForTimeout(1200);
const R = {};
R.layers = await page.$$eval('#layer-chips .lchip', els => els.map(e => e.textContent.trim()));
// cables
await page.evaluate(() => toggleLayer('cables')); await page.waitForTimeout(800);
R.cables = await page.evaluate(() => state.layerStatus.cables + ' systems=' + state.layerData.cables.length + ' segsSouthernCross=' + state.layerData.cables[1].segs.length);
R.cablePath = await page.$eval('#ov', el => { const p = el.querySelector('path[stroke="#D9534F"]'); return p ? 'red path, d length=' + p.getAttribute('d').length : 'no red path'; });
R.chipsAfterCables = await page.$$eval('#layer-chips .lchip', els => els.map(e => e.textContent.trim()).filter(t => t.startsWith('Cables')));
// ships: no key
await page.evaluate(() => toggleLayer('ships')); await page.waitForTimeout(200);
R.shipsNoKey = await page.evaluate(() => state.layerStatus.ships);
R.shipChip = await page.$$eval('#layer-chips .lchip', els => els.map(e => e.textContent.trim()).filter(t => t.startsWith('Ships')));
// fake WebSocket + key
await page.evaluate(() => {
  window.__sent = [];
  window.WebSocket = class { constructor(u) { this.url = u; this.readyState = 0; setTimeout(() => { this.readyState = 1; this.onopen && this.onopen(); }, 20); } send(m) { window.__sent.push(m); } close() { this.readyState = 3; } };
  openAkey();
});
R.modalOpen = await page.$eval('#akey', el => el.classList.contains('open'));
await page.fill('#ak-input', 'TESTAISKEY'); await page.click('#ak-save'); await page.waitForTimeout(200);
R.subscribe = await page.evaluate(() => { const m = JSON.parse(window.__sent[0]); return 'key=' + m.APIKey + ' boxes=' + m.BoundingBoxes.length + ' types=' + m.FilterMessageTypes.join(',') + ' box0=' + JSON.stringify(m.BoundingBoxes[0]); });
// feed fake AIS messages near Hormuz
await page.evaluate(() => {
  const ws = state.ais.ws;
  const pos = (mmsi, name, lat, lon, cog, sog) => ws.onmessage({ data: JSON.stringify({ MessageType: "PositionReport", MetaData: { MMSI: mmsi, ShipName: name, latitude: lat, longitude: lon }, Message: { PositionReport: { Latitude: lat, Longitude: lon, Cog: cog, Sog: sog, TrueHeading: cog, NavigationalStatus: 0 } } }) });
  pos(477000001, "EVER GIVEN", 26.5, 56.3, 120, 12.4);
  pos(477000002, "FRONT ALTAIR", 26.7, 56.6, 300, 9.1);
  pos(477000001, "EVER GIVEN", 26.55, 56.4, 120, 12.4); // moved
  ws.onmessage({ data: JSON.stringify({ MessageType: "ShipStaticData", MetaData: { MMSI: 477000002, ShipName: "FRONT ALTAIR" }, Message: { ShipStaticData: { Type: 80 } } }) });
  refreshShips();
});
await page.waitForTimeout(200);
R.shipsLive = await page.evaluate(() => state.layerStatus.ships + ' n=' + state.layerData.ships.length + ' trail=' + (state.shipTrails['477000001'] || []).length + ' type2=' + state.ships['477000002'].type);
R.shipMarkers = await page.$$eval('#ov-pts [data-sh]', els => els.length);
await page.evaluate(() => setSelected('iran')); await page.waitForTimeout(300);
R.resubscribeBoxes = await page.evaluate(() => JSON.parse(window.__sent[window.__sent.length - 1]).BoundingBoxes.length);
// feed again after resubscribe (new socket)
await page.evaluate(() => { const ws = state.ais.ws; ws.onmessage({ data: JSON.stringify({ MessageType: "PositionReport", MetaData: { MMSI: 477000003, ShipName: "TANKER X" }, Message: { PositionReport: { Latitude: 26.8, Longitude: 56.2, Cog: 90, Sog: 3 } } }) }); refreshShips(); });
await page.waitForTimeout(200);
R.signals = await page.$eval('#d-signals', el => el.innerText.replace(/\s+/g, ' ').trim());
const sh = await page.$('#ov-pts [data-sh]'); const box = await sh.boundingBox();
R.markerLeft = await page.evaluate(() => { const r = document.getElementById('detail').getBoundingClientRect(); return r.left; });
await page.evaluate(() => setSelected(null)); await page.waitForTimeout(200);
await page.evaluate(() => { const el = document.getElementById('map-wrap'); const w = el.clientWidth, h = el.clientHeight; zoomAt(5, (56.4+180)/360*w, (90-26.6)/180*h); });
await page.waitForTimeout(300);
await page.mouse.move(box.x + 3, box.y + 3);
await page.screenshot({ path: new URL('./out/s-hormuz.png', import.meta.url).pathname, clip: { x: 0, y: 130, width: 1400, height: 620 } });
await page.evaluate(() => { state.view = { k: 1, x: 0, y: 0 }; applyView(); });
await page.waitForTimeout(200);
await page.screenshot({ path: new URL('./out/s-world.png', import.meta.url).pathname, clip: { x: 0, y: 130, width: 1400, height: 620 } });
R.noOldRefs = await page.evaluate(() => typeof loadQuakes === 'undefined' && typeof loadFires === 'undefined' && !document.getElementById('ov-fire') && !document.getElementById('fkey'));
console.log(JSON.stringify(R, null, 2)); console.log('PAGE ERRORS:', errs.length ? errs : 'none');
await b.close();
