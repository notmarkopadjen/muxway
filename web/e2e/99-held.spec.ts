import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { control, HOST, openPane, SHELL0, settled, shot, signIn } from './fixtures';

// Tiles that are every pane of one window fit the window as one; so do
// tiles of a window not wholly open, when every pane of it is writable,
// its other panes stacked at the right, and the focus sends nothing; in
// a window with a pane the token may not write each tile fits its own
// pane, and a tile whose size the host would not give says held; a pane
// alone fits its window with the pane zoomed, and a sibling opened beside
// it undoes the zoom; a pane left for another stays at size and comes
// back without a resize.

const LOGS = `${HOST}/work/1.0`;
const SPLIT = `${HOST}/work/1.1`;
const SPLIT2 = `${HOST}/work/1.2`;

// The panes split off are killed after each test, newest first.
const made: string[] = [];
async function split(request: APIRequestContext, target: string, dir: 'h' | 'v') {
  const id = await control(request, '/split', { target, dir });
  made.push(id);
  return id;
}
test.afterEach(async ({ request }) => {
  for (const id of made.splice(0).reverse()) await control(request, '/kill-pane', { target: id });
});

interface Resize {
  address: string;
  body: Record<string, unknown>;
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
const fitsOf = (rs: Resize[], address: string) =>
  rs.filter((r) => r.address === address && r.body.fit !== 'auto');
const releasesOf = (rs: Resize[], address: string) =>
  rs.filter((r) => r.address === address && r.body.fit === 'auto');
const layoutsOf = (rs: Resize[]) => rs.filter((r) => r.body.scope === 'window' && r.body.layout);
const sizeOf = async (page: Page, a: string) => {
  const t = (await page.locator(`[data-pane="${a}"] .mx-tile-head .mx-size`).textContent()) ?? '';
  const m = /(\d+)×(\d+)/.exec(t)!;
  return { cols: Number(m[1]), rows: Number(m[2]) };
};
// A layout's panes: id, width, height.
const cells = (layout: string) =>
  [...layout.matchAll(/(\d+)x(\d+),\d+,\d+,(\d+)/g)].map((m) => ({
    id: `%${m[3]}`,
    w: Number(m[1]),
    h: Number(m[2]),
  }));
const places = async (request: APIRequestContext, target: string) =>
  (await control(request, '/places', { target })).split('\n').map((l) => {
    const [id, x, y, w, h] = l.split(' ');
    return { id, x: +x, y: +y, w: +w, h: +h };
  });

test('99 every pane of a window as tiles: the window fits as one, laid out as the tiles', async ({
  page,
  request,
}, info) => {
  await split(request, 'work:1.0', 'h');
  const resizes = watchResizes(page);
  const size = () => control(request, '/window-size', { target: 'work:1' });
  await signIn(page);
  await expect(page.getByTestId('pane-row').filter({ hasText: SPLIT })).toBeVisible({
    timeout: 10_000,
  });
  await page.goto(`/p/${LOGS},${SPLIT}`);
  const tiles = page.getByTestId('tile');
  await expect(tiles).toHaveCount(2);
  await settled(page);
  // The tiles open as the host has the window: side by side.
  await expect(page.getByTestId('pane')).toHaveAttribute('data-layout', 'custom');
  await expect(page.locator('.mx-area')).toHaveAttribute('data-window-fit', '');
  await expect(tiles.nth(1)).not.toHaveAttribute('data-held', '');
  await expect(page.getByTestId('held')).toHaveCount(0);
  await expect.poll(() => fitsOf(resizes, LOGS).length, { timeout: 5000 }).toBe(1);
  const fit = fitsOf(resizes, LOGS)[0].body;
  expect(fit.scope).toBe('window');
  // The layout is exact: the window's size is the root's, the two panes
  // its full height, side by side.
  expect(String(fit.layout)).toMatch(
    new RegExp(
      `^[0-9a-f]{4},${fit.cols}x${fit.rows},0,0\\{\\d+x${fit.rows},0,0,\\d+,\\d+x${fit.rows},0,0,\\d+\\}$`,
    ),
  );
  await expect.poll(size, { timeout: 5000 }).toBe(`${fit.cols}x${fit.rows}`);
  await page.waitForTimeout(1500);
  expect(fitsOf(resizes, SPLIT)).toHaveLength(0);
  // Each pane is its tile: the two share the window's width, side by side.
  const sizes = await Promise.all([LOGS, SPLIT].map((a) => sizeOf(page, a)));
  expect(sizes[0].cols + sizes[1].cols + 1).toBe(Number(fit.cols));
  expect(Math.abs(sizes[0].cols - sizes[1].cols)).toBeLessThanOrEqual(1);
  await shot(page, info, '99-window');
  // The focus moving between the tiles sends nothing.
  const sent = resizes.length;
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press(']');
    await expect(tiles.nth(1)).toHaveAttribute('data-focused', '');
    await page.keyboard.press('[');
    await expect(tiles.nth(0)).toHaveAttribute('data-focused', '');
  }
  await page.waitForTimeout(1500);
  expect(resizes).toHaveLength(sent);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('panes')).toBeVisible();
  await expect.poll(() => releasesOf(resizes, LOGS).length, { timeout: 5000 }).toBe(1);
  await expect.poll(size, { timeout: 5000 }).toBe('100x30');
});

