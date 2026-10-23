import { expect, test } from '@playwright/test';
import {
  alerts,
  control,
  HOST,
  openPane,
  SHELL0,
  shot,
  signIn,
  violations,
  watchPage,
} from './fixtures';

test('40 hostile names, content and event text render as text', async ({ page, request }, info) => {
  await watchPage(page);
  const bad = '<img src=x onerror=alert(1)>';
  await control(request, '/rename', {
    what: 'window',
    target: 'work:1',
    name: `<script>alert(2)</script>`,
  });
  await control(request, '/rename', { what: 'title', target: 'work:0.0', name: bad });
  await control(request, '/send', {
    target: 'work:0.0',
    text: `printf '%s\\n' '${bad}' $'\\x1b[31mred\\x1b[0m'`,
  });
  const pane = await control(request, '/pane-id', { target: 'work:0.0' });
  await signIn(page);
  await expect(page.getByText('<script>alert(2)</script>')).toBeVisible();
  await control(request, '/notify', { pane, kind: 'question', text: '<b>bold?</b> & "quoted"' });
  await expect(page.getByTestId('toast')).toContainText('<b>bold?</b> & "quoted"');
  await openPane(page, SHELL0);
  await expect(page.getByTestId('screen')).toContainText(bad);
  await expect(page.locator('.mx-screen .fg1')).toContainText('red');
  await shot(page, info, '40-hostile');
  expect(await alerts(page)).toBe(0);
  expect(await violations(page)).toEqual([]);
  expect(await page.locator('img').count()).toBe(0);
  expect(await page.locator('script:not([src])').count()).toBe(0);
  await control(request, '/rename', { what: 'window', target: `work:1`, name: 'logs' });
  await control(request, '/rename', { what: 'title', target: 'work:0.0', name: 'test-pane' });
  void HOST;
});
