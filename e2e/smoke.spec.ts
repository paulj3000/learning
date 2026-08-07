import { expect, test } from '@playwright/test';

test('home page loads and shows the landing page', async ({ page }) => {
  await page.goto('/');

  await expect(
    page.getByRole('heading', { level: 1, name: /an island that grows/i }),
  ).toBeVisible();
});

test('sign-up page renders its form fields', async ({ page }) => {
  await page.goto('/sign-up');

  await expect(
    page.getByRole('heading', { level: 1, name: /create a parent account/i }),
  ).toBeVisible();
  await expect(page.getByLabel(/your name/i)).toBeVisible();
  await expect(page.getByLabel(/email address/i)).toBeVisible();
  await expect(page.getByLabel(/^password$/i)).toBeVisible();
});

test('sign-in page renders its form fields', async ({ page }) => {
  await page.goto('/sign-in');

  await expect(page.getByRole('heading', { level: 1, name: /^sign in$/i })).toBeVisible();
  await expect(page.getByLabel(/email address/i)).toBeVisible();
  await expect(page.getByLabel(/^password$/i)).toBeVisible();
});
