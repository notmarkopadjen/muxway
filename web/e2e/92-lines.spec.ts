import { expect, test, type Locator, type Page } from '@playwright/test';
import { control, openPane, RO_TOKEN, SHELL0, shot, signIn } from './fixtures';

// The input line as a small editor: Shift+Enter adds a row and the field
// grows upward, Enter sends the lines as one paste; the first word is
// completed from the client's own lists; the console keys go to the pane
// from an empty line; Esc leaves the line, Shift+Esc sends Escape.

const PLAIN_CAT = `printf '\\033[?2004l'; cat -v`;

function watchInput(page: Page) {
  const inputs: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/input')) inputs.push(r.postData() ?? '');
  });
  return inputs;
}

const height = async (l: Locator) => (await l.boundingBox())!.height;

test('92 security: a read-only grant gets a disabled line and no completion', async ({ page }) => {
  await signIn(page, RO_TOKEN);
  await openPane(page, SHELL0);
  const input = page.getByTestId('input');
  await expect(input).toBeDisabled();
  await page.keyboard.press('i');
  await expect(input).not.toBeFocused();
  await expect(page.getByTestId('complete')).toHaveCount(0);
});

test('92 lines: Shift+Enter adds a row, the field grows upward, Enter sends the block', async ({
  page,
  request,
}, info) => {
  await signIn(page);
  await openPane(page, SHELL0);
  const input = page.getByTestId('input');
  const screen = page.getByTestId('screen');
  const inputs = watchInput(page);
  await input.click();
  const oneRow = await height(input);
  const screenBefore = await height(screen);
  await page.keyboard.type('echo one');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('echo two');
  await expect(input).toHaveValue('echo one\necho two');
  expect(inputs).toEqual([]);
  const twoRows = await height(input);
  expect(twoRows).toBeGreaterThan(oneRow + 8);
  expect(await height(screen)).toBeLessThan(screenBefore);
  await shot(page, info, '92-two-rows');
  // Enter sends both lines as one text, then Enter; the field is one row again.
  await page.keyboard.press('Enter');
  await expect(input).toHaveValue('');
  await expect
    .poll(() => inputs)
    .toEqual([JSON.stringify({ text: 'echo one\necho two' }), JSON.stringify({ key: 'Enter' })]);
  expect(await height(input)).toBe(oneRow);
  const capture = () => control(request, '/capture', { target: 'work:0.0' });
  await expect.poll(capture, { timeout: 5000 }).toMatch(/^one$/m);
  await expect.poll(capture, { timeout: 5000 }).toMatch(/^two$/m);
  // A long text wraps into rows, none hidden; past six rows it scrolls inside.
  await input.fill('word '.repeat(60).trim());
  expect(await height(input)).toBeGreaterThan(oneRow + 8);
  expect(await input.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThan(2);
  await input.fill(Array.from({ length: 8 }, (_, i) => `row ${i + 1}`).join('\n'));
  const sixRows = await height(input);
  expect(await input.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(8);
  await input.fill(Array.from({ length: 12 }, (_, i) => `row ${i + 1}`).join('\n'));
  expect(await height(input)).toBe(sixRows);
  await input.fill('');
  expect(await height(input)).toBe(oneRow);
});

test('92 completion: Claude slash commands, a shell recent line; Enter sends the pick', async ({
  page,
  request,
}, info) => {
  await signIn(page);
  await openPane(page, SHELL0);
  const input = page.getByTestId('input');
  const list = page.getByTestId('complete');
  const rows = page.getByTestId('completion');
  const capture = () => control(request, '/capture', { target: 'work:0.0' });
  await control(request, '/rename', { what: 'title', target: 'work:0.0', name: '✳ building' });
  await expect(page.getByTestId('cmdbar')).toHaveAttribute('data-kind', 'claude', {
    timeout: 10_000,
  });
  await input.click();
  await page.keyboard.type('/co');
  await expect(list).toBeVisible();
  await expect(rows).toHaveText(['▸ /compact', '  /context', '  /cost', '  /config']);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(rows.nth(2)).toHaveAttribute('aria-selected', 'true');
  await shot(page, info, '92-complete');
  await page.keyboard.press('Tab');
  await expect(input).toHaveValue('/cost ');
  await expect(input).toBeFocused();
  await expect(list).toHaveCount(0);
  // A click takes a row too, and the caret lands after the space.
  await input.fill('/re');
  await rows.filter({ hasText: '/resume' }).click();
  await expect(input).toHaveValue('/resume ');
  expect(await input.evaluate((el: HTMLTextAreaElement) => el.selectionStart)).toBe(8);
  // Enter sends the highlighted completion, not the half-typed word.
  await input.fill('');
  const inputs = watchInput(page);
  await page.keyboard.type('/co');
  await expect(list).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(list).toHaveCount(0);
  await expect(input).toHaveValue('');
  await expect
    .poll(() => inputs)
    .toEqual([JSON.stringify({ text: '/compact' }), JSON.stringify({ key: 'Enter' })]);
  await expect.poll(capture, { timeout: 5000 }).toContain('$ /compact');
  // A second word, or a caret before the first word's end, gets no list.
  await page.keyboard.type('/compact now');
  await expect(list).toHaveCount(0);
  await input.fill('');
  // A shell: its starters and a line sent before; Esc closes the list and keeps the text.
  await control(request, '/rename', { what: 'title', target: 'work:0.0', name: 'test-pane' });
  await expect(page.getByTestId('cmdbar')).toHaveAttribute('data-kind', 'shell', {
    timeout: 10_000,
  });
  // A line that is no starter, with output short enough to keep its prompt in view.
  await input.click();
  await page.keyboard.type('echo hi-$((90+2))');
  await page.keyboard.press('Enter');
  await expect.poll(capture, { timeout: 5000 }).toContain('$ echo hi-$((90+2))');
  await page.keyboard.type('e');
  await expect(rows).toHaveText(['▸ exit', '  echo hi-$((90+2))']);
  await page.keyboard.press('Escape');
  await expect(list).toHaveCount(0);
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('e');
  await page.keyboard.type('c');
  // The line sent before comes first; the word on the screen after it, marked ⇥.
  await expect(rows).toHaveText(['▸ echo hi-$((90+2))', '  echo ⇥']);
  await input.fill('');
  await page.evaluate(() => localStorage.removeItem('mx-recent'));
});

test('92 keys: i focuses the line, Esc leaves it, console keys from an empty line, Shift+Esc', async ({
  page,
  request,
}) => {
  await control(request, '/send', { target: 'work:0.0', text: PLAIN_CAT });
  await signIn(page);
  await openPane(page, SHELL0);
  const input = page.getByTestId('input');
  const capture = () => control(request, '/capture', { target: 'work:0.0' });
  await expect(page.getByTestId('cmdbar')).toHaveCount(0, { timeout: 10_000 });
  await page.keyboard.press('i');
  await expect(input).toBeFocused();
  // Esc leaves the line: the view's keys work again, a second Esc goes to the list.
  await page.keyboard.press('Escape');
  await expect(input).not.toBeFocused();
  await expect(page.getByTestId('pane')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('panes')).toBeVisible();
  await openPane(page, SHELL0);
  await page.keyboard.press('i');
  await expect(input).toBeFocused();
  // Empty line: the console keys reach the pane as named keys.
  const inputs = watchInput(page);
  for (const k of ['ArrowUp', 'PageUp', 'Home', 'Tab']) await page.keyboard.press(k);
  await expect
    .poll(() => inputs)
    .toEqual(['Up', 'PageUp', 'Home', 'Tab'].map((key) => JSON.stringify({ key })));
  await expect.poll(capture, { timeout: 5000 }).toContain('^[[A^[[5~^[[1~');
  await expect(input).toBeFocused();
  // With text, the arrows move the caret and nothing is sent.
  await page.keyboard.type('abc');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Home');
  expect(await input.evaluate((el: HTMLTextAreaElement) => el.selectionStart)).toBe(0);
  await page.keyboard.press('End');
  expect(await input.evaluate((el: HTMLTextAreaElement) => el.selectionStart)).toBe(3);
  expect(inputs).toHaveLength(4);
  // Shift+Esc sends Escape to the pane and keeps the line and its text.
  await page.keyboard.press('Shift+Escape');
  await expect.poll(() => inputs.at(-1)).toBe(JSON.stringify({ key: 'Escape' }));
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('abc');
  await input.fill('');
  await page.getByTestId('keybar').getByRole('button', { name: 'C-c', exact: true }).click();
  await expect(page.getByTestId('cmdbar')).toHaveAttribute('data-kind', 'shell', {
    timeout: 10_000,
  });
});
