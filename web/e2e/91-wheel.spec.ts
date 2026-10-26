import { expect, test, type Page } from '@playwright/test';
import { control, openPane, RO_TOKEN, SHELL0, shot, signIn } from './fixtures';

// The wheel over a pane. In a shell the browser scrolls the box through
// the history. A program that asked for the mouse (Claude Code, htop)
// scrolls itself: every row of travel becomes a wheel notch at the cell
// under the pointer, three per event at most, whether or not the shell
// left history above the program's screen.

const MOUSE_ON = `printf '\\033[?1000h\\033[?1006h'`;
const ALT_ON = `printf '\\033[?1049h\\033[?1000h\\033[?1006h'`;
const ALL_OFF = `printf '\\033[?1000l\\033[?1006l\\033[?1049l'`;

async function mouseIs(page: Page, on: boolean) {
  await expect
    .poll(async () => {
      const r = await page.request.get(`/v1/panes/${SHELL0}`, {
        headers: { 'X-Muxway-Client': 'web' },
      });
      return ((await r.json()) as { pane: { mouse?: boolean } }).pane.mouse ?? false;
    })
    .toBe(on);
  await page.waitForTimeout(1200);
}

function watchInput(page: Page) {
  const inputs: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/input')) inputs.push(r.postData() ?? '');
  });
  return inputs;
}

// The last line of the screen: where to point, and how wide a cell is.
async function lastLine(page: Page) {
  const line = page.locator('[data-testid="screen"] .ln').last();
  const box = (await line.boundingBox())!;
  const cell = await line.evaluate((el) => {
    const s = document.createElement('span');
    s.textContent = '0000000000';
    el.appendChild(s);
    const w = s.getBoundingClientRect().width / 10;
    s.remove();
    return w;
  });
  return { x: box.x + cell * 4.5, y: box.y + box.height / 2, row: box.height };
}

const notches = (capture: string, code: number) =>
  (capture.match(new RegExp(`\\^\\[\\[<${code};5;\\d+M`, 'g')) ?? []).length;

test('91 the wheel in a shell scrolls the box; once the mouse is asked for, the program gets it', async ({
  page,
  request,
}) => {
  await control(request, '/send', {
    target: 'work:0.0',
    text: 'for i in $(seq 1 120); do echo "history-line-$i"; done',
  });
  // A program that leaves without resetting the mouse (spec 82's cat)
  // leaves tmux reporting it on; make sure the shell is without it.
  await control(request, '/send', { target: 'work:0.0', text: ALL_OFF });
  await signIn(page);
  await openPane(page, SHELL0);
  await mouseIs(page, false);
  await expect
    .poll(() => control(request, '/window-size', { target: 'work:0' }), { timeout: 5000 })
    .not.toBe('100x30');
  await expect(page.getByTestId('screen')).toContainText('history-line-120', { timeout: 5000 });
  const screen = page.getByTestId('screen');
  const gap = () => screen.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);
  await expect.poll(gap).toBeLessThan(5);
  const inputs = watchInput(page);
  const box = (await screen.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -300);
  await expect.poll(gap).toBeGreaterThan(200);
  await page.mouse.wheel(0, 100000);
  await expect.poll(gap).toBeLessThan(5);
  expect(inputs).toEqual([]);
  // The mouse asked for, the history still above: the wheel is the
  // program's now, and the box stays where it was.
  await control(request, '/send', { target: 'work:0.0', text: `${MOUSE_ON}; cat -v` });
  await expect.poll(() => control(request, '/command', { target: 'work:0.0' })).toBe('cat');
  await mouseIs(page, true);
  await expect.poll(gap).toBeLessThan(5);
  const at = await lastLine(page);
  await page.mouse.move(at.x, at.y);
  await page.mouse.wheel(0, -3.5 * at.row);
  const capture = () => control(request, '/capture', { target: 'work:0.0' });
  await expect.poll(async () => notches(await capture(), 64), { timeout: 5000 }).toBe(3);
  // Gathered: at most one request per notch, the counts adding up to three.
  expect(inputs.length).toBeLessThanOrEqual(3);
  const sent = inputs.map((b) => JSON.parse(b).mouse).filter((m) => m.button === 'wheelup');
  expect(sent.reduce((n, m) => n + (m.count ?? 1), 0)).toBe(3);
  expect(await gap()).toBeLessThan(5);
  await page.getByTestId('keybar').getByRole('button', { name: 'C-c' }).click();
  await expect.poll(() => control(request, '/command', { target: 'work:0.0' })).toBe('bash');
  await control(request, '/send', { target: 'work:0.0', text: ALL_OFF });
  await mouseIs(page, false);
});

