// Shared helpers for the intel pipeline (collect.mjs daily, assess.mjs weekly).
// The site file stays the single source of the baseline: EVENTS, ANALYSIS and EVENT_KEYWORDS are read
// straight out of index.html, and data/intel.json holds only the machine revisions layered on top.
import fs from 'fs';
import vm from 'vm';

export const ROOT = new URL('../', import.meta.url);
export const DATA = new URL('data/', ROOT);
export const SITE_FILE = new URL('index.html', ROOT);

function sliceConst(src, name) {
  const start = src.indexOf(`const ${name} = `);
  if (start < 0) throw new Error(`${name} not found in site file`);
  const open = src.indexOf(src[start + `const ${name} = `.length] === '[' ? '[' : '{', start);
  let depth = 0, i = open, str = null;
  for (; i < src.length; i++) {
    const c = src[i];
    if (str) { if (c === '\\') { i++; continue; } if (c === str) str = null; continue; }
    if (c === '"' || c === "'" || c === '`') { str = c; continue; }
    if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(open, i + 1);
}

/** Baseline situations from the site file: { events, analysis, keywords } */
export function loadBaseline() {
  const src = fs.readFileSync(SITE_FILE, 'utf8');
  const ev = (name) => vm.runInNewContext('(' + sliceConst(src, name) + ')');
  return { events: ev('EVENTS'), analysis: ev('ANALYSIS'), keywords: ev('EVENT_KEYWORDS') };
}

export function readJSON(name, fallback) {
  try { return JSON.parse(fs.readFileSync(new URL(name, DATA), 'utf8')); } catch { return fallback; }
}
export function writeJSON(name, obj) {
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(new URL(name, DATA), JSON.stringify(obj, null, 1) + '\n');
}

/** Same routing rules as the site: most specific first, word boundaries for single words */
export function makeMatcher(keywords) {
  const rules = keywords.map(([id, kws]) => [id, kws.map(k => k.includes(' ') ? k : new RegExp('\\b' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i'))]);
  return (text) => {
    const t = ' ' + String(text || '').toLowerCase() + ' ';
    const hits = [];
    for (const [id, ks] of rules) if (ks.some(k => typeof k === 'string' ? t.includes(k) : k.test(t))) hits.push(id);
    return hits;
  };
}

/** Current state of a situation = baseline + latest machine revision */
export function currentAssessment(id, base, intel) {
  const e = base.events.find(x => x.id === id), a = base.analysis[id] || {};
  const rev = intel.events && intel.events[id] && intel.events[id].fields;
  const cur = {
    name: e.name, emerging: !!e.emerging, flash: e.flash || '', priority: e.priority, sti: e.sti, parts: e.parts, brief: e.brief, assess: e.assess, outlook: e.outlook,
    analysis: { ach: a.ach || [], disc: a.disc || '', pins: a.pins || [], swot: a.swot || { s: [], w: [], o: [], t: [] } },
  };
  return rev ? { ...cur, ...rev, analysis: { ...cur.analysis, ...(rev.analysis || {}) } } : cur;
}

export const domainOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
export const isoWeek = (d = new Date()) => {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return t.getUTCFullYear() + '-W' + String(Math.ceil(((t - y) / 86400000 + 1) / 7)).padStart(2, '0');
};
