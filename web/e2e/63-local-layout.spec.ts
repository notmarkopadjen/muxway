import { expect, test } from '@playwright/test';
import { control, HOST, shot, signIn } from './fixtures';

test('63 drag, hide and reset change only the browser', async ({ page, request }, info) => {
  const layoutBefore = await control(request, '/layout', { target: 'work:0' });
  const resizes: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/resize')) resizes.push(r.url());
  });
  await signIn(page);
  await page.goto(`/w/${HOST}/work/0`);
  await expect(page.getByTestId('cell')).toHaveCount(2);
  // With fit off nothing reaches the host from here on.
  await page.keyboard.press('f');
  await expect(page.getByTestId('fit')).toHaveAttribute('data-on', '0');
  await expect.poll(() => control(request, '/layout', { target: 'work:0' })).toBe(layoutBefore);
  await page.waitForTimeout(500);
  resizes.length = 0;
  const slots = page.locator('.mx-slot');
  const before = Number(await slots.nth(0).getAttribute('data-fraction'));
  const divider = page.getByTestId('divider').first();
  const vertical = ((await divider.getAttribute('class')) ?? '').includes('mx-divider-v');
  const box = (await divider.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(vertical ? cx : cx + 200, vertical ? cy + 120 : cy, { steps: 8 });
  await page.mouse.up();
  const after = Number(await slots.nth(0).getAttribute('data-fraction'));
  expect(after).toBeGreaterThan(before + 0.05);
  await shot(page, info, '63-local');
  await page.keyboard.press(']');
  await expect(page.getByTestId('focus')).toContainText(`${HOST}/work/0.1`);
  await page.keyboard.press('x');
  await expect(page.getByTestId('cell')).toHaveCount(1);
  await expect(page.getByTestId('hidden')).toContainText('work/0.1');
  await page.reload();
  await expect(page.getByTestId('cell')).toHaveCount(1);
  await page.keyboard.press('0');
  await expect(page.getByTestId('cell')).toHaveCount(2);
  expect(Math.abs(Number(await slots.nth(0).getAttribute('data-fraction')) - before)).toBeLessThan(
    0.001,
  );
  expect(await control(request, '/layout', { target: 'work:0' })).toBe(layoutBefore);
  expect(resizes).toEqual([]);
});
