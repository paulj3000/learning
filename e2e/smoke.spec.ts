import { expect, test } from '@playwright/test';

test('home page loads and shows the Phase 0 shell', async ({ page }) => {
  await page.goto('/');

  await expect(
    page.getByRole('heading', { level: 1, name: /the island is being built/i }),
  ).toBeVisible();
});
