import { expect, test } from '@playwright/test';
import { control, HOST, SHELL0, shot, signIn } from './fixtures';

const LOGS = `${HOST}/work/1.0`;

test('84 pick two panes, open them side by side, arrange, drag, swap, close', async ({
  page,
  request,
}, info) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  const layout0 = await control(request, '/layout', { target: 'work:0' });
  const layout1 = await control(request, '/layout', { target: 'work:1' });
  await signIn(page);
  const row = (a: string) => page.getByTestId('pane-row').filter({ hasText: a });
  await row(SHELL0).getByTestId('pick').click();
  await expect(page.getByTestId('picked-bar')).toContainText('open');
  await expect(row(SHELL0)).toHaveClass(/mx-picked/);
  // With a pick on, a click on a row picks too.
  await row(LOGS).click();
  await expect(page.getByTestId('open-picked')).toHaveText('open 2 side by side');
  await shot(page, info, '84-list-picked');
  await page.getByTestId('open-picked').click();
  await expect(page).toHaveURL(new RegExp(`/p/${SHELL0},${LOGS}$`.replace(/\//g, '\\/')));
  const tiles = page.getByTestId('tile');
  await expect(tiles).toHaveCount(2);
  await expect(page.getByTestId('pane')).toHaveAttribute('data-layout', 'row');
  // Both read; the focused one is the first.
  await expect(tiles.nth(0)).toHaveAttribute('data-focused', '');
  await control(request, '/send', { target: 'work:1.0', text: 'echo in-tile-$((80+4))' });
  await expect(tiles.nth(1).getByTestId('cell-screen')).toContainText('in-tile-84', {
    timeout: 5000,
  });
  // Several panes open with fit off, so the host is untouched.
  await expect(page.getByTestId('fit')).toHaveAttribute('data-on', '0');
  // The arrangement cycles: two panes have a row and a column.
  await page.keyboard.press('l');
  await expect(page.getByTestId('pane')).toHaveAttribute('data-layout', 'column');
  await page.getByTestId('arrange').click();
  await expect(page.getByTestId('pane')).toHaveAttribute('data-layout', 'row');
  await shot(page, info, '84-tiles');
  // The bar between the tiles drags.
  const slot = page.locator('.mx-slot').first();
  await expect(slot).toHaveAttribute('data-fraction', '0.500');
  const box = (await page.getByTestId('divider').first().boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 200, cy, { steps: 8 });
  await page.mouse.up();
  const f = Number(await slot.getAttribute('data-fraction'));
  expect(f).toBeGreaterThan(0.6);
  // A header dropped on the other tile swaps the two.
  await tiles.nth(0).locator('.mx-tile-head').dragTo(tiles.nth(1).locator('.mx-tile-head'));
  await expect(page.getByTestId('pane')).toHaveAttribute('data-panes', `${LOGS} ${SHELL0}`);
  await expect(page).toHaveURL(new RegExp(`/p/${LOGS},${SHELL0}$`.replace(/\//g, '\\/')));
  // x closes the focused tile; one remains, with fit on by default for a writable pane.
  await page.keyboard.press(']');
  await expect(tiles.nth(1)).toHaveAttribute('data-focused', '');
  await page.keyboard.press('x');
  await expect(tiles).toHaveCount(1);
  await expect(page).toHaveURL(new RegExp(`/p/${LOGS}$`.replace(/\//g, '\\/')));
  await expect(page.getByTestId('fit')).toHaveAttribute('data-on', '1');
  await page.goto('/');
  await expect(page.getByTestId('panes')).toBeVisible();
  // The host's layouts are as they were.
  await expect.poll(() => control(request, '/layout', { target: 'work:0' })).toBe(layout0);
  await expect.poll(() => control(request, '/layout', { target: 'work:1' })).toBe(layout1);
});
