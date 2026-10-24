import { expect, test } from '@playwright/test';
import { control, HOST, shot, signIn } from './fixtures';

test('68 build a board from panes of two hosts', async ({ page, request }, info) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await signIn(page);
  await page.keyboard.press('b');
  await expect(page).toHaveURL(/\/b\/main$/);
  await expect(page.getByTestId('board-empty')).toBeVisible();
  const add = async (key: 'a' | 'A', filter: string) => {
    await page.keyboard.press(key);
    await page.getByTestId('palette-filter').fill(filter);
    await page.getByTestId('palette-filter').press('Enter');
  };
  await add('a', 'work/1.0');
  await expect(page.getByTestId('cell')).toHaveCount(1);
  await add('a', 'bob-desktop');
  await expect(page.getByTestId('cell')).toHaveCount(2);
  await expect(page.locator('.mx-split-h')).toHaveCount(1);
  await add('A', 'work/0.1');
  await expect(page.getByTestId('cell')).toHaveCount(3);
  await expect(page.locator('.mx-split-v')).toHaveCount(1);
  await expect(page.getByTestId('board')).toHaveAttribute(
    'data-panes',
    `${HOST}/work/1.0 bob-desktop/work/0.0 ${HOST}/work/0.1`,
  );
  // The selector offers only panes not yet on the board.
  await page.keyboard.press('a');
  await expect(page.getByTestId('palette-row')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await control(request, '/send', { target: 'work:1.0', text: 'echo on-the-board-$((60+8))' });
  await expect(page.locator('[data-pane$="work/1.0"]').getByTestId('cell-screen')).toContainText(
    'on-the-board-68',
    { timeout: 5000 },
  );
  await shot(page, info, '68-board');
});
