import { chromium } from 'playwright';
import fs from 'fs';
// Direct (per-browser key) mode: blank RELAY_BASE so tests stay offline and deterministic.
const HTML = fs.readFileSync(new URL('../classic.html', import.meta.url), 'utf8').replace(/const RELAY_BASE = "[^"]*";/, 'const RELAY_BASE = "";');
const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.route('**/*', r => r.request().url().startsWith('http://localhost') ? r.fulfill({ status: 200, contentType: 'text/html', body: HTML }) : r.abort());
await page.goto('http://localhost/'); await page.waitForTimeout(800);
await page.evaluate(() => {
  window.WebSocket = class { constructor() { this.readyState = 0; setTimeout(() => { this.readyState = 1; this.onopen && this.onopen(); }, 20); } send() {} close() { this.readyState = 3; } };
  localStorage.setItem('sokren_ais_key', 'K'); toggleLayer('ships');
});
await page.waitForTimeout(200);
await page.evaluate(() => {
  const ws = state.ais.ws;
  const pos = (mmsi, name, lat, lon, cog, sog, nav) => ws.onmessage({ data: JSON.stringify({ MessageType: "PositionReport", MetaData: { MMSI: mmsi, ShipName: name }, Message: { PositionReport: { Latitude: lat, Longitude: lon, Cog: cog, Sog: sog, NavigationalStatus: nav } } }) });
  pos(477123456, "COSCO SHIPPING ARIES", 25.6, 57.2, 118, 13.2, 0);
  ws.onmessage({ data: JSON.stringify({ MessageType: "ShipStaticData", MetaData: { MMSI: 477123456 }, Message: { ShipStaticData: { Type: 70, Name: "COSCO SHIPPING ARIES", CallSign: "VRPK7", ImoNumber: 9783497, Destination: "AE JEA", Dimension: { A: 200, B: 200, C: 30, D: 28.6 }, MaximumStaticDraught: 14.5, Eta: { Month: 9, Day: 24, Hour: 6, Minute: 0 } } } }) });
  pos(366999001, "USS X", 25.2, 57.9, 200, 18, 0);
  ws.onmessage({ data: JSON.stringify({ MessageType: "ShipStaticData", MetaData: { MMSI: 366999001 }, Message: { ShipStaticData: { Type: 35 } } }) });
  const now = Date.now(); state.ais.connectedAt = now - 40 * 60000; state.ais.lastMsg = now; state.ships['366999001'].t = now - 15 * 60000;
  refreshShips();
});
await page.waitForTimeout(300);
const R = {};
await page.evaluate(() => { const el = document.getElementById('map-wrap'); zoomAt(10, (57.4 + 180) / 360 * el.clientWidth, (90 - 25.5) / 180 * el.clientHeight); });
await page.waitForTimeout(200);
const m = await page.$('#ov-pts [data-sh="0"]'); const bb = await m.boundingBox();
await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); await page.waitForTimeout(200);
R.cardOpen = await page.$eval('#ship-card', el => el.classList.contains('open'));
R.cardText = await page.$eval('#ship-card', el => el.innerText.replace(/\s+/g, ' ').trim());
R.links = await page.$$eval('#ship-card a', els => els.map(a => a.href));
R.selMarker = await page.$$eval('#ov-pts .sel', els => els.length);
// survives a refresh cycle
await page.evaluate(() => refreshShips()); await page.waitForTimeout(100);
R.stillOpenAfterRefresh = await page.$eval('#ship-card', el => el.classList.contains('open'));
await page.screenshot({ path: new URL('./out/card.png', import.meta.url).pathname, clip: { x: 0, y: 60, width: 1400, height: 700 } });
// dark ship card
const d = await page.$('#ov-pts .sh-dark'); const db = await d.boundingBox();
await page.mouse.click(db.x + db.width / 2, db.y + db.height / 2); await page.waitForTimeout(200);
R.darkCard = await page.$eval('#ship-card', el => el.innerText.replace(/\s+/g, ' ').trim().slice(0, 160));
// esc closes; background click closes
await page.keyboard.press('Escape'); await page.waitForTimeout(100);
R.closedByEsc = await page.$eval('#ship-card', el => !el.classList.contains('open'));
await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); await page.waitForTimeout(100);
await page.mouse.click(300, 400); await page.waitForTimeout(100);
R.closedByBg = await page.$eval('#ship-card', el => !el.classList.contains('open'));
R.flags = await page.evaluate(() => ['477123456','366999001','338000000','111232001','980123456','412345678','273456789','422000000'].map(x => x + '=' + mmsiFlag(x)).join(' | '));
// mobile
await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => selectShip('477123456')); await page.waitForTimeout(300);
R.mobile = await page.evaluate(() => { const r = document.getElementById('ship-card').getBoundingClientRect(); return 'w=' + Math.round(r.width) + ' scroll=' + document.documentElement.scrollWidth; });
await page.screenshot({ path: new URL('./out/card-mobile.png', import.meta.url).pathname });
console.log(JSON.stringify(R, null, 2)); console.log('PAGE ERRORS:', errs.length ? errs : 'none');
await b.close();
