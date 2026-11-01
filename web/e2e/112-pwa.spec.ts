import { expect, test } from '@playwright/test';
import { openPane, SHELL0, shot, signIn } from './fixtures';

// The client as an installable app: the worker keeps the client's own
// files and nothing of the API, the shell opens with no network, the
// manifest names the icons, the theme colour follows the theme.

// The worker the page registered, once it controls the page.
async function workerReady(page: import('@playwright/test').Page) {
  // The registration's own word, so a refusal says why instead of hanging.
  const said = await page.evaluate(() =>
    navigator.serviceWorker.register('/sw.js').then(
      () => 'ok',
      (e) => String(e),
    ),
  );
  expect(said, 'the worker registers').toBe('ok');
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise<void>((f) => {
        navigator.serviceWorker.addEventListener('controllerchange', () => f(), { once: true });
        reg.active?.postMessage('mx-skip-waiting');
      });
  });
}

async function cachedPaths(page: import('@playwright/test').Page): Promise<string[]> {
  return page.evaluate(async () => {
    const out: string[] = [];
    for (const name of await caches.keys())
      for (const req of await (await caches.open(name)).keys()) out.push(new URL(req.url).pathname);
    return out;
  });
}

test('112 the worker caches the client, never the API, and the shell opens offline', async ({
  page,
  context,
}, info) => {
  await signIn(page);
  await workerReady(page);
  // The client's own files are in the cache, nothing of the API.
  const own = await cachedPaths(page);
  expect(own).toContain('/');
  expect(own.some((p) => p.startsWith('/assets/'))).toBe(true);
  expect(own.some((p) => p.startsWith('/v1/'))).toBe(false);
  // A session's worth of API calls: a listing, a pane, its screen.
  await openPane(page, SHELL0);
  await expect(page.getByTestId('tile')).toBeVisible();
  await page.waitForTimeout(1500);
  const after = await cachedPaths(page);
  expect(after.some((p) => p.startsWith('/v1/'))).toBe(false);
  expect(after.filter((p) => !p.startsWith('/assets/') && !p.startsWith('/fonts/'))).toEqual(
    expect.arrayContaining(['/', '/manifest.webmanifest']),
  );
  // No network: the page reloads from the worker, the shell says so.
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('status')).toBeVisible();
  await expect(page.getByTestId('online')).toContainText('unreachable', { timeout: 15_000 });
  await shot(page, info, '112-pwa-offline');
  await context.setOffline(false);
});

test('112 the manifest, the icons and the theme colour', async ({ page, request }) => {
  await signIn(page);
  const link = page.locator('link[rel="manifest"]');
  await expect(link).toHaveAttribute('href', '/manifest.webmanifest');
  const manifest = await request.get('/manifest.webmanifest');
  expect(manifest.status()).toBe(200);
  const m = (await manifest.json()) as {
    name: string;
    display: string;
    icons: { src: string; sizes: string; purpose?: string }[];
  };
  expect(m.name).toBe('muxway');
  expect(m.display).toBe('standalone');
  expect(m.icons.some((i) => i.purpose === 'maskable')).toBe(true);
  for (const icon of m.icons) {
    const r = await request.get(icon.src);
    expect(r.status()).toBe(200);
    expect(r.headers()['content-type']).toContain('image/png');
    const [w, h] = icon.sizes.split('x').map(Number);
    const size = await page.evaluate(
      (src) =>
        new Promise<[number, number]>((f) => {
          const img = new Image();
          img.onload = () => f([img.naturalWidth, img.naturalHeight]);
          img.src = src;
        }),
      icon.src,
    );
    expect(size).toEqual([w, h]);
  }
  // The theme colour follows the theme: amber, then green with t.
  const colour = page.locator('meta[name="theme-color"]');
  await expect(colour).toHaveAttribute('content', '#0a0603');
  await page.keyboard.press('t');
  await expect(colour).toHaveAttribute('content', '#050806');
  await page.keyboard.press('t');
  await expect(colour).toHaveAttribute('content', '#f1ead8');
  await page.keyboard.press('t');
  await expect(colour).toHaveAttribute('content', '#0a0603');
});
