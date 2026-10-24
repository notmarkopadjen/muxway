import { expect, test } from '@playwright/test';
import { control, openPane, RO_TOKEN, SHELL0, shot, signIn } from './fixtures';

test('87 security: a read-only grant sees the command row but cannot use it', async ({ page }) => {
  await signIn(page, RO_TOKEN);
  await openPane(page, SHELL0);
  const bar = page.getByTestId('cmdbar');
  await expect(bar).toHaveAttribute('data-kind', 'shell');
  const buttons = bar.getByTestId('cmd');
  expect(await buttons.count()).toBeGreaterThan(5);
  for (const b of await buttons.all()) await expect(b).toBeDisabled();
});

test('87 the command row: a shell, its recent lines, Claude, and nothing for another program', async ({
  page,
  request,
}, info) => {
  await signIn(page);
  await openPane(page, SHELL0);
  const bar = page.getByTestId('cmdbar');
  const buttons = bar.getByTestId('cmd');
  await expect(bar).toHaveAttribute('data-kind', 'shell');
  await expect(buttons.first()).toHaveText('exit');
  await expect(bar.getByRole('button', { name: 'htop', exact: true })).toBeEnabled();
  await expect(bar.getByRole('button', { name: 'claude', exact: true })).toBeEnabled();
  // One row, scrolling sideways, never wrapping.
  expect(await bar.evaluate((el) => getComputedStyle(el).flexWrap)).toBe('nowrap');
  const fixed = await buttons.count();
  // A line sent to the shell joins the row, newest first, and sends again when clicked.
  await page.getByTestId('input').fill('echo from the row');
  await page.getByTestId('input').press('Enter');
  const capture = () => control(request, '/capture', { target: 'work:0.0' });
  await expect.poll(capture, { timeout: 5000 }).toContain('from the row');
  await expect(buttons).toHaveCount(fixed + 1);
  await expect(buttons.nth(fixed)).toHaveText('echo from the row');
  await buttons.nth(fixed).click();
  await expect
    .poll(async () => (await capture()).split('$ echo from the row').length - 1, { timeout: 5000 })
    .toBe(2);
  await page.reload();
  await expect(bar.getByTestId('cmd')).toHaveCount(fixed + 1);
  await shot(page, info, '87-shell-row');
  // Claude Code in the pane: its slash commands, one sent whole, one filling the line.
  await control(request, '/rename', { what: 'title', target: 'work:0.0', name: '✳ building' });
  await expect(bar).toHaveAttribute('data-kind', 'claude', { timeout: 10_000 });
  await expect(buttons.first()).toHaveText('/clear');
  await expect(bar.locator('.mx-mark-claude')).toBeVisible();
  await shot(page, info, '87-claude-row');
  await bar.getByRole('button', { name: '/usage', exact: true }).click();
  await expect.poll(capture, { timeout: 5000 }).toContain('$ /usage');
  await bar.getByRole('button', { name: '/rename', exact: true }).click();
  await expect(page.getByTestId('input')).toHaveValue('/rename ');
  await expect(page.getByTestId('input')).toBeFocused();
  await page.waitForTimeout(1000);
  expect(await capture()).not.toContain('/rename');
  await page.getByTestId('input').fill('');
  await control(request, '/rename', { what: 'title', target: 'work:0.0', name: 'test-pane' });
  await expect(bar).toHaveAttribute('data-kind', 'shell', { timeout: 10_000 });
  // Another program in the pane: no row.
  await control(request, '/send', { target: 'work:0.0', text: 'cat' });
  await expect(page.getByTestId('cmdbar')).toHaveCount(0, { timeout: 10_000 });
  await page.getByTestId('keybar').getByRole('button', { name: 'C-c', exact: true }).click();
  await expect(page.getByTestId('cmdbar')).toHaveAttribute('data-kind', 'shell', {
    timeout: 10_000,
  });
  // The window view and the board carry the row too.
  await page.keyboard.press('w');
  await expect(page.getByTestId('cmdbar')).toHaveAttribute('data-kind', 'shell');
  await page.keyboard.press('b');
  await expect(page.getByTestId('cmdbar')).toHaveAttribute('data-kind', 'shell');
  await page.evaluate(() => localStorage.removeItem('mx-recent'));
});
