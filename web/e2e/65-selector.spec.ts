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
  await page.keyboard.press('Enter');
  await paneLoaded(page);
  await expect(page.getByTestId('crumb')).toContainText(`${HOST}/work/1.0`);
  await page.getByTestId('open-palette').click();
  await page.getByTestId('palette-filter').fill('2 panes');
  await expect(page.getByTestId('palette-row')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('window')).toBeVisible();
  await expect(page.getByTestId('cell')).toHaveCount(2);
});
