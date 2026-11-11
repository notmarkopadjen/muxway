import { expect, test, type Page } from '@playwright/test';
import { control, HOST, RO_TOKEN, settled, shot, signIn } from './fixtures';

// Minimise is later: `_` on a tile parks its pane on the host and the
// tile leaves for the row above the keys, which is the listing's parked
// panes; a click there wakes the pane and brings it back. A pane parked
// from another client leaves the tiles the same way; a parked pane the
// view opens is woken; a reader sees the row and cannot move it. The last
// tile minimises to the next awake pane, or to the list, the desk saying
// so (the arrange environment, where every pane is writable).

const ARRANGE = !!process.env.MX_ARRANGE;
const SHELL0 = `${HOST}/work/0.0`;
const LOGS = `${HOST}/work/1.0`;
const hdr = { 'X-Muxway-Client': 'e2e' };

const tile = (page: Page, address: string) => page.locator(`[data-pane="${address}"]`);
const tabOf = (page: Page, address: string) =>
  page.locator(`[data-testid="tab"][data-address="${address}"]`);
const rowOf = (page: Page, address: string) =>
  page.locator(`[data-testid="minimised-tab"][data-address="${address}"]`);

// The panes parked for later, as the listing says.
async function parked(page: Page): Promise<string[]> {
  const r = await page.request.get('/v1/panes', { headers: hdr });
  return ((await r.json()) as { panes: { address: string; later?: boolean }[] }).panes
    .filter((p) => p.later)
    .map((p) => p.address);
}
async function park(page: Page, address: string, later: boolean, status = 204) {
  const r = await page.request.post(`/v1/panes/${address}/later`, {
    headers: hdr,
    data: { later },
  });
  expect(r.status(), `${later ? 'park' : 'wake'} ${address}`).toBe(status);
}
async function readDesk(page: Page): Promise<{ view: string; minimised?: string[] }> {
  const r = await page.request.get('/v1/desk', { headers: hdr });
  return ((await r.json()) as { desk: { view: string; minimised?: string[] } }).desk;
}

test('131 minimise parks the pane: the tile leaves for the row with ☾, another client’s park does the same, the row’s tab wakes it; a reader sees the row and cannot move it', async ({
  page,
  browser,
  request,
}, info) => {
  test.skip(ARRANGE, 'the main environment');
  const logsId = await control(request, '/pane-id', { target: 'work:1.0' });
  await signIn(page);
  await page.goto(`/p/${SHELL0},${LOGS}`);
  await expect(page.getByTestId('tile')).toHaveCount(2);
  await settled(page);
  // _ on the logs tile: the pane is parked on the host, the tile goes, its
  // tab leaves the strip and the row has it with the moon.
  await tile(page, LOGS).getByTestId('minimise').click();
  await expect(page.getByTestId('tile')).toHaveCount(1);
  const row = rowOf(page, LOGS);
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute('data-state', 'later');
  await expect(row.getByTestId('badge')).toHaveText('☾');
  await expect(tabOf(page, LOGS)).toHaveCount(0);
  await expect.poll(() => parked(page), { timeout: 5000 }).toEqual([LOGS]);
  // A notification underneath is shown, dimmed, and does not call.
  await control(request, '/notify', { pane: logsId, kind: 'question', text: 'ship it?' });
  await expect(row.getByTestId('under-later')).toContainText('?', { timeout: 10_000 });
  await page.waitForTimeout(1200);
  await expect(page.getByTestId('toast')).toHaveCount(0);
  expect(await page.title()).not.toContain('[?]');
  await shot(page, info, '131-row');
  // The row's tab wakes it and brings it back, focused; awake in the listing.
  await row.click();
  await expect(page.getByTestId('tile')).toHaveCount(2);
  await expect(tile(page, LOGS)).toHaveAttribute('data-focused', '');
  await expect(page.getByTestId('minimised')).toHaveCount(0);
  await expect(tabOf(page, LOGS)).toHaveAttribute('data-open', '');
  await expect.poll(() => parked(page), { timeout: 5000 }).toEqual([]);
  await page.getByTestId('input').fill('y');
  await page.getByTestId('input').press('Enter');
  // d and - do the same as _ (the keys are the tile's, not the line's);
  // the add menu lists the row under minimised and a pick wakes and
  // brings back.
  await tile(page, LOGS).locator('.mx-tile-head').click();
  await page.keyboard.press('d');
  await expect(page.getByTestId('tile')).toHaveCount(1);
  await expect(row).toBeVisible();
  await expect.poll(() => parked(page), { timeout: 5000 }).toEqual([LOGS]);
  await page.keyboard.press('+');
  await expect(page.getByTestId('add-minimised')).toHaveAttribute('data-address', LOGS);
  await page.getByTestId('add-minimised').click();
  await expect(page.getByTestId('tile')).toHaveCount(2);
  await expect(row).toHaveCount(0);
  await expect.poll(() => parked(page), { timeout: 5000 }).toEqual([]);
  await tile(page, LOGS).locator('.mx-tile-head').click();
  await page.keyboard.press('-');
  await expect(page.getByTestId('tile')).toHaveCount(1);
  await expect(row).toBeVisible();
  await expect.poll(() => parked(page), { timeout: 5000 }).toEqual([LOGS]);
  // Woken from elsewhere (another client, a script): the row lets it go
  // and the strip has it again, as a closed tab; nothing opens.
  await park(page, LOGS, false);
  await expect(row).toHaveCount(0, { timeout: 10_000 });
  await expect(tabOf(page, LOGS)).toBeVisible();
  await expect(tabOf(page, LOGS)).not.toHaveAttribute('data-open', '');
  await expect(page.getByTestId('tile')).toHaveCount(1);
  // Parked from elsewhere while open as a tile: the tile leaves for the row.
  await tabOf(page, LOGS).click({ modifiers: ['Shift'] });
  await expect(page.getByTestId('tile')).toHaveCount(2);
  await expect(tabOf(page, LOGS)).toHaveAttribute('data-open', '');
  await page.waitForTimeout(1500);
  await park(page, LOGS, true);
  await expect(row).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('tile')).toHaveCount(1);
  await expect(tabOf(page, LOGS)).toHaveCount(0);
  await shot(page, info, '131-parked-elsewhere');
  // A reader: the row shows the mark, minimise is off with the reason, the
  // parked pane they open stays a tile with the mark, and the hub refuses
  // their mark.
  const reader = await browser.newContext({ ignoreHTTPSErrors: true });
  const page2 = await reader.newPage();
  await signIn(page2, RO_TOKEN);
  await page2.goto(`/p/${SHELL0}`);
  await expect(page2.getByTestId('tile')).toHaveCount(1);
  await expect(rowOf(page2, LOGS)).toBeVisible({ timeout: 10_000 });
  await expect(rowOf(page2, LOGS).getByTestId('badge')).toHaveText('☾');
  await expect(page2.getByTestId('minimise')).toBeDisabled();
  await expect(page2.getByTestId('minimise')).toHaveAttribute('title', /needs a writable pane/);
  await shot(page2, info, '131-reader');
  await rowOf(page2, LOGS).click();
  await expect(page2.getByTestId('tile')).toHaveCount(2);
  await expect(tile(page2, LOGS).getByTestId('pane-later')).toContainText('later');
  await page2.keyboard.press('-');
  await page2.waitForTimeout(1200);
  await expect(page2.getByTestId('tile')).toHaveCount(2);
  await park(page2, LOGS, false, 403);
  expect(await parked(page)).toEqual([LOGS]);
  await reader.close();
  // Back to the list (the brand; × on a lone tile needs a host that
  // closes panes): the parked pane stays parked, nothing comes back.
  await page.getByTestId('back').click();
  await expect(page.getByTestId('panes')).toBeVisible();
  expect(await parked(page)).toEqual([LOGS]);
  // The list's row has the moon; opening it wakes it.
  const listRow = page.locator(`[data-testid="pane-row"][data-address="${LOGS}"]`);
  await expect(listRow).toHaveAttribute('data-state', 'later');
  await listRow.click();
  await expect(page.getByTestId('tile')).toHaveCount(1);
  await expect(page.getByTestId('pane-later')).toHaveCount(0, { timeout: 10_000 });
  await expect.poll(() => parked(page), { timeout: 5000 }).toEqual([]);
  // Leave the view, so the windows are given back to the host, and the
  // desk as the next spec expects.
  await page.goto('/');
  await expect(page.getByTestId('panes')).toBeVisible();
  for (const target of ['work:0', 'work:1'])
    await expect
      .poll(() => control(request, '/window-size', { target }), { timeout: 8000 })
      .toBe('100x30');
});

