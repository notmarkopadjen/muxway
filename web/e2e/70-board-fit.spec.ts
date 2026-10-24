import { expect, test } from '@playwright/test';
import { control, HOST, seedBoard, signIn } from './fixtures';

test('70 fit on one cell sizes that pane alone', async ({ page, request }) => {
  const A = `${HOST}/work/0.0`;
  const B = `${HOST}/work/1.0`;
  const size = (t: string) => control(request, '/window-size', { target: t });
  const layout1 = await control(request, '/layout', { target: 'work:1' });
  const bodies: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/resize')) bodies.push(r.postData() ?? '');
  });
  await page.setViewportSize({ width: 1200, height: 800 });
  await signIn(page);
  await seedBoard(page, 'main', [A, B]);
  await page.goto('/b/main');
  await expect(page.getByTestId('cell')).toHaveCount(2);
  await expect(page.getByTestId('focus')).toContainText(A);
  await page.keyboard.press('f');
  const fit = page.locator(`[data-pane="${A}"]`).getByTestId('cell-fit');
  await expect(fit).toHaveAttribute('data-on', '1');
  await expect(fit).toHaveText(/fit \d+×\d+/, { timeout: 5000 });
  const fitted = (await fit.innerText()).replace(/^fit /, '');
  // Pane 0.0 shares its window with 0.1: the window takes the pane's width.
  await expect.poll(() => size('work:0')).toMatch(new RegExp(`^${fitted.split('×')[0]}x`));
  await expect(page.locator(`[data-pane="${A}"]`).locator('.mx-cell-head')).toContainText(fitted);
  expect(bodies.every((b) => b.includes('"scope":"pane"'))).toBe(true);
  expect(await size('work:1')).toBe('100x30');
  expect(await control(request, '/layout', { target: 'work:1' })).toBe(layout1);
  // Leaving the board releases the pane.
  await page.goto('/');
  await expect.poll(() => size('work:0'), { timeout: 5000 }).toBe('100x30');
});
