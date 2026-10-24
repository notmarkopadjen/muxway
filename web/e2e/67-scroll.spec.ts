import { expect, test } from '@playwright/test';
import { control, openPane, SHELL0, signIn } from './fixtures';

// The screen opens at its bottom, stays where the person scrolled while
// the pane keeps changing, and follows again once scrolled back down.
test('67 scrollback: opens at the bottom, holds a position, follows again', async ({
  page,
  request,
}) => {
  await control(request, '/send', {
    target: 'work:0.0',
    text: 'for i in $(seq 1 120); do echo "history-line-$i"; done',
  });
  await signIn(page);
  await openPane(page, SHELL0);
  await expect(page.getByTestId('screen')).toContainText('history-line-120', { timeout: 5000 });
  const screen = page.getByTestId('screen');
  const pos = () =>
    screen.evaluate((el) => ({
      top: el.scrollTop,
      gap: el.scrollHeight - el.scrollTop - el.clientHeight,
      height: el.scrollHeight,
    }));
  await expect.poll(async () => (await pos()).gap).toBeLessThan(5);
  expect((await pos()).top).toBeGreaterThan(0);
  const box = (await screen.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -400);
  await expect.poll(async () => (await pos()).gap).toBeGreaterThan(300);
  const held = (await pos()).top;
  await control(request, '/send', { target: 'work:0.0', text: 'echo more-$((60+7))' });
  await expect(screen).toContainText('more-67', { timeout: 5000 });
  await page.waitForTimeout(1500);
  expect((await pos()).top).toBe(held);
  await page.mouse.wheel(0, 100000);
  await expect.poll(async () => (await pos()).gap).toBeLessThan(5);
  await control(request, '/send', { target: 'work:0.0', text: 'echo again-$((60+7))' });
  await expect(screen).toContainText('again-67', { timeout: 5000 });
  await expect.poll(async () => (await pos()).gap).toBeLessThan(5);
});
