// index.html (operations console on a MapLibre globe), offline: MapLibre served from node_modules,
// basemap tiles/glyphs aborted, relay AIS via a fake WebSocket. Checks the GPU layers get data,
// selection flies + draws the AOI ring, the board/status/rail render, and phone width holds.
import { chromium } from 'playwright';
import fs from 'fs';
import assert from 'assert';
const root = new URL('../', import.meta.url);
const HTML = fs.readFileSync(new URL('index.html', root), 'utf8');
const MLJS = fs.readFileSync(new URL('node_modules/maplibre-gl/dist/maplibre-gl.js', root));
const MLCSS = fs.readFileSync(new URL('node_modules/maplibre-gl/dist/maplibre-gl.css', root));
const out = p => new URL('tests/out/' + p, root).pathname;
// pipeline fixtures: one situation revised this week, one reviewed with no change, fresh news
const now = new Date().toISOString();
const INTEL = { version: 1, events: {
  'ru-ua': { checkedAt: now, checkedArticles: 31, updatedAt: now, basis: { articles: 31, outlets: 12 }, lastReview: { at: now, material: true, reason: 'Russia opened a new northern offensive.' },
    fields: { priority: 1, sti: 95, parts: { Kinetic: 97, Military: 94, Cyber: 80, Political: 70, Humanitarian: 88 }, brief: 'TEST BRIEF revised.', assess: [['Conflict Activity', 'New northern offensive']], outlook: { p: 78, line: 'further ground advances', window: 'next 14 days' },
      analysis: { ach: [['Limited offensive under way', 70], ['Attrition only', 20], ['Freeze', 10]], disc: 'd', pins: [['a', 'f']], swot: { s: ['s'], w: ['w'], o: ['o'], t: ['t'] } } } },
  'iran': { checkedAt: now, checkedArticles: 9, lastReview: { at: now, material: false, reason: 'Nothing new.' } } } };
const CHANGES = { entries: [{ id: 'ru-ua', name: 'Russia–Ukraine War', at: now, week: '2026-W40', reason: 'Russia opened a new northern offensive.', sti: { from: 92, to: 95 }, priority: { from: 1, to: 1 },
  changes: [{ field: 'ach', from: 'H2 25%', to: 'H1 Limited offensive under way 70%', why: 'Ground assault confirmed by multiple outlets.', sources: [{ title: 'x', url: 'https://example.org/a', domain: 'example.org' }] }] }] };
