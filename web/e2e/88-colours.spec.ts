import { expect, test, type Locator, type Page } from '@playwright/test';
import { control, HOST, settled, shot, signIn, SHELL0 } from './fixtures';

// A waiting pane is drawn in the theme's own ink, inverted, in every
// theme: no second hue, so no amber in the green theme.

const LOGS = `${HOST}/work/1.0`;

async function colour(page: Page, css: string) {
  return page.evaluate((c) => {
    const d = document.createElement('div');
    d.style.color = c;
    document.body.append(d);
    const out = getComputedStyle(d).color;
    d.remove();
    return out;
  }, css);
}

async function inverted(page: Page, el: Locator) {
  const ink = await colour(page, 'var(--mx-ink)');
  const bg = await colour(page, 'var(--mx-bg)');
  const got = await el.evaluate((e) => {
    const s = getComputedStyle(e);
    return { bg: s.backgroundColor, fg: s.color };
  });
  expect(got.bg).toBe(ink);
  expect(got.fg).toBe(bg);
}

test('88 a waiting tab and header are the theme ink, inverted, in every theme', async ({
  page,
  request,
}, info) => {
  await signIn(page);
  const pane = await control(request, '/pane-id', { target: 'work:0.0' });
  await control(request, '/notify', { pane, kind: 'question', text: 'which one?' });
  await page.goto(`/p/${SHELL0},${LOGS}`);
  await expect(page.getByTestId('tile')).toHaveCount(2);
  await settled(page);
  const tab = page.locator(`[data-testid="tab"][data-address="${SHELL0}"]`);
  const head = page.locator(`[data-pane="${SHELL0}"] .mx-tile-head`);
  await expect(tab).toHaveAttribute('data-state', 'waiting');
  for (const theme of ['green', 'amber', 'paper']) {
    await expect(page.locator('html')).toHaveAttribute(
      'data-theme',
      theme === 'green' ? /green|^$/ : theme,
    );
    await inverted(page, tab);
    await inverted(page, head);
    if (theme === 'green') {
      const amber = await colour(page, '#ffb000');
      expect(await tab.evaluate((e) => getComputedStyle(e).backgroundColor)).not.toBe(amber);
      await shot(page, info, '88-waiting-green');
    }
    await page.keyboard.press('t');
  }
  await control(request, '/notify', { pane, kind: 'working' });
});
