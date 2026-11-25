import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { control, HOST, settled, shot, SHELL0, signIn } from './fixtures';

// One size per window. A tile that is the only open one of its window
// fits that window, with its pane zoomed over the siblings, so the host
// gives it the cells it asked for: no neighbour is squeezed, nothing is
// held, and it works where a sibling may not be written, which laying
// the window out could not. Several such tiles side by side each own
// their own window.

const LOGS = `${HOST}/work/1.0`;

const made: string[] = [];
async function split(request: APIRequestContext, target: string, dir: 'h' | 'v') {
  const id = await control(request, '/split', { target, dir });
  made.push(id);
  return id;
}
test.afterEach(async ({ page, request }) => {
  // The view is left first, so the windows it sized and zoomed are given
  // back before the panes go.
  await page.goto('/');
  for (const id of made.splice(0).reverse()) await control(request, '/kill-pane', { target: id });
  await expect
    .poll(() => control(request, '/window-size', { target: 'work:1' }), { timeout: 10_000 })
    .toBe('100x30');
  await expect.poll(() => control(request, '/zoomed', { target: 'work:0' })).toBe('0');
});

interface Resize {
  address: string;
  body: { scope?: string; zoom?: boolean; layout?: string; fit?: string; cols?: number };
}
function watchResizes(page: Page): Resize[] {
  const out: Resize[] = [];
  page.on('request', (r) => {
    const m = r.url().match(/\/v1\/panes\/(.+)\/resize$/);
    if (m && r.method() === 'POST')
      out.push({ address: decodeURIComponent(m[1]), body: JSON.parse(r.postData() ?? '{}') });
  });
  return out;
}
// The size a tile's header shows.
const sizeOf = async (page: Page, a: string) => {
  const t = (await page.locator(`[data-pane="${a}"] .mx-tile-head .mx-size`).textContent()) ?? '';
  const m = /(\d+)×(\d+)/.exec(t)!;
  return `${m[1]}x${m[2]}`;
};

test('135 two tiles, each the only open one of its window: each fits its own window, zoomed, and neither is held', async ({
  page,
  request,
}, info) => {
  // work:0 has a pane this token may not write (0.1), so its window
  // cannot be laid out; work:1 is split once. Each tile is the only open
  // one of its window and has a sibling to be zoomed over.
  await split(request, 'work:1.0', 'h');
  const resizes = watchResizes(page);
  await signIn(page);
  await page.goto(`/p/${SHELL0},${LOGS}`);
  await expect(page.getByTestId('tile')).toHaveCount(2);
  await settled(page);
  // Neither tile is held: the host gave each the size it asked for.
  await expect.poll(() => page.getByTestId('held').count(), { timeout: 10_000 }).toBe(0);
  await expect(page.locator('[data-testid="tile"][data-held]')).toHaveCount(0);
  // Each window is the size of its tile, with the pane zoomed in it: the
  // header and the host are read together, since the tile says the size
  // it has, not the one it asked for.
  const matches = async (window: string, address: string) => {
    const [host, head] = await Promise.all([
      control(request, '/window-size', { target: window }),
      sizeOf(page, address),
    ]);
    return `${head} / ${host}`;
  };
  await expect
    .poll(() => matches('work:0', SHELL0), { timeout: 10_000 })
    .toMatch(/^(\d+x\d+) \/ \1$/);
  await expect
    .poll(() => matches('work:1', LOGS), { timeout: 10_000 })
    .toMatch(/^(\d+x\d+) \/ \1$/);
  await expect.poll(() => control(request, '/zoomed', { target: 'work:0' })).toBe('1');
  await expect.poll(() => control(request, '/zoomed', { target: 'work:1' })).toBe('1');
  await shot(page, info, '135-two-windows');
  // Each tile sent one window fit for its own pane, with the zoom; no
  // pane-scope fit was sent at all.
  const sized = resizes.filter((r) => r.body.fit !== 'auto');
  expect(sized.length).toBeGreaterThanOrEqual(2);
  for (const r of sized) {
    expect(r.body.scope).toBe('window');
    expect(r.body.zoom).toBe(true);
  }
  expect(new Set(sized.map((r) => r.address))).toEqual(new Set([SHELL0, LOGS]));
});

test('135 two tiles of one window and two of another: each window is laid out as its own tiles', async ({
  page,
  request,
}, info) => {
  await split(request, 'work:1.0', 'h');
  await signIn(page);
  // A second window with two writable panes of its own: a session this
  // token starts, then one more pane in it. One creation per two seconds.
  const start = await page.request.post(`/v1/hosts/${HOST}/sessions`, {
    headers: { 'X-Muxway-Client': 'e2e' },
    data: { name: 'pair' },
  });
  expect(start.status()).toBe(201);
  await page.waitForTimeout(2100);
  const more = await page.request.post(`/v1/windows/${HOST}/pair/0/panes`, {
    headers: { 'X-Muxway-Client': 'e2e' },
    data: { direction: 'h' },
  });
  expect(more.status()).toBe(201);
  const resizes = watchResizes(page);
  await page.goto(`/p/${LOGS},${HOST}/work/1.1,${HOST}/pair/0.0,${HOST}/pair/0.1`);
  await expect(page.getByTestId('tile')).toHaveCount(4);
  await settled(page);
  // Neither window's tiles are held: each window is laid out as its own
  // two tiles, so every pane has the cells its tile draws.
  await expect.poll(() => page.getByTestId('held').count(), { timeout: 10_000 }).toBe(0);
  await expect(page.locator('[data-testid="tile"][data-held]')).toHaveCount(0);
  await shot(page, info, '135-two-groups');
  // A window layout went to each window, not only to the first.
  await expect
    .poll(
      () =>
        new Set(
          resizes
            .filter((r) => r.body.scope === 'window' && r.body.layout)
            .map((r) => r.address.split('/')[1]),
        ).size,
      { timeout: 10_000 },
    )
    .toBe(2);
  await page.goto('/');
  await control(request, '/kill-pane', { target: 'pair:0.1' });
  await control(request, '/kill-pane', { target: 'pair:0.0' });
});
