import { chromium } from 'playwright';
import fs from 'fs';
// Direct (per-browser key) mode: blank RELAY_BASE so tests stay offline and deterministic.
const HTML = fs.readFileSync(new URL('../classic.html', import.meta.url), 'utf8').replace(/const RELAY_BASE = "[^"]*";/, 'const RELAY_BASE = "";');
const rnd = (a,b)=>a+Math.random()*(b-a);
const mil = { ac: Array.from({length: 40}, (_, i) => ({ hex: 'ae'+i.toString(16).padStart(4,'0'), flight: 'RCH'+(100+i), r: 'REG'+i, t: ['C17','KC135','P8'][i%3], dbFlags: 1, alt_baro: 30000, gs: 400, track: rnd(0,360), squawk: '4521', lat: rnd(-35,65), lon: rnd(-170,170) })) };
const area = { ac: Array.from({length: 12}, (_, i) => ({ hex: '4c'+i.toString(16).padStart(4,'0'), flight: 'CIV'+i, t: 'A320', dbFlags: 0, alt_baro: 35000, gs: 450, track: rnd(0,360), squawk: '1000', lat: 49+rnd(-3,3), lon: 32+rnd(-4,4) })) };
const gdelt = { articles: [
  { title: "Armenia and Azerbaijan resume border talks", url: "https://example.com/a1", domain: "reuters.com", seendate: "20260922T100000Z" },
  { title: "Yerevan protests over peace treaty terms", url: "https://example.com/a2", domain: "aljazeera.com", seendate: "20260922T080000Z" },
  { title: "Armenia and Azerbaijan resume border talks", url: "https://example.com/a3", domain: "bbc.com", seendate: "20260921T080000Z" },
]};
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.route('**/*', r => { const u = r.request().url();
  const json = o => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
  if (u.startsWith('http://localhost')) return r.fulfill({ status: 200, contentType: 'text/html', body: HTML });
  if (u.includes('adsb.lol/v2/mil')) return json(mil);
  if (u.includes('adsb.lol/v2/point')) return json(area);
  if (u.includes('gdeltproject.org') && decodeURIComponent(u).includes('Armenia')) return json(gdelt);
  return r.abort(); });
await page.goto('http://localhost/'); await page.waitForTimeout(1800);
const R = {};
R.homeVisible = await page.evaluate(() => ['view-home','view-feed','view-situations','view-about'].map(v => v + ':' + getComputedStyle(document.getElementById(v)).display).join(' '));
R.homeSections = await page.evaluate(() => ['monitor-bar','map-wrap','intel','wire-bar','feed-sec','detail'].map(id => { const el = document.getElementById(id); const r = el.getBoundingClientRect(); return id + ':' + (r.width > 0 && r.height > 0 && getComputedStyle(el).display !== 'none' ? 'shown' : 'hidden'); }).join(' '));
R.intelCols = await page.$$eval('#intel-grid .ipanel', els => els.map(e => e.querySelector('.ip-title').textContent));
R.drawerOffscreen = await page.evaluate(() => { const r = document.getElementById('detail').getBoundingClientRect(); return r.left >= window.innerWidth; });
await page.screenshot({ path: new URL('./out/v-home.png', import.meta.url).pathname, clip: { x: 0, y: 0, width: 1400, height: 900 } });

// dropdowns
await page.click('#mb-layers'); await page.waitForTimeout(150);
R.layersPop = await page.$eval('#pop-layers', el => el.classList.contains('open') + ' chips=' + el.querySelectorAll('.lchip').length);
R.layersLab = await page.$eval('#mb-layers-lab', el => el.textContent);
await page.screenshot({ path: new URL('./out/v-pop.png', import.meta.url).pathname, clip: { x: 700, y: 60, width: 700, height: 420 } });
await page.click('#mb-filter'); await page.waitForTimeout(150);
R.filterPopSwap = await page.evaluate(() => document.getElementById('pop-filter').classList.contains('open') + ' layersClosed=' + !document.getElementById('pop-layers').classList.contains('open'));
await page.click('#pop-filter [data-mg="cyber"]'); await page.waitForTimeout(150);
R.filterLab = await page.$eval('#mb-filter-lab', el => el.textContent);
R.visibleMarkers = await page.$$eval('#markers .marker', els => els.filter(m => m.style.display !== 'none').length);
await page.mouse.click(300, 700); await page.waitForTimeout(100);
R.popsClosed = await page.evaluate(() => document.querySelectorAll('.pop.open').length === 0);
await page.evaluate(() => { state.mapFilter = 'all'; renderMapChips(); renderMarkerCounts(); });

// drawer open via marker click (simulate) and close via Esc
await page.evaluate(() => setSelected('gaza')); await page.waitForTimeout(600);
R.drawerOpen = await page.evaluate(() => { const r = document.getElementById('detail').getBoundingClientRect(); return document.getElementById('detail').classList.contains('open') + ' left=' + Math.round(r.left) + ' w=' + Math.round(r.width); });
R.drawerTitle = await page.$eval('#d-name', el => el.textContent);
R.mapStillVisible = await page.evaluate(() => { const r = document.getElementById('map-wrap').getBoundingClientRect(); return r.width > 0; });
await page.screenshot({ path: new URL('./out/v-drawer.png', import.meta.url).pathname, clip: { x: 0, y: 0, width: 1400, height: 900 } });
await page.keyboard.press('Escape'); await page.waitForTimeout(400);
R.drawerClosedByEsc = await page.evaluate(() => !document.getElementById('detail').classList.contains('open') && state.selected === null);

