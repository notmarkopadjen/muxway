import { expect, test, type Page } from '@playwright/test';
import { settled, shot, signIn, TOKEN } from './fixtures';

// Several hubs: the browser keeps other hubs as links, each hub signs the
// person in on its own page, and nothing but names and addresses is
// carried from one to the other. The second hub is the harness's, reached
// as localhost so its cookie is its own.

const HUB2 = (process.env.MX_HUB2 ?? '').replace(/\/$/, '');
const HUB2_TOKEN = process.env.MX_HUB2_TOKEN ?? '';
const WORK = 'https://work.example.com';

const stored = (page: Page) => page.evaluate(() => localStorage.getItem('mx-hubs') ?? '');

async function openHubs(page: Page) {
  if (await page.getByTestId('who').isVisible()) await page.getByTestId('who').click();
  await page.getByTestId('open-hubs').click();
  await expect(page.getByTestId('hubs')).toBeVisible();
}

async function addHub(page: Page, name: string, url: string) {
  await page.getByTestId('hub-add-name').fill(name);
  await page.getByTestId('hub-add-url').fill(url);
  await page.getByTestId('hub-add').click();
}

test('94 security: a hub address must be an https origin; nothing else is stored', async ({
  page,
}) => {
  await signIn(page);
  await openHubs(page);
  for (const url of [
    'javascript:alert(1)',
    'data:text/html,hi',
    'http://work.example.com',
    `${WORK}/panes`,
    `${WORK}/?x=1`,
    'https://alice:pw@work.example.com',
    'work.example.com',
  ]) {
    await addHub(page, 'bad', url);
    await expect(page.getByTestId('hub-error'), url).toContainText('url');
  }
  await addHub(page, 'Bad Name', WORK);
  await expect(page.getByTestId('hub-error')).toContainText('name');
  await expect(page.getByTestId('hub-row')).toHaveCount(1);
  const raw = await stored(page);
  expect(raw).not.toContain('bad');
  expect(raw).not.toContain('javascript');
  expect(raw).not.toContain('work.example.com');
});

test('94 security: a carried list is held apart until a signed-in person adds it', async ({
  page,
}) => {
  const carried = encodeURIComponent(
    JSON.stringify([
      { name: 'work', url: WORK },
      { name: 'evil', url: 'javascript:alert(1)' },
      { name: 'plain', url: 'http://work.example.com' },
      { name: 'Bad Name', url: 'https://lab.example.com' },
    ]),
  );
  await page.goto('/#hubs=' + carried);
  await expect(page).toHaveURL(/\/signin$/);
  expect(page.url()).not.toContain('#');
  await settled(page);
  // Before sign-in: nothing stored, nothing a link, only a count.
  await openHubs(page);
  await expect(page.getByTestId('hub-row')).toHaveCount(1);
  await expect(page.getByTestId('hub-go')).toHaveCount(0);
  await expect(page.getByTestId('hub-pending-list')).toContainText('1 carried');
  await expect(page.getByTestId('hub-pending')).toHaveCount(0);
  await expect(page.getByTestId('hubs')).not.toContainText('evil');
  await expect(page.getByTestId('hubs')).not.toContainText('plain');
  await expect(page.getByTestId('hubs')).not.toContainText('lab.example.com');
  expect(await stored(page)).not.toContain('work.example.com');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('hubs')).toHaveCount(0);
  await page.getByTestId('token').fill(TOKEN);
  await page.getByTestId('token-submit').click();
  await expect(page.getByTestId('panes')).toBeVisible({ timeout: 10_000 });
  // Signed in: the entry is offered, still not a link, until it is added.
  await openHubs(page);
  await expect(page.getByTestId('hub-pending')).toHaveCount(1);
  await expect(page.getByTestId('hub-pending')).toContainText('work');
  await expect(page.getByTestId('hub-row')).toHaveCount(1);
  await expect(page.getByTestId('hub-go')).toHaveCount(0);
  expect(await stored(page)).not.toContain('work.example.com');
  await page.getByTestId('hub-pending-add').click();
  await expect(page.getByTestId('hub-pending-list')).toHaveCount(0);
  await expect(page.getByTestId('hub-row')).toHaveCount(2);
  await expect(page.getByTestId('hub-row').nth(1)).toContainText('work');
  const raw = await stored(page);
  expect(raw).toContain(WORK);
  expect(raw).not.toContain('javascript');
  expect(raw).not.toContain('http://');
  expect(raw).not.toContain('lab.example.com');
});

test('94 security: an ignored carried entry leaves nothing behind', async ({ page }) => {
  await signIn(page);
  await page.goto('/#hubs=' + encodeURIComponent(JSON.stringify([{ name: 'work', url: WORK }])));
  await expect(page.getByTestId('panes')).toBeVisible();
  expect(page.url()).not.toContain('#');
  await openHubs(page);
  await expect(page.getByTestId('hub-pending')).toHaveCount(1);
  await page.getByTestId('hub-pending-ignore').click();
  await expect(page.getByTestId('hub-pending-list')).toHaveCount(0);
  await expect(page.getByTestId('hub-row')).toHaveCount(1);
  expect(await stored(page)).not.toContain('work.example.com');
  expect(await page.evaluate(() => sessionStorage.getItem('mx-hubs-carried'))).toBeNull();
});

