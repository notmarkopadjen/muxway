import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { control, HOST, settled, shot, signIn } from './fixtures';

// A fit gives the window back: three of a window's four panes as tiles,
// zoomed in on one and out again, end at their asks, none held, the
// window no wider than the fits need; and the seven fits of seven tiles of
// one window land together, none rate limited.

const LOGS = `${HOST}/work/1.0`;
const SPLIT = `${HOST}/work/1.1`;
const SPLIT2 = `${HOST}/work/1.2`;
const SPLIT3 = `${HOST}/work/1.3`;

// The panes this file splits off are killed after each test: the specs
// after it in the run match rows by text, and a window of ten and more
// panes makes `work/1.1` match `work/1.10` too.
const made: string[] = [];
// Each split evens the row out, so the next one has room in it and the
// panes stay side by side, as the tests below expect.
async function split(request: APIRequestContext, target: string) {
  const id = await control(request, '/split', { target, dir: 'h' });
  made.push(id);
  await control(request, '/select-layout', {
    target: target.split('.')[0],
    layout: 'even-horizontal',
  });
  return id;
}
test.afterEach(async ({ request }) => {
  for (const id of made.splice(0).reverse()) await control(request, '/kill-pane', { target: id });
});

interface Resize {
  address: string;
  body: Record<string, unknown>;
}
function watchResizes(page: Page): { sent: Resize[]; limited: number } {
  const out = { sent: [] as Resize[], limited: 0 };
  page.on('request', (r) => {
    const m = r.url().match(/\/v1\/panes\/(.+)\/resize$/);
    if (m && r.method() === 'POST')
      out.sent.push({ address: decodeURIComponent(m[1]), body: JSON.parse(r.postData() ?? '{}') });
  });
  page.on('response', (r) => {
    if (/\/v1\/panes\/.+\/resize$/.test(r.url()) && r.status() === 429) out.limited++;
  });
  return out;
}
const lastFit = (rs: Resize[], address: string) =>
  rs
    .filter((r) => r.address === address && r.body.fit !== 'auto' && r.body.scope !== 'window')
    .at(-1)?.body;
const sizeOf = async (page: Page, a: string) => {
  const t = (await page.locator(`[data-pane="${a}"] .mx-tile-head .mx-size`).textContent()) ?? '';
  const m = /(\d+)×(\d+)/.exec(t)!;
  return { cols: Number(m[1]), rows: Number(m[2]) };
};
const windowWidth = async (request: Parameters<typeof control>[0]) =>
  Number((await control(request, '/window-size', { target: 'work:1' })).split('x')[0]);

test('122 three of four panes as tiles: a zoom in and out leaves every tile at its ask and the window no wider', async ({
  page,
  request,
}, info) => {
  for (let i = 0; i < 3; i++) await split(request, 'work:1.0');
  const resizes = watchResizes(page);
  await signIn(page);
  await expect(page.locator(`[data-testid="pane-row"][data-address="${SPLIT3}"]`)).toBeVisible({
    timeout: 10_000,
  });
  await page.goto(`/p/${LOGS},${SPLIT},${SPLIT2}`);
  const tiles = page.getByTestId('tile');
  await expect(tiles).toHaveCount(3);
  await settled(page);
  // Three pane fits, each tile at its ask.
  const atAsk = async () => {
    for (const a of [LOGS, SPLIT, SPLIT2]) {
      const fit = lastFit(resizes.sent, a);
      if (!fit) return `no fit for ${a}`;
      const size = await sizeOf(page, a);
      if (size.cols !== fit.cols || size.rows !== fit.rows)
        return `${a} at ${size.cols}×${size.rows} for ${fit.cols}×${fit.rows}`;
    }
    return (await page.getByTestId('held').count()) === 0 ? 'ok' : 'held';
  };
  await expect.poll(atAsk, { timeout: 15_000 }).toBe('ok');
  await shot(page, info, '122-tiles');
  const before = await windowWidth(request);
  // Zoom in on the focused tile: its window is sized to the browser and
  // the pane zoomed, so the window is far wider than the three fits.
  await page.keyboard.press('z');
  await expect(tiles).toHaveCount(1);
  await expect
    .poll(
      () =>
        resizes.sent.filter((r) => r.address === LOGS && r.body.scope === 'window' && r.body.zoom)
          .length,
      { timeout: 10_000 },
    )
    .toBeGreaterThan(0);
  await expect.poll(() => windowWidth(request), { timeout: 10_000 }).not.toBe(before);
  await shot(page, info, '122-zoomed');
  // Zoom out: the tiles come back and fit again; the window shrinks to
  // what they ask, nobody is held, nobody is drawn scaled.
  await page.keyboard.press('z');
  await expect(tiles).toHaveCount(3);
  await settled(page);
  await expect.poll(atAsk, { timeout: 15_000 }).toBe('ok');
  // On the host: the three fitted panes exactly their asks, the fourth
  // at the floor or above, the window their sum and nothing more.
  const widths = (await control(request, '/places', { target: 'work:1' }))
    .split('\n')
    .map((l) => Number(l.split(' ')[3]));
  const asks = [LOGS, SPLIT, SPLIT2].map((a) => lastFit(resizes.sent, a)!.cols as number);
  expect(widths.slice(0, 3)).toEqual(asks);
  expect(widths[3]).toBeGreaterThanOrEqual(20);
  expect(await windowWidth(request)).toBe(widths.reduce((a, b) => a + b, 0) + widths.length - 1);
  await shot(page, info, '122-back');
});

test('122 seven of an eight-pane window as tiles: the fits land together, none rate limited, none held', async ({
  page,
  request,
}, info) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  for (let i = 0; i < 7; i++) await split(request, 'work:1.0');
  const resizes = watchResizes(page);
  await signIn(page);
  await expect(page.getByTestId('pane-row').filter({ hasText: `${HOST}/work/1.7` })).toBeVisible({
    timeout: 10_000,
  });
  const seven = [LOGS, ...Array.from({ length: 6 }, (_, i) => `${HOST}/work/1.${i + 1}`)];
  await page.goto(`/p/${seven.join(',')}`);
  const tiles = page.getByTestId('tile');
  await expect(tiles).toHaveCount(7);
  await settled(page);
  await expect
    .poll(
      async () => {
        for (const a of seven) {
          const fit = lastFit(resizes.sent, a);
          if (!fit) return 'no fit';
          const size = await sizeOf(page, a);
          if (size.cols !== fit.cols || size.rows !== fit.rows)
            return `${a} at ${size.cols}×${size.rows}`;
        }
        return (await page.getByTestId('held').count()) === 0 ? 'ok' : 'held';
      },
      { timeout: 15_000 },
    )
    .toBe('ok');
  expect(resizes.limited).toBe(0);
  await shot(page, info, '122-seven');
});
