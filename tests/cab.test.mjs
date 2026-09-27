import { chromium } from 'playwright';
import fs from 'fs';
// Direct (per-browser key) mode: blank RELAY_BASE so tests stay offline and deterministic.
const HTML = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/const RELAY_BASE = "[^"]*";/, 'const RELAY_BASE = "";');
// 40 fake cable systems with realistic MultiLineString geometry
const feats = [];
for (let i = 0; i < 40; i++) { const lon0 = -170 + i * 8, lat0 = -40 + (i % 7) * 12; feats.push({ type: "Feature", properties: { id: "c" + i, name: "Cable " + i }, geometry: { type: "MultiLineString", coordinates: [[[lon0, lat0], [lon0 + 5, lat0 + 6], [lon0 + 12, lat0 + 3]], [[lon0 + 12, lat0 + 3], [lon0 + 20, lat0 - 4]]] } }); }
const cablesFile = { type: "FeatureCollection", features: feats };
const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.route('**/*', r => { const u = r.request().url();
  if (u === 'http://localhost/') return r.fulfill({ status: 200, contentType: 'text/html', body: HTML });
  if (u.endsWith('/cables.json')) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cablesFile) });
  return r.abort(); });
await page.goto('http://localhost/'); await page.waitForTimeout(1200);
await page.evaluate(() => { if (!state.layers.cables) toggleLayer('cables'); }); await page.waitForTimeout(800);
const info = await page.evaluate(() => {
  const p = document.getElementById('cable-path'); const d = p ? p.getAttribute('d') : '';
  return { status: state.layerStatus.cables, systems: state.layerData.cables.length, subpaths: (d.match(/M/g) || []).length, dlen: d.length, width: p && p.getAttribute('stroke-width'), opacity: p && p.getAttribute('opacity'), chip: [...document.querySelectorAll('#layer-chips .lchip')].map(e => e.textContent.trim()).find(t => t.startsWith('Cables')) };
});
console.log(info);
await page.evaluate(() => window.scrollTo(0, 0));
await page.screenshot({ path: new URL('./out/cab.png', import.meta.url).pathname, clip: { x: 0, y: 130, width: 1400, height: 620 } });
console.log('errors:', errs.length ? errs : 'none');
await b.close();
