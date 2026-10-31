import { expect, test, type APIRequestContext } from '@playwright/test';
import { control, HOST, openPane, SHELL0, shot, signIn, TOKEN } from './fixtures';

// The agents environment (see 109): the first pane writable. Talk: a
// write that names the pane it came from chains the two panes on every
// client; the talk window lists what was said. Spec 109 leaves the
// second pane's shell replaced, so each test splits a fresh writable
// pane beside the first and talks with that one.
test.skip(!process.env.MX_AGENTS, 'needs the agents environment');

const auth = { Authorization: `Bearer ${TOKEN}` };

// One more writable pane in the first window, with the mark the source carries.
async function otherPane(request: APIRequestContext): Promise<{ address: string; id: string }> {
  const r = await request.post(`/v1/windows/${HOST}/work/0/panes`, {
    headers: auth,
    data: { direction: 'h' },
  });
  expect(r.status()).toBe(201);
  const { pane } = (await r.json()) as { pane: { address: string; pane_id: string } };
  // tmux titles a new pane with the machine's name: the fixtures' title instead.
  await control(request, '/rename', { what: 'title', target: pane.pane_id, name: 'test-pane' });
  return { address: pane.address, id: pane.pane_id };
}

// A write from one pane to another, as muxway client would send it.
async function say(
  request: APIRequestContext,
  to: string,
  fromPane: string,
  body: { text: string } | { key: string },
) {
  const r = await request.post(`/v1/panes/${to}/input`, {
    headers: auth,
    data: { ...body, from: { host: HOST, pane_id: fromPane } },
  });
  expect(r.status()).toBe(204);
}

test('110 a pane that talks to another is chained to it: the header, the tab, the divider, the window', async ({
  page,
  request,
}, info) => {
  const pane0 = await control(request, '/pane-id', { target: 'work:0.0' });
  const other = await otherPane(request);
  await signIn(page);
  await expect(page.getByTestId('talk-count')).toHaveCount(0);
  await openPane(page, SHELL0);
  await say(request, SHELL0, other.id, { text: 'echo hello from the other' });
  // The header of the tile says who it talks with, the tab carries the
  // chain, the header row counts, and a toast shows what was said.
  const link = page.getByTestId('tile').getByTestId('talk-link');
  await expect(link).toBeVisible({ timeout: 10_000 });
  await expect(link).toContainText(/bash|sh|zsh|fish/);
  await expect(
    page.locator(`[data-testid="tab"][data-address="${other.address}"]`).getByTestId('talk-mark'),
  ).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('talk-count')).toContainText('1', { timeout: 10_000 });
  await expect(
    page.getByTestId('toast').filter({ hasText: 'echo hello from the other' }),
  ).toBeVisible({ timeout: 10_000 });
  await shot(page, info, '110-talk-header');
  // L lays the partner beside: two tiles, the divider between them chained.
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
  // Both headers carry the chain now, each naming the other.
  await expect(page.getByTestId('talk-link')).toHaveCount(2, { timeout: 10_000 });
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
  // The talk window lists both, newest at the bottom; Enter lays the two side by side.
  await page.keyboard.press('T');
  const talk = page.getByTestId('talk');
  await expect(talk).toBeVisible();
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
  // From the list: the chained panes carry the mark; the count opens the
  // window; Enter on a row opens both panes side by side.
  await page.getByTestId('back').click();
  await expect(page.getByTestId('panes')).toBeVisible();
  const row0 = page.getByTestId('pane-row').filter({ hasText: SHELL0 });
  await expect(row0.getByTestId('talk-mark')).toBeVisible({ timeout: 10_000 });
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

test('110 the chain is on the header of a pane opened later and a click on it lays the partner beside', async ({
  page,
  request,
}) => {
  const pane0 = await control(request, '/pane-id', { target: 'work:0.0' });
  const other = await otherPane(request);
  await say(request, other.address, pane0, { text: 'echo again' });
  await signIn(page);
  await openPane(page, other.address);
  const link = page.getByTestId('tile').getByTestId('talk-link');
  await expect(link).toBeVisible({ timeout: 10_000 });
  await link.click();
  await expect(page.getByTestId('pane')).toHaveAttribute(
    'data-panes',
    `${other.address} ${SHELL0}`,
  );
  await expect(page.getByTestId('tile')).toHaveCount(2);
});
