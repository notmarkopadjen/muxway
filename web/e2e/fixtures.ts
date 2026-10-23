import { expect, type APIRequestContext, type Page, type TestInfo } from '@playwright/test';
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

export async function shot(page: Page, info: TestInfo, name: string) {
  const dir = join(SCREENS, info.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase());
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, `${name}.png`), animations: 'disabled', caret: 'hide' });
}

export async function signIn(page: Page, token = TOKEN) {
  await page.goto('/signin');
  await page.getByTestId('token').fill(token);
  await page.getByTestId('token-submit').click();
  await expect(page.getByTestId('panes')).toBeVisible();
}

// Opens a pane and waits until the hub has said what it is: the input is
// disabled until the mode is known.
export async function openPane(page: Page, address: string) {
  await page.getByTestId('pane-row').filter({ hasText: address }).first().click();
  await paneLoaded(page);
}

export async function paneLoaded(page: Page) {
  await expect(page.getByTestId('pane')).toBeVisible();
  await expect(page.getByTestId('pane').locator('.mx-mode')).toBeVisible();
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
