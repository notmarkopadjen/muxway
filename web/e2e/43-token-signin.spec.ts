import { expect, test } from '@playwright/test';
import { shot, TOKEN, profile } from './fixtures';

// With a peer named (the harness's second hub) the cookie travels to it:
// SameSite=None; on a hub without peers it stays on its site.
const PEERS = !!process.env.MX_HUB2;

test('43 token sign-in, session survives a reload, logout', async ({ page }, info) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/signin$/);
  await expect(page.getByTestId('signin')).toBeVisible();
  await shot(page, info, '43-signin');
  await page.getByTestId('token').fill('mxt_not_a_token_at_all');
  await page.getByTestId('token-submit').click();
  await expect(page.getByTestId('signin-error')).toContainText('not accepted');
  await page.getByTestId('token').fill(TOKEN);
  await page.getByTestId('token-submit').click();
  await expect(page.getByTestId('panes')).toBeVisible();
  await expect(page.getByTestId('who')).toContainText('browser');
  await shot(page, info, '43-panes');
  await page.reload();
  await expect(page.getByTestId('panes')).toBeVisible();
  const cookies = await page.context().cookies();
  const session = cookies.find((c) => c.name === 'muxway_session');
  expect(session?.httpOnly).toBe(true);
  expect(session?.secure).toBe(true);
  expect(session?.sameSite).toBe(PEERS ? 'None' : 'Strict');
  await profile(page, 'logout');
  await expect(page).toHaveURL(/\/signin$/);
  await page.goto('/');
  await expect(page).toHaveURL(/\/signin$/);
});
