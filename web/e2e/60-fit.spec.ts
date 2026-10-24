import { expect, test } from '@playwright/test';
import { control, openPane, SHELL0, shot, signIn } from './fixtures';

test('60 fit on: the host pane follows the browser', async ({ page, request }, info) => {
  const size = () => control(request, '/window-size', { target: 'work:0' });
  const layout = await control(request, '/layout', { target: 'work:0' });
  await page.setViewportSize({ width: 1200, height: 800 });
  await signIn(page);
  await openPane(page, SHELL0);
  await expect(page.getByTestId('fit')).toHaveAttribute('data-on', '1');
  // The pane is one of two stacked in the window: the window takes the
  // pane's width, the neighbour gives the rows.
  await expect.poll(size, { timeout: 5000 }).toMatch(/^1[2-4]\dx\d+$/);
  await expect(page.getByTestId('fit')).toHaveText(/fit on \d+×\d+/);
  const fitted = (await page.getByTestId('fit').innerText()).replace(/^fit on /, '');
  await expect(page.getByTestId('pane-size')).toHaveText(fitted);
  const wide = await size();
  expect(wide.split('x')[0]).toBe(fitted.split('×')[0]);
  expect(Number(wide.split('x')[1])).toBeGreaterThan(Number(fitted.split('×')[1]));
  await shot(page, info, '60-fit');
  await page.setViewportSize({ width: 800, height: 600 });
  await expect.poll(size, { timeout: 5000 }).not.toBe(wide);
  const narrow = await size();
  expect(Number(narrow.split('x')[0])).toBeLessThan(Number(wide.split('x')[0]));
  const again = (await page.getByTestId('fit').innerText()).replace(/^fit on /, '');
  await expect(page.getByTestId('pane-size')).toHaveText(again);
  expect(narrow.split('x')[0]).toBe(again.split('×')[0]);
  // Leaving the pane gives the window back to tmux: the session's own size and layout.
  await page.goto('/');
  await expect.poll(size, { timeout: 5000 }).toBe('100x30');
  await expect.poll(() => control(request, '/layout', { target: 'work:0' })).toBe(layout);
});
