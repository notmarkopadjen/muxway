import { expect, test, type Page } from '@playwright/test';
import { control, HOST, openPane, RO_TOKEN, SHELL0, shot, signIn, TOKEN } from './fixtures';
import { addressOf, closeMade, otherPane } from './talk';

// The agents environment (see 109): the first pane writable. Later: the
// owner parks a pane (minimise, from a tile; d on the list; the inbox
// row), its tab leaves the strip for the minimised row with the moon, it
// stops calling, and coming back to it wakes it. The earlier specs leave
// the window's other panes in their own state, so each test splits fresh
// writable panes beside the first and parks those.
test.skip(!process.env.MX_AGENTS, 'needs the agents environment');

test.afterEach(async ({ request }) => closeMade(request));

const tabOrder = (page: Page) =>
  page.getByTestId('tab').evaluateAll((els) => els.map((e) => e.getAttribute('data-address')));

const inboxOrder = (page: Page) =>
  page
    .getByTestId('inbox-row')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-address')));

const tabOf = (page: Page, address: string) =>
  page.locator(`[data-testid="tab"][data-address="${address}"]`);
const rowOf = (page: Page, address: string) =>
  page.locator(`[data-testid="inbox-row"][data-address="${address}"]`);
const minimisedOf = (page: Page, address: string) =>
  page.locator(`[data-testid="minimised-tab"][data-address="${address}"]`);

test('118 d parks the focused pane: its tile leaves for the row with ☾, it stops calling, the row’s tab wakes it and brings it back', async ({
  page,
  request,
}, info) => {
  const other = await otherPane(request);
  await control(request, '/notify', { pane: other.id, kind: 'done', text: 'tests green' });
  await signIn(page);
  await openPane(page, SHELL0);
  const tab = tabOf(page, other.address);
  await expect(tab).toHaveAttribute('data-state', 'waiting', { timeout: 10_000 });
  const before = await tabOrder(page);
  await tab.click();
  await expect(page.getByTestId('pane-attention')).toContainText('done');
  // d parks it: the next awake pane takes the tile, the tab leaves the
  // strip, and the row above the keys has it with the moon and the kind
  // underneath, dimmed.
  await page.keyboard.press('d');
  const row = minimisedOf(page, other.address);
  await expect(row).toBeVisible({ timeout: 10_000 });
  await expect(row).toHaveAttribute('data-state', 'later');
  await expect(row.getByTestId('badge')).toHaveAttribute('data-kind', 'later');
  await expect(row.getByTestId('badge')).toHaveText('☾');
  await expect(row.getByTestId('under-later')).toContainText('✓');
  await expect(tab).toHaveCount(0);
  await expect(page.getByTestId('tile')).toHaveCount(1);
  await expect(page.getByTestId('pane')).not.toHaveAttribute('data-panes', other.address);
  await expect(page.getByTestId('pane-attention')).toHaveCount(0);
  await shot(page, info, '118-later-row');
  // A parked pane does not call: no toast, no title flash on a new
  // notification; the row's tab shows what waits.
  await control(request, '/notify', { pane: other.id, kind: 'permission', text: 'run make?' });
  await expect(row.getByTestId('under-later')).toContainText('!', { timeout: 10_000 });
  await page.waitForTimeout(1500);
  await expect(page.getByTestId('toast')).toHaveCount(0);
  expect(await page.title()).not.toContain('[!]');
  await expect(row).toHaveAttribute('data-state', 'later');
  // The row's tab wakes it and brings it back as one more tile, focused;
  // its tab takes its place in the strip, painted with its state.
  await row.click();
  await expect(page.getByTestId('tile')).toHaveCount(2);
  await expect(page.locator('[data-testid="tile"][data-focused]')).toHaveAttribute(
    'data-pane',
    other.address,
  );
  await expect(row).toHaveCount(0);
  await expect(tab).toHaveAttribute('data-state', 'waiting', { timeout: 10_000 });
  await expect.poll(() => tabOrder(page), { timeout: 10_000 }).toEqual(before);
  await expect(page.getByTestId('pane-attention')).toContainText('permission: run make?');
  await shot(page, info, '118-later-woken');
  await control(request, '/notify', { pane: other.id, kind: 'working', text: '' });
  await expect(page.getByTestId('pane-attention')).toHaveCount(0, { timeout: 10_000 });
});

