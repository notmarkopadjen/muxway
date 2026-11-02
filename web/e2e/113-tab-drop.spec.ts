import { expect, test, type Locator, type Page } from '@playwright/test';
import { control, HOST, paneLoaded, settled, shot, SHELL0, signIn } from './fixtures';

// A tab dragged from the strip onto the view lays its pane out as a
// header does. With one tile open, the right part of its screen makes
// two columns and the lower part two rows, the dropped pane there and
// focused. A pane not open dropped on a tile's middle takes its place;
// the tab of an open tile swaps the two; with four open an edge is the
// middle too; a divider lays the pane across its split. The hub hears
// nothing of it but the new tile's fit.

const RO = `${HOST}/work/0.1`;
const LOGS = `${HOST}/work/1.0`;
const BOB = 'bob-desktop/work/0.0';

const tab = (page: Page, a: string) => page.locator(`[data-testid="tab"][data-address="${a}"]`);
const tile = (page: Page, a: string) => page.locator(`[data-testid="tile"][data-pane="${a}"]`);
const box = async (l: Locator) => (await l.boundingBox())!;
// The tiles of a new count power on with a transition: measure once they
// have landed.
const placed = (cond: () => Promise<boolean>) => expect.poll(cond, { timeout: 5000 }).toBe(true);
const url = (...panes: string[]) => new RegExp(`/p/${panes.join(',')}$`.replace(/\//g, '\\/'));

test('113 a tab dropped on a tile splits its place or takes it; on a divider, across', async ({
  page,
  request,
}, info) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await signIn(page);
  await page.goto(`/p/${SHELL0}`);
  await paneLoaded(page);
  await settled(page);
  const pane = page.getByTestId('pane');
  // Only reads, and the fit of the pane that comes in, reach the hub.
  const posts: string[] = [];
  page.on('request', (r) => {
    if (r.method() !== 'GET' && r.url().includes('/v1/')) posts.push(r.url());
  });
  // One tile: the logs tab on the right part of it makes two columns.
  let target = await box(tile(page, SHELL0));
  await tab(page, LOGS).dragTo(tile(page, SHELL0), {
    targetPosition: { x: target.width * 0.9, y: target.height / 2 },
  });
  await expect(page.getByTestId('tile')).toHaveCount(2);
  await expect(page).toHaveURL(url(SHELL0, LOGS));
  await expect(pane).toHaveAttribute('data-layout', 'custom');
  await expect(tile(page, LOGS)).toHaveAttribute('data-focused', '');
  await placed(async () => {
    const a = await box(tile(page, SHELL0));
    const b = await box(tile(page, LOGS));
    return b.x > a.x + a.width / 2 && Math.abs(a.y - b.y) < 4 && Math.abs(a.width - b.width) < 6;
  });
  await shot(page, info, '113-tab-right');
  await expect.poll(() => posts.filter((u) => !u.includes('/resize'))).toEqual([]);
  // The tab of an open tile on the other's middle swaps the two.
  await tab(page, LOGS).dragTo(tile(page, SHELL0));
  await expect(pane).toHaveAttribute('data-panes', `${LOGS} ${SHELL0}`);
  await expect(page).toHaveURL(url(LOGS, SHELL0));
  // A pane not open on a tile's middle takes its place: two tiles still.
  await tab(page, RO).dragTo(tile(page, SHELL0));
  await expect(pane).toHaveAttribute('data-panes', `${LOGS} ${RO}`);
  await expect(page.getByTestId('tile')).toHaveCount(2);
  await expect(tile(page, RO)).toHaveAttribute('data-focused', '');
  // A drop on the tile's own tab's tile changes nothing.
  await tab(page, RO).dragTo(tile(page, RO));
  await expect(pane).toHaveAttribute('data-panes', `${LOGS} ${RO}`);
  // One tile again: the lower part of it makes two rows.
  await page.goto(`/p/${SHELL0}`);
  await paneLoaded(page);
  await settled(page);
  await expect(page.getByTestId('tile')).toHaveCount(1);
  target = await box(tile(page, SHELL0));
  await tab(page, LOGS).dragTo(tile(page, SHELL0), {
    targetPosition: { x: target.width / 2, y: target.height * 0.9 },
  });
  await expect(page.getByTestId('tile')).toHaveCount(2);
  await expect(pane).toHaveAttribute('data-layout', 'custom');
  await placed(async () => {
    const a = await box(tile(page, SHELL0));
    const b = await box(tile(page, LOGS));
    return b.y > a.y + a.height / 2 && Math.abs(a.x - b.x) < 4;
  });
  await shot(page, info, '113-tab-below');
  // The ro tab held over the left half of the divider between the rows:
  // the pane goes down the whole height, at the left.
  const divider = page.getByTestId('divider').first();
  const d = await box(divider);
  await tab(page, RO).hover();
  await page.mouse.down();
  // Two moves: the first starts the drag, the second is over the divider.
  await divider.hover({ position: { x: d.width * 0.2, y: d.height / 2 }, force: true });
  await divider.hover({ position: { x: d.width * 0.2 + 4, y: d.height / 2 }, force: true });
  await expect(page.getByTestId('across')).toHaveClass(/mx-across-h-first/);
  await page.mouse.up();
  await expect(page.getByTestId('tile')).toHaveCount(3);
  await expect(page).toHaveURL(url(SHELL0, LOGS, RO));
  const area = await box(page.locator('.mx-area'));
  await placed(async () => {
    const a = await box(tile(page, SHELL0));
    const c = await box(tile(page, RO));
    return c.x < a.x && c.height > area.height - 12;
  });
  await expect(tile(page, RO)).toHaveAttribute('data-focused', '');
  await shot(page, info, '113-tab-divider');
  // Four open: a tile offers only its middle, and a tab dropped on an
  // edge takes that tile's place.
  await tab(page, BOB).dragTo(tile(page, RO), { targetPosition: { x: 20, y: 60 } });
  await expect(page.getByTestId('tile')).toHaveCount(4);
  const id = await control(request, '/split', { target: 'work:1.0' });
  const fifth = `${HOST}/work/1.1`;
  await expect(tab(page, fifth)).toBeVisible({ timeout: 10_000 });
  target = await box(tile(page, SHELL0));
  await tab(page, fifth).dragTo(tile(page, SHELL0), {
    targetPosition: { x: target.width * 0.9, y: target.height / 2 },
  });
  await expect(page.getByTestId('tile')).toHaveCount(4);
  await expect(tile(page, fifth)).toHaveAttribute('data-focused', '');
  await expect(tile(page, SHELL0)).toHaveCount(0);
  await shot(page, info, '113-four-open');
  await expect.poll(() => posts.filter((u) => !u.includes('/resize'))).toEqual([]);
  // Leave the window as the other specs expect it.
  await control(request, '/kill-pane', { target: id });
  await expect(page.getByTestId('tile')).toHaveCount(3, { timeout: 8000 });
  await page.goto('/');
  await expect(page.getByTestId('panes')).toBeVisible();
  await expect
    .poll(() => control(request, '/window-size', { target: 'work:1' }), { timeout: 8000 })
    .toBe('100x30');
});
