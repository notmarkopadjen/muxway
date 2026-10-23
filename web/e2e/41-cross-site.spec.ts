import { expect, test } from '@playwright/test';
import { control, signIn } from './fixtures';

const ATTACK = process.env.MX_ATTACK ?? '';

test('41 a page on another origin cannot use the session', async ({ page, request }) => {
  await signIn(page);
  await page.goto(ATTACK);
  const out = page.locator('#out');
  await expect(out).toContainText('done=1');
  const text = await out.textContent();
  expect(text).toMatch(/plain=(blocked|401)/);
  expect(text).toMatch(/header=(blocked|401)/);
  await page.waitForTimeout(800);
  const captured = await control(request, '/capture', { target: 'work:0.0' });
  expect(captured).not.toContain('attacked-');
});
