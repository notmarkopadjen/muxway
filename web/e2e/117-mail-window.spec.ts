import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  alerts,
  control,
  HOST,
  openPane,
  SHELL0,
  shot,
  signIn,
  TOKEN,
  watchPage,
} from './fixtures';
import { closeMade, otherPane } from './talk';

// The mail window: a pane's mail in full, what it sent, a line that mails
// it or mails back. Opened by the envelope on a tab, a header or a row, by
// a mail row in the messages window, and by M. Nothing is typed, and
// reading here takes no mail from the process.
test.skip(!process.env.MX_AGENTS, 'needs the agents environment');

test.afterEach(async ({ request }) => closeMade(request));

const auth = { Authorization: `Bearer ${TOKEN}` };
const HOSTILE = '<img src=x onerror=alert(1)> and <a href="javascript:alert(1)">go</a> mailcanary9';
const LONG = `line one\n\tline two, tabbed\n${'word '.repeat(300)}end`;

async function mail(request: APIRequestContext, to: string, text: string, fromPane?: string) {
  const r = await request.post(`/v1/panes/${to}/mail`, {
    headers: auth,
    data: fromPane ? { text, from: { host: HOST, pane_id: fromPane } } : { text },
  });
  expect(r.status()).toBe(201);
}

test('117 the envelope opens the mail window: whole texts as written, unread until the process reads, mail back, the sent row, M, L', async ({
  page,
  request,
}, info) => {
  await watchPage(page);
  const pane0 = await control(request, '/pane-id', { target: 'work:0.0' });
  const other = await otherPane(request);
  await signIn(page);
  await openPane(page, SHELL0);
  await mail(request, SHELL0, HOSTILE, other.id);
  await mail(request, SHELL0, LONG, other.id);
  const tile = page.getByTestId('tile');
  await expect(tile.getByTestId('mail-mark')).toContainText('2', { timeout: 10_000 });
  // The header's envelope opens the window: both mails, whole, unread.
  await tile.getByTestId('mail-mark').click();
  const win = page.getByTestId('mail-window');
  await expect(win).toBeVisible();
  // Earlier specs' mail stays in the mailbox for a day: the rows of this
  // one are found by their texts.
  const rows = win.getByTestId('mail-row');
  const hostile = rows.filter({ hasText: 'mailcanary9' });
  const long = rows.filter({ hasText: 'line two, tabbed' });
  await expect(hostile).toHaveCount(1);
  await expect(long).toHaveCount(1);
  await expect(hostile).toHaveAttribute('data-dir', 'in');
  await expect(hostile).toHaveAttribute('data-from', other.address);
  await expect(hostile).toHaveAttribute('data-unread', '');
  await expect(hostile.locator('.mx-mail-text')).toHaveText(HOSTILE);
  expect(await hostile.locator('img, a').count()).toBe(0);
  expect(await alerts(page)).toBe(0);
  await expect(long.locator('.mx-mail-text')).toContainText('end');
  await expect(long).toHaveAttribute('data-unread', '');
  // Nothing scrolls sideways: the long text wraps inside the box.
  const box = win.locator('.mx-mail-box');
  const widths = await box.evaluate((el) => [el.scrollWidth, el.clientWidth]);
  expect(widths[0]).toBeLessThanOrEqual(widths[1] + 1);
  await shot(page, info, '117-mail-window');
  // The line mails the pane by default; mail back turns it to the sender.
  const to = win.getByTestId('mail-to');
  await expect(to).toHaveValue(SHELL0);
  await hostile.getByTestId('mail-back').click();
  await expect(to).toHaveValue(other.address);
  await expect(win.getByTestId('mail-text')).toBeFocused();
  await page.keyboard.type('thanks, on it');
  await page.keyboard.press('Enter');
  await expect(win.getByTestId('mail-text')).toHaveValue('');
  // The sent mail appears as a row of its own, whole, since the token
  // reads the other pane; the other pane's process reads it.
  const out = win
    .locator('[data-testid="mail-row"][data-dir="out"]')
    .filter({ hasText: 'thanks, on it' });
  await expect(out).toHaveCount(1, { timeout: 10_000 });
  await expect(out).toHaveAttribute('data-to', other.address);
  await expect(out.locator('.mx-mail-text')).toHaveText('thanks, on it');
  await expect(out).toHaveAttribute('data-unread', '');
  await shot(page, info, '117-mail-back');
  const theirs = await control(request, '/mail', { pane: other.id });
  expect(theirs).toContain('thanks, on it');
  await expect(out).not.toHaveAttribute('data-unread', '', { timeout: 10_000 });
  // The owner reading took nothing from the process: the count stands
  // until the process reads, then the rows say read.
  await expect(tile.getByTestId('mail-mark')).toContainText('2');
  const read = await control(request, '/mail', { pane: pane0 });
  expect(read).toContain('mailcanary9');
  await expect(hostile).not.toHaveAttribute('data-unread', '', { timeout: 10_000 });
  await expect(long).not.toHaveAttribute('data-unread', '', { timeout: 10_000 });
  await expect(tile.getByTestId('mail-mark')).toHaveCount(0, { timeout: 10_000 });
  // The screens have none of it.
  expect(await control(request, '/capture', { target: 'work:0.0' })).not.toContain('mailcanary9');
  await page.keyboard.press('Escape');
  await expect(win).toHaveCount(0);
  // M opens it on the open pane with the line focused and aimed at it.
  await page.keyboard.press('M');
  await expect(win).toBeVisible();
  await expect(win.getByTestId('mail-text')).toBeFocused();
  await expect(win.getByTestId('mail-to')).toHaveValue(SHELL0);
  // L lays the pane beside its latest partner.
  await win.getByTestId('mail-text').blur();
  await page.keyboard.press('L');
  await expect(win).toHaveCount(0);
  await expect(page.getByTestId('pane')).toHaveAttribute(
    'data-panes',
    `${SHELL0} ${other.address}`,
  );
});

