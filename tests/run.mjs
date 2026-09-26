// Runs syntax check + every *.test.mjs. A test fails if it exits non-zero or reports page errors.
import { spawnSync } from 'child_process';
import fs from 'fs';
const dir = new URL('./', import.meta.url).pathname;
fs.mkdirSync(dir + 'out', { recursive: true });
const files = ['syntax.mjs', ...fs.readdirSync(dir).filter(f => f.endsWith('.test.mjs')).sort()];
let failed = 0;
for (const f of files) {
  const t0 = Date.now();
  const r = spawnSync('node', [dir + f], { encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const pageErr = /PAGE ERRORS: (?!none)/.test(out) || /"errors": (?!"none")/.test(out) || /errors: (?!none)/.test(out);
  const ok = r.status === 0 && !pageErr;
  if (!ok) failed++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + f.padEnd(24) + ((Date.now() - t0) / 1000).toFixed(1) + 's');
  if (!ok || process.argv.includes('-v')) console.log(out.split('\n').map(l => '      ' + l).join('\n'));
}
console.log(failed ? `\n${failed} failed` : '\nall green');
process.exit(failed ? 1 : 0);
