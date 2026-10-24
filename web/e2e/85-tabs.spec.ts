import { expect, test } from '@playwright/test';
import { control, HOST, SHELL0, shot, signIn } from './fixtures';

const RO = `${HOST}/work/0.1`;
const LOGS = `${HOST}/work/1.0`;

test('85 the tab strip: every pane, a tab swaps into the focused tile, keys move focus', async ({
  page,
  request,
}, info) => {
  await signIn(page);
  await page.goto(`/p/${SHELL0},${LOGS}`);
  await expect(page.getByTestId('tile')).toHaveCount(2);
  // Every pane the token may read is a tab; the open ones are marked.
  const tabs = page.getByTestId('tab');
  await expect(tabs).toHaveCount(4);
  await expect(page.locator('[data-testid="tab"][data-open]')).toHaveCount(2);
  await expect(page.locator('[data-testid="tab"][data-focused]')).toHaveAttribute(
    'data-address',
    SHELL0,
  );
  // A click on a closed tab swaps it into the focused tile.
  await page.locator(`[data-testid="tab"][data-address="${RO}"]`).click();
  await expect(page.getByTestId('pane')).toHaveAttribute('data-panes', `${RO} ${LOGS}`);
  await expect(page.locator('[data-testid="tab"][data-focused]')).toHaveAttribute(
    'data-address',
    RO,
  );
  // ] moves the focus to the next tile; the input goes to it alone.
  await page.keyboard.press(']');
  await expect(page.locator('[data-testid="tile"][data-focused]')).toHaveAttribute(
    'data-pane',
    LOGS,
  );
  await expect(page.getByTestId('input')).toBeEnabled();
  const before = await control(request, '/capture', { target: 'work:0.1' });
  await page.getByTestId('input').fill('echo typed-in-$((80+5))');
  await page.getByTestId('input').press('Enter');
  await expect
    .poll(() => control(request, '/capture', { target: 'work:1.0' }), { timeout: 5000 })
    .toContain('typed-in-85');
  expect(await control(request, '/capture', { target: 'work:0.1' })).toBe(before);
  // Esc leaves the input line; } and { then show the neighbouring pane of
  // the strip in the focused tile:
  // whichever side of the strip the other closed pane is on.
  const order = await tabs.evaluateAll((els) => els.map((e) => e.getAttribute('data-address')));
  const other = order.find((a) => a !== RO && a !== LOGS && a !== SHELL0)!;
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('input')).not.toBeFocused();
  await page.keyboard.press(order.indexOf(other) > order.indexOf(LOGS) ? '}' : '{');
  await expect(page.getByTestId('pane')).toHaveAttribute('data-panes', `${RO} ${other}`);
  await shot(page, info, '85-tabs');
  // The header names the focused pane, and the way back leads to the list.
  await expect(page.getByTestId('crumb')).toContainText(other);
  await page.getByTestId('back').click();
  await expect(page.getByTestId('panes')).toBeVisible();
  // The window row is a button and opens the window view.
  const win = page.getByTestId('window-row').first();
  await expect(win).toContainText('mirror layout');
  await win.click();
  await expect(page).toHaveURL(new RegExp(`/w/${HOST}/work/0$`.replace(/\//g, '\\/')));
  await expect(page.getByTestId('window')).toBeVisible();
});
