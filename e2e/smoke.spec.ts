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

test('/home is the parent dashboard route and shows the no-backend guard', async ({ page }) => {
  await page.goto('/home');

  await expect(
    page.getByRole('heading', { level: 1, name: /the island is not connected yet/i }),
  ).toBeVisible();
});

test('/home/settings is guarded the same way as the rest of /home', async ({ page }) => {
  await page.goto('/home/settings');

  await expect(
    page.getByRole('heading', { level: 1, name: /the island is not connected yet/i }),
  ).toBeVisible();
});

test('/admin is guarded the same way as the rest of the app when unconfigured', async ({
  page,
}) => {
  await page.goto('/admin');

  await expect(
    page.getByRole('heading', { level: 1, name: /the island is not connected yet/i }),
  ).toBeVisible();
});

test('the old /parent route no longer resolves', async ({ page }) => {
  await page.goto('/parent');

  await expect(page.getByRole('heading', { level: 1, name: /page not found/i })).toBeVisible();
});
