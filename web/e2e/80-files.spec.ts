import { expect, test, type Page } from '@playwright/test';
import { control, HOST, openPane, RO_TOKEN, settled, shot, signIn, SHELL0 } from './fixtures';

// A file pasted, dropped or picked goes to the host's inbox; its path
// lands on the input line with a space after it, focused, unsent.

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4nGP4z8DwHyiI+z8DwwYAGvYF/ZWL2B0AAAAASUVORK5CYII=',
  'base64',
);
const PATH = /\/inbox\/\d{8}-\d{6}-[a-z0-9]{6}\.(png|txt)$/;

// Builds a File in the page and dispatches it as a paste or a drop.
async function deliver(page: Page, how: 'paste' | 'drop', name: string, type: string, b64: string) {
  await page.evaluate(
    ([how, name, type, b64]) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], name, { type }));
      if (how === 'paste') {
        const input = document.querySelector('[data-testid="input"]')!;
        input.dispatchEvent(
          new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
        );
      } else {
        const screen = document.querySelector('[data-testid="screen"]')!;
        screen.dispatchEvent(
          new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }),
        );
        screen.dispatchEvent(
          new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }),
        );
      }
    },
    [how, name, type, b64] as const,
  );
}

const paths = (v: string) =>
  v
    .trim()
    .split(/\s+/)
    .filter((w) => PATH.test(w));

test('80 a pasted screenshot lands on the host; its path on the line, focused', async ({
  page,
  request,
}, info) => {
  await signIn(page);
  await openPane(page, SHELL0);
  await settled(page);
  const input = page.getByTestId('input');
  await expect(page.getByTestId('file')).toBeVisible();
  const before = (await control(request, '/inbox', {})).split('\n').filter(Boolean).length;
  await input.fill('look at');
  await deliver(page, 'paste', 'shot.png', 'image/png', PNG.toString('base64'));
  await expect(input).toHaveValue(/^look at \S+\.png $/, { timeout: 8000 });
  await expect(input).toBeFocused();
  const [path] = paths(await input.inputValue());
  expect(path).toMatch(PATH);
  await shot(page, info, '80-pasted');
  const names = (await control(request, '/inbox', {})).split('\n').filter(Boolean);
  expect(names.length).toBe(before + 1);
  expect(names).toContain(path.split('/').pop());
  // Nothing reached the pane: the line waits for Enter.
  expect(await control(request, '/capture', { target: 'work:0.0' })).not.toContain(path);
  // A dropped text file follows, after the slot of two seconds.
  await page.waitForTimeout(2100);
  await deliver(page, 'drop', 'notes.txt', 'text/plain', Buffer.from('hello\n').toString('base64'));
  await expect.poll(async () => paths(await input.inputValue()).length, { timeout: 8000 }).toBe(2);
  expect(paths(await input.inputValue())[1]).toMatch(/\.txt$/);
  await input.fill('');
});

test('80 the picker sends each file in turn; a type the host does not take is refused', async ({
  page,
}) => {
  await signIn(page);
  await openPane(page, SHELL0);
  await settled(page);
  await page.waitForTimeout(2100);
  await page.getByTestId('file-picker').setInputFiles([
    { name: 'a.png', mimeType: 'image/png', buffer: PNG },
    { name: 'evil.sh', mimeType: 'application/x-sh', buffer: Buffer.from('#!/bin/sh\n') },
  ]);
  const input = page.getByTestId('input');
  await expect.poll(async () => paths(await input.inputValue()).length, { timeout: 8000 }).toBe(1);
  await expect(page.getByTestId('toast').filter({ hasText: 'evil.sh' })).toContainText(
    'not a type the host takes',
  );
  await input.fill('');
});

test('80 security: a read-only pane or token has no ⇪, and a paste there sends nothing', async ({
  page,
  browser,
  request,
}) => {
  await signIn(page);
  await openPane(page, `${HOST}/work/0.1`);
  await expect(page.getByTestId('readonly')).toBeVisible();
  await expect(page.getByTestId('file')).toHaveCount(0);
  const before = await control(request, '/inbox', {});
  const other = await browser.newContext({ ignoreHTTPSErrors: true, baseURL: page.url() });
  const viewer = await other.newPage();
  await signIn(viewer, RO_TOKEN);
  await openPane(viewer, SHELL0);
  await expect(viewer.getByTestId('file')).toHaveCount(0);
  await viewer.waitForTimeout(1000);
  expect(await control(request, '/inbox', {})).toBe(before);
  await other.close();
});

test('80 a paste on a host without an inbox says so and sends nothing', async ({ page }) => {
  await signIn(page);
  // The host answers the inbox check as one started without --inbox would.
  await page.route('**/v1/panes/**/files', (route) =>
    route.request().method() === 'GET' ? route.fulfill({ status: 404 }) : route.continue(),
  );
  await openPane(page, SHELL0);
  await expect(page.getByTestId('input')).toBeEditable();
  await expect(page.getByTestId('file')).toHaveCount(0);
  await deliver(page, 'paste', 'shot.png', 'image/png', PNG.toString('base64'));
  await expect(page.getByTestId('toast').filter({ hasText: 'no inbox' })).toContainText('--inbox');
  await expect(page.getByTestId('input')).toHaveValue('');
});
