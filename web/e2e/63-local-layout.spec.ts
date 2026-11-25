import { expect, test } from '@playwright/test';
import { atRest, HOST, shot, signIn } from './fixtures';

// Hiding a pane and resetting are the browser's own: the cells come and
// go here and the host keeps its panes. Dragging a divider does reach
// the host, as the window follows this box (76 has that).

test('63 drag, hide and reset in the window view', async ({ page, request }, info) => {
  await signIn(page);
  await page.goto(`/w/${HOST}/work/0`);
  await expect(page.getByTestId('cell')).toHaveCount(2);
  await page.waitForTimeout(500);
  const slots = page.locator('.mx-slot');
  const before = Number(await slots.nth(0).getAttribute('data-fraction'));
  const divider = page.getByTestId('divider').first();
  const vertical = ((await divider.getAttribute('class')) ?? '').includes('mx-divider-v');
  const box = (await divider.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(vertical ? cx : cx + 200, vertical ? cy + 120 : cy, { steps: 8 });
  await page.mouse.up();
  const after = Number(await slots.nth(0).getAttribute('data-fraction'));
  expect(after).toBeGreaterThan(before + 0.05);
  await shot(page, info, '63-local');
  // = gives every split equal shares; 0 below goes back to the host's.
  await page.keyboard.press('=');
  await expect(slots.nth(0)).toHaveAttribute('data-fraction', '0.500');
  await page.getByTestId('equal').click();
  await expect(slots.nth(0)).toHaveAttribute('data-fraction', '0.500');
  await page.keyboard.press(']');
  await expect(page.locator('[data-testid="tab"][data-focused]')).toHaveAttribute(
    'data-address',
    `${HOST}/work/0.1`,
  );
  await page.keyboard.press('x');
  await expect(page.getByTestId('cell')).toHaveCount(1);
  // The hidden pane keeps its tab, dimmed; a click brings it back and focuses it.
  const hiddenTab = page.locator(
    `[data-testid="tab"][data-hidden][data-address="${HOST}/work/0.1"]`,
  );
  await expect(hiddenTab).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('cell')).toHaveCount(1);
  await hiddenTab.click();
  await expect(page.getByTestId('cell')).toHaveCount(2);
  await expect(page.locator('[data-testid="tab"][data-hidden]')).toHaveCount(0);
  await expect(page.locator('[data-testid="tab"][data-focused]')).toHaveAttribute(
    'data-address',
    `${HOST}/work/0.1`,
  );
  await page.keyboard.press('x');
  await expect(page.getByTestId('cell')).toHaveCount(1);
  await page.getByTestId('reset').click();
  await expect(page.getByTestId('cell')).toHaveCount(2);
  expect(Math.abs(Number(await slots.nth(0).getAttribute('data-fraction')) - before)).toBeLessThan(
    0.001,
  );
  // The host still has both panes: hiding one is this browser's doing.
  await page.goto('/');
  await atRest(request, 'work:0');
});