test('118 o skips a parked pane; the inbox lists it last, with later and wake; Enter opens and wakes', async ({
  page,
  request,
}, info) => {
  const older = await otherPane(request);
  const newer = await otherPane(request);
  // The second split moved the first pane along: its address is read again.
  const olderAddress = await addressOf(request, older.id);
  await control(request, '/notify', { pane: older.id, kind: 'done', text: 'older' });
  await page.waitForTimeout(1100);
  await control(request, '/notify', { pane: newer.id, kind: 'question', text: 'newer' });
  await signIn(page);
  await page.keyboard.press('I');
  const olderRow = rowOf(page, olderAddress);
  const newerRow = rowOf(page, newer.address);
  await expect(olderRow).toBeVisible({ timeout: 10_000 });
  await expect(newerRow).toBeVisible();
  const positions = async () => {
    const order = await inboxOrder(page);
    return [order.indexOf(olderAddress), order.indexOf(newer.address)];
  };
  const [a, b] = await positions();
  expect(a).toBeLessThan(b);
  // The row's later button parks it: the row goes last, with the moon and
  // the kind underneath, and the button reads wake.
  await olderRow.getByTestId('inbox-later').click();
  await expect(olderRow.getByTestId('badge')).toHaveAttribute('data-kind', 'later', {
    timeout: 10_000,
  });
  await expect.poll(async () => (await inboxOrder(page)).at(-1)).toBe(olderAddress);
  await expect(olderRow).toContainText('later · done: older');
  await expect(olderRow.getByTestId('inbox-later')).toHaveText('wake');
  await expect(page.getByTestId('inbox-count')).toContainText('⚑');
  await shot(page, info, '118-later-inbox');
  await page.keyboard.press('Escape');
  // o opens the oldest awake pane, not the parked one.
  await page.keyboard.press('o');
  await expect(page).toHaveURL(new RegExp(`/p/${newer.address.replace(/\//g, '\\/')}`));
  await page.getByTestId('back').click();
  await expect(page.getByTestId('panes')).toBeVisible();
  // Enter on the parked row opens the pane and wakes it.
  await page.keyboard.press('I');
  await expect(olderRow).toBeVisible({ timeout: 10_000 });
  const rows = await inboxOrder(page);
  for (let i = 0; i < rows.indexOf(olderAddress); i++) await page.keyboard.press('ArrowDown');
  await expect(olderRow).toHaveClass(/mx-selected/);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/p/${olderAddress.replace(/\//g, '\\/')}`));
  await expect(page.getByTestId('pane-attention')).toContainText('done', {
    timeout: 10_000,
  });
  await control(request, '/notify', { pane: older.id, kind: 'working', text: '' });
  await control(request, '/notify', { pane: newer.id, kind: 'working', text: '' });
  await expect(page.getByTestId('pane-attention')).toHaveCount(0, { timeout: 10_000 });
});

test('118 ] and [ with one tile open never reach a parked pane, which is the row’s; woken, it is on the way again', async ({
  page,
  request,
}) => {
  const parked = await otherPane(request);
  const awakeOther = await otherPane(request);
  const parkedAddress = await addressOf(request, parked.id);
  await signIn(page);
  await openPane(page, SHELL0);
  const tab = tabOf(page, parkedAddress);
  await expect(tab).toBeVisible({ timeout: 10_000 });
  await expect(tabOf(page, awakeOther.address)).toBeVisible();
  // Park it from its own tile: the next awake pane takes the tile, its
  // tab leaves the strip for the row.
  await tab.click();
  await expect(page.getByTestId('pane')).toHaveAttribute('data-panes', parkedAddress);
  await page.keyboard.press('d');
  const row = minimisedOf(page, parkedAddress);
  await expect(row).toBeVisible({ timeout: 10_000 });
  await expect(tab).toHaveCount(0);
  await expect(page.getByTestId('pane')).not.toHaveAttribute('data-panes', parkedAddress);
  const awake = (await tabOrder(page)).filter((a): a is string => !!a);
  expect(awake).not.toContain(parkedAddress);
  expect(awake.length).toBeGreaterThan(1);
  // ] all the way round: every awake pane once, never the parked one.
  const shown = await page.getByTestId('pane').getAttribute('data-panes');
  let at = awake.indexOf(shown!);
  expect(at).toBeGreaterThanOrEqual(0);
  for (let i = 0; i < awake.length; i++) {
    at = (at + 1) % awake.length;
    await page.keyboard.press(']');
    await expect(page.getByTestId('pane')).toHaveAttribute('data-panes', awake[at], {
      timeout: 10_000,
    });
  }
  await expect(row).toBeVisible();
  // Its row tab wakes it and opens it beside; alone again, [ and ] reach
  // it as they reach any other.
  await row.click();
  await expect(page.getByTestId('tile')).toHaveCount(2);
  await expect(tab).toBeVisible({ timeout: 10_000 });
  await expect(tab).not.toHaveAttribute('data-state', 'later', { timeout: 10_000 });
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('pane')).toHaveAttribute('data-panes', parkedAddress);
  const woken = (await tabOrder(page)).filter((a): a is string => !!a);
  const after = woken[(woken.indexOf(parkedAddress) + 1) % woken.length];
  await page.keyboard.press(']');
  await expect(page.getByTestId('pane')).toHaveAttribute('data-panes', after, { timeout: 10_000 });
  await page.keyboard.press('[');
  await expect(page.getByTestId('pane')).toHaveAttribute('data-panes', parkedAddress, {
    timeout: 10_000,
  });
});

test('118 the list: d parks the selected row in its place; opening it wakes it; a reader sees the mark and cannot move it', async ({
  page,
  browser,
  request,
}, info) => {
  const other = await otherPane(request);
  await signIn(page);
  const row = page.locator(`[data-testid="pane-row"][data-address="${other.address}"]`);
  await expect(row).toBeVisible({ timeout: 10_000 });
  for (
    let i = 0;
    i < 12 && !(await row.evaluate((el) => el.classList.contains('mx-selected')));
    i++
  )
    await page.keyboard.press('j');
  await expect(row).toHaveClass(/mx-selected/);
  const addressesBefore = await page
    .getByTestId('pane-row')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-address')));
  await page.keyboard.press('d');
  await expect(row).toHaveAttribute('data-state', 'later', { timeout: 10_000 });
  await expect(row.getByTestId('badge')).toHaveText('☾');
  await expect(row).toContainText('later');
  const addressesAfter = await page
    .getByTestId('pane-row')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-address')));
  expect(addressesAfter).toEqual(addressesBefore);
  await shot(page, info, '118-later-list');
  // A reader sees the mark; minimise, d and the inbox's later are off for
  // them, and a parked pane they open stays a tile, with the mark.
  const reader = await browser.newContext({ ignoreHTTPSErrors: true });
  const page2 = await reader.newPage();
  await signIn(page2, RO_TOKEN);
  const row2 = page2.locator(`[data-testid="pane-row"][data-address="${other.address}"]`);
  await expect(row2).toHaveAttribute('data-state', 'later', { timeout: 10_000 });
  await page2.keyboard.press('I');
  await expect(rowOf(page2, other.address).getByTestId('inbox-later')).toBeDisabled();
  await page2.keyboard.press('Escape');
  await row2.click();
  await expect(page2.getByTestId('pane-later')).toContainText('later');
  await expect(page2.getByTestId('minimise')).toBeDisabled();
  await expect(page2.getByTestId('later')).toHaveCount(0);
  await page2.keyboard.press('d');
  await page2.waitForTimeout(1500);
  await expect(page2.getByTestId('pane-later')).toContainText('later');
  await expect(page2.getByTestId('minimised-tab')).toHaveCount(0);
  await shot(page2, info, '118-later-reader');
  await reader.close();
  // Opening the row wakes it: a tile, awake, not in the row.
  await row.click();
  await expect(page).toHaveURL(new RegExp(`/p/${other.address.replace(/\//g, '\\/')}`));
  await expect(page.getByTestId('pane-later')).toHaveCount(0, { timeout: 10_000 });
  await expect(minimisedOf(page, other.address)).toHaveCount(0);
});

test("118 the window view leans a parked pane's name in its cell header, upright again when woken", async ({
  page,
  request,
}, info) => {
  const other = await otherPane(request);
  const park = (on: boolean) =>
    request.post(`/v1/panes/${other.address}/later`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
      data: { later: on },
    });
  expect((await park(true)).ok()).toBe(true);
  await signIn(page);
  await page.goto(`/w/${HOST}/work/0`);
  const head = page.locator(`.mx-cell-head[data-state="later"]`);
  await expect(head).toHaveCount(1, { timeout: 10_000 });
  await expect(head.locator('.mx-title-name')).toHaveCSS('font-style', 'italic');
  await shot(page, info, '118-later-window-header');
  expect((await park(false)).ok()).toBe(true);
  await expect(head).toHaveCount(0, { timeout: 10_000 });
  const cells = page.locator('.mx-cell-head .mx-title-name');
  for (let i = 0; i < (await cells.count()); i++)
    await expect(cells.nth(i)).toHaveCSS('font-style', 'normal');
});
