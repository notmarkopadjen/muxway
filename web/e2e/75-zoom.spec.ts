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
  await expect(page.getByTestId('unzoom')).toBeVisible();
  await expect(page.getByTestId('focus')).toContainText(`${HOST}/work/0.1`);
  // Moving the focus moves the zoom with it.
  await page.keyboard.press(']');
  await expect(page.getByTestId('focus')).toContainText(`${HOST}/work/0.0`);
  await expect(page.getByTestId('cell')).toHaveCount(1);
  await page.getByTestId('cell-screen').dblclick();
  await expect(page.getByTestId('cell')).toHaveCount(2);
  await expect(page.getByTestId('unzoom')).toHaveCount(0);
  await page.keyboard.press('z');
  await expect(page.getByTestId('cell')).toHaveCount(1);
  await page.keyboard.press('z');
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
  await page.getByTestId('cell-screen').dblclick();
  await expect(page.getByTestId('cell')).toHaveCount(2);
  await expect(page).toHaveURL(/\/b\/main$/);
});
