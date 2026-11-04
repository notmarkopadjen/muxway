import { expect, test } from '@playwright/test';
import { control, HOST, settled, shot, signIn, SHELL0 } from './fixtures';

// The header is one row: the brand (the way back), the view's tabs, `+`
// and its buttons, and the profile button with what used to line it. In a
// window 960 px or narrower the tabs and `+` take a second row of their own.

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

test('90 two rows under 960 px: the strip under the brand and the buttons', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await signIn(page);
  await page.goto(`/p/${SHELL0}`);
  await settled(page);
  const header = page.locator('header.mx-header');
  const brand = header.getByTestId('back');
  const tab = header.locator('[data-testid="tab"][data-focused]');
  const add = header.getByTestId('add');
  const who = header.getByTestId('who');
  const zoom = header.getByTestId('zoom');
  for (const l of [brand, tab, add, who, zoom]) await expect(l).toBeVisible();
  // The brand, the pane buttons and the profile button share the first
  // row; the tabs and + sit under them, the strip starting at the brand's
  // left edge and + right after the last tab.
  const b = (await brand.boundingBox())!;
  const z = (await zoom.boundingBox())!;
  const w = (await who.boundingBox())!;
  const t = (await tab.boundingBox())!;
  const a = (await add.boundingBox())!;
  expect(Math.abs(z.y + z.height / 2 - (b.y + b.height / 2))).toBeLessThan(2);
  expect(Math.abs(w.y + w.height / 2 - (b.y + b.height / 2))).toBeLessThan(2);
  expect(t.y).toBeGreaterThanOrEqual(b.y + b.height);
  expect(Math.abs(t.x - b.x)).toBeLessThan(4);
  expect(a.x).toBeGreaterThan(t.x + t.width);
  expect(Math.abs(a.y + a.height / 2 - (t.y + t.height / 2))).toBeLessThan(2);
  // The tabs have the whole width to themselves: their row spans the
  // header, past where the buttons start.
  const row = (await header.locator('.mx-header-strip').boundingBox())!;
  expect(row.x + row.width).toBeGreaterThan(z.x);
  await shot(page, info, '90-two-rows');
  // Narrower still, the buttons fold into ⋯ and the tabs keep their row.
  await page.setViewportSize({ width: 600, height: 600 });
  const more = header.getByTestId('more');
  await expect(more).toBeVisible();
  const m = (await more.boundingBox())!;
  const b2 = (await brand.boundingBox())!;
  const t2 = (await tab.boundingBox())!;
  expect(Math.abs(m.y + m.height / 2 - (b2.y + b2.height / 2))).toBeLessThan(2);
  expect(t2.y).toBeGreaterThanOrEqual(b2.y + b2.height);
  await shot(page, info, '90-two-rows-narrow');
  // Wide again, everything is back on one row.
  await page.setViewportSize({ width: 1400, height: 800 });
  await expect(zoom).toBeVisible();
  const b3 = (await brand.boundingBox())!;
  const t3 = (await tab.boundingBox())!;
  expect(Math.abs(t3.y + t3.height / 2 - (b3.y + b3.height / 2))).toBeLessThan(2);
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
  // The host starts sessions, so + is there, with a new session; the
  // split is there too, disabled, and says why.
  await page.getByTestId('add').click();
  await expect(page.getByTestId('add-session')).toBeEnabled();
  await expect(page.getByTestId('add-split')).toBeDisabled();
  await expect(page.getByTestId('add-split')).toHaveAttribute('title', /read only/);
});

test('90 the pane buttons are the same nine in every view, disabled where they do not apply', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await signIn(page);
  const labels = () =>
    page
      .locator('header.mx-header .mx-tools button')
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-label')));
  const ALL = [
    'arrange',
    'equal',
    "the host's layout",
    'fit',
    'direct',
    'changes',
    'later',
    'zoom',
    'go to',
  ];
  // One tile: nothing to arrange or even out, the host's layout is the window view's.
  await page.goto(`/p/${SHELL0}`);
  await settled(page);
  expect(await labels()).toEqual(ALL);
  for (const id of ['arrange', 'equal', 'reset']) await expect(page.getByTestId(id)).toBeDisabled();
  for (const id of ['fit', 'direct', 'later', 'zoom', 'open-palette'])
    await expect(page.getByTestId(id)).toBeEnabled();
  // Two tiles of different windows: the arrangement is the browser's own.
  await page.goto(`/p/${SHELL0},${LOGS}`);
  await expect(page.getByTestId('tile')).toHaveCount(2);
  expect(await labels()).toEqual(ALL);
  for (const id of ['arrange', 'equal', 'fit', 'direct', 'zoom'])
    await expect(page.getByTestId(id)).toBeEnabled();
  await expect(page.getByTestId('reset')).toBeDisabled();
  // The window view: the same row.
  await page.goto(`/w/${HOST}/work/0`);
  await expect(page.getByTestId('window')).toBeVisible();
  expect(await labels()).toEqual(ALL);
  for (const id of ['equal', 'reset', 'fit', 'direct', 'zoom', 'open-palette'])
    await expect(page.getByTestId(id)).toBeEnabled();
  // The help reads in three columns on a wide screen.
  await page.keyboard.press('?');
  const dl = page.getByTestId('help').locator('dl');
  await expect(dl).toBeVisible();
  expect(await dl.evaluate((el) => getComputedStyle(el).columnCount)).toBe('3');
  await shot(page, info, '90-help-columns');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('help')).toHaveCount(0);
});
