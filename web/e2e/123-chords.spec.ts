import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { control, HOST, settled, shot, signIn } from './fixtures';

// Ctrl+] and Ctrl+[ go to the next and the previous pane from anywhere:
// in direct typing (which stays on, the next pane typed into at once),
// on the line, on the page, with one tile open (the strip's neighbour)
// and in the window view. The chords never reach the pane; Esc alone
// still does. The help lists them.

const LOGS = `${HOST}/work/1.0`;
const SPLIT = `${HOST}/work/1.1`;

// The panes this file splits off are killed after each test: the specs
// after it in the run match rows by text, and a window of ten and more
// panes makes `work/1.1` match `work/1.10` too.
const made: string[] = [];
async function split(request: APIRequestContext, target: string) {
  const id = await control(request, '/split', { target, dir: 'h' });
  made.push(id);
  return id;
}
test.afterEach(async ({ request }) => {
  for (const id of made.splice(0).reverse()) await control(request, '/kill-pane', { target: id });
});

interface Input {
  address: string;
  body: { key?: string; text?: string };
}
function watchInput(page: Page): Input[] {
  const out: Input[] = [];
  page.on('request', (r) => {
    const m = r.url().match(/\/v1\/panes\/(.+)\/input(?:\?|$)/);
    if (m && r.method() === 'POST')
      out.push({ address: decodeURIComponent(m[1]), body: JSON.parse(r.postData() ?? '{}') });
  });
  return out;
}
const focusedPane = (page: Page) => page.locator('[data-testid="tile"][data-focused]');

test('123 the chords cycle the tiles from direct typing, the line and the page, and never reach the pane', async ({
  page,
  request,
}, info) => {
  await split(request, 'work:1.0');
  const inputs = watchInput(page);
  await signIn(page);
  await expect(page.locator(`[data-testid="pane-row"][data-address="${SPLIT}"]`)).toBeVisible({
    timeout: 10_000,
  });
  await page.goto(`/p/${LOGS},${SPLIT}`);
  await expect(page.getByTestId('tile')).toHaveCount(2);
  await settled(page);
  const form = page.locator('form.mx-input');
  // Direct typing in the first tile.
  await page.locator(`[data-pane="${LOGS}"] [data-testid="screen"]`).click();
  await expect(form).toHaveAttribute('data-direct', '');
  await expect(focusedPane(page)).toHaveAttribute('data-pane', LOGS);
  // Ctrl+]: the second tile has the focus, direct typing is still on,
  // and the next key lands in the second pane.
  await page.keyboard.press('Control+]');
  await expect(focusedPane(page)).toHaveAttribute('data-pane', SPLIT);
  await expect(form).toHaveAttribute('data-direct', '');
  await page.keyboard.press('x');
  await expect
    .poll(() => inputs.filter((i) => i.address === SPLIT && i.body.text === 'x').length)
    .toBe(1);
  await shot(page, info, '123-direct-next');
  // Round at the end, and back with Ctrl+[.
  await page.keyboard.press('Control+]');
  await expect(focusedPane(page)).toHaveAttribute('data-pane', LOGS);
  await page.keyboard.press('Control+[');
  await expect(focusedPane(page)).toHaveAttribute('data-pane', SPLIT);
  await page.keyboard.press('Control+[');
  await expect(focusedPane(page)).toHaveAttribute('data-pane', LOGS);
  // Cmd stands for Ctrl, for a Mac: round once more and back.
  await page.keyboard.press('Meta+]');
  await expect(focusedPane(page)).toHaveAttribute('data-pane', SPLIT);
  await expect(form).toHaveAttribute('data-direct', '');
  await page.keyboard.press('Meta+[');
  await expect(focusedPane(page)).toHaveAttribute('data-pane', LOGS);
  // Esc alone still goes to the pane.
  await page.keyboard.press('Escape');
  await expect
    .poll(() => inputs.filter((i) => i.address === LOGS && i.body.key === 'Escape').length)
    .toBe(1);
  // Nothing of the chords reached any pane.
  expect(inputs.filter((i) => i.body.key === 'C-]' || i.body.key === 'C-[')).toEqual([]);
  expect(inputs.filter((i) => i.body.text === ']' || i.body.text === '[')).toEqual([]);
  expect(inputs.filter((i) => i.body.key === 'Escape').length).toBe(1);
  // Shift+Esc leaves; the chords work on the page too.
  await page.keyboard.press('Shift+Escape');
  await expect(form).not.toHaveAttribute('data-direct', '');
  await page.keyboard.press('Control+]');
  await expect(focusedPane(page)).toHaveAttribute('data-pane', SPLIT);
  // And from the line, which keeps the focus.
  const input = page.getByTestId('input');
  await input.click();
  await expect(input).toBeFocused();
  await page.keyboard.press('Control+[');
  await expect(focusedPane(page)).toHaveAttribute('data-pane', LOGS);
  await expect(input).toBeFocused();
  // The help lists them.
  await page.keyboard.press('Escape');
  await page.keyboard.press('?');
  await expect(page.getByTestId('help')).toContainText('Ctrl+] / Ctrl+[');
  await shot(page, info, '123-help');
});

test("123 with one tile open the chords bring the strip's neighbour in; the window view moves between its cells", async ({
  page,
  request,
}) => {
  await split(request, 'work:1.0');
  await signIn(page);
  await expect(page.locator(`[data-testid="pane-row"][data-address="${SPLIT}"]`)).toBeVisible({
    timeout: 10_000,
  });
  await page.goto(`/p/${LOGS}`);
  await expect(page.getByTestId('tile')).toHaveCount(1);
  await settled(page);
  await page.keyboard.press('Control+]');
  await expect.poll(() => page.getByTestId('tile').getAttribute('data-pane')).not.toBe(LOGS);
  await expect(page.getByTestId('tile')).toHaveCount(1);
  await page.keyboard.press('Control+[');
  await expect.poll(() => page.getByTestId('tile').getAttribute('data-pane')).toBe(LOGS);
  // The window view: the chords move the focus between the cells, direct
  // typing kept.
  // (The window holds whatever panes earlier specs split off: two or more.)
  await page.goto(`/w/${HOST}/work/1`);
  const cells = page.getByTestId('cell');
  await expect(cells.nth(1)).toBeVisible();
  await settled(page);
  await cells.first().locator('[data-testid="cell-screen"]').click();
  await expect(page.locator('form.mx-input')).toHaveAttribute('data-direct', '');
  await expect(cells.first()).toHaveAttribute('data-focused', '');
  await page.keyboard.press('Control+]');
  await expect(cells.nth(1)).toHaveAttribute('data-focused', '');
  await expect(page.locator('form.mx-input')).toHaveAttribute('data-direct', '');
  await page.keyboard.press('Control+[');
  await expect(cells.first()).toHaveAttribute('data-focused', '');
});
