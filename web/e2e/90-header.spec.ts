import { expect, test } from '@playwright/test';
import { control, HOST, settled, shot, signIn, SHELL0 } from './fixtures';

// The header is one row: the brand (the way back), the view's tabs, `+`
// and its buttons, and the profile button with what used to line it.

const LOGS = `${HOST}/work/1.0`;

test('90 one row: brand, tabs, +, pane buttons, profile', async ({ page }, info) => {
  await page.setViewportSize({ width: 1400, height: 800 });
  await signIn(page);
  await page.goto(`/p/${SHELL0}`);
  await settled(page);
  const header = page.locator('header.mx-header');
  const brand = header.getByTestId('back');
  const tab = header.locator('[data-testid="tab"][data-focused]');
  const add = header.getByTestId('add');
  const who = header.getByTestId('who');
  for (const l of [
    brand,
    tab,
    add,
    who,
    header.getByTestId('zoom'),
    header.getByTestId('open-palette'),
  ])
    await expect(l).toBeVisible();
  // All on the header's one row; nothing repeats the pane's name there.
  const row = (await header.boundingBox())!;
  for (const l of [brand, tab, add, who]) {
    const b = (await l.boundingBox())!;
    expect(b.y).toBeGreaterThanOrEqual(row.y);
    expect(b.y + b.height).toBeLessThanOrEqual(row.y + row.height + 1);
  }
  await expect(header.getByTestId('crumb')).toBeHidden();
  // The pane buttons are squares of 32 px with a label under the pointer.
  const zoom = header.getByTestId('zoom');
  const z = (await zoom.boundingBox())!;
  expect(Math.round(z.width)).toBe(32);
  expect(Math.round(z.height)).toBe(32);
  await zoom.hover();
  await expect.poll(() => zoom.evaluate((el) => getComputedStyle(el, '::after').opacity)).toBe('1');
  expect(await zoom.evaluate((el) => getComputedStyle(el, '::after').content)).toBe('"zoom"');
  await shot(page, info, '90-header');
  // The profile button holds hubs, help and logout; Esc closes it.
  await who.click();
  const menu = page.getByTestId('profile-menu');
  for (const id of ['open-hubs', 'open-help', 'logout'])
    await expect(menu.getByTestId(id)).toBeVisible();
  await expect(menu.getByTestId('open-admin')).toHaveCount(0);
  await shot(page, info, '90-profile');
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(page.getByTestId('pane')).toBeVisible();
  await who.click();
  await page.getByTestId('open-help').click();
  await expect(page.getByTestId('help')).toBeVisible();
  await page.keyboard.press('Escape');
  // The brand goes back to the list.
  await brand.click();
  await expect(page.getByTestId('panes')).toBeVisible();
  // On the list the header row has no tabs.
  await expect(header.locator('[data-testid="tab"]')).toHaveCount(0);
});

test('90 + splits the focused pane and opens the new one beside it', async ({
  page,
  request,
}, info) => {
  await signIn(page);
  await page.goto(`/p/${LOGS}`);
  await settled(page);
  await page.getByTestId('add').click();
  await expect(page.getByTestId('add-menu')).toBeVisible();
  await shot(page, info, '90-add');
  await page.getByTestId('add-split').click();
  await expect(page.getByTestId('tile')).toHaveCount(2, { timeout: 8000 });
  const made = (await page.getByTestId('tile').nth(1).getAttribute('data-pane'))!;
  expect(made).toMatch(new RegExp(`^${HOST}/work/1\\.1$`));
  // Leave the window as the other specs expect it.
  const id = await control(request, '/pane-id', { target: 'work:1.1' });
  await control(request, '/kill-pane', { target: id });
  await page.goto('/');
  await expect
    .poll(() => control(request, '/window-size', { target: 'work:1' }), { timeout: 8000 })
    .toBe('100x30');
});

test('90 security: a read-only pane offers no split', async ({ page }) => {
  await signIn(page);
  await page.goto(`/p/${HOST}/work/0.1`);
  await settled(page);
  await expect(page.getByTestId('readonly')).toBeVisible();
  // The host starts sessions, so + is there, with a new session and no split.
  await page.getByTestId('add').click();
  await expect(page.getByTestId('add-session')).toBeVisible();
  await expect(page.getByTestId('add-split')).toHaveCount(0);
});
