import { expect, test } from '@playwright/test';
import { control, signIn } from './fixtures';

test('50 the hub goes away and comes back', async ({ page, request }) => {
  await signIn(page);
  await expect(page.getByTestId('online')).toContainText('● hub');
  await control(request, '/hub', { state: 'stop' });
  await expect(page.getByTestId('online')).toContainText('unreachable', { timeout: 15_000 });
  await control(request, '/hub', { state: 'start' });
  await expect(page.getByTestId('online')).toContainText('● hub', { timeout: 20_000 });
  // Sessions live in the hub's memory: the next navigation asks to sign in again.
  await page.goto('/');
  await expect(page).toHaveURL(/\/signin$/);
});
