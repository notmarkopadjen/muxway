import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { join } from 'node:path';
import { control, HOST, settled, shot, signIn } from './fixtures';

const SCREENS = process.env.MX_SCREENS ?? 'screens';

// A tile shows its own pane or nothing: a second tile whose read is
// slow shows the CRT warm-up, never a line of the first pane; a pane
// that took a closed pane's address never shows the old pane's frame;
// and when the host renumbers, the tile of the pane that exited closes
// while the other tile follows its pane to the new address.

const LOGS = `${HOST}/work/1.0`;
const SPLIT = `${HOST}/work/1.1`;
const SPLIT2 = `${HOST}/work/1.2`;

// The panes this file splits off are killed after each test: the specs
// after it in the run match rows by text, and a window of ten and more
// panes makes `work/1.1` match `work/1.10` too.
const made: string[] = [];
async function split(request: APIRequestContext, target: string) {
  const id = await control(request, '/split', { target, dir: 'h' });
  made.push(id);
  return id;
}
test.afterEach(async ({ request }) => {
  for (const id of made.splice(0).reverse()) await control(request, '/kill-pane', { target: id });
});

const tile = (page: Page, a: string) => page.locator(`[data-pane="${a}"]`);
// The pane's screen, settled: the fit landed and the tile is not syncing.
async function settledTile(page: Page, a: string) {
  await expect(tile(page, a)).not.toHaveAttribute('data-syncing', '', { timeout: 15_000 });
}

test('124 a slow second tile warms up and never shows the first pane', async ({
  page,
  request,
}, info) => {
  await split(request, 'work:1.0');
  await control(request, '/send', { target: 'work:1.0', text: 'echo MARKER-A-7731' });
  await signIn(page);
  await expect(page.locator(`[data-testid="pane-row"][data-address="${SPLIT}"]`)).toBeVisible({
    timeout: 10_000,
  });
  await page.goto(`/p/${LOGS}`);
  await expect(tile(page, LOGS)).toContainText('MARKER-A-7731', { timeout: 10_000 });
  await settledTile(page, LOGS);
  // The second pane's reads are slow.
  await page.route(/\/v1\/panes\/[^/]+\/work\/1\.1\?/, async (route) => {
    await new Promise((r) => setTimeout(r, 2500));
    await route.continue();
  });
  await page.goto(`/p/${LOGS},${SPLIT}`);
  await expect(page.getByTestId('tile')).toHaveCount(2);
  const second = tile(page, SPLIT);
  const warm = second.getByTestId('warmup');
  await expect(warm).toHaveAttribute('data-warm', '1');
  expect(await warm.evaluate((el) => getComputedStyle(el).animationName)).toBe('mx-warmup');
  await settled(page);
  await expect(warm).toHaveAttribute('data-warm', '1');
  // Raw, animations running: the fixture's shot would jump the warm-up
  // to its end.
  await page.screenshot({
    path: join(SCREENS, info.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase(), '124-warm.png'),
  });
  // Through the delay, the second tile holds no line of the first.
  for (let i = 0; i < 8; i++) {
    expect(await second.textContent()).not.toContain('MARKER-A-7731');
    await page.waitForTimeout(100);
  }
  await expect(warm).toHaveAttribute('data-warm', '0', { timeout: 5000 });
  await expect(warm).toHaveCount(0, { timeout: 3000 });
  await expect(second).toContainText('$');
  await shot(page, info, '124-settled');
  // Effects off: the warm-up is not drawn, the tile is blank until its frame.
  await page.keyboard.press('m');
  await page.goto(`/p/${SPLIT}`);
  const alone = tile(page, SPLIT).getByTestId('warmup');
  await expect(alone).toHaveCount(1);
  expect(await alone.evaluate((el) => getComputedStyle(el).display)).toBe('none');
  await page.keyboard.press('m');
});

test("124 a pane at a closed pane's address never shows the old pane's frame", async ({
  page,
  request,
}, info) => {
  await split(request, 'work:1.0');
  await control(request, '/send', { target: 'work:1.1', text: 'echo MARKER-B-4455' });
  await signIn(page);
  await expect(page.locator(`[data-testid="pane-row"][data-address="${SPLIT}"]`)).toBeVisible({
    timeout: 10_000,
  });
  await page.goto(`/p/${SPLIT}`);
  await expect(tile(page, SPLIT)).toContainText('MARKER-B-4455', { timeout: 10_000 });
  await settledTile(page, SPLIT);
  await settled(page);
  await page.goto('/');
  await expect(page.locator(`[data-testid="pane-row"][data-address="${SPLIT}"]`)).toBeVisible();
  // The pane goes and another takes its address (the window may hold
  // more panes from earlier specs, so the address is taken at once by
  // the next one; either way a different pane answers there).
  const old = await control(request, '/pane-id', { target: 'work:1.1' });
  await control(request, '/kill-pane', { target: 'work:1.1' });
  await split(request, 'work:1.0');
  await expect
    .poll(() => control(request, '/pane-id', { target: 'work:1.1' }), { timeout: 10_000 })
    .not.toBe(old);
  await page.waitForTimeout(1500);
  await page.goto(`/p/${SPLIT}`);
  await expect(page.getByTestId('tile')).toHaveCount(1);
  for (let i = 0; i < 15; i++) {
    expect(await tile(page, SPLIT).textContent()).not.toContain('MARKER-B-4455');
    await page.waitForTimeout(100);
  }
  await expect(tile(page, SPLIT)).toContainText('$', { timeout: 10_000 });
  await shot(page, info, '124-reused');
});

test("124 when the host renumbers, the exited pane's tile closes and the other follows its pane", async ({
  page,
  request,
}, info) => {
  await split(request, 'work:1.0');
  await split(request, 'work:1.1');
  await control(request, '/send', { target: 'work:1.2', text: 'echo MARKER-C-9900' });
  await signIn(page);
  await expect(page.locator(`[data-testid="pane-row"][data-address="${SPLIT2}"]`)).toBeVisible({
    timeout: 10_000,
  });
  await page.goto(`/p/${SPLIT},${SPLIT2}`);
  await expect(page.getByTestId('tile')).toHaveCount(2);
  await expect(tile(page, SPLIT2)).toContainText('MARKER-C-9900', { timeout: 10_000 });
  await settled(page);
  // The first pane exits: tmux renumbers the second to its address.
  await control(request, '/kill-pane', { target: 'work:1.1' });
  await expect(page.getByTestId('toast').filter({ hasText: 'is gone' })).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByTestId('tile')).toHaveCount(1, { timeout: 10_000 });
  await expect(page.getByTestId('tile')).toHaveAttribute('data-pane', SPLIT, { timeout: 10_000 });
  await expect(page).toHaveURL(new RegExp(`/p/${SPLIT.replace(/[/.]/g, '\\$&')}$`));
  await expect(tile(page, SPLIT)).toContainText('MARKER-C-9900');
  await shot(page, info, '124-followed');
});
