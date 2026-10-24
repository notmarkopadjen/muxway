import { expect, test } from '@playwright/test';
import { HOST, seedBoard, signIn } from './fixtures';

test('75 double-click shows a pane alone and brings the others back, in a window and on a board', async ({
  page,
}) => {
  await signIn(page);
  await page.goto(`/w/${HOST}/work/0`);
  await expect(page.getByTestId('cell')).toHaveCount(2);
  await page.waitForTimeout(700);
  // Zoom is the pane view: a double-click on a cell or its header opens the
  // pane alone there, and from there the icon, z or a double-click on the
  // tile come back.
  await page.getByTestId('cell-screen').nth(1).dblclick();
  await expect(page).toHaveURL(new RegExp(`/p/${HOST}/work/0.1$`));
  await expect(page.getByTestId('tile')).toHaveCount(1);
  await page.getByTestId('to-window').click();
  await expect(page).toHaveURL(new RegExp(`/w/${HOST}/work/0$`));
  await expect(page.getByTestId('cell')).toHaveCount(2);
  await page.waitForTimeout(700);
  await page.locator('.mx-cell-head').nth(1).dblclick();
  await expect(page).toHaveURL(new RegExp(`/p/${HOST}/work/0.1$`));
  await page.keyboard.press('z');
  await expect(page).toHaveURL(new RegExp(`/w/${HOST}/work/0$`));
  await expect(page.getByTestId('cell')).toHaveCount(2);
  await page.keyboard.press(']');
  await expect(page.locator('[data-testid="tab"][data-focused]')).toHaveAttribute(
    'data-address',
    `${HOST}/work/0.1`,
  );
  await page.keyboard.press('z');
  await expect(page).toHaveURL(new RegExp(`/p/${HOST}/work/0.1$`));
  await page.waitForTimeout(700);
  await page.getByTestId('tile').dblclick();
  await expect(page).toHaveURL(new RegExp(`/w/${HOST}/work/0$`));
  await expect(page.getByTestId('cell')).toHaveCount(2);
  await page.getByTestId('zoom').click();
  await expect(page).toHaveURL(new RegExp(`/p/${HOST}/work/0.0$`));
  await expect(page.getByTestId('tile')).toHaveCount(1);

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
});
