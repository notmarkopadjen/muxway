// Renders the app icons from the theme SVGs with Playwright's Chromium,
// which the suite already needs: run by hand once, the PNGs are committed.
// Usage: node scripts/icons.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const here = new URL('.', import.meta.url).pathname;
const pub = join(here, '..', 'public');
const out = join(pub, 'icons');
mkdirSync(out, { recursive: true });

// Each icon: the file, the SVG, the size, and the padding for a maskable
// icon (the launcher cuts a circle; the safe zone is the inner 80 %).
const icons = [
  { file: 'icon-192.png', svg: 'icon.svg', size: 192, pad: 0 },
  { file: 'icon-512.png', svg: 'icon.svg', size: 512, pad: 0 },
  { file: 'icon-maskable-512.png', svg: 'icon.svg', size: 512, pad: 0.1 },
  { file: 'apple-touch-icon.png', svg: 'icon.svg', size: 180, pad: 0 },
];

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const icon of icons) {
  const svg = readFileSync(join(pub, icon.svg), 'utf8');
  const inner = Math.round(icon.size * (1 - 2 * icon.pad));
  const bg = /<rect[^>]*fill="(#[0-9a-f]{6})"/i.exec(svg)?.[1] ?? '#0a0603';
  await page.setViewportSize({ width: icon.size, height: icon.size });
  await page.setContent(
    `<!doctype html><body style="margin:0;background:${bg};width:${icon.size}px;height:${icon.size}px;display:grid;place-items:center">` +
      `<img style="width:${inner}px;height:${inner}px;image-rendering:pixelated" src="data:image/svg+xml;utf8,${encodeURIComponent(svg)}"></body>`,
  );
  const png = await page.screenshot({ clip: { x: 0, y: 0, width: icon.size, height: icon.size } });
  writeFileSync(join(out, icon.file), png);
  console.log(icon.file, icon.size);
}
await browser.close();
