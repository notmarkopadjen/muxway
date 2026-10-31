import { expect, test } from '@playwright/test';
import { control, HOST, settled, shot, signIn } from './fixtures';

// Closing the only pane of a session ends the session, and the header
// asks about the session instead; a pane with siblings gets the plain
// question.

const CLOSE = !!process.env.MX_CLOSE;
const SOLO = `${HOST}/solo/0.0`;
const A = `${HOST}/work/0.0`;

test('110 the last pane of a session asks about the session, and y ends it', async ({
  page,
  request,
}, info) => {
  test.skip(!CLOSE, 'needs the close environment');
  await signIn(page);
  const id = await control(request, '/pane-id', { target: 'solo:0.0' });
  await page.goto(`/p/${A},${SOLO}`);
  await expect(page.getByTestId('tile')).toHaveCount(2);
  await settled(page);
  await page.locator(`[data-pane="${SOLO}"]`).getByTestId('close-tile').click();
  const ask = page.getByTestId('close-ask');
  await expect(ask).toContainText(`end session solo on ${HOST}?`);
  await shot(page, info, '110-last-pane');
  await page.keyboard.press('n');
  await expect(ask).toHaveCount(0);
  await expect(page.getByTestId('tile')).toHaveCount(2);
  expect(await control(request, '/pane-id', { target: id })).toBe(id);
  await page.locator(`[data-pane="${SOLO}"]`).getByTestId('close-tile').click();
  await expect(ask).toContainText('end session solo');
  await page.getByTestId('close-yes').click();
  await expect(page.getByTestId('tile')).toHaveCount(1);
  await expect.poll(() => control(request, '/pane-id', { target: id })).not.toBe(id);
});

test('110 a pane with siblings gets the plain question', async ({ page }) => {
  test.skip(!CLOSE, 'needs the close environment');
  await signIn(page);
  await page.goto(`/p/${A}`);
  await expect(page.getByTestId('tile')).toHaveCount(1);
  await settled(page);
  await page.keyboard.press('x');
  const ask = page.getByTestId('close-ask');
  await expect(ask).toContainText(`close the pane on ${HOST}?`);
  await expect(ask).not.toContainText('end session');
  await page.keyboard.press('n');
  await expect(ask).toHaveCount(0);
});
