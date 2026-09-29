// Daily: collect reporting from the approved free sources + GDELT, route each item to a situation,
// and keep a rolling 30-day window in data/news.json. Runs in GitHub Actions (server side, so no
// browser CORS limits) — this is what keeps the site's feed current instead of the Sep 4 snapshot.
//   node pipeline/collect.mjs            full run
//   node pipeline/collect.mjs --no-gdelt RSS only (fast)
import { loadBaseline, readJSON, writeJSON, makeMatcher, domainOf } from './lib.mjs';

const SOURCES = [
  // conflict & geopolitics
  { id: 'crisisgroup', name: 'International Crisis Group', url: 'https://www.crisisgroup.org/rss.xml' },
  { id: 'geomon', name: 'Geopolitical Monitor', url: 'https://www.geopoliticalmonitor.com/feed/' },
  { id: 'lawfare', name: 'Lawfare', url: 'https://www.lawfaremedia.org/feeds/articles' },
  { id: 'defenseone', name: 'Defense One', url: 'https://www.defenseone.com/rss/all/' },
  { id: 'aj', name: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml' },
  { id: 'bbc', name: 'BBC World', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
  // cyber & threat intelligence
  { id: 'mandiant', name: 'Google Threat Intelligence (Mandiant)', url: 'https://feeds.feedburner.com/threatintelligence/pvexyqv7v0v' },
  { id: 'sentinellabs', name: 'SentinelLabs', url: 'https://www.sentinelone.com/labs/feed/' },
  { id: 'record', name: 'The Record', url: 'https://therecord.media/feed' },
  { id: 'cyberscoop', name: 'CyberScoop', url: 'https://cyberscoop.com/feed/' },
  { id: 'cisa', name: 'CISA', url: 'https://www.cisa.gov/cybersecurity-advisories/all.xml' },
];
const WINDOW_DAYS = 30, PER_SITUATION = 60, UA = 'SOKREN-intel/1.0 (+https://www.sokren.com)';

const decode = (s) => String(s || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim();
const tag = (block, name) => { const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i')); return m ? m[1] : ''; };

/** Minimal RSS 2.0 / Atom parser — enough for headline, link, date, summary */
export function parseFeed(xml) {
  const out = [];
  for (const m of xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)) {
    const b = m[0];
    let link = decode(tag(b, 'link'));
    if (!link) { const h = b.match(/<link[^>]*href="([^"]+)"/i); link = h ? h[1] : ''; }
    const date = new Date(decode(tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date')));
    out.push({ title: decode(tag(b, 'title')), url: link.trim(), date: isNaN(date) ? null : date.toISOString(), summary: decode(tag(b, 'description') || tag(b, 'summary') || tag(b, 'content')).slice(0, 400) });
  }
  return out.filter(x => x.title && /^https?:/.test(x.url));
}

async function get(url, ms = 20000) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, application/json, text/xml, */*' }, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.text();
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function gdelt(url) {
  let last;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const t = await get(url, 40000);
      if (/^Please limit requests/i.test(t)) throw new Error('rate limited');
      return JSON.parse(t);
    } catch (e) { last = e; await sleep(20000 * (attempt + 1)); }
  }
  throw last;
}

async function main() {
  const noGdelt = process.argv.includes('--no-gdelt');
  const base = loadBaseline();
  const match = makeMatcher(base.keywords);
  const prev = readJSON('news.json', { items: {} });
  const bucket = Object.fromEntries(base.events.map(e => [e.id, [...(prev.items[e.id] || [])]]));
  const report = { sources: {}, gdelt: {} };
  const add = (id, it) => { if (bucket[id]) bucket[id].push(it); };

  for (const s of SOURCES) {
    try {
      const items = parseFeed(await get(s.url));
      let routed = 0;
      for (const it of items) {
        const [id] = match(it.title + ' ' + it.summary);   // first (most specific) rule wins, as on the site
        if (id) { add(id, { title: it.title, url: it.url, domain: domainOf(it.url), date: it.date, src: s.name, summary: it.summary }); routed++; }
      }
      report.sources[s.id] = `${items.length} items, ${routed} routed`;
    } catch (e) { report.sources[s.id] = 'failed: ' + e.message; }
  }

  if (!noGdelt) {
    let failStreak = 0;
    for (const e of base.events) {
      if (failStreak >= 4) { report.gdelt[e.id] = 'skipped: GDELT unavailable this run'; continue; }   // don't grind for an hour when GDELT is down   // GDELT asks for ≤1 request per 5 s; it also throttles bursts, so go slower and retry
      // each situation's query is used as written (GDELT allows parentheses only around OR lists)
      const q = encodeURIComponent(`${e.query} sourcelang:english`);
      try {
        const d = await gdelt(`https://api.gdeltproject.org/api/v2/doc/doc?query=${q}&mode=ArtList&format=json&maxrecords=25&timespan=3d&sort=DateDesc`);
        const arts = d.articles || [];
        for (const a of arts) {
          const dt = /^\d{8}T\d{6}Z$/.test(a.seendate || '') ? `${a.seendate.slice(0, 4)}-${a.seendate.slice(4, 6)}-${a.seendate.slice(6, 8)}T${a.seendate.slice(9, 11)}:${a.seendate.slice(11, 13)}:00Z` : null;
          add(e.id, { title: decode(a.title), url: a.url, domain: a.domain || domainOf(a.url), date: dt, src: 'GDELT' });
        }
        report.gdelt[e.id] = arts.length; failStreak = 0;
      } catch (err) { report.gdelt[e.id] = 'failed: ' + err.message; failStreak++; }
      await sleep(8000);
    }
  }

  // de-duplicate (URL and near-identical headline), drop old, newest first, cap per situation
  const cutoff = Date.now() - WINDOW_DAYS * 864e5;
  const items = {};
  for (const [id, list] of Object.entries(bucket)) {
    const seen = new Set(), out = [];
    for (const it of list.sort((a, b) => (b.date || '').localeCompare(a.date || ''))) {
      const k1 = it.url.replace(/[?#].*$/, ''), k2 = it.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 90);
      if (seen.has(k1) || seen.has(k2)) continue;
      if (it.date && Date.parse(it.date) < cutoff) continue;
      seen.add(k1); seen.add(k2); out.push(it);
    }
    items[id] = out.slice(0, PER_SITUATION);
  }
  writeJSON('news.json', { generatedAt: new Date().toISOString(), windowDays: WINDOW_DAYS, sources: SOURCES.map(({ id, name, url }) => ({ id, name, url })), items });
  const total = Object.values(items).reduce((n, l) => n + l.length, 0);
  console.log(JSON.stringify({ total, ...report }, null, 1));
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error(e); process.exit(1); });
