import { expect, test } from '@playwright/test';
import { control, HOST, seedBoard, signIn } from './fixtures';

test('75 double-click shows a pane alone and brings the others back, in a window and on a board', async ({
  page,
  request,
}) => {
  await signIn(page);
  await page.goto(`/w/${HOST}/work/0`);
  await expect(page.getByTestId('cell')).toHaveCount(2);
  await page.waitForTimeout(700);
  // Zoom is one view at two distances: a double-click on a cell or its
  // header opens the pane alone in the pane view; from there ⊡, z or a
  // double-click bring the window's panes back side by side as tiles.
  await page.getByTestId('cell-screen').nth(1).dblclick();
  await expect(page).toHaveURL(new RegExp(`/p/${HOST}/work/0.1$`));
  const tiles = page.getByTestId('tile');
  await expect(tiles).toHaveCount(1);
  await expect(page.getByTestId('zoom')).toHaveAttribute('data-on', '1');
  await page.getByTestId('zoom').click();
  await expect(page).toHaveURL(new RegExp(`/p/${HOST}/work/0.1,${HOST}/work/0.0$`));
  await expect(tiles).toHaveCount(2);
  await expect(page.locator('[data-testid="tile"][data-focused]')).toHaveAttribute(
    'data-pane',
    `${HOST}/work/0.1`,
  );
  await expect(page.getByTestId('zoom')).toHaveAttribute('data-on', '0');
  await expect(page.getByTestId('arrange')).toBeVisible();
  await page.keyboard.press('z');
  await expect(page).toHaveURL(new RegExp(`/p/${HOST}/work/0.1$`));
  await expect(tiles).toHaveCount(1);
  await page.waitForTimeout(700);
  await tiles.dblclick();
  await expect(tiles).toHaveCount(2);
  // w is the mirror layout; its header double-click opens the pane alone.
  await page.keyboard.press('w');
  await expect(page).toHaveURL(new RegExp(`/w/${HOST}/work/0$`));
  await expect(page.getByTestId('cell')).toHaveCount(2);
  await page.waitForTimeout(700);
  await page.locator('.mx-cell-head').nth(1).dblclick();
  await expect(page).toHaveURL(new RegExp(`/p/${HOST}/work/0.1$`));
  await page.goto(`/w/${HOST}/work/0`);
  await expect(page.getByTestId('cell')).toHaveCount(2);
  await page.keyboard.press(']');
  await expect(page.locator('[data-testid="tab"][data-focused]')).toHaveAttribute(
    'data-address',
    `${HOST}/work/0.1`,
  );
  await page.keyboard.press('z');
  await expect(page).toHaveURL(new RegExp(`/p/${HOST}/work/0.1$`));
  // Let the fits and releases of all that settle before the board.
  await page.waitForTimeout(2500);

  const A = `${HOST}/work/0.0`;
  const B = `${HOST}/work/1.0`;
  await seedBoard(page, 'main', [A, B]);
  await page.goto('/b/main');
  await expect(page.getByTestId('cell')).toHaveCount(2);
  await page.waitForTimeout(700);
  await page.locator(`[data-pane="${B}"]`).getByTestId('cell-screen').dblclick();
  await expect(page.getByTestId('cell')).toHaveCount(1);
  await expect(page.getByTestId('unzoom')).toBeVisible();
  await expect(page.getByTestId('focus')).toContainText(B);
  const board = (await page.locator('.mx-area').boundingBox())!;
  const alone = (await page.getByTestId('cell').boundingBox())!;
  expect(alone.width).toBeGreaterThan(board.width * 0.95);
  await page.getByTestId('cell-screen').dblclick();
  await expect(page.getByTestId('cell')).toHaveCount(2);
  await expect(page).toHaveURL(/\/b\/main$/);
  // Leaving gave the window back, so the next spec finds it at rest.
  await page.goto('/');
  await expect
    .poll(() => control(request, '/window-size', { target: 'work:0' }), { timeout: 8000 })
    .toBe('100x30');
});
