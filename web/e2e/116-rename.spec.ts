import { expect, test, type Page } from '@playwright/test';
import {
  control,
  HOST,
  openPane,
  RO_TOKEN,
  settled,
  SHELL0,
  shot,
  signIn,
  TOKEN,
} from './fixtures';

// A pane's name: the alias, set from the header. A slow second click on
// the focused tab or the header name, or N, turns the name into a field;
// Enter saves, Esc leaves, empty takes the name away. The header shows
// the name, the folder and the status, and keeps the rest under the
// pointer.

const LOGS = `${HOST}/work/1.0`;
const PREVIEW = process.env.MX_PREVIEW ?? '';
const auth = { Authorization: `Bearer ${TOKEN}` };

function watchInput(page: Page) {
  const bodies: unknown[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/input') && r.method() === 'POST')
      bodies.push(JSON.parse(r.postData() ?? '{}'));
  });
  return bodies;
}

const head = (page: Page) => page.getByTestId('pane').locator('.mx-tile-head').first();
const tab = (page: Page, address: string) =>
  page.locator(`[data-testid=tab][data-address="${address}"]`);

test('116 the name: a slow second click or N opens the field; Enter names the pane everywhere, Esc leaves, empty clears, a taken name is refused', async ({
  page,
  request,
}, info) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await signIn(page);
  await openPane(page, LOGS);
  await settled(page);
  const title = head(page).getByTestId('pane-title');
  // The alias set at expose is the name; what the program says follows.
  await expect(title.locator('.mx-title-name')).toHaveText('logs');
  await expect(title.locator('.mx-title-status')).toHaveText(/bash · test-pane/);
  await expect(tab(page, LOGS)).toHaveText(/^logs$/);
  // The header keeps the place, the size and the mode under the pointer.
  await expect(head(page)).not.toContainText('work/1.0');
  await expect(head(page)).not.toContainText('write');
  await expect(title).toHaveAttribute(
    'title',
    /bash · test-pane\nalice-laptop\/work\/1\.0 · \d+×\d+ · write/,
  );
  await expect(head(page).locator('.mx-size')).toBeHidden();
  await shot(page, info, '116-header-light');

  // A slow second click on the focused tab opens the field.
  await tab(page, LOGS).click();
  await page.waitForTimeout(700);
  await tab(page, LOGS).click();
  const field = page.getByTestId('rename-field');
  await expect(field).toBeVisible();
  await expect(field).toHaveValue('logs');
  await shot(page, info, '116-rename-field');
  // What is typed becomes an alias as it goes, and reaches no pane.
  const inputs = watchInput(page);
  await field.fill('');
  await page.keyboard.type('Review Two!');
  await expect(field).toHaveValue('review-two');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('rename')).toHaveCount(0);
  await expect(title.locator('.mx-title-name')).toHaveText('review-two');
  await expect(tab(page, LOGS)).toHaveText(/^review-two$/);
  expect(inputs).toEqual([]);
  // The name is an address.
  const named = await request.get(`/v1/panes/${HOST}/@review-two`, { headers: auth });
  expect(named.status()).toBe(200);
  await shot(page, info, '116-rename-done');

  // N opens it on the header; Esc leaves the name alone.
  await page.keyboard.press('N');
  await expect(field).toBeVisible();
  await page.keyboard.type('x');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('rename')).toHaveCount(0);
  await expect(title.locator('.mx-title-name')).toHaveText('review-two');
  expect(inputs).toEqual([]);

  // A name another pane has is refused, and the field says so.
  const taken = await request.post(`/v1/panes/${SHELL0}/alias`, {
    headers: { ...auth, 'Content-Type': 'application/json' },
    data: { alias: 'taken-name' },
  });
  expect(taken.status()).toBe(200);
  await page.keyboard.press('N');
  await field.fill('taken-name');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('rename-error')).toHaveText('another pane has it');
  await expect(field).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('rename')).toHaveCount(0);
  await expect(page.getByTestId('pane')).toBeVisible();

  // The header name takes the slow second click too; empty clears the name.
  await title.click();
  await page.waitForTimeout(700);
  await title.click();
  await expect(field).toBeVisible();
  await field.fill('');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('rename')).toHaveCount(0);
  await expect(title.locator('.mx-title-name')).toHaveText('bash');
  await expect(tab(page, LOGS)).toHaveText(/^bash · test-pane$/);
  await shot(page, info, '116-rename-cleared');

  // What Claude writes is the status of a named pane, the tab of an unnamed one.
  await control(request, '/rename', {
    what: 'title',
    target: 'work:1.0',
    name: '✳ fixing the build',
  });
  await expect(tab(page, LOGS)).toHaveText(/^fixing the build$/);
  await page.keyboard.press('N');
  await field.fill('logs');
  await page.keyboard.press('Enter');
  await expect(tab(page, LOGS)).toHaveText(/^logs$/);
  await expect(title.locator('.mx-title-status')).toHaveText(/fixing the build/);
  await expect(title).toHaveAttribute('data-agent', 'claude');
  await control(request, '/rename', { what: 'title', target: 'work:1.0', name: 'test-pane' });
  await expect(title.locator('.mx-title-status')).toHaveText(/bash · test-pane/);
  // The other pane's name goes, so the next spec finds the panes as it left them.
  const cleared = await request.post(`/v1/panes/${SHELL0}/alias`, {
    headers: { ...auth, 'Content-Type': 'application/json' },
    data: { alias: '' },
  });
  expect(cleared.status()).toBe(200);
});

test('116 the folder shows in italics with its path under the pointer; a reader gets no field and no folder', async ({
  page,
  browser,
}, info) => {
  test.skip(!PREVIEW, 'no preview root in this environment');
  await page.setViewportSize({ width: 1400, height: 900 });
  await signIn(page);
  await openPane(page, SHELL0);
  await settled(page);
  const folder = head(page).getByTestId('pane-folder');
  await expect(folder).toHaveText(/· docs$/);
  await expect(folder).toHaveAttribute('title', `${PREVIEW}/docs`);
  await expect(head(page).getByTestId('pane-title')).toHaveAttribute(
    'title',
    new RegExp(`\\n${PREVIEW}/docs$`),
  );
  await expect(tab(page, SHELL0)).toHaveAttribute('title', new RegExp(`\\n${PREVIEW}/docs$`));
  await shot(page, info, '116-folder');

  const ro = await browser.newPage();
  await ro.setViewportSize({ width: 1400, height: 900 });
  await signIn(ro, RO_TOKEN);
  await openPane(ro, SHELL0);
  await expect(head(ro)).toContainText('read-only');
  await expect(head(ro).getByTestId('pane-folder')).toHaveCount(0);
  await ro.keyboard.press('N');
  await ro.waitForTimeout(300);
  await expect(ro.getByTestId('rename')).toHaveCount(0);
  await tab(ro, SHELL0).click();
  await ro.waitForTimeout(700);
  await tab(ro, SHELL0).click();
  await ro.waitForTimeout(300);
  await expect(ro.getByTestId('rename')).toHaveCount(0);
  await ro.close();
});
