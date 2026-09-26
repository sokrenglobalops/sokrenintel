// Parses every inline <script> in index.html with new Function() — catches syntax errors in <1 s.
import fs from 'fs';
const h = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
let n = 0;
for (const m of h.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)) { new Function(m[1]); n++; }
console.log('syntax OK ·', n, 'inline script(s) ·', Math.round(h.length / 1024), 'KB');
