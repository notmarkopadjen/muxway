import { expect, test, type Page } from '@playwright/test';
import { control, HOST, openPane, RO_TOKEN, settled, SHELL0, shot, signIn } from './fixtures';

// A path a pane printed is a link on a host whose owner named preview
// roots: a click shows the file in a window over the page, with a
// download; the host serves only what lies under a root.

const PREVIEW = process.env.MX_PREVIEW ?? '';

function watchInput(page: Page) {
  const inputs: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/input')) inputs.push(r.postData() ?? '');
  });
  return inputs;
}

test('83 a printed path opens the file over the page; text, size, lines, download; Escape closes', async ({
  page,
  request,
}, info) => {
  test.skip(!PREVIEW, 'no preview root in this environment');
  await signIn(page);
  await openPane(page, SHELL0);
  await settled(page);
  await control(request, '/send', { target: 'work:0.0', text: `echo 1. plans/a.md: the plan` });
  const screen = page.getByTestId('screen');
  await expect(screen).toContainText('1. plans/a.md: the plan', { timeout: 5000 });
  const link = screen.locator('a.mx-path-link[data-path="plans/a.md"]').last();
  await expect(link).toHaveText('plans/a.md');
  await link.click();
  const picture = page.getByTestId('picture');
  await expect(picture).toBeVisible();
  await expect(page.getByTestId('picture-name')).toHaveText('plans/a.md');
  // Markdown opens rendered (spec 86); the source is a click away.
  await page.getByTestId('picture-plain').click();
  await expect(page.getByTestId('picture-text')).toContainText('# plan a');
  await expect(page.getByTestId('picture-text')).toContainText('- two');
  await expect(page.getByTestId('picture-size')).toContainText('6 lines');
  await shot(page, info, '83-preview');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('picture-download').click(),
  ]);
  expect(download.suggestedFilename()).toBe('a.md');
  await page.keyboard.press('Escape');
  await expect(picture).toHaveCount(0, { timeout: 3000 });
  await expect(page.getByTestId('pane')).toBeVisible();
  // The screen is left clean for the next spec.
  await control(request, '/send', { target: 'work:0.0', text: 'clear' });
});

test('83 an image, a PDF and an HTML file: shown, framed, and as text', async ({
  page,
  request,
}) => {
  test.skip(!PREVIEW, 'no preview root in this environment');
  await signIn(page);
  await openPane(page, SHELL0);
  await settled(page);
  await control(request, '/send', {
    target: 'work:0.0',
    text: `echo see ./shot.png and ${PREVIEW}/docs/note.pdf and ./page.html done`,
  });
  const screen = page.getByTestId('screen');
  await expect(screen).toContainText('./page.html done', { timeout: 5000 });
  await screen.locator('a.mx-path-link[data-path="./shot.png"]').last().click();
  await expect(page.getByTestId('picture-image')).toBeVisible();
  await expect
    .poll(() =>
      page.getByTestId('picture-image').evaluate((e) => (e as HTMLImageElement).naturalWidth),
    )
    .toBe(2);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('picture')).toHaveCount(0, { timeout: 3000 });
  await screen.locator(`a.mx-path-link[data-path="${PREVIEW}/docs/note.pdf"]`).last().click();
  await expect(page.getByTestId('picture-frame')).toBeVisible();
  await expect(page.getByTestId('picture')).toHaveAttribute('data-kind', 'pdf');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('picture')).toHaveCount(0, { timeout: 3000 });
  await screen.locator('a.mx-path-link[data-path="./page.html"]').last().click();
  const text = page.getByTestId('picture-text');
  await expect(text).toContainText('<script>alert(1)</script>');
  expect(await text.locator('b').count()).toBe(0);
  await page.keyboard.press('Escape');
  // The screen is left clean for the next spec.
  await control(request, '/send', { target: 'work:0.0', text: 'clear' });
});

test('83 security: what the host refuses says so; a click sends no input; readers get no links', async ({
  page,
  browser,
  request,
}) => {
  test.skip(!PREVIEW, 'no preview root in this environment');
  await signIn(page);
  await openPane(page, SHELL0);
  await settled(page);
  const screen = page.getByTestId('screen');
  await control(request, '/send', {
    target: 'work:0.0',
    text: `echo ../.env ../.secrets.json ../run.sh /etc/passwd ../../nothere.md end-of-list`,
  });
  await expect(screen).toContainText('end-of-list', { timeout: 5000 });
  // A file without a shown extension is never a link; a hidden file and a
  // path outside the root are, and the host says no to both; a script is
  // shown as text, never run.
  await expect(screen.locator('a.mx-path-link[data-path="/etc/passwd"]')).toHaveCount(0);
  await screen.locator('a.mx-path-link[data-path="../run.sh"]').last().click();
  await expect(page.getByTestId('picture-text')).toContainText('#!/bin/sh');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('picture')).toHaveCount(0, { timeout: 3000 });
  await expect(screen.locator('a.mx-path-link[data-path="../.env"]')).toHaveCount(0);
  for (const p of ['../.secrets.json', '../../nothere.md']) {
    await screen.locator(`a.mx-path-link[data-path="${p}"]`).last().click();
    await expect(page.getByTestId('picture-error')).toHaveText(
      'the host does not preview this file',
    );
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('picture')).toHaveCount(0, { timeout: 3000 });
  }
  // With the mouse on, a click on a path link reaches the host as nothing.
  await control(request, '/send', {
    target: 'work:0.0',
    text: `printf '\\033[?1000h\\033[?1006h'; echo 'read plans/a.md now'; cat -v`,
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
  const inputs = watchInput(page);
  await screen.locator('a.mx-path-link[data-path="plans/a.md"]').last().click();
  await expect(page.getByTestId('picture-rendered-body')).toContainText('plan a');
  await page.waitForTimeout(800);
  expect(inputs).toEqual([]);
  await page.keyboard.press('Escape');
  await page.getByTestId('keybar').getByRole('button', { name: 'C-c', exact: true }).click();
  await expect.poll(() => control(request, '/command', { target: 'work:0.0' })).toBe('bash');
  await control(request, '/send', {
    target: 'work:0.0',
    text: `printf '\\033[?1000l\\033[?1006l'`,
  });
  // A read-only token sees the same screen without path links; inbox paths it may still open.
  const other = await browser.newContext({ ignoreHTTPSErrors: true, baseURL: page.url() });
  const viewer = await other.newPage();
  await signIn(viewer, RO_TOKEN);
  await openPane(viewer, SHELL0);
  await expect(viewer.getByTestId('screen')).toContainText('plans/a.md');
  await expect(viewer.getByTestId('screen').locator('a.mx-path-link')).toHaveCount(0);
  await other.close();
  // A read-only pane of the same host: no path links either.
  await page.goto('/');
  await openPane(page, `${HOST}/work/0.1`);
  await expect(page.getByTestId('readonly')).toBeVisible();
  await expect(page.getByTestId('screen').locator('a.mx-path-link')).toHaveCount(0);
  // The screen is left clean for the next spec.
  await control(request, '/send', { target: 'work:0.0', text: 'clear' });
});
