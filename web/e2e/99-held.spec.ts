import { expect, test, type Page } from '@playwright/test';
import { control, HOST, openPane, SHELL0, settled, shot, signIn } from './fixtures';

// Tiles that are every pane of one window fit the window as one; tiles of
// a window not wholly open share one fit; a pane alone fits its window
// with the pane zoomed; a pane left for another stays at size and comes
// back without a resize.

const LOGS = `${HOST}/work/1.0`;
const SPLIT = `${HOST}/work/1.1`;
const SPLIT2 = `${HOST}/work/1.2`;

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

test('99 every pane of a window as tiles: the window fits as one, laid out as the tiles', async ({
  page,
  request,
}, info) => {
  const id = await control(request, '/split', { target: 'work:1.0', dir: 'h' });
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
  expect(String(fit.layout)).toMatch(
    /^[0-9a-f]{4},1000x1000,0,0\{\d+x1000,0,0,\d+,\d+x1000,0,0,\d+\}$/,
  );
  await expect.poll(size, { timeout: 5000 }).toBe(`${fit.cols}x${fit.rows}`);
  await page.waitForTimeout(1500);
  expect(fitsOf(resizes, SPLIT)).toHaveLength(0);
  // Each pane is its tile: the two share the window's width, side by side.
  const sizes = await Promise.all(
    [LOGS, SPLIT].map((a) => page.locator(`[data-pane="${a}"] .mx-tile-head .mx-dim`).innerText()),
  );
  const cols = sizes.map((t) => Number(/(\d+)×/.exec(t)![1]));
  expect(cols[0] + cols[1] + 1).toBe(Number(fit.cols));
  expect(Math.abs(cols[0] - cols[1])).toBeLessThanOrEqual(1);
  await shot(page, info, '99-window');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('panes')).toBeVisible();
  await expect.poll(() => releasesOf(resizes, LOGS).length, { timeout: 5000 }).toBe(1);
  await expect.poll(size, { timeout: 5000 }).toBe('100x30');
  await control(request, '/kill-pane', { target: id });
});

test('99 two tiles of a window not wholly open: the focused one fits, the other is held; focus moves the fit', async ({
  page,
  request,
}, info) => {
  const id = await control(request, '/split', { target: 'work:1.0', dir: 'h' });
  const id2 = await control(request, '/split', { target: 'work:1.0', dir: 'v' });
  const resizes = watchResizes(page);
  await signIn(page);
  await expect(page.getByTestId('pane-row').filter({ hasText: SPLIT2 })).toBeVisible({
    timeout: 10_000,
  });
  await page.goto(`/p/${LOGS},${SPLIT}`);
  const tiles = page.getByTestId('tile');
  await expect(tiles).toHaveCount(2);
  await settled(page);
  await expect(page.locator('.mx-area')).not.toHaveAttribute('data-window-fit', '');
  await expect(tiles.nth(0)).toHaveAttribute('data-focused', '');
  await expect(tiles.nth(0)).toHaveAttribute('data-fit', '1');
  await expect(tiles.nth(0)).not.toHaveAttribute('data-held', '');
  await expect(tiles.nth(1)).toHaveAttribute('data-held', '');
  await expect(tiles.nth(1).getByTestId('held')).toHaveText('held');
  await expect.poll(() => fitsOf(resizes, LOGS).length, { timeout: 5000 }).toBe(1);
  expect(fitsOf(resizes, LOGS)[0].body.scope).toBe('pane');
  await page.waitForTimeout(1500);
  expect(fitsOf(resizes, SPLIT)).toHaveLength(0);
  // The held tile is scaled to its box, not cropped.
  await expect(tiles.nth(1).getByTestId('cell-screen')).toHaveAttribute('data-font', /\d/);
  await shot(page, info, '99-held');
  // Focus on the other tile moves the fit: the first is released, the second fits.
  await page.keyboard.press(']');
  await expect(tiles.nth(1)).toHaveAttribute('data-focused', '');
  await expect(tiles.nth(0)).toHaveAttribute('data-held', '');
  await expect(tiles.nth(1)).not.toHaveAttribute('data-held', '');
  await expect.poll(() => releasesOf(resizes, LOGS).length, { timeout: 5000 }).toBe(1);
  await expect.poll(() => fitsOf(resizes, SPLIT).length, { timeout: 5000 }).toBe(1);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('panes')).toBeVisible();
  await expect.poll(() => releasesOf(resizes, SPLIT).length, { timeout: 5000 }).toBe(1);
  await control(request, '/kill-pane', { target: id2 });
  await control(request, '/kill-pane', { target: id });
});

test('99 a pane alone fits the window zoomed; left for another it keeps its size and comes back without a resize', async ({
  page,
  request,
}) => {
  const resizes = watchResizes(page);
  const size = () => control(request, '/window-size', { target: 'work:0' });
  const zoomed = () => control(request, '/zoomed', { target: 'work:0' });
  await signIn(page);
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
