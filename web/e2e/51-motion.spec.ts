import { expect, test } from '@playwright/test';
import { control, openPane, SHELL0, shot, signIn } from './fixtures';

test('51 motion: power-on, burn-in, reduced motion', async ({ page, request }, info) => {
  await page.goto('/signin');
  await expect(page.getByTestId('crt')).toHaveAttribute('data-power-on', '1');
  await page
    .screenshot({ path: `${process.env.MX_SCREENS}/51-motion/51-poweron.png` })
    .catch(() => {});
  await expect(page.getByTestId('crt')).toHaveAttribute('data-power-on', '0', { timeout: 5000 });
  await signIn(page);
  await openPane(page, SHELL0);
  await control(request, '/send', { target: 'work:0.0', text: 'echo burn-me-in' });
  await expect(page.locator('.mx-screen .mx-burn')).not.toHaveCount(0, { timeout: 5000 });
  await shot(page, info, '51-burn');
  // A window over the page powers on like the page did, unless motion is off.
  const windowAnim = () =>
    page.evaluate(
      () => getComputedStyle(document.querySelector('[data-testid="help"] > *')!).animationName,
    );
  await page.keyboard.press('?');
  await expect(page.getByTestId('help')).toBeVisible();
  expect(await windowAnim()).toBe('mx-power-on');
  await shot(page, info, '51-help-on');
  // Closed, it powers off: the same animation backwards, then it is gone.
  await page.keyboard.press('Escape');
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          getComputedStyle(document.querySelector('[data-testid="help"] > *')!).animationDirection,
      ),
    )
    .toBe('reverse');
  await expect(page.getByTestId('help')).toHaveCount(0);
  await page.keyboard.press('m');
  await page.keyboard.press('?');
  await expect(page.getByTestId('help')).toBeVisible();
  expect(await windowAnim()).toBe('none');
  await page.keyboard.press('Escape');
  await page.keyboard.press('m');
  const cursorAnim = () =>
    page.evaluate(
      () =>
        getComputedStyle(document.querySelector('.mx-cursor, .mx-pulse, .mx-brand')!).animationName,
    );
  await page.goto('/signin');
  await page
    .getByTestId('who')
    .click({ timeout: 2000 })
    .then(() => page.getByTestId('logout').click())
    .catch(() => {});
  await page.goto('/signin');
  expect(
    await page.evaluate(
      () => getComputedStyle(document.querySelector('.mx-cursor')!).animationName,
    ),
  ).toBe('mx-blink');
  await page.keyboard.press('m');
  expect(
    await page.evaluate(
      () => getComputedStyle(document.querySelector('.mx-cursor')!).animationName,
    ),
  ).toBe('none');
  await page.keyboard.press('m');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(
    await page.evaluate(
      () => getComputedStyle(document.querySelector('.mx-cursor')!).animationName,
    ),
  ).toBe('none');
  void cursorAnim;
});
