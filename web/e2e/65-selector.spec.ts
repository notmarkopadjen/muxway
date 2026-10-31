import { expect, test } from '@playwright/test';
import { HOST, paneLoaded, shot, signIn } from './fixtures';

test('65 the selector jumps to a pane or a window', async ({ page }, info) => {
  await signIn(page);
  await page.keyboard.press('p');
  await expect(page.getByTestId('palette')).toBeVisible();
  await expect(page.getByTestId('palette-filter')).toBeFocused();
  await page.getByTestId('palette-filter').fill('logs');
  await expect(page.getByTestId('palette-row')).toHaveCount(1);
  await shot(page, info, '65-selector');
  await page.getByTestId('palette-filter').press('Enter');
  await paneLoaded(page);
  await expect(page.locator('[data-testid="tab"][data-focused]')).toHaveAttribute(
    'data-address',
    `${HOST}/work/1.0`,
  );
  await page.getByTestId('open-palette').click();
  // The window by name: another window may still show a split a spec
  // before this one killed, until the listing catches up. The view is
  // still settling (its first fit lands), so the whole step is tried
  // again if the palette lost the filter or Enter went astray: the
  // palette is reopened with p, and a stray prompt closed with Esc.
  await expect(async () => {
    if (!(await page.getByTestId('palette').isVisible())) {
      await page.keyboard.press('Escape');
      await page.keyboard.press('p');
      await expect(page.getByTestId('palette-filter')).toBeFocused({ timeout: 1500 });
    }
    await page.getByTestId('palette-filter').fill(`${HOST}/work/0 (2 panes`);
    await expect(page.getByTestId('palette-row')).toHaveCount(1, { timeout: 1500 });
    await page.getByTestId('palette-filter').press('Enter');
    await expect(page.getByTestId('window')).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 15_000 });
  await expect(page.getByTestId('cell')).toHaveCount(2);
});
