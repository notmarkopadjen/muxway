import { expect, test, type Page } from '@playwright/test';
import { control, openPane, settled, SHELL0, shot, signIn } from './fixtures';

// From the screen to the line: a block copied with one click on its
// mark, a click on the prompt row focusing the line, and the words on
// the screen offered as completions.

function watchInput(page: Page) {
  const inputs: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/input')) inputs.push(r.postData() ?? '');
  });
  return inputs;
}

async function mouseOn(page: Page, request: Parameters<typeof control>[0]) {
  await control(request, '/send', {
    target: 'work:0.0',
    text: `printf '\\033[?1000h\\033[?1006h'; cat -v`,
  });
  await expect.poll(() => control(request, '/command', { target: 'work:0.0' })).toBe('cat');
  await expect
    .poll(async () => {
      const r = await page.request.get(`/v1/panes/${SHELL0}`, {
        headers: { 'X-Muxway-Client': 'web' },
      });
      return ((await r.json()) as { pane: { mouse?: boolean } }).pane.mouse ?? false;
    })
    .toBe(true);
  await page.waitForTimeout(1200);
}

async function mouseOff(page: Page, request: Parameters<typeof control>[0]) {
  await page.getByTestId('keybar').getByRole('button', { name: 'C-c', exact: true }).click();
  await expect.poll(() => control(request, '/command', { target: 'work:0.0' })).toBe('bash');
  await control(request, '/send', {
    target: 'work:0.0',
    text: `printf '\\033[?1000l\\033[?1006l'`,
  });
}

test('85 a block under the pointer shows its mark; a click copies it without the bars', async ({
  page,
  context,
  request,
}, info) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await signIn(page);
  await openPane(page, SHELL0);
  await settled(page);
  await control(request, '/send', {
    target: 'work:0.0',
    text: `printf '│ one\\n│ two\\n│ three\\n● a bullet\\n  with a row under it\\n'`,
  });
  const screen = page.getByTestId('screen');
  await expect(screen).toContainText('with a row under it', { timeout: 5000 });
  const row = screen.locator('.ln').filter({ hasText: '│ two' }).last();
  await row.hover();
  const mark = page.getByTestId('copy-block');
  await expect(mark).toBeVisible();
  await shot(page, info, '85-copy');
  await mark.click();
  await expect(page.getByTestId('toast').filter({ hasText: 'copied' })).toContainText('3 rows');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('one\ntwo\nthree');
  // The bullet and the row under it are one block, without the marker and the indent.
  await screen.locator('.ln').filter({ hasText: 'with a row under it' }).last().hover();
  await mark.click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'a bullet\nwith a row under it',
  );
  // With the mouse on, the click on the mark reaches the pane as nothing.
  await mouseOn(page, request);
  const inputs = watchInput(page);
  await screen.locator('.ln').filter({ hasText: '│ one' }).last().hover();
  await mark.click();
  await expect(page.getByTestId('toast').filter({ hasText: 'copied' }).last()).toBeVisible();
  await page.waitForTimeout(600);
  expect(inputs).toEqual([]);
  await mouseOff(page, request);
  await control(request, '/send', { target: 'work:0.0', text: 'clear' });
});

test('85 a click on the prompt row focuses the line, and with the mouse on also reaches the pane', async ({
  page,
  request,
}) => {
  await signIn(page);
  await openPane(page, SHELL0);
  await settled(page);
  const input = page.getByTestId('input');
  await expect(input).not.toBeFocused();
  const screen = page.getByTestId('screen');
  const rows = screen.locator('.ln');
  // The row above the prompt is not the prompt: a click there focuses nothing.
  await control(request, '/send', { target: 'work:0.0', text: 'echo above the prompt' });
  await expect(screen).toContainText('above the prompt', { timeout: 5000 });
  await page.waitForTimeout(1200);
  await rows.filter({ hasText: 'above the prompt' }).last().click();
  await expect(input).not.toBeFocused();
  await rows.last().click({ position: { x: 4, y: 4 } });
  await expect(input).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(input).not.toBeFocused();
  // With the mouse on, cat waits on a blank row below its echo, which the
  // host leaves out: the last row shown stands for it.
  await mouseOn(page, request);
  const inputs = watchInput(page);
  await rows.last().click({ position: { x: 4, y: 4 } });
  await expect(input).toBeFocused();
  await expect.poll(() => inputs.length).toBe(1);
  expect(inputs[0]).toContain('"left"');
  await page.keyboard.press('Escape');
  await mouseOff(page, request);
  await control(request, '/send', { target: 'work:0.0', text: 'clear' });
});

test('85 a word on the screen completes any word, after the commands; Enter sends the line as typed', async ({
  page,
  request,
}) => {
  await expect.poll(() => control(request, '/command', { target: 'work:0.0' })).toBe('bash');
  await signIn(page);
  await openPane(page, SHELL0);
  await settled(page);
  await control(request, '/send', { target: 'work:0.0', text: 'echo docs/plans/keeps-still.md' });
  const screen = page.getByTestId('screen');
  await expect(screen).toContainText('docs/plans/keeps-still.md', { timeout: 5000 });
  await page.waitForTimeout(1200);
  const input = page.getByTestId('input');
  await input.click();
  await page.keyboard.type('cat docs/pl');
  const offer = page.getByTestId('completion').filter({ hasText: 'docs/plans/keeps-still.md' });
  await expect(offer).toHaveAttribute('data-kind', 'word');
  await page.keyboard.press('Tab');
  await expect(input).toHaveValue('cat docs/plans/keeps-still.md ');
  await input.fill('');
  // The first word still gets the shell's starters first, and Enter sends what was typed.
  await page.keyboard.type('ht');
  await expect(page.getByTestId('completion').first()).toHaveAttribute('data-kind', 'command');
  await input.fill('');
  await page.keyboard.type('echo do');
  await expect(page.getByTestId('completion').first()).toHaveAttribute('data-kind', 'word');
  await page.keyboard.press('Enter');
  const rows = screen.locator('.ln');
  await expect(rows.filter({ hasText: /^\$ echo do\s*$/ })).toHaveCount(1, { timeout: 5000 });
  await expect(rows.filter({ hasText: /^do\s*$/ })).toHaveCount(1);
  await control(request, '/send', { target: 'work:0.0', text: 'clear' });
});
