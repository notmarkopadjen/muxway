import { expect, test } from '@playwright/test';
import { openPane, SHELL0, signIn } from './fixtures';

test('42 every response carries the headers and nothing leaves the origin', async ({ page }) => {
  const base = process.env.MX_BASE_URL ?? '';
  const foreign: string[] = [];
  const headers: Record<string, Record<string, string>> = {};
  page.on('request', (r) => {
    if (!r.url().startsWith(base)) foreign.push(r.url());
  });
  page.on('response', (r) => {
    headers[new URL(r.url()).pathname] = r.headers();
  });
  await signIn(page);
  await openPane(page, SHELL0);
  await page.waitForTimeout(1500);
  expect(foreign).toEqual([]);
  const root = headers['/signin'] ?? headers['/'];
  expect(root['content-security-policy']).toContain("default-src 'none'");
  expect(root['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(root['x-content-type-options']).toBe('nosniff');
  expect(root['referrer-policy']).toBe('no-referrer');
  const asset = Object.entries(headers).find(([p]) => p.startsWith('/assets/'));
  expect(asset).toBeTruthy();
  expect(asset![1]['cache-control']).toContain('immutable');
  expect(asset![1]['content-security-policy']).toContain("script-src 'self'");
  for (const [path, h] of Object.entries(headers)) {
    if (path.startsWith('/v1/')) expect(h['x-content-type-options'], path).toBe('nosniff');
  }
});
