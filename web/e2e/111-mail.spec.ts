import { expect, test, type APIRequestContext } from '@playwright/test';
import { control, HOST, openPane, SHELL0, shot, signIn, TOKEN } from './fixtures';
import { addressOf, closeMade, otherPane, say } from './talk';

// Mail: a message held for a pane's process, never typed. On the web it
// shows as the unread count on the tile, its tab and its row, as rows of
// the messages window, and the window's line mails the open pane.
test.skip(!process.env.MX_AGENTS, 'needs the agents environment');

test.afterEach(async ({ request }) => closeMade(request));

const auth = { Authorization: `Bearer ${TOKEN}` };

async function mail(request: APIRequestContext, to: string, text: string, fromPane?: string) {
  const r = await request.post(`/v1/panes/${to}/mail`, {
    headers: auth,
    data: fromPane ? { text, from: { host: HOST, pane_id: fromPane } } : { text },
  });
  expect(r.status()).toBe(201);
}

test('111 a mail to the open pane: no toast, the count on the tile and the tab, the group, the window, the line', async ({
  page,
  request,
}, info) => {
  const pane0 = await control(request, '/pane-id', { target: 'work:0.0' });
  const other = await otherPane(request);
  await signIn(page);
  await openPane(page, SHELL0);
  // Earlier specs left messages: a look at the window marks them seen,
  // and what follows counts from there.
  await page.keyboard.press('T');
  const talk = page.getByTestId('talk');
  await expect(talk).toBeVisible();
  const rows = page.getByTestId('talk-row');
  const before = await rows.count();
  await page.keyboard.press('Escape');
  await expect(talk).toHaveCount(0);
  await mail(request, SHELL0, 'run the tests on your branch', other.id);
  // The count on the tile's header and its tab, the frame, the header's
  // unseen count; nothing pops up.
  const tile = page.getByTestId('tile');
  await expect(tile.getByTestId('mail-mark')).toContainText('1', { timeout: 10_000 });
  await expect(
    page.locator(`[data-testid="tab"][data-address="${SHELL0}"]`).getByTestId('mail-mark'),
  ).toContainText('1');
  await expect(page.getByTestId('tab-group')).toHaveCount(1);
  await expect(tile).toHaveAttribute('data-group', '');
  await expect(page.getByTestId('talk-count')).toContainText('✉ 1', { timeout: 10_000 });
  await page.waitForTimeout(500);
  await expect(page.getByTestId('toast')).toHaveCount(0);
  await shot(page, info, '111-mail-group');
  // The window: a mail row with its glyph; the line mails the open pane.
  await page.keyboard.press('T');
  await expect(talk).toBeVisible();
  await expect(rows).toHaveCount(before + 1);
  await expect(rows.last()).toHaveAttribute('data-kind', 'mail');
  await expect(rows.last()).toHaveAttribute('data-from', other.address);
  await expect(rows.last()).toContainText('run the tests on your branch');
  await expect(page.getByTestId('mail-line')).toBeEnabled();
  await page.getByTestId('mail-line').fill('a note for the other pane');
  await page.getByTestId('mail-line').press('Enter');
  await expect(rows).toHaveCount(before + 2, { timeout: 10_000 });
  await expect(rows.last()).toHaveAttribute('data-kind', 'mail');
  await expect(rows.last()).toHaveAttribute('data-to', SHELL0);
  await expect(rows.last()).toContainText('you');
  await expect(page.getByTestId('mail-line')).toHaveValue('');
  await shot(page, info, '111-mail-window');
  await page.keyboard.press('Escape');
  await expect(talk).toHaveCount(0);
  // The first pane now holds two; its process reads them and the counts go.
  await expect(tile.getByTestId('mail-mark')).toContainText('2', { timeout: 10_000 });
  const read = await control(request, '/mail', { pane: pane0 });
  expect(read).toContain('run the tests on your branch');
  expect(read).toContain('a note for the other pane');
  await expect(tile.getByTestId('mail-mark')).toHaveCount(0, { timeout: 10_000 });
  // The screen of the pane has none of it.
  const screen = await control(request, '/capture', { target: 'work:0.0' });
  expect(screen).not.toContain('run the tests');
  // A reply from the other pane lands indented under what it answers.
  await say(request, other.address, pane0, { text: 'echo talk too' });
  await page.keyboard.press('T');
  await expect(rows).toHaveCount(before + 3, { timeout: 10_000 });
  await expect(rows.last()).toHaveAttribute('data-kind', 'text');
  await page.keyboard.press('Escape');
});

test('111 three panes in a thread are one frame, two threads are two with air between, M focuses the line, the list', async ({
  page,
  request,
}, info) => {
  const pane0 = await control(request, '/pane-id', { target: 'work:0.0' });
  const a = await otherPane(request);
  const b = await otherPane(request);
  const c = await otherPane(request);
  const d = await otherPane(request);
  // 0.0 ↔ a ↔ b: one thread; c ↔ d: another. Each split moved the
  // earlier panes along, so their addresses are read again.
  await mail(request, await addressOf(request, a.id), 'one', pane0);
  const bNow = await addressOf(request, b.id);
  await mail(request, bNow, 'two', a.id);
  await mail(request, await addressOf(request, d.id), 'three', c.id);
  await signIn(page);
  await openPane(page, SHELL0);
  const groups = page.getByTestId('tab-group');
  await expect(groups).toHaveCount(2, { timeout: 10_000 });
  await expect(groups.nth(0).getByTestId('tab')).toHaveCount(3);
  await expect(groups.nth(1).getByTestId('tab')).toHaveCount(2);
  await expect(groups.nth(0)).toHaveAttribute('data-group', '1');
  await expect(groups.nth(1)).toHaveAttribute('data-group', '2');
  await shot(page, info, '111-mail-groups');
  // M opens the window with the line focused on the open pane.
  await page.keyboard.press('M');
  await expect(page.getByTestId('talk')).toBeVisible();
  await expect(page.getByTestId('mail-line')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('talk')).toHaveCount(0);
  // The list: the rows of each group kept together, with the edge and the counts.
  await page.getByTestId('back').click();
  await expect(page.getByTestId('panes')).toBeVisible();
  const grouped = page.locator('[data-testid="pane-row"][data-group="1"]');
  await expect(grouped).toHaveCount(3, { timeout: 10_000 });
  await expect(page.locator('[data-testid="pane-row"][data-group="2"]')).toHaveCount(2);
  await expect(
    page.locator(`[data-testid="pane-row"][data-address="${bNow}"]`).getByTestId('mail-mark'),
  ).toContainText('1');
  await shot(page, info, '111-mail-list');
});
