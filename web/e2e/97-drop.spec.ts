import { expect, test, type Locator } from '@playwright/test';
import { HOST, settled, shot, signIn, SHELL0 } from './fixtures';

// Dragging a tile's header onto another tile: its middle swaps the two, an
// edge splits the tile's place that way, the dragged pane on that side,
// and its old place closes up with every share equal again.

const RO = `${HOST}/work/0.1`;
const LOGS = `${HOST}/work/1.0`;

const box = async (l: Locator) => (await l.boundingBox())!;

test('97 a header dropped on the lower part of a tile splits it; the middle swaps', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await signIn(page);
  await page.goto(`/p/${SHELL0},${RO},${LOGS}`);
  const tile = (a: string) => page.locator(`[data-testid="tile"][data-pane="${a}"]`);
  await expect(page.getByTestId('tile')).toHaveCount(3);
  await settled(page);
  await expect(page.getByTestId('pane')).toHaveAttribute('data-layout', 'row');
  const target = await box(tile(SHELL0));
  // Hover the lower part first: the half the pane will take lights up.
  await tile(LOGS)
    .locator('.mx-tile-head')
    .dragTo(tile(SHELL0), { targetPosition: { x: target.width / 2, y: target.height * 0.85 } });
  await expect(page.getByTestId('pane')).toHaveAttribute('data-layout', 'custom');
  await expect(page.getByTestId('tile')).toHaveCount(3);
  const a = await box(tile(SHELL0));
  const b = await box(tile(LOGS));
  const c = await box(tile(RO));
  // SHELL0 on top, LOGS below it in the same column, RO beside them.
  expect(Math.abs(a.x - b.x)).toBeLessThan(4);
  expect(b.y).toBeGreaterThan(a.y + a.height / 2);
  expect(Math.abs(a.height - b.height)).toBeLessThan(6);
  expect(c.x).toBeGreaterThan(a.x + a.width / 2);
  expect(Math.abs(a.width - c.width)).toBeLessThan(6);
  await shot(page, info, '97-drop');
  // The middle of a tile swaps, keeping the made layout.
  await tile(RO).locator('.mx-tile-head').dragTo(tile(SHELL0));
  await expect(page.getByTestId('pane')).toHaveAttribute('data-panes', `${RO} ${SHELL0} ${LOGS}`);
  await expect(page.getByTestId('pane')).toHaveAttribute('data-layout', 'custom');
  // Closing a tile keeps the rest of the made layout.
  await tile(SHELL0).getByTestId('close-tile').click();
  await expect(page.getByTestId('tile')).toHaveCount(2);
  await expect(page.getByTestId('pane')).toHaveAttribute('data-layout', 'custom');
  // ▦ goes back to the presets.
  await page.getByTestId('arrange').click();
  await expect(page.getByTestId('pane')).toHaveAttribute('data-layout', 'row');
});

test('97 a bookmarked board opens its panes as tiles, once', async ({ page }) => {
  await signIn(page);
  await page.evaluate(
    ([a, b]) =>
      localStorage.setItem(
        'mx-board:main',
        JSON.stringify({
          layout: {
            kind: 'h',
            children: [
              { kind: 'pane', id: a },
              { kind: 'pane', id: b },
            ],
            shares: [0.5, 0.5],
          },
        }),
      ),
    [SHELL0, LOGS],
  );
  await page.goto('/b/main');
  await expect(page).toHaveURL(new RegExp(`/p/${SHELL0},${LOGS}$`));
  await expect(page.getByTestId('tile')).toHaveCount(2);
  expect(await page.evaluate(() => localStorage.getItem('mx-board:main'))).toBeNull();
  await page.goto('/b/main');
  await expect(page.getByTestId('panes')).toBeVisible();
});
