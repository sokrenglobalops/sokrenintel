// v2.html (operations console on a MapLibre globe), offline: MapLibre served from node_modules,
// basemap tiles/glyphs aborted, relay AIS via a fake WebSocket. Checks the GPU layers get data,
// selection flies + draws the AOI ring, the board/status/rail render, and phone width holds.
import { chromium } from 'playwright';
import fs from 'fs';
import assert from 'assert';
const root = new URL('../', import.meta.url);
const HTML = fs.readFileSync(new URL('v2.html', root), 'utf8');
const MLJS = fs.readFileSync(new URL('node_modules/maplibre-gl/dist/maplibre-gl.js', root));
const MLCSS = fs.readFileSync(new URL('node_modules/maplibre-gl/dist/maplibre-gl.css', root));
const out = p => new URL('tests/out/' + p, root).pathname;
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const R = {}; const errs = [];
async function open(vp) {
  const page = await b.newPage({ viewport: vp });
  page.on('pageerror', e => errs.push(e.message));
  await page.route('**/*', r => { const u = r.request().url();
    if (u.startsWith('http://localhost')) return r.fulfill({ status: 200, contentType: 'text/html', body: HTML });
    if (u.includes('maplibre-gl') && u.endsWith('.js')) return r.fulfill({ status: 200, contentType: 'application/javascript', body: MLJS });
    if (u.includes('maplibre-gl') && u.endsWith('.css')) return r.fulfill({ status: 200, contentType: 'text/css', body: MLCSS });
    if (u === 'https://tiles.openfreemap.org/planet') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tilejson: '2.2.0', tiles: ['https://tiles.openfreemap.org/planet/{z}/{x}/{y}.pbf'], minzoom: 0, maxzoom: 14 }) });
    if (u.includes('/air/mil')) return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ source: 'opensky', age: 30, ac: [{ hex: 'ae1234', flight: 'RCH123', lat: 50.1, lon: 30.5, alt_baro: 31000, gs: 440, track: 95, dbFlags: 1 }] }) });
    return r.abort(); });
  await page.addInitScript(() => {
    try { localStorage.setItem('sokren_layers', JSON.stringify({ chokepoints: true, cables: false, aircraft: true, ships: true })); } catch (e) {}
    window.__sent = [];
    window.WebSocket = class { constructor(u) { this.url = u; this.readyState = 0; setTimeout(() => { this.readyState = 1; this.onopen && this.onopen(); }, 20); } send(m) { window.__sent.push(m); } close() { this.readyState = 3; } };
  });
  await page.goto('http://localhost/'); await page.waitForFunction(() => window.mapReady === true || (typeof mapReady !== 'undefined' && mapReady), null, { timeout: 20000 });
  await page.waitForTimeout(1200);
  return page;
}
const count = (page, id) => page.evaluate(id => MAP.getSource(id).serialize().data.features.length, id);

// desktop
let page = await open({ width: 1440, height: 900 });
R.ready = await page.evaluate(() => mapReady && MAP.getProjection().type);
R.situations = await count(page, 'situations');
await page.evaluate(() => {
  const m = (mmsi, lat, lon, type) => ({ MessageType: "PositionReport", MetaData: { MMSI: mmsi, ShipName: "V" + mmsi, latitude: lat, longitude: lon }, Message: { PositionReport: { Latitude: lat, Longitude: lon, Cog: 45, Sog: 12 } } });
  const batch = []; for (let i = 0; i < 12000; i++) batch.push(m(235000000 + i, 49 + (i % 100) / 40, -5 + Math.floor(i / 100) / 12));
  batch.push(m(422000009, 26.6, 56.4));
  state.ais.ws.onmessage({ data: JSON.stringify(batch) });
  state.ais.ws.onmessage({ data: JSON.stringify({ MessageType: "ShipStaticData", MetaData: { MMSI: 422000009 }, Message: { ShipStaticData: { Type: 35 } } }) });
  refreshShips();
});
await page.waitForTimeout(500);
R.ships = await count(page, 'ships');
R.milShip = await page.evaluate(() => MAP.getSource('ships').serialize().data.features.some(f => f.properties.c === 'military'));
R.aircraft = await count(page, 'aircraft');
R.status = await page.$eval('#ops-status', el => el.innerText.replace(/\s+/g, ' '));
R.board = await page.$$eval('#ip-active .ip-item', els => els.length);
R.railLayers = await page.$$eval('#rail .lchip', els => els.length);
await page.screenshot({ path: out('v2-world.png') });
await page.evaluate(() => setSelected('iran')); await page.waitForTimeout(1800);
R.selected = await page.evaluate(() => ({ aoi: MAP.getSource('aoi').serialize().data.features.length, drawer: document.getElementById('detail').classList.contains('open'), sel: MAP.getSource('situations').serialize().data.features.find(f => f.properties.id === 'iran').properties.s, center: MAP.getCenter().toArray().map(v => +v.toFixed(0)) }));
await page.screenshot({ path: out('v2-selected.png') });
await page.evaluate(() => setSelected(null));
R.filter = await page.evaluate(() => { state.shipFilter = 'military'; repickShips(); renderOverlay(); const n = MAP.getSource('ships').serialize().data.features.length; state.shipFilter = 'all'; repickShips(); renderOverlay(); return n; });
R.views = await page.evaluate(() => { const r = {}; for (const v of ['feed', 'situations', 'about', 'home']) { switchView(v); r[v] = document.getElementById('view-' + v).classList.contains('active'); } r.onHome = document.body.classList.contains('on-home'); return r; });
await page.close();

// phone
page = await open({ width: 390, height: 844 });
R.phone = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, railHidden: getComputedStyle(document.getElementById('rail')).transform !== 'none', toggle: getComputedStyle(document.getElementById('rail-toggle')).display, board: document.getElementById('board').getBoundingClientRect().height }));
await page.click('#rail-toggle'); await page.waitForTimeout(400);
R.phoneRailOpen = await page.evaluate(() => document.getElementById('rail').classList.contains('open'));
await page.click('#rail-close'); await page.click('#board-head'); await page.waitForTimeout(400);
R.phoneBoardOpen = await page.evaluate(() => document.getElementById('board').getBoundingClientRect().height);
await page.screenshot({ path: out('v2-phone.png') });
await page.close();

console.log(JSON.stringify(R, null, 2)); console.log('PAGE ERRORS:', errs.length ? errs : 'none');
assert.strictEqual(R.ready, 'globe');
assert.strictEqual(R.situations, 33);
assert.strictEqual(R.ships, 12001, 'GPU layer draws every vessel');
assert.ok(R.milShip);
assert.strictEqual(R.aircraft, 1);
assert.match(R.status, /33 situations/i);
assert.match(R.status, /AIS 12,001 vessels/i);
assert.ok(R.board >= 10 && R.railLayers === 4);
assert.ok(R.selected.aoi === 1 && R.selected.drawer && R.selected.sel === 1, 'selection opens drawer and draws the AOI ring');
assert.strictEqual(R.filter, 1, 'vessel type filter');
assert.ok(R.views.feed && R.views.situations && R.views.about && R.views.home && R.views.onHome);
assert.strictEqual(R.phone.sw, 390, 'no horizontal scroll at 390 px');
assert.ok(R.phone.railHidden && R.phone.toggle !== 'none' && R.phone.board < 70);
assert.ok(R.phoneRailOpen && R.phoneBoardOpen > 200);
await b.close();
