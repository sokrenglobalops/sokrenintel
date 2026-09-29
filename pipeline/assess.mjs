// Weekly: for each situation with enough new reporting, ask Claude whether the reporting materially
// changes the assessment and, if it does, revise the existing ACH / linchpin / SWOT / outlook / STI in
// place. Unchanged situations only get a "reviewed" timestamp. Every applied change is logged to
// data/changes.json (the week-to-week "what changed" alerts on the site).
//   node pipeline/assess.mjs                 batch run (half price; normal weekly mode)
//   node pipeline/assess.mjs --sync --only ru-ua   one situation, immediate (testing)
//   node pipeline/assess.mjs --dry           build requests, print sizes, call nothing
// Needs ANTHROPIC_API_KEY (GitHub Actions secret) except with --dry.
import Anthropic from '@anthropic-ai/sdk';
import { loadBaseline, readJSON, writeJSON, currentAssessment, isoWeek } from './lib.mjs';

const MODEL = 'claude-opus-5-5';
const MIN_NEW_ARTICLES = 3, MAX_ARTICLES = 45, LOOKBACK_DAYS = 8;
const args = process.argv.slice(2), flag = (f) => args.includes(f), opt = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };

const SYSTEM = `You maintain the analytic assessments on SOKREN Global Operations, an open-source (OSINT) conflict-monitoring site used by defense and security readers. Each tracked situation carries:
- priority (1 critical, 2 high, 3 medium, 4 low) and the SOKREN Threat Index (STI, 0-100) with five sub-scores;
- a short brief and five activity lines (label + one line each);
- an outlook: probability (%), what is likely, and the time window;
- Analysis of Competing Hypotheses (ACH): 3 hypotheses with probabilities that sum to 100, plus the key discriminator;
- linchpins: key assumptions, each with what follows if it fails;
- SWOT: strengths, weaknesses, opportunities, threats (2 short items each, from a stability perspective).

Each week you receive the current assessment and the reporting gathered since the last review. Your job:
1. Decide whether the new reporting MATERIALLY changes the picture: a new development, a confirmed or falsified hypothesis, an escalation or de-escalation, a ceasefire, a major attack, a leadership change, a shift in tempo. Routine repetition of known facts, commentary, or minor incidents is NOT material. When in doubt, keep the assessment and say why.
2. If material, revise the assessment in place. Change only what the evidence supports; keep unaffected text word-for-word. Re-weight ACH probabilities when evidence shifts them (still summing to 100); replace a hypothesis only if it has been decisively confirmed or ruled out. Move the STI and sub-scores by amounts proportionate to the change and explain each move.
3. If not material, return the current assessment unchanged in "updated", set material_change to false, and leave "changes" empty.

Rules:
- Use only the supplied reporting plus the existing assessment. Do not introduce facts that are not in them. Cite supporting articles by their [number] in "cites".
- Write in the site's register: short, plain, analytic sentences; no hype, no false precision. Proximity or co-occurrence is a cue, not corroboration. Say "reported" when a single outlet is the only source.
- Keep lengths similar to the current text: brief ≤ 3 sentences; activity lines ≤ 20 words; SWOT items ≤ 12 words.
- Probabilities and scores are integers. Priority changes need a clear, significant shift.
- In "changes", list every field you changed with a from/to summary (not the full text) and one sentence of why.`;

const ITEM = (props, req = Object.keys(props)) => ({ type: 'object', additionalProperties: false, required: req, properties: props });
const STR = { type: 'string' }, INT = { type: 'integer' }, STRS = { type: 'array', items: STR };
const SCHEMA = ITEM({
  material_change: { type: 'boolean' },
  reason: STR,
  changes: { type: 'array', items: ITEM({ field: { type: 'string', enum: ['priority', 'sti', 'parts', 'brief', 'assess', 'outlook', 'ach', 'disc', 'pins', 'swot'] }, from: STR, to: STR, why: STR, cites: { type: 'array', items: INT } }) },
  updated: ITEM({
    priority: { type: 'integer', enum: [1, 2, 3, 4] },
    sti: INT,
    parts: { type: 'array', items: ITEM({ k: STR, v: INT }) },
    brief: STR,
    assess: { type: 'array', items: ITEM({ label: STR, line: STR }) },
    outlook: ITEM({ p: INT, line: STR, window: STR }),
    ach: { type: 'array', items: ITEM({ h: STR, p: INT }) },
    disc: STR,
    pins: { type: 'array', items: ITEM({ a: STR, f: STR }) },
    swot: ITEM({ s: STRS, w: STRS, o: STRS, t: STRS }),
  }),
});

