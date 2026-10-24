import { expect, test } from '@playwright/test';
import { control, HOST, seedBoard, shot, signIn } from './fixtures';

test('69 rearrange a board: drag, swap, scale, remove; it survives a reload', async ({
  page,
  request,
}, info) => {
  const A = `${HOST}/work/0.0`;
  const B = `${HOST}/work/1.0`;
  const layouts = async () => [
    await control(request, '/layout', { target: 'work:0' }),
    await control(request, '/layout', { target: 'work:1' }),
  ];
  const before = await layouts();
  const resizes: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/resize')) resizes.push(r.url());
  });
  await page.setViewportSize({ width: 1200, height: 800 });
  await signIn(page);
  await seedBoard(page, 'main', [A, B]);
  await page.goto('/b/main');
  await expect(page.getByTestId('cell')).toHaveCount(2);
  const slots = page.locator('.mx-slot');
  expect(Number(await slots.nth(0).getAttribute('data-fraction'))).toBeCloseTo(0.5, 2);
  const divider = page.getByTestId('divider').first();
  const box = (await divider.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 200, cy, { steps: 8 });
  await page.mouse.up();
  const after = Number(await slots.nth(0).getAttribute('data-fraction'));
  expect(after).toBeGreaterThan(0.6);
  await shot(page, info, '69-board-arranged');
  await page.keyboard.press('s');
  await expect(page.getByTestId('board')).toHaveAttribute('data-panes', `${B} ${A}`);
  // The shares stay with the slots, not the panes.
  expect(Number(await slots.nth(0).getAttribute('data-fraction'))).toBeCloseTo(after, 3);
  await page.keyboard.press(']');
  await expect(page.getByTestId('focus')).toContainText(A);
  const screen = page.locator(`[data-pane="${A}"]`).getByTestId('cell-screen');
  const font = Number(await screen.getAttribute('data-font'));
  await page.keyboard.press('+');
  await expect
    .poll(async () => Number(await screen.getAttribute('data-font')))
    .toBeGreaterThan(font);
  await page.keyboard.press('=');
  expect(Number(await slots.nth(0).getAttribute('data-fraction'))).toBeCloseTo(0.5, 2);
  await page.keyboard.press('x');
  await expect(page.getByTestId('cell')).toHaveCount(1);
  await expect(page.getByTestId('board')).toHaveAttribute('data-panes', B);
  await page.reload();
  await expect(page.getByTestId('cell')).toHaveCount(1);
  await expect(page.getByTestId('board')).toHaveAttribute('data-panes', B);
  expect(await layouts()).toEqual(before);
  expect(resizes).toEqual([]);
});
