import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { control, HOST, settled, shot, signIn } from './fixtures';

// A fit gives the window back: three of a window's four panes as tiles
// fit the window as one, the fourth stacked at the right; zoomed in on
// one and out again, they end as the layout says, none held, the window
// no wider than the layout; and seven of an eight-pane window as tiles
// are one fit, none rate limited.

const LOGS = `${HOST}/work/1.0`;
const SPLIT = `${HOST}/work/1.1`;
const SPLIT2 = `${HOST}/work/1.2`;
const SPLIT3 = `${HOST}/work/1.3`;

// The panes this file splits off are killed after each test: the specs
// after it in the run match rows by text, and a window of ten and more
// panes makes `work/1.1` match `work/1.10` too. Each split evens the row
// out, so the next one has room in it and the panes stay side by side.
const made: string[] = [];
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
  body: { scope?: string; layout?: string; fit?: string; zoom?: boolean; cols?: number };
  status: number;
}
function watchResizes(page: Page): { sent: Resize[]; limited: number } {
  const out = { sent: [] as Resize[], limited: 0 };
  page.on('response', (r) => {
    const m = r.url().match(/\/v1\/panes\/(.+)\/resize$/);
    if (!m || r.request().method() !== 'POST') return;
    out.sent.push({
      address: decodeURIComponent(m[1]),
      body: JSON.parse(r.request().postData() ?? '{}') as Resize['body'],
      status: r.status(),
    });
    if (r.status() === 429) out.limited++;
  });
  return out;
}
const layouts = (rs: Resize[]) =>
  rs.filter((r) => r.body.scope === 'window' && r.body.layout && r.status === 200);
// A layout's panes: id, width, height.
const cells = (layout: string) =>
  [...layout.matchAll(/(\d+)x(\d+),\d+,\d+,(\d+)/g)].map((m) => ({
    id: `%${m[3]}`,
    w: Number(m[1]),
    h: Number(m[2]),
  }));
const places = async (request: APIRequestContext) =>
  (await control(request, '/places', { target: 'work:1' })).split('\n').map((l) => {
    const [id, x, y, w, h] = l.split(' ');
    return { id, x: +x, y: +y, w: +w, h: +h };
  });
// The host has every open pane as the layout last taken says; the
// hidden ones (skip) are the host's to share out.
async function asSent(request: APIRequestContext, rs: Resize[], skip: string[]) {
  const last = layouts(rs).at(-1);
  if (!last) return 'no layout';
  const ps = await places(request);
  for (const c of cells(last.body.layout!)) {
    if (skip.includes(c.id)) continue;
    const p = ps.find((q) => q.id === c.id);
    if (!p) return `${c.id} gone`;
    if (p.w !== c.w || p.h !== c.h) return `${c.id} at ${p.w}x${p.h} for ${c.w}x${c.h}`;
  }
  return 'ok';
}
const windowWidth = async (request: APIRequestContext) =>
  Number((await control(request, '/window-size', { target: 'work:1' })).split('x')[0]);

test('122 three of four panes as tiles: a zoom in and out leaves every pane as the layout says and the window no wider', async ({
  page,
  request,
}, info) => {
  for (let i = 0; i < 3; i++) await split(request, 'work:1.0');
  const fourth = await control(request, '/pane-id', { target: 'work:1.3' });
  const resizes = watchResizes(page);
  await signIn(page);
  await expect(page.locator(`[data-testid="pane-row"][data-address="${SPLIT3}"]`)).toBeVisible({
    timeout: 10_000,
  });
  await page.goto(`/p/${LOGS},${SPLIT},${SPLIT2}`);
  const tiles = page.getByTestId('tile');
  await expect(tiles).toHaveCount(3);
  await settled(page);
  // One fit for the window, each open pane its tile, the fourth at the
  // right at the floor, the window the sum and nothing more.
  const asLaid = async () => {
    const r = await asSent(request, resizes.sent, [fourth]);
    if (r !== 'ok') return r;
    const ps = await places(request);
    const f = ps.find((p) => p.id === fourth);
    if (!f || f.w !== 20) return `fourth at ${f?.w}`;
    const width = await windowWidth(request);
    const sum = ps.reduce((s, p) => s + p.w, 0) + ps.length - 1;
    if (width !== sum) return `window ${width} for ${sum}`;
    return (await page.getByTestId('held').count()) === 0 ? 'ok' : 'held';
  };
  await expect.poll(asLaid, { timeout: 15_000 }).toBe('ok');
  expect(resizes.sent.filter((r) => r.body.scope !== 'window' && !r.body.fit)).toEqual([]);
  await shot(page, info, '122-tiles');
  const before = await windowWidth(request);
  // Zoom in on the focused tile: its window is sized to the browser and
  // the pane zoomed, so the window is far wider than the three.
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
  // Zoom out: the tiles come back and the window is laid out again as
  // they are; nobody is held, nobody is drawn scaled.
  const sent = layouts(resizes.sent).length;
  await page.keyboard.press('z');
  await expect(tiles).toHaveCount(3);
  await settled(page);
  await expect.poll(() => layouts(resizes.sent).length, { timeout: 10_000 }).toBeGreaterThan(sent);
  await expect.poll(asLaid, { timeout: 15_000 }).toBe('ok');
  await shot(page, info, '122-back');
});

test('122 seven of an eight-pane window as tiles: one fit for the window, none rate limited, none held', async ({
  page,
  request,
}, info) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  for (let i = 0; i < 7; i++) await split(request, 'work:1.0');
  const eighth = await control(request, '/pane-id', { target: 'work:1.7' });
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
  await expect.poll(() => asSent(request, resizes.sent, [eighth]), { timeout: 15_000 }).toBe('ok');
  expect(resizes.sent.filter((r) => r.body.scope !== 'window' && !r.body.fit)).toEqual([]);
  await expect(page.getByTestId('held')).toHaveCount(0);
  expect(resizes.limited).toBe(0);
  await shot(page, info, '122-seven');
});
