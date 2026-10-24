import { expect, test } from '@playwright/test';
import { control, HOST, SHELL0, shot, signIn } from './fixtures';

test('86 the lens paints a working Claude pane dim and a waiting one in the attention colour', async ({
  page,
  request,
}, info) => {
  await control(request, '/rename', { what: 'title', target: 'work:0.0', name: '✳ building' });
  const pane = await control(request, '/pane-id', { target: 'work:0.0' });
  await signIn(page);
  const row = page.getByTestId('pane-row').filter({ hasText: SHELL0 });
  await expect(row.getByTestId('pane-title')).toHaveAttribute('data-agent', 'claude', {
    timeout: 10_000,
  });
  await expect(row).not.toHaveAttribute('data-state', /./);
  // Opening the pane sizes it, and the reflow is this client's doing, not Claude's.
  await row.click();
  const tab = page.locator(`[data-testid="tab"][data-address="${SHELL0}"]`);
  await expect(page.getByTestId('fit')).toHaveText(/fit on \d+×\d+/, { timeout: 5000 });
  await page.waitForTimeout(1500);
  await expect(tab).not.toHaveAttribute('data-state', /./);
  await page.getByTestId('back').click();
  await expect(page.getByTestId('panes')).toBeVisible();
  // Claude's hook on a submitted prompt: the pane is working.
  await control(request, '/notify', { pane, kind: 'working', text: '' });
  await expect(row).toHaveAttribute('data-state', 'working', { timeout: 10_000 });
  await expect(row).toContainText('working');
  // The row is not painted: its name stays readable.
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(await row.locator('.mx-title-name').evaluate((el) => getComputedStyle(el).color)).not.toBe(
    bg,
  );
  await row.click();
  await expect(tab).toHaveAttribute('data-state', 'working');
  await expect(tab).toHaveText(/building/);
  // A reload learns the state again from the hub's recent events.
  await page.reload();
  await expect(tab).toHaveAttribute('data-state', 'working', { timeout: 10_000 });
  await expect(page.locator('.mx-tile-head').first()).toHaveAttribute('data-state', 'working');
  // A question: waiting, in the attention colour, with the text.
  await control(request, '/notify', { pane, kind: 'question', text: 'ship it?' });
  await expect(tab).toHaveAttribute('data-state', 'waiting', { timeout: 10_000 });
  await expect(page.getByTestId('pane-attention')).toContainText('question: ship it?');
  await shot(page, info, '86-lens');
  // Input clears the notification; the pane may well be working again.
  await page.getByTestId('input').fill('y');
  await page.getByTestId('input').press('Enter');
  await expect(page.getByTestId('pane-attention')).toHaveCount(0);
  await expect(tab).not.toHaveAttribute('data-state', 'waiting');
  // In the window view a waiting pane's cell glows, and nothing moves.
  await page.goto(`/w/${HOST}/work/0`);
  const cells = page.getByTestId('cell');
  await expect(cells).toHaveCount(2);
  await expect(page.getByTestId('fit')).toHaveAttribute('data-on', '1');
  // The fit lands first (after the hub's per-second limit, at worst), then the cells are measured.
  const size = () => control(request, '/window-size', { target: 'work:0' });
  await expect.poll(size, { timeout: 5000 }).not.toBe('100x30');
  await page.waitForTimeout(1500);
  const before = await cells.evaluateAll((els) =>
    els.map((e) => JSON.stringify(e.getBoundingClientRect())),
  );
  await control(request, '/notify', { pane, kind: 'permission', text: 'run it?' });
  const cell = page.locator(`[data-testid="cell"][data-pane="${pane}"]`);
  await expect(cell).toHaveAttribute('data-state', 'waiting', { timeout: 10_000 });
  expect(await cell.evaluate((e) => getComputedStyle(e).boxShadow)).not.toBe('none');
  await expect(cell.locator('.mx-cell-head')).toHaveAttribute('data-state', 'waiting');
  // The header says why it is painted, and the pane's tab in the strip is painted too.
  await expect(cell.locator('.mx-cell-head')).toContainText('permission: run it?');
  await expect(page.locator(`[data-testid="tab"][data-address="${SHELL0}"]`)).toHaveAttribute(
    'data-state',
    'waiting',
  );
  await shot(page, info, '86-window-glow');
  expect(
    await cells.evaluateAll((els) => els.map((e) => JSON.stringify(e.getBoundingClientRect()))),
  ).toEqual(before);
  await page.getByTestId('input').fill('y');
  await page.getByTestId('input').press('Enter');
  await expect(cell).not.toHaveAttribute('data-state', 'waiting');
  await control(request, '/rename', { what: 'title', target: 'work:0.0', name: 'test-pane' });
  // Leaving the pane gives the window back to tmux, so the next spec finds it at rest.
  await page.goto('/');
  await expect
    .poll(() => control(request, '/window-size', { target: 'work:0' }), { timeout: 5000 })
    .toBe('100x30');
});
