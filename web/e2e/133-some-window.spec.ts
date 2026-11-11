import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { control, HOST, settled, shot, SHELL0, signIn } from './fixtures';

// Some of a window's panes as tiles fit the window as one: the open panes
// laid out as the tiles are, exact to the cell, and the panes not open
// stacked at the right at the floor, so no tile is held; a zoom in and
// out leaves them so. A window with a pane the token may not write keeps
// the fits per pane, and its layout is not moved.

const LOGS = `${HOST}/work/1.0`;

// The panes split off are killed after each test, newest first. Each
// split re-tiles the window, so the next one has room in it.
const made: string[] = [];
async function split(request: APIRequestContext, target: string, n: number) {
  for (let i = 0; i < n; i++) {
    made.push(await control(request, '/split', { target, dir: 'h' }));
    await control(request, '/select-layout', { target: target.split('.')[0], layout: 'tiled' });
  }
}
test.afterEach(async ({ request }) => {
  for (const id of made.splice(0).reverse()) await control(request, '/kill-pane', { target: id });
});

interface Resize {
  address: string;
  body: { scope?: string; layout?: string; fit?: string; zoom?: boolean };
  status: number;
}
// Every resize the page sends, with the hub's answer.
function watchResizes(page: Page): Resize[] {
  const out: Resize[] = [];
  page.on('response', (r) => {
    const m = r.url().match(/\/v1\/panes\/(.+)\/resize$/);
    if (!m || r.request().method() !== 'POST') return;
    out.push({
      address: decodeURIComponent(m[1]),
      body: JSON.parse(r.request().postData() ?? '{}') as Resize['body'],
      status: r.status(),
    });
  });
  return out;
}
const layouts = (rs: Resize[]) => rs.filter((r) => r.body.scope === 'window' && r.body.layout);

// A layout's panes: id, width, height, in the order written.
const cells = (layout: string) =>
  [...layout.matchAll(/(\d+)x(\d+),\d+,\d+,(\d+)/g)].map((m) => ({
    id: `%${m[3]}`,
    w: Number(m[1]),
    h: Number(m[2]),
  }));
// The host's panes of a window: id, left, top, width, height.
const places = async (request: APIRequestContext, target: string) =>
  (await control(request, '/places', { target })).split('\n').map((l) => {
    const [id, x, y, w, h] = l.split(' ');
    return { id, x: +x, y: +y, w: +w, h: +h };
  });
// The host has every open pane as the layout last sent says; the stack
// of the hidden ones (skip) is the host's to share out.
async function asSent(request: APIRequestContext, rs: Resize[], skip: string[]) {
  const last = layouts(rs)
    .filter((r) => r.status === 200)
    .at(-1);
  if (!last) return 'no layout';
  const ps = await places(request, 'work:1');
  for (const c of cells(last.body.layout!)) {
    if (skip.includes(c.id)) continue;
    const p = ps.find((q) => q.id === c.id);
    if (!p) return `${c.id} gone`;
    if (p.w !== c.w || p.h !== c.h) return `${c.id} at ${p.w}x${p.h} for ${c.w}x${c.h}`;
  }
  return 'ok';
}
const shapeOf = (layout: string) =>
  layout.replace(/^[0-9a-f]{4},/, '').replace(/\d+x\d+,\d+,\d+/g, '');

