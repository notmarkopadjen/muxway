import { expect, test } from '@playwright/test';
import { control, openPane, SHELL0, shot, signIn } from './fixtures';

test('45 read a pane, type into it, interrupt a command', async ({ page, request }, info) => {
  await signIn(page);
  await openPane(page, SHELL0);
  await control(request, '/send', { target: 'work:0.0', text: 'echo from-tmux-$((40+2))' });
  await expect(page.getByTestId('screen')).toContainText('from-tmux-42', { timeout: 5000 });
  await page.getByTestId('input').fill('echo from-browser-$((40+3))');
  await page.getByTestId('input').press('Enter');
  await expect(page.getByTestId('screen')).toContainText('from-browser-43', { timeout: 5000 });
  await shot(page, info, '45-pane');
  await page.getByTestId('input').fill('sleep 100');
  await page.getByTestId('input').press('Enter');
  await expect.poll(() => control(request, '/command', { target: 'work:0.0' })).toBe('sleep');
  await page.getByTestId('keybar').getByRole('button', { name: 'C-c', exact: true }).click();
  await expect.poll(() => control(request, '/command', { target: 'work:0.0' })).toBe('bash');
  // Leaving the pane gives the window back to tmux, so the next spec finds it at rest.
  await page.goto('/');
  await expect
    .poll(() => control(request, '/window-size', { target: 'work:0' }), { timeout: 5000 })
    .toBe('100x30');
});
