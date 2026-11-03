import { expect, test, type Browser, type Page } from '@playwright/test';
import { control, openPane, profile, RO_TOKEN, settled, SHELL0, shot, signIn } from './fixtures';

// A pane shared read-only: the owner makes a link and a password in the
// share window; the observer opens the link, gives the password, and
// sees the screen at the host's size, the web links in it and the file or
// diff the owner opens over it, and nothing else.

const PREVIEW = process.env.MX_PREVIEW ?? '';
const ADMIN = process.env.MX_ADMIN_TOKEN ?? '';

// The owner opens the pane and makes a share; the link and password come
// back from the window, which is then dismissed.
async function makeShare(page: Page): Promise<{ url: string; password: string }> {
  await signIn(page);
  await openPane(page, SHELL0);
  await settled(page);
  await page.keyboard.press('s');
  const win = page.getByTestId('share-window');
  await expect(win).toBeVisible();
  // A share left by an earlier spec is revoked first, so the count below is this one's.
  const rows = page.getByTestId('share-revoke');
  while ((await rows.count()) > 0) {
    await rows.first().click();
    await page.waitForTimeout(200);
  }
  await expect(page.getByTestId('share-list')).toContainText('not shared');
  await page.getByTestId('share-ttl-3600').click();
  await page.getByTestId('share-create').click();
  const made = page.getByTestId('share-made');
  await expect(made).toBeVisible();
  const url = (await page.getByTestId('share-url').textContent()) ?? '';
  const password = (await page.getByTestId('share-password').textContent()) ?? '';
  expect(url).toContain('/s/');
  expect(password).toMatch(/^[a-z2-7]{4}-[a-z2-7]{4}-[a-z2-7]{4}$/);
  return { url, password };
}

async function observerPage(browser: Browser, page: Page) {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, baseURL: page.url() });
  const viewer = await ctx.newPage();
  return { ctx, viewer };
}

async function openAsObserver(viewer: Page, url: string, password: string) {
  await viewer.goto(url);
  await expect(viewer.getByTestId('share-signin')).toBeVisible();
  await viewer.getByTestId('share-open-password').fill(password);
  await viewer.getByTestId('share-open').click();
  await expect(viewer.getByTestId('share-view')).toBeVisible();
  await expect(viewer.getByTestId('share-screen')).toBeVisible();
}

async function revokeAll(page: Page) {
  await page.keyboard.press('s');
  const win = page.getByTestId('share-window');
  await expect(win).toBeVisible();
  const rows = page.getByTestId('share-revoke');
  while ((await rows.count()) > 0) {
    await rows.first().click();
    await page.waitForTimeout(200);
  }
  await page.keyboard.press('Escape');
  await expect(win).toHaveCount(0);
}

