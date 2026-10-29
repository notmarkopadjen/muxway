import { expect, test, type Page } from '@playwright/test';
import { alerts, control, openPane, SHELL0, shot, signIn, watchPage } from './fixtures';

// A program names the address of a run of text (OSC 8): the label is a
// link to it, http and https only; a click opens a new tab and sends
// nothing to the pane.

// printf's view of ESC ] 8 ; ; uri ST label ESC ] 8 ; ; ST. The screen is
// cleared first, so the typed command's own text is not on it.
const osc = (uri: string, label: string) => `\\033]8;;${uri}\\033\\\\${label}\\033]8;;\\033\\\\`;

function watchInput(page: Page) {
  const inputs: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/input')) inputs.push(r.postData() ?? '');
  });
  return inputs;
}

test('107 security: a named link is text unless it is http or https', async ({ page, request }) => {
  await watchPage(page);
  await signIn(page);
  await openPane(page, SHELL0);
  const screen = page.getByTestId('screen');
  const links = screen.locator('a');
  const long = 'https://example.com/' + 'a'.repeat(2100);
  await control(request, '/send', {
    target: 'work:0.0',
    text: `clear && printf '${osc('javascript:alert(1)', 'one')} ${osc('data:text/html,<img src=x onerror=alert(1)>', 'two')} ${osc('file:///etc/passwd', 'three')} ${osc('JAVASCRIPT:alert(1)', 'four')} ${osc(long, 'five')} ${osc('//example.com/r', 'six')} end\\n'`,
  });
  await expect(screen).toContainText('one two three four five six end', { timeout: 5000 });
  await page.waitForTimeout(1200);
  for (const label of ['one', 'two', 'three', 'four', 'five', 'six'])
    await expect(links.filter({ hasText: label })).toHaveCount(0);
  // The sequences themselves never reach the page.
  await expect(screen).not.toContainText('javascript');
  await expect(screen).not.toContainText(']8;');
  expect(await alerts(page)).toBe(0);
  await control(request, '/send', { target: 'work:0.0', text: 'clear' });
  await expect(screen).not.toContainText('one two', { timeout: 5000 });
});

test('107 a named link: the label is the anchor, the address its target and title; a click sends nothing', async ({
  page,
  request,
  context,
}, info) => {
  await watchPage(page);
  await signIn(page);
  await openPane(page, SHELL0);
  const screen = page.getByTestId('screen');
  const links = screen.locator('a');
  await control(request, '/send', {
    target: 'work:0.0',
    text: `clear && printf 'see ${osc('https://example.com/w/42', 'AB#42')} and \\033]8;id=1;https://example.com/f\\007a \\033[31mred\\033[0m file\\033]8;;\\007 then https://example.com/t.\\n'`,
  });
  const named = links.filter({ hasText: 'AB#42' }).last();
  await expect(named).toHaveAttribute('href', 'https://example.com/w/42', { timeout: 5000 });
  await expect(named).toHaveText('AB#42');
  await expect(named).toHaveAttribute('title', 'https://example.com/w/42');
  await expect(named).toHaveAttribute('target', '_blank');
  await expect(named).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(named).toHaveCSS('cursor', 'pointer');
  // A label with colours inside is one anchor, its colours kept.
  const coloured = links.filter({ hasText: 'a red file' }).last();
  await expect(coloured).toHaveAttribute('href', 'https://example.com/f');
  await expect(coloured.locator('.fg1')).toHaveText('red');
  // An address in the text beside them is still found.
  await expect(links.filter({ hasText: 'https://example.com/t' }).last()).toHaveAttribute(
    'href',
    'https://example.com/t',
  );
  await shot(page, info, '107-osc8-link');
  // The opened tab is answered here; nothing leaves the test, nothing
  // reaches the pane.
  await context.route('https://example.com/**', (route) =>
    route.fulfill({ body: 'reached', contentType: 'text/plain' }),
  );
  const inputs = watchInput(page);
  const [popup] = await Promise.all([context.waitForEvent('page'), named.click()]);
  await popup.waitForURL('https://example.com/w/42');
  await popup.close();
  await page.waitForTimeout(800);
  expect(inputs).toEqual([]);
  expect(await alerts(page)).toBe(0);
  // The colours printed here are not left for the specs after this one.
  await control(request, '/send', { target: 'work:0.0', text: 'clear' });
  await expect(screen).not.toContainText('AB#42', { timeout: 5000 });
});
