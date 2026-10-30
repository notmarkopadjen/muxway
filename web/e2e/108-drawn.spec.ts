import { expect, test, type Page } from '@playwright/test';
import { control, HOST, openPane, settled, SHELL0, shot, signIn } from './fixtures';

// A tile says sync while the host catches up with its fit, and every move
// of the tiles and the window view's cells is drawn as a view transition
// with the tiles named, unless effects are off or motion is reduced.

const RO = `${HOST}/work/0.1`;
const LOGS = `${HOST}/work/1.0`;

interface Moves {
  names: string[][];
  anims: string[][];
  errors: string[];
}
// Records, at each view transition, the names the moving elements carry
// when the browser takes its picture, and the animations once it is ready.
async function watchMoves(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __moves: Moves };
    w.__moves = { names: [], anims: [], errors: [] };
    const doc = document as Document & {
      startViewTransition?: (cb: () => Promise<void>) => { ready: Promise<void> };
    };
    const orig = doc.startViewTransition?.bind(document);
    if (!orig) return;
    doc.startViewTransition = (cb) => {
      w.__moves.names.push(
        [...document.querySelectorAll<HTMLElement>('[data-moving]')].map(
          (el) => el.style.viewTransitionName,
        ),
      );
      const t = orig(cb);
      t.ready
        .then(() =>
          w.__moves.anims.push(
            document.getAnimations().map((a) => (a as CSSAnimation).animationName),
          ),
        )
        .catch((e: unknown) => w.__moves.errors.push(String(e)));
      return t;
    };
  });
}
const moves = (page: Page) =>
  page.evaluate(() => (window as unknown as { __moves: Moves }).__moves);
const none = async (page: Page) => {
  await expect(page.locator('[data-moving]')).toHaveCount(0, { timeout: 3000 });
  expect(
    await page.evaluate(
      () =>
        [...document.querySelectorAll<HTMLElement>('[data-pane]')].filter(
          (el) => el.style.viewTransitionName,
        ).length,
    ),
  ).toBe(0);
};
const bandAnimation = (page: Page) =>
  page.evaluate(() => {
    const body = document.querySelector('[data-testid="tile"] > .mx-tile-body')!;
    const s = getComputedStyle(body, '::after');
    return s.display === 'none' ? 'none' : s.animationName;
  });

