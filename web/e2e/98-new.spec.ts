import { expect, test } from '@playwright/test';
import { control, HOST, paneLoaded, RO_TOKEN, settled, shot, signIn } from './fixtures';

// New panes and sessions from the list: `+ pane` under a window where you
// may type, `+ session` on a host whose agent starts sessions. Nothing of
// either for a read-only account, or on a host without the flag.

const madeId = (address: string) => address.replace(/^.*\//, '').replace(/^.*\./, '');

test('98 security: a read-only account sees neither row', async ({ page }) => {
  await signIn(page, RO_TOKEN);
  await expect(page.getByTestId(`host-${HOST}`)).toBeVisible();
  await expect(page.getByTestId('pane-row').first()).toBeVisible();
  await expect(page.getByTestId('new-pane')).toHaveCount(0);
  await expect(page.getByTestId('new-session')).toHaveCount(0);
});

test('98 security: a host without the flag has no + session', async ({ page }) => {
  await signIn(page);
  await expect(page.getByTestId(`host-${HOST}`).getByTestId('new-session')).toBeVisible();
  await expect(page.getByTestId('host-bob-desktop').getByTestId('pane-row')).toHaveCount(1);
  await expect(page.getByTestId('host-bob-desktop').getByTestId('new-session')).toHaveCount(0);
  await expect(page.getByTestId('host-bob-desktop').getByTestId('new-pane')).toHaveCount(0);
});

test('98 new pane: + pane splits the window and opens the new pane; + on a selected row does too', async ({
  page,
  request,
}, info) => {
  await signIn(page);
  await settled(page);
  const row = page.locator(`[data-testid="new-pane"][data-window="${HOST}/work/0"]`);
  await expect(row).toBeVisible();
  const before = await page.getByTestId('pane-row').count();
  const [res] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/v1/windows/') && r.request().method() === 'POST',
    ),
    row.click(),
  ]);
  expect(res.status()).toBe(201);
  const made = ((await res.json()) as { pane: { address: string; pane_id: string } }).pane;
  // A pane the host makes carries the machine's own name as its title;
  // the screenshots are of the test environment, so it is renamed first.
  expect(
    await control(request, '/rename', { what: 'title', target: made.pane_id, name: 'test-pane' }),
  ).toBe('<nil>');
  await paneLoaded(page);
  await expect(page.getByTestId('pane')).toContainText(made.address);
  await expect(page.getByTestId('pane').locator('.mx-title').first()).toContainText('test-pane');
  await expect(page.getByTestId('pane').locator('.mx-mode')).toHaveText('write');
  // The shell runs in the new pane: a prompt, and the command row offers claude.
  await expect(page.getByTestId('screen')).toContainText('$', { timeout: 5000 });
  await page.goto('/');
  await expect(page.getByTestId('pane-row').filter({ hasText: made.address })).toContainText(
    'test-pane',
    { timeout: 10_000 },
  );
  await expect(page.getByTestId('pane-row')).toHaveCount(before + 1);
  await expect(page.getByTestId('pane-row').filter({ hasText: made.address })).toBeVisible();
  await shot(page, info, '98-new-pane');
  await control(request, '/kill-pane', { target: made.pane_id });
  await expect(page.getByTestId('pane-row')).toHaveCount(before, { timeout: 10_000 });
  // The keyboard: j selects, + splits the selected row's window. The
  // creation rate is one per two seconds.
  await page.waitForTimeout(2100);
  await page.keyboard.press('j');
  await page.keyboard.press('j');
  await page.keyboard.press('j');
  await expect(page.locator('.mx-pane-row.mx-selected')).toHaveAttribute(
    'data-address',
    `${HOST}/work/1.0`,
  );
  const [res2] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/v1/windows/') && r.request().method() === 'POST',
    ),
    page.keyboard.press('+'),
  ]);
  expect(res2.status()).toBe(201);
  const made2 = ((await res2.json()) as { pane: { address: string; pane_id: string } }).pane;
  expect(made2.address.startsWith(`${HOST}/work/1.`)).toBe(true);
  await paneLoaded(page);
  await expect(page.getByTestId('pane').locator('.mx-mode')).toHaveText('write');
  await control(request, '/kill-pane', { target: made2.pane_id });
  expect(madeId(made2.address)).not.toBe('');
});

test('98 new session: + session, a name, Enter opens its pane; a used name is refused; S and Esc', async ({
  page,
  request,
}, info) => {
  await signIn(page);
  await settled(page);
  await page.getByTestId(`host-${HOST}`).getByTestId('new-session').click();
  const name = page.getByTestId('session-name');
  await expect(name).toBeFocused();
  await name.fill('Scratch!');
  await name.press('Enter');
  await expect(page.getByTestId('session-error')).toContainText('a-z');
  await name.fill('work');
  await name.press('Enter');
  await expect(page.getByTestId('session-error')).toHaveText('exists');
  await page.waitForTimeout(2100);
  await name.fill('scratch');
  const [res] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/sessions') && r.request().method() === 'POST'),
    name.press('Enter'),
  ]);
  expect(res.status()).toBe(201);
  await control(request, '/rename', { what: 'title', target: 'scratch', name: 'test-pane' });
  await paneLoaded(page);
  await expect(page.getByTestId('pane')).toContainText(`${HOST}/scratch/0.0`);
  await expect(page.getByTestId('pane').locator('.mx-mode')).toHaveText('write');
  await expect(page.getByTestId('screen')).toContainText('$', { timeout: 5000 });
  await expect(page.getByTestId('pane').locator('.mx-title').first()).toContainText('test-pane');
  await shot(page, info, '98-new-session');
  await page.goto('/');
  await expect(
    page.getByTestId('pane-row').filter({ hasText: `${HOST}/scratch/0.0` }),
  ).toBeVisible();
  // S opens the form for the selected row's host, Esc closes it, the
  // selector offers the session too.
  await page.keyboard.press('S');
  await expect(page.getByTestId(`host-${HOST}`).getByTestId('session-form')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('session-form')).toHaveCount(0);
  await page.keyboard.press('p');
  await page.getByTestId('palette-filter').fill('session on');
  await expect(page.getByTestId('palette-row')).toHaveText([`+session on ${HOST}new session`]);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId(`host-${HOST}`).getByTestId('session-form')).toBeVisible();
  await page.keyboard.press('Escape');
  await control(request, '/kill-pane', { target: 'scratch' });
  await expect(page.getByTestId('pane-row').filter({ hasText: `${HOST}/scratch/0.0` })).toHaveCount(
    0,
    {
      timeout: 10_000,
    },
  );
});

test('98 the window view has + too: a split joins the window, a session opens its pane', async ({
  page,
  request,
}) => {
  await signIn(page);
  await settled(page);
  await page.goto(`/w/${HOST}/work/0`);
  await expect(page.getByTestId('window')).toBeVisible();
  const cells = page.getByTestId('cell');
  const before = await cells.count();
  await page.getByTestId('add').click();
  const [res] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/v1/windows/') && r.request().method() === 'POST',
    ),
    page.getByTestId('add-split').click(),
  ]);
  expect(res.status()).toBe(201);
  const made = ((await res.json()) as { pane: { pane_id: string } }).pane;
  await expect(page.getByTestId('window')).toBeVisible();
  await expect(cells).toHaveCount(before + 1, { timeout: 10_000 });
  await control(request, '/kill-pane', { target: made.pane_id });
  await expect(cells).toHaveCount(before, { timeout: 10_000 });
});