/* assessment <-> the flat shape the model edits */
function toModel(cur) {
  const a = cur.analysis;
  return {
    priority: cur.priority, sti: cur.sti, parts: Object.entries(cur.parts || {}).map(([k, v]) => ({ k, v })), brief: cur.brief,
    assess: (cur.assess || []).map(([label, line]) => ({ label, line })), outlook: cur.outlook,
    ach: (a.ach || []).map(([h, p]) => ({ h, p })), disc: a.disc || '', pins: (a.pins || []).map(([x, f]) => ({ a: x, f })), swot: a.swot,
  };
}
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(n) || 0)));
function fromModel(u, cur) {
  const ach = (u.ach || []).filter(x => x.h).slice(0, 4);
  const sum = ach.reduce((s, x) => s + clamp(x.p, 0, 100), 0) || 1;
  let achN = ach.map(x => [x.h, Math.round(clamp(x.p, 0, 100) * 100 / sum)]);
  if (achN.length) achN[0][1] += 100 - achN.reduce((s, x) => s + x[1], 0);   // exact 100 after rounding
  const parts = Object.fromEntries(Object.keys(cur.parts || {}).map(k => { const m = (u.parts || []).find(x => x.k === k); return [k, clamp(m ? m.v : cur.parts[k], 0, 100)]; }));
  const sw = (x, old) => (Array.isArray(x) && x.length ? x.filter(Boolean).slice(0, 3) : old);
  return {
    priority: [1, 2, 3, 4].includes(u.priority) ? u.priority : cur.priority,
    sti: clamp(u.sti, 0, 100), parts,
    brief: u.brief || cur.brief,
    assess: (u.assess || []).length ? u.assess.filter(x => x.label && x.line).map(x => [x.label, x.line]) : cur.assess,
    outlook: { p: clamp(u.outlook && u.outlook.p, 1, 99), line: (u.outlook && u.outlook.line) || cur.outlook.line, window: (u.outlook && u.outlook.window) || cur.outlook.window },
    analysis: {
      ach: achN.length ? achN : cur.analysis.ach, disc: u.disc || cur.analysis.disc,
      pins: (u.pins || []).length ? u.pins.filter(x => x.a).map(x => [x.a, x.f]) : cur.analysis.pins,
      swot: { s: sw(u.swot && u.swot.s, cur.analysis.swot.s), w: sw(u.swot && u.swot.w, cur.analysis.swot.w), o: sw(u.swot && u.swot.o, cur.analysis.swot.o), t: sw(u.swot && u.swot.t, cur.analysis.swot.t) },
    },
  };
}

function buildRequests(base, intel, news) {
  const now = Date.now(), reqs = [], skipped = {};
  for (const e of base.events) {
    if (opt('--only') && opt('--only') !== e.id) continue;
    const last = Date.parse((intel.events[e.id] || {}).checkedAt || 0) || 0;
    const since = Math.max(last, now - LOOKBACK_DAYS * 864e5);
    const fresh = (news.items[e.id] || []).filter(a => a.date && Date.parse(a.date) > since).slice(0, MAX_ARTICLES);
    if (fresh.length < MIN_NEW_ARTICLES && !opt('--only')) { skipped[e.id] = fresh.length + ' new'; continue; }
    const cur = currentAssessment(e.id, base, intel);
    const list = fresh.map((a, i) => `[${i + 1}] ${a.date.slice(0, 10)} · ${a.src && a.src !== 'GDELT' ? a.src : a.domain} · ${a.title}${a.summary ? ' — ' + a.summary.slice(0, 280) : ''}`).join('\n');
    const user = `Today: ${new Date().toISOString().slice(0, 10)}\nSituation: ${e.name} (id ${e.id})\nLast reviewed: ${last ? new Date(last).toISOString().slice(0, 10) : 'never (baseline written by the analyst)'}\n\nCURRENT ASSESSMENT (JSON):\n${JSON.stringify(toModel(cur), null, 1)}\n\nNEW REPORTING SINCE LAST REVIEW (${fresh.length} items):\n${list}\n\nDecide whether this reporting materially changes the assessment and respond in the required JSON format.`;
    reqs.push({ id: e.id, fresh, cur, params: {
      model: MODEL, max_tokens: 16000,
      output_config: { effort: 'high', format: { type: 'json_schema', schema: SCHEMA } },
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: user }],
    } });
  }
  return { reqs, skipped };
}

function textOf(msg) { const b = (msg.content || []).find(x => x.type === 'text'); return b ? b.text : ''; }

