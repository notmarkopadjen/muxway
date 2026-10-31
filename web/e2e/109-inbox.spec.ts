import { expect, test } from '@playwright/test';
import { control, HOST, SHELL0, shot, signIn } from './fixtures';

// The agents environment: three panes, the first two writable; the
// watcher on; a stand-in harness and questions with fixed answers.
test.skip(!process.env.MX_AGENTS, 'needs the agents environment');

const SHELL1 = `${HOST}/work/0.1`;
const SHELL2 = `${HOST}/work/0.2`;

test('109 the inbox lists what waits, oldest first; o opens the oldest', async ({
  page,
  request,
}, info) => {
  const pane1 = await control(request, '/pane-id', { target: 'work:0.1' });
  const pane2 = await control(request, '/pane-id', { target: 'work:0.2' });
  await control(request, '/notify', { pane: pane2, kind: 'done', text: 'tests green' });
  await page.waitForTimeout(1100);
  await control(request, '/notify', { pane: pane1, kind: 'permission', text: 'run make?' });
  await signIn(page);
  const count = page.getByTestId('inbox-count');
  await expect(count).toHaveText(/⚑ 2/, { timeout: 10_000 });
  await page.keyboard.press('I');
  const inbox = page.getByTestId('inbox');
  await expect(inbox).toBeVisible();
  const rows = page.getByTestId('inbox-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toHaveAttribute('data-address', SHELL2);
  await expect(rows.nth(0)).toContainText('done: tests green');
  await expect(rows.nth(1)).toHaveAttribute('data-address', SHELL1);
  await expect(rows.nth(1)).toContainText('permission: run make?');
  await shot(page, info, '109-inbox');
  // Enter opens the selected row's pane.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(inbox).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/p/${SHELL1.replace(/\//g, '\\/')}`));
  await expect(page.getByTestId('pane-attention')).toContainText('permission: run make?');
  // o, from anywhere, opens the oldest.
  await page.getByTestId('back').click();
  await expect(page.getByTestId('panes')).toBeVisible();
  await page.keyboard.press('o');
  await expect(page).toHaveURL(new RegExp(`/p/${SHELL2.replace(/\//g, '\\/')}`));
  // The count button opens the inbox too; Esc closes it.
  await count.click();
  await expect(inbox).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(inbox).toHaveCount(0);
  // Clear up: a working notice takes the attention away.
  await control(request, '/notify', { pane: pane1, kind: 'working', text: '' });
  await control(request, '/notify', { pane: pane2, kind: 'working', text: '' });
  await expect(count).toHaveCount(0, { timeout: 10_000 });
});

test('109 a question with fixed answers is answered with a click, from the toast, the pane or the inbox', async ({
  page,
  request,
}, info) => {
  await signIn(page);
  const pane0 = await control(request, '/pane-id', { target: 'work:0.0' });
  // From the toast.
  let id = await control(request, '/ask', {
    pane: pane0,
    text: 'deploy to staging?',
    choices: 'yes,no,later',
  });
  const toast = page.getByTestId('toast');
  await expect(toast).toContainText('deploy to staging?');
  const toastChoices = toast.getByTestId('toast-choices');
  await expect(toastChoices.getByRole('button')).toHaveCount(3);
  await shot(page, info, '109-choices-toast');
  await toastChoices.getByRole('button', { name: 'later' }).click();
  await expect
    .poll(() => control(request, '/ask-result', { id }), { timeout: 10_000 })
    .toBe('0 later');
  // From the pane's header.
  id = await control(request, '/ask', { pane: pane0, text: 'merge it?', choices: 'yes,no' });
  await page.getByTestId('pane-row').filter({ hasText: SHELL0 }).click();
  await expect(page.getByTestId('pane-attention')).toContainText('question: merge it?');
  const choices = page.getByTestId('choices');
  await expect(choices.getByRole('button')).toHaveCount(2);
  await shot(page, info, '109-choices-pane');
  await choices.getByRole('button', { name: 'yes' }).click();
  await expect
    .poll(() => control(request, '/ask-result', { id }), { timeout: 10_000 })
    .toBe('0 yes');
  await expect(page.getByTestId('pane-attention')).toHaveCount(0);
  // From the inbox.
  id = await control(request, '/ask', {
    pane: pane0,
    text: 'which one?',
    choices: 'PostgreSQL,SQLite',
  });
  await expect(page.getByTestId('pane-attention')).toContainText('which one?');
  await page.keyboard.press('I');
  const row = page.getByTestId('inbox-row').first();
  await expect(row).toContainText('which one?');
  await row.getByRole('button', { name: 'SQLite' }).click();
  await expect
    .poll(() => control(request, '/ask-result', { id }), { timeout: 10_000 })
    .toBe('0 SQLite');
  await expect(page.getByTestId('inbox-row')).toHaveCount(0);
  await page.keyboard.press('Escape');
  // A read-only pane's choices are disabled.
  const pane2 = await control(request, '/pane-id', { target: 'work:0.2' });
  await control(request, '/notify', { pane: pane2, kind: 'question', text: 'read-only question' });
  await page.keyboard.press('I');
  await expect(page.getByTestId('inbox-row').first()).toContainText('read-only question');
  await expect(page.getByTestId('inbox-row').first().getByRole('button')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await control(request, '/notify', { pane: pane2, kind: 'working', text: '' });
});

test('109 the lens shows another harness working and the watcher says so', async ({
  page,
  request,
}, info) => {
  await signIn(page);
  const row = page.getByTestId('pane-row').filter({ hasText: `${HOST}/work/0.1` });
  await control(request, '/fake-harness', { target: 'work:0.1', name: 'codex' });
  await expect(row.getByTestId('pane-title')).toHaveAttribute('data-agent', 'codex', {
    timeout: 10_000,
  });
  await expect(row).toContainText('Codex');
  // The watcher sees the screen move and the hub says working.
  await expect(row).toHaveAttribute('data-state', 'working', { timeout: 15_000 });
  await shot(page, info, '109-lens-codex');
  await control(request, '/key', { target: 'work:0.1', key: 'C-c' });
  await expect(row.getByTestId('pane-title')).not.toHaveAttribute('data-agent', 'codex', {
    timeout: 10_000,
  });
});
