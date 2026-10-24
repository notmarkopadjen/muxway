import { expect, test } from '@playwright/test';
import { control, openPane, SHELL0, shot, signIn } from './fixtures';

test('60 fit on: the host window follows the browser', async ({ page, request }, info) => {
  const size = () => control(request, '/window-size', { target: 'work:0' });
  await page.setViewportSize({ width: 1200, height: 800 });
  await signIn(page);
  await openPane(page, SHELL0);
  await expect(page.getByTestId('fit')).toHaveAttribute('data-on', '1');
  await expect.poll(size, { timeout: 5000 }).toMatch(/^1[2-4]\dx(2\d|3\d)$/);
  const wide = await size();
  await shot(page, info, '60-fit');
  await page.setViewportSize({ width: 800, height: 600 });
  await expect.poll(size, { timeout: 5000 }).not.toBe(wide);
  const narrow = await size();
  expect(Number(narrow.split('x')[0])).toBeLessThan(Number(wide.split('x')[0]));
  // The pane is one of two stacked in the window: its width is the window's, its height is not.
  await expect(page.getByTestId('pane-size')).toContainText(narrow.split('x')[0] + '×');
  // Leaving the pane gives the window back to tmux: the session's own size.
  await page.goto('/');
  await expect.poll(size, { timeout: 5000 }).toBe('100x30');
});
