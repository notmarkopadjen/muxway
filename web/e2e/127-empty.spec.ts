import { expect, test } from '@playwright/test';
import { HOST, paneLoaded, RO_TOKEN, shot, signIn } from './fixtures';

// A host with nothing exposed, and a window that is gone: the list says
// how to expose something from the host and offers + session where the
// agent allows it, and the window view offers the list and + session.
// The hosts here expose nothing: alice-laptop's agent starts sessions,
// bob-desktop's does not.

const EMPTY = !!process.env.MX_EMPTY;

test('127 security: a read-only account sees the empty host and the gone window without + session', async ({
  page,
}) => {
  test.skip(!EMPTY, 'needs the empty hosts');
  await signIn(page, RO_TOKEN);
  const box = page.getByTestId(`host-${HOST}`);
  await expect(box.getByTestId('empty-host')).toBeVisible();
  await expect(box.getByTestId('host-state')).toHaveText('nothing exposed');
  await expect(box.getByTestId('empty-new-session')).toHaveCount(0);
  await expect(box.getByTestId('new-session')).toHaveCount(0);
  await page.goto(`/w/${HOST}/work/0`);
  await expect(page.getByTestId('window-error')).toContainText('no such window');
  await expect(page.getByTestId('gone-list')).toBeVisible();
  await expect(page.getByTestId('gone-new-session')).toHaveCount(0);
});

test('127 security: a host whose agent does not start sessions says so and offers none', async ({
  page,
}) => {
  test.skip(!EMPTY, 'needs the empty hosts');
  await signIn(page);
  const box = page.getByTestId('host-bob-desktop');
  await expect(box.getByTestId('empty-host')).toContainText('does not start sessions');
  await expect(box.getByTestId('empty-new-session')).toHaveCount(0);
  await expect(box.getByTestId('new-session')).toHaveCount(0);
  await page.goto('/w/bob-desktop/work/0');
  await expect(page.getByTestId('gone-list')).toBeVisible();
  await expect(page.getByTestId('gone-new-session')).toHaveCount(0);
});

test('127 an empty host says how to expose and + session opens the new session', async ({
  page,
}, info) => {
  test.skip(!EMPTY, 'needs the empty hosts');
  await signIn(page);
  const box = page.getByTestId(`host-${HOST}`);
  const empty = box.getByTestId('empty-host');
  await expect(empty).toContainText('muxway expose -t <session> --write');
  await expect(empty).toContainText('--expose <session>=write');
  await expect(box.getByTestId('new-session')).toBeVisible();
  await shot(page, info, '127-empty-host');
  await box.getByTestId('empty-new-session').click();
  await expect(box.getByTestId('session-form')).toBeVisible();
  await expect(box.getByTestId('empty-new-session')).toHaveCount(0);
  await box.getByTestId('session-name').fill('born');
  await page.keyboard.press('Enter');
  await paneLoaded(page);
  await expect(page.getByTestId('pane')).toHaveAttribute('data-panes', `${HOST}/born/0.0`);
  await page.goto('/');
  await expect(box.getByTestId('empty-host')).toHaveCount(0);
  await expect(box.getByTestId('pane-row').filter({ hasText: `${HOST}/born/0.0` })).toBeVisible();
});

test('127 a gone window offers the pane list and a new session on its host', async ({
  page,
}, info) => {
  test.skip(!EMPTY, 'needs the empty hosts');
  await signIn(page);
  await page.goto(`/w/${HOST}/nosuch/0`);
  await expect(page.getByTestId('window-error')).toContainText(
    'no such window, or not yours to see',
  );
  await expect(page.getByTestId('gone-new-session')).toHaveText(`+ session on ${HOST}`);
  await shot(page, info, '127-gone-window');
  await page.getByTestId('gone-list').click();
  await expect(page.getByTestId('panes')).toBeVisible();
  await page.goto(`/w/${HOST}/nosuch/0`);
  await page.getByTestId('gone-new-session').click();
  await expect(page.getByTestId('session-form')).toBeVisible();
  await page.getByTestId('session-name').fill('reb');
  // The form outlives the window's polls, which fail again every second;
  // and a session is made once per two seconds per account.
  await page.waitForTimeout(2200);
  await expect(page.getByTestId('session-form')).toBeVisible();
  await expect(page.getByTestId('session-name')).toHaveValue('reb');
  await page.getByTestId('session-name').fill('reborn');
  await page.keyboard.press('Enter');
  await paneLoaded(page);
  await expect(page.getByTestId('pane')).toHaveAttribute('data-panes', `${HOST}/reborn/0.0`);
});
