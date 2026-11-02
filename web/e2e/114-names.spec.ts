import { expect, test, type Page } from '@playwright/test';
import { control, openPane, RO_TOKEN, settled, SHELL0, shot, signIn } from './fixtures';

// The shell helper, round one: in a writable shell pane on a host with
// preview roots, the names of the pane's directory on the screen are
// links. A directory click types cd, a file click opens the file the way
// the person set, Shift+click only names it on the line. Only a name the
// host listed is a link, and it is typed quoted whole.

const PREVIEW = process.env.MX_PREVIEW ?? '';

function watchInput(page: Page) {
  const bodies: { key?: string; count?: number; text?: string }[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/input') && r.method() === 'POST')
      bodies.push(JSON.parse(r.postData() ?? '{}'));
  });
  return bodies;
}

// The help overlay's settings: the button cycles, the overlay closes by
// a click beside the box.
async function withHelp(page: Page, act: () => Promise<void>) {
  await page.keyboard.press('?');
  await expect(page.getByTestId('help')).toBeVisible();
  await act();
  await page.getByTestId('help').click({ position: { x: 4, y: 4 } });
  await expect(page.getByTestId('help')).toHaveCount(0);
}
async function setOpenWith(page: Page, mode: string, command?: string) {
  await withHelp(page, async () => {
    const button = page.getByTestId('open-with');
    for (let i = 0; i < 3 && !(await button.textContent())!.endsWith(mode); i++)
      await button.click();
    await expect(button).toHaveText(`a file opens with: ${mode}`);
    if (command !== undefined) await page.getByTestId('open-command').fill(command);
  });
}

test('114 the names of the directory are links: cd for a directory, the file as set, Shift+click names it', async ({
  page,
  request,
}, info) => {
  test.skip(!PREVIEW, 'no preview root in this environment');
  await page.setViewportSize({ width: 1400, height: 900 });
  await signIn(page);
  await openPane(page, SHELL0);
  await settled(page);
  const screen = page.getByTestId('screen');
  const inputs = watchInput(page);
  await control(request, '/send', { target: 'work:0.0', text: 'ls -1' });
  const dir = screen.locator('a.mx-name-link[data-name="plans"]').last();
  await expect(dir).toBeVisible({ timeout: 8000 });
  await expect(dir).toHaveAttribute('data-kind', 'dir');
  await expect(dir).toHaveAttribute('title', 'cd plans');
  await expect(screen.locator('a.mx-name-link[data-name="report.csv"]').last()).toHaveAttribute(
    'data-kind',
    'file',
  );
  // ls quotes a name with a space; the link is the name alone.
  await expect(screen.locator('a.mx-name-link[data-name="a b"]').last()).toHaveAttribute(
    'data-kind',
    'dir',
  );
  await dir.hover();
  await shot(page, info, '114-names-hover');
  // A directory: cd, quoted, then Enter; the pane is then in plans and a
  // listing there links its own names.
  await dir.click();
  await expect.poll(() => inputs.length).toBeGreaterThanOrEqual(2);
  expect(inputs.slice(-2)).toEqual([{ text: "cd -- 'plans'" }, { key: 'Enter' }]);
  await control(request, '/send', { target: 'work:0.0', text: 'ls -1' });
  const file = screen.locator('a.mx-name-link[data-name="a.md"]').last();
  await expect(file).toBeVisible({ timeout: 8000 });
  await expect(file).toHaveAttribute('data-kind', 'file');
  // A file opens in the preview window by default: nothing typed.
  await expect(file).toHaveAttribute('title', 'preview a.md');
  let n = inputs.length;
  await file.click();
  await expect(page.getByTestId('picture')).toBeVisible();
  await expect(page.getByTestId('picture-name')).toHaveText('a.md');
  expect(inputs.length).toBe(n);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('picture')).toHaveCount(0, { timeout: 3000 });
  // With cat set, cat.
  await setOpenWith(page, 'cat');
  await expect(file).toHaveAttribute('title', 'cat a.md');
  n = inputs.length;
  await file.click();
  await expect.poll(() => inputs.length).toBe(n + 2);
  expect(inputs.slice(-2)).toEqual([{ text: "cat -- 'a.md'" }, { key: 'Enter' }]);
  await expect(screen).toContainText('# plan a', { timeout: 5000 });
  await shot(page, info, '114-names');
  // With a command set, the command with the quoted name for {}.
  await setOpenWith(page, 'command', 'wc -l {}');
  await expect(file).toHaveAttribute('title', 'wc -l a.md');
  n = inputs.length;
  await file.click();
  await expect.poll(() => inputs.length).toBe(n + 2);
  expect(inputs.slice(-2)).toEqual([{ text: "wc -l 'a.md'" }, { key: 'Enter' }]);
  await expect(screen).toContainText('6 a.md', { timeout: 5000 });
  // Shift+click: the quoted name and a space, no Enter.
  n = inputs.length;
  await file.click({ modifiers: ['Shift'] });
  await expect.poll(() => inputs.length).toBe(n + 1);
  expect(inputs[n]).toEqual({ text: "'a.md' " });
  await page.waitForTimeout(700);
  expect(inputs.length).toBe(n + 1);
  await control(request, '/key', { target: 'work:0.0', key: 'C-u' });
  // Back as it was for the next spec.
  await setOpenWith(page, 'preview');
  await control(request, '/send', { target: 'work:0.0', text: `cd ${PREVIEW}/docs && clear` });
});