// nav → situations
await page.click('#nav [data-tab="situations"]'); await page.waitForTimeout(300);
R.sitCards = await page.$$eval('#view-situations .sit-card', els => els.length);
R.sitCount = await page.$eval('#sit-count', el => el.textContent);
await page.fill('#sit-search', 'yemen'); await page.waitForTimeout(200);
R.sitFilter = await page.$$eval('#view-situations .sit-card', els => els.map(e => e.querySelector('.sc-name').textContent));
await page.fill('#sit-search', ''); await page.waitForTimeout(200);
await page.screenshot({ path: new URL('./out/v-situations.png', import.meta.url).pathname, clip: { x: 0, y: 0, width: 1400, height: 900 } });
await page.click('#view-situations .sit-card'); await page.waitForTimeout(500);
R.drawerFromCard = await page.evaluate(() => document.getElementById('detail').classList.contains('open') + ' ' + state.selected);
await page.evaluate(() => setSelected(null));

// nav → feed (wire + sources present), about (sti key)
await page.click('#nav [data-tab="feed"]'); await page.waitForTimeout(300);
R.feedView = await page.evaluate(() => ['feed-list','sources-sec','net-note'].map(id => id + ':' + (document.getElementById(id).getBoundingClientRect().height > 0)).join(' '));
await page.click('#nav [data-tab="about"]'); await page.waitForTimeout(200);
R.aboutHasKey = await page.evaluate(() => document.getElementById('sti-key').getBoundingClientRect().height > 0 && location.hash === '#about');

// country search: Yemen → focus + select redsea
await page.click('#hdr-search'); await page.waitForTimeout(200);
await page.keyboard.type('yem'); await page.waitForTimeout(200);
R.ckYemen = await page.$$eval('#ck-list .ck-item', els => els.map(e => e.innerText.replace(/\s+/g, ' ').trim()).slice(0, 4));
await page.keyboard.press('Enter'); await page.waitForTimeout(700);
R.afterYemen = await page.evaluate(() => 'tab=' + state.tab + ' sel=' + state.selected + ' k=' + state.view.k.toFixed(1) + ' hash=' + location.hash);
await page.evaluate(() => setSelected(null));

// country with no situation: Argentina → focus only
await page.click('#hdr-search'); await page.keyboard.type('argent'); await page.waitForTimeout(200);
R.ckArg = await page.$$eval('#ck-list .ck-item', els => els.map(e => e.innerText.replace(/\s+/g, ' ').trim()).slice(0, 3));
await page.keyboard.press('Enter'); await page.waitForTimeout(500);
R.afterArg = await page.evaluate(() => 'sel=' + state.selected + ' k=' + state.view.k.toFixed(1));
await page.evaluate(() => { state.view = { k: 1, x: 0, y: 0 }; applyView(); });

// live search for an untracked topic
await page.click('#hdr-search'); await page.keyboard.type('Armenia'); await page.waitForTimeout(200);
R.ckArmenia = await page.$$eval('#ck-list .ck-item', els => els.map(e => e.innerText.replace(/\s+/g, ' ').trim()));
const liveIdx = R.ckArmenia.findIndex(t => t.startsWith('LIVE SEARCH'));
for (let i = 0; i < liveIdx; i++) await page.keyboard.press('ArrowDown');
await page.keyboard.press('Enter'); await page.waitForTimeout(1200);
R.adhoc = await page.evaluate(() => 'tab=' + state.tab + ' status=' + state.adhoc.status + ' n=' + state.adhoc.items.length + ' open=' + document.getElementById('adhoc').classList.contains('open') + ' meta=' + document.getElementById('ah-meta').textContent);
await page.screenshot({ path: new URL('./out/v-adhoc.png', import.meta.url).pathname, clip: { x: 0, y: 0, width: 1400, height: 700 } });

// mobile
await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(400);
await page.evaluate(() => switchView('home'));
await page.waitForTimeout(300);
R.mobileScroll = await page.evaluate(() => document.documentElement.scrollWidth + ' vs ' + window.innerWidth);
R.mobileNav = await page.evaluate(() => { const r = document.getElementById('nav').getBoundingClientRect(); return 'nav w=' + Math.round(r.width) + ' y=' + Math.round(r.top); });
await page.screenshot({ path: new URL('./out/v-mobile.png', import.meta.url).pathname });
await page.evaluate(() => setSelected('sudan')); await page.waitForTimeout(500);
R.mobileDrawer = await page.evaluate(() => { const r = document.getElementById('detail').getBoundingClientRect(); return 'w=' + Math.round(r.width) + ' bg=' + getComputedStyle(document.getElementById('drawer-bg')).display; });
await page.screenshot({ path: new URL('./out/v-mobile-drawer.png', import.meta.url).pathname });

console.log(JSON.stringify(R, null, 2));
console.log('PAGE ERRORS:', errors.length ? errors : 'none');
await browser.close();
