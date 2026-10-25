import { expect, test } from '@playwright/test';
import { control, HOST, settled, signIn } from './fixtures';

const LOGS = `${HOST}/work/1.0`;
const SPLIT = `${HOST}/work/1.1`;

test('79 ] and [ with one tile come round at the ends of the strip', async ({ page }) => {
  await signIn(page);
  await page.goto(`/p/${LOGS}`);
  const tabs = page.getByTestId('tab');
  await expect(tabs.first()).toBeVisible();
  const order = await tabs.evaluateAll((els) => els.map((e) => e.getAttribute('data-address')));
  const last = order[order.length - 1]!;
  await page.goto(`/p/${last}`);
  await expect(page.getByTestId('pane')).toHaveAttribute('data-panes', last);
  await settled(page);
  await page.keyboard.press(']');
  await expect(page.getByTestId('pane')).toHaveAttribute('data-panes', order[0]!);
  await page.keyboard.press('[');
  await expect(page.getByTestId('pane')).toHaveAttribute('data-panes', last);
});

test('79 a pane that exits leaves the tiles by itself', async ({ page, request }) => {
  const id = await control(request, '/split', { target: 'work:1.0', dir: 'h' });
  await signIn(page);
  await expect(page.getByTestId('pane-row').filter({ hasText: SPLIT })).toBeVisible({
    timeout: 10_000,
  });
  await page.goto(`/p/${LOGS},${SPLIT}`);
  await expect(page.getByTestId('tile')).toHaveCount(2);
  await settled(page);
  await control(request, '/kill-pane', { target: id });
  // Without a key or a click: within the tile's own read interval.
  await expect(page.getByTestId('pane')).toHaveAttribute('data-panes', LOGS, { timeout: 4000 });
  await expect(page.getByTestId('gap')).toHaveCount(0);
  await expect(page.getByTestId('tile')).toHaveCount(1);
  // Leaving gives the window back, so the next spec finds it at rest.
  await page.goto('/');
  await expect
    .poll(() => control(request, '/window-size', { target: 'work:1' }), { timeout: 8000 })
    .toBe('100x30');
});
