import { expect, test } from '@playwright/test';
import { control, openPane, SHELL0, shot, signIn, TOKEN } from './fixtures';

test("77 refit sends this client's size again after another client sized the window", async ({
  page,
  request,
}, info) => {
  const size = () => control(request, '/window-size', { target: 'work:0' });
  await page.setViewportSize({ width: 1200, height: 800 });
  await signIn(page);
  await openPane(page, SHELL0);
  await expect(page.getByTestId('fit')).toHaveAttribute('data-on', '1');
  await expect(page.getByTestId('fit')).toHaveText(/fit on \d+×\d+/, { timeout: 5000 });
  const fitted = (await page.getByTestId('fit').innerText()).replace(/^fit on /, '');
  await expect(page.getByTestId('pane-size')).toHaveText(fitted);
  const width = (await size()).split('x')[0];
  // Another client, with its own token, sizes the same window.
  await page.waitForTimeout(1100);
  const r = await request.post(`/v1/panes/${SHELL0}/resize`, {
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    data: { cols: 60, rows: 20, scope: 'window' },
  });
  expect(r.status()).toBe(200);
  await expect.poll(size).toBe('60x20');
  await page.waitForTimeout(1100);
  await shot(page, info, '77-other-client');
  await page.getByTestId('refit').click();
  // The pane has this client's size again; the window its width.
  await expect(page.getByTestId('pane-size')).toHaveText(fitted, { timeout: 5000 });
  expect((await size()).split('x')[0]).toBe(width);
  // The key does the same.
  await page.waitForTimeout(1100);
  await request.post(`/v1/panes/${SHELL0}/resize`, {
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    data: { cols: 60, rows: 20, scope: 'window' },
  });
  await expect.poll(size).toBe('60x20');
  await page.waitForTimeout(1100);
  await page.keyboard.press('r');
  await expect(page.getByTestId('pane-size')).toHaveText(fitted, { timeout: 5000 });
  expect((await size()).split('x')[0]).toBe(width);
  await page.goto('/');
  await expect.poll(size, { timeout: 5000 }).toBe('100x30');
});