function apply(r, msg, intel, log) {
  const at = new Date().toISOString();
  if (msg.stop_reason === 'refusal' || msg.stop_reason === 'max_tokens') throw new Error('stop_reason ' + msg.stop_reason);
  const out = JSON.parse(textOf(msg));
  const rec = intel.events[r.id] || (intel.events[r.id] = {});
  rec.checkedAt = at; rec.checkedArticles = r.fresh.length;
  if (!out.material_change || !(out.changes || []).length) { rec.lastReview = { at, material: false, reason: out.reason }; return 'no change'; }
  const fields = fromModel(out.updated, r.cur);
  const cited = [...new Set(out.changes.flatMap(c => c.cites || []))].filter(n => n >= 1 && n <= r.fresh.length).map(n => r.fresh[n - 1]);
  const src = cited.map(a => ({ title: a.title, url: a.url, domain: a.domain, date: a.date }));
  rec.fields = fields; rec.updatedAt = at; rec.sources = src.slice(0, 12);
  rec.basis = { articles: r.fresh.length, outlets: [...new Set(r.fresh.map(a => a.domain))].length };
  rec.lastReview = { at, material: true, reason: out.reason };
  log.entries.unshift({ id: r.id, name: r.cur.name, at, week: isoWeek(), reason: out.reason,
    sti: { from: r.cur.sti, to: fields.sti }, priority: { from: r.cur.priority, to: fields.priority },
    changes: out.changes.map(c => ({ field: c.field, from: c.from, to: c.to, why: c.why, sources: (c.cites || []).filter(n => n >= 1 && n <= r.fresh.length).map(n => ({ title: r.fresh[n - 1].title, url: r.fresh[n - 1].url, domain: r.fresh[n - 1].domain })) })) });
  return `CHANGED (${out.changes.length} fields, STI ${r.cur.sti}→${fields.sti})`;
}

async function runSync(client, r, withFallback) {
  const params = withFallback ? { ...r.params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : r.params;
  const stream = withFallback ? client.beta.messages.stream(params) : client.messages.stream(params);
  return stream.finalMessage();
}

async function main() {
  const base = loadBaseline();
  const intel = readJSON('intel.json', { version: 1, events: {} });
  const news = readJSON('news.json', { items: {} });
  const log = readJSON('changes.json', { entries: [] });
  const { reqs, skipped } = buildRequests(base, intel, news);
  console.log(`${reqs.length} situation(s) to review; skipped (too little new reporting): ${JSON.stringify(skipped)}`);
  if (flag('--dry')) { reqs.forEach(r => console.log(r.id, r.fresh.length, 'articles', '~' + Math.round(JSON.stringify(r.params.messages).length / 4) + ' tokens')); return; }
  if (!reqs.length) return;
  const client = new Anthropic();
  const results = {}, retry = [];

  if (flag('--sync')) {
    for (const r of reqs) { try { results[r.id] = await runSync(client, r, true); } catch (e) { console.log(r.id, 'failed:', e.message); } }
  } else {
    // Batches: half price; server-side fallbacks aren't accepted here, so refusals are retried synchronously below
    const batch = await client.messages.batches.create({ requests: reqs.map(r => ({ custom_id: r.id, params: r.params })) });
    console.log('batch', batch.id);
    let b = batch;
    for (let waited = 0; b.processing_status !== 'ended'; waited += 60) {
      if (waited > 5 * 3600) { console.log('batch still running after 5 h — results will be picked up next run'); return; }
      await new Promise(res => setTimeout(res, 60_000));
      b = await client.messages.batches.retrieve(batch.id);
    }
    for await (const res of await client.messages.batches.results(batch.id)) {
      if (res.result.type === 'succeeded' && res.result.message.stop_reason !== 'refusal') results[res.custom_id] = res.result.message;
      else retry.push(res.custom_id);
    }
    for (const id of retry) { const r = reqs.find(x => x.id === id); try { results[id] = await runSync(client, r, true); } catch (e) { console.log(id, 'retry failed:', e.message); } }
  }

  for (const r of reqs) {
    if (!results[r.id]) continue;
    try { console.log(r.id, '→', apply(r, results[r.id], intel, log)); }
    catch (e) { console.log(r.id, 'not applied:', e.message); }
  }
  intel.generatedAt = new Date().toISOString(); intel.model = MODEL;
  log.entries = log.entries.slice(0, 300);
  writeJSON('intel.json', intel);
  writeJSON('changes.json', log);
}

main().catch(e => { console.error(e); process.exit(1); });
