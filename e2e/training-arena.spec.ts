import { expect, test } from '@playwright/test';

test('opens the rendered training arena and drives a car', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'VELOCITY PITCH' })).toBeVisible();
  await page.getByRole('button', { name: 'TRAINING' }).click();

  const canvas = page.locator('[data-render-layer] canvas');
  await expect(canvas).toBeVisible({ timeout: 20_000 });
  await expect(page.getByLabel('Match scoreboard')).toContainText('FREE PLAY');
  await expect(page.locator('[data-clock]')).toHaveText('NO LIMIT');
  const canvasSize = await canvas.evaluate((element) => {
    const renderedCanvas = element as HTMLCanvasElement;
    return { height: renderedCanvas.height, width: renderedCanvas.width };
  });
  expect(canvasSize.width).toBeGreaterThan(0);
  expect(canvasSize.height).toBeGreaterThan(0);

  await page.keyboard.press('Escape');
  const pauseMenu = page.locator('[data-pause-menu]');
  await expect(pauseMenu).toBeVisible();
  await pauseMenu.getByRole('button', { name: 'SETTINGS' }).click();
  await page.locator('[name="show-position"]').check();
  await expect(page.locator('[data-position-counter]')).toBeVisible();
  await page.getByRole('button', { name: 'BACK' }).click();
  await pauseMenu.click({ position: { x: 20, y: 20 } });
  await page.keyboard.press('Escape');

  const position = page.locator('[data-car-position]');
  const initialPosition = await position.textContent();
  await page.keyboard.down('w');
  await page.waitForTimeout(1_500);
  await page.keyboard.up('w');
  await expect.poll(() => position.textContent(), { timeout: 10_000 }).not.toBe(initialPosition);

  await page.keyboard.press('Escape');
  await pauseMenu.getByRole('button', { name: 'LEAVE TRAINING' }).click();
  await expect(page.getByRole('heading', { name: 'VELOCITY PITCH' })).toBeVisible();
  expect(pageErrors).toEqual([]);
});
