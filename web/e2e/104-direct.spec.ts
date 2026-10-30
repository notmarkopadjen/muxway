import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { control, HOST, settled, SHELL0, shot, signIn } from './fixtures';

// Direct typing: a click on the tile, or i, and every key goes to the
// pane as pressed; Shift+Esc, a click on the line or the ▮ button
// brings the line back. The pane here runs a program that prints every
// byte it reads, so Esc shows as \x1b.

const KEYS = !!process.env.MX_KEYS;

// Every byte the pane's program read, joined: its screen shows one
// repr per read.
async function typed(request: APIRequestContext) {
  const text = await control(request, '/capture', { target: 'work:0.0' });
  return text
    .split('\n')
    .map((l) => /^b'(.*)'\s*$/.exec(l)?.[1] ?? '')
    .join('');
}
async function expectTyped(request: APIRequestContext, bytes: string) {
  await expect.poll(() => typed(request), { timeout: 5000 }).toContain(bytes);
}
function watchInput(page: Page) {
  const bodies: { key?: string; count?: number; text?: string }[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/input') && r.method() === 'POST')
      bodies.push(JSON.parse(r.postData() ?? '{}'));
  });
  return bodies;
}

test('104 a click on the tile turns direct typing on: keys reach the pane as pressed, Esc included; Shift+Esc leaves, : takes the line, i enters again', async ({
  page,
  request,
}, info) => {
  test.skip(!KEYS, 'needs the key echo pane');
  await page.setViewportSize({ width: 1400, height: 900 });
  await signIn(page);
  await page.goto(`/p/${SHELL0}`);
  await settled(page);
  const input = page.getByTestId('input');
  await expect(input).toBeEnabled();
  const form = page.locator('form.mx-input');
  const prompt = page.getByTestId('prompt');
  await expect(prompt).toHaveText('>');
  await expect(form).not.toHaveAttribute('data-direct', '');
  await expect(page.getByTestId('caret')).toHaveCount(0);
  // The click.
  await page.getByTestId('screen').click();
  await expect(form).toHaveAttribute('data-direct', '');
  await expect(prompt).toHaveText('▮');
  await expect(page.getByTestId('status-direct')).toBeVisible();
  await expect(page.getByTestId('direct')).toHaveClass(/\bon\b/);
  await expect(page.getByTestId('caret')).toBeVisible();
  await expect(input).not.toBeFocused();
  await page.keyboard.type('ab');
  await expectTyped(request, 'ab');
  await page.keyboard.press('Escape');
  await expectTyped(request, String.raw`\x1b`);
  await expect(form).toHaveAttribute('data-direct', '');
  // The page's shortcuts are keys for the pane: ? opens no help.
  await page.keyboard.press('?');
  await expectTyped(request, '?');
  await expect(page.getByTestId('help')).toHaveCount(0);
  await page.keyboard.press('Control+c');
  await expectTyped(request, String.raw`\x03`);
  await page.keyboard.press('Shift+Tab');
  await expectTyped(request, String.raw`\x1b[Z`);
  await page.keyboard.press('ArrowUp');
  await expectTyped(request, String.raw`\x1b[A`);
  await shot(page, info, 'web-direct');
  // Shift+Esc leaves: ? is the help again, nothing reached the pane.
  const before = await typed(request);
  await page.keyboard.press('Shift+Escape');
  await expect(form).not.toHaveAttribute('data-direct', '');
  await expect(prompt).toHaveText('>');
  await expect(page.getByTestId('caret')).toHaveCount(0);
  await page.keyboard.press('?');
  await expect(page.getByTestId('help')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('help')).toHaveCount(0);
  expect(await typed(request)).toBe(before);
  // : takes the line, Esc leaves it, i enters direct typing; a click on
  // the line leaves it; the ▮ button both ways.
  await page.keyboard.press(':');
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('');
  await page.keyboard.press('Escape');
  await expect(input).not.toBeFocused();
  await page.keyboard.press('i');
  await expect(form).toHaveAttribute('data-direct', '');
  await input.click();
  await expect(input).toBeFocused();
  await expect(form).not.toHaveAttribute('data-direct', '');
  await page.getByTestId('direct').click();
  await expect(form).toHaveAttribute('data-direct', '');
  await expect(input).not.toBeFocused();
  await page.getByTestId('direct').click();
  await expect(form).not.toHaveAttribute('data-direct', '');
  expect(await typed(request)).toBe(before);
});