test('99 two tiles of a window not wholly open fit the window as one, the third pane stacked at the right; the focus sends nothing', async ({
  page,
  request,
}, info) => {
  // Three panes in a row; two of them open side by side.
  await split(request, 'work:1.0', 'h');
  await split(request, 'work:1.0', 'h');
  // The third pane by position: the one not opened below.
  const id2 = await control(request, '/pane-id', { target: 'work:1.2' });
  const resizes = watchResizes(page);
  await signIn(page);
  await expect(page.getByTestId('pane-row').filter({ hasText: SPLIT2 })).toBeVisible({
    timeout: 10_000,
  });
  // Every pane of the window is the token's to write, so the window is
  // fitted as one.
  const r = await page.request.get('/v1/panes', { headers: { 'X-Muxway-Client': 'e2e' } });
  const listed = ((await r.json()) as { panes: { address: string; mode: string }[] }).panes;
  expect(
    listed.filter((q) => q.address.startsWith(`${HOST}/work/1.`)).map((q) => [q.address, q.mode]),
  ).toEqual([LOGS, SPLIT, SPLIT2].map((a) => [a, 'write']));
  await page.goto(`/p/${LOGS},${SPLIT}`);
  const tiles = page.getByTestId('tile');
  await expect(tiles).toHaveCount(2);
  await settled(page);
  await expect(page.locator('.mx-area')).toHaveAttribute('data-window-fit', '');
  await expect(tiles.nth(0)).toHaveAttribute('data-focused', '');
  // One fit for the window, through the first pane, with a layout naming
  // all three; the third is the stack at the right, 20 columns wide.
  await expect.poll(() => layoutsOf(resizes).length, { timeout: 8000 }).toBeGreaterThan(0);
  const fit = layoutsOf(resizes)[0].body;
  expect(fit.scope).toBe('window');
  expect(cells(String(fit.layout))).toHaveLength(3);
  expect(cells(String(fit.layout)).find((c) => c.id === id2)).toMatchObject({ w: 20 });
  expect(fitsOf(resizes, SPLIT)).toHaveLength(0);
  // The host has the two open panes as the layout says, side by side at
  // the window's height, and the third at the right.
  await expect
    .poll(
      async () => {
        const ps = await places(request, 'work:1');
        for (const c of cells(String(fit.layout))) {
          if (c.id === id2) continue;
          const p = ps.find((q) => q.id === c.id);
          if (!p || p.w !== c.w || p.h !== c.h) return `${c.id}: ${p?.w}x${p?.h} for ${c.w}x${c.h}`;
        }
        return 'ok';
      },
      { timeout: 8000 },
    )
    .toBe('ok');
  const ps = await places(request, 'work:1');
  const third = ps.find((p) => p.id === id2)!;
  expect(third.w).toBe(20);
  expect(third.x).toBeGreaterThan(Math.max(...ps.filter((p) => p.id !== id2).map((p) => p.x)));
  await expect(page.getByTestId('held')).toHaveCount(0);
  await expect(tiles.nth(0)).not.toHaveAttribute('data-held', '');
  await expect(tiles.nth(1)).not.toHaveAttribute('data-held', '');
  await shot(page, info, '99-some-fit');
  // The focus moves back and forth: nothing is sent, nothing is released.
  await page.waitForTimeout(1500);
  const sent = resizes.length;
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press(']');
    await expect(tiles.nth(1)).toHaveAttribute('data-focused', '');
    await page.keyboard.press('[');
    await expect(tiles.nth(0)).toHaveAttribute('data-focused', '');
  }
  await tiles.nth(1).locator('.mx-tile-head').click();
  await expect(tiles.nth(1)).toHaveAttribute('data-focused', '');
  await page.waitForTimeout(1500);
  expect(resizes).toHaveLength(sent);
  await expect(page.getByTestId('held')).toHaveCount(0);
  // Leaving the view releases the window, through the pane it was fitted by.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('panes')).toBeVisible();
  await expect.poll(() => releasesOf(resizes, LOGS).length, { timeout: 5000 }).toBe(1);
  expect(releasesOf(resizes, SPLIT)).toHaveLength(0);
});

