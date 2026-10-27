import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { control, HOST, openPane, settled, SHELL0, shot, signIn } from './fixtures';

// Fit keeps still: the line's growth is not a resize; = evens one
// window's tiles on the host; the + stays; keys arrive in order.

const LOGS = `${HOST}/work/1.0`;
const SPLIT = `${HOST}/work/1.1`;
const PLAIN_CAT = `printf '\\033[?2004l'; cat -v`;

// The hub's listing, as the client sees it.
async function listed(page: Page) {
  const r = await page.request.get('/v1/panes', { headers: { 'X-Muxway-Client': 'web' } });
  return (await r.json()) as { panes: { window_index: number; window_layout: string }[] };
}

// The window given back to tmux's own size, so the next spec starts clean.
async function released(page: Page, request: APIRequestContext) {
  await page.goto('/');
  await expect
    .poll(() => control(request, '/window-size', { target: 'work:0' }), { timeout: 8000 })
    .toBe('100x30');
}

function watchResizes(page: Page): string[] {
  const out: string[] = [];
  page.on('request', (r) => {
    if (/\/v1\/panes\/.+\/resize$/.test(r.url()) && r.method() === 'POST')
      out.push(r.postData() ?? '');
  });
  return out;
}

test('84 the input line grown to several rows resizes nothing; the screen scrolls under it', async ({
  page,
  request,
}, info) => {
  const resizes = watchResizes(page);
  await signIn(page);
  await openPane(page, SHELL0);
  await settled(page);
  await expect.poll(() => resizes.length, { timeout: 5000 }).toBeGreaterThan(0);
  await page.waitForTimeout(1500);
  const sent = resizes.length;
  const size = await control(request, '/window-size', { target: 'work:0' });
  const input = page.getByTestId('input');
  await input.fill('echo ' + 'word '.repeat(90));
  await expect
    .poll(() => input.evaluate((el) => el.clientHeight))
    .toBeGreaterThan(await input.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight) * 3));
  await page.waitForTimeout(1500);
  expect(resizes).toHaveLength(sent);
  expect(await control(request, '/window-size', { target: 'work:0' })).toBe(size);
  await shot(page, info, '84-line-grown');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('screen')).toContainText('word word word', { timeout: 5000 });
  await page.waitForTimeout(1500);
  expect(resizes).toHaveLength(sent);
  expect(await control(request, '/window-size', { target: 'work:0' })).toBe(size);
  await control(request, '/send', { target: 'work:0.0', text: 'clear' });
  await released(page, request);
});

test("84 = gives one window's tiles equal shares, and the host follows", async ({
  page,
  request,
}) => {
  const id = await control(request, '/split', { target: 'work:1.0', dir: 'h' });
  await signIn(page);
  await expect(page.getByTestId('pane-row').filter({ hasText: SPLIT })).toBeVisible({
    timeout: 10_000,
  });
  // The host's split is uneven: the tiles open so.
  await control(request, '/select-layout', { target: 'work:1', layout: 'main-vertical' });
  const hostLayout = await control(request, '/layout', { target: 'work:1' });
  await expect
    .poll(async () => (await listed(page)).panes.find((p) => p.window_index === 1)?.window_layout, {
      timeout: 8000,
    })
    .toBe(hostLayout);
  await page.goto(`/p/${LOGS},${SPLIT}`);
  const slots = page.locator('.mx-slot');
  await expect(slots).toHaveCount(2);
  await settled(page);
  await expect(page.locator('.mx-area')).toHaveAttribute('data-window-fit', '');
  await expect
    .poll(async () =>
      Math.abs(
        (await slots.nth(0).boundingBox())!.width - (await slots.nth(1).boundingBox())!.width,
      ),
    )
    .toBeGreaterThan(40);
  const widths = () => control(request, '/places', { target: 'work:1' });
  await page.keyboard.press('=');
  await expect
    .poll(async () =>
      Math.abs(
        (await slots.nth(0).boundingBox())!.width - (await slots.nth(1).boundingBox())!.width,
      ),
    )
    .toBeLessThan(12);
  // The host's panes end up within a column of each other.
  await expect
    .poll(
      async () => {
        const ws = (await widths()).split('\n').map((l) => Number(l.split(' ')[3]));
        return Math.abs(ws[0] - ws[1]);
      },
      { timeout: 8000 },
    )
    .toBeLessThanOrEqual(1);
  await page.goto('/');
  await control(request, '/kill-pane', { target: id });
  await expect
    .poll(async () => (await listed(page)).panes.filter((p) => p.window_index === 1).length, {
      timeout: 8000,
    })
    .toBe(1);
});

test('84 the + stays on a read-only pane of a host without sessions, its items disabled with a reason', async ({
  page,
}) => {
  await signIn(page);
  await openPane(page, 'bob-desktop/work/0.0');
  await expect(page.getByTestId('readonly')).toBeVisible();
  const add = page.getByTestId('add');
  await expect(add).toBeVisible();
  await add.click();
  await expect(page.getByTestId('add-split')).toBeDisabled();
  await expect(page.getByTestId('add-split')).toHaveAttribute('title', /read only/);
  await expect(page.getByTestId('add-session')).toBeDisabled();
  await expect(page.getByTestId('add-session')).toHaveAttribute('title', /no sessions here/);
  await page.keyboard.press('Escape');
});

test('84 keys pressed in a burst reach the pane in order', async ({ page, request }) => {
  await control(request, '/send', { target: 'work:0.0', text: PLAIN_CAT });
  await signIn(page);
  await openPane(page, SHELL0);
  await expect(page.getByTestId('cmdbar')).toHaveCount(0, { timeout: 10_000 });
  await page.keyboard.press(':');
  await expect(page.getByTestId('input')).toBeFocused();
  const keys = [
    'ArrowUp',
    'PageUp',
    'Home',
    'End',
    'ArrowDown',
    'PageDown',
    'ArrowLeft',
    'ArrowRight',
  ];
  const want = '^[[A^[[5~^[[1~^[[4~^[[B^[[6~^[[D^[[C';
  // Sixteen keys at once: a burst a hand can make, within the hub's rate,
  // and twice what reached the pane out of order before the queue.
  for (let round = 0; round < 2; round++) {
    for (const k of keys) await page.keyboard.press(k);
  }
  await expect
    .poll(() => control(request, '/capture', { target: 'work:0.0' }), { timeout: 10_000 })
    .toContain(want.repeat(2));
  await page.getByTestId('keybar').getByRole('button', { name: 'C-c', exact: true }).click();
  await expect.poll(() => control(request, '/command', { target: 'work:0.0' })).toBe('bash');
  await control(request, '/send', { target: 'work:0.0', text: 'clear' });
  await released(page, request);
});
