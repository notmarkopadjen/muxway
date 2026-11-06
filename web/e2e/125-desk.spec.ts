import { expect, test, type APIRequestContext } from '@playwright/test';
import { control, HOST, settled, shot, signIn } from './fixtures';

// The desk: the view every client shares. Two tiles opened and one
// minimised come back at the app's start; a second client's change is
// followed within a moment, its typing never moves this one's focus; a
// link to a view goes where it points and then writes the desk.

const LOGS = `${HOST}/work/1.0`;
const SPLIT = `${HOST}/work/1.1`;
const SPLIT2 = `${HOST}/work/1.2`;
const SHELL0 = `${HOST}/work/0.0`;

const made: string[] = [];
async function split(request: APIRequestContext, target: string) {
  const id = await control(request, '/split', { target, dir: 'h' });
  made.push(id);
  return id;
}
test.afterEach(async ({ request }) => {
  for (const id of made.splice(0).reverse()) await control(request, '/kill-pane', { target: id });
});

test('125 the desk comes back at the start: the tiles, the arrangement, the minimised row and the focus', async ({
  page,
  request,
}, info) => {
  await split(request, 'work:1.0');
  await split(request, 'work:1.1');
  await signIn(page);
  await expect(page.locator(`[data-testid="pane-row"][data-address="${SPLIT2}"]`)).toBeVisible({
    timeout: 10_000,
  });
  // Three tiles, one minimised, the second focused, the column arrangement.
  await page.goto(`/p/${LOGS},${SPLIT},${SPLIT2}`);
  await expect(page.getByTestId('tile')).toHaveCount(3);
  await settled(page);
  await page.locator(`[data-pane="${SPLIT2}"] .mx-tile-head`).click();
  await page.keyboard.press('-');
  await expect(page.getByTestId('tile')).toHaveCount(2);
  await page.locator(`[data-pane="${SPLIT}"] .mx-tile-head`).click();
  await expect(page.locator('[data-testid="tile"][data-focused]')).toHaveAttribute(
    'data-pane',
    SPLIT,
  );
  await page.keyboard.press('l');
  await expect(page.getByTestId('pane')).not.toHaveAttribute('data-layout', 'custom');
  const layout = await page.getByTestId('pane').getAttribute('data-layout');
  await shot(page, info, '125-before');
  // The desk is written after a moment of quiet.
  await expect
    .poll(
      async () => {
        const r = await page.request.get('/v1/desk', { headers: { 'X-Muxway-Client': 'e2e' } });
        return ((await r.json()) as { desk: { panes?: string[]; minimised?: string[] } }).desk;
      },
      { timeout: 5000 },
    )
    .toMatchObject({
      panes: [LOGS, SPLIT],
      minimised: [SPLIT2],
      focused: SPLIT,
      arrangement: layout,
    });
  // The client, still in its view, opened again in a new tab (the same
  // browser): the desk opens.
  const again = await page.context().newPage();
  await again.goto('/');
  await expect(again.getByTestId('tile')).toHaveCount(2, { timeout: 10_000 });
  await expect(again.getByTestId('pane')).toHaveAttribute('data-layout', layout!);
  await expect(again.locator('[data-testid="tile"][data-focused]')).toHaveAttribute(
    'data-pane',
    SPLIT,
  );
  await expect(
    again.locator(`[data-testid="minimised-tab"][data-address="${SPLIT2}"]`),
  ).toBeVisible();
  await shot(again, info, '125-after');
  await again.close();
  // A navigation in this tab to the list shows the list, with the desk's row.
  await page.goto('/');
  await expect(page.getByTestId('desk-row')).toContainText('2 panes');
  await expect(page.getByTestId('tile')).toHaveCount(0);
  // D opens it again.
  await page.keyboard.press('D');
  await expect(page.getByTestId('tile')).toHaveCount(2, { timeout: 10_000 });
});

test('125 a second client changes the desk: this one follows, and keeps its focus while the other types', async ({
  page,
  browser,
  request,
}, info) => {
  await split(request, 'work:1.0');
  await signIn(page);
  await expect(page.locator(`[data-testid="pane-row"][data-address="${SPLIT}"]`)).toBeVisible({
    timeout: 10_000,
  });
  await page.goto(`/p/${LOGS}`);
  await expect(page.getByTestId('tile')).toHaveCount(1);
  await settled(page);
  // The phone: another browser, the same account.
  const ctx = await browser.newContext();
  const phone = await ctx.newPage();
  await signIn(phone);
  await phone.goto(`/p/${LOGS},${SPLIT}`);
  await expect(phone.getByTestId('tile')).toHaveCount(2);
  await settled(phone);
  // This client follows: two tiles.
  await expect(page.getByTestId('tile')).toHaveCount(2, { timeout: 10_000 });
  await shot(page, info, '125-followed');
  // The other types into the second pane: this one's focus stays on the first.
  await expect(page.locator('[data-testid="tile"][data-focused]')).toHaveAttribute(
    'data-pane',
    LOGS,
  );
  await phone.locator(`[data-pane="${SPLIT}"] .mx-tile-head`).click();
  await phone.getByTestId('input').fill('echo from-the-phone');
  await phone.keyboard.press('Enter');
  await expect(page.locator(`[data-pane="${SPLIT}"]`)).toContainText('from-the-phone', {
    timeout: 10_000,
  });
  await expect(page.locator('[data-testid="tile"][data-focused]')).toHaveAttribute(
    'data-pane',
    LOGS,
  );
  await ctx.close();
});

test('125 a link to a view goes where it points, then writes the desk', async ({ page }) => {
  await signIn(page);
  await page.goto(`/p/${SHELL0}`);
  await expect(page.getByTestId('tile')).toHaveCount(1);
  await expect(page.getByTestId('tile')).toHaveAttribute('data-pane', SHELL0);
  await expect
    .poll(
      async () => {
        const r = await page.request.get('/v1/desk', { headers: { 'X-Muxway-Client': 'e2e' } });
        return ((await r.json()) as { desk: { panes?: string[] } }).desk.panes;
      },
      { timeout: 5000 },
    )
    .toEqual([SHELL0]);
});
