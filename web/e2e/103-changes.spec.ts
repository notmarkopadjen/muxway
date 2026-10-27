import { expect, test, type Page } from '@playwright/test';
import { control, openPane, settled, SHELL0, shot, signIn } from './fixtures';

// The changes window: git's view of the repository the pane works in,
// over the tile, docked to its right edge; a click on a file opens its
// diff or the file in the file window.

const PREVIEW = process.env.MX_PREVIEW ?? '';

function watchResizes(page: Page) {
  const resizes: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/resize')) resizes.push(r.postData() ?? '');
  });
  return resizes;
}

test('103 g opens the changes over the tile: the tree, the marks, the counts; fold, ×, Esc; the tile keeps its size', async ({
  page,
}, info) => {
  test.skip(!PREVIEW, 'no preview root in this environment');
  await signIn(page);
  await openPane(page, SHELL0);
  const resizes = watchResizes(page);
  await settled(page);
  // The tile's own fit lands first; the window must add nothing to it.
  await expect.poll(() => resizes.length, { timeout: 5000 }).toBeGreaterThan(0);
  await expect(page.getByTestId('pane-size')).toHaveText(/134×\d+/);
  const sent = resizes.length;
  const screen = page.getByTestId('screen');
  const before = await screen.boundingBox();
  const size = await page.getByTestId('pane-size').textContent();
  await page.keyboard.press('g');
  const changes = page.getByTestId('changes-window');
  await expect(changes).toBeVisible();
  await expect(page.getByTestId('changes-where')).toHaveText('work · main');
  await expect(page.getByTestId('changes-counts')).toHaveText('+6 ~2 −1');
  // Directories first, folded by a click; files with their marks.
  const dirs = page.getByTestId('change-dir');
  await expect(dirs.first()).toHaveAttribute('data-path', 'src');
  const a = page.locator('[data-testid="change"][data-path="src/a.go"]');
  await expect(a).toHaveAttribute('data-kind', 'modified');
  await expect(a).toContainText('~');
  await expect(a).toContainText('a.go');
  await expect(page.locator('[data-testid="change"][data-path="src/gone.go"]')).toHaveAttribute(
    'data-kind',
    'deleted',
  );
  const added = page.locator('[data-testid="change"][data-path="src/new.go"]');
  await expect(added).toHaveAttribute('data-kind', 'added');
  await expect(added).toHaveAttribute('data-staged', '');
  await expect(page.locator('[data-testid="change"][data-path="src/moved.go"]')).toHaveAttribute(
    'data-kind',
    'renamed',
  );
  await expect(page.locator('[data-testid="change"][data-path="notes.txt"]')).toHaveAttribute(
    'data-kind',
    'untracked',
  );
  await expect(page.locator('[data-testid="change"][data-path="-rf"]')).toHaveText('+-rf');
  await shot(page, info, 'web-changes');
  // The window lies over the screen: same box, same host size, no resize.
  const after = await screen.boundingBox();
  expect(after).toEqual(before);
  await expect(page.getByTestId('pane-size')).toHaveText(size ?? '');
  const box = await changes.boundingBox();
  expect(box!.x + box!.width).toBeCloseTo(before!.x + before!.width, 0);
  expect(box!.width).toBeGreaterThanOrEqual(before!.width / 3 - 8);
  // Fold a directory; fold the window to its bar; close and open again.
  await dirs.first().click();
  await expect(a).toHaveCount(0);
  await expect(dirs.first()).toContainText('4');
  await dirs.first().click();
  await expect(a).toBeVisible();
  await page.getByTestId('changes-fold').click();
  await expect(changes).toHaveAttribute('data-folded', '');
  await expect(page.getByTestId('changes-body')).toBeHidden();
  await page.getByTestId('changes-fold').click();
  await expect(page.getByTestId('changes-body')).toBeVisible();
  await page.getByTestId('changes-close').click();
  await expect(changes).toHaveCount(0, { timeout: 3000 });
  await page.keyboard.press('g');
  await expect(changes).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(changes).toHaveCount(0, { timeout: 3000 });
  await page.getByTestId('changes').click();
  await expect(changes).toBeVisible();
  await page.keyboard.press('g');
  await expect(changes).toHaveCount(0, { timeout: 3000 });
  expect(resizes.length).toBe(sent);
});

test('103 a change opens in the file window: the diff with its colours, the file a click away; deleted has the diff only, untracked the file only', async ({
  page,
}, info) => {
  test.skip(!PREVIEW, 'no preview root in this environment');
  await signIn(page);
  await openPane(page, SHELL0);
  await settled(page);
  await page.keyboard.press('g');
  await page.locator('[data-testid="change"][data-path="src/a.go"]').click();
  const picture = page.getByTestId('picture');
  await expect(picture).toBeVisible();
  await expect(page.getByTestId('picture-name')).toHaveText('src/a.go');
  await expect(page.getByTestId('picture-side')).toHaveAttribute('data-view', 'diff');
  const diff = page.getByTestId('diff');
  await expect(diff.locator('[data-d="+"]').filter({ hasText: 'func A() {}' })).toHaveCount(1);
  await expect(diff.locator('[data-d="@"]').first()).toContainText('@@');
  await expect(diff.locator('[data-d="h"]').first()).toContainText('diff --git');
  await shot(page, info, 'web-changes-diff');
  await page.getByTestId('picture-file').click();
  await expect(page.getByTestId('picture-text')).toContainText('func A() {}');
  await expect(page.getByTestId('picture-download')).toBeVisible();
  await page.getByTestId('picture-diff').click();
  await expect(diff).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(picture).toHaveCount(0, { timeout: 3000 });
  // Escape closed the file window and left the changes open.
  await expect(page.getByTestId('changes-window')).toBeVisible();
  await page.locator('[data-testid="change"][data-path="src/gone.go"]').click();
  await expect(picture).toBeVisible();
  await expect(page.getByTestId('picture-side')).toHaveCount(0);
  await expect(diff.locator('[data-d="-"]').filter({ hasText: 'package gone' })).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(picture).toHaveCount(0, { timeout: 3000 });
  await page.locator('[data-testid="change"][data-path="notes.txt"]').click();
  await expect(picture).toBeVisible();
  await expect(page.getByTestId('picture-side')).toHaveCount(0);
  await expect(page.getByTestId('picture-text')).toContainText('loose');
  await page.keyboard.press('Escape');
  await expect(picture).toHaveCount(0, { timeout: 3000 });
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('changes-window')).toHaveCount(0, { timeout: 3000 });
});

test('103 a pane outside a repository says so', async ({ page, request }) => {
  test.skip(!PREVIEW, 'no preview root in this environment');
  await signIn(page);
  await openPane(page, SHELL0);
  await settled(page);
  await control(request, '/send', { target: 'work:0.0', text: 'cd /' });
  await page.keyboard.press('g');
  await expect(page.getByTestId('changes-none')).toHaveText('not in a repository the host shows', {
    timeout: 8000,
  });
  await expect(page.getByTestId('changes-counts')).toHaveText('');
  await control(request, '/send', { target: 'work:0.0', text: `cd ${PREVIEW}/docs && clear` });
  await expect(page.getByTestId('changes-where')).toHaveText('work · main', { timeout: 8000 });
  await page.keyboard.press('g');
  await expect(page.getByTestId('changes-window')).toHaveCount(0, { timeout: 3000 });
});
