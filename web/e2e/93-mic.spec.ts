import { expect, test, type Page } from '@playwright/test';
import {
  control,
  HOST,
  openPane,
  RO_TOKEN,
  SHELL0,
  shot,
  signIn,
  violations,
  watchPage,
} from './fixtures';

// The microphone: ◉ on the input line records a clip for the hub's
// transcriber and the words land on the line, to be read before Enter. The
// main environment's hub has no transcriber, so only the first test runs
// there; the rest run in the environment that has one (MX_STT), where the
// microphone is Chromium's fake device and the transcriber answers a fixed
// sentence. One clip per five seconds is the hub's rule, so a test that
// sends a clip after another waits it out.

const STT = !!process.env.MX_STT;
const HEARD = 'run the tests again';

function watch(page: Page) {
  const n = { probes: 0, clips: 0, inputs: [] as string[] };
  page.on('request', (r) => {
    const u = r.url();
    if (u.endsWith('/v1/transcribe')) {
      if (r.method() === 'GET') n.probes++;
      else n.clips++;
    } else if (u.includes('/input')) n.inputs.push(r.postData() ?? '');
  });
  return n;
}

async function calls(request: Parameters<typeof control>[0]) {
  return Number(await control(request, '/stt', {}));
}

test('93 security: a hub without a transcriber shows no button and is asked once', async ({
  page,
}) => {
  test.skip(STT, 'the main environment has no transcriber');
  const n = watch(page);
  await signIn(page);
  await openPane(page, SHELL0);
  await expect(page.getByTestId('input')).toBeEnabled();
  await expect(page.getByTestId('mic')).toHaveCount(0);
  await page.keyboard.press('v');
  await expect(page.getByTestId('mic-line')).toHaveCount(0);
  await page.getByTestId('back').click();
  await openPane(page, `${HOST}/work/0.1`);
  await expect(page.getByTestId('mic')).toHaveCount(0);
  expect(n.probes).toBe(1);
  expect(n.clips).toBe(0);
});

test('93 security: no button on a read-only pane, and none for a read-only token', async ({
  page,
  browser,
}) => {
  test.skip(!STT, 'needs the transcriber environment');
  await signIn(page);
  await openPane(page, SHELL0);
  await expect(page.getByTestId('mic')).toBeVisible();
  await page.getByTestId('back').click();
  await openPane(page, `${HOST}/work/0.1`);
  await expect(page.getByTestId('readonly')).toBeVisible();
  await expect(page.getByTestId('mic')).toHaveCount(0);
  await page.keyboard.press('v');
  await expect(page.getByTestId('mic-line')).toHaveCount(0);
  const other = await browser.newContext({ ignoreHTTPSErrors: true, baseURL: page.url() });
  const viewer = await other.newPage();
  const n = watch(viewer);
  await signIn(viewer, RO_TOKEN);
  await openPane(viewer, `${HOST}/work/0.1`);
  await expect(viewer.getByTestId('readonly')).toBeVisible();
  await expect(viewer.getByTestId('mic')).toHaveCount(0);
  await viewer.keyboard.press('v');
  await expect(viewer.getByTestId('mic-line')).toHaveCount(0);
  expect(n.clips).toBe(0);
  await other.close();
});

test('93 record: the meter while recording; the words on the line, focused, unsent; a second clip too soon is refused', async ({
  page,
  request,
}, info) => {
  test.skip(!STT, 'needs the transcriber environment');
  await watchPage(page);
  const n = watch(page);
  await signIn(page);
  await openPane(page, SHELL0);
  await control(request, '/stt', { answer: 'ok' });
  const before = await calls(request);
  const mic = page.getByTestId('mic');
  const line = page.getByTestId('mic-line');
  const input = page.getByTestId('input');
  await expect(mic).toHaveText('◉');
  await mic.click();
  await expect(line).toHaveAttribute('data-state', 'recording');
  await expect(mic).toHaveText('■');
  await expect(page.getByTestId('mic-cancel')).toBeVisible();
  await expect(line).toContainText('1 s', { timeout: 5000 });
  // The fake device plays a tone: the meter shows it.
  await expect(line).toHaveText(/[▂▃▄▅▆▇█]/);
  await shot(page, info, '93-recording');
  await mic.click();
  await expect(input).toHaveValue(HEARD, { timeout: 10_000 });
  await expect(input).toBeFocused();
  expect(await input.evaluate((el: HTMLTextAreaElement) => el.selectionStart)).toBe(HEARD.length);
  await expect(mic).toHaveText('◉');
  await shot(page, info, '93-heard');
  expect(n.inputs).toEqual([]);
  expect(n.probes).toBe(1);
  expect(await calls(request)).toBe(before + 1);
  // Again at once: the hub refuses, the transcriber is not reached, the line keeps its words.
  await mic.click();
  await expect(line).toHaveAttribute('data-state', 'recording');
  await page.waitForTimeout(800);
  await page.keyboard.press('v');
  await expect(page.getByTestId('toast')).toContainText('one clip every five seconds', {
    timeout: 10_000,
  });
  await expect(input).toHaveValue(HEARD);
  await expect(input).toBeFocused();
  expect(await calls(request)).toBe(before + 1);
  expect(n.inputs).toEqual([]);
  // The worklet is the client's own file: the policy had nothing to say.
  expect(await violations(page)).toEqual([]);
});

test('93 cancel: Esc drops the clip and posts nothing; the words join what was typed', async ({
  page,
  request,
}) => {
  test.skip(!STT, 'needs the transcriber environment');
  const n = watch(page);
  await signIn(page);
  await openPane(page, SHELL0);
  await page.waitForTimeout(5200);
  const before = await calls(request);
  const input = page.getByTestId('input');
  const line = page.getByTestId('mic-line');
  await input.fill('hello');
  await page.keyboard.press('Shift+Escape');
  await expect(input).not.toBeFocused();
  await page.keyboard.press('v');
  await expect(line).toHaveAttribute('data-state', 'recording');
  await page.waitForTimeout(700);
  await page.keyboard.press('Escape');
  await expect(line).toHaveCount(0);
  await expect(page.getByTestId('pane')).toBeVisible();
  await expect(input).toHaveValue('hello');
  await expect(input).toBeFocused();
  expect(await calls(request)).toBe(before);
  expect(n.clips).toBe(0);
  // A click on the meter stops the clip as the button does.
  await page.getByTestId('mic').click();
  await expect(line).toHaveAttribute('data-state', 'recording');
  await page.waitForTimeout(800);
  await line.click();
  await expect(input).toHaveValue(`hello ${HEARD}`, { timeout: 10_000 });
  expect(await calls(request)).toBe(before + 1);
  expect(n.inputs).toEqual([]);
});

test('93 down: the transcriber fails: a toast, the line unchanged', async ({ page, request }) => {
  test.skip(!STT, 'needs the transcriber environment');
  await signIn(page);
  await openPane(page, SHELL0);
  await control(request, '/stt', { answer: '500' });
  await page.waitForTimeout(5200);
  const mic = page.getByTestId('mic');
  await mic.click();
  await expect(page.getByTestId('mic-line')).toHaveAttribute('data-state', 'recording');
  await page.waitForTimeout(800);
  await mic.click();
  await expect(page.getByTestId('toast')).toContainText('transcriber unavailable', {
    timeout: 10_000,
  });
  await expect(page.getByTestId('input')).toHaveValue('');
  await expect(mic).toHaveText('◉');
  await expect(mic).toBeEnabled();
  await control(request, '/stt', { answer: 'ok' });
});
