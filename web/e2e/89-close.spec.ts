import { expect, test } from '@playwright/test';
import { control, HOST, settled, shot, signIn } from './fixtures';

// Closing a pane on its host, where the agent allows it: the header asks,
// y closes it there, n keeps it. Elsewhere × and x close the tile only.

const CLOSE = !!process.env.MX_CLOSE;
const A = `${HOST}/work/0.0`;
const B = `${HOST}/work/0.1`;
const RO = `${HOST}/work/0.2`;

test('89 without the agent flag: × and x close the tile, the host keeps the pane', async ({
  page,
  request,
}) => {
  test.skip(CLOSE, 'the close environment allows closing');
  const LOGS = `${HOST}/work/1.0`;
  await signIn(page);
  await page.goto(`/p/${A},${LOGS}`);
  await expect(page.getByTestId('tile')).toHaveCount(2);
  await settled(page);
  const before = await control(request, '/pane-id', { target: 'work:1.0' });
  await expect(page.getByTestId('close-tile').first()).toHaveAttribute(
    'title',
    /the host does not let clients close panes/,
  );
  await page.keyboard.press(']');
  await page.keyboard.press('x');
  await expect(page.getByTestId('close-ask')).toHaveCount(0);
  await expect(page.getByTestId('tile')).toHaveCount(1);
  expect(await control(request, '/pane-id', { target: 'work:1.0' })).toBe(before);
});

test('89 a read-only pane is never asked about, and its tile only closes', async ({ page }) => {
  test.skip(!CLOSE, 'needs the close environment');
  await signIn(page);
  await page.goto(`/p/${A},${RO}`);
  await expect(page.getByTestId('tile')).toHaveCount(2);
  await settled(page);
  await page.locator(`[data-pane="${RO}"]`).getByTestId('close-tile').click();
  await expect(page.getByTestId('close-ask')).toHaveCount(0);
  await expect(page.getByTestId('tile')).toHaveCount(1);
});

test('89 x asks on the header; n keeps the pane, y closes it on the host', async ({
  page,
  request,
}, info) => {
  test.skip(!CLOSE, 'needs the close environment');
  await signIn(page);
  const id = await control(request, '/pane-id', { target: 'work:0.1' });
  await page.goto(`/p/${A},${B}`);
  await expect(page.getByTestId('tile')).toHaveCount(2);
  await settled(page);
  await page.keyboard.press(']');
  await page.keyboard.press('x');
  const ask = page.getByTestId('close-ask');
  await expect(ask).toContainText(`close the pane on ${HOST}?`);
  await shot(page, info, '89-ask');
  await page.keyboard.press('n');
  await expect(ask).toHaveCount(0);
  await expect(page.getByTestId('tile')).toHaveCount(2);
  expect(await control(request, '/pane-id', { target: id })).toBe(id);
  // The header's × asks the same; y closes the pane on the host.
  await page.locator(`[data-pane="${B}"]`).getByTestId('close-tile').click();
  await page.getByTestId('close-yes').click();
  await expect(page.getByTestId('tile')).toHaveCount(1);
  await expect.poll(() => control(request, '/pane-id', { target: id })).not.toBe(id);
});
