import { expect, test } from '@playwright/test';
import { control, HOST, openPane, SHELL0, shot, signIn } from './fixtures';
import { closeMade, otherPane } from './talk';

// The parity pass of 2026-11-04: the web follows its own table where it
// had drifted. Idle is z, as on Android and the keypad phone; the help
// overlay lists what is bound and nothing else; in the window view one
// press of + opens the add menu and leaves the cell's size alone.

test.afterEach(async ({ request }) => closeMade(request));

const badgeOf = (page: import('@playwright/test').Page, address: string) =>
  page.locator(`[data-address="${address}"] [data-testid="badge"]`).first();

test('120 idle is z on the list row, the tab and the inbox row', async ({
  page,
  request,
}, info) => {
  const other = await otherPane(request);
  await control(request, '/notify', { pane: other.id, kind: 'idle', text: 'waiting for you' });
  await signIn(page);
  const row = badgeOf(page, other.address);
  await expect(row).toHaveAttribute('data-kind', 'idle', { timeout: 10_000 });
  await expect(row).toHaveText('z');
  await shot(page, info, 'idle-row');
  await openPane(page, SHELL0);
  const tab = page.locator(
    `[data-testid="tab"][data-address="${other.address}"] [data-testid="badge"]`,
  );
  await expect(tab).toHaveText('z', { timeout: 10_000 });
  await page.keyboard.press('I');
  const inbox = page.locator(`[data-testid="inbox-row"][data-address="${other.address}"]`);
  await expect(inbox).toBeVisible();
  await expect(inbox.getByTestId('badge')).toHaveText('z');
  await shot(page, info, 'idle-inbox');
  await page.keyboard.press('Escape');
});

test('120 the help overlay lists g, e / E and = for the tiles, and no key that is not bound', async ({
  page,
}, info) => {
  await signIn(page);
  await page.keyboard.press('?');
  const help = page.getByTestId('help');
  await expect(help).toBeVisible();
  const text = (await help.textContent()) ?? '';
  expect(text).toContain('e / E');
  expect(text).toContain('1 – 4 / l / = / x / F / z / w');
  expect(text).toMatch(/the changes window/);
  expect(text).not.toContain('browser notifications on / off');
  await shot(page, info, 'help');
  await page.keyboard.press('Escape');
  await expect(help).toHaveCount(0);
});

test('120 in the window view + opens the add menu once and does not scale the cell', async ({
  page,
}, info) => {
  await signIn(page);
  await page.goto(`/w/${HOST}/work/0`);
  const cells = page.getByTestId('cell');
  await expect(cells.first()).toBeVisible();
  // The first cell is focused by a click on its header, not its screen (that would type).
  await cells.first().locator('.mx-cell-head').click();
  const screen = page.locator('.mx-cell[data-focused] [data-testid="cell-screen"]');
  await expect(screen).toBeVisible();
  const before = await screen.evaluate((el) => getComputedStyle(el).fontSize);
  await page.keyboard.press('+');
  await expect(page.getByTestId('add-menu')).toBeVisible();
  await page.waitForTimeout(300);
  expect(await screen.evaluate((el) => getComputedStyle(el).fontSize)).toBe(before);
  await shot(page, info, 'window-plus');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('add-menu')).toHaveCount(0);
});
