// Parses every inline <script> in the pages with new Function() — catches syntax errors in <1 s.
import fs from 'fs';
for (const f of ['index.html', 'classic.html']) {
  const h = fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
  let n = 0;
  for (const m of h.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)) { new Function(m[1]); n++; }
  console.log(f, 'syntax OK ·', n, 'inline script(s) ·', Math.round(h.length / 1024), 'KB');
}
