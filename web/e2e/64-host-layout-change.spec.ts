import { expect, test } from '@playwright/test';
import { control, HOST, signIn } from './fixtures';

test('64 a new split on the host resets the view', async ({ page, request }) => {
  await signIn(page);
  await page.goto(`/w/${HOST}/work/1`);
  await expect(page.getByTestId('cell')).toHaveCount(1);
  const id = await control(request, '/split', { target: 'work:1.0' });
  await expect(page.getByTestId('cell')).toHaveCount(2, { timeout: 8000 });
  await expect(page.getByTestId('window')).toHaveAttribute(
    'data-layout',
    await control(request, '/layout', { target: 'work:1' }),
  );
  await control(request, '/kill-pane', { target: id });
  await expect(page.getByTestId('cell')).toHaveCount(1, { timeout: 8000 });
});
