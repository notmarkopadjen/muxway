import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { control, HOST, settled, shot, signIn } from './fixtures';

// Tiles that are every pane of one window are kept in step with it: they
// open as the host has the window, an arrangement made here moves the
// panes on the host (tmux would otherwise fill the places in its own pane
// order, giving each pane another tile's size), and a change at the host
// shows here.

const ARRANGE = !!process.env.MX_ARRANGE;
const at = (i: number) => `${HOST}/work/0.${i}`;

const places = async (request: APIRequestContext) =>
  (await control(request, '/places', { target: 'work:0' })).split('\n').map((l) => {
    const [id, x, y, w, h] = l.split(' ');
    return { id, x: +x, y: +y, w: +w, h: +h };
  });

// Each tile's screen holds as many rows as its pane has, within one.
async function rowsMatch(page: Page, request: APIRequestContext) {
  const ps = await places(request);
  for (const tile of await page.getByTestId('tile').all()) {
    const address = (await tile.getAttribute('data-pane'))!;
    const id = await control(request, '/pane-id', { target: `work:${address.split('/').pop()}` });
    const p = ps.find((q) => q.id === id)!;
    const rows = await tile
      .locator('.mx-screen, [data-testid$="screen"]')
      .first()
      .evaluate((el) => {
        const ln = el.querySelector('.ln');
        const lh = ln ? ln.getBoundingClientRect().height : 16;
        return Math.floor(el.clientHeight / lh);
      });
    expect(Math.abs(rows - p.h), `${address}: ${rows} rows shown, pane ${p.h}`).toBeLessThanOrEqual(
      1,
    );
  }
}

test('100 one window: the tiles take the host layout, move its panes, and follow it', async ({
  page,
  request,
}, info) => {
  test.skip(!ARRANGE, 'needs a window whose panes are all writable');
  await page.setViewportSize({ width: 1400, height: 900 });
  const ids = await Promise.all(
    [0, 1, 2].map((i) => control(request, '/pane-id', { target: `work:0.${i}` })),
  );
  await signIn(page);
  // Opened out of the window's order: the tiles still show the host's.
  await page.goto(`/p/${at(2)},${at(0)},${at(1)}`);
  const pane = page.getByTestId('pane');
  const tile = (a: string) => page.locator(`[data-testid="tile"][data-pane="${a}"]`);
  await expect(page.getByTestId('tile')).toHaveCount(3);
  await settled(page);
  await expect(pane).toHaveAttribute('data-layout', 'custom');
  const y = async (a: string) => (await tile(a).boundingBox())!.y;
  expect(await y(at(0))).toBeLessThan(await y(at(1)));
  expect(await y(at(1))).toBeLessThan(await y(at(2)));
  // ▦ past the presets to main-left: the first tile, the old .2, down the
  // whole left. On the host its pane moves there and becomes .0.
  for (let i = 0; i < 3; i++) await page.keyboard.press('l');
  await expect(pane).toHaveAttribute('data-layout', 'main-left');
  await expect
    .poll(async () => (await places(request)).find((p) => p.x === 0 && p.y === 0)?.id, {
      timeout: 8000,
    })
    .toBe(ids[2]);
  await expect(page).toHaveURL(new RegExp(`/p/${at(0)},${at(1)},${at(2)}$`), { timeout: 8000 });
  expect(await control(request, '/pane-id', { target: 'work:0.0' })).toBe(ids[2]);
  const ps = await places(request);
  const tall = ps.find((p) => p.id === ids[2])!;
  expect(ps.filter((p) => p.id !== ids[2]).every((p) => p.h < tall.h / 2 + 1)).toBe(true);
  await expect
    .poll(
      () =>
        rowsMatch(page, request)
          .then(() => true)
          .catch(() => false),
      {
        timeout: 8000,
      },
    )
    .toBe(true);
  await shot(page, info, '100-order');

  // A change at the host shows here.
  // A change at the host shows here, once the view's own have landed: a
  // rate-limited one is sent again a second later.
  await page.waitForTimeout(2500);
  await control(request, '/select-layout', { target: 'work:0', layout: 'even-horizontal' });
  await expect
    .poll(async () => new Set(await Promise.all([0, 1, 2].map((i) => y(at(i))))).size, {
      timeout: 10_000,
    })
    .toBe(1);

  // Fit off: an arrangement still moves the panes, the window keeps its size.
  await page.keyboard.press('f');
  await expect(page.getByTestId('fit')).toHaveAttribute('data-on', '0');
  await page.waitForTimeout(1500);
  const size = await control(request, '/window-size', { target: 'work:0' });
  const before = await control(request, '/layout', { target: 'work:0' });
  // Past row, which the host has already, to column.
  await page.keyboard.press('l');
  await page.keyboard.press('l');
  await expect(pane).toHaveAttribute('data-layout', 'column');
  await expect
    .poll(() => control(request, '/layout', { target: 'work:0' }), { timeout: 8000 })
    .toMatch(/^[0-9a-f]{4},\d+x\d+,0,0\[/);
  expect(before).toMatch(/^[0-9a-f]{4},\d+x\d+,0,0\{/);
  expect(await control(request, '/window-size', { target: 'work:0' })).toBe(size);
});

test('100 one window with a read-only pane: the tiles follow, they do not move it', async ({
  page,
}) => {
  test.skip(ARRANGE, 'the main environment has the read-only pane');
  await signIn(page);
  await page.goto(`/p/${at(0)},${at(1)}`);
  await expect(page.getByTestId('tile')).toHaveCount(2);
  await settled(page);
  const pane = page.getByTestId('pane');
  await expect(pane).toHaveAttribute('data-layout', 'custom');
  await expect(page.getByTestId('arrange')).toBeDisabled();
  await expect(page.getByTestId('arrange')).toHaveAttribute('title', /every one is writable/);
  const tile = (a: string) => page.locator(`[data-testid="tile"][data-pane="${a}"]`);
  await tile(at(0))
    .locator('.mx-tile-head')
    .dragTo(tile(at(1)));
  await expect(
    page.getByText('moving these panes needs every pane of the window writable'),
  ).toBeVisible();
  await expect(pane).toHaveAttribute('data-panes', `${at(0)} ${at(1)}`);
});