test('91 the wheel over a program with the mouse is wheelup and wheeldown at the cell', async ({
  page,
  request,
}, info) => {
  // As the owner's Claude Code panes are: started in a fresh pane, on the
  // alternate screen, so the hub sends the rows and nothing more.
  await control(request, '/send', { target: 'work:0.0', text: 'clear' });
  await control(request, '/clear-history', { target: 'work:0.0' });
  await signIn(page);
  await openPane(page, SHELL0);
  await expect
    .poll(() => control(request, '/window-size', { target: 'work:0' }), { timeout: 5000 })
    .not.toBe('100x30');
  await control(request, '/send', { target: 'work:0.0', text: `${ALT_ON}; cat -v` });
  await expect.poll(() => control(request, '/command', { target: 'work:0.0' })).toBe('cat');
  await mouseIs(page, true);
  const screen = page.getByTestId('screen');
  await expect
    .poll(() => screen.evaluate((el) => el.scrollHeight <= el.clientHeight + 1))
    .toBe(true);
  const at = await lastLine(page);
  await page.mouse.move(at.x, at.y);
  const capture = () => control(request, '/capture', { target: 'work:0.0' });
  // Three and a half rows up: three notches, at column 5 of the pointed row.
  await page.mouse.wheel(0, -3.5 * at.row);
  await expect.poll(async () => notches(await capture(), 64), { timeout: 5000 }).toBe(3);
  expect(notches(await capture(), 65)).toBe(0);
  // Down, with the half row left over: three more.
  await page.mouse.wheel(0, 4 * at.row);
  await expect.poll(async () => notches(await capture(), 65), { timeout: 5000 }).toBe(3);
  // One long event arrives whole, as one counted request.
  const inputs = watchInput(page);
  await page.mouse.wheel(0, -20 * at.row);
  // Nineteen, the half row from before carried; the screen holds the last
  // of them and the one request carried them all.
  await expect
    .poll(async () => notches(await capture(), 64), { timeout: 5000 })
    .toBeGreaterThanOrEqual(19);
  await page.waitForTimeout(800);
  expect(inputs.map((b) => JSON.parse(b).mouse.count)).toEqual([19]);
  // The page itself did not move.
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await shot(page, info, '91-wheel');
});

test('91 a read-only token wheels nothing into a pane with the mouse', async ({
  page,
  request,
}) => {
  await signIn(page, RO_TOKEN);
  await openPane(page, SHELL0);
  await mouseIs(page, true);
  await expect(page.getByTestId('input')).toBeDisabled();
  const inputs = watchInput(page);
  const before = await control(request, '/capture', { target: 'work:0.0' });
  const at = await lastLine(page);
  await page.mouse.move(at.x, at.y);
  await page.mouse.wheel(0, -4 * at.row);
  await page.mouse.wheel(0, 4 * at.row);
  await page.waitForTimeout(800);
  expect(inputs).toEqual([]);
  expect(await control(request, '/capture', { target: 'work:0.0' })).toBe(before);
  // Back to a shell on the normal screen for the specs after this one.
  await control(request, '/key', { target: 'work:0.0', key: 'C-c' });
  await expect.poll(() => control(request, '/command', { target: 'work:0.0' })).toBe('bash');
  await control(request, '/send', { target: 'work:0.0', text: ALL_OFF });
  await mouseIs(page, false);
});

test('91 the strip: the wheel and ‹ › move it when the tabs overflow', async ({
  page,
  request,
}, info) => {
  await page.setViewportSize({ width: 800, height: 600 });
  // Nine panes in the logs window: twelve tabs in all.
  const ids: string[] = [];
  const split = async (target: string, dir?: 'h') => {
    const id = await control(request, '/split', dir ? { target, dir } : { target });
    expect(id).toMatch(/^%\d+$/);
    ids.push(id);
    return id;
  };
  const a = await split('work:1.0');
  const row = ['work:1.0', a];
  for (const t of [...row]) row.push(await split(t, 'h'));
  for (const t of [...row]) row.push(await split(t, 'h'));
  await split(row[row.length - 1], 'h');
  try {
    await signIn(page);
    await openPane(page, SHELL0);
    await expect(page.getByTestId('tab')).toHaveCount(12, { timeout: 8000 });
    const tabs = page.getByTestId('tabs');
    const left = () => tabs.evaluate((el) => el.scrollLeft);
    await expect(page.getByTestId('tabs-next')).toBeVisible();
    await expect(page.getByTestId('tabs-prev')).toBeVisible();
    expect(await left()).toBe(0);
    const box = (await tabs.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 200);
    await expect.poll(left).toBeGreaterThan(100);
    // ‹ moves half a strip at a time, back to the start.
    await expect
      .poll(async () => {
        if ((await left()) > 0) await page.getByTestId('tabs-prev').click();
        return left();
      })
      .toBe(0);
    await page.getByTestId('tabs-next').click();
    await expect.poll(left).toBeGreaterThan(100);
    await shot(page, info, '91-strip');
    // With one tile open, ] shows the strip's next pane in it.
    await page.keyboard.press(']');
    await expect(page.getByTestId('pane')).not.toHaveAttribute('data-panes', SHELL0);
    await expect(page.locator('[data-testid="tab"][data-focused]')).not.toHaveAttribute(
      'data-address',
      SHELL0,
    );
  } finally {
    for (const id of ids.reverse()) await control(request, '/kill-pane', { target: id });
  }
  await expect(page.getByTestId('tab')).toHaveCount(4, { timeout: 8000 });
});
