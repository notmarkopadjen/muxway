import { expect, test } from '@playwright/test';
import {
  alerts,
  control,
  openPane,
  settled,
  SHELL0,
  shot,
  signIn,
  violations,
  watchPage,
} from './fixtures';

// A Markdown file rendered in the window, with a switch to its source;
// code with its colours; nothing in a file reaches the page as markup.

const PREVIEW = process.env.MX_PREVIEW ?? '';

test('86 security: a hostile Markdown file renders as text, no script runs, no element comes from it', async ({
  page,
  request,
}) => {
  test.skip(!PREVIEW, 'no preview root in this environment');
  await watchPage(page);
  await signIn(page);
  await openPane(page, SHELL0);
  await settled(page);
  await control(request, '/send', { target: 'work:0.0', text: 'echo read ./evil.md now' });
  const screen = page.getByTestId('screen');
  await expect(screen).toContainText('read ./evil.md now', { timeout: 5000 });
  await screen.locator('a.mx-path-link[data-path="./evil.md"]').last().click();
  const body = page.getByTestId('picture-rendered-body');
  await expect(body).toBeVisible();
  await expect(body.locator('h1')).toHaveText('Hostile');
  await expect(body).toContainText('<script>alert(1)</script>');
  await expect(body.locator('script')).toHaveCount(0);
  await expect(body.locator('img')).toHaveCount(0);
  await expect(body.locator('a[href^="javascript"]')).toHaveCount(0);
  await expect(body.locator('a[href="https://example.com/x"]')).toHaveAttribute('rel', /noopener/);
  await expect(body.locator('code').first()).toHaveText('code');
  await expect(body.locator('.mx-code .k-keyword').first()).toHaveText('const');
  await expect(body.locator('.mx-code .k-comment').first()).toHaveText('// one');
  await page.waitForTimeout(500);
  expect(await alerts(page)).toBe(0);
  expect(await violations(page)).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('picture')).toHaveCount(0, { timeout: 3000 });
  await control(request, '/send', { target: 'work:0.0', text: 'clear' });
});

test('86 a plan opens rendered; plain shows the source, and the choice survives a reload', async ({
  page,
  request,
}, info) => {
  test.skip(!PREVIEW, 'no preview root in this environment');
  await signIn(page);
  await openPane(page, SHELL0);
  await settled(page);
  await control(request, '/send', { target: 'work:0.0', text: 'echo 1. plans/a.md: the plan' });
  const screen = page.getByTestId('screen');
  await expect(screen).toContainText('1. plans/a.md: the plan', { timeout: 5000 });
  await screen.locator('a.mx-path-link[data-path="plans/a.md"]').last().click();
  await expect(page.getByTestId('picture-view')).toHaveAttribute('data-view', 'rendered');
  const body = page.getByTestId('picture-rendered-body');
  await expect(body.locator('h1')).toHaveText('plan a');
  await expect(body.locator('li')).toHaveCount(2);
  await shot(page, info, '86-rendered');
  await page.getByTestId('picture-plain').click();
  await expect(page.getByTestId('picture-text')).toContainText('# plan a');
  await expect(page.getByTestId('picture-view')).toHaveAttribute('data-view', 'plain');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('picture')).toHaveCount(0, { timeout: 3000 });
  await page.reload();
  await settled(page);
  await screen.locator('a.mx-path-link[data-path="plans/a.md"]').last().click();
  await expect(page.getByTestId('picture-view')).toHaveAttribute('data-view', 'plain');
  await page.getByTestId('picture-rendered').click();
  await expect(body.locator('h1')).toHaveText('plan a');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('picture')).toHaveCount(0, { timeout: 3000 });
  await control(request, '/send', { target: 'work:0.0', text: 'clear' });
});

test('86 code and JSON show with their colours', async ({ page, request }, info) => {
  test.skip(!PREVIEW, 'no preview root in this environment');
  await signIn(page);
  await openPane(page, SHELL0);
  await settled(page);
  await control(request, '/send', {
    target: 'work:0.0',
    text: 'echo see ./Program.cs and ./data.json end',
  });
  const screen = page.getByTestId('screen');
  await expect(screen).toContainText('./data.json end', { timeout: 5000 });
  await screen.locator('a.mx-path-link[data-path="./Program.cs"]').last().click();
  const text = page.getByTestId('picture-text');
  await expect(text).toHaveAttribute('data-lang', 'cs');
  await expect(text.locator('.k-keyword').first()).toHaveText('public');
  await expect(text.locator('.k-string').first()).toHaveText('"hi"');
  await expect(text.locator('.k-number').first()).toHaveText('42');
  await expect(text.locator('.k-comment').first()).toHaveText('// a program');
  await shot(page, info, '86-code');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('picture')).toHaveCount(0, { timeout: 3000 });
  await screen.locator('a.mx-path-link[data-path="./data.json"]').last().click();
  await expect(text).toHaveAttribute('data-lang', 'json');
  await expect(text.locator('.k-name').first()).toHaveText('"name"');
  await expect(text.locator('.k-keyword').first()).toHaveText('true');
  await page.keyboard.press('Escape');
  await control(request, '/send', { target: 'work:0.0', text: 'clear' });
});
