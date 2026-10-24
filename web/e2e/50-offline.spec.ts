import { expect, test } from '@playwright/test';
import { control, signIn } from './fixtures';

test('50 the hub goes away and comes back', async ({ page, request }) => {
  await signIn(page);
  await expect(page.getByTestId('online')).toContainText('● hub');
  await control(request, '/hub', { state: 'stop' });
  await expect(page.getByTestId('online')).toContainText('unreachable', { timeout: 15_000 });
  await control(request, '/hub', { state: 'start' });
  // Sessions live in the hub's memory: the page goes to sign in by itself,
  // and the old cookie has not locked the address out.
  await expect(page).toHaveURL(/\/signin$/, { timeout: 20_000 });
  await signIn(page);
  await expect(page.getByTestId('online')).toContainText('● hub');
});
