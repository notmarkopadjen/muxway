import { expect, test } from '@playwright/test';
import { control, openPane, releaseWindow, SHELL0, shot, signIn } from './fixtures';

// A writable pane always follows the box it is drawn in. There is
// nothing to turn on, and nothing hands the window back: it keeps the
// size the view gave it.

test('60 the host pane follows the browser, and keeps the size when the view is left', async ({
  page,
  request,
}, info) => {
  const size = () => control(request, '/window-size', { target: 'work:0' });
  await releaseWindow(request, SHELL0);
  await expect.poll(size, { timeout: 10_000 }).toBe('100x30');
  await page.setViewportSize({ width: 1200, height: 800 });
  await signIn(page);
  await openPane(page, SHELL0);
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
  // Leaving the view hands nothing back: the window keeps the size it
  // was given, so the session carries the size it was shown at.
  await page.goto('/');
  await page.waitForTimeout(1500);
  expect(await size()).toBe(narrow);
  // Opening it again finds it as it was: the pane is at the size it had
  // before the view was left, and the window never went back to tmux's.
  await openPane(page, SHELL0);
  await expect(page.getByTestId('pane-size')).toHaveText(
    new RegExp(`^${narrow.split('x')[0]}×\\d+$`),
  );
  await page.waitForTimeout(1200);
  expect(await size()).toBe(narrow);
  // `fit: auto` is the way back, and no client sends it.
  await releaseWindow(request, SHELL0);
  await expect.poll(size, { timeout: 10_000 }).toBe('100x30');
});
