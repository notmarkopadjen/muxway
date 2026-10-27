import { expect, test, type Page } from '@playwright/test';
import { control, HOST, RO_TOKEN, SHELL0, settled, shot, signIn } from './fixtures';

// The add menu after the tabs: + pane and + session, then the minimised
// panes, then every other readable pane by host and session; a pick is
// one more tile and asks the hub nothing. `_` on a header minimises a
// tile to the row above the keys, where its tab is still read.

const RO = `${HOST}/work/0.1`;
const LOGS = `${HOST}/work/1.0`;
const BOB = 'bob-desktop/work/0.0';

const tile = (page: Page, address: string) => page.locator(`[data-pane="${address}"]`);
const entry = (page: Page, address: string) =>
  page.locator(`[data-testid="add-pane"][data-address="${address}"]`);

// Every request that would make something on a host.
function countMaking(page: Page) {
  const made = { n: 0 };
  page.on('request', (r) => {
    if (r.method() === 'POST' && /\/v1\/(windows\/|hosts\/.*\/sessions)/.test(r.url())) made.n++;
  });
  return made;
}

test('105 the add menu: + pane, + session, then the other panes by host and session; a pick is one more tile; four open, a pick replaces', async ({
  page,
  request,
}, info) => {
  await signIn(page);
  await page.goto(`/p/${LOGS},${SHELL0}`);
  await expect(page.getByTestId('tile')).toHaveCount(2);
  await settled(page);
  const made = countMaking(page);
  // The + key opens it, Esc closes it.
  await page.keyboard.press('+');
  await expect(page.getByTestId('add-menu')).toBeVisible();
  await expect(page.getByTestId('add-split')).toBeEnabled();
  await expect(page.getByTestId('add-split')).toContainText('+ pane');
  await expect(page.getByTestId('add-session')).toBeEnabled();
  await expect(page.getByTestId('add-session')).toContainText('+ session');
  await expect(page.getByTestId('add-minimised')).toHaveCount(0);
  await expect(page.getByTestId('add-full')).toHaveCount(0);
  const groups = page.getByTestId('add-group');
  await expect(groups).toHaveCount(2);
  await expect(groups.nth(0)).toContainText(`${HOST} · work`);
  await expect(groups.nth(1)).toContainText('bob-desktop · work');
  await expect(page.getByTestId('add-pane')).toHaveCount(2);
  await expect(entry(page, RO)).toContainText(RO);
  await expect(entry(page, BOB)).toBeVisible();
  await shot(page, info, '105-add-menu');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('add-menu')).toHaveCount(0);
  // + pane asks the hub once; the new pane is one more tile, focused.
  await page.getByTestId('add').click();
  const [res] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/v1/windows/') && r.request().method() === 'POST',
    ),
    page.getByTestId('add-split').click(),
  ]);
  expect(res.status()).toBe(201);
  const split = ((await res.json()) as { pane: { address: string; pane_id: string } }).pane;
  expect(split.address).toMatch(new RegExp(`^${HOST}/work/1\\.1$`));
  await control(request, '/rename', { what: 'title', target: split.pane_id, name: 'test-pane' });
  await expect(page.getByTestId('tile')).toHaveCount(3);
  await expect(tile(page, split.address)).toHaveAttribute('data-focused', '');
  expect(made.n).toBe(1);
  // A pick is one more tile, focused, and the hub is not asked.
  await page.getByTestId('add').click();
  await expect(entry(page, split.address)).toHaveCount(0);
  await entry(page, RO).click();
  await expect(page.getByTestId('tile')).toHaveCount(4);
  await expect(tile(page, RO)).toHaveAttribute('data-focused', '');
  await expect(page).toHaveURL(
    new RegExp(`/p/${LOGS},${SHELL0},${split.address},${RO}$`.replace(/\//g, '\\/')),
  );
  expect(made.n).toBe(1);
  // Four open: the menu says so, and a pick takes the focused tile's place.
  await page.getByTestId('add').click();
  await expect(page.getByTestId('add-full')).toContainText('four open: a pick replaces bash');
  await expect(page.getByTestId('add-pane')).toHaveCount(1);
  await shot(page, info, '105-add-menu-full');
  await entry(page, BOB).click();
  await expect(page.getByTestId('tile')).toHaveCount(4);
  await expect(page.getByTestId('pane')).toHaveAttribute(
    'data-panes',
    `${LOGS} ${SHELL0} ${split.address} ${BOB}`,
  );
  await expect(tile(page, BOB)).toHaveAttribute('data-focused', '');
  expect(made.n).toBe(1);
  // Leave the window as the other specs expect it.
  await control(request, '/kill-pane', { target: split.pane_id });
  await expect(page.getByTestId('tile')).toHaveCount(3, { timeout: 8000 });
  await page.goto('/');
  await expect
    .poll(() => control(request, '/window-size', { target: 'work:1' }), { timeout: 8000 })
    .toBe('100x30');
});