test('116 security: the observer has no input, no links to files, and nothing but the pane', async ({
  page,
  browser,
  request,
}, info) => {
  test.skip(!PREVIEW, 'no preview root in this environment');
  const { url, password } = await makeShare(page);
  await page.getByTestId('share-done').click();
  await expect(page.getByTestId('share-row')).toHaveCount(1);
  await page.keyboard.press('Escape');
  // The owner prints a path, an inbox-looking path and a web address.
  await control(request, '/send', {
    target: 'work:0.0',
    text: 'echo see plans/a.md and https://example.com/x now',
  });
  await expect(page.getByTestId('screen')).toContainText('see plans/a.md and');
  const { ctx, viewer } = await observerPage(browser, page);
  // A wrong password is refused and the link stays live.
  await viewer.goto(url);
  await viewer.getByTestId('share-open-password').fill('not-the-password');
  await viewer.getByTestId('share-open').click();
  await expect(viewer.getByTestId('share-open-error')).toHaveText('that password was not accepted');
  await openAsObserver(viewer, url, password);
  await shot(viewer, info, '116-share-view');
  const screen = viewer.getByTestId('share-screen');
  await expect(screen).toContainText('see plans/a.md and', { timeout: 5000 });
  // No input line, key bar, strip, pane buttons or profile.
  for (const id of ['input', 'keybar', 'tabs', 'who', 'pane', 'share', 'changes', 'fit'])
    await expect(viewer.getByTestId(id)).toHaveCount(0);
  await expect(viewer.getByTestId('share-note')).toContainText('read only');
  // The web address is a link; the path is text.
  await expect(screen.locator('a.mx-link[href="https://example.com/x"]').first()).toBeVisible();
  await expect(screen.locator('a.mx-path-link')).toHaveCount(0);
  await expect(screen.locator('a.mx-file-link')).toHaveCount(0);
  // Keys that drive a pane do nothing here, and a click sends nothing.
  const inputs: string[] = [];
  viewer.on('request', (r) => {
    if (/\/input|\/resize|\/answer|\/preview|\/git/.test(r.url())) inputs.push(r.url());
  });
  for (const key of ['i', ':', 'f', 'g', 'x', 's', 'Enter', 'ArrowUp'])
    await viewer.keyboard.press(key);
  await screen.click();
  await viewer.waitForTimeout(800);
  expect(inputs).toEqual([]);
  // The observer's cookie opens nothing of the API: a listing is refused.
  const refused = await viewer.evaluate(async () => {
    const r = await fetch('/v1/panes', { headers: { 'X-Muxway-Client': 'web' } });
    return r.status;
  });
  expect(refused).toBe(401);
  // The password is nowhere in the owner's page or storage after done.
  const html = await page.content();
  expect(html).not.toContain(password);
  const stored = await page.evaluate(() => JSON.stringify(Object.entries(localStorage)));
  expect(stored).not.toContain(password);
  await ctx.close();
  await revokeAll(page);
  await control(request, '/send', { target: 'work:0.0', text: 'clear' });
});

test('116 the share window: link, password, code, copy buttons, revoke; the header counts it', async ({
  page,
  context,
  request,
}, info) => {
  test.skip(!PREVIEW, 'no preview root in this environment');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const { url, password } = await makeShare(page);
  await shot(page, info, '116-share-window');
  // The code holds the link alone: its markup carries no text at all.
  const qr = page.getByTestId('qr');
  await expect(qr).toBeVisible();
  expect(await qr.textContent()).toBe('');
  await page.getByTestId('share-copy-link').click();
  await expect(page.getByTestId('share-copy-link')).toHaveText('copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
  await page.getByTestId('share-copy-password').click();
  await expect(page.getByTestId('share-copy-password')).toHaveText('copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(password);
  await page.getByTestId('share-copy-image').click();
  await expect(page.getByTestId('share-copy-image')).toHaveText('copied');
  const imageType = await page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    return items[0]?.types.join(',') ?? '';
  });
  expect(imageType).toContain('image/png');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('share-save-image').click(),
  ]);
  expect(download.suggestedFilename()).toBe('muxway-share.png');
  await page.getByTestId('share-done').click();
  await expect(page.getByTestId('share-made')).toHaveCount(0);
  await expect(page.getByTestId('share-row')).toHaveCount(1);
  await expect(page.getByTestId('share-row')).toContainText('nobody watching');
  await page.keyboard.press('Escape');
  // The tile's header counts the share; the listing carries it.
  await expect(page.getByTestId('tile-shared')).toHaveText('⇗ 1');
  await expect(page.getByTestId('share')).toHaveAttribute('data-on', '0');
  // A reader of the same pane sees no count and cannot share.
  const other = await page
    .context()
    .browser()!
    .newContext({ ignoreHTTPSErrors: true, baseURL: page.url() });
  const reader = await other.newPage();
  await signIn(reader, RO_TOKEN);
  await openPane(reader, SHELL0);
  await expect(reader.getByTestId('tile-shared')).toHaveCount(0);
  await expect(reader.getByTestId('share')).toBeDisabled();
  await other.close();
  // The admin overview lists it; revoke there ends it.
  await profile(page, 'logout');
  await expect(page.getByTestId('signin')).toBeVisible();
  await signIn(page, ADMIN);
  await profile(page, 'open-admin');
  const row = page.getByTestId('share-admin-row');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(SHELL0);
  await page.getByTestId('share-admin-revoke').click();
  await expect(row).toHaveCount(0);
  await expect
    .poll(async () => (await request.get(url.replace('/s/', '/v1/share/'))).status())
    .toBe(404);
});