test('99 two tiles of a window with a read-only pane share a width: the later fit sets both, the other says held and stays', async ({
  page,
  request,
}, info) => {
  // A pane split off the shell, then the window as main-horizontal: one
  // pane across the top, the other writable one and the read-only one in
  // the row below. The window is not the token's to lay out, so each
  // tile fits its own pane; stacked tiles ask the window's width of the
  // top pane, which spans it, and of the one below, which shares its row.
  const ro = await control(request, '/pane-id', { target: 'work:0.1' });
  const id = await split(request, 'work:0.0', 'h');
  await control(request, '/select-layout', { target: 'work:0', layout: 'main-horizontal' });
  const ps = await places(request, 'work:0');
  const top = ps.find((p) => p.y === 0)!;
  const below = ps.filter((p) => p.y > 0);
  expect(top.w).toBeGreaterThan(Math.max(...below.map((p) => p.w)));
  const other = below.find((p) => p.id !== ro)!;
  const roPlace = below.find((p) => p.id === ro)!;
  // Addresses follow position: the top pane first, then the row below.
  const TOP = `${HOST}/work/0.0`;
  const OTHER = other.x < roPlace.x ? `${HOST}/work/0.1` : `${HOST}/work/0.2`;
  const resizes = watchResizes(page);
  await signIn(page);
  await expect(page.getByTestId('pane-row').filter({ hasText: `${HOST}/work/0.2` })).toBeVisible({
    timeout: 10_000,
  });
  await page.goto(`/p/${TOP},${OTHER}`);
  const tiles = page.getByTestId('tile');
  await expect(tiles).toHaveCount(2);
  await settled(page);
  await expect(page.locator('.mx-area')).not.toHaveAttribute('data-window-fit', '');
  await page.keyboard.press('l');
  await expect(page.getByTestId('pane')).toHaveAttribute('data-layout', 'column');
  await expect.poll(() => fitsOf(resizes, TOP).length, { timeout: 8000 }).toBeGreaterThan(0);
  await expect.poll(() => fitsOf(resizes, OTHER).length, { timeout: 8000 }).toBeGreaterThan(0);
  expect(fitsOf(resizes, TOP)[0].body.scope).toBe('pane');
  expect(layoutsOf(resizes)).toHaveLength(0);
  await expect.poll(() => page.getByTestId('held').count(), { timeout: 10_000 }).toBe(1);
  const heldTile = page.locator('[data-testid="tile"][data-held]');
  await expect(heldTile).toHaveCount(1);
  // The held tile is scaled to its box, not cropped.
  await expect(
    heldTile.locator('[data-testid="screen"], [data-testid="cell-screen"]'),
  ).toHaveAttribute('data-font', /\d/);
  await shot(page, info, '99-held');
  // Nothing more is sent: not for the focus, not for the held tile.
  await page.waitForTimeout(2500);
  const sent = resizes.length;
  await page.keyboard.press(']');
  await page.keyboard.press('[');
  await page.keyboard.press(']');
  await page.waitForTimeout(1500);
  expect(resizes).toHaveLength(sent);
  await expect(heldTile).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('panes')).toBeVisible();
  await expect.poll(() => releasesOf(resizes, OTHER).length, { timeout: 5000 }).toBe(1);
  await expect.poll(() => releasesOf(resizes, TOP).length, { timeout: 5000 }).toBe(1);
  // The window as the other specs expect it: the two panes side by side.
  made.splice(made.indexOf(id), 1);
  await control(request, '/kill-pane', { target: id });
  await control(request, '/select-layout', { target: 'work:0', layout: 'even-horizontal' });
  await expect
    .poll(() => control(request, '/window-size', { target: 'work:0' }), { timeout: 8000 })
    .toBe('100x30');
});

