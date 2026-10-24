import { expect, test } from '@playwright/test';
import { control, HOST, shot, signIn } from './fixtures';

test('62 the window view mirrors the host layout', async ({ page, request }, info) => {
  await signIn(page);
  await page.goto(`/w/${HOST}/work/0`);
  await expect(page.getByTestId('window')).toBeVisible();
  await expect(page.getByTestId('cell')).toHaveCount(2);
  // Fit is on by default: off, the view mirrors the host and scales to the box.
  await page.keyboard.press('f');
  await expect(page.getByTestId('fit')).toHaveAttribute('data-on', '0');
  await expect.poll(() => control(request, '/window-size', { target: 'work:0' })).toBe('100x30');
  const layout = await control(request, '/layout', { target: 'work:0' });
  await expect(page.getByTestId('window')).toHaveAttribute('data-layout', layout);
  // Expected fractions from the host's own sizes, along the split's axis.
  const m = /([{[])(\d+)x(\d+),\d+,\d+,\d+,(\d+)x(\d+)/.exec(layout)!;
  const horizontal = m[1] === '{';
  const a = Number(horizontal ? m[2] : m[3]);
  const b = Number(horizontal ? m[4] : m[5]);
  const slots = page.locator('.mx-slot');
  const f0 = Number(await slots.nth(0).getAttribute('data-fraction'));
  const f1 = Number(await slots.nth(1).getAttribute('data-fraction'));
  expect(Math.abs(f0 - a / (a + b))).toBeLessThan(0.02);
  expect(Math.abs(f1 - b / (a + b))).toBeLessThan(0.02);
  const b0 = (await slots.nth(0).boundingBox())!;
  const b1 = (await slots.nth(1).boundingBox())!;
  const s0 = horizontal ? b0.width : b0.height;
  const s1 = horizontal ? b1.width : b1.height;
  expect(Math.abs(s0 / (s0 + s1) - a / (a + b))).toBeLessThan(0.03);
  // Each pane is scaled to its box: well above the floor in a 1200 px window.
  for (const screen of await page.getByTestId('cell-screen').all()) {
    expect(Number(await screen.getAttribute('data-font'))).toBeGreaterThan(9);
  }
  await expect(page.locator('[data-testid="tab"][data-focused]')).toHaveAttribute(
    'data-address',
    `${HOST}/work/0.0`,
  );
  await shot(page, info, '62-window');
});
