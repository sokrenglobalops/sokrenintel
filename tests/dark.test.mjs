import { chromium } from 'playwright';
import fs from 'fs';
// Direct (per-browser key) mode: blank RELAY_BASE so tests stay offline and deterministic.
const HTML = fs.readFileSync(new URL('../classic.html', import.meta.url), 'utf8').replace(/const RELAY_BASE = "[^"]*";/, 'const RELAY_BASE = "";');
const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.route('**/*', r => { const u = r.request().url();
  if (u.startsWith('http://localhost')) return r.fulfill({ status: 200, contentType: 'text/html', body: HTML });
  return r.abort(); });
await page.goto('http://localhost/'); await page.waitForTimeout(1000);
const R = {};
await page.evaluate(() => {
  window.__sent = [];
  window.WebSocket = class { constructor(u) { this.url = u; this.readyState = 0; setTimeout(() => { this.readyState = 1; this.onopen && this.onopen(); }, 20); } send(m) { window.__sent.push(m); } close() { this.readyState = 3; } };
  localStorage.setItem('sokren_ais_key', 'TESTAISKEY');
  toggleLayer('ships');
});
await page.waitForTimeout(300);
R.subscribeTypes = await page.evaluate(() => JSON.parse(window.__sent[0]).FilterMessageTypes.join(','));
R.connectedAt = await page.evaluate(() => (state.ais.connectedAt > 0) + ' boxes=' + state.ais.boxes.length);
// feed messages near Hormuz: military (type 35), tanker (80), class B small craft, coast guard (55)
await page.evaluate(() => {
  const ws = state.ais.ws;
  const pos = (mmsi, name, lat, lon, cog, sog) => ws.onmessage({ data: JSON.stringify({ MessageType: "PositionReport", MetaData: { MMSI: mmsi, ShipName: name, latitude: lat, longitude: lon }, Message: { PositionReport: { Latitude: lat, Longitude: lon, Cog: cog, Sog: sog, TrueHeading: cog, NavigationalStatus: 0 } } }) });
  const stat = (mmsi, type) => ws.onmessage({ data: JSON.stringify({ MessageType: "ShipStaticData", MetaData: { MMSI: mmsi }, Message: { ShipStaticData: { Type: type } } }) });
  pos(366000001, "USS WARSHIP", 26.5, 56.3, 120, 14); stat(366000001, 35);
  pos(477000002, "FRONT ALTAIR", 26.7, 56.6, 300, 9.1); stat(477000002, 80);
  pos(422000004, "IRGC PATROL", 26.6, 56.1, 200, 20); stat(422000004, 55);
  ws.onmessage({ data: JSON.stringify({ MessageType: "StandardClassBPositionReport", MetaData: { MMSI: 470000005, ShipName: "DHOW 5", latitude: 26.4, longitude: 56.5 }, Message: { StandardClassBPositionReport: { Latitude: 26.4, Longitude: 56.5, Cog: 45, Sog: 6, TrueHeading: 45 } } }) });
  ws.onmessage({ data: JSON.stringify({ MessageType: "StaticDataReport", MetaData: { MMSI: 470000005 }, Message: { StaticDataReport: { PartNumber: true, ReportA: { Valid: false, Name: "" }, ReportB: { Valid: true, ShipType: 30 } } } }) });
  pos(477000006, "CARGO Z", 26.9, 56.9, 90, 11); stat(477000006, 70);
  refreshShips();
});
await page.waitForTimeout(300);
R.classes = await page.evaluate(() => Object.values(state.ships).map(v => v.name + ':' + shipClass(v) + (v.classB ? '(B)' : '')).join(' | '));
R.chipTag = await page.$$eval('#layer-chips .lchip', els => els.map(e => e.textContent.trim()).filter(t => t.startsWith('Ships')));
R.filterRow = await page.$$eval('#ship-filter [data-sf]', els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
R.markersAll = await page.$$eval('#ov-pts [data-sh]', els => els.length);
// military filter
await page.click('#mb-layers'); await page.waitForTimeout(100);
await page.click('#ship-filter [data-sf="military"]'); await page.waitForTimeout(200);
R.markersMil = await page.$$eval('#ov-pts [data-sh]', els => els.map(e => e.getAttribute('data-sh')));
await page.click('#ship-filter [data-sf="small"]'); await page.waitForTimeout(200);
R.markersSmall = await page.$$eval('#ov-pts [data-sh]', els => els.map(e => e.getAttribute('data-sh')));
await page.click('#ship-filter [data-sf="all"]'); await page.waitForTimeout(200);
// simulate a 13-minute gap for the warship while the feed stays healthy
await page.evaluate(() => {
  const now = Date.now();
  state.ais.connectedAt = now - 30 * 60000;
  const v = state.ships['366000001']; v.t = now - 13 * 60000;
  state.ais.lastMsg = now; state.ais.ws.readyState = 1;
  refreshShips();
});
await page.waitForTimeout(300);
R.darkAfterGap = await page.evaluate(() => Object.values(state.ships).filter(v => v.dark).map(v => v.name + ' class=' + shipClass(v)));
R.chipTagDark = await page.$$eval('#layer-chips .lchip', els => els.map(e => e.textContent.trim()).filter(t => t.startsWith('Ships')));
R.darkMarkers = await page.$$eval('#ov-pts .sh-dark', els => els.length);
await page.click('#ship-filter [data-sf="dark"]'); await page.waitForTimeout(200);
R.markersDarkOnly = await page.$$eval('#ov-pts [data-sh]', els => els.map(e => e.getAttribute('data-sh')));
await page.click('#ship-filter [data-sf="all"]'); await page.waitForTimeout(100);
// gap must NOT fire if the feed itself went silent
await page.evaluate(() => { const v = state.ships['477000002']; v.t = Date.now() - 13 * 60000; state.ais.lastMsg = Date.now() - 5 * 60000; refreshShips(); });
R.noFalseDarkWhenFeedStale = await page.evaluate(() => !state.ships['477000002'].dark);
await page.evaluate(() => { state.ais.lastMsg = Date.now(); refreshShips(); });
R.darkWhenFeedBack = await page.evaluate(() => state.ships['477000002'].dark === true);
// new position clears dark
await page.evaluate(() => { state.ais.ws.onmessage({ data: JSON.stringify({ MessageType: "PositionReport", MetaData: { MMSI: 477000002, ShipName: "FRONT ALTAIR" }, Message: { PositionReport: { Latitude: 26.71, Longitude: 56.61, Cog: 300, Sog: 9 } } }) }); refreshShips(); });
R.darkCleared = await page.evaluate(() => !state.ships['477000002'].dark);
// signals rows
await page.evaluate(() => setSelected('iran')); await page.waitForTimeout(400);
R.signals = await page.$eval('#d-signals', el => el.innerText.replace(/\s+/g, ' ').trim());
await page.evaluate(() => setSelected(null)); await page.waitForTimeout(200);
// tooltip on dark marker + screenshot
await page.evaluate(() => { const el = document.getElementById('map-wrap'); const w = el.clientWidth, h = el.clientHeight; zoomAt(6, (56.4+180)/360*w, (90-26.6)/180*h); });
await page.waitForTimeout(300);
const dm = await page.$('#ov-pts .sh-dark'); if (dm) { const bb = await dm.boundingBox(); await page.mouse.move(bb.x + bb.width/2, bb.y + bb.height/2); await page.waitForTimeout(150); R.tooltip = await page.evaluate(() => { const t = document.getElementById('tooltip'); return t ? t.innerText.replace(/\s+/g, ' ').trim() : 'no tip el'; }); }
await page.click('#mb-layers'); await page.waitForTimeout(150);
await page.screenshot({ path: new URL('./out/d-hormuz.png', import.meta.url).pathname, clip: { x: 0, y: 60, width: 1400, height: 700 } });
await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(300);
R.mobileScroll = await page.evaluate(() => document.documentElement.scrollWidth + ' vs ' + window.innerWidth);
await page.screenshot({ path: new URL('./out/d-mobile.png', import.meta.url).pathname });
console.log(JSON.stringify(R, null, 2)); console.log('PAGE ERRORS:', errs.length ? errs : 'none');
await b.close();
