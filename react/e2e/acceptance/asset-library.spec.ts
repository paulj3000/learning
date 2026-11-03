import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { api, expect, parentWithChild, signInAs, test } from './support/fixtures';
import { adminLogin, adminUrl, offeredActions, runAction } from './support/admin';
import { enterCove } from './support/cove';

/**
 * Asset Library acceptance (AM-13, AM-17, ADR-045): staff manage assets in Django Admin only,
 * against in-memory storage with Django delivery (LAI_ASSET_STORAGE=memory). Live S3 storage and
 * S3 signed delivery stay pending; nothing here reaches AWS.
 */

const GLB = readFileSync('public/models/kenney-tree-large.glb');
const GLB_B = readFileSync('public/models/kaykit-floor-tile-large.glb');
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

/** A tenth of a second of 8 kHz mono 16-bit PCM silence. */
function wav(): Buffer {
  const samples = 800;
  const data = Buffer.alloc(samples * 2);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(8000, 24);
  header.writeUInt32LE(16000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const messages = (page: Page) => page.locator('ul.messagelist');

/** Creates an asset definition of a runtime kind (`assets/formats.py` KIND_FAMILY). */
async function createDefinition(page: Page, assetId: string, kind: string, category: string) {
  await page.goto(adminUrl('catalog/contentasset/add/'));
  await page.getByLabel('Asset id').fill(assetId);
  const kindField = page.getByLabel('Kind');
  if ((await kindField.evaluate((el) => el.tagName)) === 'SELECT')
    await kindField.selectOption(kind);
  else await kindField.fill(kind);
  await page.getByLabel('Category').selectOption(category);
  await page.getByLabel('Display name').fill(`E2E ${assetId}`);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
}

async function upload(page: Page, assetId: string, name: string, buffer: Buffer, mime: string) {
  await page.goto(adminUrl('assets/assetversion/upload/'));
  const asset = page.getByLabel('Asset');
  const value = await asset
    .locator('option')
    .evaluateAll(
      (options, id) => (options as HTMLOptionElement[]).find((o) => o.label.includes(id))?.value,
      assetId,
    );
  expect(value, `${assetId} is offered`).toBeTruthy();
  await asset.selectOption(value!);
  await page.getByLabel('File').setInputFiles({ name, mimeType: mime, buffer });
  await page.getByRole('button', { name: /upload/i }).click();
}

/** The version list filtered to one asset. */
const versionsOf = (assetId: string) => adminUrl(`assets/assetversion/?q=${assetId}`);

test.describe.serial('Asset Library in Django Admin', () => {
  test('staff without asset rights cannot upload or publish', async ({ page }) => {
    await adminLogin(page, 'e2e-no-perms');
    for (const path of ['assets/assetversion/upload/', 'assets/assetversion/']) {
      expect((await page.goto(adminUrl(path)))?.status(), path).toBe(403);
    }
    await adminLogin(page, 'e2e-author');
    expect((await page.goto(adminUrl('assets/assetversion/upload/')))?.status()).toBe(403);
  });

  test('an editor defines assets; ids are validated', async ({ page }) => {
    await adminLogin(page, 'e2e-asset-editor');
    await createDefinition(page, 'Bad Id!', 'prop', 'prop');
    await expect(page.locator('.errorlist')).toBeVisible();
    await createDefinition(page, 'e2e-tree', 'prop', 'scenery');
    await expect(messages(page)).toContainText('was added successfully');
    await createDefinition(page, 'e2e-picture', 'image', 'image');
    await expect(messages(page)).toContainText('was added successfully');
    await createDefinition(page, 'e2e-chime', 'audio', 'sound');
    await expect(messages(page)).toContainText('was added successfully');
    // Duplicate logical ids are refused.
    await createDefinition(page, 'e2e-tree', 'prop', 'scenery');
    await expect(page.locator('.errorlist')).toContainText(/already exists/);
  });

  test('uploads validate by content: GLB, PNG and WAV pass, a disguised or huge file fails', async ({
    page,
  }) => {
    await adminLogin(page, 'e2e-asset-editor');
    await upload(page, 'e2e-tree', 'tree.glb', GLB, 'model/gltf-binary');
    await expect(messages(page)).toContainText('Uploaded e2e-tree version 1');
    await upload(page, 'e2e-picture', 'picture.png', PNG, 'image/png');
    await expect(messages(page)).toContainText('Uploaded e2e-picture version 1');
    await upload(page, 'e2e-chime', 'chime.wav', wav(), 'audio/wav');
    await expect(messages(page)).toContainText('Uploaded e2e-chime version 1');

    await upload(
      page,
      'e2e-tree',
      'not-a-model.glb',
      Buffer.from('just some text'),
      'model/gltf-binary',
    );
    await expect(page.locator('.errornote, .errorlist').first()).toBeVisible();
    await expect(page.getByText(/Uploaded e2e-tree/)).toHaveCount(0);
    // A model where a picture belongs is refused: the kind decides what may be uploaded.
    await upload(page, 'e2e-picture', 'tree.glb', GLB, 'model/gltf-binary');
    await expect(page.getByText(/Uploaded e2e-picture/)).toHaveCount(0);
    await upload(
      page,
      'e2e-tree',
      'huge.glb',
      Buffer.alloc(2 * 1024 * 1024 + 1),
      'model/gltf-binary',
    );
    await expect(page.getByText(/too_large: The file is 2,097,153 bytes/)).toBeVisible();
  });

  test('previews: a 3D viewer for models, the image itself and an audio player', async ({
    page,
  }) => {
    await adminLogin(page, 'e2e-asset-editor');
    await page.goto(versionsOf('e2e-tree'));
    await page
      .getByRole('link', { name: /e2e-tree/ })
      .first()
      .click();
    await expect(page.locator('.field-findings, .field-metadata_summary').first()).toBeVisible();
    const preview = page.getByRole('link', { name: /preview/i }).first();
    await preview.click();
    await expect(page.locator('canvas, [data-asset-preview]').first()).toBeVisible();
    for (const [assetId, element] of [
      ['e2e-picture', 'img'],
      ['e2e-chime', 'audio'],
    ] as const) {
      await page.goto(versionsOf(assetId));
      await page
        .getByRole('link', { name: new RegExp(assetId) })
        .first()
        .click();
      const media = page.locator(`.field-file_preview ${element}`);
      await expect(media).toBeVisible();
      const src = await media.getAttribute('src');
      const response = await page.request.get(new URL(src!, page.url()).toString());
      expect(response.status()).toBe(200);
      expect(response.headers()['content-type']).toMatch(
        element === 'img' ? /image\/png/ : /audio/,
      );
    }
  });

  test('an editor cannot publish; a publisher publishes, versions, rolls back', async ({
    page,
  }) => {
    await adminLogin(page, 'e2e-asset-editor');
    await page.goto(versionsOf('e2e-tree'));
    expect(await offeredActions(page)).not.toContain('Publish selected versions');

    await adminLogin(page, 'e2e-asset-publisher');
    await page.goto(adminUrl('assets/assetversion/'));
    await runAction(page, [/e2e-tree/, /e2e-picture/, /e2e-chime/], 'Publish selected versions');
    await expect(messages(page)).toContainText('Published 3 version(s).');

    // Version 2 of the model, published, then made the default; then roll back to version 1.
    await upload(page, 'e2e-tree', 'tile.glb', GLB_B, 'model/gltf-binary');
    await expect(messages(page)).toContainText('Uploaded e2e-tree version 2');
    await page.goto(versionsOf('e2e-tree'));
    await runAction(page, [/(@|:v)2(?!\d)/], 'Publish selected versions');
    await expect(messages(page)).toContainText('Published 1 version(s).');
    await page.goto(versionsOf('e2e-tree'));
    await runAction(page, [/(@|:v)2(?!\d)/], 'Make the selected version the default');
    await expect(messages(page)).toContainText('Made default:');
    await page.goto(versionsOf('e2e-tree'));
    await runAction(
      page,
      [/(@|:v)1(?!\d)/],
      'Roll back: make the selected earlier version the live one',
    );
    await expect(messages(page)).toContainText('Rolled back to');
    await page.goto(versionsOf('e2e-tree'));
    const defaultFlag = (version: RegExp) =>
      page.getByRole('row').filter({ hasText: version }).locator('img[alt="True"]');
    await expect(defaultFlag(/(@|:v)1(?!\d)/)).toHaveCount(1);
    await expect(defaultFlag(/(@|:v)2(?!\d)/)).toHaveCount(0);

    // Every lifecycle step is in the version's admin history.
    await page.goto(versionsOf('e2e-tree'));
    await page
      .getByRole('link', { name: /e2e-tree/ })
      .first()
      .click();
    await page.getByRole('link', { name: 'History' }).click();
    await expect(page.locator('#change-history')).toContainText(/Published|Rolled back/);
  });

  test('published versions are never deleted; definitions retire and reactivate', async ({
    page,
  }) => {
    await adminLogin(page, 'e2e-super');
    await page.goto(versionsOf('e2e-chime'));
    await page
      .getByRole('link', { name: /e2e-chime/ })
      .first()
      .click();
    const change = new URL(page.url());
    change.search = '';
    const remove = new URL(change);
    remove.pathname = remove.pathname.replace(/change\/$/, 'delete/');
    // Even a superuser cannot open the delete page of a published version.
    expect((await page.goto(remove.toString()))?.status()).toBe(403);
    expect((await page.goto(change.toString()))?.status()).toBe(200);
    // The bulk delete (for never-published versions) refuses a published one too.
    await page.goto(versionsOf('e2e-chime'));
    await runAction(page, [/e2e-chime/], 'Delete selected asset versions');
    await expect(page.getByRole('heading', { name: 'Cannot delete asset version' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Yes, I.m sure/ })).toHaveCount(0);

    await adminLogin(page, 'e2e-asset-publisher');
    await page.goto(adminUrl('catalog/contentasset/?q=e2e-chime'));
    await runAction(page, [/e2e-chime/], 'Retire selected assets');
    await expect(messages(page)).toContainText(/retired/i);
    await page.goto(adminUrl('catalog/contentasset/?q=e2e-chime'));
    await runAction(page, [/e2e-chime/], 'Reactivate selected retired assets');
    await expect(messages(page)).toContainText(/reactivated/i);
  });

  test('resolver: signed Django delivery, child isolation, tampered and retired links', async ({
    page,
    request,
  }) => {
    const a = await parentWithChild(request, 'assets-a', {
      nickname: 'Ana',
      ageBand: 'PATHFINDER',
    });
    const b = await parentWithChild(request, 'assets-b', {
      nickname: 'Ben',
      ageBand: 'PATHFINDER',
    });
    const resolve = (who: typeof a, childId: string) =>
      api(request, who.parent).get(
        `children/${childId}/assets/?ids=e2e-tree,e2e-picture,e2e-chime`,
      );

    const resolved = await resolve(a, a.childId);
    expect(resolved.status()).toBe(200);
    const assets = (
      (await resolved.json()) as { assets: { id: string; status: string; url?: string }[] }
    ).assets;
    const byId = Object.fromEntries(assets.map((asset) => [asset.id, asset]));
    for (const [id, type] of [
      ['e2e-tree', /model\/gltf-binary/],
      ['e2e-picture', /image\/png/],
      ['e2e-chime', /audio/],
    ] as const) {
      expect(byId[id]?.status, id).toBe('resolved');
      // The signed URL is the authorization: no bearer token is sent with the file request.
      const file = await request.get(new URL(byId[id]!.url!, e2eOrigin()).toString());
      expect(file.status(), id).toBe(200);
      expect(file.headers()['content-type'], id).toMatch(type);
    }
    // A tampered token is refused.
    const tampered = new URL(byId['e2e-tree']!.url!, e2eOrigin());
    tampered.pathname = tampered.pathname.replace(
      /asset-files\/([^/]+)\//,
      (_m, t: string) => `asset-files/${t.slice(0, -2)}xx/`,
    );
    expect((await request.get(tampered.toString())).status()).toBe(404);
    // Another parent cannot resolve assets for this child (deny by default, no existence leak).
    expect([403, 404]).toContain((await resolve(b, a.childId)).status());

    // Retiring a version makes it unavailable to new resolutions.
    await adminLogin(page, 'e2e-asset-publisher');
    await page.goto(versionsOf('e2e-picture'));
    await runAction(page, [/e2e-picture/], 'Retire selected versions');
    // The default version cannot be retired alone; retiring the asset withdraws it.
    await expect(messages(page)).toContainText("This is the asset's default version.");
    await page.goto(adminUrl('catalog/contentasset/?q=e2e-picture'));
    await runAction(page, [/e2e-picture/], 'Retire selected assets');
    await expect(messages(page)).toContainText(/retired/i);
    const after = (
      (await (await resolve(a, a.childId)).json()) as { assets: { id: string; status: string }[] }
    ).assets;
    expect(after.find((asset) => asset.id === 'e2e-picture')?.status).toBe('retired');
  });

  test('a published model replaces the bundled one in Treasure Cove', async ({
    page,
    request,
    problems,
  }) => {
    void problems;
    await adminLogin(page, 'e2e-asset-publisher');
    await upload(page, 'barrel', 'barrel.glb', GLB, 'model/gltf-binary');
    await expect(messages(page)).toContainText('Uploaded barrel version');
    await page.goto(versionsOf('barrel'));
    await runAction(page, [/barrel/], 'Publish selected versions');
    await expect(messages(page)).toContainText('Published 1 version(s).');

    const { parent, childId } = await parentWithChild(request, 'assets-cove', {
      nickname: 'Cai',
      ageBand: 'SPROUT',
    });
    await signInAs(page, parent);
    const warnings: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'warning') warnings.push(message.text());
    });
    const file = page.waitForResponse((r) => r.url().includes('/api/v1/asset-files/'));
    await enterCove(page, childId);
    const delivered = await file;
    expect(delivered.status()).toBe(200);
    expect(delivered.headers()['content-type']).toMatch(/model\/gltf-binary/);
    expect(warnings.some((w) => w.includes('"barrel" is unavailable'))).toBe(false);
  });
});

function e2eOrigin(): string {
  return adminUrl('').replace(/\/admin\/$/, '');
}
