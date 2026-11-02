import { expect, test, type Page } from '@playwright/test';
import { control, openPane, settled, SHELL0, shot, signIn } from './fixtures';

// The shell helper, round two: the ghost word. While a shell pane is
// typed into, direct or on the line, the rest of a known line is drawn
// dim after the cursor; Right accepts it, Ctrl+Right one word, any other
// key ignores it. Nothing is sent until Right, and a line that looks like
// a secret is never offered.

const PREVIEW = process.env.MX_PREVIEW ?? '';

function watchInput(page: Page) {
  const bodies: { key?: string; count?: number; text?: string }[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/input') && r.method() === 'POST')
      bodies.push(JSON.parse(r.postData() ?? '{}'));
  });
  return bodies;
}

async function withHelp(page: Page, act: () => Promise<void>) {
  await page.keyboard.press('?');
  await expect(page.getByTestId('help')).toBeVisible();
  await act();
  await page.getByTestId('help').click({ position: { x: 4, y: 4 } });
  await expect(page.getByTestId('help')).toHaveCount(0);
}

test('115 the ghost word: a line sent before goes on after the cursor; Right takes it, Ctrl+Right a word; the screen and the line too', async ({
  page,
  request,
}, info) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await signIn(page);
  await openPane(page, SHELL0);
  await settled(page);
  const screen = page.getByTestId('screen');
  const input = page.getByTestId('input');
  const ghost = screen.getByTestId('ghost');
  const inputs = watchInput(page);
  // A line sent from the input line is remembered.
  await input.fill('echo one two');
  await input.press('Enter');
  await expect(screen).toContainText('one two', { timeout: 5000 });
  await control(request, '/send', { target: 'work:0.0', text: 'clear' });
  // Direct typing: the ghost shows once the screen confirms the typed part.
  await screen.click();
  await expect(page.getByTestId('caret')).toBeVisible();
  await page.keyboard.type('echo o');
  await expect(ghost).toHaveText('ne two', { timeout: 5000 });
  await shot(page, info, '115-ghost');
  // A key that goes on past the ghost drops it; Backspace brings it back.
  await page.keyboard.type('x');
  await expect(ghost).toHaveCount(0, { timeout: 5000 });
  await page.keyboard.press('Backspace');
  await expect(ghost).toHaveText('ne two', { timeout: 5000 });
  // Ctrl+Right takes a word, Right the rest; both go as text.
  let n = inputs.length;
  await page.keyboard.press('Control+ArrowRight');
  await expect.poll(() => inputs.length).toBe(n + 1);
  expect(inputs[n]).toEqual({ text: 'ne ' });
  await expect(ghost).toHaveText('two', { timeout: 5000 });
  n = inputs.length;
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => inputs.length).toBe(n + 1);
  expect(inputs[n]).toEqual({ text: 'two' });
  await expect(ghost).toHaveCount(0, { timeout: 5000 });
  await page.keyboard.press('Enter');
  await expect(screen.locator('.ln', { hasText: /^one two$/ })).toHaveCount(1, { timeout: 5000 });
  // Without a ghost, Right is the pane's key.
  n = inputs.length;
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => inputs.length).toBe(n + 1);
  expect(inputs[n]).toEqual({ key: 'Right' });
  // Text right of the cursor: no ghost; back at the end, the row alone
  // gives it, the shadow being lost to Home.
  await page.keyboard.type('echo o');
  await expect(ghost).toHaveText('ne two', { timeout: 5000 });
  await page.keyboard.press('Home');
  await expect(ghost).toHaveCount(0, { timeout: 5000 });
  await page.keyboard.press('End');
  await expect(ghost).toHaveText('ne two', { timeout: 5000 });
  await page.keyboard.press('Control+c');
  await expect(ghost).toHaveCount(0, { timeout: 5000 });
  // A name of the directory after a word, a directory with its slash.
  if (PREVIEW) {
    await page.keyboard.type('cd pl');
    await expect(ghost).toHaveText('ans/', { timeout: 8000 });
    await page.keyboard.press('Control+c');
    await expect(ghost).toHaveCount(0, { timeout: 5000 });
  }
  // The line: the same ghost in the field, Right takes it into the field.
  await page.keyboard.press('Shift+Escape');
  await input.fill('echo o');
  await expect(page.getByTestId('line-ghost')).toHaveText('ne two');
  await input.press('ArrowRight');
  await expect(input).toHaveValue('echo one two');
  await expect(page.getByTestId('line-ghost')).toHaveCount(0);
  await input.fill('');
  await page.keyboard.press('Escape');
  // The setting off: no ghost anywhere.
  await withHelp(page, async () => {
    await page.getByTestId('suggest').click();
    await expect(page.getByTestId('suggest')).toHaveText('suggest: off');
  });
  await screen.click();
  await page.keyboard.type('echo o');
  await page.waitForTimeout(1500);
  await expect(ghost).toHaveCount(0);
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Shift+Escape');
  await withHelp(page, async () => {
    await page.getByTestId('suggest').click();
    await expect(page.getByTestId('suggest')).toHaveText('suggest: on');
  });
  // Forgetting the sent lines: with the screen cleared, nothing is left
  // to go on from.
  await withHelp(page, async () => {
    const forget = page.getByTestId('forget');
    await expect(forget).toBeEnabled();
    await forget.click();
    await expect(forget).toHaveText('forget 0 sent lines');
    await expect(forget).toBeDisabled();
  });
  await control(request, '/send', { target: 'work:0.0', text: 'clear' });
  await expect(screen).not.toContainText('one two', { timeout: 5000 });
  await screen.click();
  await page.keyboard.type('echo o');
  await page.waitForTimeout(1500);
  await expect(ghost).toHaveCount(0);
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Shift+Escape');
  await control(request, '/send', { target: 'work:0.0', text: 'clear' });
});

test('115 security: a line that looks like a secret is never offered, from the store or from the screen', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await signIn(page);
  await openPane(page, SHELL0);
  await settled(page);
  const screen = page.getByTestId('screen');
  const input = page.getByTestId('input');
  const ghost = screen.getByTestId('ghost');
  for (const line of [
    'mysql -u root -p hunter2 shop',
    'http -a alice:hunter2 https://example.com/',
  ]) {
    await input.fill(line);
    await input.press('Enter');
  }
  await expect(screen).toContainText('http -a alice:hunter2', { timeout: 5000 });
  await page.keyboard.press('Escape');
  await withHelp(page, async () => {
    await expect(page.getByTestId('forget')).toHaveText('forget 0 sent lines');
  });
  await screen.click();
  for (const typed of ['mysql -u r', 'http -a a']) {
    await page.keyboard.type(typed);
    await page.waitForTimeout(1500);
    await expect(ghost).toHaveCount(0);
    await page.keyboard.press('Control+c');
  }
  await page.keyboard.press('Shift+Escape');
  await control(request, '/send', { target: 'work:0.0', text: 'clear' });
});
