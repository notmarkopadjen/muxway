import { expect, test, type Locator, type Page } from '@playwright/test';
import { control, HOST, paneLoaded, settled, shot, SHELL0, signIn } from './fixtures';

// Nothing scrolls sideways: the add menu and the go-to list cut a long
// name or place with an ellipsis, and a tile's screen shows no bar for
// a line as wide as the pane or wider, since the cell it measures is
// the cell it draws and the box clips the rest.

const LOGS = `${HOST}/work/1.0`;
// A pane without an alias: a long title shows on its tab.
const OTHER = `${HOST}/work/0.1`;
const tile = (page: Page, a: string) => page.locator(`[data-testid="tile"][data-pane="${a}"]`);
const fits = (l: Locator) => l.evaluate((el) => el.scrollWidth <= el.clientWidth);

test('114 the add menu and the go-to list never scroll sideways', async ({
  page,
  request,
}, info) => {
  const long = `wide ${'x'.repeat(160)} title`;
  await control(request, '/rename', { what: 'title', target: 'work:0.1', name: long });
  await signIn(page);
  await page.goto(`/p/${SHELL0}`);
  await paneLoaded(page);
  await settled(page);
  await expect(page.locator(`[data-testid="tab"][data-address="${OTHER}"]`)).toContainText('wide', {
    timeout: 10_000,
  });
  await page.getByTestId('add').click();
  const menu = page.getByTestId('add-menu');
  await expect(menu.locator(`[data-testid="add-pane"][data-address="${OTHER}"]`)).toBeVisible();
  expect(await fits(menu)).toBe(true);
  const vw = await page.evaluate(() => document.documentElement.clientWidth);
  expect((await menu.boundingBox())!.width).toBeLessThan(vw);
  await shot(page, info, '114-add-menu');
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await page.keyboard.press('p');
  const list = page.locator('.mx-palette-list');
  await expect(page.getByTestId('palette-row').filter({ hasText: 'wide' })).toBeVisible();
  expect(await fits(list)).toBe(true);
  for (const row of await page.getByTestId('palette-row').all()) expect(await fits(row)).toBe(true);
  await shot(page, info, '114-go-to');
  await page.keyboard.press('Escape');
  await control(request, '/rename', { what: 'title', target: 'work:0.1', name: '' });
});

test('114 tiles side by side show no bar for a line as wide as the pane', async ({
  page,
  request,
}, info) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await signIn(page);
  await page.goto(`/p/${SHELL0},${LOGS}`);
  await expect(page.getByTestId('tile')).toHaveCount(2);
  await settled(page);
  await expect(page.getByTestId('pane')).toHaveAttribute('data-layout', 'row');
  for (const a of [SHELL0, LOGS]) await expect(tile(page, a)).toHaveAttribute('data-fit', '1');
  await expect(page.getByTestId('syncing')).toHaveCount(0, { timeout: 10_000 });
  const screen = (a: string) => tile(page, a).locator('.mx-screen');
  const measure = (a: string) =>
    screen(a).evaluate((node) => {
      const el = node as HTMLElement;
      const cs = getComputedStyle(el);
      const border = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
      return {
        wide: el.scrollWidth - el.clientWidth,
        // A horizontal bar would take height between the border and the inside.
        bar: el.offsetHeight - el.clientHeight - border,
        overflowX: cs.overflowX,
      };
    });
  // A line of the pane's full width in each: the cell measured is the
  // cell drawn, so it fits without a pixel to spare and no bar.
  for (const t of ['work:0.0', 'work:1.0'])
    await control(request, '/send', {
      target: t,
      text: `cols=$(stty size | cut -d' ' -f2); printf '%*s\\n' "$cols" '' | tr ' ' '='; echo full-width-114`,
    });
  for (const a of [SHELL0, LOGS]) {
    await expect(tile(page, a).locator('.mx-screen')).toContainText('full-width-114', {
      timeout: 8000,
    });
    const m = await measure(a);
    expect(m.overflowX, a).toBe('hidden');
    expect(m.wide, `${a}: content wider than its box`).toBeLessThanOrEqual(0);
    expect(m.bar, `${a}: a horizontal bar`).toBe(0);
  }
  // A line of box glyphs, which a fallback font may draw wider than the
  // cell: clipped, still no bar.
  for (const t of ['work:0.0', 'work:1.0'])
    await control(request, '/send', {
      target: t,
      text: `cols=$(stty size | cut -d' ' -f2); printf '%*s\\n' "$cols" '' | sed 's/ /─/g'; echo glyphs-114`,
    });
  for (const a of [SHELL0, LOGS]) {
    await expect(tile(page, a).locator('.mx-screen')).toContainText('glyphs-114', {
      timeout: 8000,
    });
    expect((await measure(a)).bar, `${a}: a horizontal bar`).toBe(0);
  }
  await shot(page, info, '114-tiles');
  for (const t of ['work:0.0', 'work:1.0'])
    await control(request, '/send', { target: t, text: 'clear' });
  await page.goto('/');
  await expect(page.getByTestId('panes')).toBeVisible();
});
