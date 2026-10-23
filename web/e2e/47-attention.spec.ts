import { expect, test } from '@playwright/test';
import { control, openPane, SHELL0, shot, signIn } from './fixtures';

test('47 a notification raises a badge and a toast, input clears it', async ({
  page,
  request,
}, info) => {
  await signIn(page);
  const pane = await control(request, '/pane-id', { target: 'work:0.0' });
  await control(request, '/notify', { pane, kind: 'question', text: 'deploy to staging?' });
  const toast = page.getByTestId('toast');
  await expect(toast).toContainText('question');
  await expect(toast).toContainText('deploy to staging?');
  const row = page.getByTestId('pane-row').filter({ hasText: SHELL0 });
  await expect(row.getByTestId('badge')).toHaveAttribute('data-kind', 'question');
  await shot(page, info, '47-attention');
  await toast.click();
  await expect(page.getByTestId('pane')).toBeVisible();
  await expect(page.getByTestId('pane-attention')).toContainText('question');
  await page.getByTestId('input').fill('y');
  await page.getByTestId('input').press('Enter');
  await expect(page.getByTestId('pane-attention')).toHaveCount(0);
  await page.goto('/');
  await expect(page.getByTestId('panes')).toBeVisible();
  await expect(row.getByTestId('badge')).toHaveCount(0);
  void openPane;
});
