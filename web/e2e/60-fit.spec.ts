import { expect, test } from '@playwright/test';
import { control, openPane, SHELL0, shot, signIn } from './fixtures';

test('60 fit on: the host pane follows the browser', async ({ page, request }, info) => {
  const size = () => control(request, '/window-size', { target: 'work:0' });
  const layout = await control(request, '/layout', { target: 'work:0' });
  await page.setViewportSize({ width: 1200, height: 800 });
  await signIn(page);
  await openPane(page, SHELL0);
  await expect(page.getByTestId('fit')).toHaveAttribute('data-on', '1');
  // The pane is one of two stacked in the window: alone in the view it
  // takes the window, zoomed, so the window is the pane's size.
  await expect.poll(size, { timeout: 5000 }).toMatch(/^1[2-4]\dx\d+$/);
  await expect(page.getByTestId('pane-size')).toHaveText(/^1[2-4]\d×\d+$/);
  const fitted = await page.getByTestId('pane-size').innerText();
  const wide = await size();
  expect(wide.split('x')[0]).toBe(fitted.split('×')[0]);
  expect(wide.split('x')[1]).toBe(fitted.split('×')[1]);
  expect(await control(request, '/zoomed', { target: 'work:0' })).toBe('1');
  await shot(page, info, '60-fit');
  await page.setViewportSize({ width: 800, height: 600 });
  await expect.poll(size, { timeout: 5000 }).not.toBe(wide);
  const narrow = await size();
  expect(Number(narrow.split('x')[0])).toBeLessThan(Number(wide.split('x')[0]));
  await expect(page.getByTestId('pane-size')).toHaveText(
    new RegExp(`^${narrow.split('x')[0]}×\\d+$`),
  );
  const again = await page.getByTestId('pane-size').innerText();
  expect(narrow.split('x')[0]).toBe(again.split('×')[0]);
  // Leaving the pane gives the window back to tmux: the session's own size and layout.
  await page.goto('/');
  await expect.poll(size, { timeout: 5000 }).toBe('100x30');
  await expect.poll(() => control(request, '/layout', { target: 'work:0' })).toBe(layout);
});
