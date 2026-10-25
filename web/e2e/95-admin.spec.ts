import { expect, test } from '@playwright/test';
import { HOST, RO_TOKEN, settled, shot, signIn, profile } from './fixtures';

// The admin page: only an admin principal sees it; the log tails live,
// a created token's secret is shown once, and the address lists refuse to
// shut out the person saving them.

const ADMIN = process.env.MX_ADMIN_TOKEN ?? '';

async function signInAdmin(page: import('@playwright/test').Page) {
  await signIn(page, ADMIN);
  await profile(page, 'open-admin');
  await expect(page.getByTestId('admin')).toBeVisible();
  await settled(page);
}

test('95 security: no admin entry and nothing to see without the flag', async ({ page }) => {
  await signIn(page);
  await page.getByTestId('who').click();
  await expect(page.getByTestId('profile-menu')).toBeVisible();
  await expect(page.getByTestId('open-admin')).toHaveCount(0);
  await page.goto('/admin');
  await expect(page.getByTestId('admin-refused')).toHaveText('not yours to see.');
  await expect(page.getByTestId('admin-log')).toHaveCount(0);
});

test('95 the admin page: four boxes, a refusal in the alert colour', async ({ page, request }) => {
  await signInAdmin(page);
  for (const box of ['admin-log', 'admin-tokens', 'admin-clients', 'admin-access'])
    await expect(page.getByTestId(box)).toBeVisible();
  await expect(page.getByTestId('agent-row').filter({ hasText: HOST })).toContainText('●');
  // A non-admin token knocking on the admin API is a warning, live in the log.
  const r = await request.get('/v1/admin/overview', {
    headers: { Authorization: `Bearer ${RO_TOKEN}` },
  });
  expect(r.status()).toBe(403);
  const refused = page.getByTestId('log-line').filter({ hasText: 'admin refused' }).last();
  await expect(refused).toBeVisible({ timeout: 5000 });
  await expect(refused).toHaveAttribute('data-level', 'WARN');
  await expect(refused).toHaveClass(/mx-bad/);
  const color = await refused.evaluate((el) => getComputedStyle(el).color);
  const bad = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--mx-bad').trim(),
  );
  const probe = await page.evaluate((c) => {
    const d = document.createElement('div');
    d.style.color = c;
    document.body.append(d);
    const out = getComputedStyle(d).color;
    d.remove();
    return out;
  }, bad);
  expect(color).toBe(probe);
  await page.getByTestId('log-filter').fill('admin refused');
  await expect(page.getByTestId('log-line').first()).toContainText('admin refused');
  await page.getByTestId('log-filter').fill('');
  await shot(page, test.info(), '95-admin');

  // On a tall window the boxes under the log reach down to the status line, level.
  await page.setViewportSize({ width: 1400, height: 1400 });
  await expect
    .poll(async () => {
      const main = await page.locator('main').boundingBox();
      const bottoms = await Promise.all(
        ['admin-tokens', 'admin-clients', 'admin-access'].map(async (id) => {
          const b = await page.getByTestId(id).boundingBox();
          return Math.round((b?.y ?? 0) + (b?.height ?? 0));
        }),
      );
      const end = Math.round((main?.y ?? 0) + (main?.height ?? 0));
      return new Set(bottoms).size === 1 && end - bottoms[0] <= 24;
    })
    .toBe(true);
  await shot(page, test.info(), '95-admin-tall');
  // At any of these sizes the page fits the window, however many tokens
  // there are: the boxes scroll inside, the page does not.
  const auth = { Authorization: `Bearer ${ADMIN}` };
  const made: string[] = [];
  for (let i = 0; i < 12; i++) {
    const r = await request.post('/v1/admin/tokens', {
      headers: auth,
      data: { name: `filler-${i}`, read: [`${HOST}/*`], ttl: 600 },
    });
    made.push(((await r.json()) as { token: { id: string } }).token.id);
  }
  await expect(page.getByTestId('token-row').filter({ hasText: 'filler-' })).toHaveCount(12, {
    timeout: 8000,
  });
  for (const [width, height] of [
    [1400, 1400],
    [1200, 800],
    [1710, 985],
  ]) {
    await page.setViewportSize({ width, height });
    await expect
      .poll(() => page.locator('main').evaluate((m) => m.scrollHeight - m.clientHeight))
      .toBeLessThanOrEqual(0);
  }
  await expect(page.getByTestId('admin-tokens').locator('.mx-box-title')).toBeVisible();
  for (const id of made) await request.delete(`/v1/admin/tokens/${id}`, { headers: auth });
});

test('95 a created token is shown once, copies, and revokes', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await signInAdmin(page);
  await page.getByTestId('token-name').fill('phone');
  await page.getByTestId('token-read').fill(`${HOST}/*`);
  await page.getByTestId('token-write').fill(`${HOST}/work/*`);
  await page.getByTestId('token-ttl').selectOption({ label: '1 day' });
  await page.getByTestId('token-create').click();
  const secret = page.getByTestId('token-secret');
  await expect(secret).toContainText('shown only now');
  const value = (await page.getByTestId('token-secret-value').textContent()) ?? '';
  expect(value).toMatch(/^mxt_/);
  await page.getByTestId('token-copy').click();
  await expect(page.getByTestId('token-copy')).toHaveText('copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(value);
  await shot(page, test.info(), '95-token-once');
  await page.getByTestId('token-secret-done').click();
  await expect(secret).toHaveCount(0);
  expect(await page.content()).not.toContain(value);
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(stored).not.toContain(value);

  const row = page.getByTestId('token-row').filter({ hasText: 'phone' });
  await expect(row).toHaveCount(1);
  await row.getByTestId('token-revoke').click();
  await row.getByTestId('token-revoke-yes').click();
  await expect(page.getByTestId('token-row').filter({ hasText: 'phone' })).toHaveCount(0);

  await page.getByTestId('token-name').fill('broken');
  await page.getByTestId('token-read').fill('a/b/c/d');
  await page.getByTestId('token-create').click();
  await expect(page.getByTestId('token-error')).toBeVisible();
});

test('95 deny from a log row: saved, and refused when it is our own address', async ({ page }) => {
  await signInAdmin(page);
  // Our own sign-in is in the log with our address.
  const own = page.getByTestId('log-line').filter({ hasText: 'signed in' }).last();
  await own.getByTestId('log-deny').click();
  const deny = page.getByTestId('access-deny');
  await expect(deny).not.toHaveValue('');
  await page.getByTestId('access-save').click();
  await expect(page.getByTestId('access-lockout')).toContainText('shut you out');
  await page.getByRole('button', { name: 'undo' }).click();
  await expect(page.getByTestId('access-lockout')).toHaveCount(0);

  await deny.fill('203.0.113.0/24\n198.51.100.7');
  await page.getByTestId('access-save').click();
  await expect(deny).toHaveValue('203.0.113.0/24\n198.51.100.7/32');
  await deny.fill('not-an-address');
  await page.getByTestId('access-save').click();
  await expect(page.getByTestId('access-error')).toBeVisible();
  // Leave the hub as the other specs expect it.
  await deny.fill('');
  await page.getByTestId('access-save').click();
  await expect(deny).toHaveValue('');
  await expect(page.getByTestId('admin')).toBeVisible();
});
