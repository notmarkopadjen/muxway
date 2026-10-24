import { expect, test } from '@playwright/test';
import { control, HOST, seedBoard, signIn } from './fixtures';

test('72 a pane killed on the host leaves a gap the board can drop', async ({ page, request }) => {
  const A = `${HOST}/work/0.0`;
  const id = await control(request, '/split', { target: 'work:1.0' });
  await signIn(page);
  // The hub lists the new pane once its cache of the host has turned over.
  let extra = '';
  await expect
    .poll(
      async () => {
        extra = await page.evaluate(async (paneId) => {
          const r = await fetch('/v1/panes', { headers: { 'X-Muxway-Client': 'web' } });
          const { panes } = (await r.json()) as { panes: { pane_id: string; address: string }[] };
          return panes.find((p) => p.pane_id === paneId)?.address ?? '';
        }, id);
        return extra;
      },
      { timeout: 10_000 },
    )
    .toContain(`${HOST}/work/1.`);
  await seedBoard(page, 'main', [A, extra]);
  await page.goto('/b/main');
  await expect(page.getByTestId('cell')).toHaveCount(2);
  await control(request, '/kill-pane', { target: id });
  await expect(page.getByTestId('gap')).toHaveCount(1, { timeout: 10_000 });
  await expect(page.getByTestId('gap')).toContainText('gone');
  await control(request, '/send', { target: 'work:0.0', text: 'echo still-here-$((70+2))' });
  await expect(page.locator(`[data-pane="${A}"]`).getByTestId('cell-screen')).toContainText(
    'still-here-72',
    { timeout: 5000 },
  );
  await page.getByTestId('gap').getByRole('button', { name: 'remove' }).click();
  await expect(page.getByTestId('gap')).toHaveCount(0);
  await expect(page.getByTestId('board')).toHaveAttribute('data-panes', A);
});