test('99 a pane alone fits the window zoomed; a sibling opened beside it undoes the zoom; z is drawn', async ({
  page,
  request,
}) => {
  const id = await split(request, 'work:1.0', 'h');
  await split(request, id, 'h');
  const resizes = watchResizes(page);
  const zoomed = () => control(request, '/zoomed', { target: 'work:1' });
  await signIn(page);
  await expect(page.getByTestId('pane-row').filter({ hasText: SPLIT2 })).toBeVisible({
    timeout: 10_000,
  });
  await openPane(page, LOGS);
  await settled(page);
  await expect.poll(() => fitsOf(resizes, LOGS).length, { timeout: 5000 }).toBe(1);
  expect(fitsOf(resizes, LOGS)[0].body.scope).toBe('window');
  expect(fitsOf(resizes, LOGS)[0].body.zoom).toBe(true);
  await expect.poll(zoomed, { timeout: 5000 }).toBe('1');
  // The sibling opened beside: the window is fitted as one for the two,
  // the third stacked at the right, and the zoom is gone.
  await page.goto(`/p/${LOGS},${SPLIT}`);
  const tiles = page.getByTestId('tile');
  await expect(tiles).toHaveCount(2);
  await expect.poll(() => layoutsOf(resizes).length, { timeout: 8000 }).toBeGreaterThan(0);
  await expect.poll(zoomed, { timeout: 8000 }).toBe('0');
  expect(fitsOf(resizes, SPLIT)).toHaveLength(0);
  const fit = layoutsOf(resizes).at(-1)!.body;
  for (const a of [LOGS, SPLIT])
    await expect.poll(() => sizeOf(page, a), { timeout: 8000 }).toMatchObject({ rows: fit.rows });
  // z: the focused tile alone, drawn on the way, and back to its place.
  await page.keyboard.press('z');
  await expect(tiles).toHaveCount(1);
  await expect(page.locator('[data-testid="tile"][data-zooming]')).toHaveCount(0, {
    timeout: 3000,
  });
  await page.keyboard.press('z');
  await expect(tiles).toHaveCount(2);
  await expect(page.locator('[data-testid="tile"][data-zooming]')).toHaveCount(0, {
    timeout: 3000,
  });
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('panes')).toBeVisible();
  await expect
    .poll(() => releasesOf(resizes, LOGS).length, { timeout: 5000 })
    .toBeGreaterThanOrEqual(1);
});

