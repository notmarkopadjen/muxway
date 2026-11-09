import { expect, test, type Page } from '@playwright/test';
import { HOST, settled, shot, signIn } from './fixtures';

// A key's echo rides on the input's answer: the input asks for the screen
// (?read=1), the hub answers 200 with it, and the tile draws it the moment
// the answer is in, in the pane view and in the window view alike. The
// pane here runs the program that prints every byte it reads, so a typed
// x shows as b'x'.

const KEYS = !!process.env.MX_KEYS;
const SCREEN = '[data-testid="screen"], [data-testid="cell-screen"]';

// Types one character and returns the input's answer and how long the
// echo took to show after it, in ms.
async function echo(page: Page, ch: string) {
  const at = Date.now();
  const [res] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/input?read=1') && r.request().method() === 'POST',
    ),
    page.keyboard.press(ch),
  ]);
  const answered = Date.now();
  await expect(
    page
      .locator(SCREEN)
      .filter({ hasText: `b'${ch}'` })
      .first(),
  ).toBeVisible({
    timeout: 2000,
  });
  return {
    status: res.status(),
    body: (await res.json()) as { content?: string },
    lag: Date.now() - answered,
    total: Date.now() - at,
  };
}

test('126 pane view: the character is on the screen once the input is answered, from the answer itself', async ({
  page,
}, info) => {
  test.skip(!KEYS, 'needs the key echo pane');
  await signIn(page);
  await page
    .getByTestId('pane-row')
    .filter({ hasText: `${HOST}/work/0.0` })
    .first()
    .click();
  await page.getByTestId('pane').locator('.mx-tile-head[data-mode]').first().waitFor();
  await page.getByTestId('screen').click();
  await page.getByTestId('caret').waitFor();
  await settled(page);
  const reads: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'GET' && /\/v1\/panes\/[^?]+\?/.test(r.url())) reads.push(r.url());
  });
  const before = reads.length;
  const e = await echo(page, 'x');
  expect(e.status).toBe(200);
  expect(e.body.content).toContain("b'x'");
  // Drawn from the answer: no read of the pane was needed for it.
  expect(reads.length).toBe(before);
  expect(e.lag).toBeLessThan(150);
  await shot(page, info, '126-echo-pane');
  // The trailing read follows the burst, once.
  await expect.poll(() => reads.length, { timeout: 2000 }).toBe(before + 1);
});

test('126 window view: the character is in its cell once the input is answered, not at the next poll', async ({
  page,
}, info) => {
  test.skip(!KEYS, 'needs the key echo pane');
  await signIn(page);
  await page.goto(`/w/${HOST}/work/0`);
  await expect(page.getByTestId('window')).toBeVisible();
  await page.locator(SCREEN).first().click();
  await settled(page);
  const e = await echo(page, 'y');
  expect(e.status).toBe(200);
  expect(e.lag).toBeLessThan(150);
  await shot(page, info, '126-echo-window');
});

test('126 the echo under a 50 ms round trip: one round trip and a little, in both views', async ({
  page,
}, info) => {
  test.skip(!KEYS, 'needs the key echo pane');
  await signIn(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 50,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
  const run = async (view: 'pane' | 'window') => {
    if (view === 'pane') {
      await page.goto('/');
      await page
        .getByTestId('pane-row')
        .filter({ hasText: `${HOST}/work/0.0` })
        .first()
        .click();
      await page.getByTestId('pane').locator('.mx-tile-head[data-mode]').first().waitFor();
    } else {
      await page.goto(`/w/${HOST}/work/0`);
      await expect(page.getByTestId('window')).toBeVisible();
    }
    await page.locator(SCREEN).first().click();
    await settled(page);
    const totals: number[] = [];
    for (const ch of 'abcdefghijklmnopqrst') {
      totals.push((await echo(page, ch)).total);
      await page.waitForTimeout(60);
    }
    totals.sort((a, b) => a - b);
    const p90 = totals[Math.floor(totals.length * 0.9)];
    info.annotations.push({
      type: `echo ${view}`,
      description: `rtt=50ms keys=${totals.length} median=${totals[totals.length >> 1]}ms p90=${p90}ms`,
    });
    // Two round trips plus the settle were about 300 ms before; one round
    // trip and the host's moment are under half of that.
    expect(p90).toBeLessThan(250);
  };
  await run('pane');
  await run('window');
});
