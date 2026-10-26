import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { control, openPane, settled, SHELL0, shot, signIn } from './fixtures';

// A path of the host's inbox printed in a pane is a link: a click shows
// the image in a window over the page, from the host, by name only.

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4nGP4z8DwHyiI+z8DwwYAGvYF/ZWL2B0AAAAASUVORK5CYII=',
  'base64',
);

async function upload(request: APIRequestContext, name: string, mimeType: string, buffer: Buffer) {
  const r = await request.post(`/v1/panes/${SHELL0}/files`, {
    headers: { 'X-Muxway-Client': 'web' },
    multipart: { file: { name, mimeType, buffer } },
  });
  expect(r.status()).toBe(201);
  return ((await r.json()) as { path: string }).path;
}

function watchInput(page: Page) {
  const inputs: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/input')) inputs.push(r.postData() ?? '');
  });
  return inputs;
}

test('81 a path of the inbox is a link; a click shows the image over the page; Escape closes it', async ({
  page,
  request,
}, info) => {
  await signIn(page);
  await openPane(page, SHELL0);
  await settled(page);
  // The screenshot is one of the key bar, taken here: a picture with something in it.
  const keybar = await page.getByTestId('keybar').screenshot();
  const path = await upload(page.request, 'shot.png', 'image/png', keybar);
  const name = path.split('/').pop()!;
  await control(request, '/send', { target: 'work:0.0', text: `echo look at ${path} now` });
  const screen = page.getByTestId('screen');
  await expect(screen).toContainText(`look at ${path} now`, { timeout: 5000 });
  const link = screen.locator('a.mx-file-link').last();
  await expect(link).toHaveAttribute('data-file', name);
  await expect(link).toHaveText(path);
  await link.click();
  const picture = page.getByTestId('picture');
  await expect(picture).toBeVisible();
  await expect(page.getByTestId('picture-name')).toHaveText(name);
  const img = page.getByTestId('picture-image');
  await expect(img).toBeVisible();
  await expect
    .poll(() => img.evaluate((e) => (e as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(100);
  await expect(picture).toContainText('KiB');
  await shot(page, info, '81-picture');
  await page.keyboard.press('Escape');
  await expect(picture).toHaveCount(0, { timeout: 3000 });
  // Escape closed the window, not the pane view.
  await expect(page.getByTestId('pane')).toBeVisible();
  // A click outside closes it too.
  await link.click();
  await expect(picture).toBeVisible();
  await page.getByTestId('picture-back').click({ position: { x: 5, y: 5 } });
  await expect(picture).toHaveCount(0, { timeout: 3000 });
});

test('81 security: only an inbox name links; a click sends no input; a missing file says so', async ({
  page,
  request,
}) => {
  await signIn(page);
  await openPane(page, SHELL0);
  await settled(page);
  const screen = page.getByTestId('screen');
  // Each line fits the pane's width, so nothing is a wrapped path.
  await control(request, '/send', {
    target: 'work:0.0',
    text: `echo /tmp/20261025-102235-56fwge.png.exe /tmp/../20261025-102235-56fwge.PNG`,
  });
  await control(request, '/send', {
    target: 'work:0.0',
    text: `echo /etc/passwd 20261025-102235-56fwge.png end-of-hostile`,
  });
  await expect(screen).toContainText('end-of-hostile', { timeout: 5000 });
  // The pane's history may hold real paths from before; none of these is one.
  await expect(screen.locator('a[data-file*="56fwge"]')).toHaveCount(0);
  // A well-formed name the inbox never had: the host answers 404, the window says so.
  await control(request, '/send', {
    target: 'work:0.0',
    text: `echo /tmp/20261025-102235-56fwge.png gone`,
  });
  await expect(screen).toContainText('png gone', { timeout: 5000 });
  await screen.locator('a.mx-file-link').last().click();
  await expect(page.getByTestId('picture-error')).toHaveText('gone from the host');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('picture')).toHaveCount(0, { timeout: 3000 });
  // With the mouse on, a click on the link reaches the host as nothing.
  const path = await upload(page.request, 'shot.png', 'image/png', PNG);
  await control(request, '/send', {
    target: 'work:0.0',
    text: `printf '\\033[?1000h\\033[?1006h'; echo 'shot ${path}'; cat -v`,
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
  await screen.locator('a.mx-file-link').last().click();
  await expect(page.getByTestId('picture-image')).toBeVisible();
  await page.waitForTimeout(800);
  expect(inputs).toEqual([]);
  expect(await control(request, '/capture', { target: 'work:0.0' })).not.toMatch(/\^\[\[</);
  await page.keyboard.press('Escape');
  await page.getByTestId('keybar').getByRole('button', { name: 'C-c', exact: true }).click();
  await expect.poll(() => control(request, '/command', { target: 'work:0.0' })).toBe('bash');
  await control(request, '/send', {
    target: 'work:0.0',
    text: `printf '\\033[?1000l\\033[?1006l'`,
  });
});

test('81 another type opens in the window as the text it is, with a download', async ({
  page,
  request,
}) => {
  await signIn(page);
  await openPane(page, SHELL0);
  await settled(page);
  const path = await upload(
    page.request,
    'notes.json',
    'application/json',
    Buffer.from('{"html": "<b>not bold</b>"}'),
  );
  await control(request, '/send', { target: 'work:0.0', text: `echo see ${path} too` });
  const screen = page.getByTestId('screen');
  await expect(screen).toContainText(`see ${path} too`, { timeout: 5000 });
  await screen.locator('a.mx-file-link').last().click();
  const text = page.getByTestId('picture-text');
  await expect(text).toHaveText('{"html": "<b>not bold</b>"}');
  expect(await text.locator('b').count()).toBe(0);
  await expect(page.getByTestId('picture-size')).toContainText('1 lines');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('picture-download').click(),
  ]);
  expect(download.suggestedFilename()).toBe(path.split('/').pop());
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('picture')).toHaveCount(0, { timeout: 3000 });
});
