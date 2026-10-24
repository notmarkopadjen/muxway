import { expect, test } from '@playwright/test';
import { control, openPane, SHELL0, shot, signIn } from './fixtures';

test('82 a click on a pane whose program asked for the mouse is a click at that cell', async ({
  page,
  request,
}, info) => {
  await signIn(page);
  await openPane(page, SHELL0);
  // Fit sizes the pane first; then a click in a shell, which did not ask
  // for the mouse, types nothing.
  await expect
    .poll(() => control(request, '/window-size', { target: 'work:0' }), { timeout: 5000 })
    .not.toBe('100x30');
  const fitted = await page.getByTestId('pane-size').innerText();
  expect(fitted).toMatch(/^\d+×\d+$/);
  await page.waitForTimeout(500);
  const before = await control(request, '/capture', { target: 'work:0.0' });
  await page.getByTestId('screen').click();
  await page.waitForTimeout(500);
  expect(await control(request, '/capture', { target: 'work:0.0' })).toBe(before);
  // cat -v shows what it reads, after printf asked for the mouse in SGR.
  await control(request, '/send', {
    target: 'work:0.0',
    text: `printf '\\033[?1000h\\033[?1006h'; cat -v`,
  });
  await expect.poll(() => control(request, '/command', { target: 'work:0.0' })).toBe('cat');
  // Wait until the page has the pane with the mouse on, then click the
  // fifth cell of the last line, the cursor's row.
  await expect
    .poll(async () => {
      const r = await page.request.get(`/v1/panes/${SHELL0}`, {
        headers: { 'X-Muxway-Client': 'web' },
      });
      return ((await r.json()) as { pane: { mouse?: boolean } }).pane.mouse ?? false;
    })
    .toBe(true);
  await page.waitForTimeout(1200);
  const lines = page.locator('[data-testid="screen"] .ln');
  const line = lines.last();
  const box = (await line.boundingBox())!;
  // A cell is as wide as one glyph of the line above, the command typed.
  const cell = await lines.nth((await lines.count()) - 2).evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return range.getBoundingClientRect().width / (el.textContent ?? ' ').length;
  });
  await page.mouse.click(box.x + cell * 4.5, box.y + box.height / 2);
  await expect
    .poll(() => control(request, '/capture', { target: 'work:0.0' }), { timeout: 5000 })
    .toMatch(/\^\[\[<0;5;\d+M\^\[\[<0;5;\d+m/);
  await shot(page, info, '82-mouse');
  await page.getByTestId('keybar').getByRole('button', { name: 'C-c' }).click();
  await expect.poll(() => control(request, '/command', { target: 'work:0.0' })).toBe('bash');
  // cat left the mouse on; the next spec wants a plain shell.
  await control(request, '/send', {
    target: 'work:0.0',
    text: `printf '\\033[?1000l\\033[?1006l'`,
  });
  // Leaving the pane gives the window back to tmux, so the next spec finds it at rest.
  await page.goto('/');
  await expect
    .poll(() => control(request, '/window-size', { target: 'work:0' }), { timeout: 5000 })
    .toBe('100x30');
});
