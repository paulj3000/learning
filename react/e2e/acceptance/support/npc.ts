import { mkdirSync } from 'node:fs';
import type { APIRequestContext, Page } from '@playwright/test';
import { adminUrl } from './admin';
import { api, expect, type Parent } from './fixtures';

/** Helpers for the NPC Manager QA specs (docs/NPC_MANAGER_QA_REPORT.md). */

const SHOTS = 'test-results/npc-qa';

/** A full-page screenshot kept for the QA report (`test-results/npc-qa/<name>.png`). */
export async function shot(page: Page, name: string): Promise<void> {
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

export const messages = (page: Page) => page.locator('ul.messagelist');
export const field = (page: Page, name: string) => page.locator(`[name="${name}"]`);

/** Picks the option of a `<select>` whose label contains `text`. */
export async function choose(page: Page, name: string, text: string | RegExp): Promise<void> {
  const select = field(page, name);
  // Django autocomplete fields (select2) load their options only after a search.
  if (await select.evaluate((el) => el.classList.contains('admin-autocomplete'))) {
    const container = select.locator('xpath=following-sibling::span[contains(@class,"select2")]');
    await container.locator('.select2-selection').click();
    const search = page.locator('.select2-container--open .select2-search__field');
    if (typeof text === 'string') await search.fill(text);
    const option = page
      .locator('.select2-container--open .select2-results__option')
      .filter({ hasText: text });
    await option.first().click();
    return;
  }
  const value = await select
    .locator('option')
    .evaluateAll(
      (options, wanted) =>
        (options as HTMLOptionElement[]).find((o) =>
          wanted.regex ? new RegExp(wanted.source).test(o.label) : o.label.includes(wanted.source),
        )?.value,
      typeof text === 'string'
        ? { source: text, regex: false }
        : { source: text.source, regex: true },
    );
  expect(value, `${name} offers ${String(text)}`).toBeTruthy();
  await select.selectOption(value!);
}

export async function save(page: Page, continueEditing = false): Promise<void> {
  await page
    .locator(`input[name="${continueEditing ? '_continue' : '_save'}"]`)
    .first()
    .click();
}

/** Every validation error Django Admin shows on the page, joined. */
export async function errors(page: Page): Promise<string> {
  return (await page.locator('.errornote, .errorlist').allInnerTexts()).join(' | ');
}

/** Uploads a file as a new version of `assetId` through the Asset Library upload page. */
export async function uploadVersion(page: Page, assetId: string, name: string, buffer: Buffer) {
  await page.goto(adminUrl('assets/assetversion/upload/'));
  await choose(page, 'asset', assetId);
  await page.getByLabel('File').setInputFiles({ name, mimeType: 'model/gltf-binary', buffer });
  await page.getByRole('button', { name: /upload/i }).click();
}

export async function defineCharacterAsset(page: Page, assetId: string): Promise<void> {
  await page.goto(adminUrl('catalog/contentasset/add/'));
  await page.getByLabel('Asset id').fill(assetId);
  const kind = page.getByLabel('Kind');
  if ((await kind.evaluate((el) => el.tagName)) === 'SELECT') await kind.selectOption('character');
  else await kind.fill('character');
  await page.getByLabel('Category').selectOption('character');
  await page.getByLabel('Display name').fill(`E2E ${assetId}`);
  await save(page);
  await expect(messages(page)).toContainText('was added successfully');
}

/** The child's runtime read for one Place (bearer token), as the app would make it. */
export async function placeNpcs(
  request: APIRequestContext,
  parent: Parent,
  childId: string,
  place: string,
) {
  return api(request, parent).get(`children/${childId}/places/${place}/npcs/`);
}

export async function areaNpcs(
  request: APIRequestContext,
  parent: Parent,
  childId: string,
  area: string,
) {
  return api(request, parent).get(`children/${childId}/regions/${area}/npcs/`);
}

/** A runtime read (contract 5.1): scoped reads carry placements, the catalog a list. */
export interface RuntimeRead {
  release: number;
  characters: Record<string, Record<string, unknown>> | { npcId: string }[];
  placements?: { npcId: string; placementKey: string; [key: string]: unknown }[];
}

/** The NPC ids a scoped read places (one entry per placement, so duplicates show). */
export function placedIds(body: RuntimeRead): string[] {
  return (body.placements ?? []).map((entry) => entry.npcId);
}

/** The NPC ids the catalog read serves. */
export function catalogIds(body: RuntimeRead): string[] {
  const characters = body.characters;
  return Array.isArray(characters) ? characters.map((c) => c.npcId) : Object.keys(characters);
}
