import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { control, HOST, settled, shot, SHELL0, signIn } from './fixtures';

// Up to eight tiles: eight panes from two windows open side by side, ▦
// cycles the five presets over them, and with eight open a ninth pane's
// tab dropped on a tile's edge takes that tile's place. The window view
// arranges six panes too, on the host.

const LOGS = `${HOST}/work/1.0`;
const RO = `${HOST}/work/0.1`;

const tile = (page: Page, a: string) => page.locator(`[data-testid="tile"][data-pane="${a}"]`);
const tab = (page: Page, a: string) => page.locator(`[data-testid="tab"][data-address="${a}"]`);
const box = async (l: Locator) => (await l.boundingBox())!;

// The panes split off are killed after each test, newest first.
const made: string[] = [];
// Each split re-tiles the window, so the next one has room in it.
async function split(request: APIRequestContext, target: string, n: number) {
  for (let i = 0; i < n; i++) {
    made.push(await control(request, '/split', { target, dir: 'h' }));
    await control(request, '/select-layout', { target: target.split('.')[0], layout: 'tiled' });
  }
}
test.afterEach(async ({ request }) => {
  for (const id of made.splice(0).reverse()) await control(request, '/kill-pane', { target: id });
});

test('132 eight tiles from two windows: ▦ cycles the presets; a ninth dropped on an edge takes the place', async ({
  page,
  request,
}, info) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  // Seven panes of window 1 and the shell of window 0: two windows, so
  // the arrangement is the browser's own.
  await split(request, 'work:1.0', 6);
  await signIn(page);
  await expect(
    page.locator(`[data-testid="pane-row"][data-address="${HOST}/work/1.6"]`),
  ).toBeVisible({
    timeout: 10_000,
  });
  const eight = [SHELL0, LOGS, ...Array.from({ length: 6 }, (_, i) => `${HOST}/work/1.${i + 1}`)];
  await page.goto(`/p/${eight.join(',')}`);
  const tiles = page.getByTestId('tile');
  const pane = page.getByTestId('pane');
  await expect(tiles).toHaveCount(8);
  await settled(page);
  await expect(pane).toHaveAttribute('data-layout', 'row');
  await expect(page.getByTestId('arrange')).toBeEnabled();
  await expect(page.getByTestId('arrange')).toHaveAttribute(
    'title',
    /row, column, grid, main-left, main-top/,
  );
  const ys = async () =>
    new Set((await Promise.all(eight.map((a) => box(tile(page, a))))).map((b) => Math.round(b.y)));
  // A row: every tile at the same height.
  expect((await ys()).size).toBe(1);
  await shot(page, info, '132-row');
  for (const next of ['column', 'grid', 'main-left', 'main-top'] as const) {
    await page.keyboard.press('l');
    await expect(pane).toHaveAttribute('data-layout', next);
    await settled(page);
    if (next === 'column') expect((await ys()).size).toBe(8);
    // A grid of eight: two rows of four.
    if (next === 'grid') expect((await ys()).size).toBe(2);
    if (next === 'main-left') {
      const main = await box(tile(page, eight[0]));
      const rest = await box(tile(page, eight[1]));
      expect(main.height).toBeGreaterThan(rest.height * 3);
    }
    await shot(page, info, `132-${next}`);
  }
  // Eight open: a tile offers only its middle, and the tab of a pane not
  // open dropped on an edge takes that tile's place.
  const target = await box(tile(page, LOGS));
  await tab(page, RO).dragTo(tile(page, LOGS), {
    targetPosition: { x: target.width * 0.9, y: target.height / 2 },
  });
  await expect(tiles).toHaveCount(8);
  await expect(tile(page, RO)).toHaveAttribute('data-focused', '');
  await expect(tile(page, LOGS)).toHaveCount(0);
  await shot(page, info, '132-eight-open');
});

test('132 the window view with six panes: arrange is on and moves the panes on the host', async ({
  page,
  request,
}, info) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await split(request, 'work:1.0', 5);
  await signIn(page);
  await expect(
    page.locator(`[data-testid="pane-row"][data-address="${HOST}/work/1.5"]`),
  ).toBeVisible({
    timeout: 10_000,
  });
  await page.goto(`/w/${HOST}/work/1`);
  await expect(page.getByTestId('cell')).toHaveCount(6);
  await settled(page);
  await expect(page.getByTestId('arrange')).toBeEnabled();
  await expect(page.getByTestId('arrange')).toHaveAttribute(
    'title',
    /row, column, grid, main-left, main-top/,
  );
  // The fit of the window lands first; the arrangement waits its turn.
  await page.waitForTimeout(1500);
  const before = await control(request, '/layout', { target: 'work:1' });
  await page.keyboard.press('l');
  await expect
    .poll(() => control(request, '/layout', { target: 'work:1' }), { timeout: 10_000 })
    .not.toBe(before);
  await shot(page, info, '132-window-six');
});
