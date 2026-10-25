import { expect, test } from '@playwright/test';
import { paneLoaded, shot, signIn } from './fixtures';

test('48 keyboard: j k Enter Esc / i t m ?', async ({ page }, info) => {
  await signIn(page);
  await expect(page.getByTestId('pane-row').first()).toBeVisible();
  await page.keyboard.press('j');
  await expect(page.locator('.mx-pane-row.mx-selected')).toHaveCount(1);
  const first = await page.locator('.mx-pane-row.mx-selected').getAttribute('data-address');
  await page.keyboard.press('j');
  const second = await page.locator('.mx-pane-row.mx-selected').getAttribute('data-address');
  expect(second).not.toBe(first);
  await page.keyboard.press('k');
  expect(await page.locator('.mx-pane-row.mx-selected').getAttribute('data-address')).toBe(first);
  await page.keyboard.press('Enter');
  await paneLoaded(page);
  await expect(page.locator('[data-testid="tab"][data-focused]')).toHaveAttribute(
    'data-address',
    first!,
  );
  await page.keyboard.press('i');
  await expect(page.getByTestId('input')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('input')).not.toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('panes')).toBeVisible();
  await page.keyboard.press('/');
  await expect(page.getByTestId('filter')).toBeFocused();
  await page.getByTestId('filter').fill('logs');
  await expect(page.getByTestId('pane-row')).toHaveCount(1);
  await page.getByTestId('filter').fill('');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('filter')).not.toBeFocused();
  const html = page.locator('html');
  await page.keyboard.press('t');
  await expect(html).toHaveAttribute('data-theme', 'amber');
  await page.keyboard.press('m');
  await expect(html).toHaveAttribute('data-motion', 'off');
  await page.keyboard.press('m');
  await expect(html).toHaveAttribute('data-motion', '');
  await page.keyboard.press('?');
  await expect(page.getByTestId('help')).toBeVisible();
  await shot(page, info, '48-help');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('help')).toHaveCount(0);
});

// An overlay's title sits on its box's top edge: nothing may clip or cover it.
async function titleShows(page: import('@playwright/test').Page, overlay: string) {
  const title = page.getByTestId(overlay).locator('.mx-box-title').first();
  await expect(title).toBeVisible();
  const ok = await title.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return r.top >= 0 && !!hit && el.contains(hit);
  });
  expect(ok, `${overlay} title`).toBe(true);
}

test('48 overlays show their titles; help is two columns on a wide window', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1600, height: 700 });
  await signIn(page);
  await page.keyboard.press('?');
  await titleShows(page, 'help');
  const xs = await page
    .getByTestId('help')
    .locator('dt')
    .evaluateAll((els) => [...new Set(els.map((e) => Math.round(e.getBoundingClientRect().left)))]);
  expect(xs.length).toBe(2);
  await shot(page, info, '48-help-columns');
  await page.keyboard.press('Escape');
  await page.keyboard.press('H');
  await titleShows(page, 'hubs');
  await page.keyboard.press('Escape');
  await page.keyboard.press('p');
  await titleShows(page, 'palette');
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 420, height: 700 });
  await page.keyboard.press('?');
  await titleShows(page, 'help');
  const narrow = await page
    .getByTestId('help')
    .locator('dt')
    .evaluateAll((els) => new Set(els.map((e) => Math.round(e.getBoundingClientRect().left))).size);
  expect(narrow).toBe(1);
});
