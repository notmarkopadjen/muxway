import { expect, test, type Page } from '@playwright/test';
import { control, HOST, paneLoaded, settled, shot, SHELL0, signIn } from './fixtures';

// The strip in the owner's order: a tab dragged along it keeps its place
// across a reload, { and } move the focused one, the rest follow the
// listing; the window view keeps the host's order.

const RO = `${HOST}/work/0.1`;
const LOGS = `${HOST}/work/1.0`;

const tab = (page: Page, a: string) => page.locator(`[data-testid="tab"][data-address="${a}"]`);
const order = (page: Page) =>
  page
    .locator('[data-testid="tabs"] [data-testid="tab"]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-address')));
const first3 = async (page: Page) => (await order(page)).slice(0, 3);

test('106 a tab dragged along the strip keeps its place across a reload; { } move the focused one', async ({
  page,
  request,
}, info) => {
  await signIn(page);
  await page.goto(`/p/${SHELL0}`);
  await paneLoaded(page);
  await settled(page);
  await expect.poll(() => first3(page)).toEqual([SHELL0, RO, LOGS]);
  // The logs tab onto the left half of the first tab: it goes first.
  const box = (await tab(page, SHELL0).boundingBox())!;
  await tab(page, LOGS).dragTo(tab(page, SHELL0), { targetPosition: { x: 4, y: box.height / 2 } });
  await expect.poll(() => first3(page)).toEqual([LOGS, SHELL0, RO]);
  await shot(page, info, '106-reorder-dragged');
  await page.reload();
  await paneLoaded(page);
  await settled(page);
  await expect.poll(() => first3(page)).toEqual([LOGS, SHELL0, RO]);
  await shot(page, info, '106-reorder-kept');
  // ] and [ walk the strip as it is now.
  await page.keyboard.press(']');
  await expect(tab(page, RO)).toHaveAttribute('data-focused', '');
  await page.keyboard.press('[');
  await page.keyboard.press('[');
  await expect(tab(page, LOGS)).toHaveAttribute('data-focused', '');
  // } moves the focused tab right, { back; nothing past the ends.
  await page.keyboard.press('}');
  await expect.poll(() => first3(page)).toEqual([SHELL0, LOGS, RO]);
  await page.keyboard.press('}');
  await expect.poll(() => first3(page)).toEqual([SHELL0, RO, LOGS]);
  await page.keyboard.press('{');
  await page.keyboard.press('{');
  await page.keyboard.press('{');
  await expect.poll(() => first3(page)).toEqual([LOGS, SHELL0, RO]);
  // A drop outside the strip changes nothing.
  await tab(page, RO).dragTo(page.getByTestId('screen'));
  await expect.poll(() => first3(page)).toEqual([LOGS, SHELL0, RO]);
  // A new pane on the host comes last; the dragged ones keep their places.
  const before = await order(page);
  const id = await control(request, '/split', { target: 'work:1.0' });
  await expect.poll(() => order(page), { timeout: 10_000 }).toHaveLength(before.length + 1);
  const now = await order(page);
  expect(now.slice(0, 3)).toEqual([LOGS, SHELL0, RO]);
  expect(now[now.length - 1]).toBe(`${HOST}/work/1.1`);
  await shot(page, info, '106-reorder-new-pane');
  await control(request, '/kill-pane', { target: id });
  await expect.poll(() => order(page), { timeout: 10_000 }).toEqual(before);
  // The window view lists the window's panes in the host's order.
  await page.goto(`/w/${HOST}/work/0`);
  await expect(page.getByTestId('window')).toBeVisible();
  await expect.poll(() => order(page)).toEqual([SHELL0, RO]);
});

test('106 security: garbage in the stored order is ignored', async ({ page }) => {
  await signIn(page);
  for (const bad of [
    '{"x":',
    '42',
    JSON.stringify([{ address: SHELL0 }]),
    JSON.stringify([LOGS, 7]),
    JSON.stringify(['x'.repeat(300)]),
    'x'.repeat(100_000),
  ]) {
    await page.evaluate((v) => localStorage.setItem('mx-tab-order', v), bad);
    await page.goto(`/p/${SHELL0}`);
    await expect(page.getByTestId('pane')).toBeVisible({ timeout: 15_000 });
    await paneLoaded(page);
    await expect(page.getByTestId('toast').filter({ hasText: 'is gone' })).toHaveCount(0);
    await expect.poll(() => first3(page)).toEqual([SHELL0, RO, LOGS]);
    await page.goto('/');
  }
});