const NEWS = { generatedAt: now, items: { 'ru-ua': [{ title: 'Fresh collector headline', url: 'https://example.org/fresh', domain: 'example.org', date: now, src: 'BBC World' }] } };
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const R = {}; const errs = [];
async function open(vp) {
  const page = await b.newPage({ viewport: vp });
  page.on('pageerror', e => errs.push(e.message));
  await page.route('**/*', r => { const u = r.request().url();
    if (u.includes('maplibre-gl') && u.endsWith('.js')) return r.fulfill({ status: 200, contentType: 'application/javascript', body: MLJS });
    if (u.includes('maplibre-gl') && u.endsWith('.css')) return r.fulfill({ status: 200, contentType: 'text/css', body: MLCSS });
    if (u === 'https://tiles.openfreemap.org/planet') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tilejson: '2.2.0', tiles: ['https://tiles.openfreemap.org/planet/{z}/{x}/{y}.pbf'], minzoom: 0, maxzoom: 14 }) });
    if (u.includes('/data/intel.json')) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(INTEL) });
    if (u.includes('/data/changes.json')) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CHANGES) });
    if (u.includes('/data/news.json')) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(NEWS) });
    if (u.startsWith('http://localhost')) return r.fulfill({ status: 200, contentType: 'text/html', body: HTML });
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
// pipeline data applied: revised assessment, review line, change box, Changes tab, board pill, map ring
R.intel = await page.evaluate(() => ({ sti: byId['ru-ua'].sti, ach0: ANALYSIS['ru-ua'].ach[0][1], feedTop: state.feeds['ru-ua'].items[0].title, chg: document.getElementById('chg-n').textContent, pill: !!document.querySelector('#ip-active [data-ip="ru-ua"] .upd-pill'), ring: MAP.getSource('situations').serialize().data.features.find(f => f.properties.id === 'ru-ua').properties.u }));
await page.evaluate(() => setSelected('ru-ua')); await page.waitForTimeout(600);
R.drawerRu = await page.evaluate(() => ({ review: document.getElementById('d-review').innerText, change: document.getElementById('d-changes').innerText.slice(0, 120), brief: document.getElementById('d-brief').textContent }));
await page.screenshot({ path: out('v2-changed.png') });
await page.evaluate(() => setSelected('iran')); await page.waitForTimeout(1800);
R.drawerIran = await page.evaluate(() => document.getElementById('d-review').innerText);
R.selected = await page.evaluate(() => ({ aoi: MAP.getSource('aoi').serialize().data.features.length, drawer: document.getElementById('detail').classList.contains('open'), sel: MAP.getSource('situations').serialize().data.features.find(f => f.properties.id === 'iran').properties.s, center: MAP.getCenter().toArray().map(v => +v.toFixed(0)) }));
await page.screenshot({ path: out('v2-selected.png') });
await page.evaluate(() => setSelected(null));
R.filter = await page.evaluate(() => { state.shipFilter = 'military'; repickShips(); renderOverlay(); const n = MAP.getSource('ships').serialize().data.features.length; state.shipFilter = 'all'; repickShips(); renderOverlay(); return n; });
// collapsible panels, spin toggle, time zones
await page.click('#rail-close'); await page.click('#board-col'); await page.waitForTimeout(500);
R.collapsed = await page.evaluate(() => ({ cls: document.getElementById('ops').className, pad: MAP.getPadding(), tabs: [getComputedStyle(document.getElementById('rail-toggle')).display, getComputedStyle(document.getElementById('board-tab')).display], saved: localStorage.getItem('sokren_board') }));
await page.screenshot({ path: out('v2-collapsed.png') });
await page.click('#rail-toggle'); await page.click('#board-tab'); await page.waitForTimeout(400);
R.reopened = await page.evaluate(() => document.getElementById('ops').className);
await page.click('#z-spin');
R.spin = await page.evaluate(() => ({ mode: spinMode, btn: document.getElementById('z-spin').classList.contains('on') }));
const lng0 = await page.evaluate(() => MAP.getCenter().lng); await page.waitForTimeout(800);
R.spinning = await page.evaluate(l => MAP.getCenter().lng !== l, lng0);
await page.click('#tz-btn'); await page.click('.tz-opt[data-tz="Asia/Tehran"]');
R.tzTehran = await page.evaluate(() => document.getElementById('utc-date').textContent);
await page.click('#tz-btn'); await page.click('.tz-opt[data-tz="auto"]');
await page.evaluate(() => setSelected('taiwan')); await page.waitForTimeout(300);
R.tzAuto = await page.evaluate(() => document.getElementById('utc-date').textContent);
await page.evaluate(() => setSelected(null));
R.spinAfterSelect = await page.evaluate(() => spinMode);
await page.click('#tz-btn'); await page.click('.tz-opt[data-tz="Z"]');
R.tzZ = await page.evaluate(() => document.getElementById('utc').textContent);
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
assert.strictEqual(R.situations, 45);
assert.strictEqual(R.ships, 12001, 'GPU layer draws every vessel');
assert.ok(R.milShip);
assert.strictEqual(R.aircraft, 1);
assert.match(R.status, /45 situations/i);
assert.match(R.status, /AIS 12,001 vessels/i);
assert.ok(R.board >= 10 && R.railLayers === 4);
assert.strictEqual(R.intel.sti, 95);
assert.strictEqual(R.intel.ach0, 70);
assert.strictEqual(R.intel.feedTop, 'Fresh collector headline');
assert.strictEqual(R.intel.chg, '1');
assert.ok(R.intel.pill && R.intel.ring === 1);
assert.match(R.drawerRu.review, /Auto-updated .* from 31 reports across 12 outlets · machine-drafted/);
assert.match(R.drawerRu.change, /WHAT CHANGED/i);
assert.strictEqual(R.drawerRu.brief, 'TEST BRIEF revised.');
assert.match(R.drawerIran, /Reviewed .* against 9 new reports · no material change/);
assert.ok(R.selected.aoi === 1 && R.selected.drawer && R.selected.sel === 1, 'selection opens drawer and draws the AOI ring');
assert.strictEqual(R.filter, 1, 'vessel type filter');
assert.ok(R.views.feed && R.views.situations && R.views.about && R.views.home && R.views.onHome);
assert.strictEqual(R.phone.sw, 390, 'no horizontal scroll at 390 px');
assert.ok(R.phone.railHidden && R.phone.toggle !== 'none' && R.phone.board < 70);
assert.ok(R.phoneRailOpen && R.phoneBoardOpen > 200);
assert.ok(/rail-off/.test(R.collapsed.cls) && /board-off/.test(R.collapsed.cls) && R.collapsed.pad.left === 0 && R.collapsed.pad.right === 0);
assert.deepStrictEqual(R.collapsed.tabs, ['flex', 'flex']);
assert.strictEqual(R.collapsed.saved, 'off');
assert.ok(!/off/.test(R.reopened));
assert.ok(R.spin.mode === 'on' && R.spin.btn && R.spinning, 'spin toggle keeps the globe turning');
assert.strictEqual(R.spinAfterSelect, 'on', 'selecting a situation does not cancel pinned spin');
assert.match(R.tzTehran, /TEHRAN · UTC\+3:30/);
assert.match(R.tzAuto, /TAIWAN STRAIT · UTC\+8/);
assert.match(R.tzZ, /Z$/);
await b.close();
