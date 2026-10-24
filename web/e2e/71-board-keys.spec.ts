import { expect, test } from '@playwright/test';
import { control, HOST, seedBoard, signIn } from './fixtures';

test('71 board keys: focus, typing to the focused pane, zoom, open', async ({ page, request }) => {
  const A = `${HOST}/work/0.0`;
  const B = `${HOST}/work/1.0`;
  await signIn(page);
  await seedBoard(page, 'main', [A, B]);
  await page.goto('/b/main');
  await expect(page.getByTestId('cell')).toHaveCount(2);
  await expect(page.getByTestId('focus')).toContainText(A);
  await page.keyboard.press(']');
  await expect(page.getByTestId('focus')).toContainText(B);
  // Ctrl with an arrow moves the focus too, from the input line.
  await page.getByTestId('input').focus();
  await page.keyboard.press('Control+ArrowLeft');
  await expect(page.getByTestId('focus')).toContainText(A);
  await page.keyboard.press('Control+ArrowRight');
  await expect(page.getByTestId('focus')).toContainText(B);
  await page.getByTestId('input').fill('echo only-board-$((70+1))');
  await page.getByTestId('input').press('Enter');
  await expect
    .poll(() => control(request, '/capture', { target: 'work:1.0' }))
    .toContain('only-board-71');
  expect(await control(request, '/capture', { target: 'work:0.0' })).not.toContain('only-board');
  await page.getByTestId('input').blur();
  await page.keyboard.press('z');
  await expect(page.getByTestId('cell')).toHaveCount(1);
  await expect(page.getByTestId('unzoom')).toBeVisible();
  await page.keyboard.press('z');
  await expect(page.getByTestId('cell')).toHaveCount(2);
  // The cells come back with their opening animation; click once it is over.
  await page.waitForTimeout(700);
  await page
    .locator(`[data-pane="${A}"]`)
    .locator('.mx-cell-head span', { hasText: 'bash' })
    .first()
    .click();
  await expect(page.getByTestId('focus')).toContainText(A);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/p/${A}$`));
  // From a pane, b puts it on the board and goes there.
  await page.keyboard.press('b');
  await expect(page).toHaveURL(/\/b\/main$/);
  await expect(page.getByTestId('cell')).toHaveCount(2);
});
