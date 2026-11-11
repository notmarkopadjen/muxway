import { expect, test, type Page } from '@playwright/test';
import { HOST, settled, shot, signIn } from './fixtures';

// The minimised row is the desk's: a view opened from the list takes the
// desk's row, less the tiles it opens, and never writes an empty row over
// it. The last tile minimises too: the next awake pane takes the tile,
// or, with none awake, the pane joins the row and the view goes back to
// the list, the desk saying `list`.

const SHELL0 = `${HOST}/work/0.0`;
const LOGS = `${HOST}/work/1.0`;
const hdr = { 'X-Muxway-Client': 'e2e' };

interface Desk {
  view: string;
  panes?: string[];
  minimised?: string[];
  rev?: number;
}
async function readDesk(page: Page): Promise<Desk> {
  const r = await page.request.get('/v1/desk', { headers: hdr });
  return ((await r.json()) as { desk: Desk }).desk;
}
// The panes the account may write, the ones it may park.
async function listed(page: Page): Promise<string[]> {
  const r = await page.request.get('/v1/panes', { headers: hdr });
  return ((await r.json()) as { panes: { address: string; mode: string }[] }).panes
    .filter((p) => p.mode === 'write')
    .map((p) => p.address);
}
async function park(page: Page, address: string, later: boolean) {
  const r = await page.request.post(`/v1/panes/${address}/later`, {
    headers: hdr,
    data: { later },
  });
  expect(r.status(), `${later ? 'park' : 'wake'} ${address}`).toBe(204);
}

test('129 the row is the desk’s: a pane opened from the list keeps it; the last tile minimises to the next pane, or to the list', async ({
  page,
}, info) => {
  await signIn(page);
  await settled(page);
  // A desk with a row, as another client left it.
  const put = await page.request.put('/v1/desk', {
    headers: hdr,
    data: { view: 'panes', panes: [SHELL0], focused: SHELL0, minimised: [LOGS] },
  });
  expect(put.status()).toBe(200);
  // A pane opened from the list, not the desk's row: the row comes along.
  await page.locator(`[data-testid="pane-row"][data-address="${SHELL0}"]`).click();
  await expect(page.getByTestId('tile')).toHaveCount(1);
  const row = page.locator(`[data-testid="minimised-tab"][data-address="${LOGS}"]`);
  await expect(row).toBeVisible({ timeout: 5000 });
  await shot(page, info, '129-row-kept');
  // The desk the view writes still holds the row.
  await page.waitForTimeout(1200);
  expect(await readDesk(page)).toMatchObject({ panes: [SHELL0], minimised: [LOGS] });
  // The last tile minimised: the next awake pane takes the tile, and the
  // shell joins the row with the logs.
  await page.getByTestId('minimise').click();
  await expect(page.getByTestId('tile')).toHaveCount(1);
  await expect(page.locator('[data-testid="tile"][data-focused]')).not.toHaveAttribute(
    'data-pane',
    SHELL0,
  );
  await expect(
    page.locator(`[data-testid="minimised-tab"][data-address="${SHELL0}"]`),
  ).toBeVisible();
  await expect(row).toBeVisible();
  const taken = await page.locator('[data-testid="tile"]').getAttribute('data-pane');
  await shot(page, info, '129-next-took-the-tile');
  // Every writable pane parked, and `-` pressed until the read-only ones
  // (which cannot be parked) have each taken the tile and joined the row:
  // the last tile then has nowhere to go but the row, and the view goes
  // back to the list; the desk says so.
  const others = (await listed(page)).filter((a) => a !== taken && a !== SHELL0 && a !== LOGS);
  for (const a of others) await park(page, a, true);
  try {
    await page.waitForTimeout(800);
    for (let i = 0; i < 8 && !(await page.getByTestId('panes').isVisible()); i++) {
      await page.keyboard.press('-');
      await page.waitForTimeout(700);
    }
    await expect(page.getByTestId('panes')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('tile')).toHaveCount(0);
    await expect.poll(async () => (await readDesk(page)).view, { timeout: 5000 }).toBe('list');
    const d = await readDesk(page);
    expect(d.minimised).toEqual(expect.arrayContaining([LOGS, SHELL0, taken!]));
    await expect(page.getByTestId('desk-row')).toContainText('the list');
    await shot(page, info, '129-list-desk');
    // A pane opened again shows the row, less itself.
    await page.locator(`[data-testid="pane-row"][data-address="${SHELL0}"]`).click();
    await expect(page.getByTestId('tile')).toHaveCount(1);
    await expect(row).toBeVisible({ timeout: 5000 });
    await expect(
      page.locator(`[data-testid="minimised-tab"][data-address="${SHELL0}"]`),
    ).toHaveCount(0);
  } finally {
    for (const a of others) await park(page, a, false);
  }
  // Leave the desk as the next spec expects: one pane, no row.
  await page.request.put('/v1/desk', {
    headers: hdr,
    data: { view: 'panes', panes: [SHELL0], focused: SHELL0 },
  });
});
