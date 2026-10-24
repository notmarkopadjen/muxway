import { expect, test } from '@playwright/test';
import { control, openPane, SHELL0, signIn } from './fixtures';

test('61 fit off: nothing is sent, the pane is scaled', async ({ page, request }) => {
  const resizes: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/resize'))
      resizes.push(r.method() + ' ' + new URL(r.url()).pathname + ' ' + r.postData());
  });
  await signIn(page);
  await openPane(page, SHELL0);
  await page.getByTestId('fit').click();
  await expect(page.getByTestId('fit')).toHaveAttribute('data-on', '0');
  const released = resizes.length; // turning fit off releases once
  const size = await control(request, '/window-size', { target: 'work:0' });
  await page.setViewportSize({ width: 700, height: 500 });
  await page.waitForTimeout(1200);
  expect(resizes.length).toBe(released);
  expect(await control(request, '/window-size', { target: 'work:0' })).toBe(size);
  const font1 = await page.getByTestId('screen').getAttribute('data-font');
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.waitForTimeout(500);
  const font2 = await page.getByTestId('screen').getAttribute('data-font');
  expect(Number(font2)).toBeGreaterThan(Number(font1));
  expect(resizes.length).toBe(released);
});
