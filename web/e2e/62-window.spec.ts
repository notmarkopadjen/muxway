import { expect, test } from '@playwright/test';
import { control, HOST, RO_TOKEN, settled, shot, signIn } from './fixtures';

test('62 the window view mirrors the host layout', async ({ page, request }, info) => {
  await signIn(page);
  await page.goto(`/w/${HOST}/work/0`);
  await expect(page.getByTestId('window')).toBeVisible();
  await expect(page.getByTestId('cell')).toHaveCount(2);
  // The boxes are measured below: not while the screen still powers on.
  await settled(page);
  // Fit is on by default: off, the view mirrors the host and scales to the box.
  await page.keyboard.press('f');
  await expect(page.getByTestId('fit')).toHaveAttribute('data-on', '0');
  await expect.poll(() => control(request, '/window-size', { target: 'work:0' })).toBe('100x30');
  const layout = await control(request, '/layout', { target: 'work:0' });
  await expect(page.getByTestId('window')).toHaveAttribute('data-layout', layout);
  // Expected fractions from the host's own sizes, along the split's axis.
  const m = /([{[])(\d+)x(\d+),\d+,\d+,\d+,(\d+)x(\d+)/.exec(layout)!;
  const horizontal = m[1] === '{';
  const a = Number(horizontal ? m[2] : m[3]);
  const b = Number(horizontal ? m[4] : m[5]);
  const slots = page.locator('.mx-slot');
  const f0 = Number(await slots.nth(0).getAttribute('data-fraction'));
  const f1 = Number(await slots.nth(1).getAttribute('data-fraction'));
  expect(Math.abs(f0 - a / (a + b))).toBeLessThan(0.02);
  expect(Math.abs(f1 - b / (a + b))).toBeLessThan(0.02);
  const b0 = (await slots.nth(0).boundingBox())!;
  const b1 = (await slots.nth(1).boundingBox())!;
  const s0 = horizontal ? b0.width : b0.height;
  const s1 = horizontal ? b1.width : b1.height;
  expect(Math.abs(s0 / (s0 + s1) - a / (a + b))).toBeLessThan(0.03);
  // Each pane is scaled to its box: well above the floor in a 1200 px window.
  for (const screen of await page.getByTestId('cell-screen').all()) {
    expect(Number(await screen.getAttribute('data-font'))).toBeGreaterThan(9);
  }
  await expect(page.locator('[data-testid="tab"][data-focused]')).toHaveAttribute(
    'data-address',
    `${HOST}/work/0.0`,
  );
  await shot(page, info, '62-window');
});

// The host's panes move only with the write grant on all of them: a
// read-only account, and a writer in a window with a read-only pane
// (work:0.1), both find the arrangement off and l sending nothing.
for (const [who, token] of [
  ['a read-only account', RO_TOKEN],
  ['a writer in a window with a read-only pane', undefined],
] as const) {
  test(`62 security: ${who}: the arrangement is off and l sends nothing`, async ({
    page,
    request,
  }) => {
    // The shape: the writer's fit sizes the window, the arrangement would
    // turn it.
    const shape = async () =>
      (await control(request, '/layout', { target: 'work:0' })).includes('{') ? 'row' : 'column';
    const before = await shape();
    await signIn(page, token);
    await page.goto(`/w/${HOST}/work/0`);
    await expect(page.getByTestId('cell')).toHaveCount(2);
    await expect(page.getByTestId('arrange')).toBeDisabled();
    await page.keyboard.press('l');
    await page.waitForTimeout(1500);
    expect(await shape()).toBe(before);
    await page.goto('/');
  });
}

test('62 l and ▦ lay the window out the next preset way on the host; with fit off the size stays', async ({
  page,
  request,
}, info) => {
  // Window 1 split below: two writable panes, stacked.
  const id = await control(request, '/split', { target: 'work:1.0', dir: 'v' });
  const layout = () => control(request, '/layout', { target: 'work:1' });
  const shape = async () => ((await layout()).includes('{') ? 'row' : 'column');
  await signIn(page);
  await expect(page.getByTestId('pane-row').filter({ hasText: `${HOST}/work/1.1` })).toBeVisible({
    timeout: 10_000,
  });
  await page.goto(`/w/${HOST}/work/1`);
  await expect(page.getByTestId('cell')).toHaveCount(2);
  await settled(page);
  await page.keyboard.press('f');
  await expect(page.getByTestId('fit')).toHaveAttribute('data-on', '0');
  await expect.poll(() => control(request, '/window-size', { target: 'work:1' })).toBe('100x30');
  expect(await shape()).toBe('column');
  // The presets cycle from the first: row, then column.
  await page.keyboard.press('l');
  await expect.poll(shape, { timeout: 8000 }).toBe('row');
  await expect(page.getByTestId('window')).toHaveAttribute('data-layout', await layout(), {
    timeout: 8000,
  });
  await page.waitForTimeout(1100);
  await page.getByTestId('arrange').click();
  await expect.poll(shape, { timeout: 8000 }).toBe('column');
  await expect(page.getByTestId('window')).toHaveAttribute('data-layout', await layout(), {
    timeout: 8000,
  });
  expect(await control(request, '/window-size', { target: 'work:1' })).toBe('100x30');
  await shot(page, info, '62-arranged');
  await page.waitForTimeout(1100);
  await page.keyboard.press('l');
  await expect.poll(shape, { timeout: 8000 }).toBe('row');
  await page.goto('/');
  await control(request, '/kill-pane', { target: id });
  await expect
    .poll(() => control(request, '/window-size', { target: 'work:1' }), { timeout: 8000 })
    .toBe('100x30');
});
