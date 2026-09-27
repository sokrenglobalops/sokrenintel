import { chromium } from 'playwright';
import fs from 'fs';
// Direct (per-browser key) mode: blank RELAY_BASE so tests stay offline and deterministic.
const HTML = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/const RELAY_BASE = "[^"]*";/, 'const RELAY_BASE = "";');
const opensky = { time: 1, states: [
  ["ae1234","RCH123 ","United States",1,1,30.5,50.1,9448,false,226,95,0,null,9500,"4521",false,0],   // US mil range
  ["3e8001","GAF001 ","Germany",1,1,9.7,52.4,0,true,0,10,0,null,0,"1200",false,0],                // German mil range, on ground
  ["4ca123","RYR12  ","Ireland",1,1,31.0,49.2,10972,false,231,270,0,null,11000,"1000",false,0],  // civil
  ["a1b2c3","UAL1   ","United States",1,1,-100,40,10000,false,230,90,0,null,10000,"7700",false,0], // civil emergency
]};
const cablesFile = { type: "FeatureCollection", features: [ { type: "Feature", properties: { id: "c1", name: "Local File Cable" }, geometry: { type: "LineString", coordinates: [[-74, 40], [-5, 50]] } } ] };
async function run(mode) {
  const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.route('**/*', r => { const u = r.request().url();
    const json = o => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (u === 'http://localhost/' ) return r.fulfill({ status: 200, contentType: 'text/html', body: HTML });
    if (u.endsWith('/cables.json')) return mode.localCables ? json(cablesFile) : r.fulfill({ status: 404, body: 'nf' });
    if (u.includes('airplanes.live') || u.includes('adsb.lol')) return mode.adsbUp ? json({ ac: [ { hex: "ae1234", flight: "RCH123", t: "C17", dbFlags: 1, alt_baro: 31000, gs: 440, track: 95, squawk: "4521", lat: 50.1, lon: 30.5 } ] }) : r.abort();
    if (u.includes('opensky-network.org')) return mode.openskyUp ? json(opensky) : r.fulfill({ status: 429, body: 'limit' });
    return r.abort(); });
  await page.goto('http://localhost/'); await page.waitForTimeout(1500);
  const R = { mode: JSON.stringify(mode) };
  R.chips = await page.$$eval('#layer-chips .lchip', els => els.map(e => e.textContent.trim()));
  R.flights = await page.evaluate(() => state.layerStatus.flights + ' n=' + state.layerData.flights.length + ' src=' + state.airSource + ' hex=' + state.layerData.flights.map(a => a.hex).join(','));
  await page.evaluate(() => setSelected('ru-ua')); await page.waitForTimeout(1200);
  R.area = await page.evaluate(() => state.layerStatus.area + ' n=' + state.layerData.area.length + ' civil=' + state.layerData.area.filter(a => !a.mil).length);
  R.chipSel = await page.$$eval('#layer-chips .lchip', els => els.map(e => e.textContent.trim()).find(t => t.startsWith('Air')));
  R.signals = await page.$eval('#d-signals', el => el.innerText.replace(/\s+/g, ' ').trim().slice(0, 120));
  await page.evaluate(() => setSelected(null));
  await page.evaluate(() => toggleLayer('cables')); await page.waitForTimeout(800);
  R.cables = await page.evaluate(() => state.layerStatus.cables + ' n=' + state.layerData.cables.length + ' name=' + (state.layerData.cables[0] || {}).name);
  await page.evaluate(() => toggleLayer('aircraft')); await page.waitForTimeout(200);
  R.afterOff = await page.$$eval('#ov-pts [data-ac],[data-ar]', els => els.length);
  R.errors = errs.length ? errs : 'none';
  console.log(JSON.stringify(R, null, 1));
  await b.close();
}
await run({ adsbUp: true, openskyUp: true, localCables: true });
await run({ adsbUp: false, openskyUp: true, localCables: false });
await run({ adsbUp: false, openskyUp: false, localCables: false });