test('99 a pane left for another keeps its size and comes back without a resize', async ({
  page,
  request,
}) => {
  const resizes = watchResizes(page);
  const size = () => control(request, '/window-size', { target: 'work:0' });
  const zoomed = () => control(request, '/zoomed', { target: 'work:0' });
  await signIn(page);
  // The splits of the tests before are gone from the listing.
  await expect(page.getByTestId('pane-row').filter({ hasText: SPLIT })).toHaveCount(0, {
    timeout: 15_000,
  });
  await openPane(page, SHELL0);
  await settled(page);
  await expect.poll(() => fitsOf(resizes, SHELL0).length, { timeout: 5000 }).toBe(1);
  const fit = fitsOf(resizes, SHELL0)[0].body;
  expect(fit.scope).toBe('window');
  expect(fit.zoom).toBe(true);
  await expect.poll(zoomed, { timeout: 5000 }).toBe('1');
  const fitted = `${fit.cols}x${fit.rows}`;
  await expect.poll(size).toBe(fitted);
  await expect(page.getByTestId('pane-size')).toHaveText(`${fit.cols}×${fit.rows}`);
  // ] shows the next pane of the strip in the tile; the first pane is not
  // released, and [ finds it zoomed at size: nothing is sent for it.
  await page.keyboard.press(']');
  await expect(page.getByTestId('pane')).toHaveAttribute('data-panes', `${HOST}/work/0.1`);
  await page.waitForTimeout(1500);
  expect(releasesOf(resizes, SHELL0)).toHaveLength(0);
  await page.keyboard.press('[');
  await expect(page.getByTestId('pane')).toHaveAttribute('data-panes', SHELL0);
  await expect(page.getByTestId('pane-size')).toHaveText(`${fit.cols}×${fit.rows}`);
  await page.waitForTimeout(1500);
  expect(fitsOf(resizes, SHELL0)).toHaveLength(1);
  expect(releasesOf(resizes, SHELL0)).toHaveLength(0);
  expect(await zoomed()).toBe('1');
  // Leaving the view releases: the window is tmux's again, unzoomed.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('panes')).toBeVisible();
  await expect.poll(() => releasesOf(resizes, SHELL0).length, { timeout: 5000 }).toBe(1);
  await expect.poll(zoomed, { timeout: 5000 }).toBe('0');
  await expect.poll(size, { timeout: 5000 }).toBe('100x30');
  // A pane alone in its window is fitted at window scope without a zoom.
  await openPane(page, LOGS);
  await expect.poll(() => fitsOf(resizes, LOGS).length, { timeout: 5000 }).toBe(1);
  expect(fitsOf(resizes, LOGS)[0].body.scope).toBe('window');
  expect(fitsOf(resizes, LOGS)[0].body.zoom).toBeUndefined();
  await expect.poll(() => control(request, '/zoomed', { target: 'work:1' })).toBe('0');
  await page.keyboard.press('Escape');
  await expect.poll(() => releasesOf(resizes, LOGS).length, { timeout: 5000 }).toBe(1);
});

test('99 a pane alone of a two-pane window, then both as tiles: the window fits as one, the zoom gone, nothing sent again', async ({
  page,
  request,
}) => {
  await split(request, 'work:1.0', 'h');
  const resizes = watchResizes(page);
  const zoomed = () => control(request, '/zoomed', { target: 'work:1' });
  await signIn(page);
  await expect(page.getByTestId('pane-row').filter({ hasText: SPLIT })).toBeVisible({
    timeout: 10_000,
  });
  await openPane(page, LOGS);
  await settled(page);
  await expect.poll(() => fitsOf(resizes, LOGS).length, { timeout: 5000 }).toBe(1);
  expect(fitsOf(resizes, LOGS)[0].body.zoom).toBe(true);
  await expect.poll(zoomed, { timeout: 5000 }).toBe('1');
  // The other pane opened beside: the window fits as one, laid out as the
  // tiles, and the zoom is gone.
  await page.goto(`/p/${LOGS},${SPLIT}`);
  const tiles = page.getByTestId('tile');
  await expect(tiles).toHaveCount(2);
  await expect(page.locator('.mx-area')).toHaveAttribute('data-window-fit', '', { timeout: 8000 });
  await expect.poll(() => layoutsOf(resizes).length, { timeout: 8000 }).toBeGreaterThan(0);
  await expect.poll(zoomed, { timeout: 8000 }).toBe('0');
  const fit = layoutsOf(resizes).at(-1)!.body;
  for (const a of [LOGS, SPLIT])
    await expect.poll(() => sizeOf(page, a), { timeout: 8000 }).toMatchObject({ rows: fit.rows });
  // Once it holds, nothing is sent again: no stale fit of the lone view
  // comes back, and the zoom stays gone.
  await page.waitForTimeout(2500);
  const sent = resizes.length;
  await page.waitForTimeout(3000);
  expect(resizes).toHaveLength(sent);
  expect(await zoomed()).toBe('0');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('panes')).toBeVisible();
  await expect
    .poll(() => control(request, '/window-size', { target: 'work:1' }), { timeout: 8000 })
    .toBe('100x30');
});
