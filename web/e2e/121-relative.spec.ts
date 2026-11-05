import { expect, test } from '@playwright/test';
import { control, openPane, settled, SHELL0, shot, signIn } from './fixtures';

// A relative path printed in a pane whose shell sits elsewhere in the
// repository, the main checkout while the file lives in a worktree, opens
// all the same: the host looks up the tree and across the worktrees, and
// the window's bar names the file it found.

const PREVIEW = process.env.MX_PREVIEW ?? '';
const WORKTREE = process.env.MX_WORKTREE ?? '';

test('121 a path only a worktree holds opens, and the bar names where it was found', async ({
  page,
  request,
}, info) => {
  test.skip(!PREVIEW || !WORKTREE, 'no preview root in this environment');
  await signIn(page);
  await openPane(page, SHELL0);
  await settled(page);
  await control(request, '/send', { target: 'work:0.0', text: `echo see docs/plans/side.md end` });
  const screen = page.getByTestId('screen');
  await expect(screen).toContainText('docs/plans/side.md end', { timeout: 5000 });
  await screen.locator('a.mx-path-link[data-path="docs/plans/side.md"]').last().click();
  const picture = page.getByTestId('picture');
  await expect(picture).toBeVisible();
  await expect(page.getByTestId('picture-name')).toHaveText('docs/plans/side.md');
  await expect(page.getByTestId('picture-found')).toHaveText(
    `found ${WORKTREE}/docs/plans/side.md`,
  );
  await expect(page.getByTestId('picture-rendered-body')).toContainText('plan from the side');
  await shot(page, info, '121-found-elsewhere');
  await page.keyboard.press('Escape');
  await expect(picture).toHaveCount(0, { timeout: 3000 });
  // A file the pane's directory holds: the bar as before, nothing found elsewhere.
  await control(request, '/send', { target: 'work:0.0', text: `echo own plans/a.md end` });
  await expect(screen).toContainText('own plans/a.md end', { timeout: 5000 });
  await screen.locator('a.mx-path-link[data-path="plans/a.md"]').last().click();
  await expect(picture).toBeVisible();
  await expect(page.getByTestId('picture-rendered-body')).toContainText('plan a');
  await expect(page.getByTestId('picture-found')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(picture).toHaveCount(0, { timeout: 3000 });
  await control(request, '/send', { target: 'work:0.0', text: 'clear' });
});