test('108 a tile says sync while the host catches up with its fit', async ({ page }, info) => {
  // The host's answer is slow: the tile waits, saying so.
  await page.route(/\/v1\/panes\/.+\/resize$/, async (route) => {
    const body = route.request().postDataJSON() as { fit?: string };
    if (body.fit !== 'auto') await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  await signIn(page);
  await openPane(page, SHELL0);
  const tile = page.getByTestId('tile');
  await expect(tile).toHaveAttribute('data-syncing', '');
  await expect(page.getByTestId('syncing')).toBeVisible();
  expect(await bandAnimation(page)).toBe('mx-tune');
  expect(
    await page
      .locator('[data-testid="syncing"]')
      .evaluate((el) => getComputedStyle(el).animationName),
  ).toBe('mx-blink');
  await shot(page, info, '108-sync');
  await expect(tile).not.toHaveAttribute('data-syncing', '', { timeout: 10_000 });
  await expect(page.getByTestId('syncing')).toHaveCount(0);
  expect(await bandAnimation(page)).toBe('none');
  // Effects off: the word, no band.
  await page.keyboard.press('m');
  await page.goto(`/p/${LOGS}`);
  await expect(page.getByTestId('syncing')).toBeVisible();
  expect(await bandAnimation(page)).toBe('none');
  expect(
    await page
      .locator('[data-testid="syncing"]')
      .evaluate((el) => getComputedStyle(el).animationName),
  ).toBe('none');
  await expect(page.getByTestId('syncing')).toHaveCount(0, { timeout: 10_000 });
  await page.keyboard.press('m');
  // Reduced motion: the same.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`/p/${SHELL0}`);
  await expect(page.getByTestId('syncing')).toBeVisible();
  expect(await bandAnimation(page)).toBe('none');
  await expect(page.getByTestId('syncing')).toHaveCount(0, { timeout: 10_000 });
  await page.emulateMedia({ reducedMotion: null });
  await page.goto('/');
  await page.waitForTimeout(1500);
});

test('108 every move of the tiles is drawn, with the tiles named', async ({ page }, info) => {
  await watchMoves(page);
  await page.setViewportSize({ width: 1400, height: 900 });
  await signIn(page);
  await page.goto(`/p/${SHELL0},${RO},${LOGS}`);
  const tiles = page.getByTestId('tile');
  const tile = (a: string) => page.locator(`[data-testid="tile"][data-pane="${a}"]`);
  await expect(tiles).toHaveCount(3);
  await settled(page);
  const name = (a: string) => `mx-t-${a.replace(/[^a-zA-Z0-9]/g, '-')}`;
  // z: the focused tile is mx-zoom, the others named after their pane;
  // the zoomed tile switches off and tunes in, the others switch off.
  await page.keyboard.press('z');
  await expect(tiles).toHaveCount(1);
  await none(page);
  let m = await moves(page);
  expect(m.names).toHaveLength(1);
  expect([...m.names[0]].sort()).toEqual([name(RO), name(LOGS), 'mx-zoom'].sort());
  expect(m.errors).toEqual([]);
  expect(m.anims).toHaveLength(1);
  expect(m.anims[0]).toContain('mx-switch-off');
  expect(m.anims[0]).toContain('mx-tune-in');
  // Back: the one tile is mx-zoom; the others power on.
  await page.keyboard.press('z');
  await expect(tiles).toHaveCount(3);
  await none(page);
  m = await moves(page);
  expect(m.names).toHaveLength(2);
  expect(m.names[1]).toEqual(['mx-zoom']);
  expect(m.anims[1]).toContain('mx-power-on');
  expect(m.anims[1]).toContain('mx-tune-in');
  // l and =: every tile named, none mx-zoom, the retrace on the way.
  await page.keyboard.press('l');
  await none(page);
  m = await moves(page);
  expect(m.names).toHaveLength(3);
  expect([...m.names[2]].sort()).toEqual([name(SHELL0), name(RO), name(LOGS)].sort());
  expect(m.anims[2]).toContain('mx-resync');
  expect(m.anims[2]).not.toContain('mx-tune-in');
  await page.keyboard.press('=');
  await none(page);
  expect((await moves(page)).names).toHaveLength(4);
  // A header dropped on a tile's lower part, then on another's middle.
  const target = (await tile(SHELL0).boundingBox())!;
  await tile(LOGS)
    .locator('.mx-tile-head')
    .dragTo(tile(SHELL0), { targetPosition: { x: target.width / 2, y: target.height * 0.85 } });
  await expect(page.getByTestId('pane')).toHaveAttribute('data-layout', 'custom');
  await none(page);
  expect((await moves(page)).names).toHaveLength(5);
  await tile(RO).locator('.mx-tile-head').dragTo(tile(SHELL0));
  await expect(page.getByTestId('pane')).toHaveAttribute('data-panes', `${RO} ${SHELL0} ${LOGS}`);
  await none(page);
  expect((await moves(page)).names).toHaveLength(6);
  // Minimised and back.
  await page.keyboard.press('-');
  await expect(tiles).toHaveCount(2);
  await none(page);
  expect((await moves(page)).names).toHaveLength(7);
  await page.getByTestId('minimised-tab').click();
  await expect(tiles).toHaveCount(3);
  await none(page);
  expect((await moves(page)).names).toHaveLength(8);
  await shot(page, info, '108-moved');
  // Effects off: the same moves, nothing drawn, no name at any point.
  await page.keyboard.press('m');
  await page.keyboard.press('z');
  await expect(tiles).toHaveCount(1);
  expect(await page.locator('[data-moving]').count()).toBe(0);
  await page.keyboard.press('z');
  await expect(tiles).toHaveCount(3);
  await page.keyboard.press('l');
  await expect(page.getByTestId('pane')).toHaveAttribute('data-layout', /^(?!custom)/);
  expect((await moves(page)).names).toHaveLength(8);
  await none(page);
  await page.keyboard.press('m');
  await page.goto('/');
  await page.waitForTimeout(1500);
});

test('108 the window view: equal shares, the host layout, hide, bring back and ▦ are drawn', async ({
  page,
  request,
}) => {
  const id = await control(request, '/split', { target: 'work:1.0', dir: 'v' });
  const layout = () => control(request, '/layout', { target: 'work:1' });
  const shape = async () => ((await layout()).includes('{') ? 'row' : 'column');
  await watchMoves(page);
  await signIn(page);
  await expect(page.getByTestId('pane-row').filter({ hasText: `${HOST}/work/1.1` })).toBeVisible({
    timeout: 10_000,
  });
  await page.goto(`/w/${HOST}/work/1`);
  const cells = page.getByTestId('cell');
  await expect(cells).toHaveCount(2);
  await settled(page);
  const ids = await cells.evaluateAll((els) => els.map((el) => el.getAttribute('data-pane')!));
  const names = ids.map((i) => `mx-t-${i.replace(/[^a-zA-Z0-9]/g, '-')}`).sort();
  await page.keyboard.press('=');
  await none(page);
  let m = await moves(page);
  expect(m.names).toHaveLength(1);
  expect([...m.names[0]].sort()).toEqual(names);
  await page.keyboard.press('0');
  await none(page);
  expect((await moves(page)).names).toHaveLength(2);
  // x hides the focused cell (it switches off); its tab brings it back.
  await page.keyboard.press('x');
  await expect(cells).toHaveCount(1);
  await none(page);
  m = await moves(page);
  expect(m.names).toHaveLength(3);
  expect(m.anims[2]).toContain('mx-switch-off');
  await page.locator(`[data-testid="tab"][data-address="${LOGS}"]`).click();
  await expect(cells).toHaveCount(2);
  await none(page);
  m = await moves(page);
  expect(m.names).toHaveLength(4);
  expect(m.anims[3]).toContain('mx-power-on');
  // ▦ moves the panes on the host; the layout that comes back is drawn.
  await page.waitForTimeout(1100);
  expect(await shape()).toBe('column');
  await page.keyboard.press('l');
  await expect.poll(shape, { timeout: 8000 }).toBe('row');
  await expect(page.getByTestId('window')).toHaveAttribute('data-layout', await layout(), {
    timeout: 8000,
  });
  await expect.poll(async () => (await moves(page)).names.length, { timeout: 8000 }).toBe(5);
  await none(page);
  m = await moves(page);
  expect([...m.names[4]].sort()).toEqual(names);
  // The cells are the host's new layout once drawn: side by side.
  await expect
    .poll(async () => {
      const [a, b] = await Promise.all([cells.nth(0).boundingBox(), cells.nth(1).boundingBox()]);
      return a && b ? Math.abs(a.y - b.y) < 4 : false;
    })
    .toBe(true);
  await page.goto('/');
  await control(request, '/kill-pane', { target: id });
  await expect
    .poll(() => control(request, '/window-size', { target: 'work:1' }), { timeout: 8000 })
    .toBe('100x30');
});