test('94 security: going to another hub carries no cookie and no referrer', async ({ page }) => {
  test.skip(!HUB2, 'no second hub in this environment');
  await signIn(page);
  await openHubs(page);
  await addHub(page, 'work', HUB2);
  await expect(page.getByTestId('hub-go')).toHaveAttribute('href', new RegExp(`^${HUB2}/#hubs=`));
  const [req] = await Promise.all([
    page.waitForRequest((r) => r.url().startsWith(HUB2 + '/')),
    page.getByTestId('hub-go').click(),
  ]);
  const headers = await req.allHeaders();
  expect(headers['cookie']).toBeUndefined();
  expect(headers['referer']).toBeUndefined();
  await expect(page).toHaveURL(`${HUB2}/signin`);
  expect(page.url()).not.toContain('#');
  // The first hub's session is the first hub's alone.
  const there = await page.context().cookies(HUB2);
  expect(there.find((c) => c.name === 'muxway_session')).toBeUndefined();
  await expect(page.getByTestId('signin')).toBeVisible();
});

test('94 two hubs: go, sign in there, come back; each page keeps its own session', async ({
  page,
}, info) => {
  test.skip(!HUB2, 'no second hub in this environment');
  await signIn(page);
  await settled(page);
  await expect(page.getByTestId('hub-here')).toHaveCount(0);
  await page.keyboard.press('H');
  await expect(page.getByTestId('hubs')).toBeVisible();
  await page.getByTestId('hub-name').first().click();
  await page.getByTestId('hub-rename').fill('home');
  await page.getByTestId('hub-rename').press('Enter');
  await addHub(page, 'work', HUB2);
  await expect(page.getByTestId('hub-row')).toHaveCount(2);
  await expect(page.getByTestId('hub-here')).toHaveText('home');
  await shot(page, info, '94-hubs');
  await page.getByTestId('hub-go').click();
  await expect(page).toHaveURL(`${HUB2}/signin`);
  await settled(page);
  await page.getByTestId('token').fill(HUB2_TOKEN);
  await page.getByTestId('token-submit').click();
  await expect(page.getByTestId('panes')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('who')).toContainText('work-browser');
  // The carried list waits there until it is taken: this hub's own name
  // and the link back.
  await openHubs(page);
  await expect(page.getByTestId('hub-pending')).toHaveCount(2);
  await expect(page.getByTestId('hub-pending').nth(0)).toContainText('work');
  await expect(page.getByTestId('hub-pending').nth(1)).toContainText('home');
  await page.getByTestId('hub-pending-add').first().click();
  await page.getByTestId('hub-pending-add').click();
  const rows = page.getByTestId('hub-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('work');
  await expect(rows.nth(0)).toContainText('here');
  await expect(rows.nth(1)).toContainText('home');
  await expect(page.getByTestId('hub-here')).toHaveText('work');
  await page.getByTestId('hub-go').click();
  await expect(page.getByTestId('panes')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('who')).toContainText('browser');
  expect(page.url()).not.toContain('#');
  await expect(page.getByTestId('hub-here')).toHaveText('home');
  const a = await page.context().cookies(page.url());
  const b = await page.context().cookies(HUB2);
  const sa = a.find((c) => c.name === 'muxway_session');
  const sb = b.find((c) => c.name === 'muxway_session');
  expect(sa).toBeDefined();
  expect(sb).toBeDefined();
  expect(sa?.value).not.toBe(sb?.value);
});

test('94 rename and remove follow in the list', async ({ page }) => {
  await signIn(page);
  await settled(page);
  await page.keyboard.press('H');
  await expect(page.getByTestId('hubs')).toBeVisible();
  await addHub(page, 'work', WORK + '/');
  await expect(page.getByTestId('hub-row').nth(1)).toContainText(WORK);
  await expect(page.getByTestId('hub-go')).toHaveAttribute('href', new RegExp(`^${WORK}/`));
  await page.getByTestId('hub-name').nth(1).click();
  await page.getByTestId('hub-rename').fill('office');
  await page.getByTestId('hub-rename').press('Enter');
  await expect(page.getByTestId('hub-row').nth(1)).toContainText('office');
  expect(await stored(page)).toContain('"office"');
  await page.getByTestId('hub-remove').click();
  await expect(page.getByTestId('hub-row')).toHaveCount(1);
  await expect(page.getByTestId('hub-go')).toHaveCount(0);
  expect(await stored(page)).not.toContain('work.example.com');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('hubs')).toHaveCount(0);
});
