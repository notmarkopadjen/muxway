import { expect, test } from '@playwright/test';
import { HOST, RO_TOKEN, seedBoard, signIn } from './fixtures';

// A board is a list of addresses in the browser; the hub still decides.
test('73 a board shows nothing the session may not read', async ({ page }) => {
  const resizes: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/resize')) resizes.push(r.url());
  });
  await signIn(page, RO_TOKEN);
  await seedBoard(page, 'sec', [`${HOST}/work/0.0`, 'bob-desktop/work/0.0', `${HOST}/work/9.9`]);
  // A malformed board is dropped, not rendered.
  await page.evaluate(() =>
    localStorage.setItem(
      'mx-board:bad',
      '{"layout":{"kind":"h","children":[{"kind":"pane","id":"../../etc"}]}}',
    ),
  );
  await page.goto('/b/sec');
  await expect(page.getByTestId('cell')).toHaveCount(1);
  await expect(page.getByTestId('gap')).toHaveCount(2);
  for (const gap of await page.getByTestId('gap').all())
    await expect(gap).toContainText('gone, or not yours to see');
  await expect(page.getByTestId('cell-screen').first()).toContainText('$');
  // Read-only: no fit, no input.
  await page.keyboard.press('f');
  await page.keyboard.press('F');
  await page.waitForTimeout(800);
  expect(resizes).toEqual([]);
  await expect(page.getByTestId('cell-fit')).toHaveCount(0);
  await expect(page.getByTestId('input')).toBeDisabled();
  await page.goto('/b/bad');
  await expect(page.getByTestId('board-empty')).toBeVisible();
  await page.goto('/b/Not%20A%20Name!');
  await expect(page.getByTestId('board-error')).toBeVisible();
});
