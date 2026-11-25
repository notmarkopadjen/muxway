import { expect, test } from '@playwright/test';
import { atRest, control, openPane, releaseWindow, SHELL0, shot, signIn, TOKEN } from './fixtures';

test('77 a key typed here takes the window back from the client that sized it', async ({
  page,
  request,
}, info) => {
  const size = () => control(request, '/window-size', { target: 'work:0' });
  // From the window's own size, whatever the spec before left.
  await releaseWindow(request, SHELL0);
  await expect.poll(size, { timeout: 10_000 }).toBe('100x30');
  await page.setViewportSize({ width: 1200, height: 800 });
  await signIn(page);
  await openPane(page, SHELL0);
  await expect.poll(size, { timeout: 5000 }).not.toBe('100x30');
  const width = (await size()).split('x')[0];
  await expect(page.getByTestId('pane-size')).toHaveText(new RegExp(`^${width}×\\d+$`));
  const fitted = await page.getByTestId('pane-size').innerText();
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
  // A key sent from here is a command: the host puts the window back to
  // the size this client is showing it at, with no resize of its own.
  await page.getByTestId('keybar').getByRole('button', { name: 'Escape' }).click();
  await expect(page.getByTestId('pane-size')).toHaveText(fitted, { timeout: 10_000 });
  expect((await size()).split('x')[0]).toBe(width);
  await page.goto('/');
  await atRest(request, 'work:0');
});
