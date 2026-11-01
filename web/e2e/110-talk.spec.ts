import { expect, test } from '@playwright/test';
import { control, openPane, SHELL0, shot, signIn } from './fixtures';
import { closeMade, otherPane, say } from './talk';

// The agents environment (see 109): the first pane writable. Talk: panes
// that write or mail to each other form a group, framed on the strip and
// on the tiles; the messages window lists what was said, and nothing pops
// up for a message. Spec 109 leaves the second pane's shell replaced, so
// each test splits a fresh writable pane beside the first and talks with
// that one.
test.skip(!process.env.MX_AGENTS, 'needs the agents environment');

test.afterEach(async ({ request }) => closeMade(request));

test('110 panes that talk are one group: the frame on the strip and the tiles, the count, the window', async ({
  page,
  request,
}, info) => {
  const pane0 = await control(request, '/pane-id', { target: 'work:0.0' });
  const other = await otherPane(request);
  await signIn(page);
  await openPane(page, SHELL0);
  await say(request, SHELL0, other.id, { text: 'echo hello from the other' });
  // The two tabs are pulled into one frame, the tile is framed, the
  // header counts one unseen message, and no toast appears.
  const group = page.getByTestId('tab-group');
  await expect(group).toHaveCount(1, { timeout: 10_000 });
  await expect(group.getByTestId('tab')).toHaveCount(2);
  await expect(page.getByTestId('tile')).toHaveAttribute('data-group', '');
  await expect(page.getByTestId('talk-count')).toContainText('1', { timeout: 10_000 });
  await expect(page.getByTestId('tile').getByTestId('talk-link')).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.getByTestId('toast')).toHaveCount(0);
  await shot(page, info, '110-talk-group');
  // L lays the partner beside: two framed tiles, the divider between them chained.
  await page.keyboard.press('L');
  await expect(page.getByTestId('pane')).toHaveAttribute(
    'data-panes',
    `${SHELL0} ${other.address}`,
  );
  await expect(page.getByTestId('tile')).toHaveCount(2);
  await expect(page.getByTestId('divider')).toHaveAttribute('data-chained', '', {
    timeout: 10_000,
  });
  await expect(page.getByTestId('divider-chain')).toBeVisible();
  await expect(page.locator('[data-testid="tile"][data-group]')).toHaveCount(2, {
    timeout: 10_000,
  });
  await shot(page, info, '110-talk-divider');
  // L with the partner already beside moves nothing.
  await page.keyboard.press('L');
  await expect(page.getByTestId('pane')).toHaveAttribute(
    'data-panes',
    `${SHELL0} ${other.address}`,
  );
  // An answer the other way: a key from the first pane to the other.
  await say(request, other.address, pane0, { key: 'C-l' });
  await expect(page.getByTestId('talk-count')).toContainText('2', { timeout: 10_000 });
  // The window lists both, oldest at the top; opening it clears the
  // count; Enter lays the two side by side.
  await page.keyboard.press('T');
  const talk = page.getByTestId('talk');
  await expect(talk).toBeVisible();
  await expect(page.getByTestId('talk-count')).not.toContainText('2');
  const rows = page.getByTestId('talk-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toHaveAttribute('data-from', other.address);
  await expect(rows.nth(0)).toHaveAttribute('data-to', SHELL0);
  await expect(rows.nth(0)).toContainText('echo hello from the other');
  await expect(rows.nth(1)).toHaveAttribute('data-from', SHELL0);
  await expect(rows.nth(1)).toContainText('key: C-l');
  await expect(rows.nth(1)).toHaveClass(/mx-selected/);
  await shot(page, info, '110-talk-window');
  await page.keyboard.press('Escape');
  await expect(talk).toHaveCount(0);
  // From the list: the rows of the group carry the frame's edge, kept
  // together; the count opens the window; Enter on a row opens both.
  await page.getByTestId('back').click();
  await expect(page.getByTestId('panes')).toBeVisible();
  const grouped = page.locator('[data-testid="pane-row"][data-group]');
  await expect(grouped).toHaveCount(2, { timeout: 10_000 });
  await expect(grouped.nth(0)).toHaveAttribute('data-address', SHELL0);
  await expect(grouped.nth(1)).toHaveAttribute('data-address', other.address);
  await page.getByTestId('talk-count').click();
  await expect(talk).toBeVisible();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await expect(talk).toHaveCount(0);
  await expect(page.getByTestId('pane')).toHaveAttribute(
    'data-panes',
    `${other.address} ${SHELL0}`,
  );
  await expect(page.getByTestId('divider')).toHaveAttribute('data-chained', '', {
    timeout: 10_000,
  });
  await shot(page, info, '110-talk-beside');
});

test('110 the frame is on a pane opened later and a click on the header chain lays the partner beside', async ({
  page,
  request,
}) => {
  const pane0 = await control(request, '/pane-id', { target: 'work:0.0' });
  const other = await otherPane(request);
  await say(request, other.address, pane0, { text: 'echo again' });
  await signIn(page);
  await openPane(page, other.address);
  await expect(page.getByTestId('tile')).toHaveAttribute('data-group', '', { timeout: 10_000 });
  const link = page.getByTestId('tile').getByTestId('talk-link');
  await expect(link).toBeVisible();
  await link.click();
  await expect(page.getByTestId('pane')).toHaveAttribute(
    'data-panes',
    `${other.address} ${SHELL0}`,
  );
  await expect(page.getByTestId('tile')).toHaveCount(2);
});