test('105 minimise: _ takes the tile to the row above the keys, still read and painted; a click or the menu brings it back; the last tile stays', async ({
  page,
  request,
}, info) => {
  const logsId = await control(request, '/pane-id', { target: 'work:1.0' });
  await signIn(page);
  await page.goto(`/p/${SHELL0},${LOGS}`);
  await expect(page.getByTestId('tile')).toHaveCount(2);
  await settled(page);
  await tile(page, LOGS).getByTestId('minimise').click();
  await expect(page.getByTestId('tile')).toHaveCount(1);
  await expect(page).toHaveURL(new RegExp(`/p/${SHELL0}$`.replace(/\//g, '\\/')));
  const row = page.getByTestId('minimised');
  await expect(row).toBeVisible();
  const minimised = page.locator(`[data-testid="minimised-tab"][data-address="${LOGS}"]`);
  await expect(minimised).toHaveCount(1);
  await expect(page.locator(`[data-testid="tab"][data-address="${LOGS}"]`)).toHaveCount(0);
  // The last tile cannot be minimised: its button is off and - does nothing.
  await expect(tile(page, SHELL0).getByTestId('minimise')).toBeDisabled();
  await page.keyboard.press('-');
  await expect(page.getByTestId('tile')).toHaveCount(1);
  // The pane is still read, and painted with its state when it changes.
  await page.waitForRequest((r) => r.url().includes(`/v1/panes/${LOGS}?`), { timeout: 5000 });
  await control(request, '/notify', { pane: logsId, kind: 'question', text: 'ship it?' });
  await expect(minimised).toHaveAttribute('data-state', 'waiting', { timeout: 10_000 });
  await shot(page, info, '105-minimised');
  // The add menu lists it under minimised.
  await page.keyboard.press('+');
  await expect(page.getByTestId('add-minimised')).toHaveCount(1);
  await expect(page.getByTestId('add-minimised')).toHaveAttribute('data-address', LOGS);
  await expect(page.getByTestId('add-pane')).toHaveCount(2);
  await page.keyboard.press('Escape');
  // A click on its tab brings the tile back, focused; the strip has it again.
  await minimised.click();
  await expect(page.getByTestId('tile')).toHaveCount(2);
  await expect(tile(page, LOGS)).toHaveAttribute('data-focused', '');
  await expect(row).toHaveCount(0);
  await expect(page.locator(`[data-testid="tab"][data-address="${LOGS}"]`)).toHaveAttribute(
    'data-open',
    '',
  );
  // The - key minimises the focused tile; the menu's entry brings it back.
  await page.keyboard.press('-');
  await expect(page.getByTestId('tile')).toHaveCount(1);
  await expect(minimised).toHaveCount(1);
  await page.keyboard.press('+');
  await page.getByTestId('add-minimised').click();
  await expect(page.getByTestId('tile')).toHaveCount(2);
  await expect(row).toHaveCount(0);
  // Answer the question, so the pane is quiet for the next spec.
  await page.getByTestId('input').fill('y');
  await page.getByTestId('input').press('Enter');
  await expect(tile(page, LOGS).locator('.mx-tile-head')).not.toHaveAttribute('data-state', /./, {
    timeout: 10_000,
  });
});

test('105 security: a read-only account has + pane and + session dimmed with the reason; the other panes are still listed', async ({
  page,
}) => {
  await signIn(page, RO_TOKEN);
  await page.goto(`/p/${SHELL0}`);
  await expect(page.getByTestId('readonly')).toBeVisible();
  await settled(page);
  const made = countMaking(page);
  await page.getByTestId('add').click();
  await expect(page.getByTestId('add-split')).toBeDisabled();
  await expect(page.getByTestId('add-split')).toContainText('read only');
  await expect(page.getByTestId('add-session')).toBeDisabled();
  await expect(page.getByTestId('add-session')).toContainText('no sessions here');
  await expect(page.getByTestId('add-pane')).toHaveCount(2);
  await expect(entry(page, RO)).toBeVisible();
  await expect(entry(page, LOGS)).toBeVisible();
  await entry(page, LOGS).click();
  await expect(page.getByTestId('tile')).toHaveCount(2);
  expect(made.n).toBe(0);
});
