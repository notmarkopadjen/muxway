import { expect, test, type Page } from '@playwright/test';
import { control, HOST, openPane, settled, shot, signIn } from './fixtures';

// Who holds a window's size, and the client touched last wins: a pane
// another client fitted says "held by handset · Pixel 9" in its header and
// sends nothing while nobody touches it here; typing into it sends this
// browser's fit once more, with its own label, and the header clears;
// a tile whose size this browser holds never refits on typing.
// docs/plans/2026-11-09-size-holder.md.

const LOGS = `${HOST}/work/1.0`;

interface Resize {
  address: string;
  body: Record<string, unknown>;
}
function watchResizes(page: Page): Resize[] {
  const out: Resize[] = [];
  page.on('request', (r) => {
    const m = r.url().match(/\/v1\/panes\/(.+)\/resize$/);
    if (m && r.method() === 'POST')
      out.push({ address: decodeURIComponent(m[1]), body: JSON.parse(r.postData() ?? '{}') });
  });
  return out;
}
const fitsOf = (rs: Resize[], address: string) =>
  rs.filter((r) => r.address === address && r.body.fit !== 'auto');

test('126 another client holds the pane: the header names it, idle sends nothing, typing takes the size back', async ({
  page,
  request,
}, info) => {
  const resizes = watchResizes(page);
  await signIn(page);
  await openPane(page, LOGS);
  await settled(page);
  // This browser's fit landed with its label, and nobody else holds.
  await expect.poll(() => fitsOf(resizes, LOGS).length, { timeout: 10_000 }).toBeGreaterThan(0);
  expect(fitsOf(resizes, LOGS).at(-1)?.body.client).toBe('Chrome');
  await expect(page.getByTestId('held')).toHaveCount(0);
  // Another client, the phone, fits the window to a size this tile did not ask.
  const held = await control(request, '/hold', {
    address: LOGS,
    cols: '60',
    rows: '12',
    client: 'Pixel 9',
  });
  expect(held).toBe('200');
  await expect(page.getByTestId('held')).toHaveText('held by handset · Pixel 9', {
    timeout: 15_000,
  });
  await shot(page, info, 'held-by');
  // Idle: three seconds with nobody touching the pane here sends no fit.
  const before = fitsOf(resizes, LOGS).length;
  await page.waitForTimeout(3000);
  expect(fitsOf(resizes, LOGS).length).toBe(before);
  await expect(page.getByTestId('held')).toHaveText('held by handset · Pixel 9');
  // Typing into the pane here is the touch: one fit more, this browser's, and the header clears.
  const input = page.getByTestId('input');
  await input.fill('echo touched');
  await input.press('Enter');
  await expect.poll(() => fitsOf(resizes, LOGS).length, { timeout: 10_000 }).toBe(before + 1);
  expect(fitsOf(resizes, LOGS).at(-1)?.body.client).toBe('Chrome');
  await expect(page.getByTestId('held')).toHaveCount(0, { timeout: 15_000 });
  await shot(page, info, 'held-by-taken');
  // This browser holds now: more typing sends no fit.
  const after = fitsOf(resizes, LOGS).length;
  await input.fill('echo again');
  await input.press('Enter');
  await page.waitForTimeout(2500);
  expect(fitsOf(resizes, LOGS).length).toBe(after);
});
