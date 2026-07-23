import { expect, test } from '@playwright/test';

test('renders bot target and ball trajectory debugging in the 3v3 Bot Lab', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: /3V3 BOT LAB/ }).click();

  await expect(page.locator('[data-render-layer] canvas')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-bot-debug-legend]')).toContainText('BOT TARGETS');
  await expect(page.locator('[data-bot-debug-legend]')).toContainText('HITBOX GUIDES');
  await expect(page.locator('[data-bot-debug-legend]')).toContainText('3 SEC PATH');

  const state = await page.evaluate(() => {
    const api = window.__velocityPitchE2E;
    if (!api) throw new Error('E2E API unavailable');
    api.finishCountdown();
    api.advanceBotTicks(30);
    return {
      botCount: api.players.filter(({ bot }) => bot).length,
      tacticalStateCount: Object.keys(api.tacticalStates()).length,
    };
  });

  expect(state.botCount).toBe(6);
  expect(state.tacticalStateCount).toBe(6);
  expect(pageErrors).toEqual([]);
});
