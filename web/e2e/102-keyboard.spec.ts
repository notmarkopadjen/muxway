import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { control, HOST, opened, settled, SHELL0, shot, signIn } from './fixtures';

// The keyboard: an icon right of the input line opens a window with a
// full terminal board that sends each click to the focused pane. The pane
// here runs a program that prints every byte it reads.

const KEYS = !!process.env.MX_KEYS;

const seen = (request: APIRequestContext) => control(request, '/capture', { target: 'work:0.0' });
const cap = (page: Page, label: string) =>
  page.getByTestId('keyboard').locator(`.mx-cap[data-cap="${label}"]`).first();

async function expectBytes(request: APIRequestContext, bytes: string) {
  await expect
    .poll(async () => (await seen(request)).includes(bytes), { timeout: 5000 })
    .toBe(true);
}

test('102 the keyboard sends every key as the terminal would', async ({ page, request }, info) => {
  test.skip(!KEYS, 'needs the key echo pane');
  await page.setViewportSize({ width: 1400, height: 900 });
  await signIn(page);
  await page.goto(`/p/${SHELL0}`);
  await settled(page);
  await expect(page.getByTestId('input')).toBeEnabled();
  // keyboard, then the microphone where there is one, then send.
  const order = await page
    .locator('.mx-input')
    .evaluate((el) =>
      [...el.querySelectorAll('textarea, button')].map(
        (b) => b.getAttribute('data-testid') ?? b.tagName,
      ),
    );
  expect(order.indexOf('keyboard-open')).toBe(order.indexOf('input') + 1);
  expect(order.indexOf('send')).toBe(order.length - 1);
  await expect(page.getByTestId('send')).toHaveText('⏎');
  await shot(page, info, '102-row');

  await page.getByTestId('keyboard-open').click();
  const board = page.getByTestId('keyboard');
  await expect(board).toBeVisible();
  await expect(page.getByTestId('keyboard-target')).toHaveText(SHELL0);
  expect(await board.locator('.mx-cap').count()).toBeGreaterThan(110);
  await shot(page, info, '102-keyboard');

  await cap(page, 'Ctrl').click();
  await expect(cap(page, 'Ctrl')).toHaveAttribute('data-latch', 'once');
  await cap(page, 'Alt').click();
  await shot(page, info, '102-latched');
  await cap(page, 'Del').click();
  await expectBytes(request, String.raw`\x1b[3;7~`);
  await expect(cap(page, 'Ctrl')).not.toHaveAttribute('data-latch', /./);
  await cap(page, '⇧ Shift').click();
  await cap(page, '↑').click();
  await expectBytes(request, String.raw`\x1b[1;2A`);
  await cap(page, 'F17').click();
  await expectBytes(request, String.raw`\x1b[15;2~`);
  await cap(page, 'Caps').click();
  await cap(page, 'Q').click();
  await expectBytes(request, `b'Q'`);
  await cap(page, 'Caps').click();
  await cap(page, 'Attn').click();
  await expectBytes(request, String.raw`\x03`);
  // The keypad by Num Lock: a digit, then the key under it.
  const pad7 = board.locator('.mx-cap[data-cap="7"]').last();
  await pad7.click();
  await expectBytes(request, `b'7'`);
  await cap(page, 'Num').click();
  const before = await seen(request);
  await pad7.click();
  await expect.poll(async () => (await seen(request)).length).toBeGreaterThan(before.length);
  expect((await seen(request)).slice(before.length)).not.toContain(`b'7'`);
  // Ctrl with ; cannot reach a pane: dimmed while Ctrl is latched, refused.
  await cap(page, 'Ctrl').click();
  await expect(cap(page, ';')).toHaveAttribute('data-dim', '');
  await cap(page, ';').click();
  await expect(page.getByText('Ctrl or Alt with ; cannot reach a pane')).toBeVisible();

  // The bar drags the window, _ folds it, Esc closes it.
  await opened(board);
  const at = (await board.boundingBox())!;
  const bar = (await page.getByTestId('keyboard-bar').boundingBox())!;
  await page.mouse.move(bar.x + 60, bar.y + bar.height / 2);
  await page.mouse.down();
  await page.mouse.move(bar.x + 160, bar.y + bar.height / 2 - 80, { steps: 5 });
  await page.mouse.up();
  const moved = (await board.boundingBox())!;
  expect(Math.round(moved.x - at.x)).toBe(100);
  await page.getByTestId('keyboard-fold').click();
  await expect(board.locator('.mx-cap')).toHaveCount(0);
  await page.getByTestId('keyboard-fold').click();
  await page.getByTestId('keyboard-bar').click({ position: { x: 20, y: 5 } });
  await page.keyboard.press('Escape');
  await expect(board).toHaveCount(0);
  await expect(page.getByTestId('pane')).toBeVisible();
  // K opens it again, away from the input line (the click went direct;
  // Shift+Esc brings the page's keys back).
  await page.getByTestId('screen').click();
  await page.keyboard.press('Shift+Escape');
  await page.keyboard.press('K');
  await expect(board).toBeVisible();
  expect(Math.round((await board.boundingBox())!.x)).toBe(Math.round(moved.x));
});

test('102 on a phone the keyboard takes the bottom of the screen', async ({ page }, info) => {
  test.skip(!KEYS, 'needs the key echo pane');
  await page.setViewportSize({ width: 412, height: 860 });
  await signIn(page);
  await page.goto(`/p/${SHELL0}`);
  await settled(page);
  await page.getByTestId('keyboard-open').click();
  await opened(page.getByTestId('keyboard'));
  const b = (await page.getByTestId('keyboard').boundingBox())!;
  expect(Math.round(b.x)).toBe(0);
  expect(Math.round(b.width)).toBe(412);
  expect(Math.round(b.y + b.height)).toBe(860);
  await shot(page, info, '102-phone');
});

test('102 security: no keyboard on a read-only pane', async ({ page }) => {
  test.skip(KEYS, 'the main environment has the read-only pane');
  await signIn(page);
  await page.goto(`/p/${HOST}/work/0.1`);
  await expect(page.getByTestId('readonly')).toBeVisible();
  await expect(page.getByTestId('keyboard-open')).toBeDisabled();
  await page.keyboard.press('K');
  await expect(page.getByTestId('keyboard')).toHaveCount(0);
});
