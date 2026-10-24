import { expect, test } from '@playwright/test';
import { control, HOST, shot, signIn } from './fixtures';

// The first split of the host's layout, as the fraction of its first child.
async function hostFraction(request: Parameters<typeof control>[0]) {
  const layout = await control(request, '/layout', { target: 'work:0' });
  const m = /([{[])(\d+)x(\d+),\d+,\d+,\d+,(\d+)x(\d+)/.exec(layout)!;
  const horizontal = m[1] === '{';
  const a = Number(horizontal ? m[2] : m[3]);
  const b = Number(horizontal ? m[4] : m[5]);
  return a / (a + b);
}

test("76 fit on in the window view: the host takes the browser's dividers", async ({
  page,
  request,
}, info) => {
  const size = () => control(request, '/window-size', { target: 'work:0' });
  const layoutBefore = await control(request, '/layout', { target: 'work:0' });
  await page.setViewportSize({ width: 1200, height: 800 });
  await signIn(page);
  await page.goto(`/w/${HOST}/work/0`);
  await expect(page.getByTestId('cell')).toHaveCount(2);
  await expect(page.getByTestId('fit')).toHaveAttribute('data-on', '1');
  await expect.poll(size, { timeout: 5000 }).not.toBe('100x30');
  const slots = page.locator('.mx-slot');
  const divider = page.getByTestId('divider').first();
  const vertical = ((await divider.getAttribute('class')) ?? '').includes('mx-divider-v');
  const box = (await divider.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(vertical ? cx : cx + 200, vertical ? cy + 150 : cy, { steps: 8 });
  await page.mouse.up();
  const want = Number(await slots.nth(0).getAttribute('data-fraction'));
  expect(want).toBeGreaterThan(0.6);
  // The host's split follows the browser's, within a few per cent.
  await expect.poll(() => hostFraction(request), { timeout: 5000 }).toBeCloseTo(want, 1);
  await shot(page, info, '76-window-fit');
  // The host's new sizes do not reset the browser's arrangement.
  await page.waitForTimeout(1500);
  expect(Number(await slots.nth(0).getAttribute('data-fraction'))).toBeCloseTo(want, 2);
  // Leaving gives the window back: its own size and layout.
  await page.goto('/');
  await expect.poll(size, { timeout: 5000 }).toBe('100x30');
  await expect.poll(() => control(request, '/layout', { target: 'work:0' })).toBe(layoutBefore);
});
