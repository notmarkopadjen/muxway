import {
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export const HOST = process.env.MX_HOST ?? 'alice-laptop';
export const SHELL0 = `${HOST}/work/0.0`;
export const TOKEN = process.env.MX_TOKEN ?? '';
export const RO_TOKEN = process.env.MX_RO_TOKEN ?? '';
const CONTROL = process.env.MX_CONTROL ?? '';
const SCREENS = process.env.MX_SCREENS ?? 'screens';

export async function control(
  request: APIRequestContext,
  path: string,
  params: Record<string, string>,
) {
  const q = new URLSearchParams(params).toString();
  const r = await request.get(`${CONTROL}${path}?${q}`);
  return (await r.text()).trim();
}

// Gives a pane's window back to tmux. A spec that asserts a window's own
// size and layout starts with this: a page Playwright closes without
// navigating away first sends no release, so the window keeps the size
// the spec before it gave. Answers 404 for a window nobody sized, which
// is the state it asks for anyway.
export async function releaseWindow(request: APIRequestContext, address: string) {
  await request.post(`/v1/panes/${address}/resize`, {
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    data: { fit: 'auto' },
  });
}

// Puts the windows a spec sized back as the next spec expects to find
// them. Leaving a view hands nothing back — a window keeps the size it
// was given — so a spec that moved `work:0` or `work:1` says so here.
export async function atRest(request: APIRequestContext, ...targets: string[]) {
  for (const t of targets) await releaseWindow(request, `${HOST}/work/${t.split(':')[1]}.0`);
  for (const t of targets)
    await expect
      .poll(() => control(request, '/window-size', { target: t }), { timeout: 10_000 })
      .toBe('100x30');
}

export async function shot(page: Page, info: TestInfo, name: string) {
  const dir = join(SCREENS, info.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase());
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, `${name}.png`), animations: 'disabled', caret: 'hide' });
}

// The CRT powers on with a transform; a click during it lands on a
// squashed page. Interact once the animations have run.
export async function settled(page: Page) {
  await page
    .locator('.mx-crt')
    .evaluate((el) =>
      Promise.all(el.getAnimations().map((a) => a.finished.catch(() => undefined))),
    );
}

export async function signIn(page: Page, token = TOKEN) {
  await page.goto('/signin');
  await settled(page);
  await page.getByTestId('token').fill(token);
  await page.getByTestId('token-submit').click();
  await expect(page.getByTestId('panes')).toBeVisible({ timeout: 10_000 });
}

// Opens a pane and waits until the hub has said what it is: the input is
// disabled until the mode is known.
export async function openPane(page: Page, address: string) {
  await page.getByTestId('pane-row').filter({ hasText: address }).first().click();
  await paneLoaded(page);
}

export async function paneLoaded(page: Page) {
  await expect(page.getByTestId('pane')).toBeVisible();
  await expect(page.getByTestId('pane').locator('.mx-tile-head[data-mode]').first()).toBeVisible();
}

// Collects every CSP violation and alert the page sees.
export async function watchPage(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __csp: string[]; __alerts: number };
    w.__csp = [];
    w.__alerts = 0;
    document.addEventListener('securitypolicyviolation', (e) =>
      w.__csp.push(e.violatedDirective + ' ' + e.blockedURI),
    );
    window.alert = () => {
      w.__alerts++;
    };
  });
}
export async function violations(page: Page) {
  return page.evaluate(() => (window as unknown as { __csp: string[]; __alerts: number }).__csp);
}
export async function alerts(page: Page) {
  return page.evaluate(() => (window as unknown as { __csp: string[]; __alerts: number }).__alerts);
}

// Opens the profile menu and picks an item: hubs, help, admin, logout.
export async function profile(
  page: Page,
  item: 'open-hubs' | 'open-help' | 'open-admin' | 'logout',
) {
  await page.getByTestId('who').click();
  await page.getByTestId(item).click();
}

// A window over the page powers on; wait for that before measuring it.
export async function opened(target: Locator) {
  await expect(target).toBeVisible();
  await target.evaluate((el) =>
    Promise.all(
      [el, ...el.querySelectorAll('*')]
        .flatMap((e) => e.getAnimations())
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
}
