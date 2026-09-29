// Daily: collect reporting from the approved free sources + GDELT, route each item to a situation,
// and keep a rolling 30-day window in data/news.json. Runs in GitHub Actions (server side, so no
// browser CORS limits) — this is what keeps the site's feed current instead of the Sep 4 snapshot.
//   node pipeline/collect.mjs            full run
//   node pipeline/collect.mjs --no-gdelt RSS only (fast)
import { loadBaseline, readJSON, writeJSON, makeMatcher, domainOf } from './lib.mjs';

const SOURCES = [
  // think tanks & conflict analysis
  { id: 'crisisgroup', name: 'International Crisis Group', url: 'https://www.crisisgroup.org/rss.xml' },
  { id: 'cfr', name: 'Council on Foreign Relations', url: 'https://feeds.cfr.org/cfr_main' },
  { id: 'atlantic', name: 'Atlantic Council', url: 'https://www.atlanticcouncil.org/feed/' },
  { id: 'aei', name: 'AEI', url: 'https://www.aei.org/feed/' },
  { id: 'stimson', name: 'Stimson Center', url: 'https://www.stimson.org/feed/' },
  { id: '38north', name: '38 North', url: 'https://www.38north.org/feed/' },
  { id: 'wotr', name: 'War on the Rocks', url: 'https://warontherocks.com/feed/' },
  { id: 'lwj', name: 'Long War Journal', url: 'https://www.longwarjournal.org/feed' },
  { id: 'bellingcat', name: 'Bellingcat', url: 'https://www.bellingcat.com/feed/' },
  { id: 'geomon', name: 'Geopolitical Monitor', url: 'https://www.geopoliticalmonitor.com/feed/' },
  { id: 'lawfare', name: 'Lawfare', url: 'https://www.lawfaremedia.org/feeds/articles' },
  { id: 'fp', name: 'Foreign Policy', url: 'https://foreignpolicy.com/feed/' },
  { id: 'diplomat', name: 'The Diplomat', url: 'https://thediplomat.com/feed/' },
  { id: 'insightcrime', name: 'InSight Crime', url: 'https://insightcrime.org/feed/' },
  { id: 'birn', name: 'Balkan Insight', url: 'https://balkaninsight.com/feed/' },
  // defense & government
  { id: 'defenseone', name: 'Defense One', url: 'https://www.defenseone.com/rss/all/' },
  { id: 'dod', name: 'U.S. Department of Defense', url: 'https://www.defense.gov/DesktopModules/ArticleCS/RSS.ashx?ContentType=1&Site=945&max=10' },
  { id: 'unnews', name: 'UN News', url: 'https://news.un.org/feed/subscribe/en/news/all/rss.xml' },
  // international news
  { id: 'aj', name: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml' },
  { id: 'bbc', name: 'BBC World', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
  { id: 'guardian', name: 'The Guardian', url: 'https://www.theguardian.com/world/rss' },
  { id: 'nyt', name: 'The New York Times', url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml' },
  { id: 'france24', name: 'France 24', url: 'https://www.france24.com/en/rss' },
  { id: 'dw', name: 'DW', url: 'https://rss.dw.com/rdf/rss-en-world' },
  { id: 'npr', name: 'NPR', url: 'https://feeds.npr.org/1004/rss.xml' },
  { id: 'wapo', name: 'The Washington Post', url: 'https://feeds.washingtonpost.com/rss/world' },
  { id: 'pbs', name: 'PBS NewsHour', url: 'https://www.pbs.org/newshour/feeds/rss/world' },
  { id: 'abc', name: 'ABC News', url: 'https://abcnews.go.com/abcnews/internationalheadlines' },
  { id: 'cbs', name: 'CBS News', url: 'https://www.cbsnews.com/latest/rss/world' },
  { id: 'nbc', name: 'NBC News', url: 'https://feeds.nbcnews.com/nbcnews/public/world' },
  { id: 'politico', name: 'Politico', url: 'https://rss.politico.com/defense.xml' },
  { id: 'axios', name: 'Axios', url: 'https://api.axios.com/feed/' },
  { id: 'economist', name: 'The Economist', url: 'https://www.economist.com/international/rss.xml' },
  { id: 'ft', name: 'Financial Times', url: 'https://www.ft.com/world?format=rss' },
  // cyber & threat intelligence
  { id: 'mandiant', name: 'Google Threat Intelligence (Mandiant)', url: 'https://feeds.feedburner.com/threatintelligence/pvexyqv7v0v' },
  { id: 'sentinellabs', name: 'SentinelLabs', url: 'https://www.sentinelone.com/labs/feed/' },
  { id: 'record', name: 'The Record', url: 'https://therecord.media/feed' },
  { id: 'cyberscoop', name: 'CyberScoop', url: 'https://cyberscoop.com/feed/' },
  { id: 'cisa', name: 'CISA', url: 'https://www.cisa.gov/cybersecurity-advisories/all.xml' },
];
const GDELT_OUTLETS = [
  ['apnews.com', 'AP'], ['reuters.com', 'Reuters'], ['understandingwar.org', 'Institute for the Study of War'],
  ['csis.org', 'CSIS'], ['reliefweb.int', 'ReliefWeb'], ['securitycouncilreport.org', 'Security Council Report'],
  ['kyivindependent.com', 'Kyiv Independent'], ['crisisgroup.org', 'International Crisis Group'],
  ['rand.org', 'RAND'], ['state.gov', 'U.S. State Department'],
  ['cnn.com', 'CNN'], ['pbs.org', 'PBS (NewsHour / Frontline)'], ['wsj.com', 'The Wall Street Journal'], ['washingtonpost.com', 'The Washington Post'],
];
// Only these outlets (plus every feed/outlet above) may be stored and cited. GDELT indexes tens of thousands of
// sites, including local stations re-running wire copy; anything not on this list is dropped.
const TRUSTED = new Set([
  // wires, broadcasters, newspapers
  'apnews.com', 'reuters.com', 'afp.com', 'bbc.com', 'bbc.co.uk', 'cnn.com', 'nytimes.com', 'washingtonpost.com', 'wsj.com', 'ft.com', 'economist.com',
  'theguardian.com', 'npr.org', 'pbs.org', 'abcnews.go.com', 'abcnews.com', 'cbsnews.com', 'nbcnews.com', 'axios.com', 'politico.com', 'politico.eu',
  'aljazeera.com', 'france24.com', 'dw.com', 'euronews.com', 'csmonitor.com', 'voanews.com', 'rferl.org', 'bloomberg.com', 'latimes.com', 'usatoday.com',
  'timesofisrael.com', 'haaretz.com', 'al-monitor.com', 'kyivindependent.com', 'themoscowtimes.com', 'meduza.io', 'scmp.com', 'japantimes.co.jp',
  'asia.nikkei.com', 'en.yna.co.kr', 'koreaherald.com', 'nknews.org', 'taipeitimes.com', 'focustaiwan.tw', 'rappler.com', 'inquirer.net',
  'thehindu.com', 'indianexpress.com', 'hindustantimes.com', 'dawn.com', 'irrawaddy.com', 'thediplomat.com', 'theafricareport.com',
  'africanews.com', 'dailymaverick.co.za', 'premiumtimesng.com', 'balkaninsight.com', 'insightcrime.org', 'kyivpost.com',
  // defense & security press
  'defenseone.com', 'defensenews.com', 'breakingdefense.com', 'twz.com', 'navalnews.com', 'news.usni.org', 'stripes.com', 'military.com', 'gcaptain.com',
  'longwarjournal.org', 'bellingcat.com', 'warontherocks.com', 'lawfaremedia.org', 'justsecurity.org', 'foreignpolicy.com', 'foreignaffairs.com',
  // think tanks & research
  'crisisgroup.org', 'cfr.org', 'csis.org', 'understandingwar.org', 'criticalthreats.org', 'atlanticcouncil.org', 'rand.org', 'aei.org', 'stimson.org',
  '38north.org', 'brookings.edu', 'carnegieendowment.org', 'chathamhouse.org', 'iiss.org', 'rusi.org', 'geopoliticalmonitor.com', 'washingtoninstitute.org',
  'africacenter.org', 'securitycouncilreport.org',
  // official & humanitarian
  'un.org', 'news.un.org', 'reliefweb.int', 'unocha.org', 'ochaopt.org', 'icrc.org', 'hrw.org', 'amnesty.org', 'who.int', 'nato.int',
  'state.gov', 'defense.gov', 'whitehouse.gov', 'cisa.gov', 'fbi.gov', 'ic3.gov', 'ncsc.gov.uk', 'consilium.europa.eu', 'europa.eu', 'congress.gov',
  // cyber
  'therecord.media', 'cyberscoop.com', 'sentinelone.com', 'cloud.google.com', 'mandiant.com', 'bleepingcomputer.com', 'securityweek.com',
  'darkreading.com', 'krebsonsecurity.com', 'unit42.paloaltonetworks.com', 'microsoft.com', 'recordedfuture.com',
]);
const trusted = (domain) => { const d = String(domain || '').toLowerCase().replace(/^www\./, ''); return [...TRUSTED].some(t => d === t || d.endsWith('.' + t)); };
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

  // GDELT throttles hard (also from GitHub's runners): cap its total time and ask about the most critical situations first
  const gdeltUntil = Date.now() + 10 * 60 * 1000, gdeltOk = () => Date.now() < gdeltUntil;
  if (!noGdelt) {
    let failStreak = 0;
    for (const e of [...base.events].sort((a, b) => a.priority - b.priority || b.sti - a.sti)) {
      if (!gdeltOk()) { report.gdelt[e.id] = 'skipped: time budget'; continue; }
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

  if (!noGdelt) {
    let failStreak = 0;
    for (const [domain, name] of GDELT_OUTLETS) {
      if (!gdeltOk()) { report.gdelt['@' + domain] = 'skipped: time budget'; continue; }
      if (failStreak >= 3) { report.gdelt['@' + domain] = 'skipped'; continue; }
      try {
        const d = await gdelt(`https://api.gdeltproject.org/api/v2/doc/doc?query=domain:${domain}&mode=ArtList&format=json&maxrecords=75&timespan=3d&sort=DateDesc`);
        let routed = 0;
        for (const a of d.articles || []) {
          const [id] = match(decode(a.title)); if (!id) continue;
          const dt = /^\d{8}T\d{6}Z$/.test(a.seendate || '') ? `${a.seendate.slice(0, 4)}-${a.seendate.slice(4, 6)}-${a.seendate.slice(6, 8)}T${a.seendate.slice(9, 11)}:${a.seendate.slice(11, 13)}:00Z` : null;
          add(id, { title: decode(a.title), url: a.url, domain, date: dt, src: name }); routed++;
        }
        report.gdelt['@' + domain] = `${(d.articles || []).length} items, ${routed} routed`; failStreak = 0;
      } catch (err) { report.gdelt['@' + domain] = 'failed: ' + err.message; failStreak++; }
      await sleep(8000);
    }
  }

  // de-duplicate (URL and near-identical headline), drop untrusted/old, newest first, cap per situation
  for (const s of SOURCES) TRUSTED.add(domainOf(s.url).replace(/^(feeds?|rss|api)\./, ''));
  for (const [d] of GDELT_OUTLETS) TRUSTED.add(d);
  let dropped = 0;
  const cutoff = Date.now() - WINDOW_DAYS * 864e5;
  const items = {};
  for (const [id, list] of Object.entries(bucket)) {
    const seen = new Set(), out = [];
    for (const it of list.sort((a, b) => (b.date || '').localeCompare(a.date || ''))) {
      const k1 = it.url.replace(/[?#].*$/, ''), k2 = it.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 90);
      if (seen.has(k1) || seen.has(k2)) continue;
      if (!trusted(it.domain) && !(it.src && it.src !== 'GDELT')) { dropped++; continue; }
      if (it.date && Date.parse(it.date) < cutoff) continue;
      seen.add(k1); seen.add(k2); out.push(it);
    }
    items[id] = out.slice(0, PER_SITUATION);
  }
  writeJSON('news.json', { generatedAt: new Date().toISOString(), windowDays: WINDOW_DAYS, sources: SOURCES.map(({ id, name, url }) => ({ id, name, url })), items });
  const total = Object.values(items).reduce((n, l) => n + l.length, 0);
  console.log(JSON.stringify({ total, droppedUntrusted: dropped, ...report }, null, 1));
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error(e); process.exit(1); });
