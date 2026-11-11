import { expect, test } from '@playwright/test';
import { openPane, settled, SHELL0, shot, signIn } from './fixtures';

// A rate limit is not a toast: the page's edge flashes red-orange, once
// per burst, and nothing covers the pane. Other refusals stay toasts.
// The refusals are the hub's answers as the client sees them, played by
// the route, so the spec does not depend on tripping the hub's limit.

test('130 a rate limit flashes the page’s edge, once per burst; another refusal is a toast', async ({
  page,
}, info) => {
  await signIn(page);
  await openPane(page, SHELL0);
  await settled(page);
  const key = page.getByTestId('keybar').getByRole('button', { name: 'Enter', exact: true });
  let answers = 0;
  await page.route('**/v1/panes/**/input*', async (route) => {
    answers++;
    await route.fulfill({
      status: 429,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'rate_limited' }),
    });
  });
  // A burst of keys, every one refused: one flash, no toast.
  for (let i = 0; i < 4; i++) await key.click();
  await expect.poll(() => answers).toBe(4);
  await expect(page.locator('html')).toHaveAttribute('data-flash', '');
  await expect(page.locator('[data-testid="toast"][data-kind="refused"]')).toHaveCount(0);
  await shot(page, info, '130-flash');
  // The flash ends with the burst.
  await expect(page.locator('html')).not.toHaveAttribute('data-flash', '', { timeout: 4000 });
  // Another refusal says something, and is a toast as before.
  await page.unroute('**/v1/panes/**/input*');
  await page.route('**/v1/panes/**/input*', (route) =>
    route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'read_only' }),
    }),
  );
  await key.click();
  await expect(page.locator('[data-testid="toast"][data-kind="refused"]')).toContainText(
    'read-only',
  );
  await expect(page.locator('html')).not.toHaveAttribute('data-flash', '');
});
