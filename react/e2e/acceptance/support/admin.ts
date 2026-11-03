import { expect, type Page } from '@playwright/test';
import { e2eState } from './fixtures';

/** Django Admin is served by the e2e Django itself (its own staff sign-in, ADR-040). */
export const adminUrl = (path = '') => `${e2eState().djangoOrigin}/admin/${path}`;

/** Signs in to Django Admin as one of the synthetic staff accounts seeded by the e2e server. */
export async function adminLogin(page: Page, username: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto(adminUrl('login/'));
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(e2eState().staffPassword);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('button', { name: /log out/i })).toBeVisible();
}

/** Selects rows by their visible text and runs a changelist action. */
export async function runAction(page: Page, rowTexts: (string | RegExp)[], action: string) {
  for (const text of rowTexts) {
    await page.getByRole('row').filter({ hasText: text }).first().getByRole('checkbox').check();
  }
  await page.getByLabel('Action:').selectOption({ label: action });
  await page.getByRole('button', { name: 'Run' }).click();
}

/** Every changelist action this page offers the signed-in user. */
export async function offeredActions(page: Page): Promise<string[]> {
  return page
    .getByLabel('Action:')
    .locator('option')
    .evaluateAll((options) => options.map((o) => (o as HTMLOptionElement).label));
}
