import { expect, test, type Page } from '@playwright/test';
import { alerts, control, openPane, SHELL0, shot, signIn, watchPage } from './fixtures';

// Links: a web address printed in a pane is an anchor that opens in a new
// tab. Only http and https; the host hears nothing of a click, even from a
// pane whose program has the mouse.

function watchInput(page: Page) {
  const inputs: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/input')) inputs.push(r.postData() ?? '');
  });
  return inputs;
}

test('96 security: other schemes stay text; a link clicked in a mouse-mode pane sends no click', async ({
  page,
  context,
  request,
}) => {
  await watchPage(page);
  await signIn(page);
  await openPane(page, SHELL0);
  const screen = page.getByTestId('screen');
  const links = screen.locator('a');
  const capture = () => control(request, '/capture', { target: 'work:0.0' });
  await control(request, '/send', {
    target: 'work:0.0',
    text: `echo 'javascript:alert(1) data:text/html,<img src=x onerror=alert(1)> ftp://example.com/f file:///etc/passwd mailto:alice@example.com'`,
  });
  await expect(screen).toContainText('mailto:alice@example.com', { timeout: 5000 });
  await page.waitForTimeout(1200);
  await expect(links).toHaveCount(0);
  expect(await alerts(page)).toBe(0);
  // The opened tab is answered here; nothing leaves the test.
  await context.route('https://example.com/**', (route) =>
    route.fulfill({ body: 'reached', contentType: 'text/plain' }),
  );
  // cat -v shows what it reads, after printf asked for the mouse.
  await control(request, '/send', {
    target: 'work:0.0',
    text: `printf '\\033[?1000h\\033[?1006h'; echo 'see https://example.com/m.'; cat -v`,
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
  const link = links.filter({ hasText: 'https://example.com/m' }).last();
  await expect(link).toHaveAttribute('href', 'https://example.com/m');
  const [popup] = await Promise.all([context.waitForEvent('page'), link.click()]);
  await popup.waitForURL('https://example.com/m');
  await popup.close();
  await page.waitForTimeout(800);
  expect(inputs).toEqual([]);
  expect(await capture()).not.toMatch(/\^\[\[</);
  await page.getByTestId('keybar').getByRole('button', { name: 'C-c', exact: true }).click();
  await expect.poll(() => control(request, '/command', { target: 'work:0.0' })).toBe('bash');
  await control(request, '/send', {
    target: 'work:0.0',
    text: `printf '\\033[?1000l\\033[?1006l'`,
  });
  await page.goto('/');
  await expect
    .poll(() => control(request, '/window-size', { target: 'work:0' }), { timeout: 5000 })
    .toBe('100x30');
});

test('96 link: an address is an anchor to a new tab; colours survive; punctuation stays text', async ({
  page,
  request,
}, info) => {
  await signIn(page);
  await openPane(page, SHELL0);
  const links = page.getByTestId('screen').locator('a');
  await control(request, '/send', { target: 'work:0.0', text: 'echo https://example.com/a?b=1' });
  const a = links.filter({ hasText: 'https://example.com/a?b=1' }).last();
  await expect(a).toHaveAttribute('href', 'https://example.com/a?b=1', { timeout: 5000 });
  await expect(a).toHaveAttribute('target', '_blank');
  await expect(a).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(a).toHaveCSS('cursor', 'pointer');
  await shot(page, info, '96-link');
  // A URL in colour, split over spans, is one anchor and keeps its colours.
  await control(request, '/send', {
    target: 'work:0.0',
    text: `printf 'https://\\033[31mexample.com\\033[0m/c (https://example.com/a_(b)) https://example.com/d.\\n'`,
  });
  const c = links.filter({ hasText: 'https://example.com/c' });
  await expect(c).toHaveCount(1, { timeout: 5000 });
  await expect(c).toHaveAttribute('href', 'https://example.com/c');
  await expect(c.locator('.fg1')).toHaveText('example.com');
  await expect(links.filter({ hasText: 'a_(b)' }).last()).toHaveAttribute(
    'href',
    'https://example.com/a_(b)',
  );
  await expect(links.filter({ hasText: 'example.com/d' }).last()).toHaveAttribute(
    'href',
    'https://example.com/d',
  );
  await expect(links.filter({ hasText: 'example.com/d' }).last()).toHaveText(
    'https://example.com/d',
  );
});
