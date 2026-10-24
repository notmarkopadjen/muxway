import { expect, test } from '@playwright/test';
import { HOST, seedBoard, signIn } from './fixtures';

test('75 double-click shows a pane alone and brings the others back, in a window and on a board', async ({
  page,
}) => {
  await signIn(page);
  await page.goto(`/w/${HOST}/work/0`);
  await expect(page.getByTestId('cell')).toHaveCount(2);
  await page.waitForTimeout(700);
  await page.getByTestId('cell-screen').nth(1).dblclick();
  await expect(page.getByTestId('cell')).toHaveCount(1);
  await expect(page.getByTestId('zoom')).toHaveAttribute('data-on', '1');
  await expect(page.locator('[data-testid="tab"][data-focused]')).toHaveAttribute(
    'data-address',
    `${HOST}/work/0.1`,
  );
  // The pane alone takes the whole area.
  const area = (await page.locator('.mx-area').boundingBox())!;
  const cell = (await page.getByTestId('cell').boundingBox())!;
  expect(cell.width).toBeGreaterThan(area.width * 0.95);
  expect(cell.height).toBeGreaterThan(area.height * 0.95);
  // Moving the focus moves the zoom with it, by ] or by Ctrl with an arrow
  // from the input line.
  await page.getByTestId('input').focus();
  await page.keyboard.press('Control+ArrowRight');
  await expect(page.locator('[data-testid="tab"][data-focused]')).toHaveAttribute(
    'data-address',
    `${HOST}/work/0.0`,
  );
  await expect(page.getByTestId('cell')).toHaveCount(1);
  await page.keyboard.press('Control+ArrowLeft');
  await expect(page.locator('[data-testid="tab"][data-focused]')).toHaveAttribute(
    'data-address',
    `${HOST}/work/0.1`,
  );
  await page.keyboard.press(']');
  await expect(page.locator('[data-testid="tab"][data-focused]')).toHaveAttribute(
    'data-address',
    `${HOST}/work/0.0`,
  );
  await expect(page.getByTestId('cell')).toHaveCount(1);
  await page.getByTestId('cell-screen').dblclick();
  await expect(page.getByTestId('cell')).toHaveCount(2);
  await expect(page.getByTestId('zoom')).toHaveAttribute('data-on', '0');
  await page.keyboard.press('z');
  await expect(page.getByTestId('cell')).toHaveCount(1);
  await page.keyboard.press('z');
  await expect(page.getByTestId('cell')).toHaveCount(2);
  // The icon does the same.
  await page.getByTestId('zoom').click();
  await expect(page.getByTestId('cell')).toHaveCount(1);
  await page.getByTestId('zoom').click();
  await expect(page.getByTestId('cell')).toHaveCount(2);
  await expect(page).toHaveURL(new RegExp(`/w/${HOST}/work/0$`));

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
