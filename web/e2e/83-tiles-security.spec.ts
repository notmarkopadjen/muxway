import { expect, test } from '@playwright/test';
import { control, HOST, RO_TOKEN, SHELL0, signIn } from './fixtures';

test('83 tiles: a read-only token types nowhere; a bad route asks the hub for nothing', async ({
  page,
  request,
}) => {
  const size = await control(request, '/window-size', { target: 'work:0' });
  await signIn(page, RO_TOKEN);
  await page.goto(`/p/${SHELL0},${HOST}/work/0.1`);
  await expect(page.getByTestId('tile')).toHaveCount(2);
  await expect(page.getByTestId('pane').locator('.mx-mode')).toHaveCount(2);
  await expect(page.getByTestId('input')).toBeDisabled();
  await expect(page.getByTestId('readonly')).toBeVisible();
  await expect(page.getByTestId('fit')).toHaveCount(0);
  await expect(page.getByTestId('tile-fit')).toHaveCount(0);
  // A click on either tile's screen sends nothing: no mouse request, the pane unchanged.
  const before = await control(request, '/capture', { target: 'work:0.0' });
  const inputs: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/input')) inputs.push(r.url());
  });
  await page.getByTestId('screen').click();
  await page.getByTestId('cell-screen').click();
  await page.waitForTimeout(600);
  expect(inputs).toEqual([]);
  expect(await control(request, '/capture', { target: 'work:0.0' })).toBe(before);
  // The size the host has is left alone: no fit on a read-only pane.
  await page.waitForTimeout(1000);
  expect(await control(request, '/window-size', { target: 'work:0' })).toBe(size);

  // Five addresses, a traversal, markup: refused in the browser, before any request.
  const reads: string[] = [];
  page.on('request', (r) => {
    const u = r.url();
    if (/\/v1\/panes\/.+/.test(u) && !u.includes(SHELL0) && !u.includes('work/0.1')) reads.push(u);
  });
  const five = Array.from({ length: 5 }, (_, i) => `${HOST}/work/${i}.0`).join(',');
  await page.goto(`/p/${five}`);
  await expect(page.getByTestId('pane-error')).toContainText('up to 4');
  await page.goto('/p/..%2F..%2Fetc%2Fpasswd');
  await expect(page.getByTestId('pane-error')).toBeVisible();
  await page.goto(`/p/${encodeURIComponent('<img src=x onerror=alert(1)>')}/a/1.0`);
  await expect(page.getByTestId('pane-error')).toBeVisible();
  await page.goto(`/p/${SHELL0},${SHELL0}`);
  await expect(page.getByTestId('pane-error')).toContainText('twice');
  expect(reads).toEqual([]);
});
