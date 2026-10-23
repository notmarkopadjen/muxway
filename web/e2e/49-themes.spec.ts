import { expect, test } from '@playwright/test';
import { openPane, SHELL0, shot, signIn } from './fixtures';

test('49 themes and a phone', async ({ page }, info) => {
  await signIn(page);
  await openPane(page, SHELL0);
  const html = page.locator('html');
  await shot(page, info, '49-green');
  await page.keyboard.press('t');
  await expect(html).toHaveAttribute('data-theme', 'amber');
  await shot(page, info, '49-amber');
  await page.keyboard.press('t');
  await expect(html).toHaveAttribute('data-theme', 'paper');
  await shot(page, info, '49-paper');
  await page.keyboard.press('t');
  await expect(html).toHaveAttribute('data-theme', '');
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/');
  await expect(page.getByTestId('panes')).toBeVisible();
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(360);
  await shot(page, info, '49-phone');
  await openPane(page, SHELL0);
  await expect(page.getByTestId('keybar')).toBeVisible();
  await shot(page, info, '49-phone-pane');
});
