import { expect, test, type Page } from '@playwright/test';
import { control, HOST, settled, shot, SHELL0, signIn } from './fixtures';

// A pane made from the pane view opens as a tile, focused, and its tab
// goes last in the strip, whichever window it was split from and whoever
// else writes the desk while it opens. The desk the hub holds is older
// than a view with a change it has not written yet, and is not applied
// over it: a tile opened a moment ago is not taken away again.

const LOGS = `${HOST}/work/1.0`;

// The panes split off, killed after each test, newest first.
const made: string[] = [];
test.afterEach(async ({ request }) => {
  for (const id of made.splice(0).reverse()) await control(request, '/kill-pane', { target: id });
});

const tile = (page: Page, address: string) => page.locator(`[data-pane="${address}"]`);
// A tile by the pane it shows: a fit that lays the window out renumbers
// the panes, so an address is no name to follow one by.
const paneTile = (page: Page, id: string) =>
  page.locator(`[data-testid="tile"][data-pane-id="${id}"]`);
const tabAddresses = (page: Page) =>
  page
    .getByTestId('tab')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-address') ?? ''));

// + pane from the add menu, with the pane the hub answered.
async function addPane(page: Page): Promise<{ address: string; pane_id: string }> {
  await page.getByTestId('add').click();
  const [res] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/v1/windows/') && r.request().method() === 'POST',
    ),
    page.getByTestId('add-split').click(),
  ]);
  expect(res.status()).toBe(201);
  const { pane } = (await res.json()) as { pane: { address: string; pane_id: string } };
  made.push(pane.pane_id);
  return pane;
}

test('134 + pane beside the first pane of a window, which renumbers the rest: three tiles, the new one focused, its tab last', async ({
  page,
  request,
}, info) => {
  // Three panes in window work:1, two of them tiles: the window is
  // fitted as one, and a pane split beside the first renumbers the
  // others, so the tiles have to follow their panes through it.
  for (let i = 0; i < 2; i++) {
    made.push(await control(request, '/split', { target: 'work:1.0', dir: 'h' }));
    await control(request, '/select-layout', { target: 'work:1', layout: 'tiled' });
  }
  const second = `${HOST}/work/1.1`;
  const secondId = await control(request, '/pane-id', { target: 'work:1.1' });
  await signIn(page);
  await page.goto(`/p/${LOGS},${second}`);
  await expect(page.getByTestId('tile')).toHaveCount(2);
  await settled(page);
  // The first tile is the one split from.
  await tile(page, LOGS).locator('.mx-tile-head').click();
  await expect(tile(page, LOGS)).toHaveAttribute('data-focused', '');
  await shot(page, info, '134-before');
  const split = await addPane(page);
  // Three tiles, the new pane one of them and focused; the tile that
  // showed the pane now renumbered follows it.
  await expect(page.getByTestId('tile')).toHaveCount(3);
  await expect(paneTile(page, split.pane_id)).toHaveAttribute('data-focused', '');
  await expect(paneTile(page, secondId)).toHaveCount(1);
  await shot(page, info, '134-after');
  // And it stays: nothing takes the tile away again.
  await page.waitForTimeout(2500);
  await expect(page.getByTestId('tile')).toHaveCount(3);
  await expect(paneTile(page, split.pane_id)).toHaveCount(1);
  // Its tab is the strip's last.
  const at = await paneTile(page, split.pane_id).getAttribute('data-pane');
  await expect.poll(async () => (await tabAddresses(page)).at(-1)).toBe(at);
});

test('134 + pane while the hub still holds the older desk: the view keeps the new tile', async ({
  page,
}) => {
  await signIn(page);
  await page.goto(`/p/${LOGS},${SHELL0}`);
  await expect(page.getByTestId('tile')).toHaveCount(2);
  await settled(page);
  // The view's own desk is in: two panes.
  await expect
    .poll(async () => {
      const r = await page.request.get('/v1/desk', { headers: { 'X-Muxway-Client': 'e2e' } });
      return ((await r.json()) as { desk: { panes?: string[] } }).desk.panes?.length ?? 0;
    })
    .toBe(2);
  // Another client of the same person writes the two-pane view again, with
  // a newer rev, the instant the new pane opens: inside the half second
  // this view takes to write its own desk.
  const split = await addPane(page);
  await page.request.put('/v1/desk', {
    headers: { 'X-Muxway-Client': 'e2e' },
    data: { view: 'panes', panes: [LOGS, SHELL0], focused: SHELL0, arrangement: 'column' },
  });
  await expect(page.getByTestId('tile')).toHaveCount(3);
  await expect(paneTile(page, split.pane_id)).toHaveAttribute('data-focused', '');
  // And it stays: the desk the view writes wins, not the one it raced.
  await page.waitForTimeout(2500);
  await expect(page.getByTestId('tile')).toHaveCount(3);
  await expect(paneTile(page, split.pane_id)).toHaveCount(1);
});

test('134 + session from the pane view, and + pane from the pane list: the new pane opens focused', async ({
  page,
  request,
}) => {
  await signIn(page);
  await page.goto(`/p/${SHELL0}`);
  await expect(page.getByTestId('tile')).toHaveCount(1);
  await settled(page);
  // One creation per two seconds per principal.
  await page.waitForTimeout(2100);
  // + session: the session's first pane opens as the only tile, focused.
  await page.getByTestId('add').click();
  await page.getByTestId('add-session').click();
  const [res] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/sessions') && r.request().method() === 'POST'),
    (async () => {
      await page.getByTestId('session-name').fill('fresh');
      await page.getByTestId('session-name').press('Enter');
    })(),
  ]);
  expect(res.status()).toBe(201);
  const first = ((await res.json()) as { pane: { address: string } }).pane.address;
  await expect(tile(page, first)).toHaveAttribute('data-focused', '');
  await control(request, '/kill-pane', { target: 'fresh' });
  // + pane from the pane list opens the new pane as the only tile, focused.
  await page.waitForTimeout(2100);
  await page.goto('/');
  await expect(page.getByTestId('panes')).toBeVisible();
  const [made2] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/v1/windows/') && r.request().method() === 'POST',
    ),
    page.locator('[data-testid="new-pane"][data-window$="/work/1"]').first().click(),
  ]);
  expect(made2.status()).toBe(201);
  const pane = ((await made2.json()) as { pane: { address: string; pane_id: string } }).pane;
  made.push(pane.pane_id);
  await expect(tile(page, pane.address)).toHaveAttribute('data-focused', '');
});
