import { expect, test } from '@playwright/test';
import { control, HOST, paneLoaded, SHELL0, shot, signIn } from './fixtures';

test('74 a pane running Claude is named Claude with its status; tmux names step back', async ({
  page,
  request,
}, info) => {
  await control(request, '/rename', {
    what: 'title',
    target: 'work:0.0',
    name: '✳ fixing the build',
  });
  await signIn(page);
  const row = page.getByTestId('pane-row').filter({ hasText: SHELL0 });
  const title = row.getByTestId('pane-title');
  await expect(title).toHaveAttribute('data-agent', 'claude', { timeout: 10_000 });
  await expect(title).toHaveText('Claude · fixing the build');
  await expect(row.locator('.mx-mark-claude')).toBeVisible();
  await expect(row).not.toContainText('bash');
  await shot(page, info, '74-panes');
  await row.click();
  await paneLoaded(page);
  await expect(page.getByTestId('pane').getByTestId('pane-title')).toHaveText(
    'Claude · fixing the build',
  );
  // The header row names the pane by its tab; the tile's header says where it is.
  await expect(page.locator('[data-testid="tab"][data-focused]')).toContainText('fixing the build');
  await expect(page.locator('.mx-tile-head').first()).toContainText(SHELL0);
  await expect(page).toHaveTitle('Claude · fixing the build · muxway');
  await shot(page, info, '74-pane');
  await page.keyboard.press('p');
  await page.getByTestId('palette-filter').fill('fixing');
  await expect(page.getByTestId('palette-row')).toHaveCount(1);
  await expect(page.getByTestId('palette-row').getByTestId('pane-title')).toHaveText(
    'Claude · fixing the build',
  );
  await expect(page.getByTestId('palette-row')).toContainText(SHELL0);
  await shot(page, info, '74-selector');
  await page.keyboard.press('Escape');
  await page.goto(`/w/${HOST}/work/0`);
  await expect(page.getByTestId('cell').first().getByTestId('pane-title')).toHaveText(
    'Claude · fixing the build',
  );
  // The window's strip names it as a tab does: the spark, then the status.
  const claudeTab = page.locator(`[data-testid="tab"][data-address="${SHELL0}"]`);
  await expect(claudeTab).toHaveText('fixing the build');
  await expect(claudeTab.locator('.mx-mark-claude')).toBeVisible();
  // A title that looks like markup is text in the strip and the header alike.
  await control(request, '/rename', {
    what: 'title',
    target: 'work:0.0',
    name: '<b onmouseover=alert(1)>bold</b>',
  });
  const tab = page.locator(`[data-testid="tab"][data-address="${SHELL0}"]`);
  await expect(tab).toContainText('<b onmouseover=alert(1)>bold</b>', { timeout: 10_000 });
  expect(await tab.locator('b').count()).toBe(0);
  expect(await page.getByTestId('cell').first().locator('b').count()).toBe(0);
  await control(request, '/rename', { what: 'title', target: 'work:0.0', name: 'test-pane' });
  await expect(page.getByTestId('cell').first().getByTestId('pane-title')).toHaveText(
    'bash · test-pane',
    {
      timeout: 10_000,
    },
  );
});
