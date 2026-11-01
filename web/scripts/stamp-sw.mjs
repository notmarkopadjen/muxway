// Writes the service worker into the build: the hashed asset paths the
// page references and a stamp that is a hash of index.html, so a new
// build is a new worker and the same build is the same worker.
// Usage: node scripts/stamp-sw.mjs [outDir]   (default dist)
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function assetsOf(html) {
  const paths = new Set();
  for (const m of html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)) paths.add(m[1]);
  return [...paths].sort();
}

export function stampOf(html) {
  return createHash('sha256').update(html).digest('hex').slice(0, 16);
}

export function stamp(template, html) {
  return template
    .replace("'__MX_STAMP__'", JSON.stringify(stampOf(html)))
    .replace('/* mx-assets */ []', JSON.stringify(assetsOf(html)));
}

const here = new URL('.', import.meta.url).pathname;
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const out = process.argv[2] ?? join(here, '..', 'dist');
  const html = readFileSync(join(out, 'index.html'), 'utf8');
  const template = readFileSync(join(here, '..', 'public', 'sw.js'), 'utf8');
  writeFileSync(join(out, 'sw.js'), stamp(template, html));
}
