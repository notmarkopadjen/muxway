import { expect, test } from '@playwright/test';

test('44 sign in through the identity provider', async ({ page }) => {
  await page.goto('/signin');
  const button = page.getByTestId('provider-oidc');
  await expect(button).toHaveText('Sign in with Test');
  await button.click();
  await expect(page.getByTestId('panes')).toBeVisible();
  await expect(page.getByTestId('who')).toContainText('alice@example.com');
});
