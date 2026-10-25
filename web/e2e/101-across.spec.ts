import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { control, HOST, settled, shot, signIn, SHELL0 } from './fixtures';

// Laying a tile across: a header dropped on a divider spans that split, on
// the side of the divider's half it was dropped on; a click on the strip
// inside a tile's inner edge, or e / E, spans the whole view.

const RO = `${HOST}/work/0.1`;
const LOGS = `${HOST}/work/1.0`;
const box = async (l: Locator) => (await l.boundingBox())!;

// Leaving gives the windows back, so the next spec finds them at rest.
async function leave(page: Page, request: APIRequestContext) {
  await page.waitForTimeout(1500);
  await page.goto('/');
  for (const target of ['work:0', 'work:1'])
    await expect
      .poll(() => control(request, '/window-size', { target }), { timeout: 8000 })
      .toBe('100x30');
}

test('101 a header dropped on a divider lays the pane across the split', async ({
  page,
  request,
}, info) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await signIn(page);
  await page.goto(`/p/${SHELL0},${RO},${LOGS}`);
  const tile = (a: string) => page.locator(`[data-testid="tile"][data-pane="${a}"]`);
  await expect(page.getByTestId('tile')).toHaveCount(3);
  await settled(page);
  await expect(page.getByTestId('pane')).toHaveAttribute('data-layout', 'row');
  // Grab LOGS's header and hold it over the lower half of the divider
  // between SHELL0 and RO: the lower half of the view lights up.
  const divider = page.getByTestId('divider').first();
  const d = await box(divider);
  await tile(LOGS)
    .locator('.mx-tile-head')
    .hover({ position: { x: 40, y: 6 } });
  await page.mouse.down();
  // Two moves: the first starts the drag, the second is over the divider.
  await divider.hover({ position: { x: d.width / 2, y: d.height * 0.8 }, force: true });
  await divider.hover({ position: { x: d.width / 2, y: d.height * 0.8 + 4 }, force: true });
  await expect(page.getByTestId('across')).toHaveClass(/mx-across-v-last/);
  await expect(divider).toHaveClass(/mx-divider-drop/);
  await shot(page, info, '101-divider-hover');
  await page.mouse.up();
  await expect(page.getByTestId('pane')).toHaveAttribute('data-layout', 'custom');
  const area = await box(page.locator('.mx-area'));
  const a = await box(tile(SHELL0));
  const b = await box(tile(RO));
  const c = await box(tile(LOGS));
  // SHELL0 and RO side by side on top, LOGS across the whole width below.
  expect(Math.abs(a.y - b.y)).toBeLessThan(4);
  expect(c.y).toBeGreaterThan(a.y + a.height - 4);
  expect(c.width).toBeGreaterThan(area.width - 12);
  await expect(page.getByTestId('across')).toHaveCount(0);
  await shot(page, info, '101-across');
  await leave(page, request);
});

test('101 the strip inside a tile edge and e / E lay it across the whole view', async ({
  page,
  request,
}, info) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await signIn(page);
  await page.goto(`/p/${SHELL0},${RO},${LOGS}`);
  const tile = (a: string) => page.locator(`[data-testid="tile"][data-pane="${a}"]`);
  await expect(page.getByTestId('tile')).toHaveCount(3);
  await settled(page);
  // In a row the first tile has an inner right edge only, and no strip on
  // the view's own edges.
  await expect(tile(SHELL0).getByTestId('edge-right')).toHaveCount(1);
  await expect(tile(SHELL0).getByTestId('edge-left')).toHaveCount(0);
  await expect(tile(SHELL0).getByTestId('edge-top')).toHaveCount(0);
  await expect(tile(RO).getByTestId('edge-left')).toHaveCount(1);
  const strip = tile(SHELL0).getByTestId('edge-right');
  await strip.hover();
  expect(await strip.evaluate((el) => getComputedStyle(el).cursor)).toBe('e-resize');
  await expect.poll(() => strip.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
  await expect(strip).toHaveAttribute('data-label', 'across');
  await shot(page, info, '101-edge');
  await strip.click();
  await expect(page.getByTestId('pane')).toHaveAttribute('data-layout', 'custom');
  const area = await box(page.locator('.mx-area'));
  const a = await box(tile(SHELL0));
  expect(a.width).toBeGreaterThan(area.width - 12);
  // Its middle was at the middle: it goes below the others.
  expect(a.y).toBeGreaterThan((await box(tile(RO))).y + 4);
  // Across already: no strips left or right on it any more.
  await expect(tile(SHELL0).getByTestId('edge-right')).toHaveCount(0);
  await expect(tile(SHELL0).getByTestId('edge-top')).toHaveCount(1);
  // E on the focused tile (SHELL0) lays it down the whole height instead.
  await page.keyboard.press('E');
  const tall = await box(tile(SHELL0));
  expect(tall.height).toBeGreaterThan(area.height - 12);
  expect(tall.width).toBeLessThan(area.width / 2 + 12);
  // e brings it across again.
  await page.keyboard.press('e');
  expect((await box(tile(SHELL0))).width).toBeGreaterThan(area.width - 12);
  await leave(page, request);
});