test('133 three of five panes as tiles: each pane its tile, the hidden two stacked at the right, none held; a zoom in and out leaves it so', async ({
  page,
  request,
}, info) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await split(request, 'work:1.0', 4);
  const ids = await Promise.all(
    [3, 4].map((i) => control(request, '/pane-id', { target: `work:1.${i}` })),
  );
  const resizes = watchResizes(page);
  await signIn(page);
  await expect(
    page.locator(`[data-testid="pane-row"][data-address="${HOST}/work/1.4"]`),
  ).toBeVisible({ timeout: 10_000 });
  const three = [LOGS, `${HOST}/work/1.1`, `${HOST}/work/1.2`];
  await page.goto(`/p/${three.join(',')}`);
  const tiles = page.getByTestId('tile');
  await expect(tiles).toHaveCount(3);
  await settled(page);
  // One fit for the window, with a layout naming every pane, and the
  // host lays the window out as it says.
  await expect.poll(() => layouts(resizes).length, { timeout: 10_000 }).toBeGreaterThan(0);
  await expect.poll(() => asSent(request, resizes, ids), { timeout: 15_000 }).toBe('ok');
  expect(resizes.filter((r) => r.body.scope !== 'window' && !r.body.fit)).toEqual([]);
  await expect(page.getByTestId('held')).toHaveCount(0);
  // The hidden two: a stack at the right, 20 columns wide, as tall as the window together.
  let ps = await places(request, 'work:1');
  const hidden = ids.map((id) => ps.find((p) => p.id === id)!);
  const shown = ps.filter((p) => !ids.includes(p.id));
  for (const h of hidden) {
    expect(h.w).toBe(20);
    expect(h.x).toBeGreaterThan(Math.max(...shown.map((p) => p.x)));
  }
  expect(hidden[0].x).toBe(hidden[1].x);
  const width = Number(
    (await control(request, '/window-size', { target: 'work:1' })).split('x')[0],
  );
  expect(width).toBe(shown.reduce((s, p) => s + p.w, 0) + shown.length + 20);
  await shot(page, info, '133-three-of-five');
  // Zoom in on the focused tile and out again: the three come back as
  // they were, the hidden two in their stack.
  await page.keyboard.press('z');
  await expect(tiles).toHaveCount(1);
  await expect
    .poll(() => resizes.filter((r) => r.body.zoom).length, { timeout: 10_000 })
    .toBeGreaterThan(0);
  await page.keyboard.press('z');
  await expect(tiles).toHaveCount(3);
  await settled(page);
  const before = layouts(resizes).length;
  await expect.poll(() => layouts(resizes).length, { timeout: 10_000 }).toBeGreaterThan(before - 1);
  await expect.poll(() => asSent(request, resizes, ids), { timeout: 15_000 }).toBe('ok');
  await expect(page.getByTestId('held')).toHaveCount(0);
  ps = await places(request, 'work:1');
  for (const id of ids) expect(ps.find((p) => p.id === id)!.w).toBe(20);
  await shot(page, info, '133-back');
  // Leaving gives the window back; the arrangement stays, as one does.
  await page.goto('/');
  await expect(page.getByTestId('panes')).toBeVisible();
  await expect
    .poll(() => control(request, '/window-size', { target: 'work:1' }), { timeout: 8000 })
    .toBe('100x30');
});

test('133 security: a window with a pane the token may not write keeps the fits per pane, and its layout', async ({
  page,
  request,
}) => {
  // work:0 has the shell and a read-only pane; a pane split off the
  // shell is writable, so two of three are, and the third is not.
  const id = await control(request, '/split', { target: 'work:0.0', dir: 'h' });
  made.push(id);
  const r = await page.request.get('/v1/panes', { headers: { 'X-Muxway-Client': 'e2e' } });
  const listed = ((await r.json()) as { panes: { address: string; pane_id: string }[] }).panes;
  const other = listed.find((p) => p.pane_id === id)!.address;
  const before = await control(request, '/layout', { target: 'work:0' });
  const resizes = watchResizes(page);
  await signIn(page);
  await page.goto(`/p/${SHELL0},${other}`);
  await expect(page.getByTestId('tile')).toHaveCount(2);
  await settled(page);
  // The tiles fit their own panes; no layout goes to the host.
  await expect
    .poll(() => resizes.filter((r) => r.body.scope !== 'window' && !r.body.fit).length, {
      timeout: 10_000,
    })
    .toBeGreaterThanOrEqual(2);
  await page.waitForTimeout(1500);
  expect(layouts(resizes)).toEqual([]);
  // The read-only pane was not moved: the window keeps its shape.
  expect(shapeOf(await control(request, '/layout', { target: 'work:0' }))).toBe(shapeOf(before));
  await page.goto('/');
  await expect(page.getByTestId('panes')).toBeVisible();
});