test('114 security: only a listed name is a link, typed quoted whole; a reader, a program that is no shell, and the setting off get none', async ({
  page,
  browser,
  request,
}) => {
  test.skip(!PREVIEW, 'no preview root in this environment');
  await page.setViewportSize({ width: 1400, height: 900 });
  await signIn(page);
  await openPane(page, SHELL0);
  await settled(page);
  const screen = page.getByTestId('screen');
  const inputs = watchInput(page);
  // docs is no entry of the docs directory; the other name is, and is a
  // shell's worst.
  await control(request, '/send', {
    target: 'work:0.0',
    text: `echo docs "'; rm -rf ~ #" end-of-names`,
  });
  await expect(screen).toContainText('end-of-names', { timeout: 5000 });
  const evil = screen.locator(`a.mx-name-link[data-name="'; rm -rf ~ #"]`).last();
  await expect(evil).toBeVisible({ timeout: 8000 });
  await expect(screen.locator('a.mx-name-link[data-name="docs"]')).toHaveCount(0);
  await setOpenWith(page, 'cat');
  const n = inputs.length;
  await evil.click();
  await expect.poll(() => inputs.length).toBe(n + 2);
  expect(inputs.slice(-2)).toEqual([{ text: `cat -- ''\\''; rm -rf ~ #'` }, { key: 'Enter' }]);
  await expect(screen).toContainText('harmless', { timeout: 5000 });
  await setOpenWith(page, 'preview');
  // A reader sees the same screen and no links.
  const ctx = await browser.newContext();
  const reader = await ctx.newPage();
  await signIn(reader, RO_TOKEN);
  await openPane(reader, SHELL0);
  await settled(reader);
  await expect(reader.getByTestId('screen')).toContainText('end-of-names', { timeout: 5000 });
  await reader.waitForTimeout(2500);
  await expect(reader.getByTestId('screen').locator('a.mx-name-link')).toHaveCount(0);
  await ctx.close();
  // While a program that is no shell has the pane, nothing links; the
  // shell back, the names are.
  await control(request, '/send', { target: 'work:0.0', text: 'sleep 6' });
  await expect(screen.locator('a.mx-name-link')).toHaveCount(0, { timeout: 8000 });
  await expect(evil).toBeVisible({ timeout: 15000 });
  // The setting off.
  await withHelp(page, async () => {
    await page.getByTestId('names').click();
    await expect(page.getByTestId('names')).toHaveText('names: off');
  });
  await expect(screen.locator('a.mx-name-link')).toHaveCount(0);
  await withHelp(page, async () => {
    await page.getByTestId('names').click();
    await expect(page.getByTestId('names')).toHaveText('names: on');
  });
  await expect(evil).toBeVisible({ timeout: 8000 });
  await control(request, '/send', { target: 'work:0.0', text: 'clear' });
});
