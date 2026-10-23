import { expect, test } from '@playwright/test';
import { HOST, openPane, RO_TOKEN, signIn } from './fixtures';

test('46 a read-only pane shows content and refuses input', async ({ page }) => {
  await signIn(page, RO_TOKEN);
  await openPane(page, `${HOST}/work/0.1`);
  await expect(page.getByTestId('input')).toBeDisabled();
  await expect(page.getByTestId('readonly')).toBeVisible();
  await expect(
    page.getByTestId('keybar').getByRole('button', { name: 'Enter', exact: true }),
  ).toBeDisabled();
});