test('104 a held key and a paste coalesce: few requests, none over fifty, the paste one text', async ({
  page,
  request,
}) => {
  test.skip(!KEYS, 'needs the key echo pane');
  await page.setViewportSize({ width: 1400, height: 900 });
  await signIn(page);
  await page.goto(`/p/${SHELL0}`);
  await settled(page);
  await page.getByTestId('screen').click();
  await expect(page.locator('form.mx-input')).toHaveAttribute('data-direct', '');
  const bodies = watchInput(page);
  const REPEATS = 70;
  await page.evaluate((n) => {
    for (let i = 0; i < n; i++)
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'ArrowDown',
          code: 'ArrowDown',
          repeat: i > 0,
          bubbles: true,
          cancelable: true,
        }),
      );
  }, REPEATS);
  await expectTyped(request, String.raw`\x1b[B`.repeat(REPEATS));
  const downs = bodies.filter((b) => b.key === 'Down');
  expect(downs.length).toBeLessThan(REPEATS / 2);
  expect(downs.reduce((n, b) => n + (b.count ?? 1), 0)).toBe(REPEATS);
  for (const b of downs) expect(b.count ?? 1).toBeLessThanOrEqual(50);
  // A paste is one text: tabs widened, a control character dropped.
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', 'one\ttwo\x07 three');
    window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
  });
  await expectTyped(request, 'one  two three');
  expect(bodies.filter((b) => b.text !== undefined)).toEqual([{ text: 'one  two three' }]);
  // Typed text joins while a request is in flight, in order.
  await page.keyboard.type('hello', { delay: 0 });
  await expectTyped(request, 'hello');
});

test('104 Ctrl+V and Shift+Insert paste: nothing goes to the pane as a key, the paste types its text', async ({
  page,
  request,
}) => {
  test.skip(!KEYS, 'needs the key echo pane');
  await page.setViewportSize({ width: 1400, height: 900 });
  await signIn(page);
  await page.goto(`/p/${SHELL0}`);
  await settled(page);
  await page.getByTestId('screen').click();
  await expect(page.locator('form.mx-input')).toHaveAttribute('data-direct', '');
  const bodies = watchInput(page);
  await page.keyboard.press('Control+v');
  await page.keyboard.press('Shift+Insert');
  await page.keyboard.type('pv');
  await expectTyped(request, 'pv');
  expect(bodies.filter((b) => b.key !== undefined)).toEqual([]);
  // The browser's paste event, with text, types it as one request.
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', 'from the clipboard');
    window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
  });
  await expectTyped(request, 'from the clipboard');
  expect(bodies.filter((b) => b.text === 'from the clipboard')).toHaveLength(1);
});

test('104 security: a read-only pane has no direct typing', async ({ page }) => {
  test.skip(KEYS, 'the main environment has the read-only pane');
  await signIn(page);
  await page.goto(`/p/${HOST}/work/0.1`);
  await expect(page.getByTestId('readonly')).toBeVisible();
  await expect(page.getByTestId('direct')).toHaveCount(0);
  await page.getByTestId('screen').click();
  await page.keyboard.press('i');
  await expect(page.locator('form.mx-input')).not.toHaveAttribute('data-direct', '');
  await expect(page.getByTestId('prompt')).toHaveText('○');
});

test.describe('touch', () => {
  test.use({ hasTouch: true });
  test('104 a tap keeps the line: the prompt row focuses it, no direct typing', async ({
    page,
  }) => {
    test.skip(KEYS, 'the main environment has the shell pane');
    await signIn(page);
    await page.goto(`/p/${SHELL0}`);
    await settled(page);
    const input = page.getByTestId('input');
    const screen = page.getByTestId('screen');
    await screen.tap();
    await expect(page.locator('form.mx-input')).not.toHaveAttribute('data-direct', '');
    await screen
      .locator('.ln')
      .last()
      .tap({ position: { x: 4, y: 4 } });
    await expect(input).toBeFocused();
    await expect(page.locator('form.mx-input')).not.toHaveAttribute('data-direct', '');
  });
});
