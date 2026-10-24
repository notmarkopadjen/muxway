import { expect, test } from '@playwright/test';
import { control, HOST, signIn } from './fixtures';

test('66 typing goes to the focused pane only', async ({ page, request }) => {
  await signIn(page);
  await page.goto(`/w/${HOST}/work/0`);
  await expect(page.getByTestId('cell')).toHaveCount(2);
  await expect(page.locator('[data-testid="tab"][data-focused]')).toHaveAttribute(
    'data-address',
    `${HOST}/work/0.0`,
  );
  await page.keyboard.press(']');
  await expect(page.locator('[data-testid="tab"][data-focused]')).toHaveAttribute(
    'data-address',
    `${HOST}/work/0.1`,
  );
  await page.keyboard.press('[');
  await expect(page.locator('[data-testid="tab"][data-focused]')).toHaveAttribute(
    'data-address',
    `${HOST}/work/0.0`,
  );
  await page.getByTestId('input').fill('echo only-here-$((60+6))');
  await page.getByTestId('input').press('Enter');
  await expect
    .poll(() => control(request, '/capture', { target: 'work:0.0' }))
    .toContain('only-here-66');
  expect(await control(request, '/capture', { target: 'work:0.1' })).not.toContain('only-here');
  await page.locator('[data-pane]').nth(1).locator('.mx-cell-head').click();
  await expect(page.locator('[data-testid="tab"][data-focused]')).toHaveAttribute(
    'data-address',
    `${HOST}/work/0.1`,
  );
  // A tab of the strip focuses its pane too.
  await page.locator(`[data-testid="tab"][data-address="${HOST}/work/0.0"]`).click();
  await expect(page.locator('[data-testid="tab"][data-focused]')).toHaveAttribute(
    'data-address',
    `${HOST}/work/0.0`,
  );
});
