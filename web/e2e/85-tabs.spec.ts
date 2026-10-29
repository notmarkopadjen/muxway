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
  // The listing is read every five seconds; under the full suite's load
  // the first one can be short of a host.
  await expect(tabs).toHaveCount(4, { timeout: 15_000 });
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
  // With one tile open, ] and [ show the strip's neighbouring pane in it.
  // Esc leaves the input line first.
  const order = await tabs.evaluateAll((els) => els.map((e) => e.getAttribute('data-address')));
  const at = order.indexOf(RO);
  const other = (order[at + 1] ?? order[at - 1])!;
  await page.getByTestId('input').focus();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('input')).not.toBeFocused();
  await page.keyboard.press('x');
  await expect(page.getByTestId('pane')).toHaveAttribute('data-panes', RO);
  await page.keyboard.press(order.indexOf(other) > at ? ']' : '[');
  await expect(page.getByTestId('pane')).toHaveAttribute('data-panes', other);
  // Shift+click on a closed tab opens it beside instead of swapping it in.
  await page.locator(`[data-testid="tab"][data-address="${RO}"]`).click({ modifiers: ['Shift'] });
  await expect(page.getByTestId('pane')).toHaveAttribute('data-panes', `${other} ${RO}`);
  await expect(page.getByTestId('tile')).toHaveCount(2);
  await expect(page.getByTestId('arrange')).toBeVisible();
  await page.keyboard.press('2');
  await page.keyboard.press('x');
  await expect(page.getByTestId('pane')).toHaveAttribute('data-panes', other);
  await shot(page, info, '85-tabs');
  // The focused tab names the pane, and the brand leads back to the list.
  await expect(page.locator('[data-testid="tab"][data-focused]')).toHaveAttribute(
    'data-address',
    other,
  );
  await page.getByTestId('back').click();
  await expect(page.getByTestId('panes')).toBeVisible();
  // The window row is a button and opens the window view.
  const win = page.getByTestId('window-row').first();
  await expect(win).toContainText('mirror layout');
  await win.click();
  await expect(page).toHaveURL(new RegExp(`/w/${HOST}/work/0$`.replace(/\//g, '\\/')));
  await expect(page.getByTestId('window')).toBeVisible();
});