test('131 the last tile minimises: the next awake pane takes it, or the view goes to the list and the desk says so; a parked pane opened by a link is woken', async ({
  page,
}, info) => {
  test.skip(!ARRANGE, 'needs a window whose panes are all writable');
  const at = (i: number) => `${HOST}/work/0.${i}`;
  await signIn(page);
  await page.goto(`/p/${at(0)}`);
  await expect(page.getByTestId('tile')).toHaveCount(1);
  await settled(page);
  // The first: the next awake pane takes the tile.
  await page.getByTestId('minimise').click();
  await expect(page.getByTestId('tile')).toHaveCount(1);
  await expect(page.getByTestId('tile')).toHaveAttribute('data-pane', at(1));
  await expect(rowOf(page, at(0))).toBeVisible();
  await expect.poll(() => parked(page), { timeout: 5000 }).toEqual([at(0)]);
  await page.keyboard.press('-');
  await expect(page.getByTestId('tile')).toHaveAttribute('data-pane', at(2));
  await expect(rowOf(page, at(1))).toBeVisible();
  await shot(page, info, '131-next-took-the-tile');
  // The last with none awake: the list, the desk saying so, no row in it.
  await page.keyboard.press('-');
  await expect(page.getByTestId('panes')).toBeVisible({ timeout: 10_000 });
  await expect.poll(async () => (await readDesk(page)).view, { timeout: 5000 }).toBe('list');
  expect((await readDesk(page)).minimised).toBeUndefined();
  await expect(page.getByTestId('desk-row')).toContainText('the list');
  await expect.poll(() => parked(page), { timeout: 5000 }).toEqual([at(0), at(1), at(2)]);
  await shot(page, info, '131-list-desk');
  // A pane opened from the list is woken; the others stay in the row.
  await page.locator(`[data-testid="pane-row"][data-address="${at(1)}"]`).click();
  await expect(page.getByTestId('tile')).toHaveCount(1);
  await expect(page.getByTestId('pane-later')).toHaveCount(0, { timeout: 10_000 });
  await expect(rowOf(page, at(0))).toBeVisible();
  await expect(rowOf(page, at(2))).toBeVisible();
  await expect(rowOf(page, at(1))).toHaveCount(0);
  await expect.poll(() => parked(page), { timeout: 5000 }).toEqual([at(0), at(2)]);
  // A parked pane opened by a link is woken too.
  await page.goto(`/p/${at(2)}`);
  await expect(page.getByTestId('tile')).toHaveAttribute('data-pane', at(2));
  await expect(page.getByTestId('pane-later')).toHaveCount(0, { timeout: 10_000 });
  await expect.poll(() => parked(page), { timeout: 5000 }).toEqual([at(0)]);
  await park(page, at(0), false);
  await page.goto('/');
});