test('117 the messages window reads: two-line rows in a wide box, a click on a mail row opens that mail, ⇆ and Enter lay the panes beside', async ({
  page,
  request,
}, info) => {
  const other = await otherPane(request);
  await signIn(page);
  await openPane(page, SHELL0);
  await mail(
    request,
    SHELL0,
    'a first line of a longer message that the narrow box used to cut: ' + 'x'.repeat(120),
    other.id,
  );
  await page.keyboard.press('T');
  const talk = page.getByTestId('talk');
  await expect(talk).toBeVisible();
  const box = talk.locator('.mx-talk-box');
  const width = await box.evaluate((el) => el.getBoundingClientRect().width);
  expect(width).toBeGreaterThan(900);
  const row = page.getByTestId('talk-row').last();
  await expect(row).toHaveAttribute('data-kind', 'mail');
  await expect(row.locator('.mx-talk-text')).toContainText('a first line of a longer message');
  const heights = await row.evaluate((el) => {
    const who = el.querySelector('.mx-talk-who')!.getBoundingClientRect();
    const text = el.querySelector('.mx-talk-text')!.getBoundingClientRect();
    return [who.top, text.top];
  });
  expect(heights[1]).toBeGreaterThan(heights[0]);
  await shot(page, info, '117-messages-wide');
  // A click on the mail row opens the mail window with that mail framed.
  await row.locator('.mx-talk-text').click();
  const win = page.getByTestId('mail-window');
  await expect(win).toBeVisible();
  await expect(win.locator('[data-testid="mail-row"][data-focused]')).toHaveCount(1);
  await expect(win.locator('[data-testid="mail-row"][data-focused] .mx-mail-text')).toContainText(
    'a first line of a longer message',
  );
  await page.keyboard.press('Escape');
  await expect(win).toHaveCount(0);
  // ⇆ lays both panes side by side.
  await page.keyboard.press('T');
  await expect(talk).toBeVisible();
  await page.getByTestId('talk-row').last().getByTestId('talk-beside').click();
  await expect(talk).toHaveCount(0);
  await expect(page.getByTestId('pane')).toHaveAttribute(
    'data-panes',
    `${other.address} ${SHELL0}`,
  );
});