test('116 the observer sees the host size, and the file or diff the owner opens, until it closes', async ({
  page,
  browser,
  request,
}, info) => {
  test.skip(!PREVIEW, 'no preview root in this environment');
  const { url, password } = await makeShare(page);
  await page.getByTestId('share-done').click();
  await page.keyboard.press('Escape');
  const { ctx, viewer } = await observerPage(browser, page);
  await viewer.setViewportSize({ width: 700, height: 500 });
  await openAsObserver(viewer, url, password);
  // The owner's fit sizes the host; the observer shows that size, scaled.
  const size = await page.getByTestId('pane-size').textContent();
  await expect(viewer.getByTestId('share-size')).toHaveText(size ?? '', { timeout: 5000 });
  // The owner opens a Markdown file: the observer's window follows, rendered.
  await control(request, '/send', { target: 'work:0.0', text: 'echo 1. plans/a.md: the plan' });
  await expect(page.getByTestId('screen')).toContainText('1. plans/a.md: the plan');
  await page.getByTestId('screen').locator('a.mx-path-link[data-path="plans/a.md"]').last().click();
  await expect(page.getByTestId('picture')).toBeVisible();
  const theirs = viewer.getByTestId('picture');
  await expect(theirs).toBeVisible({ timeout: 5000 });
  await expect(viewer.getByTestId('picture-name')).toHaveText('plans/a.md');
  await expect(viewer.getByTestId('picture-rendered-body')).toContainText('plan a');
  await expect(viewer.getByTestId('picture-observed')).toContainText('rendered');
  for (const id of ['picture-download', 'picture-close', 'picture-view', 'picture-side'])
    await expect(viewer.getByTestId(id)).toHaveCount(0);
  await shot(viewer, info, '116-share-showing-md');
  // The owner switches to plain: the view follows without the bytes again.
  await page.getByTestId('picture-plain').click();
  await expect(viewer.getByTestId('picture-text')).toContainText('# plan a', { timeout: 5000 });
  await expect(viewer.getByTestId('picture-observed')).toContainText('plain');
  await page.getByTestId('picture-rendered').click();
  // The owner closes: the observer's window goes.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('picture')).toHaveCount(0, { timeout: 3000 });
  await expect(theirs).toHaveCount(0, { timeout: 5000 });
  // A diff from the changes window.
  await page.keyboard.press('g');
  await expect(page.getByTestId('changes-window')).toBeVisible();
  await page.locator('[data-testid="change"][data-path="src/a.go"]').click();
  await expect(page.getByTestId('diff')).toBeVisible();
  await expect(viewer.getByTestId('diff')).toBeVisible({ timeout: 5000 });
  await expect(viewer.getByTestId('picture-observed')).toContainText('diff');
  await expect(viewer.getByTestId('picture-name')).toHaveText('src/a.go');
  await shot(viewer, info, '116-share-showing-diff');
  await page.keyboard.press('Escape');
  await expect(viewer.getByTestId('picture')).toHaveCount(0, { timeout: 5000 });
  await page.keyboard.press('Escape');
  // Revoked: the observer's page says so.
  await revokeAll(page);
  await expect(viewer.getByTestId('share-ended')).toBeVisible({ timeout: 5000 });
  await ctx.close();
  await control(request, '/send', { target: 'work:0.0', text: 'clear' });
});
